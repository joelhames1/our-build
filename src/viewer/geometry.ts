import earcut from 'earcut';
import * as THREE from 'three';
import type { Face3, V3 } from '@/core/geometry/faces';

/** Plan (x east, y north, z up) → three.js (x, y up, z south). */
export const toThree = (p: V3): [number, number, number] => [p[0], p[2], -p[1]];
export const vec = (p: V3) => new THREE.Vector3(p[0], p[2], -p[1]);

export interface MeshGroup {
  mat: string;
  geometry: THREE.BufferGeometry;
  /** owner id per triangle, for picking */
  owners: string[];
}

/** Triangulate faces and merge them into one geometry per material. */
export function facesToGroups(faces: Face3[]): MeshGroup[] {
  const by = new Map<string, { pos: number[]; nor: number[]; uv: number[]; owners: string[] }>();
  for (const f of faces) {
    let g = by.get(f.mat);
    if (!g) {
      g = { pos: [], nor: [], uv: [], owners: [] };
      by.set(f.mat, g);
    }
    appendFace(f, g);
  }
  const out: MeshGroup[] = [];
  for (const [mat, g] of by) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    out.push({ mat, geometry, owners: g.owners });
  }
  return out;
}

function appendFace(f: Face3, g: { pos: number[]; nor: number[]; uv: number[]; owners: string[] }) {
  const ul = Math.hypot(f.u[0], f.u[1], f.u[2]);
  const vl = Math.hypot(f.v[0], f.v[1], f.v[2]);
  const n = toThree(f.normal);
  for (const poly of f.polys) {
    if (!poly.length || poly[0].length < 3) continue;
    const flat: number[] = [];
    const holes: number[] = [];
    poly.forEach((ring, i) => {
      if (i > 0) holes.push(flat.length / 2);
      for (const [s, t] of ring) flat.push(s, t);
    });
    const idx = earcut(flat, holes.length ? holes : undefined, 2);
    const P = (k: number): [number, number, number] => {
      const s = flat[k * 2];
      const t = flat[k * 2 + 1];
      return toThree([f.origin[0] + s * f.u[0] + t * f.v[0], f.origin[1] + s * f.u[1] + t * f.v[1], f.origin[2] + s * f.u[2] + t * f.v[2]]);
    };
    for (let i = 0; i < idx.length; i += 3) {
      let a = idx[i];
      let b = idx[i + 1];
      const c = idx[i + 2];
      const pa = P(a);
      const pb = P(b);
      const pc = P(c);
      // Make the winding agree with the intended normal.
      const ex = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const ey = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const cx = ex[1] * ey[2] - ex[2] * ey[1];
      const cy = ex[2] * ey[0] - ex[0] * ey[2];
      const cz = ex[0] * ey[1] - ex[1] * ey[0];
      if (cx * n[0] + cy * n[1] + cz * n[2] < 0) [a, b] = [b, a];
      for (const k of [a, b, c]) {
        const p = P(k);
        g.pos.push(p[0], p[1], p[2]);
        g.nor.push(n[0], n[1], n[2]);
        g.uv.push(flat[k * 2] * ul, flat[k * 2 + 1] * vl);
      }
      g.owners.push(f.owner);
    }
  }
}

/** Collects axis-aligned (or y-rotated) boxes and merges them per material. */
export class BoxBatch {
  private by = new Map<string, { geos: THREE.BufferGeometry[]; owners: string[] }>();

  /** center/size in plan coords (x, y, z) with z up; rotation around the vertical axis in radians. */
  add(mat: string, owner: string, center: V3, size: V3, rotZ = 0) {
    const geo = new THREE.BoxGeometry(size[0], size[2], size[1]);
    if (rotZ) geo.rotateY(rotZ);
    const c = toThree(center);
    geo.translate(c[0], c[1], c[2]);
    this.push(mat, owner, geo);
  }

  /** A cylinder standing upright. */
  addCylinder(mat: string, owner: string, center: V3, radius: number, height: number, segments = 12) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, segments);
    const c = toThree(center);
    geo.translate(c[0], c[1], c[2]);
    this.push(mat, owner, geo);
  }

  push(mat: string, owner: string, geo: THREE.BufferGeometry) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    let entry = this.by.get(mat);
    if (!entry) {
      entry = { geos: [], owners: [] };
      this.by.set(mat, entry);
    }
    entry.geos.push(g);
    const tris = g.getAttribute('position').count / 3;
    for (let i = 0; i < tris; i++) entry.owners.push(owner);
  }

  build(): MeshGroup[] {
    const out: MeshGroup[] = [];
    for (const [mat, { geos, owners }] of this.by) {
      const merged = mergeNonIndexed(geos);
      geos.forEach((g) => g.dispose());
      out.push({ mat, geometry: merged, owners });
    }
    return out;
  }
}

function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const g of geos) count += g.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    pos.set(p.array as Float32Array, o * 3);
    nor.set(n.array as Float32Array, o * 3);
    if (t) uv.set(t.array as Float32Array, o * 2);
    o += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
