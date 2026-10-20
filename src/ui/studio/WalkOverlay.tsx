'use client';

import { MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isOutdoor } from '@/core/model/schema';
import type { Resolved } from '@/core/resolve';
import { useStudio } from '@/lib/store/studio';
import { useWalkState, walkInput } from '@/viewer/walk/input';
import { spawnPoint } from '@/viewer/walk/world';

/** Where you are, where you can go, and (on touch screens) a joystick. */
export function WalkOverlay({ resolved }: { resolved: Resolved }) {
  const { roomName, level, locked, room } = useWalkState();
  const { selection, setSelection } = useStudio();
  const [menu, setMenu] = useState(false);
  const [touch, setTouch] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setTouch(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // "This room" means wherever you're standing, unless something is tapped.
  useEffect(() => {
    if (!room) return;
    if (selection && (selection.kind !== 'standing' || selection.id === room)) return;
    const info = resolved.levels[level]?.rooms.get(room);
    if (info) setSelection({ kind: 'standing', id: room, label: info.room.name, detail: resolved.levels[level].level.name });
  }, [room, level, resolved, selection, setSelection]);

  // Clicking anywhere else closes the menu.
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [menu]);

  const go = (t: NonNullable<typeof walkInput.teleport>) => {
    walkInput.teleport = t;
    setMenu(false);
  };

  const rooms = resolved.levels.flatMap((rl) => [...rl.rooms.values()].filter((i) => i.room.type !== 'open_to_below' && i.room.type !== 'closet').map((i) => ({ rl, i })));

  return (
    <>
      <div ref={wrap} className="pointer-events-auto absolute left-1/2 top-20 z-30 -translate-x-1/2">
        <button onClick={() => setMenu((m) => !m)} className="flex h-10 items-center gap-2 rounded-full glass px-4 text-sm text-ink" data-testid="walk-where">
          <MapPin className="h-4 w-4 text-accent" />
          <span className="font-medium">{roomName ?? 'Outside'}</span>
          {resolved.levels.length > 1 && <span className="text-muted">· {resolved.levels[level]?.level.name}</span>}
        </button>
        {menu && (
          <div className="no-scrollbar mx-auto mt-2 max-h-[min(50vh,26rem)] w-64 overflow-y-auto rounded-2xl glass p-2">
            <div className="px-2 pb-1 text-xs text-muted">Go to…</div>
            <button
              onClick={() => go(spawnPoint(resolved))}
              className="w-full rounded-xl px-3 py-2 text-left text-sm text-ink hover:bg-white/70"
            >
              The front yard
            </button>
            {rooms.map(({ rl, i }) => (
              <button
                key={i.room.id}
                onClick={() => go({ x: (i.box.x0 + i.box.x1) / 2, y: (i.box.y0 + i.box.y1) / 2, level: rl.index })}
                className="flex w-full items-baseline justify-between rounded-xl px-3 py-2 text-left text-sm text-ink hover:bg-white/70"
              >
                <span>{i.room.name}</span>
                <span className="text-xs text-muted">{isOutdoor(i.room.type) ? 'outside' : rl.level.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {touch ? (
        <Joystick />
      ) : (
        !menu && <div className="pointer-events-none absolute left-1/2 top-[7.5rem] z-10 -translate-x-1/2 rounded-full bg-ink/70 px-4 py-1.5 text-xs text-paper backdrop-blur" style={{ opacity: locked ? 0.55 : 0.9 }}>
          {locked ? 'W A S D to walk · Shift to hurry · Esc to free the mouse' : 'Drag to look · click the floor to walk there · double-click to look with the mouse'}
        </div>
      )}
    </>
  );
}

function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const R = 44;
  const update = (e: React.PointerEvent) => {
    const b = base.current!.getBoundingClientRect();
    let x = e.clientX - (b.left + b.width / 2);
    let y = e.clientY - (b.top + b.height / 2);
    const d = Math.hypot(x, y);
    if (d > R) {
      x = (x / d) * R;
      y = (y / d) * R;
    }
    setKnob([x, y]);
    walkInput.strafe = x / R;
    walkInput.forward = -y / R;
    walkInput.run = d > R * 0.95;
  };
  const end = () => {
    setKnob([0, 0]);
    walkInput.strafe = walkInput.forward = 0;
    walkInput.run = false;
  };
  return (
    <div
      ref={base}
      className="pointer-events-auto absolute bottom-36 left-6 z-20 flex h-32 w-32 touch-none items-center justify-center rounded-full border border-white/60 bg-white/30 backdrop-blur"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => e.buttons && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label="Walk joystick"
      data-testid="joystick"
    >
      <div className="h-14 w-14 rounded-full bg-white/90 shadow-lg" style={{ transform: `translate(${knob[0]}px, ${knob[1]}px)` }} />
    </div>
  );
}
