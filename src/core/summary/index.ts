import type { Issue } from '../model/issues';
import type { Room } from '../model/schema';
import { isDoorType, isOutdoor, isWindowType } from '../model/schema';
import { ft, ftIn } from '../model/units';
import type { Resolved, ResolvedLevel } from '../resolve';

/**
 * The compact, readable description of a design that Claude sees on every request. It uses the
 * same ids and coordinates the ops use, so numbers are copied, not converted.
 */
export function designSummary(res: Resolved, issues: Issue[] = res.issues): string {
  const p = res.project;
  const out: string[] = [];
  out.push(`DESIGN "${p.name}" | ${p.levels.length} level${p.levels.length > 1 ? 's' : ''} | ${Math.round(res.grossArea).toLocaleString('en-US')} sf heated`);
  if (p.brief) out.push(`BRIEF: ${p.brief}`);
  if (p.notes.length) out.push(`NOTES: ${p.notes.join(' · ')}`);
  const s = p.site;
  out.push(`SITE: ${s.setting}, front faces ${s.front}${s.water.length ? `, water to ${s.water.join('/')}` : ''}, trees ${s.trees}`);
  const st = p.style;
  out.push(`STYLE: ${st.preset ?? 'custom'} | walls ${st.wall} ${st.wallColor} | trim ${st.trimColor} | door ${st.doorColor} | roof ${st.roofMaterial} ${st.roofColor} | windows ${st.windows}${st.grilles !== 'none' ? ` w/ ${st.grilles} grilles` : ''} ${st.windowColor} | floors ${st.floor} | foundation ${st.foundation}`);
  const r = p.roof;
  out.push(`ROOF: ${r.form} ${r.pitch}/12, ridge ${r.ridge}${r.low ? `, low side ${r.low}` : ''}, overhang ${ft(r.overhang)}, porch roofs ${r.porch} ${r.porchPitch}/12`);
  out.push('Units ft. x→east, y→north. rect=[x,y,w,d] on wall centerlines (SW corner, w along x, d along y). Sides N/E/S/W.');
  for (const rl of res.levels) out.push('', ...levelLines(rl, res));
  const shown = issues.filter((i) => i.severity !== 'tip').slice(0, 14);
  const tips = issues.filter((i) => i.severity === 'tip').slice(0, 6);
  if (shown.length || tips.length) {
    out.push('', `ISSUES (${shown.length} to consider, ${tips.length} tips)`);
    for (const i of [...shown, ...tips]) out.push(` ${i.severity === 'error' ? 'E' : i.severity === 'warning' ? 'W' : 'tip'} ${i.rule} [${i.ids.join(',')}] ${i.message}${i.fix ? `  fix: ${JSON.stringify(i.fix)}` : ''}`);
  }
  return out.join('\n');
}

