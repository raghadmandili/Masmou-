// Small inline SVG icon set (stroke icons, colored by CSS currentColor).
const svg = body => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const ICON = {
  play: svg('<polygon points="7 4 19 12 7 20 7 4"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  retry: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  watch: svg('<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>'),
  video: svg('<rect x="2" y="5" width="14" height="14" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>'),
  close: svg('<path d="M18 6 6 18"/><path d="M6 6l12 12"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  sound: svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
  next: svg('<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>'),
  check: svg('<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>'),
  alert: svg('<circle cx="12" cy="12" r="10"/><path d="M12 7v6"/><path d="M12 17h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-5"/><path d="M12 8h.01"/>'),
  camera: svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  chevR: svg('<path d="M9 18l6-6-6-6"/>'),
  chevL: svg('<path d="M15 18l-6-6 6-6"/>'),
  book: svg('<path d="M2 5c3-1.5 7-1.5 10 1 3-2.5 7-2.5 10-1v14c-3-1.5-7-1.5-10 1-3-2.5-7-2.5-10-1z"/><path d="M12 6v14"/>'),
  hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5v-8a1.5 1.5 0 0 1 3 0V12"/><path d="M14 11.5V5a1.5 1.5 0 0 1 3 0v8"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.5a7 7 0 0 1-5.6-2.8L3.2 15.6a1.6 1.6 0 0 1 2.5-2L8 16"/>'),
  chart: svg('<path d="M3 21h18"/><path d="M6 17v-5"/><path d="M11 17V7"/><path d="M16 17v-8"/><path d="M21 17V4"/>'),
  lock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
};

/** Fills every element that has data-i="name" with that icon. */
export function paintIcons(root = document) {
  root.querySelectorAll('[data-i]').forEach(el => { el.outerHTML = ICON[el.dataset.i] || ''; });
}
