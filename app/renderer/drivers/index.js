import { GenericDriver } from './base.js';
import { G3V2Driver } from './g3v2.js';
import { SinowealthKeyboardDriver } from './sinowealth.js';

const DRIVERS = [G3V2Driver, SinowealthKeyboardDriver];

// Recebe todas as interfaces HID de um aparelho físico e devolve o driver certo.
export function createDriver(devices) {
  const { vendorId, productId } = devices[0];
  const D = DRIVERS.find((d) => d.match(vendorId, productId));
  return D ? new D(devices) : new GenericDriver(devices);
}
