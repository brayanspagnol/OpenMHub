// Ícones em traço fino (1.5px), no estilo do iconfont do M HUB.
const P = {
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
  gear: '<path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z"/><circle cx="12" cy="12" r="3.2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  min: '<path d="M5 12h14"/>',
  max: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M10 20v-5h4v5"/>',
  devices: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M6 10h1M9 10h1M12 10h1M6 13h7"/><rect x="17" y="8" width="4" height="8" rx="2"/>',
  settings2: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  keymap: '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12M9 4.5l10.5 10.5"/>',
  dpi: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M12 9l2 3-2 3-2-3z"/>',
  perf: '<path d="M6 4v16M12 4v16M18 4v16"/><path d="M4 9h4M10 15h4M16 7h4"/>',
  others: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
  light: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  wired: '<path d="M7 4h10v7H7z"/><path d="M9 4v3M15 4v3"/><path d="M5 11h14v3a4 4 0 0 1-4 4h-6a4 4 0 0 1-4-4z"/><path d="M12 18v3"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.2a9.5 9.5 0 0 1 13 0"/><path d="M8.6 15.4a5 5 0 0 1 6.8 0"/><circle cx="12" cy="18.6" r=".9" fill="currentColor"/>',
  bluetooth: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  list: '<rect x="4" y="5" width="16" height="5.5" rx="1.5"/><rect x="4" y="13.5" width="16" height="5.5" rx="1.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  upgrade: '<circle cx="12" cy="12" r="9"/><path d="M12 16.5v-9M8.5 11 12 7.5l3.5 3.5"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  offline: '<path d="M2.5 9a14 14 0 0 1 5-3M11 4.1a14 14 0 0 1 10.5 4.9"/><path d="M8.6 15.4a5 5 0 0 1 6.8 0"/><path d="M3 3l18 18"/>',
};

export function icon(name) {
  return `<svg class="i" viewBox="0 0 24 24">${P[name] || ''}</svg>`;
}

// Bateria desenhada com o nível real preenchido.
// Bateria em pé, como no M HUB atual, com o nível real preenchido de baixo para cima.
export function batteryIcon(pct, charging) {
  const h = Math.max(0, Math.min(100, pct ?? 0)) / 100 * 13;
  const fill = charging
    ? '<path d="M12.8 9 10.4 12.6h3.2L11.2 16.2" stroke-width="1.5"/>'
    : `<rect x="9" y="${(19 - h).toFixed(1)}" width="6" height="${h.toFixed(1)}" rx=".6" fill="currentColor" stroke="none"/>`;
  return `<svg class="i" viewBox="0 0 24 24"><rect x="7" y="4.5" width="10" height="16.5" rx="1.8"/><path d="M10 2.5h4"/>${fill}</svg>`;
}

