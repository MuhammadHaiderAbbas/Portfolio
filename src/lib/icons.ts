// Line icons (24×24, stroke) used for snapshot numbers and "What I do" blocks.
// The admin panel offers these names in a dropdown.
export const icons: Record<string, { label: string; path: string }> = {
  shield: { label: 'Shield', path: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>' },
  lock: { label: 'Lock', path: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' },
  terminal: { label: 'Terminal', path: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>' },
  code: { label: 'Code', path: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>' },
  monitor: { label: 'Screen', path: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>' },
  sliders: { label: 'Sliders', path: '<path d="M6 4v16M12 4v16M18 4v16"/><circle cx="6" cy="9" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="18" cy="8" r="2"/>' },
  award: { label: 'Award', path: '<circle cx="12" cy="9" r="6"/><path d="m8.5 13.8-1.5 7.2 5-2.5 5 2.5-1.5-7.2"/>' },
  cloud: { label: 'Cloud', path: '<path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.5A3.75 3.75 0 0 1 17.25 18H7Z"/>' },
  gamepad: { label: 'Gamepad', path: '<path d="M7 8h10a4 4 0 0 1 3.9 4.9l-1 4.3a2 2 0 0 1-3.4.9L14 16h-4l-2.5 2.1a2 2 0 0 1-3.4-.9l-1-4.3A4 4 0 0 1 7 8Z"/><path d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01"/>' },
  cube: { label: '3D cube', path: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>' },
  film: { label: 'Film', path: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>' },
  cart: { label: 'Cart', path: '<circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/><path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6"/>' },
  brain: { label: 'Brain / AI', path: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1Z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>' },
  chart: { label: 'Chart', path: '<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>' },
  globe: { label: 'Globe', path: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>' },
  rocket: { label: 'Rocket', path: '<path d="M12 15 9 12c1.5-5 4.5-8 10-9-1 5.5-4 8.5-9 10Z"/><path d="M9 12H5l2-4h4M12 15v4l4-2v-4M5 19c0-1.7 1.3-3 3-3"/>' },
};

export function iconSvg(name: string, cls = 'icon'): string {
  const i = icons[name];
  if (!i) return '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i.path}</svg>`;
}
