import * as THREE from 'three';
import type { Style } from '@/core/model/schema';
import { proceduralTexture } from './textures';

export type RenderMode = 'clay' | 'materials';

const FLOOR: Record<string, string> = {
  oak: '#c49a6c',
  walnut: '#7a5538',
  pine: '#d8b583',
  tile: '#dcd8cf',
  stone: '#aaa49a',
  carpet: '#bdb5a8',
  concrete: '#b7b4ae',
  deck: '#9d7a58',
};

const CLAY = '#f2eee7';
const CLAY_DARK = '#e6e0d6';

/** Texture pattern for a material key in materials mode. */
function patternFor(key: string, style: Style): Parameters<typeof proceduralTexture>[0] | null {
  if (key === 'siding') return style.wall;
  if (key === 'roof') return style.roofMaterial;
  if (key.startsWith('floor:')) {
    const f = key.slice(6);
    if (f === 'oak' || f === 'walnut' || f === 'pine' || f === 'deck') return 'planks';
    if (f === 'tile') return 'tile';
    if (f === 'stone') return 'flagstone';
    return null;
  }
  if (key === 'stone') return 'stone';
  if (key === 'brick') return 'brick';
  if (key === 'foundation') return style.foundation === 'stone_plinth' ? 'stone' : 'concrete';
  return null;
}

export function colorFor(key: string, style: Style, mode: RenderMode): string {
  if (key === 'glass') return '#a9c1cc';
  if (key === 'cap') return '#4a4541';
  if (key === 'flue') return mode === 'clay' ? CLAY_DARK : '#8a5a44';
  if (key === 'cap_stone') return mode === 'clay' ? CLAY_DARK : '#8f8a82';
  if (mode === 'clay') {
    if (key === 'roof' || key === 'fascia' || key === 'stair') return CLAY_DARK;
    if (key.startsWith('floor:')) return '#ebe6dd';
    if (key === 'foundation' || key === 'stone' || key === 'brick') return '#ddd7cc';
    if (key === 'metal') return '#bdb7ae';
    return CLAY;
  }
  if (key === 'siding') return style.wallColor;
  if (key.startsWith('paint:')) return key.slice(6);
  if (key.startsWith('floor:')) return FLOOR[key.slice(6)] ?? FLOOR.oak;
  switch (key) {
    case 'roof':
      return style.roofColor;
    case 'soffit':
    case 'trim':
    case 'sill':
      return style.trimColor;
    case 'trim_int':
    case 'door_int':
      return '#f7f5f0';
    case 'ceiling':
      return '#f8f6f1';
    case 'window_frame':
      return style.windowColor;
    case 'door':
      return style.doorColor;
    case 'metal':
      return '#3b3a38';
    case 'stair':
      return FLOOR[style.floor] ?? FLOOR.oak;
    case 'foundation':
      return '#9a958d';
    case 'stone':
      return '#a39c90';
    case 'brick':
      return '#9b5a43';
    default:
      return '#dddddd';
  }
}

const cache = new Map<string, THREE.Material>();

export function materialFor(key: string, style: Style, mode: RenderMode): THREE.Material {
  const pattern = mode === 'materials' ? patternFor(key, style) : null;
  const color = colorFor(key, style, mode);
  const ck = `${mode}|${key}|${color}|${pattern ?? ''}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  let m: THREE.Material;
  if (key === 'glass') {
    m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35, envMapIntensity: 1.2, depthWrite: false });
  } else {
    const std = new THREE.MeshStandardMaterial({
      color,
      roughness: key === 'metal' ? 0.4 : key === 'roof' && style.roofMaterial === 'standing_seam' ? 0.55 : 0.88,
      metalness: key === 'metal' ? 0.6 : key === 'roof' && style.roofMaterial === 'standing_seam' ? 0.35 : 0,
    });
    if (pattern) {
      const tex = proceduralTexture(pattern, color);
      if (tex) {
        std.map = tex.map;
        std.color = new THREE.Color('#ffffff');
        if (tex.bump) {
          std.bumpMap = tex.bump;
          std.bumpScale = 1.2;
        }
      }
    }
    if (key === 'siding' || key.startsWith('paint:')) darkBacks(std);
    m = std;
  }
  cache.set(ck, m);
  return m;
}

/** Walls render both sides; the back side shows as dark poché where a wall is cut open. */
function darkBacks(m: THREE.MeshStandardMaterial) {
  m.side = THREE.DoubleSide;
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\n  if (!gl_FrontFacing) gl_FragColor = vec4(0.27, 0.25, 0.235, 1.0);',
    );
  };
  m.customProgramCacheKey = () => 'dark-backs';
}
