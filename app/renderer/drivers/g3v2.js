// Mouses MCHOSE com chip YJX (G3 V2, G3 V2 Pro, G7, A7e).
// Protocolo do M HUB web (/gmouse): interface vendor 0xFF01/0x10, pacotes de 64 bytes
// sem report id. Pedido começa com 0x55 <cmd>, resposta com 0xAA <cmd>.
// Nos pacotes de configuração, o offset do pedido é igual ao da resposta.
import { HidDriver, hex } from './base.js';

const DPI_12K = { min: 200, max: 12000, marks: [200, 2000, 4000, 6000, 8000, 10000, 12000] };
const DPI_26K = { min: 200, max: 26000, marks: [200, 2200, 4200, 6200, 8000, 12000, 20000, 26000] };

const MODELS = {
  0x418c: { name: 'G3 V2', wired: true, dpi: DPI_12K },
  0x4245: { name: 'G3 V2', wired: false, dpi: DPI_12K },
  0x4242: { name: 'G3 V2 Pro', wired: true, dpi: DPI_26K },
  0x4012: { name: 'A7e', wired: true, dpi: DPI_12K },
  0x4013: { name: 'A7e Pro', wired: true, dpi: DPI_12K },
};

const CMD = {
  battery: [0x55, 0x30, 0xa5, 0x0b, 0x2e, 0x01, 0x01, 0x01],
  version: [0x55, 0x03],
  status: [0x55, 0xed],
  config: [0x55, 0x0e, 0xa5, 0x0b, 0x30, 0x01, 0x01, 0x01],
  writeConfig: [0x55, 0x0f, 0xae, 0x0a, 0x30, 0x01, 0x01, 0x01],
  keys: [0x55, 0x08, 0xa5, 0x0b, 0x20],
  writeKeys: [0x55, 0x09, 0xa5, 0x22, 0x20],
  macroRead: 0x0c,     // 55 0C 00 00 <len> <offL> <offH> 00 -> AA 0C ... dados a partir do byte 8
  macroWrite: 0x0d,    // 55 0D 00 <soma> <len> <offL> <offH> 00 <até 56 bytes>
  macroCommit: [0x55, 0x10, 0xa5, 0x22, 0x00, 0x00, 0x00, 0x05],
};

export const RATES = [125, 250, 500, 1000];
export const SENSOR = { angleSnap: 1, ripple: 16, motionSync: 32 };

// Padrão de fábrica do G3 V2 (DefaultProfile do M HUB).
export const DEFAULT_CONFIG = {
  rateIdx: 3, dpiCount: 6, dpiIndex: 2, dpis: [400, 800, 1600, 3200, 6400, 12000],
  scroll: 0, lod: 1, sensor: 0, debounce: 8, sleep: 3, highspeed: 0, angle: 0,
};
export const DEFAULT_KEYS = [
  { type: 32, code1: 1, code2: 0, code3: 0 },
  { type: 32, code1: 2, code2: 0, code3: 0 },
  { type: 32, code1: 4, code2: 0, code3: 0 },
  { type: 32, code1: 8, code2: 0, code3: 0 },
  { type: 32, code1: 16, code2: 0, code3: 0 },
];

function packet(bytes) {
  const p = new Uint8Array(64);
  p.set(bytes);
  return p;
}
const ascii = (b) => (b >= 0x30 && b <= 0x39 ? String.fromCharCode(b) : '0');

export class G3V2Driver extends HidDriver {
  static match(vid, pid) { return vid === 0x3837 && pid in MODELS; }

  constructor(devices) {
    super(devices);
    const m = MODELS[this.productId];
    this.kind = 'mouse';
    this.name = m.name;
    this.model = m;
    this.isCable = m.wired;
    this.identity = 'mchose-' + m.name.toLowerCase().replace(/\s+/g, '-');
    this.firmware = null;
    this.receiverFirmware = null;
    this.config = null;
    this.keys = null;
    this.pushed = {};
    this.pollCount = 0;
    this.writing = 0;
  }

  pickDevice() {
    return this.devices.find((d) => d.collections.some((c) => c.usagePage === 0xff01 && c.usage === 0x10)) || null;
  }

