'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { pointInRing } from '@/core/geometry/polygon';
import type { Resolved } from '@/core/resolve';
import { walkInput, useWalkState } from './input';
import { EYE, STEP, buildWalkWorld, floorAt, freeSpot, slide } from './world';

const WALK = 4.6;
const RUN = 9;

/** First-person walking: pointer lock + WASD on desktop, drag/joystick/tap on touch. */
export function WalkControls({ resolved }: { resolved: Resolved }) {
  const { camera, gl, scene } = useThree();
  const get = useThree((t) => t.get);
  const world = useMemo(() => buildWalkWorld(resolved), [resolved]);
  const st = useRef({ x: world.spawn.x, y: world.spawn.y, z: 0, level: world.spawn.level, yaw: world.spawn.yaw, pitch: -0.05, stuck: 0 });
  const keys = useRef(new Set<string>());
  const started = useRef(false);

  // Start at the front door the first time; keep your place when the design changes.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const s = st.current;
    // Handy for scripted tests: where the walker is right now.
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __walk?: unknown }).__walk = s;
    const f = floorAt(world, s.level, s.x, s.y);
    s.z = f?.z ?? 0;
    const cam = get().camera as THREE.PerspectiveCamera;
    cam.fov = 70;
    cam.near = 0.1;
    cam.updateProjectionMatrix();
  }, [world, get]);

  useEffect(() => {
    const el = gl.domElement;
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const kd = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      keys.current.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();

    let down: { x: number; y: number; moved: boolean; id: number } | null = null;
    const pd = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    };
    const pm = (e: PointerEvent) => {
      if (document.pointerLockElement === el) {
        walkInput.lookYaw -= e.movementX * 0.0024;
        walkInput.lookPitch -= e.movementY * 0.0024;
        return;
      }
      if (!down || down.id !== e.pointerId) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
      walkInput.lookYaw += dx * 0.005;
      walkInput.lookPitch += dy * 0.005;
      down.x = e.clientX;
      down.y = e.clientY;
    };
    const pu = (e: PointerEvent) => {
      // Only presses that started on the canvas count; buttons in the overlay are not taps on the floor.
      if (!down || down.id !== e.pointerId) return;
      const wasDrag = down.moved;
      down = null;
      if (wasDrag || document.pointerLockElement === el) return;
      // A tap: walk to the floor point under it; a desktop click also grabs the mouse for looking.
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(scene.children, true).find((h) => h.face && h.object.type === 'Mesh' && Math.abs(h.face.normal.y) > 0.7 && h.point.y < st.current.z + 3);
      if (hit) walkInput.target = [hit.point.x, -hit.point.z];
      if (e.pointerType === 'mouse' && !hit) el.requestPointerLock?.();
    };
    const dbl = () => el.requestPointerLock?.();
    const lockChange = () => useWalkState.setState({ locked: document.pointerLockElement === el });

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    el.addEventListener('pointerdown', pd);
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    el.addEventListener('dblclick', dbl);
    document.addEventListener('pointerlockchange', lockChange);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      el.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
      el.removeEventListener('dblclick', dbl);
      document.removeEventListener('pointerlockchange', lockChange);
      if (document.pointerLockElement === el) document.exitPointerLock();
      walkInput.forward = walkInput.strafe = 0;
      walkInput.target = null;
    };
  }, [gl, camera, scene]);

  const lastRoom = useRef<string | null>(null);
  const lamp = useRef<THREE.PointLight>(null);

  useFrame((_, rawDt) => {
    // Slow devices take bigger steps; slide() substeps so walls still hold.
    const dt = Math.min(rawDt, 0.1);
    const s = st.current;
    if (walkInput.teleport) {
      const t = walkInput.teleport;
      // Land somewhere clear: room centers are often where the coffee table is.
      [s.x, s.y] = freeSpot(world, t.level, t.x, t.y);
      s.level = t.level;
      if (t.yaw !== undefined) s.yaw = t.yaw;
      s.z = floorAt(world, s.level, s.x, s.y)?.z ?? s.z;
      walkInput.teleport = null;
      walkInput.target = null;
    }
    s.yaw += walkInput.lookYaw;
    s.pitch = Math.max(-1.35, Math.min(1.2, s.pitch + walkInput.lookPitch));
    walkInput.lookYaw = walkInput.lookPitch = 0;

    const k = keys.current;
    let f = walkInput.forward + (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let r = walkInput.strafe + (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (k.has('ArrowLeft')) s.yaw += dt * 1.8;
    if (k.has('ArrowRight')) s.yaw -= dt * 1.8;
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') || walkInput.run ? RUN : WALK;
    const fx = -Math.sin(s.yaw);
    const fy = Math.cos(s.yaw);
    let dx = 0;
    let dy = 0;
    if (f || r) {
      walkInput.target = null;
      const n = Math.hypot(f, r);
      if (n > 1) {
        f /= n;
        r /= n;
      }
      dx = (fx * f + fy * r) * speed * dt;
      dy = (fy * f - fx * r) * speed * dt;
    } else if (walkInput.target) {
      const [tx, ty] = walkInput.target;
      const d = Math.hypot(tx - s.x, ty - s.y);
      if (d < 0.6) walkInput.target = null;
      else {
        const v = Math.min(d, WALK * 1.2 * dt);
        dx = ((tx - s.x) / d) * v;
        dy = ((ty - s.y) / d) * v;
        // Turn gently toward where we're going.
        const want = Math.atan2(-(tx - s.x), ty - s.y);
        let diff = want - s.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        s.yaw += diff * Math.min(1, dt * 4);
      }
    }

    if (dx || dy) {
      const segs = world.levels[s.level]?.segs ?? [];
      const [nx, ny] = slide(segs, s.x, s.y, dx, dy);
      const fl = floorAt(world, s.level, nx, ny, s.z);
      if (fl && fl.z - s.z <= STEP) {
        const moved = Math.hypot(nx - s.x, ny - s.y);
        s.x = nx;
        s.y = ny;
        // Climbing stairs: you belong to the higher floor once you're near its height.
        const up = world.levels[fl.level + 1];
        s.level = up && fl.z > up.elevation - 1.5 ? fl.level + 1 : fl.level;
        s.stuck = walkInput.target && moved < 0.01 ? s.stuck + dt : 0;
        if (s.stuck > 0.6) walkInput.target = null;
        s.z += (fl.z - s.z) * Math.min(1, dt * 12);
      } else if (walkInput.target) walkInput.target = null;
    } else {
      const fl = floorAt(world, s.level, s.x, s.y, s.z);
      if (fl) s.z += (fl.z - s.z) * Math.min(1, dt * 12);
    }

    camera.position.set(s.x, s.z + EYE, -s.y);
    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
    // A soft light that travels with you, so interiors never feel like caves.
    lamp.current?.position.set(s.x, s.z + EYE + 1.5, -s.y);

    // Report the room we're in for the HUD and for "this room" requests.
    const L = world.levels[s.level];
    const here = L?.floors.find((fl) => pointInRing([s.x, s.y], fl.ring));
    const id = here?.room ?? null;
    if (id !== lastRoom.current || useWalkState.getState().level !== s.level) {
      lastRoom.current = id;
      useWalkState.setState({ room: id, roomName: here?.name ?? null, level: s.level });
    }
  });

  return <pointLight ref={lamp} color="#fff1dc" intensity={22} distance={36} decay={1.6} />;
}
