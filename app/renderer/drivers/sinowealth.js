// Teclados MCHOSE com chip SINOWEALTH (UT98 / G98 V2).
//
// Sem fio, pelo dongle 41e4:2004 ("MCHOSE 2.4G Wireless"): output report 0x13 com 19 bytes;
// o último é a soma de todos os bytes anteriores, incluindo o report id. Respostas voltam no
// input report 0x13. Pacote: [0]=comando, [1]=total de pacotes, [2]=sequência, [3]=tamanho/camada,
// [4..17]=14 bytes de dados, [18]=soma. Leituras longas chegam em vários pacotes;
// gravações vão em blocos de 14 bytes e o teclado devolve cada pacote como confirmação.
//
// Com fio (41e4:2203, "MCHOSE UT98" / "MCHOSE G98 V2"): feature report 9 com 519 bytes,
// [0]=comando, [1]=camada/subcomando, [2]=0, [3]=total de páginas, [4]=página, [5..6]=tamanho LE,
// [7..]=dados. Leitura: manda o pedido (comando | 0x80) e lê o feature report 9, que volta
// no mesmo formato. Gravação: manda o bloco inteiro de uma vez, sem confirmação.
// O modo com fio segue o M HUB web (readCommand/writeCommand, ramo isWired) e NÃO foi
// testado em hardware.
import { HidDriver, hex, sleep } from './base.js';
import { KEY_ORDER, LAYOUT } from '../data/keyboard-ut98.js';
import { t } from '../i18n.js';

const RID = 0x13;          // sem fio
const WIRED_RID = 9;       // com fio (feature report)
const WIRED_LEN = 519;
const PUSH = 0x0a;         // avisos espontâneos do teclado (bateria, conexão)

export const VID = 0x41e4;
export const PID_DONGLE = 0x2004;
export const PID_WIRED = 0x2203;

// "Senha" devolvida pelo comando 0x05 -> modelo (tabela do M HUB).
const MODELS = {
  '03000000021c': 'G87', '030000000077': 'K99', '0300000001df': 'K99 V2', '030000000132': 'G98',
  '0300000000d6': 'X75', '0a0000000003': 'G98 Pro', '0300000001c6': 'X75 V2', '030000000115': 'G75 Pro',
  '0a0000000018': 'G98 V2', '0a000000002b': 'UT98', '0a0000000001': 'Z75', '0a0000000009': 'Z75S',
  '0300000001c7': 'KX75', '030000000174': 'GX87', '0300000001ed': 'GX87 V2', '030000000135': 'K87',
  '030000000335': 'G75 V2', '0a0000000034': 'G87 V2',
};
// Modelos com o mapa de memória implementado aqui (UT98 e G98 V2 usam a mesma configuração).
const SUPPORTED = ['UT98', 'G98 V2'];

// Tamanhos das estruturas.
const PERF_LEN = 128;
const LIGHT_LEN = 483;     // 23 blocos de 21 bytes; a cor do efeito N fica no início do bloco N
const KEYS_LEN = KEY_ORDER.length * 4;   // 113 teclas x 4 bytes
const DIY_LEN = 126;       // cor por tecla, na ordem de KEY_ORDER
// Cauda fixa que o M HUB sempre manda depois das estruturas (UT98 / G98 V2).
const LIGHT_TAIL = [3, 0, 0, 0, 1, 50, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 90, 165, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0];
const LIGHT_TAIL_WIRED = [...new Array(23).fill(0), 90, 165, 0, 0, 0, 0];   // "empty16" do ramo com fio
const LAYERS = [0, 1, 2];   // normal, Fn, Fn2
const KEYS_TAIL = [...new Array(44).fill(0), 2, 0, 0, 234, 2, 0, 0, 233, 0, 0, 0, 0, 0, 0, 90, 165];

// Posições dentro da estrutura de desempenho.
const P = { latency: 2, mac: 4, sleep: 9, winLock: 11, lightType: 32, lightMode: 33 };
// Brilho/velocidade/cor múltipla de cada efeito: 2 bytes a partir desta posição.
const MODE_AT = { 1: 85, 2: 87, 3: 89, 4: 91, 5: 93, 7: 97, 8: 99, 10: 103, 11: 105, 12: 107, 14: 111, 15: 113, 16: 115, 17: 117 };