  // Mensagens que o mouse manda sozinho (bateria, troca de DPI pelo botão, online/offline).
  onPush(_rid, d) {
    if (d[0] !== 0xaa) return;
    if (d[1] === 0x30) this.pushed.battery = { battery: d[8], charging: d[9] === 1, at: Date.now() };
    if (d[1] === 0xed) this.pushed.status = d[8];
    if (d[1] === 0xfa && d[8] !== 0xd0) {
      this.pushed.dpiIndex = d[9] - 1;
      if (this.config) this.config = { ...this.config, dpiIndex: d[9] - 1, rateIdx: d[10] - 1 };
      // Avisa o app (notificação de troca de DPI pelo botão do mouse).
      const c = this.config;
      if (c) this.onEvent?.({ type: 'dpi', index: c.dpiIndex, count: c.dpiCount, value: c.dpis[c.dpiIndex] });
    }
  }

  cmd(bytes, timeout = 450) {
    return this.request(0, packet(bytes), (_rid, d) => d[0] === 0xaa && d[1] === bytes[1], { timeout });
  }

  async poll() {
    const st = { name: this.name, mode: this.isCable ? 'wired' : '2.4g', via: this.isCable ? 'Cabo USB' : 'Receptor 2.4G' };
    if (!this.dev) return { ...st, online: false };

    // No receptor, 0xED diz se o mouse está ligado (1 = desligado, em repouso ou fora de alcance).
    if (!this.isCable) {
      const s = await this.cmd(CMD.status);
      this.raw.status = s && hex(s.slice(0, 16));
      if (!s) return { ...st, online: false, raw: this.raw };
      if (s[8] === 1) return { ...st, online: false, raw: this.raw, firmware: this.firmware, receiverFirmware: this.receiverFirmware };
    }

    const b = await this.cmd(CMD.battery);
    this.raw.battery = b && hex(b.slice(0, 16));
    // Pelo cabo, silêncio quer dizer que a chave do mouse está em 2.4G/BT e o cabo só carrega.
    if (!b) return { ...st, online: false, cableOnly: this.isCable, raw: this.raw };
    st.online = true;
    st.battery = b[8];
    st.charging = b[9] === 1;

    if (!this.firmware) {
      const v = await this.cmd(CMD.version);
      if (v) {
        this.raw.version = hex(v);
        this.firmware = `${ascii(v[23])}.${ascii(v[24])}.${ascii(v[25])}`;
        if (!this.isCable) this.receiverFirmware = `${ascii(v[20])}.${ascii(v[21])}.${ascii(v[22])}`;
      }
    }
    st.firmware = this.firmware;
    st.receiverFirmware = this.receiverFirmware;

    // Configuração muda pouco: relê a cada 5 ciclos, nunca no meio de uma gravação.
    if (!this.writing && (!this.config || this.pollCount++ % 5 === 0)) await this.readConfig();
    if (!this.keys) await this.readKeys();
    if (this.config) {
      const c = this.config;
      st.config = c;
      st.dpi = c.dpis[c.dpiIndex];
      st.pollingRate = this.isCable ? 1000 : RATES[c.rateIdx] ?? null;
    }
    st.keys = this.keys;
    st.dpiRange = this.model.dpi;
    st.canWrite = true;
    st.raw = this.raw;
    return st;
  }

  async readConfig() {
    const c = await this.cmd(CMD.config);
    if (!c) return null;
    this.raw.config = hex(c);
    const parsed = parseConfig(c);
    this.config = parsed || { ...DEFAULT_CONFIG, dpis: [...DEFAULT_CONFIG.dpis] };
    return this.config;
  }

  // Gravação: o bloco é regravado inteiro, com os campos nos mesmos offsets da leitura.
  async writeConfig(patch) {
    if (!this.config) await this.readConfig();
    if (!this.config) throw new Error('Mouse não respondeu');
    const c = { ...this.config, ...patch };
    c.dpis = [...(patch.dpis || this.config.dpis)];
    while (c.dpis.length < 6) c.dpis.push(c.dpis[c.dpis.length - 1] || 800);
    c.dpiCount = Math.min(6, Math.max(1, c.dpiCount));
    c.dpiIndex = Math.min(c.dpiCount - 1, Math.max(0, c.dpiIndex));
    const p = packet(CMD.writeConfig);
    p[10] = c.rateIdx + 1;
    p[11] = c.dpiCount;
    p[12] = c.dpiIndex + 1;
    c.dpis.slice(0, 6).forEach((d, i) => { p[13 + i * 2] = d & 0xff; p[14 + i * 2] = d >> 8; });
    p[48] = c.scroll;
    p[49] = c.lod;
    p[50] = c.sensor;
    p[51] = c.debounce;
    p[52] = c.sleep;
    p[53] = c.highspeed;
    p[55] = c.angle & 0xff;
    this.config = c;
    this.writing++;
    try {
      const r = await this.request(0, p, (_rid, d) => d[0] === 0xaa && d[1] === 0x0f, { timeout: 600, tries: 1 });
      this.raw.lastWrite = hex(p);
      this.raw.lastWriteAck = r && hex(r.slice(0, 16));
    } finally { this.writing--; }
    return c;
  }

