// Checks the headset driver against a fake HIDDevice that answers like a V9 TURBO+ does
// in M HUB's code. No hardware needed: node tools/check-headset.mjs
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null };
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' } });
globalThis.document = { documentElement: {} };
const { HeadsetDriver } = await import('../app/renderer/drivers/headset.js');

function fakeHeadset({ vendorId = 0x3837, productId = 0x600a, productName = 'MCHOSE V9 TURBO+' } = {}) {
  const state = { battery: 76, status: 3, eq: 1, autoOff: 4, prompt: 9 };
  const sent = [];
  const dev = {
    vendorId, productId, productName, opened: false, sent, state,
    collections: [{
      outputReports: [{ reportId: 0x55, items: [{ reportSize: 8, reportCount: 63 }] }],
      featureReports: [{ reportId: 0xaa, items: [{ reportSize: 8, reportCount: 63 }] }],
    }],
    listener: null,
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    addEventListener(_t, fn) { this.listener = fn; },
    removeEventListener() { this.listener = null; },
    reply(bytes) {
      const data = new Uint8Array(63); data.set(bytes);
      setTimeout(() => this.listener?.({ reportId: 0x55, data: new DataView(data.buffer) }), 1);
    },
    async sendReport(id, data) {
      assert.equal(id, 0x55);
      assert.equal(data.length, 63, 'output reports are padded to the descriptor size');
      sent.push([...data.slice(0, 3)]);
      const [c, a, b] = data;
      if (c === 0x65) this.reply([0x65, state.battery, state.status]);
      else if (c === 0x11) this.reply([0x11, state.eq]);
      else if (c === 0x21) state.eq = b;
      else if (c === 0x22 && a === 0x02) this.reply([0x22, 0x02, state.autoOff]);
      else if (c === 0x22 && a === 0x04) this.reply([0x22, 0x04, state.prompt]);
      else if (c === 0x22 && a === 0x00) state.autoOff = b;
      else if (c === 0x22 && a === 0x03) state.prompt = b;
    },
    fwTarget: null,
    async sendFeatureReport(id, data) { assert.equal(id, 0xaa); this.fwTarget = data[1]; },
    async receiveFeatureReport() {
      const v = this.fwTarget === 1 ? [0, 0, 0, 8] : [0, 1, 2, 3];
      return new DataView(new Uint8Array([0xaa, 1, ...v]).buffer);
    },
  };
  return dev;
}

assert.ok(HeadsetDriver.match(0x3837, 0x600a));
assert.ok(HeadsetDriver.match(0x291d, 0x385d));
assert.ok(!HeadsetDriver.match(0x3837, 0x418c), 'the G3 V2 mouse is not a headset');

const dev = fakeHeadset();
const drv = new HeadsetDriver([dev]);
await drv.open();
let st = await drv.poll();
assert.equal(st.online, true);
assert.equal(st.battery, 76);
assert.equal(st.charging, true);
assert.equal(st.firmware, '0123');
assert.equal(st.receiverFirmware, '0008');
assert.deepEqual(st.settings, { eq: 1, autoOff: 4, prompt: 9 });

await drv.setEq(2);
await drv.setAutoOff(0);
await drv.setPrompt(16);
assert.deepEqual([dev.state.eq, dev.state.autoOff, dev.state.prompt], [2, 0, 16]);

dev.state.status = 0x1a;
st = await drv.poll();
assert.equal(st.online, false);
assert.equal(st.sleeping, true);

// The shared 2.4G dongle takes the model name from the USB product name.
const shared = new HeadsetDriver([fakeHeadset({ vendorId: 0x291d, productId: 0x385d, productName: 'MCHOSE G9 PRO' })]);
assert.equal(shared.name, 'G9 PRO');
assert.equal(shared.identity, 'mchose-headset-g9-pro');

console.log('headset driver ok');
