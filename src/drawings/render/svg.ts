import { type Drawing, type Item, PEN_DASH, PEN_MM, type Pen, type Tone, drawingBounds } from '../ir';
import type { Sheet } from '../sheets';

export const TONE_FILL: Record<Tone, string> = {
  poche: '#33302c',
  tone: '#d9d4cb',
  light: '#ece8e1',
  glass: '#dfe8ec',
  white: '#ffffff',
  deck: '#f1ebe0',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One drawing as an SVG string, in model feet (y flipped), sized for its plot scale. */
export function drawingSvg(d: Drawing, pad = 2): string {
  const b = drawingBounds(d);
  const vb = { x: b.x0 - pad, y: -(b.y1 + pad), w: b.x1 - b.x0 + 2 * pad, h: b.y1 - b.y0 + 2 * pad };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${(vb.w / d.scale).toFixed(3)}in" height="${(vb.h / d.scale).toFixed(3)}in">${itemsSvg(d.items, d.scale)}</svg>`;
}

/** The items alone, for placing inside a larger SVG (a sheet). */
export function itemsSvg(items: Item[], scale: number): string {
  const w = (mm: number) => ((mm / 25.4) * scale).toFixed(4);
  const dashOf = (pen: Pen) => (PEN_DASH[pen] ? ` stroke-dasharray="${PEN_DASH[pen]!.map(w).join(' ')}"` : '');
  const out: string[] = [];
  // Fills first, then lines, then text, so poché never covers an outline.
  const order = (it: Item) => (it.t === 'fill' ? 0 : it.t === 'text' ? 2 : 1);
  for (const it of [...items].sort((a, b) => order(a) - order(b))) {
    switch (it.t) {
      case 'fill': {
        const dPath = it.rings.map((r) => `M${r.map(([x, y]) => `${x.toFixed(3)},${(-y).toFixed(3)}`).join('L')}Z`).join('');
        out.push(`<path d="${dPath}" fill="${TONE_FILL[it.tone]}" fill-rule="evenodd" stroke="none"/>`);
        break;
      }
      case 'line': {
        const pts = it.pts.map(([x, y]) => `${x.toFixed(3)},${(-y).toFixed(3)}`).join(' ');
        const dash = dashOf(it.pen);
        out.push(`<${it.closed ? 'polygon' : 'polyline'} points="${pts}" fill="none" stroke="#1f1d1a" stroke-width="${w(PEN_MM[it.pen])}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`);
        break;
      }
      case 'circle': {
        const dash = dashOf(it.pen);
        out.push(`<circle cx="${it.c[0].toFixed(3)}" cy="${(-it.c[1]).toFixed(3)}" r="${it.r.toFixed(3)}" fill="${it.fill ? TONE_FILL[it.fill] : 'none'}" stroke="#1f1d1a" stroke-width="${w(PEN_MM[it.pen])}"${dash}/>`);
        break;
      }
      case 'arc': {
        const [cx, cy] = it.c;
        const x0 = cx + it.r * Math.cos(it.a0);
        const y0 = cy + it.r * Math.sin(it.a0);
        const x1 = cx + it.r * Math.cos(it.a1);
        const y1 = cy + it.r * Math.sin(it.a1);
        let span = it.a1 - it.a0;
        while (span <= 0) span += Math.PI * 2;
        const large = span > Math.PI ? 1 : 0;
        // Counter-clockwise in model space is clockwise once y is flipped.
        out.push(`<path d="M${x0.toFixed(3)},${(-y0).toFixed(3)} A${it.r.toFixed(3)},${it.r.toFixed(3)} 0 ${large} 0 ${x1.toFixed(3)},${(-y1).toFixed(3)}" fill="none" stroke="#1f1d1a" stroke-width="${w(PEN_MM[it.pen])}"/>`);
        break;
      }
      case 'text': {
        const anchor = it.align === 'center' ? 'middle' : it.align === 'right' ? 'end' : 'start';
        const family = it.font === 'serif' ? "Georgia, 'Times New Roman', serif" : 'Helvetica, Arial, sans-serif';
        const rot = it.angle ? ` transform="rotate(${-it.angle} ${it.at[0].toFixed(3)} ${(-it.at[1]).toFixed(3)})"` : '';
        out.push(`<text x="${it.at[0].toFixed(3)}" y="${(-it.at[1]).toFixed(3)}" font-size="${it.size.toFixed(3)}" font-family="${family}"${it.bold ? ' font-weight="bold"' : ''} text-anchor="${anchor}" fill="#1f1d1a"${rot}>${esc(it.text)}</text>`);
        break;
      }
    }
  }
  return out.join('');
}

/** A whole sheet in paper inches, images under the line work. */
export function sheetSvg(sh: Sheet): string {
  const imgs = sh.images.map((im) => `<image href="${esc(im.href)}" x="${im.x.toFixed(3)}" y="${(-(im.y + im.h)).toFixed(3)}" width="${im.w.toFixed(3)}" height="${im.h.toFixed(3)}" preserveAspectRatio="none"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-sh.h} ${sh.w} ${sh.h}" width="${sh.w}in" height="${sh.h}in"><rect x="0" y="${-sh.h}" width="${sh.w}" height="${sh.h}" fill="#fff"/>${imgs}${itemsSvg(sh.items, 1)}</svg>`;
}