/* ---------- Macros ---------- */
// Área de macros (página 0, 512 bytes; testado no UT98 pelo dongle):
//   tabela com 4 bytes por macro: <endereço L> <endereço H> <tamanho L> <tamanho H>
//     (o endereço da primeira é 4 x número de macros; tamanho = 1 + bytes do nome + 4 x ações)
//   cada macro: <bytes do nome> <nome em UTF-8> <ações de 4 bytes>
//   ação: [0] bit 7 = soltar (0 = pressionar), bits 4-6 = tipo (0 tecla, 1 tecla estendida
//         (código > 69 fora da navegação, ex.: modificadores 224..231), 2 botão do mouse),
//         bits 0-2 = bits 16-18 do atraso; [1] = bits 8-15; [2] = bits 0-7 (atraso em ms depois
//         da ação); [3] = uso HID da tecla ou máscara do mouse (1 esq., 2 dir., 4 meio, 8 voltar, 16 avançar).
// Sem fio: comando 0x03, blocos de 14 bytes, yy = (página << 4) | tamanho do bloco.
// Leitura: 0x43 com yy = página << 4; a resposta vem rotulada 0x41, com 518 bytes; depois do fim
// da área sobra lixo do buffer do teclado, por isso só a tabela define o que vale.
// Gravações maiores que uma página não ficaram no lugar certo no teste: limite de 512 bytes.
// Tecla ligada à macro: [3, modo, 1, índice]; modo 4 = repete enquanto segura,
// 2 = repete até outra tecla, 1 = executa uma vez.
export const KB_MACRO_TYPE = 3;
export const KB_MACRO_AREA = 512;
export const KB_MACRO_MAX = 16;
export const KB_MACRO_MODES = { hold: 4, anyKey: 2, once: 1 };
const DELAY_BITS_MAX = 0x7ffff;
const NAV_CODES = [79, 80, 81, 82, 98, 89, 90, 91, 92, 93, 94, 95, 96, 97, 87, 86, 85, 84, 99, 88, 76, 72, 73, 74, 75, 77, 78, 70, 71, 83];

export const macroKey = (index, mode) => [KB_MACRO_TYPE, mode, 1, index];

const utf8 = (s) => Array.from(new TextEncoder().encode(s || ''));

// Bytes que uma macro ocupa na área (sem a entrada da tabela).
export const macroBytes = (name, actions) => 1 + utf8(name).length + 4 * actions;

// macros: [{ name, actions: [{ kind: 'key'|'mouse', code, down, delay }] }]
export function encodeKbMacros(macros) {
  if (!macros.length) return Uint8Array.from([0, 0, 0, 0]);
  const head = [];
  const body = [];
  const base = macros.length * 4;
  for (const m of macros) {
    const name = utf8(m.name).slice(0, 255);
    const acts = [];
    for (const a of m.actions || []) {
      if (a.kind === 'wheel') continue;          // o teclado não tem roda nas macros
      const delay = Math.min(DELAY_BITS_MAX, Math.max(0, Math.round(a.delay || 0)));
      let type = 0;
      if (a.kind === 'mouse') type = 2;
      else if (a.code > 69 && !NAV_CODES.includes(a.code)) type = 1;
      acts.push(((a.down ? 0 : 1) << 7) | (type << 4) | ((delay >> 16) & 7), (delay >> 8) & 0xff, delay & 0xff, a.code & 0xff);
    }
    const addr = base + body.length;
    const len = 1 + name.length + acts.length;
    head.push(addr & 0xff, addr >> 8, len & 0xff, len >> 8);
    body.push(name.length, ...name, ...acts);
  }
  const buf = [...head, ...body];
  if (buf.length > KB_MACRO_AREA) throw new Error(t('err.macrosTooBig', { dev: t('noun.keyboard') }));
  return Uint8Array.from(buf);
}

// Lê a área; devolve [{ name, actions }]. Para na primeira entrada inválida.
export function decodeKbMacros(b) {
  const u16 = (i) => b[i] | (b[i + 1] << 8);
  const first = u16(0);
  if (!first || first % 4 || first > KB_MACRO_AREA || first / 4 > 64) return [];
  const out = [];
  const dec = new TextDecoder();
  for (let i = 0; i < first / 4; i++) {
    const addr = u16(i * 4), len = u16(i * 4 + 2);
    if (addr < first || !len || addr + len > KB_MACRO_AREA) break;
    const nlen = b[addr];
    if (1 + nlen > len || (len - 1 - nlen) % 4) break;
    const name = dec.decode(b.slice(addr + 1, addr + 1 + nlen));
    const actions = [];
    for (let p = addr + 1 + nlen; p < addr + len; p += 4) {
      const f = b[p];
      actions.push({
        kind: ((f >> 4) & 7) === 2 ? 'mouse' : 'key',
        code: b[p + 3],
        down: !(f & 0x80),
        delay: ((f & 7) << 16) | (b[p + 1] << 8) | b[p + 2],
      });
    }
    out.push({ name, actions });
  }
  return out;
}

/* ---------- Pacotes ---------- */
function packet(cmd, total, seq, yy, data = []) {
  const p = new Uint8Array(19);
  p.set([cmd, total, seq, yy]);
  p.set(data.slice(0, 14), 4);
  let sum = RID;
  for (let i = 0; i < 18; i++) sum += p[i];
  p[18] = sum & 0xff;
  return p;
}

