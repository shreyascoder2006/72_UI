/* Inline SVG icons (stroke = currentColor) for facility kinds and UI controls. */
(function (root) {
  const s = (d, extra = '') => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const FAC = {
    gauge: s('<path d="M8 1.8v5.4"/><path d="M6.4 3.4h3.2M6.4 5.4h3.2"/><path d="M1.8 10.2c1.6 0 1.6-1.2 3.1-1.2s1.6 1.2 3.1 1.2 1.6-1.2 3.1-1.2 1.6 1.2 3.1 1.2"/><path d="M1.8 13.4c1.6 0 1.6-1.2 3.1-1.2s1.6 1.2 3.1 1.2 1.6-1.2 3.1-1.2 1.6 1.2 3.1 1.2"/>'),
    pump: s('<circle cx="8" cy="8" r="5.6"/><path d="M8 8 8 3.4M8 8l4 2.3M8 8l-4 2.3"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/>'),
    signal: s('<rect x="5" y="1.6" width="6" height="12.8" rx="1.6"/><circle cx="8" cy="4.6" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1"/><circle cx="8" cy="11.4" r="1.1"/>'),
    interchange: s('<path d="M2.5 13.5 6 2.5M13.5 13.5 10 2.5"/><path d="M8 4v1.6M8 7.4V9M8 10.8v1.6"/>'),
    power: s('<path d="M9.2 1.6 3.8 9h4l-1 5.4L12.2 7h-4z"/>'),
    hospital: s('<rect x="2" y="2" width="12" height="12" rx="2.4"/><path d="M8 4.8v6.4M4.8 8h6.4"/>'),
    ems: s('<path d="M1.6 11.4V6.6h7.2v4.8M8.8 8h2.9l2.1 2v1.4"/><circle cx="4.4" cy="12" r="1.3"/><circle cx="11.4" cy="12" r="1.3"/><path d="M4.8 7.4v2.4M3.6 8.6H6"/>'),
    telecom: s('<path d="M8 6.2 5.4 14.4M8 6.2l2.6 8.2M6.2 11.6h3.6"/><circle cx="8" cy="5" r="1.2" fill="currentColor"/><path d="M5 2.6a4.2 4.2 0 0 0 0 4.8M11 2.6a4.2 4.2 0 0 1 0 4.8"/>'),
    weather: s('<path d="M4.6 9.6a3 3 0 1 1 .7-5.9 3.6 3.6 0 0 1 6.9 1.3 2.3 2.3 0 0 1-.4 4.6z"/><path d="M5.6 12.2l-.7 1.6M8.6 12.2l-.7 1.6M11.6 12.2l-.7 1.6"/>'),
  };
  function forFacility(f) {
    if (f.type === 'drainage') return f.subtype === 'Pumping station' ? FAC.pump : FAC.gauge;
    if (f.type === 'traffic') return f.subtype === 'Interchange' ? FAC.interchange : FAC.signal;
    if (f.type === 'power') return FAC.power;
    if (f.type === 'hospital') return f.subtype === 'EMS station' ? FAC.ems : FAC.hospital;
    if (f.type === 'telecom') return FAC.telecom;
    return FAC.weather;
  }
  const UI = {
    search: s('<circle cx="7" cy="7" r="4.6"/><path d="m10.4 10.4 3.4 3.4"/>', 'width="14" height="14"'),
    chevron: s('<path d="m4.5 6 3.5 3.5L11.5 6"/>', 'width="12" height="12"'),
    close: s('<path d="m4 4 8 8M12 4l-8 8"/>', 'width="14" height="14"'),
    play: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>',
    pause: '<svg width="14" height="14" viewBox="0 0 16 16"><rect x="3.8" y="2.8" width="3" height="10.4" rx="0.8" fill="currentColor"/><rect x="9.2" y="2.8" width="3" height="10.4" rx="0.8" fill="currentColor"/></svg>',
    bolt: s('<path d="M9.2 1.6 3.8 9h4l-1 5.4L12.2 7h-4z"/>', 'width="13" height="13"'),
    reset: s('<path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8"/><path d="M2.6 2.6v2.8h2.8"/>', 'width="13" height="13"'),
    orbit: s('<ellipse cx="8" cy="8" rx="6.2" ry="2.8"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/>', 'width="13" height="13"'),
    graph: s('<circle cx="3.4" cy="8" r="1.8"/><circle cx="12.6" cy="3.6" r="1.8"/><circle cx="12.6" cy="12.4" r="1.8"/><path d="m5 7.2 5.9-2.8M5 8.8l5.9 2.8"/>', 'width="13" height="13"'),
    plan: s('<path d="M2.6 13.4V7.8M6.2 13.4V4.6M9.8 13.4V9.4M13.4 13.4V2.6"/>', 'width="13" height="13"'),
    check: s('<path d="m3 8.4 3.2 3.2L13 4.8"/>', 'width="13" height="13"'),
    home: s('<path d="M2.4 7.4 8 2.6l5.6 4.8"/><path d="M4 6.2v7.2h8V6.2"/>', 'width="12" height="12"'),
    plus: s('<path d="M8 3v10M3 8h10"/>', 'width="14" height="14"'),
    minus: s('<path d="M3 8h10"/>', 'width="14" height="14"'),
    compass: '<svg width="16" height="16" viewBox="0 0 16 16" class="compass-needle"><path d="M8 1.5 10.2 8H5.8z" fill="#e5484d"/><path d="M8 14.5 5.8 8h4.4z" fill="#a2abb6"/></svg>',
    tilt: s('<path d="M2.5 12.5h11M4.5 12.5 8 3.5l3.5 9"/>', 'width="14" height="14"'),
    menu: s('<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>', 'width="16" height="16"'),
    alert: s('<path d="M8 2.2 14.2 13H1.8z"/><path d="M8 6.4v3M8 11.2v.1"/>', 'width="13" height="13"'),
    siren: s('<path d="M4 12.5V8.4a4 4 0 0 1 8 0v4.1"/><path d="M2.6 12.5h10.8M8 1.5v1.6M2.5 4l1.1 1.1M13.5 4l-1.1 1.1"/>', 'width="13" height="13"'),
    sensor: s('<circle cx="8" cy="8" r="1.6"/><path d="M5 5a4.2 4.2 0 0 0 0 6M11 5a4.2 4.2 0 0 1 0 6M3 3a7 7 0 0 0 0 10M13 3a7 7 0 0 1 0 10"/>', 'width="13" height="13"'),
    report: s('<path d="M2.5 3h11v7.5H7l-3 2.5v-2.5H2.5z"/>', 'width="13" height="13"'),
    forecast: s('<path d="M2 12.5 6 8l2.6 2.6L14 4.6"/><path d="M10.6 4.6H14V8"/>', 'width="13" height="13"'),
  };
  root.TWIN.icons = { FAC, UI, forFacility };
})(typeof window !== 'undefined' ? window : globalThis);