  async readKeys() {
    const r = await this.cmd(CMD.keys);
    if (!r) return null;
    this.raw.keys = hex(r);
    const keys = [];
    for (let i = 0; i < 5; i++) {
      const o = 8 + i * 4;
      keys.push({ type: r[o], code1: r[o + 1], code2: r[o + 2], code3: r[o + 3] });
    }
    // Tipo 0 ou 0xFF = nunca gravado: vale o padrão de fábrica daquele botão.
    this.keys = keys.map((k, i) => (k.type === 0 || k.type === 0xff ? { ...DEFAULT_KEYS[i] } : k));
    return this.keys;
  }

  async writeKeys(keys) {
    const p = packet(CMD.writeKeys);
    keys.forEach((k, i) => { const o = 8 + i * 4; p[o] = k.type; p[o + 1] = k.code1; p[o + 2] = k.code2; p[o + 3] = k.code3; });
    // Entradas fixas que o M HUB sempre manda depois dos 5 botões (DPI e roda).
    p.set([0x21, 0x55, 0, 0, 0x21, 0x38, 0x01, 0, 0x21, 0x38, 0xff, 0], 28);
    this.keys = keys.map((k) => ({ ...k }));
    const r = await this.request(0, p, (_rid, d) => d[0] === 0xaa && d[1] === 0x09, { timeout: 600, tries: 1 });
    this.raw.lastKeysWrite = hex(p);
    this.raw.lastKeysAck = r && hex(r.slice(0, 16));
    return this.keys;
  }

  // Lê o cabeçalho da área de macros (56 bytes no offset 0).
  // Só o offset 0 é seguro: testado no G3 V2, 55 0C com offset > 0 devolve lixo da RAM
  // e às vezes derruba o link 2.4G. Por isso o conteúdo das ações não é relido do mouse.
  async readMacroHeader() {
    const r = await this.request(0, packet([0x55, CMD.macroRead, 0, 0, 56, 0, 0, 0]),
      (_rid, d) => d[0] === 0xaa && d[1] === CMD.macroRead, { timeout: 500, tries: 2 });
    if (!r) throw new Error('Mouse não respondeu à leitura das macros');
    const head = r.slice(8, 64);
    this.raw.macroHead = hex(head);
    return head;
  }

  // Macros gravadas no mouse, pelo cabeçalho: quantas e quantas ações cada uma tem
  // (a última macro não tem tamanho conhecido: actions = null).
  async readMacros() {
    const head = await this.readMacroHeader();
    const ptrs = [];
    for (let i = 0; i < 28; i++) {
      const p = head[i * 2] | (head[i * 2 + 1] << 8);
      if (p === 0 || p === 0xffff || p < 64 || p >= MACRO_AREA) break;
      ptrs.push(p);
    }
    const real = ptrs.filter((p) => p !== 64).sort((a, b) => a - b);
    return {
      head,
      macros: ptrs.map((p) => {
        if (p === 64) return { actions: 0 };
        const next = real.find((q) => q > p);
        return { actions: next ? (next - p) / 4 : null };
      }),
    };
  }

  // Grava a área inteira (todas as macros), como o M HUB faz, e confirma com 55 10.
  async writeMacroArea(bytes) {
    this.writing++;
    try {
      for (let off = 0; off < bytes.length; off += 56) {
        const chunk = bytes.slice(off, off + 56);
        const s = [chunk.length, off & 0xff, off >> 8, 0, ...chunk];
        const sum = s.reduce((a, b) => a + b, 0) & 0xff;
        const r = await this.request(0, packet([0x55, CMD.macroWrite, 0, sum, ...s]),
          (_rid, d) => d[0] === 0xaa && d[1] === CMD.macroWrite, { timeout: 600, tries: 1 });
        if (!r) throw new Error('Mouse não confirmou a gravação da macro');
      }
      const c = await this.request(0, packet(CMD.macroCommit), (_rid, d) => d[0] === 0xaa && d[1] === 0x10, { timeout: 800, tries: 1 });
      this.raw.macroCommitAck = c && hex(c.slice(0, 16));
    } finally { this.writing--; }
  }