// Campo "yy" do último pacote: base menos os zeros no fim do bloco (regra do M HUB).
const yyTrim = (base) => (chunk, last) => {
  if (!last) return base;
  const r = [...chunk].reverse().findIndex((b) => b !== 0);
  return r === -1 ? 0 : base - r;
};
const yyLen = (chunk, last) => (last ? chunk.length : 14);
const yyMacro = (chunk, last, i) => (((i * 14) >> 9) << 4) | chunk.length;

// Blocos de configuração: comandos sem fio (get/set) e com fio (wget/wset), tamanho do
// cabeçalho com fio e o parâmetro de camada.
const BLOCK = {
  password: { get: 0x05, wget: 0x82, sub: 1, wlen: 6 },
  battery: { get: 0x4a, wget: 0x87, wlen: 2 },
  perf: { get: 0x44, set: 0x04, yy: () => yyLen, wget: 0x84, wset: 0x04, wlen: 0x80 },
  light: { get: 0x49, set: 0x09, yy: () => yyTrim(14), wget: 0x8a, wset: 0x10, wlen: 0x200 },
  keys: { get: 0x41, set: 0x01, yy: (layer) => yyTrim(14 + 16 * layer), wget: 0x83, wset: 0x03, wlen: 0x1f8, layered: true },
  diy: { get: 0x42, set: 0x02, yy: () => () => 14, wget: 0x86, wset: 0x06, wlen: 0x17a },
  macro: { get: 0x43, reply: 0x41, set: 0x03, yy: () => yyMacro, wget: 0x82, sub: 0, wset: 0x05, wlen: KB_MACRO_AREA },
};

// Pedido de leitura com fio: [comando, camada/sub, 0, 1, 0, tamanho L, tamanho H, zeros...].
export function wiredReadRequest(block, layer = 0) {
  const b = BLOCK[block];
  const p = new Uint8Array(WIRED_LEN);
  p.set([b.wget, b.layered ? layer : (b.sub || 0), 0, 1, 0, b.wlen & 0xff, b.wlen >> 8]);
  return p;
}

// Gravação com fio: [comando, camada, 0, 1, 0, tamanho L, tamanho H, dados..., zeros].
export function wiredWriteRequest(block, bytes, layer = 0) {
  const b = BLOCK[block];
  const len = block === 'macro' ? bytes.length : b.wlen;
  if (bytes.length > WIRED_LEN - 7) throw new Error(t('err.wiredBlock'));
  const p = new Uint8Array(WIRED_LEN);
  p.set([b.wset, b.layered ? layer : 0, 0, 1, 0, len & 0xff, len >> 8]);
  p.set(Array.from(bytes), 7);
  return p;
}

