import * as THREE from 'three';

/**
 * Procedural, tintable textures drawn on canvas: no downloads, no licensing. Each pattern covers a
 * real-world tile size in feet; UVs are in feet, so repeat = 1 / tile.
 */
export type Pattern =
  | 'lap_siding'
  | 'board_and_batten'
  | 'shingle'
  | 'vertical_wood'
  | 'stucco'
  | 'brick'
  | 'stone'
  | 'log'
  | 'panel'
  | 'asphalt'
  | 'cedar_shake'
  | 'standing_seam'
  | 'slate'
  | 'clay_tile'
  | 'membrane'
  | 'planks'
  | 'tile'
  | 'flagstone'
  | 'concrete';

const TILE_FT: Record<Pattern, number> = {
  lap_siding: 4,
  board_and_batten: 4,
  shingle: 4,
  vertical_wood: 4,
  stucco: 6,
  brick: 4,
  stone: 6,
  log: 4,
  panel: 8,
  asphalt: 6,
  cedar_shake: 5,
  standing_seam: 6,
  slate: 5,
  clay_tile: 5,
  membrane: 8,
  planks: 6,
  tile: 4,
  flagstone: 6,
  concrete: 8,
};

const SIZE = 512;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

const cache = new Map<string, { map: THREE.Texture; bump?: THREE.Texture }>();

