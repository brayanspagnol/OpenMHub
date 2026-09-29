// Base comum dos drivers: abre as interfaces HID e faz pedido/resposta com timeout.

export const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HidDriver {
  constructor(devices) {
    this.devices = devices;               // todos os HIDDevice (interfaces) do aparelho físico
    this.vendorId = devices[0].vendorId;
    this.productId = devices[0].productId;
    this.productName = devices[0].productName;
    this.kind = 'mouse';
    this.name = this.productName;
    this.identity = null;
    this.dev = null;                      // interface usada para os comandos
    this.waiters = [];
    this.raw = {};
    this.lock = Promise.resolve();
    this.onInput = (e) => this.handleInput(e.reportId, new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
  }

  // Escolhe a interface pela coleção vendor; implementado nas subclasses.
  pickDevice() { return null; }

  async open() {
    this.dev = this.pickDevice();
    if (!this.dev) return;
    if (!this.dev.opened) await this.dev.open();
    this.dev.addEventListener('inputreport', this.onInput);
  }

  async close() {
    if (!this.dev) return;
    this.dev.removeEventListener('inputreport', this.onInput);
    if (this.dev.opened) await this.dev.close().catch(() => {});
  }

  handleInput(reportId, data) {
    for (const w of [...this.waiters]) {
      if (w.match(reportId, data)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(data);
      }
    }
    this.onPush?.(reportId, data);
  }

  waitFor(match, timeoutMs) {
    return new Promise((resolve) => {
      const w = { match, resolve };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        resolve(null);
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  // Um comando por vez no mesmo aparelho, como o driver oficial faz.
  exclusive(fn) {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  async request(reportId, payload, match, { timeout = 500, tries = 2 } = {}) {
    if (!this.dev) return null;
    return this.exclusive(async () => {
      for (let i = 0; i < tries; i++) {
        const wait = this.waitFor(match, timeout);
        await this.dev.sendReport(reportId, payload);
        const r = await wait;
        if (r) return r;
      }
      return null;
    });
  }
}

// Aparelho reconhecido pelo fabricante, mas sem protocolo implementado.
export class GenericDriver extends HidDriver {
  constructor(devices) {
    super(devices);
    this.kind = /keyboard|teclado/i.test(this.productName) ? 'keyboard' : 'mouse';
  }
  async poll() {
    return { name: this.productName, via: 'Mostramos só a conexão por enquanto' };
  }
}