// Resposta do feature report 9. O Chrome devolve o report id no primeiro byte (o M HUB
// descarta 2 bytes: id e comando); sem ele, o comando vem primeiro. Devolve os dados
// depois do cabeçalho de 7 bytes, ou null se o comando não bate com o pedido.
export function parseWiredResponse(u8, block) {
  const b = BLOCK[block];
  let d = u8;
  const cmdOk = (c) => c === b.wget || c === (b.wget & 0x7f);
  if (d.length > WIRED_LEN || (d[0] === WIRED_RID && cmdOk(d[1]) && !cmdOk(d[0]))) d = d.slice(1);
  if (!cmdOk(d[0])) return null;
  return d.slice(7);
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

export class SinowealthKeyboardDriver extends HidDriver {
  static match(vid, pid) { return vid === VID && (pid === PID_DONGLE || pid === PID_WIRED); }

  constructor(devices) {
    super(devices);
    this.kind = 'keyboard';
    this.wired = this.productId === PID_WIRED;
    this.name = t('kb.defaultName');
    // O mesmo teclado pelo cabo e pelo dongle vira um cartão só (o app prefere o cabo).
    this.identity = 'mchose-kb-41e4-2004';
    this.last = {};          // último estado conhecido (pedido ou push)
    this.connected = null;   // push tipo 2: 0 = teclado desligado ou dormindo
    this.model = null;       // nome do modelo lido pelo comando 0x05
    this.sink = null;        // coletor dos pacotes de uma transferência em andamento
    this.kb = null;          // configuração lida: { performance, lighting, keys, diy, macros }
    this.raw.kb = {};
  }

  get supported() { return SUPPORTED.includes(this.model); }

  pickDevice() {
    if (this.wired) {
      return this.devices.find((d) => d.collections.some((c) => c.featureReports?.some((r) => r.reportId === WIRED_RID)))
        || this.devices.find((d) => d.collections.some((c) => c.usagePage === 0xff00)) || null;
    }
    return this.devices.find((d) => d.collections.some((c) => c.outputReports?.some((r) => r.reportId === RID))) || null;
  }

  // Pushes: [0]=0x0A, [1..3]=reservado, [4]=tipo. Tipo 5 = bateria, tipo 2 = conexão.
  onPush(rid, d) {
    if (rid !== RID) return;
    this.sink?.(d);
    if (d[0] !== PUSH || d.length < 7) return;
    if (d[4] === 5) {
      this.raw.pushBattery = hex(d);
      this.last = { battery: d[5], full: (d[6] & 0x0f) === 1, charging: (d[6] >> 4) === 1, at: Date.now() };
      this.connected = true;
    } else if (d[4] === 2) {
      this.raw.pushConnect = hex(d);
      this.connected = d[5] !== 0;
      if (!this.connected) this.stale = true;
    }
  }

  /* ---------- Transporte sem fio ---------- */

  // Leitura de vários pacotes, já concatenados (14 bytes de dados por pacote).
  // Dormindo, o teclado não responde: desiste depois de `first` ms.
  readRaw(cmd, params = [], { first = 600, gap = 400, tries = 2, reply = cmd } = {}) {
    if (!this.dev) return Promise.resolve(null);
    return this.exclusive(async () => {
      for (let t = 0; t < tries; t++) {
        const got = new Map();
        let total = 0;
        let done;
        const finished = new Promise((r) => { done = r; });
        let timer = setTimeout(() => done(false), first);
        this.sink = (d) => {
          if (d[0] !== reply || d[1] === 0) return;
          total = d[1];
          got.set(d[2], d.slice(4, 18));
          clearTimeout(timer);
          if (got.size >= total) done(true);
          else timer = setTimeout(() => done(false), gap);
        };
        const req = new Uint8Array(19);
        req.set([cmd, 1, ...params]);
        let sum = RID;
        for (let i = 0; i < 18; i++) sum += req[i];
        req[18] = sum & 0xff;
        try {
          await this.dev.sendReport(RID, req);
          const ok = await finished;
          if (ok && [...Array(total).keys()].every((i) => got.has(i))) {
            const out = new Uint8Array(total * 14);
            for (let i = 0; i < total; i++) out.set(got.get(i), i * 14);
            return out;
          }
        } finally {
          clearTimeout(timer);
          this.sink = null;
        }
        // Sem resposta nenhuma: o teclado está dormindo, não adianta insistir.
        if (!got.size) return null;
        await sleep(60);
      }
      return null;
    });
  }

  // Gravação em blocos de 14 bytes; cada pacote espera o eco do teclado.
  // Três falhas seguidas num pacote: recomeça do primeiro (como o M HUB). Duas voltas no máximo.
  writeRaw(cmd, bytes, yyFn) {
    if (!this.dev) return Promise.reject(new Error(t('err.kbNotConnected')));
    const data = Array.from(bytes);
    const chunks = [];
    for (let i = 0; i < data.length; i += 14) chunks.push(data.slice(i, i + 14));
    const n = chunks.length;
    const pkts = chunks.map((c, i) => packet(cmd, n, i, yyFn(c, i === n - 1, i), c));
    return this.exclusive(async () => {
      for (let round = 0; round < 2; round++) {
        let ok = true;
        for (let i = 0; i < n && ok; i++) {
          ok = false;
          for (let t = 0; t < 3 && !ok; t++) {
            const ack = new Promise((resolve) => {
              const timer = setTimeout(() => resolve(false), 500);
              this.sink = (d) => { if (d[0] === cmd && d[2] === i) { clearTimeout(timer); resolve(true); } };
            });
            await this.dev.sendReport(RID, pkts[i]);
            ok = await ack;
            this.sink = null;
            if (!ok) await sleep(100 * (t + 1));
          }
          // Nem o primeiro pacote foi aceito: teclado dormindo, não vale recomeçar.
          if (!ok && i === 0) return Promise.reject(new Error(t('err.kbNoReply')));
        }
        if (ok) return true;
      }
      throw new Error(t('err.kbNoConfirm'));
    });
  }

  /* ---------- Transporte com fio (feature report 9; não testado em hardware) ---------- */

  async receiveWired(timeout = 1000) {
    const r = await Promise.race([
      this.dev.receiveFeatureReport(WIRED_RID),
      sleep(timeout).then(() => null),
    ]);
    return r ? new Uint8Array(r.buffer, r.byteOffset, r.byteLength) : null;
  }

  readWired(block, layer = 0) {
    if (!this.dev) return Promise.resolve(null);
    return this.exclusive(async () => {
      for (let t = 0; t < 2; t++) {
        try {
          await this.dev.sendFeatureReport(WIRED_RID, wiredReadRequest(block, layer));
          const r = await this.receiveWired();
          if (r) {
            this.raw.kb.wiredLast = hex(r.slice(0, 16));
            const data = parseWiredResponse(r, block);
            if (data) return data;
          }
        } catch (err) {
          console.warn('teclado com fio: leitura', block, err);
        }
        await sleep(40);
      }
      return null;
    });
  }

  writeWired(block, bytes, layer = 0) {
    if (!this.dev) return Promise.reject(new Error(t('err.kbNotConnected')));
    const req = wiredWriteRequest(block, bytes, layer);
    return this.exclusive(async () => {
      await sleep(50);                       // o M HUB espera 50 ms antes de cada gravação com fio
      await this.dev.sendFeatureReport(WIRED_RID, req);
      return true;
    });
  }

  /* ---------- Blocos (escolhe o transporte) ---------- */

  async readBlock(block, layer = 0, opts = {}) {
    if (this.wired) return this.readWired(block, layer);
    const b = BLOCK[block];
    const params = b.layered ? [0, layer << 4] : block === 'macro' ? [0, 0] : [];
    return this.readRaw(b.get, params, { reply: b.reply || b.get, ...opts });
  }

  writeBlock(block, bytes, layer = 0) {
    // Sem fio, yy = (camada << 4) | tamanho: um último bloco só de zeros daria yy = 0 e o
    // teclado gravaria na camada normal (visto no teste). A cauda 5A A5 evita isso; confere.
    if (block === 'keys' && !(bytes[bytes.length - 2] === 90 && bytes[bytes.length - 1] === 165)) {
      return Promise.reject(new Error(t('err.kbKeyBlock')));
    }
    if (this.wired) return this.writeWired(block, bytes, layer);
    const b = BLOCK[block];
    return this.writeRaw(b.set, bytes, b.yy(layer));
  }

  // Grava e confere lendo de volta; se veio diferente (pacote perdido), grava de novo uma vez.
  async writeChecked(block, bytes, len, layer = 0) {
    for (let t = 0; t < 2; t++) {
      await this.writeBlock(block, bytes, layer);
      await sleep(40);
      const back = await this.readBlock(block, layer, { first: 800 });
      if (back && same(Array.from(back.slice(0, len)), Array.from(bytes.slice(0, len)))) return back;
    }
    throw new Error(t('err.kbNotStored'));
  }

  /* ---------- Identificação ---------- */

  async readModel() {
    const r = await this.readBlock('password', 0, { tries: 1 });
    if (!r) return null;
    const key = hex(r.slice(0, 6)).replace(/ /g, '');
    this.raw.kb.password = key;
    this.model = MODELS[key] || `desconhecido (${key})`;
    if (MODELS[key]) this.name = MODELS[key];
    return this.model;
  }

  /* ---------- Desempenho e efeito de luz (mesma estrutura, 128 bytes) ---------- */

  parsePerf(b) {
    const modes = {};
    for (const [m, at] of Object.entries(MODE_AT)) {
      // Nibble baixo: 7 = colorido; 0..6 = índice na paleta de 7 cores do efeito (0 = cor escolhida no app).
      modes[m] = { brightness: b[at], speed: b[at + 1] >> 4, multi: (b[at + 1] & 0x0f) === 7, colorIdx: b[at + 1] & 0x0f };
    }
    return {
      latency: b[P.latency], fastMode: b[P.latency] === 0,
      mac: b[P.mac] === 1, winLock: b[P.winLock] === 1,
      sleep: b[P.sleep], sleepMin: b[P.sleep] / 2,
      lightType: b[P.lightType], lightMode: b[P.lightMode],
      pollingRate: 1000, modes,
    };
  }

  async readPerformance() {
    const r = await this.readBlock('perf');
    if (!r) return null;
    this.perfRaw = Array.from(r.slice(0, PERF_LEN));
    this.perfAt = Date.now();
    this.raw.kb.performance = hex(r.slice(0, PERF_LEN));
    return this.parsePerf(this.perfRaw);
  }

  // patch: { fastMode, mac, winLock, sleep (em meios minutos, 0 = nunca), lightMode,
  //          mode: { id, brightness (bruto 0..20), speed 0..5, multi } }
  async writePerformance(patch) {
    if (!this.perfRaw) await this.readPerformance();
    if (!this.perfRaw) throw new Error(t('err.kbRead'));
    const b = [...this.perfRaw];
    if ('fastMode' in patch) b[P.latency] = patch.fastMode ? 0 : (b[P.latency] || 2);
    if ('mac' in patch) { b[P.mac] = patch.mac ? 1 : 0; if (patch.mac) b[P.winLock] = 0; }
    if ('winLock' in patch) b[P.winLock] = patch.winLock ? 1 : 0;
    if ('sleep' in patch) b[P.sleep] = Math.max(0, Math.min(40, Math.round(patch.sleep)));
    if ('lightMode' in patch) {
      b[P.lightMode] = patch.lightMode;
      b[P.lightType] = patch.lightMode === 19 ? 1 : 0;
    }
    const m = patch.mode;
    if (m && MODE_AT[m.id]) {
      const at = MODE_AT[m.id];
      if (m.brightness != null) b[at] = Math.max(0, Math.min(20, m.brightness));
      let s = b[at + 1] >> 4, c = b[at + 1] & 0x0f;
      if (m.speed != null) s = Math.max(0, Math.min(5, m.speed));
      if (m.multi != null) c = m.multi ? 7 : 0;
      b[at + 1] = (s << 4) | c;
    }
    const back = await this.writeChecked('perf', b, PERF_LEN);
    this.perfRaw = Array.from(back.slice(0, PERF_LEN));
    const perf = this.parsePerf(this.perfRaw);
    if (this.kb) this.kb.performance = perf;
    return perf;
  }

  /* ---------- Cores dos efeitos ---------- */

  // Cada efeito tem uma paleta de 7 cores (21 bytes); a primeira é a cor escolhida no app.
  parseLight(b) {
    const colors = {}, palettes = {};
    for (let m = 1; m <= 22; m++) {
      palettes[m] = [0, 1, 2, 3, 4, 5, 6].map((i) => b.slice(m * 21 + i * 3, m * 21 + i * 3 + 3));
      colors[m] = palettes[m][0];
    }
    return { colors, palettes };
  }

  async readLighting() {
    const r = await this.readBlock('light');
    if (!r) return null;
    this.lightRaw = Array.from(r.slice(0, LIGHT_LEN));
    this.raw.kb.lighting = hex(r.slice(0, 64)) + ' …';
    return this.parseLight(this.lightRaw);
  }

  // Cor de um efeito (lightMode) em [r, g, b].
  async writeLightColor(mode, rgb) {
    if (!this.lightRaw) await this.readLighting();
    if (!this.lightRaw) throw new Error(t('err.kbRead'));
    const b = [...this.lightRaw];
    b.splice(mode * 21, 3, ...rgb.map((v) => Math.max(0, Math.min(255, Math.round(v)))));
    const back = await this.writeChecked('light', [...b, ...(this.wired ? LIGHT_TAIL_WIRED : LIGHT_TAIL)], LIGHT_LEN);
    this.lightRaw = Array.from(back.slice(0, LIGHT_LEN));
    const light = this.parseLight(this.lightRaw);
    if (this.kb) this.kb.lighting = light;
    return light;
  }

  // Atalho usado pela aba de iluminação: efeito, brilho (1..4), velocidade (0..5), cor múltipla e cor.
  async writeLighting({ mode, brightness, speed, multi, color } = {}) {
    const cur = this.kb?.performance?.lightMode ?? 0;
    const id = mode ?? cur;
    const patch = {};
    if (mode != null && mode !== cur) patch.lightMode = mode;
    if (MODE_AT[id] && (brightness != null || speed != null || multi != null)) {
      patch.mode = { id, brightness: brightness != null ? brightness * 5 : null, speed, multi };  // brilho 0..4 -> 0..20
    }
    if (Object.keys(patch).length) await this.writePerformance(patch);
    if (color) {
      await this.writeLightColor(id, color);
      // A cor escolhida é a posição 0 da paleta; tira o efeito do modo colorido ou de outra posição.
      const m = this.kb?.performance?.modes?.[id];
      if (m && m.colorIdx !== 0) await this.writePerformance({ mode: { id, multi: false } });
    }
  }

  /* ---------- Teclas ---------- */

  keysFromRaw(layer) {
    const keys = {};
    KEY_ORDER.forEach((k, i) => { keys[k] = this.keysRaw[layer].slice(i * 4, i * 4 + 4); });
    return keys;
  }

  // Camada 0 = normal, 1 = Fn, 2 = Fn2. Devolve { nomeDaTecla: [4 bytes] } na ordem de KEY_ORDER.
  async readKeys(layer = 0) {
    const r = await this.readBlock('keys', layer);
    if (!r) return null;
    this.keysRaw = this.keysRaw || {};
    this.keysRaw[layer] = Array.from(r.slice(0, KEYS_LEN));
    return this.keysFromRaw(layer);
  }

  // Grava a camada inteira; só as teclas de `changes` ({ nome: [4 bytes] }) mudam.
  async writeKeys(changes, layer = 0) {
    if (!this.keysRaw?.[layer]) await this.readKeys(layer);
    if (!this.keysRaw?.[layer]) throw new Error(t('err.kbRead'));
    const b = [...this.keysRaw[layer]];
    for (const [k, v] of Object.entries(changes)) {
      const i = KEY_ORDER.indexOf(k);
      if (i < 0 || k === 'Fn' || k.startsWith('space')) continue;
      b.splice(i * 4, 4, ...v.map((x) => x & 0xff));
    }
    const back = await this.writeChecked('keys', [...b, ...KEYS_TAIL], KEYS_LEN, layer);
    this.keysRaw[layer] = Array.from(back.slice(0, KEYS_LEN));
    const keys = this.keysFromRaw(layer);
    if (this.kb) this.kb.keys[layer] = keys;
    return keys;
  }

  // Volta a camada para os valores de fábrica do desenho (as outras vagas ficam como estão).
  // A camada Fn2 vem vazia de fábrica.
  resetKeys(layer = 0) {
    const changes = {};
    for (const k of LAYOUT) changes[k.k] = layer === 2 ? [0, 0, 0, 0] : layer ? k.f : k.d;
    return this.writeKeys(changes, layer);
  }

  /* ---------- Luz personalizada por tecla (efeito 19) ---------- */

  async readDiy() {
    const r = await this.readBlock('diy');
    if (!r) return null;
    this.diyRaw = Array.from(r.slice(0, DIY_LEN * 3));
    return this.diyFromRaw();
  }

  // colors: { nomeDaTecla: [r, g, b] } só com o que muda.
  async writeDiy(colors) {
    if (!this.diyRaw) await this.readDiy();
    if (!this.diyRaw) throw new Error(t('err.kbRead'));
    const b = [...this.diyRaw];
    for (const [k, rgb] of Object.entries(colors)) {
      const i = KEY_ORDER.indexOf(k);
      if (i < 0 || i >= DIY_LEN) continue;
      rgb.forEach((v, c) => { b[c * DIY_LEN + i] = v & 0xff; });
    }
    const back = await this.writeChecked('diy', b, DIY_LEN * 3);
    this.diyRaw = Array.from(back.slice(0, DIY_LEN * 3));
    const diy = this.diyFromRaw();
    if (this.kb) this.kb.diy = diy;
    return diy;
  }

  diyFromRaw() {
    const diy = {};
    KEY_ORDER.forEach((k, i) => { if (i < DIY_LEN) diy[k] = [this.diyRaw[i], this.diyRaw[DIY_LEN + i], this.diyRaw[2 * DIY_LEN + i]]; });
    return diy;
  }

  /* ---------- Macros ---------- */

  // Macros gravadas no teclado: [{ name, actions }] (o modo fica na tecla, não na macro).
  async readMacros() {
    const r = await this.readBlock('macro', 0, { first: 800 });
    if (!r) throw new Error(t('err.kbMacroRead'));
    const area = r.slice(0, KB_MACRO_AREA);
    this.raw.kb.macroHead = hex(area.slice(0, 32));
    this.macros = decodeKbMacros(area);
    if (this.kb) this.kb.macros = this.macros;
    return this.macros;
  }

  // macros: [{ name, type (modo 4/2/1), actions }]. Grava a área inteira, confere e
  // acerta o modo das teclas já ligadas a cada macro.
  async writeMacros(macros) {
    const bytes = encodeKbMacros(macros);
    await this.writeChecked('macro', bytes, bytes.length);
    this.macros = macros.map((m) => ({ name: m.name, actions: (m.actions || []).map((a) => ({ ...a })) }));
    if (this.kb) this.kb.macros = this.macros;
    for (const layer of LAYERS) {
      const keys = this.kb?.keys?.[layer];
      if (!keys) continue;
      const changes = {};
      for (const [k, v] of Object.entries(keys)) {
        const m = v[0] === KB_MACRO_TYPE ? macros[v[3]] : null;
        if (m && m.type && v[1] !== m.type) changes[k] = macroKey(v[3], m.type);
      }
      if (Object.keys(changes).length) await this.writeKeys(changes, layer);
    }
    return this.macros;
  }

  /* ---------- Cópia de segurança ---------- */

  // Configuração inteira em JSON simples (bytes crus de cada bloco + macros decodificadas).
  async exportConfig() {
    if (!(await this.loadAll())) throw new Error(t('err.kbNoReply'));
    const macros = await this.readMacros();
    return {
      format: 'mhub-linux-keyboard', version: 1, model: this.model, password: this.raw.kb.password,
      performance: [...this.perfRaw], lighting: [...this.lightRaw], diy: [...this.diyRaw],
      keys: Object.fromEntries(LAYERS.map((l) => [l, [...this.keysRaw[l]]])),
      macros: macros.map((m) => ({ name: m.name, actions: m.actions.map((a) => ({ ...a })) })),
    };
  }

  // Grava de volta o que exportConfig devolveu; cada bloco é conferido lendo de volta.
  async importConfig(cfg) {
    if (cfg?.format !== 'mhub-linux-keyboard') throw new Error(t('err.kbBackupFormat'));
    if (!this.model) await this.readModel();
    if (cfg.model !== this.model) throw new Error(t('err.kbBackupModel', { from: cfg.model, to: this.model }));
    const bytes = (a, n) => {
      if (!Array.isArray(a) || a.length < n || a.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error(t('err.kbBackupBad'));
      return a.slice(0, n);
    };
    const perf = bytes(cfg.performance, PERF_LEN), light = bytes(cfg.lighting, LIGHT_LEN), diy = bytes(cfg.diy, DIY_LEN * 3);
    const keys = LAYERS.filter((l) => cfg.keys?.[l]).map((l) => [l, bytes(cfg.keys[l], KEYS_LEN)]);
    if (Array.isArray(cfg.macros)) await this.writeMacros(cfg.macros.map((m) => ({ name: String(m.name), actions: m.actions || [] })));
    await this.writeChecked('perf', perf, PERF_LEN);
    await this.writeChecked('light', [...light, ...(this.wired ? LIGHT_TAIL_WIRED : LIGHT_TAIL)], LIGHT_LEN);
    for (const [l, k] of keys) await this.writeChecked('keys', [...k, ...KEYS_TAIL], KEYS_LEN, l);
    await this.writeChecked('diy', diy, DIY_LEN * 3);
    return this.reload();
  }

  /* ---------- Fábrica ---------- */

  async factoryReset() {
    // Com fio, o M HUB regrava as tabelas padrão dele em vez de um comando de reset.
    if (this.wired) throw new Error(t('err.kbFactoryWired'));
    await this.writeRaw(0x06, new Array(14).fill(0), yyTrim(14));
    await sleep(800);
    await this.loadAll();
  }

  /* ---------- Leitura completa ---------- */

  async loadAll() {
    if (!this.model) await this.readModel();
    if (!this.supported) return null;
    const performance = await this.readPerformance();
    const lighting = performance && await this.readLighting();
    const k0 = lighting && await this.readKeys(0);
    const k1 = k0 && await this.readKeys(1);
    const k2 = k1 && await this.readKeys(2);
    const diy = k2 && await this.readDiy();
    if (!diy) return null;
    const fresh = { model: this.model, performance, lighting, keys: { 0: k0, 1: k1, 2: k2 }, diy, macros: this.macros || null };
    // Mantém o mesmo objeto: o status já entregue à interface continua valendo.
    if (this.kb) Object.assign(this.kb, fresh); else this.kb = fresh;
    this.stale = false;
    return this.kb;
  }

  // Relê tudo (botão de atualizar da interface).
  async reload() {
    if (!(await this.loadAll())) throw new Error(t('err.kbNoReply'));
    return this.kb;
  }

  async poll() {
    return this.wired ? this.pollWired() : this.pollWireless();
  }

  async pollWired() {
    const st = { name: this.name, mode: 'wired', via: t('via.cable') };
    if (!this.dev) return { ...st, online: false };
    const r = await this.readBlock('battery');
    if (r) {
      this.raw.battery = hex(r.slice(0, 2));
      this.last = { battery: r[0], full: (r[1] & 0x0f) === 1, charging: (r[1] >> 4) === 1, at: Date.now() };
      if (!this.kb || this.stale) {
        try { await this.loadAll(); } catch (err) { console.warn('teclado: leitura', err); }
      } else if (Date.now() - (this.perfAt || 0) > 20000) {
        const perf = await this.readPerformance().catch(() => null);
        if (perf) this.kb.performance = perf;
      }
    }
    st.name = this.name;
    st.raw = this.raw;
    if (this.model) st.model = this.model;
    // Sem resposta pelo cabo: some da lista de preferidos e o cartão usa o dongle, se houver.
    if (!r && !this.last.at) return { ...st, online: false };
    return { ...st, online: true, battery: this.last.battery, charging: this.last.charging && !this.last.full, ...this.kbState() };
  }

  async pollWireless() {
    const st = { name: this.name, mode: '2.4g', via: t('via.receiver') };
    if (!this.dev) return { ...st, online: false };
    // Resposta: [0]=0x4A, [1]=total de pacotes, [2]=sequência, [3]=tamanho, [4]=bateria, [5]=nibbles.
    const r = await this.request(RID, packet(BLOCK.battery.get, 1, 0, 0), (rid, d) => rid === RID && d[0] === BLOCK.battery.get, { timeout: 700, tries: 1 });
    if (r) {
      this.raw.battery = hex(r);
      this.last = { battery: r[4], full: (r[5] & 0x0f) === 1, charging: (r[5] >> 4) === 1, at: Date.now() };
      this.connected = true;
      // Acordado: lê a configuração na primeira vez (ou depois de reconectar).
      if (!this.kb || this.stale) {
        try { await this.loadAll(); } catch (err) { console.warn('teclado: leitura', err); }
      } else if (Date.now() - (this.perfAt || 0) > 20000) {
        // Brilho, efeito e Win lock também mudam pelas teclas Fn: relê o desempenho de vez em quando.
        const perf = await this.readPerformance().catch(() => null);
        if (perf) this.kb.performance = perf;
      }
    }
    st.name = this.name;
    st.raw = this.raw;
    if (this.model) st.model = this.model;
    if (!r && this.connected !== true) {
      // Dongle presente, teclado sem responder: dormindo ou desligado.
      return { ...st, sleeping: true, battery: this.last.battery, charging: this.last.charging, ...this.kbState() };
    }
    if (!r && Date.now() - (this.last.at || 0) > 30000) this.connected = null;
    return { ...st, online: true, battery: this.last.battery, charging: this.last.charging && !this.last.full, ...this.kbState() };
  }

  kbState() {
    if (!this.kb) return {};
    return { canWrite: true, kb: this.kb, pollingRate: 1000, wired: this.wired };
  }
}
