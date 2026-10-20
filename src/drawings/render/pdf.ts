import { jsPDF } from 'jspdf';
import { type Item, PEN_DASH, PEN_MM } from '../ir';
import type { Sheet } from '../sheets';
import { TONE_FILL } from './svg';

const INK: [number, number, number] = [31, 29, 26];

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** The sheets as a vector PDF (inches, standard Helvetica/Times so it opens anywhere). */
export function sheetsPdf(sheets: Sheet[], meta: { title?: string } = {}): jsPDF {
  const first = sheets[0];
  const doc = new jsPDF({ unit: 'in', format: [first.w, first.h], orientation: 'landscape', compress: true });
  doc.setProperties({ title: meta.title ?? 'Plan set', creator: 'Our Build' });
  doc.setLineJoin('round');
  doc.setLineCap('round');
  sheets.forEach((sh, i) => {
    if (i > 0) doc.addPage([sh.w, sh.h], 'landscape');
    const Y = (y: number) => sh.h - y;
    for (const im of sh.images) {
      const fmt = im.href.startsWith('data:image/jpeg') || im.href.startsWith('data:image/jpg') ? 'JPEG' : 'PNG';
      doc.addImage(im.href, fmt, im.x, Y(im.y + im.h), im.w, im.h, undefined, 'FAST');
    }
    const order = (it: Item) => (it.t === 'fill' ? 0 : it.t === 'text' ? 2 : 1);
    for (const it of [...sh.items].sort((a, b) => order(a) - order(b))) draw(doc, it, Y);
  });
  return doc;
}

function pen(doc: jsPDF, p: keyof typeof PEN_MM) {
  doc.setLineWidth(PEN_MM[p] / 25.4);
  doc.setLineDashPattern((PEN_DASH[p] ?? []).map((mm) => mm / 25.4), 0);
  doc.setDrawColor(...INK);
}

function draw(doc: jsPDF, it: Item, Y: (y: number) => number) {
  switch (it.t) {
    case 'fill': {
      doc.setFillColor(...rgb(TONE_FILL[it.tone]));
      for (const ring of it.rings) {
        if (ring.length < 3) continue;
        doc.moveTo(ring[0][0], Y(ring[0][1]));
        for (let i = 1; i < ring.length; i++) doc.lineTo(ring[i][0], Y(ring[i][1]));
        doc.close();
      }
      doc.fillEvenOdd();
      return;
    }
    case 'line': {
      pen(doc, it.pen);
      doc.moveTo(it.pts[0][0], Y(it.pts[0][1]));
      for (let i = 1; i < it.pts.length; i++) doc.lineTo(it.pts[i][0], Y(it.pts[i][1]));
      if (it.closed) doc.close();
      doc.stroke();
      return;
    }
    case 'circle': {
      pen(doc, it.pen);
      if (it.fill) doc.setFillColor(...rgb(TONE_FILL[it.fill]));
      doc.circle(it.c[0], Y(it.c[1]), it.r, it.fill ? 'FD' : 'S');
      return;
    }
    case 'arc': {
      pen(doc, it.pen);
      // Counter-clockwise from a0 to a1, the way DXF and SVG read it.
      let span = it.a1 - it.a0;
      while (span <= 0) span += Math.PI * 2;
      const n = Math.max(6, Math.ceil(span / (Math.PI / 32)));
      for (let k = 0; k <= n; k++) {
        const a = it.a0 + (span * k) / n;
        const x = it.c[0] + it.r * Math.cos(a);
        const y = Y(it.c[1] + it.r * Math.sin(a));
        if (k === 0) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      }
      doc.stroke();
      return;
    }
    case 'text': {
      doc.setFont(it.font === 'serif' ? 'times' : 'helvetica', it.bold ? 'bold' : 'normal');
      doc.setFontSize(it.size * 72);
      doc.setTextColor(...INK);
      const w = doc.getTextWidth(it.text);
      const shift = it.align === 'center' ? w / 2 : it.align === 'right' ? w : 0;
      const a = ((it.angle ?? 0) * Math.PI) / 180;
      const x = it.at[0] - shift * Math.cos(a);
      const y = it.at[1] - shift * Math.sin(a);
      doc.text(it.text, x, Y(y), it.angle ? { angle: it.angle } : undefined);
      return;
    }
  }
}
