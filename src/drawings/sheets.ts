import type { Box } from '@/core/geometry/polygon';
import type { Side } from '@/core/model/schema';
import type { Resolved } from '@/core/resolve';
import { axonometric, elevation } from './elevation';
import { type ExteriorScene, exteriorScene } from './exterior';
import { type Drawing, type Item, Pad, SCALES, drawingBounds, scaleLabel } from './ir';
import { floorPlan } from './plan';
import { roofPlan } from './roofPlan';
import { areaTable, doorSchedule, openingMarks, programLine, roomSchedule, type Table, windowSchedule } from './schedules';
import { type SectionCut, chooseCut, section } from './section';

/**
 * The plan set: titled sheets in paper inches (y up from the bottom-left corner). Each drawing is
 * built at the largest standard scale that fits its slot, placed, and captioned; every sheet gets
 * the title block with the "conceptual design, not for construction" stamp.
 */
export type Paper = 'tabloid' | 'archd';

export interface SheetImage {
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Sheet {
  number: string;
  title: string;
  w: number;
  h: number;
  items: Item[];
  images: SheetImage[];
}

export interface SheetOptions {
  paper: Paper;
  /** A rendered view of the model for the cover, with its pixel size. */
  snapshot?: { href: string; w: number; h: number } | null;
  date?: Date;
}

interface Frame {
  W: number;
  H: number;
  /** Text and symbol size factor (bigger paper, bigger type). */
  k: number;
  border: Box;
  tb: Box;
  area: Box;
}

function frame(paper: Paper): Frame {
  if (paper === 'archd') {
    const border = { x0: 1, y0: 0.5, x1: 35.5, y1: 23.5 };
    const tb = { x0: border.x1 - 3.4, y0: border.y0, x1: border.x1, y1: border.y1 };
    return { W: 36, H: 24, k: 1.4, border, tb, area: { x0: border.x0 + 0.4, y0: border.y0 + 0.4, x1: tb.x0 - 0.4, y1: border.y1 - 0.4 } };
  }
  const border = { x0: 0.6, y0: 0.35, x1: 16.65, y1: 10.65 };
  const tb = { x0: border.x1 - 2.3, y0: border.y0, x1: border.x1, y1: border.y1 };
  return { W: 17, H: 11, k: 1, border, tb, area: { x0: border.x0 + 0.25, y0: border.y0 + 0.25, x1: tb.x0 - 0.25, y1: border.y1 - 0.25 } };
}

const SIDES: Side[] = ['S', 'E', 'N', 'W'];

export function buildSheets(res: Resolved, opts: SheetOptions): Sheet[] {
  const f = frame(opts.paper);
  const marks = openingMarks(res);
  const scales = SCALES.map(([s]) => s).filter((s) => (opts.paper === 'archd' ? s >= 2 : s >= 4));
  const scenes = new Map<number, ExteriorScene>();
  const sceneFor = (s: number) => {
    const key = Math.max(1, s / 4);
    if (!scenes.has(key)) scenes.set(key, exteriorScene(res, { scale: s }));
    return scenes.get(key)!;
  };
  const sheets: Sheet[] = [];

  // Sections first: the plans need to know which sheet each one lands on.
  const cutA = chooseCut(res);
  const cutB = chooseCut(res, true);
  const cuts: { cut: SectionCut; label: string }[] = [
    { cut: cutA, label: 'A' },
    { cut: cutB, label: 'B' },
  ];
  const sections = choosePaging(f, cuts.length, (s) => cuts.map((c) => ({ ...section(res, c.cut, s), title: `Section ${c.label}` })), scales);
  const sectionSheet = new Map<string, string>();
  sections.pages.forEach((page, i) => page.forEach((idx) => sectionSheet.set(cuts[idx].label, `A3.${i + 1}`)));

  // Floor plans, one level per sheet, all at the same scale.
  const planCuts = cuts.map((c) => ({ cut: c.cut, label: c.label, sheet: sectionSheet.get(c.label)! }));
  const plans = fitAll(f, (s) => res.levels.map((rl) => floorPlan(res, rl.index, s, { marks, cuts: planCuts })), scales);
  plans.drawings.forEach((d, i) => {
    const sheet = blank(f, `A1.${i + 1}`, d.title);
    placeGrid(sheet, f, [d], 1, 1);
    sheets.push(sheet);
  });
  const roof = fitAll(f, (s) => [roofPlan(res, s)], scales);
  const roofSheet = blank(f, `A1.${res.levels.length + 1}`, 'Roof Plan');
  placeGrid(roofSheet, f, roof.drawings, 1, 1);
  sheets.push(roofSheet);

  // Elevations: as many to a sheet as keeps them large.
  sheets.push(...pagesOf(f, 'A2', 'Elevations', choosePaging(f, SIDES.length, (s) => SIDES.map((side) => elevation(res, side, s, sceneFor(s))), scales)));
  sheets.push(...pagesOf(f, 'A3', 'Building Sections', sections));

  // Schedules.
  sheets.push(...scheduleSheets(f, [doorSchedule(res, marks), windowSchedule(res, marks), roomSchedule(res)]));

  // The cover, then title blocks now that the count is known.
  const cover = coverSheet(res, f, opts, sheets, sceneFor(8));
  const all = [cover, ...sheets];
  all.forEach((sh, i) => titleBlock(sh, f, res, opts, i + 1, all.length));
  return all;
}

// --- layout -------------------------------------------------------------------------------------

function blank(f: Frame, number: string, title: string): Sheet {
  return { number, title, w: f.W, h: f.H, items: [], images: [] };
}

const titleH = (f: Frame) => 0.62 * f.k;

/** Paper size of a drawing (bounds over scale). */
function paperSize(d: Drawing) {
  const b = drawingBounds(d);
  return { w: (b.x1 - b.x0) / d.scale, h: (b.y1 - b.y0) / d.scale };
}

const fits = (d: Drawing, slot: { w: number; h: number }, f: Frame) => {
  const s = paperSize(d);
  return s.w <= slot.w && s.h + titleH(f) <= slot.h;
};

/** Build at the largest scale where every drawing fits a slot of a cols×rows grid. */
function fitAll(f: Frame, build: (s: number) => Drawing[], scales: number[], grid: [number, number] = [1, 1], cache = new Map<number, Drawing[]>()) {
  const [cols, rows] = grid;
  const slot = { w: (f.area.x1 - f.area.x0) / cols, h: (f.area.y1 - f.area.y0) / rows };
  let last: Drawing[] = [];
  for (const s of scales) {
    if (!cache.has(s)) cache.set(s, build(s));
    last = cache.get(s)!;
    if (last.every((d) => fits(d, slot, f))) return { scale: s, drawings: last, ok: true };
  }
  return { scale: scales[scales.length - 1], drawings: last, ok: false };
}

/** The grid that gives the biggest drawings (fewest sheets on a tie), and the drawing indices on each page. */
function choosePaging(f: Frame, n: number, build: (s: number) => Drawing[], scales: number[]) {
  const cache = new Map<number, Drawing[]>();
  const options: { grid: [number, number]; per: number }[] = [{ grid: [1, 1], per: 1 }];
  if (n >= 2) options.push({ grid: [1, 2], per: 2 }, { grid: [2, 1], per: 2 });
  if (n >= 3) options.push({ grid: [2, 2], per: 4 });
  // Bigger drawings win, but one step down the scale ladder is worth it to halve the sheet count.
  const step = (s: number) => SCALES.findIndex(([v]) => Math.abs(v - s) < 1e-9);
  let best: { scale: number; per: number; grid: [number, number]; drawings: Drawing[] } | null = null;
  for (const o of options) {
    const r = fitAll(f, build, scales, o.grid, cache);
    const cand = { scale: r.scale, per: o.per, grid: o.grid, drawings: r.drawings };
    if (!best) best = cand;
    else if (o.per > best.per ? step(r.scale) - step(best.scale) <= 1 : step(r.scale) < step(best.scale)) best = cand;
  }
  const pages: number[][] = [];
  for (let i = 0; i < n; i += best!.per) pages.push(Array.from({ length: Math.min(best!.per, n - i) }, (_, k) => i + k));
  return { pages, grid: best!.grid, drawings: best!.drawings };
}

function pagesOf(f: Frame, prefix: string, title: string, { pages, grid, drawings }: ReturnType<typeof choosePaging>): Sheet[] {
  return pages.map((idx, i) => {
    const sheet = blank(f, `${prefix}.${i + 1}`, pages.length > 1 ? `${title} ${i + 1}` : title);
    placeGrid(sheet, f, idx.map((j) => drawings[j]), grid[0], grid[1]);
    return sheet;
  });
}

/** Center each drawing in its grid slot (left to right, top to bottom) with a caption under it. */
function placeGrid(sheet: Sheet, f: Frame, drawings: Drawing[], cols: number, rows: number) {
  const sw = (f.area.x1 - f.area.x0) / cols;
  const sh = (f.area.y1 - f.area.y0) / rows;
  drawings.forEach((d, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const slot = { x0: f.area.x0 + c * sw, y1: f.area.y1 - r * sh, w: sw, h: sh };
    const size = paperSize(d);
    const x = slot.x0 + (slot.w - size.w) / 2;
    const free = slot.h - titleH(f);
    const y = slot.y1 - free + (free - size.h) / 2;
    const at = { x, y: Math.max(y, slot.y1 - slot.h + titleH(f)) };
    place(sheet.items, d, at.x, at.y);
    caption(sheet.items, f, at.x, at.y, String(i + 1), d.title, scaleLabel(d.scale));
  });
}

/** Copy a drawing's items onto the sheet with its bottom-left corner at (px, py). */
export function place(out: Item[], d: Drawing, px: number, py: number, scale = d.scale) {
  const b = drawingBounds(d);
  const X = (x: number) => (x - b.x0) / scale + px;
  const Y = (y: number) => (y - b.y0) / scale + py;
  const P = ([x, y]: [number, number]): [number, number] => [X(x), Y(y)];
  for (const it of d.items) {
    switch (it.t) {
      case 'line':
        out.push({ ...it, pts: it.pts.map(P) });
        break;
      case 'fill':
        out.push({ ...it, rings: it.rings.map((r) => r.map(P)) });
        break;
      case 'circle':
        out.push({ ...it, c: P(it.c), r: it.r / scale });
        break;
      case 'arc':
        out.push({ ...it, c: P(it.c), r: it.r / scale });
        break;
      case 'text':
        out.push({ ...it, at: P(it.at), size: it.size / scale });
        break;
    }
  }
}

function caption(out: Item[], f: Frame, x: number, y: number, num: string, title: string, scale: string) {
  const pad = new Pad(1);
  const k = f.k;
  const cy = y - 0.33 * k;
  const r = 0.17 * k;
  pad.circle([x + r, cy], r, 'medium', 'A-ANNO-SYMB');
  pad.text([x + r, cy - 0.045 * k], num, 0.12 * k, 'A-ANNO-SYMB', { align: 'center', font: 'sans', bold: true });
  const t = title.toUpperCase();
  const tw = textWidth(t, 0.14 * k, 'serif');
  pad.text([x + 2 * r + 0.12 * k, cy + 0.03 * k], t, 0.14 * k, 'A-ANNO-TEXT', { font: 'serif' });
  pad.seg([x + 2 * r, cy], [x + 2 * r + 0.24 * k + Math.max(tw, 1.6 * k), cy], 'medium', 'A-ANNO-SYMB');
  pad.text([x + 2 * r + 0.12 * k, cy - 0.13 * k], `SCALE: ${scale}`, 0.075 * k, 'A-ANNO-TEXT', { font: 'sans' });
  out.push(...pad.items);
}

// --- text ---------------------------------------------------------------------------------------

/** Rough width of a string in paper inches (Helvetica/Times averages). */
export function textWidth(s: string, size: number, font: 'serif' | 'sans' = 'sans', bold = false) {
  let w = 0;
  for (const ch of s) w += ch === ' ' ? 0.28 : /[A-Z0-9]/.test(ch) ? 0.66 : /[il.,'|:]/.test(ch) ? 0.26 : /[mwMW]/.test(ch) ? 0.85 : 0.52;
  return w * size * (font === 'serif' ? 0.94 : 1) * (bold ? 1.06 : 1);
}

export function wrap(s: string, size: number, maxW: number, font: 'serif' | 'sans' = 'sans', bold = false): string[] {
  const lines: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, font, bold) > maxW) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

// --- title block ----------------------------------------------------------------------------------

function titleBlock(sheet: Sheet, f: Frame, res: Resolved, opts: SheetOptions, index: number, count: number) {
  const pad = new Pad(1);
  const k = f.k;
  const { tb, border } = f;
  pad.rect(border.x0, border.y0, border.x1, border.y1, 'profile', 'A-ANNO-SYMB');
  pad.seg([tb.x0, tb.y0], [tb.x0, tb.y1], 'profile', 'A-ANNO-SYMB');
  const x = tb.x0 + 0.16 * k;
  const w = tb.x1 - tb.x0 - 0.32 * k;
  const rule = (y: number) => pad.seg([tb.x0, y], [tb.x1, y], 'fine', 'A-ANNO-SYMB');
  const label = (y: number, s: string) => pad.text([x, y], s, 0.06 * k, 'A-ANNO-TEXT', { font: 'sans', bold: true });
  let y = tb.y1 - 0.32 * k;
  pad.text([x, y], 'OUR BUILD', 0.13 * k, 'A-ANNO-TEXT', { font: 'sans', bold: true });
  y -= 0.17 * k;
  pad.text([x, y], 'Conceptual design drawings', 0.075 * k, 'A-ANNO-TEXT', { font: 'sans' });
  y -= 0.2 * k;
  rule(y);
  y -= 0.22 * k;
  label(y, 'PROJECT');
  y -= 0.08 * k;
  for (const line of wrap(res.project.name, 0.19 * k, w, 'serif').slice(0, 3)) {
    y -= 0.24 * k;
    pad.text([x, y], line, 0.19 * k, 'A-ANNO-TEXT', { font: 'serif' });
  }
  y -= 0.06 * k;
  for (const line of wrap(programLine(res), 0.075 * k, w)) {
    y -= 0.14 * k;
    pad.text([x, y], line, 0.075 * k, 'A-ANNO-TEXT', { font: 'sans' });
  }
  const site = res.project.site;
  const setting = `${site.setting[0].toUpperCase()}${site.setting.slice(1)} site, front faces ${({ N: 'north', S: 'south', E: 'east', W: 'west' } as const)[site.front]}`;
  for (const line of wrap(setting, 0.075 * k, w)) {
    y -= 0.14 * k;
    pad.text([x, y], line, 0.075 * k, 'A-ANNO-TEXT', { font: 'sans' });
  }
  y -= 0.22 * k;
  rule(y);
  y -= 0.22 * k;
  label(y, 'DATE');
  y -= 0.18 * k;
  const date = (opts.date ?? new Date()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  pad.text([x, y], date, 0.09 * k, 'A-ANNO-TEXT', { font: 'sans' });
  y -= 0.2 * k;
  rule(y);

  // The stamp.
  y -= 0.25 * k;
  const stampTop = y;
  const lines = wrap('Have a licensed architect or engineer review these drawings before building anything.', 0.065 * k, w - 0.2 * k);
  const stampH = (0.5 + lines.length * 0.11) * k;
  pad.rect(x, stampTop - stampH, x + w, stampTop, 'medium', 'A-ANNO-SYMB');
  let sy = stampTop - 0.2 * k;
  pad.text([x + w / 2, sy], 'CONCEPTUAL DESIGN', 0.085 * k, 'A-ANNO-TEXT', { font: 'sans', bold: true, align: 'center' });
  sy -= 0.14 * k;
  pad.text([x + w / 2, sy], 'NOT FOR CONSTRUCTION', 0.085 * k, 'A-ANNO-TEXT', { font: 'sans', bold: true, align: 'center' });
  sy -= 0.06 * k;
  for (const line of lines) {
    sy -= 0.11 * k;
    pad.text([x + w / 2, sy], line, 0.065 * k, 'A-ANNO-TEXT', { font: 'sans', align: 'center' });
  }

  // Sheet title and number at the bottom.
  let by = tb.y0 + 0.2 * k;
  pad.text([x, by], `Sheet ${index} of ${count}`, 0.075 * k, 'A-ANNO-TEXT', { font: 'sans' });
  by += 0.18 * k;
  pad.text([x, by], sheet.number, 0.42 * k, 'A-ANNO-TEXT', { font: 'sans', bold: true });
  by += 0.52 * k;
  label(by, 'SHEET');
  by += 0.14 * k;
  rule(by);
  const tl = wrap(sheet.title.toUpperCase(), 0.15 * k, w, 'serif');
  by += 0.16 * k;
  for (const line of [...tl].reverse()) {
    pad.text([x, by], line, 0.15 * k, 'A-ANNO-TEXT', { font: 'serif' });
    by += 0.2 * k;
  }
  label(by, 'SHEET TITLE');
  by += 0.14 * k;
  rule(by);
  sheet.items.push(...pad.items);
}

// --- schedules ----------------------------------------------------------------------------------

/** Tables flowed into columns, continuing onto further sheets as needed. */
function scheduleSheets(f: Frame, tables: Table[]): Sheet[] {
  const k = f.k;
  const rowH = 0.2 * k;
  const headH = 0.28 * k;
  const titleGap = 0.42 * k;
  const gap = 0.45 * k;
  const sheets: Sheet[] = [];
  let sheet = blank(f, 'A4.1', 'Schedules');
  sheets.push(sheet);
  let colX = f.area.x0;
  let y = f.area.y1;
  let colW = 0;
  const newColumn = (need: number) => {
    colX += colW + gap;
    colW = 0;
    y = f.area.y1;
    if (colX + need > f.area.x1) {
      sheet = blank(f, `A4.${sheets.length + 1}`, 'Schedules');
      sheets.push(sheet);
      colX = f.area.x0;
    }
  };
  for (const t of tables) {
    const width = t.columns.reduce((s, c) => s + c.width, 0) * k;
    let rows = t.rows;
    let cont = false;
    if (!rows.length) continue;
    while (rows.length) {
      if (y - titleGap - headH - 2 * rowH < f.area.y0) newColumn(width);
      const room = Math.max(1, Math.floor((y - titleGap - headH - f.area.y0) / rowH));
      const chunk = rows.slice(0, room);
      rows = rows.slice(room);
      const h = drawTable(sheet.items, { ...t, title: cont ? `${t.title} (continued)` : t.title, rows: chunk, totals: rows.length ? 0 : t.totals }, colX, y, k);
      colW = Math.max(colW, width);
      y -= h + gap;
      cont = true;
      if (rows.length) newColumn(width);
    }
  }
  return sheets;
}

/** Draws a table with its top-left at (x, y); returns its height. */
export function drawTable(out: Item[], t: Table, x: number, y: number, k: number): number {
  const pad = new Pad(1);
  const rowH = 0.2 * k;
  const headH = 0.28 * k;
  const size = 0.08 * k;
  const width = t.columns.reduce((s, c) => s + c.width, 0) * k;
  pad.text([x, y - 0.2 * k], t.title.toUpperCase(), 0.13 * k, 'A-ANNO-TEXT', { font: 'serif' });
  let top = y - 0.42 * k + 0.14 * k;
  top -= 0.14 * k;
  pad.seg([x, top], [x + width, top], 'medium', 'A-ANNO-SYMB');
  let cx = x;
  for (const c of t.columns) {
    const w = c.width * k;
    const tx = c.align === 'center' ? cx + w / 2 : c.align === 'right' ? cx + w - 0.06 * k : cx + 0.06 * k;
    pad.text([tx, top - headH + 0.09 * k], c.label, 0.065 * k, 'A-ANNO-TEXT', { font: 'sans', bold: true, align: c.align ?? 'left' });
    cx += w;
  }
  let ry = top - headH;
  pad.seg([x, ry], [x + width, ry], 'medium', 'A-ANNO-SYMB');
  t.rows.forEach((row, i) => {
    const total = t.totals && i >= t.rows.length - t.totals;
    if (total) pad.seg([x, ry], [x + width, ry], 'medium', 'A-ANNO-SYMB');
    let cx2 = x;
    t.columns.forEach((c, j) => {
      const w = c.width * k;
      let s = row[j] ?? '';
      while (s.length > 1 && textWidth(s, size, 'sans', !!total) > w - 0.1 * k) s = `${s.slice(0, -2)}…`;
      const tx = c.align === 'center' ? cx2 + w / 2 : c.align === 'right' ? cx2 + w - 0.06 * k : cx2 + 0.06 * k;
      pad.text([tx, ry - rowH + 0.06 * k], s, size, 'A-ANNO-TEXT', { font: 'sans', align: c.align ?? 'left', bold: !!total });
      cx2 += w;
    });
    ry -= rowH;
    pad.seg([x, ry], [x + width, ry], i === t.rows.length - 1 ? 'medium' : 'dim', 'A-ANNO-SYMB');
  });
  // Column rules.
  let vx = x;
  for (const c of t.columns.slice(0, -1)) {
    vx += c.width * k;
    pad.seg([vx, top], [vx, ry], 'dim', 'A-ANNO-SYMB');
  }
  out.push(...pad.items);
  return y - ry;
}

// --- cover --------------------------------------------------------------------------------------

function coverSheet(res: Resolved, f: Frame, opts: SheetOptions, sheets: Sheet[], scene: ExteriorScene): Sheet {
  const k = f.k;
  const sheet = blank(f, 'A0.0', 'Cover');
  const pad = new Pad(1);
  const a = f.area;
  const p = res.project;
  // Name and program across the top.
  let y = a.y1 - 0.5 * k;
  pad.text([a.x0, y], p.name, 0.48 * k, 'A-ANNO-TEXT', { font: 'serif' });
  y -= 0.32 * k;
  pad.text([a.x0, y], programLine(res), 0.13 * k, 'A-ANNO-TEXT', { font: 'sans' });
  y -= 0.25 * k;
  pad.seg([a.x0, y], [a.x1, y], 'medium', 'A-ANNO-SYMB');
  const top = y - 0.3 * k;

  // Left column: the brief, areas, sheet index.
  const colW = 4.3 * k;
  let ly = top;
  if (p.brief.trim()) {
    pad.text([a.x0, ly], 'THE BRIEF', 0.075 * k, 'A-ANNO-TEXT', { font: 'sans', bold: true });
    ly -= 0.1 * k;
    for (const line of wrap(`“${p.brief.trim()}”`, 0.11 * k, colW, 'serif').slice(0, 9)) {
      ly -= 0.17 * k;
      pad.text([a.x0, ly], line, 0.11 * k, 'A-ANNO-TEXT', { font: 'serif' });
    }
    ly -= 0.3 * k;
  }
  const items: Item[] = [];
  ly -= drawTable(items, areaTable(res), a.x0, ly, k) + 0.3 * k;
  const index: Table = {
    title: 'Sheet Index',
    columns: [
      { label: 'SHEET', width: 0.8 },
      { label: 'TITLE', width: 3.4 },
    ],
    rows: [['A0.0', 'Cover'], ...sheets.map((s) => [s.number, s.title])],
  };
  drawTable(items, index, a.x0, ly, k);
  pad.items.push(...items);

  // Right: the rendered view, and the axonometric line drawing.
  const rx0 = a.x0 + colW + 0.5 * k;
  const box = { x0: rx0, y0: a.y0, x1: a.x1, y1: top };
  const axonSlot = opts.snapshot ? { x0: box.x0 + (box.x1 - box.x0) * 0.5, y0: box.y0, x1: box.x1, y1: box.y0 + (box.y1 - box.y0) * 0.4 } : box;
  if (opts.snapshot) {
    const { w, h } = opts.snapshot;
    const iw = box.x1 - box.x0;
    const ih = (box.y1 - box.y0) * 0.56;
    const s = Math.min(iw / w, ih / h);
    sheet.images.push({ href: opts.snapshot.href, x: box.x1 - w * s, y: box.y1 - h * s, w: w * s, h: h * s });
  }
  // The axonometric at whatever scale fills its slot.
  const probe = axonometric(res, 8, scene);
  const sz = paperSize(probe);
  const slotW = axonSlot.x1 - axonSlot.x0;
  const slotH = axonSlot.y1 - axonSlot.y0 - titleH(f);
  const fit = Math.min(slotW / sz.w, slotH / sz.h);
  const scale = 8 / fit;
  const pw = sz.w * fit;
  const ph = sz.h * fit;
  const ax = axonSlot.x0 + (slotW - pw) / 2;
  const ay = axonSlot.y0 + titleH(f) + (slotH - ph) / 2;
  place(pad.items, probe, ax, ay, scale);
  caption(pad.items, f, ax, ay, '1', 'Axonometric', 'Not to scale');
  sheet.items.push(...pad.items);
  return sheet;
}
