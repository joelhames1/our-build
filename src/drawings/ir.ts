/**
 * The drawing intermediate representation: what every sheet, the PDF and the DXF are made of.
 * Coordinates are model feet with y up. A drawing is built for the scale it will be plotted at,
 * so text heights and tick sizes are in model feet that come out the right size on paper.
 */

/** Line weights, thick to thin. Cut lines outline what the plan or section slices through. */
export type Pen = 'cut' | 'profile' | 'medium' | 'fine' | 'hidden' | 'dim' | 'cutline';

/** Pen widths on paper, in millimetres. */
export const PEN_MM: Record<Pen, number> = { cut: 0.5, profile: 0.35, medium: 0.25, fine: 0.13, hidden: 0.13, dim: 0.13, cutline: 0.35 };

/** Dash patterns on paper, in millimetres (solid when absent). */
export const PEN_DASH: Partial<Record<Pen, number[]>> = { hidden: [2, 1.2], cutline: [8, 1.5, 1.5, 1.5] };

/** AIA-style CAD layers. */
export type Layer =
  | 'A-WALL'
  | 'A-WALL-PATT'
  | 'A-DOOR'
  | 'A-GLAZ'
  | 'A-FLOR-STRS'
  | 'A-FLOR-OTLN'
  | 'A-FURN'
  | 'A-EQPM'
  | 'A-ROOF'
  | 'A-ELEV'
  | 'A-ELEV-OTLN'
  | 'A-ELEV-PATT'
  | 'A-SECT-MCUT'
  | 'A-ANNO-DIMS'
  | 'A-ANNO-TEXT'
  | 'A-AREA-IDEN'
  | 'A-ANNO-SYMB'
  | 'A-SITE';

export type Tone = 'poche' | 'tone' | 'light' | 'glass' | 'white' | 'deck';

export type Item =
  | { t: 'line'; pts: [number, number][]; closed?: boolean; pen: Pen; layer: Layer }
  | { t: 'fill'; rings: [number, number][][]; tone: Tone; layer: Layer }
  | { t: 'circle'; c: [number, number]; r: number; pen: Pen; layer: Layer; fill?: Tone }
  | { t: 'arc'; c: [number, number]; r: number; a0: number; a1: number; pen: Pen; layer: Layer }
  | { t: 'text'; at: [number, number]; text: string; size: number; layer: Layer; align?: 'left' | 'center' | 'right'; font?: 'serif' | 'sans'; bold?: boolean; angle?: number };

export interface Drawing {
  id: string;
  title: string;
  /** Feet of model per inch of paper (4 = 1/4" = 1'-0"). */
  scale: number;
  items: Item[];
}

/** Collects items for a drawing, with sizes given in paper inches where that's what matters. */
export class Pad {
  readonly items: Item[] = [];
  constructor(readonly scale: number) {}

  /** Paper inches to model feet at this drawing's scale. */
  p(inches: number) {
    return inches * this.scale;
  }
  line(pts: [number, number][], pen: Pen, layer: Layer, closed = false) {
    if (pts.length >= 2) this.items.push({ t: 'line', pts, pen, layer, closed });
  }
  seg(a: [number, number], b: [number, number], pen: Pen, layer: Layer) {
    this.line([a, b], pen, layer);
  }
  rect(x0: number, y0: number, x1: number, y1: number, pen: Pen, layer: Layer) {
    this.line(
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      pen,
      layer,
      true,
    );
  }
  fill(rings: [number, number][][], tone: Tone, layer: Layer) {
    if (rings.length && rings[0].length >= 3) this.items.push({ t: 'fill', rings, tone, layer });
  }
  circle(c: [number, number], r: number, pen: Pen, layer: Layer, fill?: Tone) {
    this.items.push({ t: 'circle', c, r, pen, layer, fill });
  }
  arc(c: [number, number], r: number, a0: number, a1: number, pen: Pen, layer: Layer) {
    this.items.push({ t: 'arc', c, r, a0, a1, pen, layer });
  }
  /** Text sized in paper inches (1/8" ≈ 9pt is standard annotation). */
  text(at: [number, number], text: string, sizeIn: number, layer: Layer, opts: { align?: 'left' | 'center' | 'right'; font?: 'serif' | 'sans'; bold?: boolean; angle?: number } = {}) {
    this.items.push({ t: 'text', at, text, size: this.p(sizeIn), layer, ...opts });
  }
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Extents of everything in a drawing (text approximated by its anchor and length). */
export function drawingBounds(d: Drawing): Bounds {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const add = (x: number, y: number) => {
    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x);
    b.y1 = Math.max(b.y1, y);
  };
  for (const it of d.items) {
    if (it.t === 'line') it.pts.forEach(([x, y]) => add(x, y));
    else if (it.t === 'fill') it.rings.forEach((r) => r.forEach(([x, y]) => add(x, y)));
    else if (it.t === 'circle' || it.t === 'arc') {
      add(it.c[0] - it.r, it.c[1] - it.r);
      add(it.c[0] + it.r, it.c[1] + it.r);
    } else {
      const w = it.text.length * it.size * 0.55;
      const x0 = it.align === 'center' ? it.at[0] - w / 2 : it.align === 'right' ? it.at[0] - w : it.at[0];
      if (!it.angle) {
        add(x0, it.at[1]);
        add(x0 + w, it.at[1] + it.size);
      } else add(it.at[0], it.at[1]);
    }
  }
  if (!Number.isFinite(b.x0)) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return b;
}

/** Standard architectural scales, largest first: [feet per inch, label]. */
export const SCALES: [number, string][] = [
  [2, '1/2" = 1\'-0"'],
  [8 / 3, '3/8" = 1\'-0"'],
  [4, '1/4" = 1\'-0"'],
  [16 / 3, '3/16" = 1\'-0"'],
  [8, '1/8" = 1\'-0"'],
  [32 / 3, '3/32" = 1\'-0"'],
  [16, '1/16" = 1\'-0"'],
];

export const scaleLabel = (s: number) => SCALES.find(([v]) => Math.abs(v - s) < 1e-6)?.[1] ?? `1" = ${s.toFixed(1)}'`;
