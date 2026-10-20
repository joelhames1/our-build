'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Resolved } from '@/core/resolve';
import type { RenderMode } from './materials';

const GROUND: Record<string, string> = {
  grass: '#9fae7f',
  meadow: '#b2b27f',
  rock: '#a39d92',
  sand: '#d9cdb1',
  snow: '#f2f4f6',
};

/** Ground, water and trees around the house. */
export function Site({ resolved, mode }: { resolved: Resolved; mode: RenderMode }) {
  const site = resolved.project.site;
  const b = resolved.bounds;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const water = site.setting === 'island' || site.setting === 'lakefront' || site.setting === 'coast';
  const groundColor = mode === 'clay' ? '#e7e2d8' : GROUND[site.ground] ?? GROUND.grass;
  const islandR = span * 0.9 + 30;

  const trees = useMemo(() => placeTrees(resolved), [resolved]);

  return (
    <group>
      {site.setting === 'island' ? (
        <>
          <mesh rotation-x={-Math.PI / 2} position={[cx, -0.02, -cy]} receiveShadow>
            <circleGeometry args={[islandR, 64]} />
            <meshStandardMaterial color={groundColor} roughness={1} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[cx, -0.6, -cy]} receiveShadow>
            <circleGeometry args={[islandR + 6, 64]} />
            <meshStandardMaterial color={mode === 'clay' ? '#ddd6ca' : '#cdbf9f'} roughness={1} />
          </mesh>
        </>
      ) : (
        <mesh rotation-x={-Math.PI / 2} position={[cx, -0.02, -cy]} receiveShadow>
          <circleGeometry args={[water ? span * 1.2 + 40 : 900, 64]} />
          <meshStandardMaterial color={groundColor} roughness={1} />
        </mesh>
      )}
      {water && (
        <mesh rotation-x={-Math.PI / 2} position={[cx, -0.35, -cy]} receiveShadow>
          <circleGeometry args={[1400, 64]} />
          <meshStandardMaterial color={mode === 'clay' ? '#d8dee2' : '#6f93a3'} roughness={0.15} metalness={0.1} envMapIntensity={1.3} />
        </mesh>
      )}
      {!water && site.setting !== 'island' && (
        <mesh rotation-x={-Math.PI / 2} position={[cx, -0.05, -cy]}>
          <circleGeometry args={[2600, 32]} />
          <meshStandardMaterial color={groundColor} roughness={1} />
        </mesh>
      )}
      <Trees trees={trees} mode={mode} />
    </group>
  );
}

interface Tree {
  x: number;
  y: number;
  h: number;
  kind: 'conifer' | 'round';
}

function placeTrees(resolved: Resolved): Tree[] {
  const site = resolved.project.site;
  const count = site.trees === 'none' ? 0 : site.trees === 'few' ? 9 : 26;
  if (!count) return [];
  const b = resolved.bounds;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const out: Tree[] = [];
  let seed = 1337;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const front = site.front;
  const maxR = site.setting === 'island' ? span * 0.9 + 26 : span * 2.2 + 40;
  for (let i = 0; i < count * 4 && out.length < count; i++) {
    const ang = r() * Math.PI * 2;
    const rad = span * 0.75 + 14 + r() * (maxR - span * 0.75 - 14);
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    // Keep the approach and water views open.
    const dx = x - cx;
    const dy = y - cy;
    const toward = (s: string) => (s === 'S' ? -dy : s === 'N' ? dy : s === 'E' ? dx : -dx);
    if (toward(front) > Math.abs(front === 'N' || front === 'S' ? dx : dy) * 0.8) continue;
    if (site.water.some((w) => toward(w) > rad * 0.6) && site.setting !== 'island') continue;
    const conifer = site.setting === 'forest' || site.setting === 'mountain' || site.setting === 'island' || site.setting === 'lakefront' ? r() < 0.7 : r() < 0.3;
    out.push({ x, y, h: 18 + r() * 22, kind: conifer ? 'conifer' : 'round' });
  }
  return out;
}

function Trees({ trees, mode }: { trees: Tree[]; mode: RenderMode }) {
  const { conifer, round, trunks } = useMemo(() => {
    const m = new THREE.Matrix4();
    const coniferM: THREE.Matrix4[] = [];
    const roundM: THREE.Matrix4[] = [];
    const trunkM: THREE.Matrix4[] = [];
    for (const t of trees) {
      const s = t.h / 30;
      if (t.kind === 'conifer') coniferM.push(m.clone().compose(new THREE.Vector3(t.x, t.h * 0.5 + 3, -t.y), new THREE.Quaternion(), new THREE.Vector3(s * 7, t.h - 3, s * 7)));
      else roundM.push(m.clone().compose(new THREE.Vector3(t.x, t.h * 0.62, -t.y), new THREE.Quaternion(), new THREE.Vector3(s * 9, s * 10, s * 9)));
      trunkM.push(m.clone().compose(new THREE.Vector3(t.x, 2.5, -t.y), new THREE.Quaternion(), new THREE.Vector3(1, 5, 1)));
    }
    return { conifer: coniferM, round: roundM, trunks: trunkM };
  }, [trees]);
  const leaf = mode === 'clay' ? '#e2ddd2' : '#5e7454';
  const leaf2 = mode === 'clay' ? '#e6e1d7' : '#7b8d5c';
  return (
    <group>
      <Instanced matrices={conifer} color={leaf}>
        <coneGeometry args={[0.5, 1, 7]} />
      </Instanced>
      <Instanced matrices={round} color={leaf2}>
        <icosahedronGeometry args={[0.5, 1]} />
      </Instanced>
      <Instanced matrices={trunks} color={mode === 'clay' ? '#d9d3c8' : '#6b5644'}>
        <cylinderGeometry args={[0.35, 0.45, 1, 6]} />
      </Instanced>
    </group>
  );
}

function Instanced({ matrices, color, children }: { matrices: THREE.Matrix4[]; color: string; children: React.ReactNode }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((mx, i) => mesh.setMatrixAt(i, mx));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);
  if (!matrices.length) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, matrices.length]}
      castShadow
      receiveShadow
    >
      {children}
      <meshStandardMaterial color={color} roughness={0.95} flatShading />
    </instancedMesh>
  );
}
