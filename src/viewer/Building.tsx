'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Resolved } from '@/core/resolve';
import { buildFaces } from '@/core/geometry/faces';
import { type MeshGroup, facesToGroups } from './geometry';
import { type RenderMode, materialFor } from './materials';
import { buildParts } from './parts';

export interface BuildingProps {
  resolved: Resolved;
  mode: RenderMode;
  /** Dollhouse: show levels up to this one, cut at 4.5 ft. */
  cutLevel?: number;
  doorsOpen?: boolean;
  onPick?: (owner: string, point: THREE.Vector3, e: { shiftKey?: boolean }) => void;
  selected?: string | null;
}

export const DOLLHOUSE_CUT = 4.5;

export function Building({ resolved, mode, cutLevel, doorsOpen, onPick, selected }: BuildingProps) {
  const groups = useMemo<MeshGroup[]>(() => {
    const cut = cutLevel !== undefined ? { cutLevel, cutHeight: DOLLHOUSE_CUT } : {};
    const faces = buildFaces(resolved, cut);
    return [...facesToGroups(faces), ...buildParts(resolved, { ...cut, doorsOpen })];
  }, [resolved, cutLevel, doorsOpen]);

  useEffect(() => () => groups.forEach((g) => g.geometry.dispose()), [groups]);

  const style = resolved.project.style;
  return (
    <group>
      {groups.map((g, i) => {
        const mat = materialFor(g.mat, style, mode);
        const isGlass = g.mat === 'glass';
        return (
          <mesh
            key={`${g.mat}-${i}`}
            geometry={g.geometry}
            material={mat}
            castShadow={!isGlass}
            receiveShadow
            userData={{ owners: g.owners, mat: g.mat }}
            onClick={
              onPick
                ? (e) => {
                    e.stopPropagation();
                    const owner = e.faceIndex !== undefined && e.faceIndex !== null ? g.owners[e.faceIndex] : undefined;
                    if (owner) onPick(owner, e.point, { shiftKey: e.nativeEvent.shiftKey });
                  }
                : undefined
            }
          />
        );
      })}
      {selected ? <Highlight groups={groups} owner={selected} /> : null}
    </group>
  );
}

/** Re-draws the selected element's triangles with a soft glow on top. */
function Highlight({ groups, owner }: { groups: MeshGroup[]; owner: string }) {
  const geo = useMemo(() => {
    const pos: number[] = [];
    for (const g of groups) {
      const p = g.geometry.getAttribute('position');
      g.owners.forEach((o, tri) => {
        if (o !== owner) return;
        for (let k = 0; k < 3; k++) {
          const i = tri * 3 + k;
          pos.push(p.getX(i), p.getY(i), p.getZ(i));
        }
      });
    }
    if (!pos.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, [groups, owner]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <mesh geometry={geo} renderOrder={10}>
      <meshBasicMaterial color="#e58a3c" transparent opacity={0.35} depthTest={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