export function proceduralTexture(pattern: Pattern, color: string): { map: THREE.Texture; bump?: THREE.Texture } | null {
  if (typeof document === 'undefined') return null;
  const key = `${pattern}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const b = document.createElement('canvas');
  b.width = b.height = SIZE;
  const g = c.getContext('2d')!;
  const h = b.getContext('2d')!;
  const px = SIZE / TILE_FT[pattern]; // pixels per foot
  const r = rng(pattern.length * 7919 + color.charCodeAt(1) * 31);
  g.fillStyle = color;
  g.fillRect(0, 0, SIZE, SIZE);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, SIZE, SIZE);

  const line = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, style: string, w: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const noise = (amt: number, n = 2500) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${amt * r()})` : `rgba(0,0,0,${amt * r()})`;
      g.fillRect(r() * SIZE, r() * SIZE, 2, 2);
    }
  };

  switch (pattern) {
    case 'lap_siding':
    case 'log': {
      const exp = pattern === 'log' ? 0.75 : 0.5;
      const rows = Math.round(TILE_FT[pattern] / exp);
      const rh = SIZE / rows;
      for (let i = 0; i < rows; i++) {
        const y = i * rh;
        const grad = g.createLinearGradient(0, y, 0, y + rh);
        grad.addColorStop(0, shade(color, pattern === 'log' ? 0.06 : 0.03));
        grad.addColorStop(1, shade(color, pattern === 'log' ? -0.12 : -0.05));
        g.fillStyle = grad;
        g.fillRect(0, y, SIZE, rh);
        line(g, 0, y + rh - 1, SIZE, y + rh - 1, shade(color, -0.22), 3);
        const hg = h.createLinearGradient(0, y, 0, y + rh);
        hg.addColorStop(0, '#9a9a9a');
        hg.addColorStop(1, '#6a6a6a');
        h.fillStyle = hg;
        h.fillRect(0, y, SIZE, rh);
        line(h, 0, y + rh - 1, SIZE, y + rh - 1, '#202020', 4);
      }
      noise(0.04);
      break;
    }
    case 'board_and_batten':
    case 'vertical_wood': {
      const spacing = pattern === 'board_and_batten' ? 1.33 : 0.5;
      const n = Math.round(TILE_FT[pattern] / spacing);
      const w = SIZE / n;
      for (let i = 0; i < n; i++) {
        const x = i * w;
        if (pattern === 'board_and_batten') {
          g.fillStyle = shade(color, 0.04);
          g.fillRect(x - 6, 0, 12, SIZE);
          line(g, x + 7, 0, x + 7, SIZE, shade(color, -0.18), 3);
          h.fillStyle = '#b0b0b0';
          h.fillRect(x - 6, 0, 12, SIZE);
          line(h, x + 7, 0, x + 7, SIZE, '#303030', 3);
        } else {
          g.fillStyle = shade(color, (r() - 0.5) * 0.08);
          g.fillRect(x, 0, w, SIZE);
          line(g, x, 0, x, SIZE, shade(color, -0.2), 2);
          line(h, x, 0, x, SIZE, '#303030', 3);
        }
      }
      noise(0.04);
      break;
    }
    case 'shingle':
    case 'cedar_shake':
    case 'asphalt':
    case 'slate': {
      const course = pattern === 'asphalt' ? 0.42 : pattern === 'slate' ? 0.6 : 0.5;
      const rows = Math.round(TILE_FT[pattern] / course);
      const rh = SIZE / rows;
      for (let i = 0; i < rows; i++) {
        const y = i * rh;
        let x = (i % 2) * (px * 0.3) - px;
        while (x < SIZE) {
          const w = pattern === 'asphalt' ? px * 1.0 : px * (0.35 + r() * 0.45);
          g.fillStyle = shade(color, (r() - 0.5) * (pattern === 'asphalt' ? 0.03 : 0.07));
          g.fillRect(x, y, w, rh);
          line(g, x, y, x, y + rh, shade(color, -0.12), pattern === 'asphalt' ? 1.5 : 2);
          line(h, x, y, x, y + rh, '#303030', 2);
          x += w;
        }
        line(g, 0, y + rh - 1, SIZE, y + rh - 1, shade(color, -0.18), 3);
        const hg = h.createLinearGradient(0, y, 0, y + rh);
        hg.addColorStop(0, '#6a6a6a');
        hg.addColorStop(1, '#a8a8a8');
        h.fillStyle = hg;
        h.globalAlpha = 0.6;
        h.fillRect(0, y, SIZE, rh);
        h.globalAlpha = 1;
      }
      noise(pattern === 'asphalt' ? 0.05 : 0.03, 6000);
      break;
    }
    case 'clay_tile': {
      const rows = Math.round(TILE_FT[pattern] / 0.9);
      const cols = Math.round(TILE_FT[pattern] / 0.75);
      const rh = SIZE / rows;
      const cw = SIZE / cols;
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) {
          const x = j * cw;
          const y = i * rh;
          const grad = g.createLinearGradient(x, 0, x + cw, 0);
          grad.addColorStop(0, shade(color, -0.12));
          grad.addColorStop(0.5, shade(color, 0.08 + (r() - 0.5) * 0.06));
          grad.addColorStop(1, shade(color, -0.12));
          g.fillStyle = grad;
          g.fillRect(x, y, cw, rh);
          const hg = h.createLinearGradient(x, 0, x + cw, 0);
          hg.addColorStop(0, '#404040');
          hg.addColorStop(0.5, '#d0d0d0');
          hg.addColorStop(1, '#404040');
          h.fillStyle = hg;
          h.fillRect(x, y, cw, rh);
        }
      break;
    }
    case 'standing_seam': {
      const n = Math.round(TILE_FT[pattern] / 1.5);
      const w = SIZE / n;
      for (let i = 0; i < n; i++) {
        const x = i * w;
        line(g, x, 0, x, SIZE, shade(color, 0.15), 4);
        line(g, x + 4, 0, x + 4, SIZE, shade(color, -0.15), 2);
        line(h, x, 0, x, SIZE, '#ffffff', 6);
      }
      break;
    }
    case 'brick': {
      const bh = px * 0.22;
      const bw = px * 0.67;
      for (let y = 0, row = 0; y < SIZE; y += bh, row++) {
        for (let x = row % 2 ? -bw / 2 : 0; x < SIZE; x += bw) {
          g.fillStyle = shade(color, (r() - 0.5) * 0.16);
          g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        }
      }
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = '#cfc8bd';
      g.fillRect(0, 0, SIZE, SIZE);
      g.globalCompositeOperation = 'source-over';
      for (let y = 0, row = 0; y < SIZE; y += bh, row++) {
        line(h, 0, y, SIZE, y, '#202020', 4);
        for (let x = row % 2 ? -bw / 2 : 0; x < SIZE; x += bw) line(h, x, y, x, y + bh, '#202020', 4);
      }
      noise(0.05);
      break;
    }
    case 'stone':
    case 'flagstone': {
      g.fillStyle = shade(color, -0.25);
      g.fillRect(0, 0, SIZE, SIZE);
      h.fillStyle = '#202020';
      h.fillRect(0, 0, SIZE, SIZE);
      const rowsH = pattern === 'stone' ? px * 0.7 : px * 1.4;
      for (let y = 0; y < SIZE; y += rowsH * (0.7 + r() * 0.5)) {
        const hh = rowsH * (0.7 + r() * 0.5);
        for (let x = -r() * px; x < SIZE; ) {
          const w = px * (pattern === 'stone' ? 0.8 + r() * 1.2 : 1.2 + r() * 1.6);
          const inset = 4;
          g.fillStyle = shade(color, (r() - 0.5) * 0.22);
          roundRect(g, x + inset, y + inset, w - inset * 2, hh - inset * 2, 10);
          h.fillStyle = `rgb(${150 + r() * 70},${150 + r() * 70},${150 + r() * 70})`;
          roundRect(h, x + inset, y + inset, w - inset * 2, hh - inset * 2, 10);
          x += w;
        }
      }
      noise(0.06, 5000);
      break;
    }
    case 'planks': {
      const pw = px * 0.42;
      for (let y = 0; y < SIZE; y += pw) {
        for (let x = -r() * px * 4; x < SIZE; ) {
          const len = px * (3 + r() * 4);
          g.fillStyle = shade(color, (r() - 0.5) * 0.12);
          g.fillRect(x, y, len, pw);
          for (let k = 0; k < 5; k++) line(g, x, y + r() * pw, x + len, y + r() * pw, shade(color, (r() - 0.5) * 0.08), 1);
          line(g, x, y, x, y + pw, shade(color, -0.25), 2);
          line(h, x, y, x, y + pw, '#303030', 2);
          x += len;
        }
        line(g, 0, y, SIZE, y, shade(color, -0.25), 2);
        line(h, 0, y, SIZE, y, '#303030', 2);
      }
      break;
    }
    case 'tile': {
      const tw = px * 1;
      for (let y = 0; y < SIZE; y += tw)
        for (let x = 0; x < SIZE; x += tw) {
          g.fillStyle = shade(color, (r() - 0.5) * 0.05);
          g.fillRect(x + 2, y + 2, tw - 4, tw - 4);
        }
      for (let y = 0; y < SIZE; y += tw) {
        line(g, 0, y, SIZE, y, shade(color, -0.15), 3);
        line(g, y, 0, y, SIZE, shade(color, -0.15), 3);
        line(h, 0, y, SIZE, y, '#404040', 3);
        line(h, y, 0, y, SIZE, '#404040', 3);
      }
      break;
    }
    case 'panel': {
      const n = 2;
      for (let i = 0; i <= n; i++) {
        line(g, (i * SIZE) / n, 0, (i * SIZE) / n, SIZE, shade(color, -0.2), 3);
        line(h, (i * SIZE) / n, 0, (i * SIZE) / n, SIZE, '#303030', 3);
      }
      line(g, 0, SIZE / 2, SIZE, SIZE / 2, shade(color, -0.15), 2);
      break;
    }
    case 'stucco':
    case 'concrete':
    case 'membrane':
    default:
      noise(pattern === 'stucco' ? 0.06 : 0.04, 14000);
      for (let i = 0; i < 9000; i++) {
        const v = 110 + r() * 50;
        h.fillStyle = `rgb(${v},${v},${v})`;
        h.fillRect(r() * SIZE, r() * SIZE, 2, 2);
      }
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(b);
  for (const t of [map, bump]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / TILE_FT[pattern], 1 / TILE_FT[pattern]);
    t.anisotropy = 8;
  }
  const out = { map, bump };
  cache.set(key, out);
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w <= 0 || h <= 0) return;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
