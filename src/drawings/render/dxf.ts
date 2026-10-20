import earcut from 'earcut';
import { type Drawing, type Item, type Layer, drawingBounds } from '../ir';

/**
 * AutoCAD R12 DXF in inches: every drawing laid out full size in model space, AIA layers, dashed
 * lines as a DASHED linetype, poché as SOLID triangles. R12 is the version everything opens.
 */

const LAYER_COLOR: Record<Layer, number> = {
  'A-WALL': 7,
  'A-WALL-PATT': 8,
  'A-DOOR': 3,
  'A-GLAZ': 4,
  'A-FLOR-STRS': 2,
  'A-FLOR-OTLN': 8,
  'A-FURN': 9,
  'A-EQPM': 6,
  'A-ROOF': 5,
  'A-ELEV': 7,
  'A-ELEV-OTLN': 7,
  'A-ELEV-PATT': 8,
  'A-SECT-MCUT': 7,
  'A-ANNO-DIMS': 2,
  'A-ANNO-TEXT': 7,
  'A-AREA-IDEN': 7,
  'A-ANNO-SYMB': 7,
  'A-SITE': 8,
};

export interface Placed {
  drawing: Drawing;
  /** Model-space position (feet) of the drawing's bottom-left corner. */
  x: number;
  y: number;
}

/** Lay drawings out in rows, left to right, with room between them for their titles. */
export function layoutRows(rows: Drawing[][], gap = 20): Placed[] {
  const out: Placed[] = [];
  let y = 0;
  for (const row of rows) {
    let x = 0;
    let rowH = 0;
    for (const d of row) {
      const b = drawingBounds(d);
      out.push({ drawing: d, x, y: y - (b.y1 - b.y0) });
      x += b.x1 - b.x0 + gap;
      rowH = Math.max(rowH, b.y1 - b.y0);
    }
    y -= rowH + gap * 1.5;
  }
  return out;
}

export function drawingsDxf(placed: Placed[]): string {
  const ents: string[] = [];
  let ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const g = (code: number, v: string | number) => `${code}\n${typeof v === 'number' ? fmt(v) : v}\n`;
  for (const { drawing: d, x: px, y: py } of placed) {
    const b = drawingBounds(d);
    // Feet, shifted into place, then inches.
    const X = (x: number) => (x - b.x0 + px) * 12;
    const Y = (y: number) => (y - b.y0 + py) * 12;
    ext = { x0: Math.min(ext.x0, X(b.x0)), y0: Math.min(ext.y0, Y(b.y0)), x1: Math.max(ext.x1, X(b.x1)), y1: Math.max(ext.y1, Y(b.y1)) };
    for (const it of d.items) ents.push(entity(it, X, Y, g));
    // A title under each drawing.
    ents.push(g(0, 'TEXT') + g(8, 'A-ANNO-TEXT') + g(10, X(b.x0)) + g(20, Y(b.y0) - 24) + g(30, 0) + g(40, d.scale * 0.14 * 12 * 0.7) + g(1, ascii(d.title.toUpperCase())));
  }
  if (!Number.isFinite(ext.x0)) ext = { x0: 0, y0: 0, x1: 1, y1: 1 };
  const layers = Object.keys(LAYER_COLOR) as Layer[];
  return [
    g(0, 'SECTION') + g(2, 'HEADER'),
    g(9, '$ACADVER') + g(1, 'AC1009'),
    g(9, '$INSUNITS') + g(70, '1'),
    g(9, '$MEASUREMENT') + g(70, '0'),
    g(9, '$EXTMIN') + g(10, ext.x0) + g(20, ext.y0) + g(30, 0),
    g(9, '$EXTMAX') + g(10, ext.x1) + g(20, ext.y1) + g(30, 0),
    g(9, '$LTSCALE') + g(40, 12),
    g(0, 'ENDSEC'),
    g(0, 'SECTION') + g(2, 'TABLES'),
    g(0, 'TABLE') + g(2, 'LTYPE') + g(70, '3'),
    g(0, 'LTYPE') + g(2, 'CONTINUOUS') + g(70, '0') + g(3, 'Solid line') + g(72, '65') + g(73, '0') + g(40, 0),
    g(0, 'LTYPE') + g(2, 'DASHED') + g(70, '0') + g(3, '__ __ __') + g(72, '65') + g(73, '2') + g(40, 0.375) + g(49, 0.25) + g(49, -0.125),
    g(0, 'LTYPE') + g(2, 'DASHDOT') + g(70, '0') + g(3, '__ . __ .') + g(72, '65') + g(73, '4') + g(40, 0.75) + g(49, 0.5) + g(49, -0.125) + g(49, 0) + g(49, -0.125),
    g(0, 'ENDTAB'),
    g(0, 'TABLE') + g(2, 'LAYER') + g(70, String(layers.length)),
    ...layers.map((l) => g(0, 'LAYER') + g(2, l) + g(70, '0') + g(62, String(LAYER_COLOR[l])) + g(6, 'CONTINUOUS')),
    g(0, 'ENDTAB'),
    g(0, 'TABLE') + g(2, 'STYLE') + g(70, '1'),
    g(0, 'STYLE') + g(2, 'STANDARD') + g(70, '0') + g(40, 0) + g(41, 1) + g(50, 0) + g(71, '0') + g(42, 0.2) + g(3, 'txt') + g(4, ''),
    g(0, 'ENDTAB'),
    g(0, 'ENDSEC'),
    g(0, 'SECTION') + g(2, 'BLOCKS') + g(0, 'ENDSEC'),
    g(0, 'SECTION') + g(2, 'ENTITIES'),
    ...ents,
    g(0, 'ENDSEC'),
    g(0, 'EOF'),
  ].join('');
}

