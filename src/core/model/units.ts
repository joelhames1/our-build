/** Snap to the room grid (6"). */
export const GRID = 0.5;
export const EPS = 1e-6;

export const snap = (v: number, step = GRID) => Math.round(v / step) * step;
export const snapInch = (v: number) => Math.round(v * 12) / 12;
export const round2 = (v: number) => Math.round(v * 100) / 100;
export const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) <= eps;

/** 12.5 -> 12'-6"; 0.25 -> 3"; 10 -> 10'-0" */
export function ftIn(feet: number, opts: { inchesOnlyBelow?: number } = {}): string {
  const sign = feet < 0 ? '-' : '';
  let total = Math.round(Math.abs(feet) * 12 * 4) / 4; // nearest 1/4"
  const f = Math.floor(total / 12);
  total -= f * 12;
  const inches = formatInches(total);
  if (f === 0 && (opts.inchesOnlyBelow ?? 1) > 0) return `${sign}${inches}"`;
  return `${sign}${f}'-${inches}"`;
}

function formatInches(i: number): string {
  const whole = Math.floor(i);
  const frac = i - whole;
  const fracs: Record<string, string> = { '0.25': ' 1/4', '0.5': ' 1/2', '0.75': ' 3/4' };
  return `${whole}${fracs[frac.toString()] ?? ''}`;
}

/** 12 x 14.5 -> 12'-0" × 14'-6" */
export const dims = (w: number, d: number) => `${ftIn(w)} × ${ftIn(d)}`;

export const sf = (area: number) => `${Math.round(area).toLocaleString('en-US')} sf`;

/** Compact feet for AI-facing text: 12, 12.5, 13.42 */
export const ft = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};
