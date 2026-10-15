// Headsets MCHOSE sem fio com chip C-Media (V9, V9 PRO, G9 PRO, S9 PRO, X9, V9 TURBO, V9 TURBO+).
// Protocolo da página de headset do M HUB para desktop (hidDeviceOptions/getTargetHook):
// relatório de saída 0x55, resposta no mesmo relatório com o primeiro byte igual ao comando.
// EQ, surround, redução de ruído e retorno do microfone são DSP do driver de áudio do Windows,
// não comandos HID: não existem no Linux. Ainda não testado num headset real.
import { HidDriver, hex, sleep } from './base.js';
import { t } from '../i18n.js';

const RID = 0x55;
const FW_RID = 0xaa;
// O dongle 291D:385D é o mesmo para S9 PRO, G9 PRO, V9 e V9 PRO: o nome vem do productName.
const MODELS = [
  { vid: 0x41e4, pid: 0x3402, name: 'S9 PRO' },
  { vid: 0x41e4, pid: 0x3502, name: 'G9 PRO' },
  { vid: 0x41e4, pid: 0x3201, name: 'V9' },
  { vid: 0x41e4, pid: 0x3202, name: 'V9 PRO' },
  { vid: 0x291d, pid: 0x385d, name: null },
  { vid: 0x3837, pid: 0x6045, name: 'X9' },
  { vid: 0x3837, pid: 0x600d, name: 'V9 TURBO', turbo: true },
  { vid: 0x3837, pid: 0x600a, name: 'V9 TURBO+', turbo: true },
  { vid: 0x3837, pid: 0x6009, name: 'V9 TURBO+', turbo: true, wired: true },
];

const STATUS = { discharging: 2, charging: 3, full: 4, asleep: 0x1a };
export const EQ_MODES = [0, 1, 2];                   // Game 1, Game 2, Música
export const AUTO_OFF = [[1, 15], [4, 30], [0, 45]]; // valor no aparelho -> minutos

const modelOf = (vid, pid) => MODELS.find((m) => m.vid === vid && m.pid === pid);

// Tamanho do relatório de saída pelo descritor; o M HUB manda 15 ou 63 bytes conforme o comando.
function outputSize(dev, id) {
  for (const c of dev.collections) {
    const r = c.outputReports?.find((x) => x.reportId === id);
    if (r) return r.items.reduce((n, it) => n + (it.reportSize * it.reportCount) / 8, 0);
  }
  return 63;
}

export class HeadsetDriver extends HidDriver {
  static match(vid, pid) { return !!modelOf(vid, pid); }

  constructor(devices) {
    super(devices);
    const m = modelOf(this.vendorId, this.productId);
    this.kind = 'headset';
    this.model = m;
    this.name = m.name || this.productName.replace(/^MCHOSE\s+/i, '').trim() || this.productName;
    this.identity = 'mchose-headset-' + this.name.toLowerCase().replace(/\s+/g, '-');
    this.firmware = null;
    this.receiverFirmware = null;
    this.settings = null;
    this.pollCount = 0;
  }

  pickDevice() {
    return this.devices.find((d) => d.collections.some((c) => c.outputReports?.some((r) => r.reportId === RID))) || null;
  }

  packet(bytes) {
    const p = new Uint8Array(outputSize(this.dev, RID));
    p.set(bytes.slice(0, p.length));
    return p;
  }

  cmd(bytes, opts) {
    return this.request(RID, this.packet(bytes), (rid, d) => rid === RID && d[0] === bytes[0], opts);
  }

  send(bytes) {
    return this.exclusive(() => this.dev.sendReport(RID, this.packet(bytes)));
  }

  // Versão por relatório de feature 0xAA: [1, alvo] com alvo 1 = dongle, 0 = headset.
  async readVersion(target) {
    const dev = this.dev;
    if (!dev?.collections.some((c) => c.featureReports?.some((r) => r.reportId === FW_RID))) return null;
    return this.exclusive(async () => {
      const req = new Uint8Array(63);
      req[0] = 1; req[1] = target;
      await dev.sendFeatureReport(FW_RID, req);
      for (const wait of [300, 500, 900]) {
        await sleep(wait);
        const v = await dev.receiveFeatureReport(FW_RID).catch(() => null);
        if (!v) continue;
        let b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        if (b[0] === FW_RID) b = b.subarray(1);  // alguns sistemas devolvem o id do relatório no início
        if (b[0] === 1) return `${b[1]}${b[2]}${b[3]}${b[4]}`;
      }
      return null;
    });
  }

  async poll() {
    const m = this.model;
    const st = { name: this.name, mode: m.wired ? 'wired' : '2.4g', via: t(m.wired ? 'via.cable' : 'via.receiver') };
    if (!this.dev) return { ...st, online: false };

    const b = await this.cmd([0x65, 0x01], { timeout: 1000, tries: 3 });
    this.raw.battery = b && hex(b.slice(0, 8));
    if (!b) return { ...st, online: false, raw: this.raw };
    if (b[2] === STATUS.asleep) return { ...st, online: false, sleeping: true, raw: this.raw, firmware: this.firmware, receiverFirmware: this.receiverFirmware };
    st.online = true;
    st.battery = b[1];
    st.charging = b[2] === STATUS.charging;
    st.full = b[2] === STATUS.full;

    if (!this.firmware) {
      this.firmware = await this.readVersion(0);
      if (!m.wired) this.receiverFirmware = await this.readVersion(1);
    }
    st.firmware = this.firmware;
    st.receiverFirmware = this.receiverFirmware;

    // Ajustes mudam pouco: relê a cada 5 ciclos.
    if (!this.settings || this.pollCount++ % 5 === 0) await this.readSettings();
    st.settings = this.settings;
    st.canWrite = !!this.settings;
    st.raw = this.raw;
    return st;
  }

  async readSettings() {
    const s = { ...(this.settings || {}) };
    const eq = await this.cmd([0x11]);
    if (eq) s.eq = eq[1];
    if (this.model.turbo) {
      const off = await this.cmd([0x22, 0x02]);
      if (off) s.autoOff = off[2];
      const vol = await this.cmd([0x22, 0x04], { timeout: 100, tries: 3 });
      if (vol) s.prompt = vol[2];
    }
    this.raw.settings = hex([s.eq, s.autoOff, s.prompt].map((x) => x ?? 0));
    if (s.eq != null) this.settings = s;
  }

  // O headset avisa sozinho quando a bateria ou o EQ mudam (botão no próprio aparelho).
  onPush(rid, d) {
    if (rid !== RID || !this.settings) return;
    if (d[0] === 0x11) this.settings.eq = d[1];
  }

  async setEq(mode) {
    await this.send([0x21, 0x01, mode]);
    this.settings = { ...this.settings, eq: mode };
  }

  async setAutoOff(v) {
    await this.send([0x22, 0x00, v]);
    this.settings = { ...this.settings, autoOff: v };
  }

  async setPrompt(v) {
    await this.send([0x22, 0x03, v]);
    this.settings = { ...this.settings, prompt: v };
  }

  async factoryReset() {
    await this.send([0x22, 0x01]);
    this.settings = null;
  }
}
