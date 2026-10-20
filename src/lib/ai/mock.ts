import type { DesignEvent, DesignRequest } from '@/core/ai/types';
import type { Issue } from '@/core/model/issues';
import type { Level, Project, Room, RoomType, Side, Site, Style } from '@/core/model/schema';
import { BEDROOM_TYPES, isEnclosed, isOutdoor } from '@/core/model/schema';
import { fixtureSpec } from '@/core/catalog/fixtures';
import { applyOps } from '@/core/ops/apply';
import { roomBox } from '@/core/ops/geom';
import { DEFAULT_AREA } from '@/core/ops/helpers/layout';
import type { OpInput } from '@/core/ops/schema';
import { resolve } from '@/core/resolve';
import { checkRules } from '@/core/rules';
import type { TemplateId, TemplateParams } from '@/core/templates/params';
import { describeOp } from './describe';

/**
 * Demo mode: a small rule-based interpreter that turns common requests into ops. It drives the
 * real ops engine, so everything downstream (3D, drawings, history) works without an API key.
 */
export async function runMockTurn(req: DesignRequest, emit: (e: DesignEvent) => void, opts: { delay?: number } = {}): Promise<void> {
  const delay = opts.delay ?? 350;
  const wait = (ms = delay) => new Promise((r) => setTimeout(r, ms));
  const text = req.request.toLowerCase().replace(/[’']/g, "'");
  const empty = req.project.levels.every((l) => l.rooms.length === 0);
  const plan = empty || req.mode === 'create' ? planFromBrief(req.request) : planEdit(text, req);

  if (!plan.ops.length) {
    const reply = plan.reply ?? "I'm running in demo mode right now, so I only understand simpler requests, like \"add a bedroom off the hall\", \"make the kitchen bigger\", \"add a third story\", \"move the sink to the island\", or \"change the roof to a hip roof\". Connect the Claude API to talk to me freely.";
    await streamText(reply, emit, delay / 10);
    emit({ type: 'done', project: req.project, reply, changes: [], issues: [], engine: 'mock' });
    return;
  }

  let project = req.project;
  const changes: string[] = [];
  // Apply in small groups so the model visibly assembles.
  const groups = plan.groups ?? [plan.ops];
  for (const g of groups) {
    for (const o of g) {
      const line = describeOp(o);
      if (line) emit({ type: 'status', text: line });
      await wait();
    }
    const r = applyOps(project, g);
    if (!r.ok) {
      const reply = `I tried, but that didn't fit: ${r.error?.message}`;
      await streamText(reply, emit, delay / 10);
      emit({ type: 'done', project, reply, changes, issues: [], engine: 'mock' });
      return;
    }
    project = r.project;
    changes.push(...r.log);
    emit({ type: 'project', project, log: r.log });
  }
  const res = resolve(project);
  const issues: Issue[] = [...res.issues, ...checkRules(res)];
  const reply = plan.reply ?? friendly(changes);
  await streamText(reply, emit, delay / 10);
  emit({ type: 'done', project, reply, changes, issues, engine: 'mock' });
}

async function streamText(reply: string, emit: (e: DesignEvent) => void, ms: number) {
  const words = reply.split(/(\s+)/);
  for (const w of words) {
    emit({ type: 'text', text: w });
    if (ms) await new Promise((r) => setTimeout(r, ms));
  }
}

function friendly(changes: string[]): string {
  if (!changes.length) return 'Done.';
  return changes.slice(0, 3).join(' ');
}

interface Plan {
  ops: OpInput[];
  groups?: OpInput[][];
  reply?: string;
}

// --- creating from a brief ------------------------------------------------------------------------

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1, single: 1 };
const num = (s?: string) => (s === undefined ? undefined : NUM[s] ?? Number(s));

export function planFromBrief(brief: string): Plan {
  const t = brief.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  let template: TemplateId = 'cottage';
  if (has(/a[- ]?frame/)) template = 'a_frame';
  else if (has(/cape\s*cod|\bcape\b/)) template = 'cape_cod';
  else if (has(/farm\s*house|farmhouse/)) template = 'farmhouse';
  else if (has(/\branch\b|rambler/)) template = 'ranch';
  else if (has(/bungalow|craftsman/)) template = 'bungalow';
  else if (has(/modern|contemporary|minimal/)) template = 'modern';
  else if (has(/lake\s*house|lakehouse|lodge/)) template = 'lake_house';
  else if (has(/tiny/)) template = 'tiny_house';
  else if (has(/garage|carriage|\badu\b|granny/)) template = 'garage_studio';
  else if (has(/two[- ]stor|2[- ]stor|two floors/) && !has(/cottage|cabin/)) template = 'farmhouse';

  const params: TemplateParams = {};
  const beds = t.match(/\b(\d|one|two|three|four|five|six)[- ](?:bed|bedroom|br)\b/);
  if (beds) params.bedrooms = num(beds[1]);
  const baths = t.match(/\b(\d(?:\.5)?|one|two|three)[- ](?:bath|bathroom|ba)\b/);
  if (baths) params.baths = num(baths[1]);
  if (has(/three[- ]stor|3[- ]stor/)) params.stories = '3';
  else if (has(/two[- ]stor|2[- ]stor|two floors|second floor|upstairs/)) params.stories = '2';
  else if (has(/story[- ]and[- ]a[- ]half|1\.5|loft/)) params.stories = '1.5';
  else if (has(/one[- ]stor|single[- ]stor|1[- ]stor|single level/)) params.stories = '1';
  if (has(/wrap[- ]?around/)) params.porch = 'wrap';
  else if (has(/screen(ed)? porch/)) params.porch = 'screened';
  else if (has(/back porch|porch (facing|toward|towards|on) the (water|lake|back)/)) params.porch = 'back';
  else if (has(/no porch/)) params.porch = 'none';
  else if (has(/porch/)) params.porch = 'front';
  if (has(/two[- ]car|2[- ]car|double garage/)) params.garage = '2';
  else if (has(/one[- ]car|single garage/)) params.garage = '1';
  if (has(/office|study/)) params.office = true;
  const sq = t.match(/(\d[\d,]{2,})\s*(?:sq|square|sf)/);
  if (sq) params.area = Math.min(8000, Math.max(200, Number(sq[1].replace(/,/g, ''))));

  const site: Partial<Site> = {};
  if (has(/island/)) Object.assign(site, { setting: 'island', water: ['N', 'E', 'S', 'W'], trees: 'many' });
  else if (has(/lake|pond|river/)) Object.assign(site, { setting: 'lakefront', water: ['N'] });
  else if (has(/beach|ocean|coast|sea/)) Object.assign(site, { setting: 'coast', water: ['N'], ground: 'sand' });
  else if (has(/forest|woods|pines|trees/)) Object.assign(site, { setting: 'forest', trees: 'many' });
  else if (has(/mountain/)) Object.assign(site, { setting: 'mountain', trees: 'many' });
  else if (has(/desert/)) Object.assign(site, { setting: 'desert', ground: 'sand', trees: 'none' });
  else if (has(/meadow|field|prairie|farm/)) Object.assign(site, { setting: 'meadow' });
  if (has(/snow/)) site.ground = 'snow';

  const style = styleFrom(t);
  const ops: OpInput[] = [{ op: 'use_template', template, params }];
  if (Object.keys(site).length) ops.push({ op: 'set_site', ...site });
  if (Object.keys(style).length) ops.push({ op: 'set_style', ...style });
  const roof = roofFrom(t);
  if (roof) ops.push(roof);
  const name = nameFrom(t, template, site.setting);
  ops.push({ op: 'set_name', name }, { op: 'note', add: brief.trim().slice(0, 200) });
  const reply = `Here's a first sketch of your ${name.toLowerCase()}: ${describeTemplate(template, params)}. Tap anything to change it, or tell me what to try next.`;
  return { ops, groups: [ops.slice(0, 1), ops.slice(1)], reply };
}

function describeTemplate(t: TemplateId, p: TemplateParams): string {
  const beds = p.bedrooms !== undefined ? `${p.bedrooms} bedroom${p.bedrooms === 1 ? '' : 's'}` : 'a couple of bedrooms';
  const porch = p.porch === 'wrap' ? ' and a wraparound porch' : p.porch === 'none' ? '' : p.porch ? ' and a porch' : '';
  const kind: Record<TemplateId, string> = {
    cottage: 'a cozy cottage plan',
    cape_cod: 'a story-and-a-half Cape',
    farmhouse: 'a two-story farmhouse',
    ranch: 'a single-story ranch',
    bungalow: 'a craftsman bungalow',
    a_frame: 'an A-frame with a sleeping loft',
    modern: 'an open modern plan',
    lake_house: 'a lake house with the living spaces facing the water',
    tiny_house: 'a tiny house',
    garage_studio: 'a garage with a studio above',
  };
  return `${kind[t]} with ${beds}${porch}`;
}

function nameFrom(t: string, template: TemplateId, setting?: Site['setting']): string {
  const place = setting === 'island' ? 'Island' : setting === 'lakefront' ? 'Lake' : setting === 'coast' ? 'Seaside' : setting === 'forest' ? 'Woodland' : setting === 'mountain' ? 'Mountain' : setting === 'desert' ? 'Desert' : '';
  const kind: Record<TemplateId, string> = { cottage: t.includes('cabin') ? 'Cabin' : 'Cottage', cape_cod: 'Cape', farmhouse: 'Farmhouse', ranch: 'Ranch', bungalow: 'Bungalow', a_frame: 'A-Frame', modern: 'Modern House', lake_house: 'Lake House', tiny_house: 'Tiny House', garage_studio: 'Carriage House' };
  const k = kind[template];
  if (place && !(place === 'Lake' && template === 'lake_house')) return `${place} ${k}`;
  if (t.includes('stone')) return `Stone ${k}`;
  return k === 'Modern House' ? 'Modern House' : `The ${k}`;
}

const COLORS: Record<string, string> = {
  white: '#f2efe8',
  cream: '#ece4d2',
  black: '#2b2b2b',
  charcoal: '#3a3a3c',
  gray: '#9a9a96',
  grey: '#9a9a96',
  blue: '#5f6e74',
  navy: '#2f3f55',
  green: '#7b8a72',
  sage: '#8a9a7b',
  red: '#7a2f2a',
  yellow: '#e2c675',
  brown: '#7a5a42',
  tan: '#c8b79c',
  pink: '#d9a9a0',
};

function styleFrom(t: string): Partial<Style> {
  const s: Partial<Style> = {};
  if (/\bstone\b/.test(t)) s.wall = 'stone';
  else if (/\bbrick\b/.test(t)) s.wall = 'brick';
  else if (/board[- ]and[- ]batten/.test(t)) s.wall = 'board_and_batten';
  else if (/shingle|shake/.test(t)) s.wall = 'shingle';
  else if (/stucco|adobe/.test(t)) s.wall = 'stucco';
  else if (/\blog\b/.test(t)) s.wall = 'log';
  else if (/cedar|wood siding|vertical (wood|siding)/.test(t)) s.wall = 'vertical_wood';
  else if (/clapboard|lap siding/.test(t)) s.wall = 'lap_siding';
  if (s.wall === 'stone') s.wallColor = '#b9b2a6';
  if (s.wall === 'brick') s.wallColor = '#9c5a43';
  const colorWord = t.match(/\b(white|cream|black|charcoal|gr[ae]y|blue|navy|green|sage|red|yellow|brown|tan|pink)\b(?! (roof|door|trim|windows?))/);
  if (colorWord && s.wall !== 'stone' && s.wall !== 'brick') s.wallColor = COLORS[colorWord[1]];
  const door = t.match(/\b(white|black|blue|navy|green|red|yellow)\s+(front )?door/);
  if (door) s.doorColor = COLORS[door[1]];
  if (/metal roof|tin roof|standing[- ]seam/.test(t)) s.roofMaterial = 'standing_seam';
  else if (/slate/.test(t)) s.roofMaterial = 'slate';
  else if (/tile roof|terra ?cotta|spanish/.test(t)) s.roofMaterial = 'clay_tile';
  else if (/shake roof|cedar roof|thatch/.test(t)) s.roofMaterial = 'cedar_shake';
  if (/black windows|dark windows/.test(t)) s.windowColor = '#2b2b2b';
  return s;
}

function roofFrom(t: string): OpInput | null {
  const form = t.match(/\b(hip|hipped|gable|gabled|flat|shed|gambrel)\b(?:[- ]roof)/);
  if (!form) return null;
  const f = form[1].startsWith('hip') ? 'hip' : form[1].startsWith('gable') ? 'gable' : (form[1] as 'flat' | 'shed' | 'gambrel');
  return { op: 'set_roof', form: f };
}

// --- editing --------------------------------------------------------------------------------------

const ORD: Record<string, number> = { first: 0, main: 0, ground: 0, bottom: 0, second: 1, upper: 1, upstairs: 1, third: 2, fourth: 3, top: -1 };

const TYPE_WORDS: [RegExp, RoomType][] = [
  [/primary (bed)?room|master (bed)?room|primary suite|master suite/, 'primary_bedroom'],
  [/guest (bed)?room|bedroom|kids'? room|bunk room/, 'bedroom'],
  [/nursery/, 'nursery'],
  [/powder room|half bath/, 'half_bath'],
  [/bath(room)?/, 'bath'],
  [/walk[- ]in closet/, 'walk_in_closet'],
  [/closet/, 'closet'],
  [/kitchen/, 'kitchen'],
  [/dining( room)?/, 'dining'],
  [/great room/, 'great_room'],
  [/family room|den/, 'family'],
  [/living( room)?|sitting room|lounge/, 'living'],
  [/office|study/, 'office'],
  [/library/, 'library'],
  [/(art )?studio|craft room/, 'studio'],
  [/mud ?room/, 'mudroom'],
  [/laundry/, 'laundry'],
  [/pantry/, 'pantry'],
  [/sun ?room|conservatory/, 'sunroom'],
  [/gym|exercise room/, 'gym'],
  [/media room|theater|theatre/, 'media'],
  [/play ?room|bonus room|rec room/, 'bonus'],
  [/garage/, 'garage'],
  [/screened porch/, 'screened_porch'],
  [/porch/, 'porch'],
  [/deck/, 'deck'],
  [/patio/, 'patio'],
  [/balcony/, 'balcony'],
  [/loft/, 'loft'],
  [/foyer|entry/, 'foyer'],
  [/hall(way)?/, 'hall'],
];

function typeFrom(s: string): RoomType | null {
  for (const [re, t] of TYPE_WORDS) if (re.test(s)) return t;
  return null;
}

interface Ctx {
  p: Project;
  sel?: DesignRequest['selection'];
}

function findLevel(ctx: Ctx, t: string): Level | undefined {
  const m = t.match(/\b(first|main|ground|bottom|second|upper|upstairs|third|fourth|top)\b/);
  if (!m) return undefined;
  const i = ORD[m[1]];
  return i === -1 ? ctx.p.levels[ctx.p.levels.length - 1] : ctx.p.levels[i];
}

function findRoom(ctx: Ctx, t: string): { room: Room; level: Level } | undefined {
  const all = ctx.p.levels.flatMap((level) => level.rooms.map((room) => ({ room, level })));
  // The selection wins for "this" / "it".
  if (ctx.sel && (ctx.sel.kind === 'room' || ctx.sel.kind === 'standing') && /\b(this|it|here|in here)\b/.test(t)) {
    const hit = all.find((x) => x.room.id === ctx.sel!.id);
    if (hit) return hit;
  }
  // Longest room-name match.
  const byName = all.filter((x) => t.includes(x.room.name.toLowerCase())).sort((a, b) => b.room.name.length - a.room.name.length)[0];
  if (byName) return byName;
  const ty = typeFrom(t);
  if (ty) {
    const ofType = all.filter((x) => x.room.type === ty || (ty === 'bedroom' && BEDROOM_TYPES.has(x.room.type)));
    if (ofType.length) return ofType[0];
  }
  if (ctx.sel && (ctx.sel.kind === 'room' || ctx.sel.kind === 'standing')) return all.find((x) => x.room.id === ctx.sel!.id);
  return undefined;
}

function hub(level: Level): Room | undefined {
  const order: RoomType[] = ['hall', 'stair_hall', 'foyer', 'living', 'great_room', 'family', 'loft', 'kitchen'];
  for (const t of order) {
    const r = level.rooms.find((x) => x.type === t);
    if (r) return r;
  }
  return level.rooms.find((r) => isEnclosed(r.type));
}

/** The side of a room that faces outside the most (for growing outward). */
function outsideSide(ctx: Ctx, room: Room, level: Level): Side | null {
  const res = resolve(ctx.p);
  const rl = res.levels.find((l) => l.level.id === level.id)!;
  const len: Record<Side, number> = { N: 0, E: 0, S: 0, W: 0 };
  for (const w of rl.walls) {
    if (w.kind !== 'exterior') continue;
    const host = w.pos === room.id ? 1 : w.neg === room.id ? -1 : 0;
    if (!host) continue;
    const side: Side = w.axis === 'x' ? (host === 1 ? 'S' : 'N') : host === 1 ? 'W' : 'E';
    const other = host === 1 ? w.neg : w.pos;
    if (other) continue; // porches don't count: growing there would eat the porch
    len[side] += w.b - w.a;
  }
  const best = (Object.entries(len) as [Side, number][]).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : null;
}

export function planEdit(t: string, req: DesignRequest): Plan {
  const ctx: Ctx = { p: req.project, sel: req.selection };
  const p = ctx.p;
  const ops: OpInput[] = [];

  // remove a story (+ optionally grow the floor below)
  const rmLevel = t.match(/(remove|delete|take off|get rid of|drop)\s+(the\s+)?(second|third|fourth|top|upper|upstairs)\s+(story|storey|floor|level)/);
  const area = t.match(/(\d[\d,]*)\s*(sq\.?\s*ft|square\s*f(ee|oo)t|sf\b)/);
  if (rmLevel) {
    const lvl = findLevel(ctx, rmLevel[3]) ?? p.levels[p.levels.length - 1];
    if (p.levels.length < 2 || !lvl) return { ops: [], reply: "There's only one floor, so there's nothing to take off." };
    ops.push({ op: 'remove_level', level: lvl.id });
    if (area && /(add|expand|increase|grow|enlarge|bigger)/.test(t)) {
      const add = Number(area[1].replace(/,/g, ''));
      const keep = lvl.rooms.filter((r) => isEnclosed(r.type) && r.type !== 'hall' && r.type !== 'stair_hall' && r.type !== 'loft');
      const below = p.levels[Math.max(0, p.levels.indexOf(lvl) - 1)];
      const target = hub(below);
      if (keep.length) {
        const rooms = keep.slice(0, 7).map((r) => ({ name: r.name, type: r.type }));
        ops.push({ op: 'add_wing', level: below.id, side: wingSide(ctx, below), area: add, connectTo: target?.id, rooms });
        return { ops, reply: `I took off ${lvl.name.toLowerCase()} and added a ${add.toLocaleString('en-US')} sf wing to ${below.name.toLowerCase()} with the rooms that were up there: ${rooms.map((r) => r.name).join(', ')}.` };
      }
      ops.push({ op: 'grow_level', level: below.id, addArea: add });
    }
    return { ops };
  }

  // chimneys
  if (/chimney|fireplace/.test(t)) {
    if (/\b(remove|delete|take out|get rid of|no)\b/.test(t)) {
      if (!p.roof.chimney) return { ops: [], reply: "There's no chimney to take out." };
      return { ops: [{ op: 'set_roof', chimney: null }], reply: 'I took the chimney out.' };
    }
    const material = /stone/.test(t) ? 'stone' : /brick/.test(t) ? 'brick' : undefined;
    const L1 = p.levels[0];
    const host =
      (ctx.sel && (ctx.sel.kind === 'room' || ctx.sel.kind === 'standing') ? L1.rooms.find((r) => r.id === ctx.sel!.id) : undefined) ??
      ['great_room', 'living', 'family'].map((ty) => L1.rooms.find((r) => r.type === ty)).find(Boolean);
    if (!host) return { ops: [], reply: 'I need a living room or great room to put a fireplace in.' };
    const res = resolve(p);
    const walls = res.levels[0].walls.filter((w) => w.kind === 'exterior' && (w.pos === host.id || w.neg === host.id));
    // Prefer a gable end (a side wall), then the back.
    const front = p.site.front;
    const sideOf = (w: (typeof walls)[number]): Side => (w.axis === 'x' ? (w.pos === host.id ? 'S' : 'N') : w.pos === host.id ? 'W' : 'E');
    const opp: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
    const sides = [...new Set(walls.map(sideOf))].sort((a, b) => (a === front ? 2 : a === opp[front] ? 1 : 0) - (b === front ? 2 : b === opp[front] ? 1 : 0));
    if (!sides.length) return { ops: [], reply: `${host.name} has no outside wall for a chimney.` };
    return { ops: [{ op: 'set_roof', chimney: { room: host.id, side: sides[0], ...(material ? { material } : {}) } }], reply: `I added a ${material ?? 'masonry'} chimney on the ${({ N: 'north', S: 'south', E: 'east', W: 'west' } as const)[sides[0]]} wall of ${host.name}, with windows on either side of it.` };
  }

  // add a story
  const addLevel = t.match(/add\s+(a|an|another|one more)?\s*(second|third|fourth|new|extra|another)?\s*(story|storey|floor|level)/);
  if (addLevel) {
    const n = p.levels.length;
    const name = ['Main Floor', 'Upper Floor', 'Third Floor', 'Fourth Floor'][n] ?? `Level ${n + 1}`;
    const kind = /half|attic/.test(t) ? 'half' : /loft/.test(t) ? 'loft' : 'full';
    return { ops: [{ op: 'add_level', name, kind }] };
  }

  // grow/shrink a level by an area
  if (area && /(add|expand|increase|grow|enlarge|bigger|more|shrink|reduce|smaller|less)/.test(t)) {
    const add = Number(area[1].replace(/,/g, '')) * (/(shrink|reduce|smaller|less|remove)/.test(t) ? -1 : 1);
    const lvl = findLevel(ctx, t) ?? p.levels[0];
    return { ops: [{ op: 'grow_level', level: lvl.id, addArea: add }] };
  }

  // kitchen
  if (/(sink|faucet).*(island)/.test(t) || /island.*sink/.test(t)) {
    const k = findRoom(ctx, 'kitchen');
    if (!k) return { ops: [], reply: "I couldn't find a kitchen to change." };
    return { ops: [{ op: 'set_kitchen', room: k.room.id, sink: 'island' }], reply: `I moved the sink to the island in the ${k.room.name.toLowerCase()}.` };
  }
  if (/(range|stove|cooktop).*(island)/.test(t)) {
    const k = findRoom(ctx, 'kitchen');
    if (k) return { ops: [{ op: 'set_kitchen', room: k.room.id, range: 'island' }] };
  }
  if (/(add|want|put)\s+(an?\s+)?(kitchen\s+)?island/.test(t)) {
    const k = findRoom(ctx, 'kitchen');
    if (k) return { ops: [{ op: 'set_kitchen', room: k.room.id, island: true }] };
  }
  if (/(remove|no|lose)\s+(the\s+)?(kitchen\s+)?island/.test(t)) {
    const k = findRoom(ctx, 'kitchen');
    if (k) return { ops: [{ op: 'set_kitchen', room: k.room.id, island: false, sink: undefined }] };
  }

  // roof
  const roofForm = t.match(/\b(hip|hipped|gable|gabled|flat|shed|gambrel)\s*roof/);
  if (roofForm) {
    const f = roofForm[1].startsWith('hip') ? 'hip' : roofForm[1].startsWith('gable') ? 'gable' : (roofForm[1] as 'flat' | 'shed' | 'gambrel');
    ops.push({ op: 'set_roof', form: f });
  }
  if (/steeper|taller roof|higher roof|more pitch/.test(t)) ops.push({ op: 'set_roof', pitch: Math.min(18, p.roof.pitch + 3) });
  if (/flatter|lower (the )?roof|less pitch|shallower/.test(t)) ops.push({ op: 'set_roof', pitch: Math.max(3, p.roof.pitch - 3) });
  const s = styleFrom(t);
  if (/(roof|siding|walls|exterior|outside|house|paint|color|colour|door|trim|windows|stone|brick|shingle|stucco)/.test(t) && Object.keys(s).length) ops.push({ op: 'set_style', ...s });
  const setting = t.match(/\b(on|by|near|at)\s+(an?\s+|the\s+)?(island|lake|beach|ocean|coast|mountains?|forest|woods|desert|meadow)/);
  if (setting) {
    const map: Record<string, Partial<Site>> = { island: { setting: 'island', water: ['N', 'E', 'S', 'W'] }, lake: { setting: 'lakefront', water: ['N'] }, beach: { setting: 'coast', water: ['N'] }, ocean: { setting: 'coast', water: ['N'] }, coast: { setting: 'coast', water: ['N'] }, forest: { setting: 'forest', trees: 'many' }, woods: { setting: 'forest', trees: 'many' }, desert: { setting: 'desert' }, meadow: { setting: 'meadow' } };
    ops.push({ op: 'set_site', ...(map[setting[3].replace(/s$/, '')] ?? { setting: 'mountain' }) });
  }
  if (ops.length) return { ops };

  // open plan
  const open = t.match(/open(?:\s+up)?\s+(?:the\s+)?([\w\s]+?)\s+(?:to|into|with|onto)\s+(?:the\s+)?([\w\s]+)/);
  if (open) {
    const a = findRoom(ctx, open[1]);
    const b = findRoom(ctx, open[2]);
    if (a && b && a.level === b.level) return { ops: [{ op: 'add_opening', type: 'open', room: a.room.id, to: b.room.id }], reply: `I opened the ${a.room.name.toLowerCase()} up to the ${b.room.name.toLowerCase()}.` };
  }

  // vaulted ceiling
  if (/vault|cathedral/.test(t)) {
    const r = findRoom(ctx, t) ?? findRoom(ctx, 'living');
    if (r) return { ops: [{ op: 'update_room', room: r.room.id, ceiling: 'vaulted' }], reply: `I vaulted the ceiling in the ${r.room.name.toLowerCase()}.` };
  }

  // bigger / smaller
  const size = t.match(/\b(bigger|larger|wider|longer|grow|expand|smaller|narrower|shorter|shrink)\b(?:\s+by\s+(\d+(?:\.\d+)?)\s*(?:feet|foot|ft|'))?/);
  if (size) {
    const grow = /bigger|larger|wider|longer|grow|expand/.test(size[1]);
    const by = Number(size[2] ?? (/a lot|much/.test(t) ? 4 : /a (little|bit)/.test(t) ? 1 : 2));
    if (req.selection?.kind === 'fixture') {
      // Furniture: one size up or down the catalog's ladder (twin, full, queen, king...).
      const f = p.levels.flatMap((l) => l.fixtures).find((x) => x.id === req.selection!.id);
      const next = f && (grow ? fixtureSpec(f.kind).bigger : fixtureSpec(f.kind).smaller);
      if (f && next) return { ops: [{ op: 'update_fixture', fixture: f.id, kind: next, size: undefined }], reply: `I swapped the ${fixtureSpec(f.kind).label} for a ${fixtureSpec(next).label}.` };
      if (f) return { ops: [], reply: `That ${fixtureSpec(f.kind).label} is already as ${grow ? 'big' : 'small'} as it comes.` };
    }
    if (req.selection?.kind === 'opening' && /\b(this|it|window|door)\b/.test(t)) {
      const o = p.levels.flatMap((l) => l.openings).find((x) => x.id === req.selection!.id);
      const res = resolve(p);
      const ro = res.levels.flatMap((l) => l.openings).find((x) => x.id === req.selection!.id);
      if (o && ro) return { ops: [{ op: 'update_opening', opening: o.id, width: Math.max(1.5, ro.unitWidth + (grow ? 1 : -1)), height: Math.max(2, ro.height + (grow ? 0.5 : -0.5)) }] };
    }
    const r = findRoom(ctx, t);
    if (r) {
      const side = outsideSide(ctx, r.room, r.level);
      if (side) return { ops: [{ op: 'resize_room', room: r.room.id, side, by: grow ? by : -by, mode: 'push' }] };
      const b = roomBox(r.room);
      return { ops: [{ op: 'resize_room', room: r.room.id, side: b.x1 - b.x0 < b.y1 - b.y0 ? 'E' : 'N', by: grow ? by : -by, mode: 'push' }] };
    }
  }

  // add a window
  if (/add\s+(a\s+|another\s+|more\s+)?windows?/.test(t)) {
    const r = findRoom(ctx, t);
    if (r) {
      const side = outsideSide(ctx, r.room, r.level);
      if (side) return { ops: [{ op: 'add_opening', type: /big|picture|large/.test(t) ? 'picture_window' : 'window', room: r.room.id, side, to: 'outside' }] };
    }
  }

  // add a room / porch / deck
  const addRoom = t.match(/\badd\s+(?:a|an|another|one more|a new)?\s*([\w\s'-]+?)(?:\s+(?:to|on|off|next to|near|by|behind|in front of|onto)\s+(?:the\s+)?([\w\s]+?))?\s*$/);
  if (addRoom) {
    const ty = typeFrom(addRoom[1]);
    if (ty) {
      const where = addRoom[2] ?? '';
      if (isOutdoor(ty)) return { ops: [porchOp(ctx, ty, where)] };
      const near = where ? findRoom(ctx, where) : undefined;
      const level = near?.level ?? findLevel(ctx, t) ?? p.levels[0];
      const name = niceName(level, ty, addRoom[1]);
      return { ops: [{ op: 'add_room', level: level.id, name, type: ty, area: DEFAULT_AREA[ty], connectTo: (near?.room ?? hub(level))?.id }] };
    }
  }

  // remove
  const rm = t.match(/(remove|delete|get rid of|take out)\s+(?:the\s+)?([\w\s]+)/);
  if (rm) {
    if (req.selection && /\b(this|it)\b/.test(rm[2])) {
      const sel = req.selection;
      if (sel.kind === 'opening') return { ops: [{ op: 'remove_opening', opening: sel.id }] };
      if (sel.kind === 'fixture') return { ops: [{ op: 'remove_fixture', fixture: sel.id }] };
      if (sel.kind === 'stairs') return { ops: [{ op: 'remove_stairs', stairs: sel.id }] };
    }
    const r = findRoom(ctx, rm[2]);
    if (r) return { ops: [{ op: 'remove_room', room: r.room.id }] };
  }

  // rename
  const rename = t.match(/(?:call|name|rename)\s+(?:it|this|the house|the project|our house)\s+["“]?([\w\s'&-]+)/);
  if (rename) return { ops: [{ op: 'set_name', name: titleCase(rename[1].trim()) }] };

  return { ops: [] };
}

function wingSide(ctx: Ctx, level: Level): Side {
  const front = ctx.p.site.front;
  const sides: Side[] = front === 'S' || front === 'N' ? ['E', 'W'] : ['N', 'S'];
  // Prefer the side with fewer outdoor rooms in the way.
  const res = resolve(ctx.p);
  const rl = res.levels.find((l) => l.level.id === level.id)!;
  const blocked = (s: Side) => [...rl.rooms.values()].filter((i) => isOutdoor(i.room.type)).some((i) => (s === 'E' ? i.box.x0 >= rl.footprint.flat(2).reduce((m, [x]) => Math.max(m, x), -Infinity) - 1 : s === 'W' ? i.box.x1 <= 1 : false));
  return sides.find((s) => !blocked(s)) ?? sides[0];
}

function porchOp(ctx: Ctx, ty: RoomType, where: string): OpInput {
  const res = resolve(ctx.p);
  const rl = res.levels[0];
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const i of rl.rooms.values()) {
    if (!isEnclosed(i.room.type)) continue;
    x0 = Math.min(x0, i.box.x0);
    y0 = Math.min(y0, i.box.y0);
    x1 = Math.max(x1, i.box.x1);
    y1 = Math.max(y1, i.box.y1);
  }
  const front = ctx.p.site.front;
  const opp: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const side: Side = /back|rear|behind/.test(where) ? opp[front] : /front/.test(where) ? front : /east/.test(where) ? 'E' : /west/.test(where) ? 'W' : /north/.test(where) ? 'N' : /south/.test(where) ? 'S' : /side/.test(where) ? (front === 'S' || front === 'N' ? 'E' : 'N') : opp[front];
  const depth = ty === 'deck' || ty === 'patio' ? 12 : 8;
  const rect: [number, number, number, number] = side === 'S' ? [x0, y0 - depth, x1 - x0, depth] : side === 'N' ? [x0, y1, x1 - x0, depth] : side === 'E' ? [x1, y0, depth, y1 - y0] : [x0 - depth, y0, depth, y1 - y0];
  const name = ty === 'deck' ? 'Deck' : ty === 'patio' ? 'Patio' : ty === 'screened_porch' ? 'Screened Porch' : side === front ? 'Front Porch' : 'Back Porch';
  return { op: 'add_room', level: ctx.p.levels[0].id, name, type: ty, rect, carve: true };
}

function niceName(level: Level, ty: RoomType, said: string): string {
  const base = titleCase(said.replace(/\b(room)\b/, '').trim()) || titleCase(ty.replace(/_/g, ' '));
  const label = ty === 'bedroom' && /guest/.test(said) ? 'Guest Room' : ty === 'bedroom' ? 'Bedroom' : base;
  const same = level.rooms.filter((r) => r.name.startsWith(label)).length;
  return same ? `${label} ${same + 1}` : label;
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