  async writeMacros(macros) {
    const bytes = encodeMacros(macros);
    await this.writeMacroArea(bytes);
    this.macros = macros.map((m) => ({ actions: m.actions.map((a) => ({ ...a })) }));
    // O modo de repetição vai no code3 da entrada do botão: mantém em dia.
    if (this.keys?.some((k) => k.type === MACRO_TYPE)) {
      const keys = this.keys.map((k) => (k.type === MACRO_TYPE && macros[k.code1] ? { ...k, code3: macros[k.code1].type ?? k.code3 } : k));
      if (keys.some((k, i) => k.code3 !== this.keys[i].code3)) await this.writeKeys(keys);
    }
    return this.macros;
  }

  // Troca uma macro (ou cria no fim, se index === lista.length) e regrava tudo.
  async writeMacro(index, macro, all = null) {
    const list = [...(all || (this.macros || []).map((m) => ({ ...m })))];
    list[index] = macro;
    return this.writeMacros(list);
  }
}

/* ---------- Macros ---------- */
// Área de macros (2048 bytes no perfil 0, igual ao setMacro do M HUB web):
//   0..63   32 ponteiros u16 LE, um por macro, para o início da lista de ações (0 = sem macro)
//   64..67  00 00 80 00: lista vazia, apontada pelas macros sem ações
//   68..    ações de 4 bytes: <atraso L> <atraso H> <flags> <código>
//           flags: bits 0-5 = tipo (1 modificador, 2 tecla, 3 botão do mouse, 4 roda),
//           bit 6 = pressionar (0 = soltar), bit 7 = última ação da macro.
//           Modificador: código = máscara (1 << (uso HID - 224)). Roda: código 1 = cima, 255 = baixo.
//           Atraso (ms) vale depois da ação.
// Botão ligado à macro: entrada de tecla { type: 0x70, code1: índice, code2: 0, code3: modo }.
export const MACRO_TYPE = 0x70;
export const MACRO_MODES = { hold: 2, toggle: 4, anyKey: 3, once: 0 };
export const MACRO_MAX = 20;
export const MACRO_AREA = 2048;
const MACRO_HEAD = 68;

// Ações no formato do aparelho: { kind: 'key'|'mouse'|'wheel', code, down, delay }.
export function encodeMacros(macros) {
  const head = new Array(64).fill(0);
  const body = [];
  macros.forEach((m, i) => {
    const acts = m.actions || [];
    if (!acts.length) { head[i * 2] = 64; head[i * 2 + 1] = 0; return; }
    const ptr = MACRO_HEAD + body.length;
    head[i * 2] = ptr & 0xff; head[i * 2 + 1] = ptr >> 8;
    acts.forEach((a, j) => {
      const delay = Math.min(65535, Math.max(1, Math.round(a.delay || 2)));
      let kind, code;
      if (a.kind === 'wheel') { kind = 4; code = a.code === 255 || a.code < 0 ? 255 : 1; }
      else if (a.kind === 'mouse') { kind = 3; code = a.code; }
      else if (a.code >= 224 && a.code <= 231) { kind = 1; code = 1 << (a.code - 224); }
      else { kind = 2; code = a.code & 0xff; }
      const down = a.kind === 'wheel' || a.down ? 1 : 0;
      const last = j === acts.length - 1 ? 1 : 0;
      body.push(delay & 0xff, delay >> 8, kind | (down << 6) | (last << 7), code);
    });
  });
  const buf = [...head, 0, 0, 0x80, 0, ...body];
  if (buf.length > MACRO_AREA) throw new Error('Macros grandes demais para a memória do mouse');
  return Uint8Array.from(buf);
}

function parseConfig(t) {
  const blank = (t[13] === 0 && t[14] === 0 && t[15] === 0) || (t[13] === 255 && t[14] === 255 && t[15] === 255);
  if (blank) return null;
  const dpis = [];
  for (let i = 0; i < 6; i++) dpis.push(Math.min(50000, Math.max(50, t[13 + i * 2] | (t[14 + i * 2] << 8))));
  return {
    rateIdx: Math.min(3, Math.max(0, t[10] - 1)),
    dpiCount: Math.min(6, Math.max(1, t[11])),
    dpiIndex: Math.max(0, t[12] - 1),
    dpis,
    scroll: t[48],
    lod: t[49],              // 0xFF = nunca gravado (padrão de fábrica)
    sensor: t[50],
    debounce: t[51],
    sleep: t[52],            // minutos; 0 = nunca dorme
    highspeed: t[53],
    angle: t[55],
  };
}
