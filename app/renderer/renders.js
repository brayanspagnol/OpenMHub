// Imagem de reserva para aparelhos sem foto no catálogo: os ícones genéricos de mouse e
// teclado do próprio M HUB (assets/devices/generic, baixados por tools/fetch-device-assets.py).
import { GENERIC } from './data/device-catalog.js';

const img = (kind, style) =>
  `<img class="dev-img ${kind} generic" src="${GENERIC[kind]}" style="${style}" alt="" draggable="false">`;

// Os ícones de linha têm 42 px: ficam pequenos, como o M HUB os usa, em vez de ampliados e borrados.
export const mouseRender = () => img('mouse', 'width:84px');
export const keyboardRender = () => img('keyboard', 'width:84px');
export const receiverRender = (size = 150) => img('receiver', `height:${size}px`);
