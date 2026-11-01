// Square-capped 2px line icons (TPCL is radius 0). Filled glyphs are listed in FILLED.
const P = {
  mic: 'M10 3h4v10h-4z M6 11a6 6 0 0 0 12 0 M12 17v4 M9 21h6',
  check: 'M4 12l5 5L20 6',
  x: 'M5 5l14 14 M19 5L5 19',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h4v16H7z M13 4h4v16h-4z',
  mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
  wallet: 'M3 6h16v14H3z M3 10h18 M16 15h2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  board: 'M3 4h5v16H3z M10 4h5v10h-5z M17 4h4v13h-4z',
  chat: 'M4 4h16v12H9l-5 4z',
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z',
  comment: 'M4 5h16v11h-9l-4 4v-4H4z',
  users: 'M7 7a3 3 0 1 0 .01 0 M2 20c0-4 2.5-6 5-6s5 2 5 6 M16 8a3 3 0 1 0 .01 0 M14 14c4 0 8 1 8 6',
  link: 'M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1 M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1',
  book: 'M4 5h7v14H4z M13 5h7v14h-7z',
  plane: 'M3 13l18-9-6 17-3-7z',
  repeat: 'M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3',
  signal: 'M3 20v-4 M8 20v-8 M13 20v-12 M18 20V4',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4',
  sliders: 'M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 5v4 M6 15v4',
  home: 'M3 11l9-7 9 7 M5 10v10h14V10',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  right: 'M9 5l7 7-7 7',
  left: 'M15 5l-7 7 7 7',
  down: 'M5 9l7 7 7-7',
  search: 'M11 4a7 7 0 1 0 .01 0 M20 20l-4-4',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
  warn: 'M12 3l10 18H2z M12 10v5 M12 18h.01',
  alert: 'M12 3l10 18H2z M12 9v6 M12 18h.01',
  off: 'M3 3l18 18 M8 8a5 5 0 0 0-1 9h10 M16 12a4 4 0 0 0-4-3',
  car: 'M3 13l2-6h14l2 6v5h-3v-2H6v2H3z M3 13h18 M7 15h.01 M17 15h.01',
  grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
  up: 'M5 15l7-7 7 7',
  external: 'M7 17L17 7 M8 7h9v9',
  clock: 'M12 3a9 9 0 1 0 .01 0 M12 7v5l3 2',
  skip: 'M5 4l10 8-10 8z M17 4v16',
  back: 'M19 4L9 12l10 8z M7 4v16',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 .01 0',
  flag: 'M5 21V4 M5 4h13l-2 4 2 4H5',
  pin: 'M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z M12 7a3 3 0 1 0 .01 0',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  sun: 'M12 8a4 4 0 1 0 .01 0 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z',
  type: 'M4 6V4h16v2 M12 4v16 M9 20h6',
} as const;

export type IconName = keyof typeof P;
const FILLED = new Set<IconName>(['play', 'pause', 'skip', 'back']);

export function Icon({ name, size = 20, label, strokeWidth = 2 }: { name: IconName; size?: number; label?: string; strokeWidth?: number }) {
  const filled = FILLED.has(name);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {P[name].split(' M').map((seg, i) => (
        <path key={i} d={i === 0 ? seg : `M${seg}`} />
      ))}
    </svg>
  );
}
