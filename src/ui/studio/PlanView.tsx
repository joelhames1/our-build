'use client';

import { useMemo } from 'react';
import { type Box, boxMulti } from '@/core/geometry/polygon';
import { wallUnion } from '@/core/geometry/walls';
import { isDoorType, isOutdoor, isWindowType } from '@/core/model/schema';
import { dims } from '@/core/model/units';
import type { Resolved } from '@/core/resolve';

/** A clean, tappable floor plan of one level. */
export function PlanView({ resolved, level, selected, onPick }: { resolved: Resolved; level: number; selected?: string | null; onPick: (owner: string | null) => void }) {
  const rl = resolved.levels[Math.min(level, resolved.levels.length - 1)];
  const svg = useMemo(() => {
    const b = resolved.bounds;
    const pad = 6;
    const vb = { x: b.x0 - pad, y: -(b.y1 + pad), w: b.x1 - b.x0 + pad * 2, h: b.y1 - b.y0 + pad * 2 };
    const cut = 4;
    const holes: Box[] = rl.openings
      .filter((o) => o.type !== 'open' && o.sill < cut && o.head > cut)
      .map((o) => (o.axis === 'x' ? { x0: o.u0, x1: o.u1, y0: o.wall.coord - o.wall.thickness, y1: o.wall.coord + o.wall.thickness } : { y0: o.u0, y1: o.u1, x0: o.wall.coord - o.wall.thickness, x1: o.wall.coord + o.wall.thickness }));
    const walls = wallUnion(rl.walls, holes);
    void boxMulti;
    const path = walls.map((poly) => poly.map((ring) => `M${ring.map(([x, y]) => `${x},${-y}`).join('L')}Z`).join('')).join('');
    return { vb, path };
  }, [resolved, rl]);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#f6f2ea] pb-28 pt-20" onClick={() => onPick(null)}>
      <svg viewBox={`${svg.vb.x} ${svg.vb.y} ${svg.vb.w} ${svg.vb.h}`} className="h-full w-full max-w-[1200px]" style={{ fontFamily: 'var(--font-inter)' }} data-testid="plan-svg">
        <defs>
          <pattern id="deck" width="0.5" height="0.5" patternUnits="userSpaceOnUse">
            <rect width="0.5" height="0.5" fill="#efe5d4" />
            <path d="M0 0.48H0.5" stroke="#d8c8ae" strokeWidth="0.04" />
          </pattern>
        </defs>
        {[...rl.rooms.values()].map((i) => {
          const pts = i.ring.map(([x, y]) => `${x},${-y}`).join(' ');
          const sel = selected === i.room.id;
          return (
            <polygon
              key={i.room.id}
              points={pts}
              fill={isOutdoor(i.room.type) ? 'url(#deck)' : sel ? '#f3dcc9' : '#fffdf8'}
              stroke={sel ? '#c0643a' : 'none'}
              strokeWidth={0.25}
              onClick={(e) => {
                e.stopPropagation();
                onPick(i.room.id);
              }}
              style={{ cursor: 'pointer' }}
            />
          );
        })}
        {rl.stairs.map((s) => (
          <g key={s.id} onClick={(e) => (e.stopPropagation(), onPick(s.id))} style={{ cursor: 'pointer' }}>
            {s.steps.map((st, k) => (
              <rect key={k} x={st.box.x0} y={-st.box.y1} width={st.box.x1 - st.box.x0} height={st.box.y1 - st.box.y0} fill="#f4efe6" stroke="#8a847a" strokeWidth={0.06} />
            ))}
            {s.landings.map((l, k) => (
              <rect key={`l${k}`} x={l.box.x0} y={-l.box.y1} width={l.box.x1 - l.box.x0} height={l.box.y1 - l.box.y0} fill="#f4efe6" stroke="#8a847a" strokeWidth={0.06} />
            ))}
          </g>
        ))}
        <path d={svg.path} fill="#2d2a26" fillRule="evenodd" />
        {rl.openings.map((o) => {
          if (isWindowType(o.type)) {
            const t = o.wall.thickness;
            const c = o.wall.coord;
            const lines = [-t / 2, 0, t / 2].map((d, k) =>
              o.axis === 'x' ? <line key={k} x1={o.u0} x2={o.u1} y1={-(c + d)} y2={-(c + d)} stroke="#2d2a26" strokeWidth={0.07} /> : <line key={k} y1={-o.u0} y2={-o.u1} x1={c + d} x2={c + d} stroke="#2d2a26" strokeWidth={0.07} />,
            );
            return (
              <g key={o.id} onClick={(e) => (e.stopPropagation(), onPick(o.id))} style={{ cursor: 'pointer' }}>
                {o.axis === 'x' ? <rect x={o.u0} y={-(c + t / 2)} width={o.u1 - o.u0} height={t} fill={selected === o.id ? '#f3dcc9' : '#fff'} /> : <rect x={c - t / 2} y={-o.u1} width={t} height={o.u1 - o.u0} fill={selected === o.id ? '#f3dcc9' : '#fff'} />}
                {lines}
              </g>
            );
          }
          if (isDoorType(o.type) && o.type !== 'garage_door' && o.type !== 'slider' && o.type !== 'pocket_door') {
            const leaves = o.type === 'double_door' || o.type === 'french_door' ? 2 : 1;
            const w = (o.u1 - o.u0) / leaves;
            const face = o.wall.coord + o.swingTo * (o.wall.thickness / 2);
            const arcs = [];
            for (let k = 0; k < leaves; k++) {
              const hingeU = leaves === 2 ? (k === 0 ? o.u0 : o.u1) : o.hinge === 'u0' ? o.u0 : o.u1;
              const dir = hingeU === o.u0 ? 1 : -1;
              const [hx, hy] = o.axis === 'x' ? [hingeU, face] : [face, hingeU];
              const [ex, ey] = o.axis === 'x' ? [hingeU, face + o.swingTo * w] : [face + o.swingTo * w, hingeU];
              const [fx, fy] = o.axis === 'x' ? [hingeU + dir * w, face] : [face, hingeU + dir * w];
              arcs.push(
                <g key={k}>
                  <line x1={hx} y1={-hy} x2={ex} y2={-ey} stroke="#2d2a26" strokeWidth={0.08} />
                  <path d={`M${ex},${-ey} A${w},${w} 0 0 ${sweep(o.axis, o.swingTo, dir)} ${fx},${-fy}`} fill="none" stroke="#8a847a" strokeWidth={0.05} strokeDasharray="0.25 0.18" />
                </g>,
              );
            }
            return (
              <g key={o.id} onClick={(e) => (e.stopPropagation(), onPick(o.id))} style={{ cursor: 'pointer' }}>
                {arcs}
              </g>
            );
          }
          return null;
        })}
        {[...rl.rooms.values()].map((i) => {
          if (i.room.type === 'open_to_below') return null;
          const cx = (i.box.x0 + i.box.x1) / 2;
          const cy = (i.box.y0 + i.box.y1) / 2;
          const small = Math.min(i.box.x1 - i.box.x0, i.box.y1 - i.box.y0) < 7;
          const size = small ? 0.75 : 1.05;
          return (
            <g key={`t${i.room.id}`} pointerEvents="none">
              <text x={cx} y={-cy} textAnchor="middle" fontSize={size} fill="#23211e" style={{ fontFamily: 'var(--font-fraunces)' }}>
                {i.room.name.toUpperCase()}
              </text>
              {!isOutdoor(i.room.type) && (
                <text x={cx} y={-cy + size * 1.1} textAnchor="middle" fontSize={size * 0.72} fill="#8a847a">
                  {dims(i.clearW, i.clearD)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function sweep(axis: 'x' | 'y', swingTo: 1 | -1, dir: number): 0 | 1 {
  // SVG y is flipped, so the visual sweep flips too.
  const s = axis === 'x' ? swingTo * dir : -swingTo * dir;
  return s > 0 ? 0 : 1;
}