function levelLines(rl: ResolvedLevel, res: Resolved): string[] {
  const l = rl.level;
  const fb = boxOf(rl);
  const lines: string[] = [];
  const kind = l.kind === 'half' ? ` half-story (knee wall ${ft(l.kneeWall)})` : l.kind === 'loft' ? ' loft (inside the roof below)' : '';
  lines.push(`${l.id} "${l.name}"${kind} | floor at ${ft(rl.elevation)} above grade | ceiling ${ft(l.ceiling)} | footprint ${fb}`);
  lines.push(' id   name                 type             rect                  clear        sf   sides');
  for (const info of rl.rooms.values()) {
    const room = info.room;
    const rect = room.rect ? `[${room.rect.map(ft).join(',')}]` : `poly ${JSON.stringify(room.poly)}`;
    const clear = isOutdoor(room.type) ? (room.covered ? 'covered' : 'open') : `${ft(info.clearW)}×${ft(info.clearD)}`;
    lines.push(` ${pad(room.id, 4)} ${pad(room.name, 20)} ${pad(room.type, 16)} ${pad(rect, 21)} ${pad(clear, 11)} ${pad(String(Math.round(info.netArea || info.area)), 4)} ${sides(rl, room)}`);
  }
  const doors = rl.openings.filter((o) => isDoorType(o.type) || o.type === 'cased_opening' || o.type === 'open');
  const wins = rl.openings.filter((o) => isWindowType(o.type));
  if (doors.length) lines.push(` doors/openings: ${doors.map((o) => `${o.id} ${o.type === 'door' ? '' : o.type + ' '}${o.room}→${o.other ?? 'outside'} ${o.side}${o.type === 'open' ? '' : ` ${ft(o.u1 - o.u0)}w`}`).join(' | ')}`);
  if (wins.length) lines.push(` windows: ${wins.map((o) => `${o.id} ${o.room} ${o.side} ${ft(o.unitWidth)}×${ft(o.height)}${o.count > 1 ? `×${o.count}` : ''} sill ${ft(o.sill)}${o.auto ? '' : ' (pinned)'}`).join(' | ')}`);
  const unresolved = l.openings.filter((o) => !rl.openings.some((r) => r.id === o.id));
  if (unresolved.length) lines.push(` unplaced: ${unresolved.map((o) => o.id).join(', ')}`);
  for (const room of l.rooms) {
    if (room.kitchen) {
      const k = room.kitchen;
      lines.push(` kitchen ${room.id}: ${k.shape}${k.walls ? ` on ${k.walls.join('+')}` : ''}${k.island ? `, island${k.islandSize ? ` ${k.islandSize.join('×')}` : ''}` : ''}${k.sink ? `, sink ${k.sink}` : ''}${k.range ? `, range ${k.range}` : ''}${k.fridge ? `, fridge ${k.fridge}` : ''}`);
    }
    if (room.bath) lines.push(` bath ${room.id}: ${room.bath.bathing}, ${room.bath.vanity} vanity${room.bath.wetWall ? `, wet wall ${room.bath.wetWall}` : ''}`);
  }
  for (const s of rl.stairs) lines.push(` stairs ${s.id} in ${s.room}: ${s.shape} up toward ${s.dir}, ${ft(s.width)} wide, ${s.risers} risers, footprint [${ft(s.footprint.x0)},${ft(s.footprint.y0)},${ft(s.footprint.x1 - s.footprint.x0)},${ft(s.footprint.y1 - s.footprint.y0)}] → ${res.levels[rl.index + 1]?.level.id ?? '?'}`);
  const fx = l.fixtures.filter((f) => !f.auto);
  if (fx.length) lines.push(` placed items: ${fx.map((f) => `${f.id} ${f.kind} in ${f.room}`).join(', ')}`);
  const auto = l.fixtures.filter((f) => f.auto);
  if (auto.length) lines.push(` furniture (auto): ${summarizeAuto(auto.map((f) => f.kind))}`);
  return lines;
}

function sides(rl: ResolvedLevel, room: Room): string {
  const parts: string[] = [];
  for (const side of ['N', 'E', 'S', 'W'] as const) {
    const names = new Set<string>();
    for (const w of rl.walls) {
      const host = w.pos === room.id ? 1 : w.neg === room.id ? -1 : 0;
      if (!host) continue;
      const onSide = w.axis === 'x' ? (host === 1 ? side === 'S' : side === 'N') : host === 1 ? side === 'W' : side === 'E';
      if (!onSide) continue;
      const other = host === 1 ? w.neg : w.pos;
      names.add(other ? `${other}${w.kind === 'none' ? '(open)' : ''}` : 'out');
    }
    if (names.size) parts.push(`${side}:${[...names].join(',')}`);
  }
  return parts.join(' ');
}

function boxOf(rl: ResolvedLevel): string {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const i of rl.rooms.values()) {
    if (isOutdoor(i.room.type)) continue;
    x0 = Math.min(x0, i.box.x0);
    y0 = Math.min(y0, i.box.y0);
    x1 = Math.max(x1, i.box.x1);
    y1 = Math.max(y1, i.box.y1);
  }
  if (!isFinite(x0)) return 'empty';
  return `x ${ft(x0)}..${ft(x1)}, y ${ft(y0)}..${ft(y1)} (${ftIn(x1 - x0)} × ${ftIn(y1 - y0)})`;
}

function summarizeAuto(kinds: string[]): string {
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(', ');
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

/** One line describing what an op batch did, for the conversation history. */
export function changeLine(log: string[]): string {
  return log.join(' ');
}
