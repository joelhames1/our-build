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

/** Furniture colors: [clay model, materials]. */
const FURNITURE: Record<string, [string, string]> = {
  fabric: ['#e4ddd2', '#b9b0a3'],
  cushion: ['#ebe5db', '#d3c9bb'],
  linen: ['#f7f4ee', '#f4f1ea'],
  blanket: ['#ddd6ca', '#9fb0b8'],
  wood: ['#e2d9cc', '#b08a62'],
  wood_dark: ['#cfc6b8', '#6b5240'],
  cabinet: ['#ece7de', '#e9e5dc'],
  toekick: ['#d6cfc3', '#4a4642'],
  counter: ['#f6f3ee', '#d8d4cc'],
  steel: ['#dcd8d1', '#c3c5c6'],
  appliance: ['#efebe4', '#f1f0ec'],
  porcelain: ['#fbfaf7', '#fbfbf8'],
  porcelain_in: ['#f1eee8', '#e9eef0'],
  mirror: ['#e9eef0', '#cfd8dc'],
  screen: ['#cdc6bb', '#1f2124'],
  shade: ['#f6f2ea', '#f3ead9'],
  rug: ['#e6dfd3', '#c9b7a0'],
  rug_border: ['#ded6c9', '#b39c80'],
  books: ['#ded6ca', '#8a5a4a'],
  books2: ['#e4ddd2', '#51656e'],
  books3: ['#dcd4c7', '#c8b48e'],
  pot: ['#e0d5c6', '#b5734f'],
  plant: ['#d6d9c8', '#61804f'],
  firebox: ['#bfb7ab', '#2a2522'],
  car: ['#ddd6cb', '#6d7f8c'],
  car_glass: ['#d3cdc3', '#38434a'],
  tire: ['#c7c0b5', '#26282a'],
  water: ['#dfe7e8', '#7fb3c2'],
};

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
  const fur = FURNITURE[key];
  if (fur) return fur[mode === 'clay' ? 0 : 1];
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
      roughness: key === 'metal' ? 0.4 : key === 'steel' ? 0.35 : key === 'mirror' ? 0.05 : key === 'porcelain' || key === 'counter' ? 0.3 : key === 'roof' && style.roofMaterial === 'standing_seam' ? 0.55 : 0.88,
      metalness: key === 'metal' ? 0.6 : key === 'steel' && mode === 'materials' ? 0.55 : key === 'mirror' && mode === 'materials' ? 0.9 : key === 'roof' && style.roofMaterial === 'standing_seam' ? 0.35 : 0,
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