function entity(it: Item, X: (x: number) => number, Y: (y: number) => number, g: (code: number, v: string | number) => string): string {
  switch (it.t) {
    case 'line': {
      const lt = it.pen === 'hidden' ? g(6, 'DASHED') : it.pen === 'cutline' ? g(6, 'DASHDOT') : '';
      if (it.pts.length === 2 && !it.closed) {
        const [[x1, y1], [x2, y2]] = it.pts;
        return g(0, 'LINE') + g(8, it.layer) + lt + g(10, X(x1)) + g(20, Y(y1)) + g(30, 0) + g(11, X(x2)) + g(21, Y(y2)) + g(31, 0);
      }
      let s = g(0, 'POLYLINE') + g(8, it.layer) + lt + g(66, '1') + g(10, 0) + g(20, 0) + g(30, 0) + g(70, it.closed ? '1' : '0');
      for (const [x, y] of it.pts) s += g(0, 'VERTEX') + g(8, it.layer) + g(10, X(x)) + g(20, Y(y)) + g(30, 0);
      return s + g(0, 'SEQEND') + g(8, it.layer);
    }
    case 'circle':
      return g(0, 'CIRCLE') + g(8, it.layer) + g(10, X(it.c[0])) + g(20, Y(it.c[1])) + g(30, 0) + g(40, it.r * 12);
    case 'arc': {
      const deg = (a: number) => (((a * 180) / Math.PI) % 360 + 360) % 360;
      return g(0, 'ARC') + g(8, it.layer) + g(10, X(it.c[0])) + g(20, Y(it.c[1])) + g(30, 0) + g(40, it.r * 12) + g(50, deg(it.a0)) + g(51, deg(it.a1));
    }
    case 'text': {
      // DXF height is cap height; ours is the em size.
      const h = it.size * 12 * 0.7;
      const just = it.align === 'center' ? 1 : it.align === 'right' ? 2 : 0;
      const at = g(10, X(it.at[0])) + g(20, Y(it.at[1])) + g(30, 0);
      const align = just ? g(72, String(just)) + g(11, X(it.at[0])) + g(21, Y(it.at[1])) + g(31, 0) : '';
      return g(0, 'TEXT') + g(8, it.layer) + at + g(40, h) + g(1, ascii(it.text)) + (it.angle ? g(50, it.angle) : '') + align;
    }
    case 'fill': {
      // Only solid poché carries over; tones are a print nicety.
      if (it.tone !== 'poche') return '';
      const flat: number[] = [];
      const holes: number[] = [];
      it.rings.forEach((r, i) => {
        if (i > 0) holes.push(flat.length / 2);
        for (const [x, y] of r) flat.push(X(x), Y(y));
      });
      const tri = earcut(flat, holes.length ? holes : undefined);
      let s = '';
      for (let i = 0; i < tri.length; i += 3) {
        const [a, b, c] = [tri[i], tri[i + 1], tri[i + 2]];
        s += g(0, 'SOLID') + g(8, it.layer) + g(10, flat[a * 2]) + g(20, flat[a * 2 + 1]) + g(30, 0) + g(11, flat[b * 2]) + g(21, flat[b * 2 + 1]) + g(31, 0) + g(12, flat[c * 2]) + g(22, flat[c * 2 + 1]) + g(32, 0) + g(13, flat[c * 2]) + g(23, flat[c * 2 + 1]) + g(33, 0);
      }
      return s;
    }
  }
}

const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0.0' : Number(v.toFixed(4)).toString());

/** R12 text is plain ANSI. */
function ascii(s: string): string {
  return s
    .replace(/×/g, 'x')
    .replace(/[·•]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?');
}
