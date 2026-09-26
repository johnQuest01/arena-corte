/**
 * world.ts — cenário estático pintado por código: asfalto com faixas, meio-fio,
 * calçadas, terreno (grama/terra), praças, pisos internos, paredes com volume,
 * carros, caixas, barris, postes e telhados.
 *
 * Desempenho: o mundo é pintado em CHUNKS (256 px) sob demanda e guardado num
 * cache LRU. Por frame só há drawImage dos chunks visíveis (+1 chunk pré-pintado
 * por frame em volta da câmera). Substitui o cache único 5120×3840 (≈78 MB e
 * acima do limite de canvas do iOS — o chão sumia no iPhone).
 */
import { ARENA_H, ARENA_W } from "../../../shared/constants";
import {
  BUILDINGS,
  DOOR_DEFS,
  GROUND,
  MAP_H,
  MAP_W,
  ROAD_PITCH,
  ROAD_WIDTH,
  SOLID,
  T,
  TILE,
  roofRect,
  type BuildingDef,
} from "../../../shared/map";
import { FX_MOBILE } from "./abilities_fx";

type RGB = [number, number, number];

/* ------------------------------------------------------------------ */
/* hash / ruído determinísticos                                        */
/* ------------------------------------------------------------------ */

/** Hash inteiro → [0,1). Mesmo resultado em qualquer chunk (sem costura). */
function h2(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

/** Value noise contínuo (coordenadas em "células"). */
function vnoise(x: number, y: number, salt: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = h2(xi, yi, salt);
  const b = h2(xi + 1, yi, salt);
  const c = h2(xi, yi + 1, salt);
  const d = h2(xi + 1, yi + 1, salt);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Value noise que repete a cada `period` células (textura sem emenda). */
function tileNoise(x: number, y: number, period: number, salt: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = h2(x0, y0, salt);
  const b = h2(x1, y0, salt);
  const c = h2(x0, y1, salt);
  const d = h2(x1, y1, salt);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, salt: number): number {
  return vnoise(x, y, salt) * 0.62 + vnoise(x * 2.03, y * 2.03, salt + 7) * 0.26 + vnoise(x * 4.1, y * 4.1, salt + 13) * 0.12;
}

function rgb(c: RGB, a = 1): string {
  return a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

function shade(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/* ------------------------------------------------------------------ */
/* paleta                                                              */
/* ------------------------------------------------------------------ */

const PAL = {
  asphalt: [60, 62, 66] as RGB,
  sidewalk: [150, 146, 137] as RGB,
  curb: [190, 185, 174] as RGB,
  grass: [92, 112, 60] as RGB,
  dirt: [124, 103, 74] as RGB,
  plaza: [162, 155, 142] as RGB,
  wood: [126, 86, 52] as RGB,
  indoor: [120, 122, 118] as RGB,
  roofFlat: [92, 94, 92] as RGB,
  laneYellow: "rgba(224,186,70,",
  laneWhite: "rgba(222,218,204,",
};

/* ------------------------------------------------------------------ */
/* texturas-base (geradas 1× — ImageData 128×128)                      */
/* ------------------------------------------------------------------ */

interface TexParams {
  grain: number;
  blot: number;
  blotScale: number;
  blot2?: number;
  blotScale2?: number;
  speck?: number;
  speckRGB?: RGB;
  /** agrupa linhas (riscos verticais — grama) */
  streak?: number;
  /** variação só no canal verde (grama viva/seca) */
  greenVar?: number;
  salt: number;
}

const TEX_SIZE = 128;

function makeTexture(base: RGB, p: TexParams): HTMLCanvasElement {
  const size = TEX_SIZE;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  const d = img.data;
  const P1 = Math.max(1, Math.round(size / p.blotScale));
  const P2 = p.blotScale2 ? Math.max(1, Math.round(size / p.blotScale2)) : 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gy = p.streak ? Math.floor(y / p.streak) : y;
      let v = (h2(x, gy, p.salt) - 0.5) * p.grain;
      v += (tileNoise(x / p.blotScale, y / p.blotScale, P1, p.salt + 3) - 0.5) * p.blot;
      if (p.blot2 && p.blotScale2) {
        v += (tileNoise(x / p.blotScale2, y / p.blotScale2, P2, p.salt + 9) - 0.5) * p.blot2;
      }
      let r = base[0] + v;
      let gg = base[1] + v;
      let b = base[2] + v;
      if (p.greenVar) {
        const gv = (tileNoise(x / 16, y / 16, size / 16, p.salt + 21) - 0.5) * p.greenVar;
        r += gv * 0.9;
        gg += gv * 0.35;
        b -= gv * 0.2;
      }
      if (p.speck && h2(x, y, p.salt + 1) < p.speck) {
        const s = p.speckRGB ?? ([base[0] + 34, base[1] + 34, base[2] + 34] as RGB);
        const t = 0.35 + h2(x, y, p.salt + 2) * 0.55;
        r += (s[0] - r) * t;
        gg += (s[1] - gg) * t;
        b += (s[2] - b) * t;
      }
      const i = (y * size + x) * 4;
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
      d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

interface TexSet {
  asphalt: HTMLCanvasElement;
  sidewalk: HTMLCanvasElement;
  grass: HTMLCanvasElement;
  dirt: HTMLCanvasElement;
  plaza: HTMLCanvasElement;
  indoor: HTMLCanvasElement;
  roofFlat: HTMLCanvasElement;
}

let TEX: TexSet | null = null;

function ensureTextures(): TexSet {
  if (TEX) return TEX;
  TEX = {
    asphalt: makeTexture(PAL.asphalt, {
      grain: 16,
      blot: 10,
      blotScale: 32,
      blot2: 6,
      blotScale2: 8,
      speck: 0.05,
      speckRGB: [104, 104, 100],
      salt: 11,
    }),
    sidewalk: makeTexture(PAL.sidewalk, {
      grain: 10,
      blot: 9,
      blotScale: 32,
      speck: 0.035,
      speckRGB: [118, 114, 106],
      salt: 23,
    }),
    grass: makeTexture(PAL.grass, {
      grain: 26,
      blot: 14,
      blotScale: 32,
      blot2: 8,
      blotScale2: 8,
      streak: 3,
      greenVar: 26,
      speck: 0.025,
      speckRGB: [150, 150, 86],
      salt: 37,
    }),
    dirt: makeTexture(PAL.dirt, {
      grain: 18,
      blot: 14,
      blotScale: 32,
      blot2: 6,
      blotScale2: 8,
      speck: 0.05,
      speckRGB: [158, 146, 124],
      salt: 41,
    }),
    plaza: makeTexture(PAL.plaza, {
      grain: 9,
      blot: 10,
      blotScale: 64,
      speck: 0.03,
      speckRGB: [128, 122, 110],
      salt: 53,
    }),
    indoor: makeTexture(PAL.indoor, {
      grain: 7,
      blot: 12,
      blotScale: 64,
      speck: 0.015,
      salt: 67,
    }),
    roofFlat: makeTexture(PAL.roofFlat, {
      grain: 22,
      blot: 8,
      blotScale: 32,
      speck: 0.08,
      speckRGB: [132, 132, 126],
      salt: 71,
    }),
  };
  return TEX;
}

/* ------------------------------------------------------------------ */
/* classificação do mapa (1× no load)                                  */
/* ------------------------------------------------------------------ */

const M_ASPHALT = 0;
const M_SIDEWALK = 1;
const M_GRASS = 2;
const M_DIRT = 3;
const M_PLAZA = 4;
const M_WOOD = 5;
const M_INDOOR = 6;
const M_RUBBLE = 7;

const MAT = new Uint8Array(MAP_W * MAP_H);
/** Centro de cada praça (mosaico decorativo no piso). */
const PLAZA_CENTERS: { x: number; y: number }[] = [];
/** id do prédio (interior) ou -1 */
const INSIDE = new Int16Array(MAP_W * MAP_H).fill(-1);

function inMap(tx: number, ty: number) {
  return tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H;
}

function mat(tx: number, ty: number): number {
  if (!inMap(tx, ty)) return M_GRASS;
  return MAT[ty * MAP_W + tx]!;
}

function solidAt(tx: number, ty: number): number {
  if (!inMap(tx, ty)) return T.WALL;
  return SOLID[ty]![tx]!;
}

function isWallT(t: number) {
  return t === T.WALL || t === T.METAL;
}

function isBorder(tx: number, ty: number) {
  return tx <= 0 || ty <= 0 || tx >= MAP_W - 1 || ty >= MAP_H - 1;
}

(function classify() {
  for (const b of BUILDINGS) {
    const i = b.interior;
    for (let y = i.ty; y < i.ty + i.th; y++) {
      for (let x = i.tx; x < i.tx + i.tw; x++) {
        if (inMap(x, y)) INSIDE[y * MAP_W + x] = b.id;
      }
    }
  }
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const g = GROUND[y]![x]!;
      const k = y * MAP_W + x;
      let m = M_GRASS;
      if (INSIDE[k]! >= 0) {
        m = g === T.WOOD ? M_WOOD : M_INDOOR;
      } else if (g === T.ROAD || g === T.ROAD_LINE) m = M_ASPHALT;
      else if (g === T.SIDEWALK) m = M_SIDEWALK;
      else if (g === T.DIRT || g === T.SAND) m = M_DIRT;
      else if (g === T.WOOD) m = M_WOOD;
      else if (g === T.CONCRETE) m = M_RUBBLE; // decidido abaixo (praça x entulho)
      MAT[k] = m;
    }
  }
  // concreto: componente grande = praça; pedacinho solto no mato = entulho
  const seen = new Uint8Array(MAP_W * MAP_H);
  const stack: number[] = [];
  for (let k0 = 0; k0 < MAP_W * MAP_H; k0++) {
    if (seen[k0] || MAT[k0] !== M_RUBBLE) continue;
    const comp: number[] = [];
    stack.push(k0);
    seen[k0] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      const x = k % MAP_W;
      const y = (k / MAP_W) | 0;
      const nb = [
        x > 0 ? k - 1 : -1,
        x < MAP_W - 1 ? k + 1 : -1,
        y > 0 ? k - MAP_W : -1,
        y < MAP_H - 1 ? k + MAP_W : -1,
      ];
      for (const n of nb) {
        if (n < 0 || seen[n] || MAT[n] !== M_RUBBLE) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (comp.length >= 16) {
      let sx = 0;
      let sy = 0;
      for (const k of comp) {
        MAT[k] = M_PLAZA;
        sx += k % MAP_W;
        sy += (k / MAP_W) | 0;
      }
      PLAZA_CENTERS.push({
        x: Math.round(sx / comp.length) * TILE,
        y: Math.round(sy / comp.length) * TILE,
      });
    }
  }
})();

/** Carros: pares de tiles CAR fundidos num retângulo (global, determinístico). */
interface CarRect {
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
}
const CARS: CarRect[] = (() => {
  const out: CarRect[] = [];
  const used = new Uint8Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const k = y * MAP_W + x;
      if (used[k] || SOLID[y]![x] !== T.CAR) continue;
      used[k] = 1;
      if (x + 1 < MAP_W && SOLID[y]![x + 1] === T.CAR && !used[k + 1]) {
        used[k + 1] = 1;
        out.push({ x: x * TILE, y: y * TILE, w: TILE * 2, h: TILE, seed: k });
      } else if (y + 1 < MAP_H && SOLID[y + 1]![x] === T.CAR && !used[k + MAP_W]) {
        used[k + MAP_W] = 1;
        out.push({ x: x * TILE, y: y * TILE, w: TILE, h: TILE * 2, seed: k });
      } else {
        out.push({ x: x * TILE, y: y * TILE, w: TILE, h: TILE, seed: k });
      }
    }
  }
  return out;
})();

/** Postes: esquina da calçada de alguns quarteirões (só decoração). */
const LAMPS: { x: number; y: number }[] = (() => {
  const out: { x: number; y: number }[] = [];
  for (let by = 0; by < MAP_H; by += ROAD_PITCH) {
    for (let bx = 0; bx < MAP_W; bx += ROAD_PITCH) {
      const corners: [number, number][] = [
        [bx + ROAD_WIDTH, by + ROAD_WIDTH],
        [bx + ROAD_PITCH - 1, by + ROAD_PITCH - 1],
      ];
      for (let i = 0; i < corners.length; i++) {
        const [tx, ty] = corners[i]!;
        if (!inMap(tx, ty) || isBorder(tx, ty)) continue;
        if (SOLID[ty]![tx]! >= 10) continue;
        if (mat(tx, ty) !== M_SIDEWALK) continue;
        if (h2(bx, by, 91 + i) < 0.45) continue;
        out.push({ x: tx * TILE + (i === 0 ? 9 : 23), y: ty * TILE + (i === 0 ? 9 : 23) });
      }
    }
  }
  return out;
})();

/* ------------------------------------------------------------------ */
/* pintura de um chunk                                                 */
/* ------------------------------------------------------------------ */

const CH = 256;
const GUT = 2;
const MARGIN = 2;
const NCX = Math.ceil(ARENA_W / CH);
const NCY = Math.ceil(ARENA_H / CH);

interface Pats {
  asphalt: CanvasPattern;
  sidewalk: CanvasPattern;
  grass: CanvasPattern;
  dirt: CanvasPattern;
  plaza: CanvasPattern;
  indoor: CanvasPattern;
}

function makePats(g: CanvasRenderingContext2D): Pats {
  const t = ensureTextures();
  const p = (c: HTMLCanvasElement) => g.createPattern(c, "repeat")!;
  return {
    asphalt: p(t.asphalt),
    sidewalk: p(t.sidewalk),
    grass: p(t.grass),
    dirt: p(t.dirt),
    plaza: p(t.plaza),
    indoor: p(t.indoor),
  };
}

function baseFill(m: number, pats: Pats): string | CanvasPattern {
  switch (m) {
    case M_ASPHALT:
      return pats.asphalt;
    case M_SIDEWALK:
      return pats.sidewalk;
    case M_PLAZA:
      return pats.plaza;
    case M_WOOD:
      return rgb(PAL.wood);
    case M_INDOOR:
      return pats.indoor;
    case M_DIRT:
    case M_RUBBLE:
    case M_GRASS:
    default:
      return pats.grass;
  }
}

interface Region {
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
}

/** Pass 1 — base por material (runs horizontais = poucas chamadas). */
function paintBase(g: CanvasRenderingContext2D, r: Region, pats: Pats) {
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    let start = r.tx0;
    let cur = mat(r.tx0, ty);
    for (let tx = r.tx0 + 1; tx <= r.tx1 + 1; tx++) {
      const m = tx <= r.tx1 ? mat(tx, ty) : -1;
      if (m === cur) continue;
      g.fillStyle = baseFill(cur, pats);
      g.fillRect(start * TILE, ty * TILE, (tx - start) * TILE, TILE);
      start = tx;
      cur = m;
    }
  }
}

function isLot(m: number) {
  return m === M_GRASS || m === M_DIRT || m === M_RUBBLE;
}

/** Polígono irregular (borda "comida") — terra/entulho sem cara de bolinha. */
function blobPath(p: Path2D, cx: number, cy: number, rad: number, seed: number) {
  const n = 11;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.72 + h2(seed, i % n, 105) * 0.5;
    const x = cx + Math.cos(a) * rad * k;
    const y = cy + Math.sin(a) * rad * k * 0.86;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
}

/** Terreno baldio: manchas de terra orgânicas + variação de tom. */
function paintLots(g: CanvasRenderingContext2D, r: Region, pats: Pats) {
  // recorte: nada do baldio vaza pra calçada/rua
  const clip = new Path2D();
  let anyLot = false;
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      if (!isLot(mat(tx, ty))) continue;
      clip.rect(tx * TILE, ty * TILE, TILE, TILE);
      anyLot = true;
    }
  }
  if (!anyLot) return;
  g.save();
  g.clip(clip);
  // manchas grandes e suaves de tom (quebram a repetição da textura)
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      if (!isLot(mat(tx, ty))) continue;
      const hh = h2(tx, ty, 101);
      if (hh > 0.22) continue;
      const cx = tx * TILE + 16 + (h2(tx, ty, 102) - 0.5) * 20;
      const cy = ty * TILE + 16 + (h2(tx, ty, 103) - 0.5) * 20;
      const rad = 26 + h2(tx, ty, 104) * 34;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      if (hh < 0.11) {
        grd.addColorStop(0, "rgba(34,52,18,0.2)");
        grd.addColorStop(1, "rgba(34,52,18,0)");
      } else {
        grd.addColorStop(0, "rgba(178,170,92,0.16)");
        grd.addColorStop(1, "rgba(178,170,92,0)");
      }
      g.fillStyle = grd;
      g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
  }
  // terra: poucos blobs grandes e irregulares onde o ruído é alto
  const edge = new Path2D();
  const fill = new Path2D();
  let any = false;
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      const m = mat(tx, ty);
      if (!isLot(m)) continue;
      const d = fbm(tx / 9, ty / 9, 5);
      let k = 0;
      let big = 1;
      if (m === M_DIRT) {
        k = h2(tx, ty, 107) < 0.55 ? 1 : 0;
        big = 0.9;
      } else if (m === M_RUBBLE) {
        k = 1;
        big = 0.8;
      } else if (d > 0.72) {
        k = 2;
        big = 1.25;
      } else if (d > 0.66) {
        k = 1;
        big = 1.05;
      } else if (d > 0.63 && h2(tx, ty, 106) < 0.4) {
        k = 1;
        big = 0.75;
      }
      for (let i = 0; i < k; i++) {
        const cx = tx * TILE + 16 + (h2(tx, ty, 110 + i) - 0.5) * 18;
        const cy = ty * TILE + 16 + (h2(tx, ty, 120 + i) - 0.5) * 18;
        const rad = (13 + h2(tx, ty, 130 + i) * 9) * big;
        const seed = tx * 131 + ty * 71 + i;
        blobPath(edge, cx, cy, rad + 2, seed);
        blobPath(fill, cx, cy, rad, seed);
        any = true;
      }
    }
  }
  if (any) {
    g.fillStyle = "rgba(70,62,34,0.2)";
    g.fill(edge);
    g.fillStyle = pats.dirt;
    g.fill(fill);
  }
  // entulho de concreto (tiles de concreto soltos no mato)
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      if (mat(tx, ty) !== M_RUBBLE) continue;
      const n = 2 + Math.floor(h2(tx, ty, 140) * 2);
      for (let i = 0; i < n; i++) {
        const cx = tx * TILE + 6 + h2(tx, ty, 141 + i) * 20;
        const cy = ty * TILE + 6 + h2(tx, ty, 151 + i) * 20;
        const sz = 3 + h2(tx, ty, 161 + i) * 5;
        const rot = h2(tx, ty, 171 + i) * Math.PI;
        g.save();
        g.translate(cx, cy);
        g.rotate(rot);
        g.fillStyle = "rgba(20,18,16,0.3)";
        g.fillRect(-sz + 1.5, -sz * 0.6 + 1.5, sz * 2, sz * 1.2);
        g.fillStyle = i % 2 ? "#a19b90" : "#8f897e";
        g.beginPath();
        g.moveTo(-sz, -sz * 0.5);
        g.lineTo(sz * 0.7, -sz * 0.6);
        g.lineTo(sz, sz * 0.4);
        g.lineTo(-sz * 0.4, sz * 0.6);
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.fillRect(-sz * 0.8, -sz * 0.5, sz * 1.2, 1);
        g.restore();
      }
    }
  }
  g.restore();
}

/** Asfalto: remendos, rachaduras, manchas de óleo, poças, marcas de pneu. */
function paintAsphaltDetail(g: CanvasRenderingContext2D, r: Region) {
  const cracks = new Path2D();
  const crackHi = new Path2D();
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      if (mat(tx, ty) !== M_ASPHALT) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      const a = h2(tx, ty, 201);
      if (a < 0.07) {
        // remendo
        const w = 18 + h2(tx, ty, 202) * 30;
        const hh = 14 + h2(tx, ty, 203) * 24;
        const px = x + h2(tx, ty, 204) * 12;
        const py = y + h2(tx, ty, 205) * 12;
        g.fillStyle = "rgba(30,31,36,0.22)";
        g.fillRect(px, py, w, hh);
        g.strokeStyle = "rgba(120,120,116,0.1)";
        g.lineWidth = 1;
        g.strokeRect(px + 0.5, py + 0.5, w - 1, hh - 1);
      }
      if (a > 0.8) {
        // rachadura em zigue-zague
        let cx = x + h2(tx, ty, 206) * 32;
        let cy = y + h2(tx, ty, 207) * 32;
        let ang = h2(tx, ty, 208) * Math.PI * 2;
        cracks.moveTo(cx, cy);
        crackHi.moveTo(cx + 1, cy + 1);
        const seg = 3 + Math.floor(h2(tx, ty, 209) * 4);
        for (let i = 0; i < seg; i++) {
          ang += (h2(tx, ty, 210 + i) - 0.5) * 1.6;
          const len = 5 + h2(tx, ty, 220 + i) * 9;
          cx += Math.cos(ang) * len;
          cy += Math.sin(ang) * len;
          cracks.lineTo(cx, cy);
          crackHi.lineTo(cx + 1, cy + 1);
        }
      }
      const oil = h2(tx, ty, 230);
      if (oil < 0.035) {
        const ox = x + 6 + h2(tx, ty, 231) * 20;
        const oy = y + 6 + h2(tx, ty, 232) * 20;
        g.fillStyle = "rgba(12,12,16,0.26)";
        g.beginPath();
        g.ellipse(ox, oy, 7 + h2(tx, ty, 233) * 9, 5 + h2(tx, ty, 234) * 6, h2(tx, ty, 235) * 3, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(90,70,120,0.07)";
        g.beginPath();
        g.ellipse(ox - 2, oy - 1, 4, 2.5, 0.4, 0, Math.PI * 2);
        g.fill();
      } else if (oil > 0.992) {
        // poça (reflete céu)
        const ox = x + 16;
        const oy = y + 16;
        g.fillStyle = "rgba(92,112,132,0.45)";
        g.beginPath();
        g.ellipse(ox, oy, 16, 9, 0.2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(190,210,225,0.22)";
        g.beginPath();
        g.ellipse(ox - 4, oy - 2, 8, 2.5, 0.2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = "rgba(120,120,118,0.1)";
  g.lineWidth = 1;
  g.stroke(crackHi);
  g.strokeStyle = "rgba(16,16,18,0.6)";
  g.lineWidth = 1.2;
  g.stroke(cracks);
}

/** Calçada: juntas das placas + variação de tom + rachaduras. */
function paintSidewalks(g: CanvasRenderingContext2D, r: Region) {
  const joints = new Path2D();
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      if (mat(tx, ty) !== M_SIDEWALK) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      const a = h2(tx, ty, 301);
      if (a < 0.2) {
        g.fillStyle = "rgba(0,0,0,0.055)";
        g.fillRect(x, y, TILE, TILE);
      } else if (a > 0.84) {
        g.fillStyle = "rgba(255,255,255,0.05)";
        g.fillRect(x, y, TILE, TILE);
      }
      joints.rect(x, y, TILE, 1);
      joints.rect(x, y, 1, TILE);
      if (a > 0.955) {
        g.strokeStyle = "rgba(60,56,50,0.5)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x + 4, y + 6 + h2(tx, ty, 302) * 10);
        g.lineTo(x + 14, y + 14);
        g.lineTo(x + 27, y + 10 + h2(tx, ty, 303) * 16);
        g.stroke();
      }
    }
  }
  g.fillStyle = "rgba(74,70,64,0.55)";
  g.fill(joints);
}

/** Praças: placas grandes (64 px) + musgo nas juntas. */
function paintPlazas(g: CanvasRenderingContext2D, r: Region) {
  const joints = new Path2D();
  const moss = new Path2D();
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      if (mat(tx, ty) !== M_PLAZA) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      const px = Math.floor(tx / 2);
      const py = Math.floor(ty / 2);
      const tone = h2(px, py, 401);
      if (tone < 0.25) {
        g.fillStyle = "rgba(0,0,0,0.05)";
        g.fillRect(x, y, TILE, TILE);
      } else if (tone > 0.8) {
        g.fillStyle = "rgba(255,240,210,0.05)";
        g.fillRect(x, y, TILE, TILE);
      }
      if (tx % 2 === 0) joints.rect(x, y, 1.5, TILE);
      if (ty % 2 === 0) joints.rect(x, y, TILE, 1.5);
      if (h2(tx, ty, 402) < 0.3) {
        for (let i = 0; i < 4; i++) {
          const mx = x + (tx % 2 === 0 ? h2(tx, ty, 403 + i) * 3 : h2(tx, ty, 403 + i) * TILE);
          const my = y + (tx % 2 === 0 ? h2(tx, ty, 413 + i) * TILE : h2(tx, ty, 413 + i) * 3);
          moss.rect(mx, my, 2, 2);
        }
      }
      if (h2(tx, ty, 420) > 0.965) {
        g.strokeStyle = "rgba(70,64,56,0.55)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x + 3, y + 3 + h2(tx, ty, 421) * 20);
        g.lineTo(x + 12, y + 16);
        g.lineTo(x + 20, y + 14);
        g.lineTo(x + 30, y + 26);
        g.stroke();
      }
    }
  }
  g.fillStyle = "rgba(84,78,68,0.6)";
  g.fill(joints);
  g.fillStyle = "rgba(92,118,58,0.7)";
  g.fill(moss);
}

/** Mosaico circular (rosa-dos-ventos) no centro das praças — só piso. */
function paintPlazaMosaics(g: CanvasRenderingContext2D, r: Region) {
  const x0 = r.tx0 * TILE - 120;
  const y0 = r.ty0 * TILE - 120;
  const x1 = (r.tx1 + 1) * TILE + 120;
  const y1 = (r.ty1 + 1) * TILE + 120;
  for (const c of PLAZA_CENTERS) {
    if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
    const R = 92;
    g.fillStyle = "rgba(92,84,74,0.35)";
    g.beginPath();
    g.arc(c.x, c.y, R + 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#b9ae9a";
    g.beginPath();
    g.arc(c.x, c.y, R, 0, Math.PI * 2);
    g.fill();
    // anéis de pedra
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = i % 2 ? "rgba(120,72,52,0.55)" : "rgba(84,78,70,0.5)";
      g.lineWidth = i === 0 ? 6 : 3;
      g.beginPath();
      g.arc(c.x, c.y, R - 8 - i * 22, 0, Math.PI * 2);
      g.stroke();
    }
    // estrela de 8 pontas
    g.fillStyle = "rgba(138,70,48,0.55)";
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? (i % 4 === 0 ? 58 : 40) : 14;
      const px = c.x + Math.cos(a) * rr;
      const py = c.y + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(230,214,180,0.35)";
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? (i % 4 === 0 ? 30 : 20) : 7;
      const px = c.x + Math.cos(a) * rr;
      const py = c.y + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.fillStyle = "#6c645a";
    g.beginPath();
    g.arc(c.x, c.y, 6, 0, Math.PI * 2);
    g.fill();
  }
}

/** Interiores: tábuas corridas / piso industrial + oclusão nas paredes. */
function paintInteriors(g: CanvasRenderingContext2D, r: Region) {
  const lines = new Path2D();
  const grain = new Path2D();
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      const m = mat(tx, ty);
      const x = tx * TILE;
      const y = ty * TILE;
      if (m === M_WOOD) {
        for (let row = 0; row < 4; row++) {
          const gy = ty * 4 + row;
          const off = Math.floor(h2(0, gy, 501) * 3);
          const plank = Math.floor((tx + off) / 3);
          const tone = h2(plank, gy, 502);
          const k = 0.86 + tone * 0.26;
          g.fillStyle = rgb(shade(PAL.wood, k));
          g.fillRect(x, y + row * 8, TILE, 8);
          lines.rect(x, y + row * 8, TILE, 1);
          if ((tx + off) % 3 === 0) lines.rect(x, y + row * 8, 1, 8);
          if (h2(tx, gy, 503) < 0.5) grain.rect(x + 3 + h2(tx, gy, 504) * 10, y + row * 8 + 3 + (row % 2), 10 + h2(tx, gy, 505) * 12, 1);
        }
      } else if (m === M_INDOOR) {
        lines.rect(x, y, TILE, 1);
        lines.rect(x, y, 1, TILE);
        if (h2(tx, ty, 510) < 0.08) {
          g.fillStyle = "rgba(40,36,30,0.16)";
          g.beginPath();
          g.ellipse(x + 16, y + 16, 10, 7, h2(tx, ty, 511) * 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }
  g.fillStyle = "rgba(38,22,10,0.55)";
  g.fill(lines);
  g.fillStyle = "rgba(0,0,0,0.1)";
  g.fill(grain);

  // oclusão ambiente ao redor das paredes internas
  for (const b of BUILDINGS) {
    const i = b.interior;
    if (i.tx > r.tx1 || i.ty > r.ty1 || i.tx + i.tw < r.tx0 || i.ty + i.th < r.ty0) continue;
    const x0 = i.tx * TILE;
    const y0 = i.ty * TILE;
    const w = i.tw * TILE;
    const h = i.th * TILE;
    const ao = 14;
    const top = g.createLinearGradient(0, y0, 0, y0 + ao * 1.6);
    top.addColorStop(0, "rgba(0,0,0,0.42)");
    top.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = top;
    g.fillRect(x0, y0, w, ao * 1.6);
    const left = g.createLinearGradient(x0, 0, x0 + ao, 0);
    left.addColorStop(0, "rgba(0,0,0,0.3)");
    left.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = left;
    g.fillRect(x0, y0, ao, h);
    const right = g.createLinearGradient(x0 + w, 0, x0 + w - ao, 0);
    right.addColorStop(0, "rgba(0,0,0,0.22)");
    right.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = right;
    g.fillRect(x0 + w - ao, y0, ao, h);
    const bot = g.createLinearGradient(0, y0 + h, 0, y0 + h - ao * 0.7);
    bot.addColorStop(0, "rgba(0,0,0,0.18)");
    bot.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = bot;
    g.fillRect(x0, y0 + h - ao * 0.7, w, ao * 0.7);
  }
}

/** Meio-fio entre calçada e asfalto (pedra clara + sombra na rua). */
function paintCurbs(g: CanvasRenderingContext2D, r: Region) {
  const stone = new Path2D();
  const lip = new Path2D();
  const shadow = new Path2D();
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      const m0 = mat(tx, ty);
      if (m0 !== M_SIDEWALK && m0 !== M_PLAZA) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      if (mat(tx, ty - 1) === M_ASPHALT) {
        stone.rect(x, y, TILE, 4);
        lip.rect(x, y + 4, TILE, 1);
        shadow.rect(x, y - 3, TILE, 3);
      }
      if (mat(tx, ty + 1) === M_ASPHALT) {
        stone.rect(x, y + TILE - 4, TILE, 4);
        lip.rect(x, y + TILE - 5, TILE, 1);
        shadow.rect(x, y + TILE, TILE, 4);
      }
      if (mat(tx - 1, ty) === M_ASPHALT) {
        stone.rect(x, y, 4, TILE);
        lip.rect(x + 4, y, 1, TILE);
        shadow.rect(x - 3, y, 3, TILE);
      }
      if (mat(tx + 1, ty) === M_ASPHALT) {
        stone.rect(x + TILE - 4, y, 4, TILE);
        lip.rect(x + TILE - 5, y, 1, TILE);
        shadow.rect(x + TILE, y, 4, TILE);
      }
    }
  }
  g.fillStyle = "rgba(10,10,12,0.3)";
  g.fill(shadow);
  g.fillStyle = rgb(PAL.curb);
  g.fill(stone);
  g.fillStyle = "rgba(60,58,52,0.55)";
  g.fill(lip);
}

/** Sinalização viária derivada da malha (faixa central tracejada, bordas, zebras). */
function paintRoadMarkings(g: CanvasRenderingContext2D, r: Region) {
  const x0w = r.tx0 * TILE;
  const y0w = r.ty0 * TILE;
  const x1w = (r.tx1 + 1) * TILE;
  const y1w = (r.ty1 + 1) * TILE;
  const PW = ROAD_PITCH * TILE;
  const RW = ROAD_WIDTH * TILE;
  const DASH = 22;
  const GAP = 18;

  const dashes = (
    ax: number,
    ay: number,
    len: number,
    vertical: boolean,
    seed: number,
  ) => {
    let t = 0;
    let i = 0;
    while (t < len) {
      const d = Math.min(DASH, len - t);
      if (h2(seed, i, 601) > 0.07) {
        const alpha = 0.55 + h2(seed, i, 602) * 0.35;
        g.fillStyle = `${PAL.laneYellow}${alpha})`;
        if (vertical) g.fillRect(ax - 1.5, ay + t, 3, d);
        else g.fillRect(ax + t, ay - 1.5, d, 3);
      }
      t += DASH + GAP;
      i++;
    }
  };

  const zebra = (rx: number, ry: number, rw: number, rh: number, vertical: boolean, seed: number) => {
    // listras paralelas ao tráfego, atravessando a rua
    const stripe = 7;
    const gap = 7;
    if (vertical) {
      for (let x = rx + 8, i = 0; x + stripe <= rx + rw - 6; x += stripe + gap, i++) {
        g.fillStyle = `${PAL.laneWhite}${0.55 + h2(seed, i, 611) * 0.3})`;
        g.fillRect(x, ry, stripe, rh);
      }
    } else {
      for (let y = ry + 8, i = 0; y + stripe <= ry + rh - 6; y += stripe + gap, i++) {
        g.fillStyle = `${PAL.laneWhite}${0.55 + h2(seed, i, 611) * 0.3})`;
        g.fillRect(rx, y, rw, stripe);
      }
    }
  };

  // ruas verticais (x = bx*PITCH .. +WIDTH)
  for (let bx = 0; bx * PW < ARENA_W; bx++) {
    const rx = bx * PW;
    if (rx > x1w || rx + RW < x0w) continue;
    for (let by = 0; by * PW < ARENA_H; by++) {
      const sy = by * PW + RW;
      const ey = Math.min(ARENA_H, (by + 1) * PW);
      if (sy > y1w || ey < y0w) continue;
      const seed = bx * 97 + by * 13;
      // bordas
      g.fillStyle = `${PAL.laneWhite}0.45)`;
      g.fillRect(rx + 6, sy + 34, 2, ey - sy - 68);
      g.fillRect(rx + RW - 8, sy + 34, 2, ey - sy - 68);
      // eixo tracejado
      dashes(rx + RW / 2, sy + 40, ey - sy - 80, true, seed);
      // zebras nas duas pontas
      zebra(rx, sy + 4, RW, 24, true, seed);
      zebra(rx, ey - 28, RW, 24, true, seed + 1);
    }
  }
  // ruas horizontais
  for (let by = 0; by * PW < ARENA_H; by++) {
    const ry = by * PW;
    if (ry > y1w || ry + RW < y0w) continue;
    for (let bx = 0; bx * PW < ARENA_W; bx++) {
      const sx = bx * PW + RW;
      const ex = Math.min(ARENA_W, (bx + 1) * PW);
      if (sx > x1w || ex < x0w) continue;
      const seed = by * 89 + bx * 7 + 5000;
      g.fillStyle = `${PAL.laneWhite}0.45)`;
      g.fillRect(sx + 34, ry + 6, ex - sx - 68, 2);
      g.fillRect(sx + 34, ry + RW - 8, ex - sx - 68, 2);
      dashes(sx + 40, ry + RW / 2, ex - sx - 80, false, seed);
      zebra(sx + 4, ry, 24, RW, false, seed);
      zebra(ex - 28, ry, 24, RW, false, seed + 1);
    }
  }
  // bueiros no centro de alguns cruzamentos
  for (let by = 0; by * PW < ARENA_H; by++) {
    for (let bx = 0; bx * PW < ARENA_W; bx++) {
      const cx = bx * PW + RW / 2 + 18;
      const cy = by * PW + RW / 2 - 14;
      if (cx < x0w - 20 || cx > x1w + 20 || cy < y0w - 20 || cy > y1w + 20) continue;
      if (h2(bx, by, 620) < 0.35) continue;
      drawManhole(g, cx, cy);
    }
  }
}

function drawManhole(g: CanvasRenderingContext2D, cx: number, cy: number) {
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.beginPath();
  g.arc(cx + 1, cy + 1.5, 11, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#44474b";
  g.beginPath();
  g.arc(cx, cy, 10, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#2b2d30";
  g.lineWidth = 1.5;
  g.stroke();
  g.strokeStyle = "rgba(20,20,22,0.7)";
  g.lineWidth = 1;
  g.beginPath();
  for (let i = -6; i <= 6; i += 3) {
    const hw = Math.sqrt(Math.max(0, 64 - i * i));
    g.moveTo(cx - hw, cy + i);
    g.lineTo(cx + hw, cy + i);
  }
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.1)";
  g.beginPath();
  g.arc(cx - 3, cy - 3, 3, 0, Math.PI * 2);
  g.fill();
}

/** Tufos de mato, pedrinhas, flores, lixo, arbustos baixos. */
function paintVegetation(g: CanvasRenderingContext2D, r: Region) {
  const dark = new Path2D();
  const mid = new Path2D();
  const light = new Path2D();
  const dry = new Path2D();
  const stones = new Path2D();
  const stonesHi = new Path2D();
  const flowersY = new Path2D();
  const flowersW = new Path2D();
  const lite = FX_MOBILE;

  const tuft = (bx: number, by: number, hgt: number, seed: number, dryTuft: boolean) => {
    const bend = (h2(seed, 1, 701) - 0.5) * 2;
    const base = dryTuft ? dry : dark;
    base.rect(bx, by - hgt, 1.6, hgt);
    base.rect(bx - 2 + bend * 0.5, by - hgt * 0.75, 1.4, hgt * 0.75);
    base.rect(bx + 2 + bend * 0.5, by - hgt * 0.7, 1.4, hgt * 0.7);
    if (!dryTuft) {
      mid.rect(bx - 1 + bend, by - hgt * 0.95, 1.2, hgt * 0.5);
      light.rect(bx + bend * 0.8, by - hgt - 1, 1.2, 2);
    }
  };

  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      const m = mat(tx, ty);
      if (!isLot(m)) continue;
      if (solidAt(tx, ty) >= 10) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      const tall = GROUND[ty]?.[tx] === T.GRASS_TALL;
      const d = fbm(tx / 7, ty / 7, 5);
      let n = tall ? 7 : d > 0.6 ? 1 : 3;
      if (lite) n = Math.ceil(n * 0.6);
      for (let i = 0; i < n; i++) {
        const bx = x + 2 + h2(tx, ty, 710 + i) * 28;
        const by = y + 6 + h2(tx, ty, 720 + i) * 26;
        const hgt = (tall ? 6 : 3.5) + h2(tx, ty, 730 + i) * (tall ? 6 : 3);
        tuft(bx, by, hgt, tx * 31 + ty * 17 + i, h2(tx, ty, 740 + i) < 0.22);
      }
      if (h2(tx, ty, 750) < 0.25) {
        const sx = x + 4 + h2(tx, ty, 751) * 24;
        const sy = y + 4 + h2(tx, ty, 752) * 24;
        const sr = 1.6 + h2(tx, ty, 753) * 1.8;
        stones.moveTo(sx + sr, sy);
        stones.ellipse(sx, sy, sr, sr * 0.75, 0, 0, Math.PI * 2);
        stonesHi.rect(sx - sr * 0.5, sy - sr * 0.6, sr * 0.8, 1);
      }
      if (!tall && h2(tx, ty, 760) < 0.05) {
        const fx = x + 6 + h2(tx, ty, 761) * 20;
        const fy = y + 6 + h2(tx, ty, 762) * 20;
        const f = h2(tx, ty, 763) < 0.5 ? flowersY : flowersW;
        f.rect(fx, fy, 2, 2);
        f.rect(fx + 4, fy + 2, 2, 2);
        f.rect(fx + 1, fy + 5, 2, 2);
      }
    }
  }
  // grama invadindo a borda da calçada (lado do baldio)
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      if (mat(tx, ty) !== M_SIDEWALK) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      const nb: [number, number, number, number][] = [
        [0, -1, 0, 1],
        [0, 1, 0, TILE - 1],
        [-1, 0, 1, 0],
        [1, 0, TILE - 1, 0],
      ];
      for (const [dx, dy, ox, oy] of nb) {
        if (!isLot(mat(tx + dx, ty + dy))) continue;
        for (let i = 0; i < 3; i++) {
          const t = h2(tx * 4 + dx, ty * 4 + dy, 770 + i) * 30;
          const bx = x + (dx === 0 ? t : ox);
          const by = y + (dy === 0 ? t + 3 : oy + (dy < 0 ? 4 : 0));
          tuft(bx, by, 3 + h2(tx, ty, 780 + i) * 3, tx * 7 + ty * 3 + i, false);
        }
      }
    }
  }
  g.fillStyle = "#3e5226";
  g.fill(dark);
  g.fillStyle = "#6a8440";
  g.fill(mid);
  g.fillStyle = "#a6bd66";
  g.fill(light);
  g.fillStyle = "#a89a5a";
  g.fill(dry);
  g.fillStyle = "#8d877c";
  g.fill(stones);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fill(stonesHi);
  g.fillStyle = "#e6c94a";
  g.fill(flowersY);
  g.fillStyle = "#ece6dc";
  g.fill(flowersW);

  // arbustos baixos (decoração, raros — longe de ruas)
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      if (mat(tx, ty) !== M_GRASS || solidAt(tx, ty) >= 10) continue;
      if (h2(tx, ty, 790) > 0.022) continue;
      drawBush(g, tx * TILE + 16, ty * TILE + 18, 0.8 + h2(tx, ty, 791) * 0.5, tx * 13 + ty);
    }
  }
}

function drawBush(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, seed: number) {
  g.fillStyle = "rgba(14,20,8,0.3)";
  g.beginPath();
  g.ellipse(cx + 5 * s, cy + 6 * s, 15 * s, 8 * s, 0, 0, Math.PI * 2);
  g.fill();
  const blobs: [number, number, number][] = [
    [-7, 1, 8],
    [6, 2, 8],
    [0, -4, 9],
    [-2, 4, 7],
    [8, -3, 6],
  ];
  g.fillStyle = "#2f4a1e";
  g.beginPath();
  for (const [bx, by, br] of blobs) {
    g.moveTo(cx + bx * s + br * s, cy + by * s);
    g.arc(cx + bx * s, cy + by * s, br * s, 0, Math.PI * 2);
  }
  g.fill();
  g.fillStyle = "#43662a";
  g.beginPath();
  for (const [bx, by, br] of blobs) {
    g.moveTo(cx + bx * s - 1 + br * 0.72 * s, cy + by * s - 1.5);
    g.arc(cx + bx * s - 1, cy + by * s - 1.5, br * 0.72 * s, 0, Math.PI * 2);
  }
  g.fill();
  g.fillStyle = "#6d9440";
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = h2(seed, i, 795) * Math.PI * 2;
    const rr = h2(seed, i, 796) * 7 * s;
    g.rect(cx + Math.cos(a) * rr - 1, cy + Math.sin(a) * rr - 4, 2, 2);
  }
  g.fill();
}

/** Postes de luz (base + haste em 3/4 + luminária acesa). */
function paintLamps(g: CanvasRenderingContext2D, r: Region) {
  const x0 = r.tx0 * TILE - 60;
  const y0 = r.ty0 * TILE - 60;
  const x1 = (r.tx1 + 1) * TILE + 60;
  const y1 = (r.ty1 + 1) * TILE + 60;
  for (const l of LAMPS) {
    if (l.x < x0 || l.x > x1 || l.y < y0 || l.y > y1) continue;
    const hx = l.x + 7;
    const hy = l.y - 36;
    // poça de luz quente no chão, abaixo da luminária
    const pool = g.createRadialGradient(hx, l.y - 2, 3, hx, l.y - 2, 64);
    pool.addColorStop(0, "rgba(255,216,150,0.16)");
    pool.addColorStop(1, "rgba(255,216,150,0)");
    g.fillStyle = pool;
    g.fillRect(hx - 64, l.y - 66, 128, 128);
    // sombra da haste
    g.strokeStyle = "rgba(10,10,16,0.2)";
    g.lineWidth = 4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(l.x + 2, l.y + 1);
    g.lineTo(l.x + 14, l.y + 20);
    g.stroke();
    // base
    g.fillStyle = "#23262a";
    g.beginPath();
    g.ellipse(l.x, l.y, 5, 3.2, 0, 0, Math.PI * 2);
    g.fill();
    // haste
    g.strokeStyle = "#2f3337";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(l.x, l.y);
    g.lineTo(l.x, hy + 3);
    g.quadraticCurveTo(l.x, hy, hx - 2, hy);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.22)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(l.x - 1, l.y - 2);
    g.lineTo(l.x - 1, hy + 4);
    g.stroke();
    // luminária + halo
    const halo = g.createRadialGradient(hx, hy + 2, 1, hx, hy + 2, 14);
    halo.addColorStop(0, "rgba(255,236,190,0.55)");
    halo.addColorStop(1, "rgba(255,236,190,0)");
    g.fillStyle = halo;
    g.fillRect(hx - 14, hy - 12, 28, 28);
    g.fillStyle = "#26292c";
    g.beginPath();
    g.ellipse(hx, hy, 6.5, 3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff0c8";
    g.beginPath();
    g.ellipse(hx, hy + 1.5, 4, 1.6, 0, 0, Math.PI * 2);
    g.fill();
  }
}

/** Soleira das portas (o batente anima por frame em render.ts). */
function paintThresholds(g: CanvasRenderingContext2D, r: Region) {
  for (const d of DOOR_DEFS) {
    if (d.tx < r.tx0 || d.tx > r.tx1 || d.ty < r.ty0 || d.ty > r.ty1) continue;
    const x = d.tx * TILE;
    const y = d.ty * TILE;
    g.fillStyle = "#4a3a2c";
    if (d.orient === "h") {
      g.fillRect(x, y + 9, TILE, 14);
      g.fillStyle = "rgba(255,230,190,0.12)";
      g.fillRect(x, y + 9, TILE, 2);
    } else {
      g.fillRect(x + 9, y, 14, TILE);
      g.fillStyle = "rgba(255,230,190,0.12)";
      g.fillRect(x + 9, y, 2, TILE);
    }
  }
}

/* ------------------------------------------------------------------ */
/* sólidos: sombras + paredes + props                                  */
/* ------------------------------------------------------------------ */

const SHADOW_DX = 6;
const SHADOW_DY = 9;

function paintSolidShadows(g: CanvasRenderingContext2D, r: Region) {
  const p = new Path2D();
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      const t = solidAt(tx, ty);
      if (t < 10) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      if (isWallT(t)) p.rect(x + SHADOW_DX, y + SHADOW_DY, TILE, TILE);
      else if (t === T.CRATE) p.rect(x + 8, y + 12, 28, 22);
      else if (t === T.BARREL) {
        p.moveTo(x + 16 + 6 + 13, y + 28);
        p.ellipse(x + 16 + 6, y + 28, 13, 6.5, 0, 0, Math.PI * 2);
      }
    }
  }
  const x0 = r.tx0 * TILE - 64;
  const y0 = r.ty0 * TILE - 64;
  const x1 = (r.tx1 + 1) * TILE + 64;
  const y1 = (r.ty1 + 1) * TILE + 64;
  for (const c of CARS) {
    if (c.x > x1 || c.y > y1 || c.x + c.w < x0 || c.y + c.h < y0) continue;
    roundRectPath(p, c.x + 4 + 5, c.y + 4 + 7, c.w - 8, c.h - 8, 7);
  }
  g.fillStyle = "rgba(16,12,22,0.34)";
  g.fill(p);
}

function roundRectPath(p: Path2D | CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rr: number) {
  const r2 = Math.min(rr, w / 2, h / 2);
  p.moveTo(x + r2, y);
  p.lineTo(x + w - r2, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r2);
  p.lineTo(x + w, y + h - r2);
  p.quadraticCurveTo(x + w, y + h, x + w - r2, y + h);
  p.lineTo(x + r2, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r2);
  p.lineTo(x, y + r2);
  p.quadraticCurveTo(x, y, x + r2, y);
  p.closePath();
}

const FACE = 15;

function paintWalls(g: CanvasRenderingContext2D, r: Region) {
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      const t = solidAt(tx, ty);
      if (!isWallT(t)) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      const border = isBorder(tx, ty);
      const south = inMap(tx, ty + 1) ? solidAt(tx, ty + 1) : T.WALL;
      const face = !isWallT(south);
      const topH = face ? TILE - FACE : TILE;
      const metal = t === T.METAL;

      // tampo (topo da parede)
      const cap: RGB = border ? [92, 90, 84] : metal ? [74, 82, 84] : [88, 66, 56];
      g.fillStyle = rgb(cap);
      g.fillRect(x, y, TILE, topH);
      // bisel claro nas bordas do tampo (volume)
      g.fillStyle = "rgba(255,235,210,0.1)";
      g.fillRect(x, y + 2, TILE, 2);
      // juntas das pedras do tampo
      g.fillStyle = "rgba(0,0,0,0.16)";
      g.fillRect(x + (ty % 2 ? 0 : 16), y, 1, topH);
      if (topH === TILE) g.fillRect(x, y + 16, TILE, 1);
      // textura leve no tampo
      g.fillStyle = "rgba(0,0,0,0.06)";
      if (h2(tx, ty, 801) < 0.5) g.fillRect(x + 4, y + 5, 10, 2);
      if (h2(tx, ty, 802) < 0.4) g.fillRect(x + 17, y + 11, 8, 2);
      if (metal) {
        g.fillStyle = "rgba(255,255,255,0.08)";
        g.fillRect(x, y + 3, TILE, 1);
        g.fillRect(x, y + 10, TILE, 1);
      }

      // face frontal (visível quando o vizinho de baixo é aberto)
      if (face) {
        const fy = y + topH;
        if (metal) {
          g.fillStyle = "#5c6563";
          g.fillRect(x, fy, TILE, FACE);
          g.fillStyle = "#6f7876";
          for (let i = 0; i < TILE; i += 4) g.fillRect(x + i, fy, 2, FACE);
          if (h2(tx, ty, 803) < 0.35) {
            g.fillStyle = "rgba(150,82,36,0.4)";
            g.fillRect(x + 6 + h2(tx, ty, 804) * 16, fy + 2, 3, FACE - 2);
          }
        } else if (border) {
          g.fillStyle = "#6c6860";
          g.fillRect(x, fy, TILE, FACE);
          g.fillStyle = "rgba(0,0,0,0.25)";
          if (tx % 2 === 0) g.fillRect(x, fy, 1, FACE);
        } else {
          // tijolos
          g.fillStyle = "#6a3526";
          g.fillRect(x, fy, TILE, FACE);
          for (let row = 0; row < 3; row++) {
            const ry = fy + 1 + row * 4;
            const off = row % 2 === 0 ? 0 : 4;
            for (let bx = -off; bx < TILE; bx += 8) {
              const tone = h2(tx * 8 + bx, ty * 3 + row, 805);
              g.fillStyle = tone < 0.3 ? "#8a4632" : tone < 0.85 ? "#7a3d2c" : "#96543c";
              const x0 = Math.max(x, x + bx + 1);
              const x1 = Math.min(x + TILE, x + bx + 8);
              if (x1 > x0) g.fillRect(x0, ry, x1 - x0, 3);
            }
          }
        }
        // linha de contato com o chão + luz no topo da face
        g.fillStyle = "rgba(0,0,0,0.45)";
        g.fillRect(x, y + TILE - 1, TILE, 1);
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(x, fy, TILE, 1.5);
      }

      // contorno (silhueta forte onde a parede encontra o chão)
      g.fillStyle = "rgba(24,18,14,0.7)";
      if (!isWallT(solidAt(tx, ty - 1))) g.fillRect(x, y, TILE, 1.5);
      if (!isWallT(solidAt(tx - 1, ty))) g.fillRect(x, y, 1.5, topH);
      if (!isWallT(solidAt(tx + 1, ty))) g.fillRect(x + TILE - 1.5, y, 1.5, topH);
      // brilho na borda de cima (luz vindo do norte-oeste)
      g.fillStyle = "rgba(255,255,255,0.14)";
      if (!isWallT(solidAt(tx, ty - 1))) g.fillRect(x, y + 1.5, TILE, 1.5);
    }
  }
}

/** Caixa em 3/4: tampo + face frontal (mesma leitura de volume das paredes). */
function paintCrate(g: CanvasRenderingContext2D, x: number, y: number, seed: number) {
  const v = h2(seed, 0, 821);
  const military = v > 0.74;
  const base: RGB = military ? [86, 100, 62] : [160, 114, 64];
  const x0 = x + 2;
  const w = 28;
  const top0 = y + 1;
  const topH = 19;
  const faceH = 10;
  // face frontal (mais escura)
  g.fillStyle = rgb(shade(base, 0.5));
  g.fillRect(x0, top0 + topH, w, faceH);
  g.fillStyle = rgb(shade(base, 0.68));
  g.fillRect(x0 + 1, top0 + topH, w - 2, faceH - 1);
  g.fillStyle = "rgba(0,0,0,0.22)";
  for (let i = 1; i < 4; i++) g.fillRect(x0 + i * 7, top0 + topH, 1, faceH - 1);
  g.fillStyle = rgb(shade(base, 0.55));
  g.fillRect(x0 + 1, top0 + topH, w - 2, 2);
  // tampo
  g.fillStyle = rgb(shade(base, 0.52));
  g.fillRect(x0, top0, w, topH);
  for (let i = 0; i < 4; i++) {
    const tone = 0.95 + h2(seed, i, 822) * 0.15;
    g.fillStyle = rgb(shade(base, tone));
    g.fillRect(x0 + 1, top0 + 1 + i * 4.5, w - 2, 4.5);
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(x0 + 1, top0 + 5 + i * 4.5, w - 2, 0.8);
  }
  const frame = rgb(shade(base, 0.76));
  g.fillStyle = frame;
  g.fillRect(x0 + 1, top0 + 1, w - 2, 2.5);
  g.fillRect(x0 + 1, top0 + topH - 3, w - 2, 2.5);
  g.fillRect(x0 + 1, top0 + 1, 2.5, topH - 2);
  g.fillRect(x0 + w - 3.5, top0 + 1, 2.5, topH - 2);
  g.save();
  g.beginPath();
  g.rect(x0 + 3.5, top0 + 3.5, w - 7, topH - 7);
  g.clip();
  g.strokeStyle = frame;
  g.lineWidth = 3;
  g.beginPath();
  if (v < 0.37) {
    g.moveTo(x0 + 2, top0 + 2);
    g.lineTo(x0 + w - 2, top0 + topH - 2);
  } else {
    g.moveTo(x0 + w - 2, top0 + 2);
    g.lineTo(x0 + 2, top0 + topH - 2);
  }
  g.stroke();
  g.restore();
  // luz no canto de cima
  g.fillStyle = "rgba(255,240,210,0.3)";
  g.fillRect(x0 + 1, top0 + 1, w - 2, 1);
  g.fillStyle = "rgba(30,24,18,0.85)";
  g.fillRect(x0 + 2, top0 + 2, 1.2, 1.2);
  g.fillRect(x0 + w - 3, top0 + 2, 1.2, 1.2);
  if (military) {
    g.fillStyle = "rgba(226,214,160,0.65)";
    g.beginPath();
    g.moveTo(x0 + 14, top0 + 5);
    g.lineTo(x0 + 18.5, top0 + 10);
    g.lineTo(x0 + 16, top0 + 10);
    g.lineTo(x0 + 16, top0 + 15);
    g.lineTo(x0 + 12, top0 + 15);
    g.lineTo(x0 + 12, top0 + 10);
    g.lineTo(x0 + 9.5, top0 + 10);
    g.closePath();
    g.fill();
  }
  // contorno
  g.strokeStyle = "rgba(24,16,10,0.7)";
  g.lineWidth = 1;
  g.strokeRect(x0 + 0.5, top0 + 0.5, w - 1, topH + faceH - 1);
}

/** Tambor de óleo em 3/4 (tampa elíptica + costado cilíndrico). */
function paintBarrel(g: CanvasRenderingContext2D, x: number, y: number, seed: number) {
  const v = h2(seed, 0, 831);
  const cols: RGB[] = [
    [140, 60, 44],
    [54, 84, 118],
    [74, 96, 58],
    [176, 136, 52],
  ];
  const c = cols[Math.floor(v * cols.length)]!;
  const cx = x + 16;
  const rx = 11;
  const ry = 5;
  const topY = y + 9;
  const botY = y + 27;
  // costado com sombreamento cilíndrico
  const side = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
  side.addColorStop(0, rgb(shade(c, 0.55)));
  side.addColorStop(0.32, rgb(shade(c, 1.18)));
  side.addColorStop(0.6, rgb(c));
  side.addColorStop(1, rgb(shade(c, 0.5)));
  g.fillStyle = side;
  g.beginPath();
  g.moveTo(cx - rx, topY);
  g.lineTo(cx - rx, botY);
  g.ellipse(cx, botY, rx, ry, 0, Math.PI, 0, true);
  g.lineTo(cx + rx, topY);
  g.closePath();
  g.fill();
  // aros
  g.strokeStyle = rgb(shade(c, 0.45));
  g.lineWidth = 1.4;
  for (const ay of [topY + 6, topY + 12]) {
    g.beginPath();
    g.ellipse(cx, ay, rx, ry, 0, 0, Math.PI);
    g.stroke();
  }
  g.strokeStyle = "rgba(255,255,255,0.14)";
  g.lineWidth = 1;
  for (const ay of [topY + 7, topY + 13]) {
    g.beginPath();
    g.ellipse(cx, ay, rx - 0.5, ry, 0, Math.PI * 0.15, Math.PI * 0.55);
    g.stroke();
  }
  // escorrido de ferrugem
  if (h2(seed, 1, 832) < 0.55) {
    g.fillStyle = "rgba(96,50,24,0.5)";
    const rxp = cx - 6 + h2(seed, 2, 833) * 10;
    g.fillRect(rxp, topY + 2, 2, 8 + h2(seed, 3, 834) * 8);
  }
  // tampa
  g.fillStyle = rgb(shade(c, 0.62));
  g.beginPath();
  g.ellipse(cx, topY, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = rgb(shade(c, 0.9));
  g.beginPath();
  g.ellipse(cx, topY + 0.4, rx - 2, ry - 1.4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#1a1614";
  g.beginPath();
  g.ellipse(cx - 4, topY, 1.8, 1, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = rgb(shade(c, 0.55));
  g.beginPath();
  g.ellipse(cx + 3.5, topY + 1, 1.4, 0.8, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.3)";
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(cx, topY, rx - 0.5, ry - 0.4, 0, Math.PI * 1.05, Math.PI * 1.55);
  g.stroke();
  if (v >= 0.75) {
    // faixa preta de perigo no costado
    g.fillStyle = "rgba(24,20,12,0.65)";
    g.fillRect(cx - rx + 1, topY + 7.5, rx * 2 - 2, 3);
  }
  // contorno
  g.strokeStyle = "rgba(20,14,12,0.65)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx - rx, topY);
  g.lineTo(cx - rx, botY);
  g.ellipse(cx, botY, rx, ry, 0, Math.PI, 0, true);
  g.lineTo(cx + rx, topY);
  g.stroke();
}

const CAR_COLS: RGB[] = [
  [150, 58, 50],
  [58, 92, 128],
  [60, 110, 104],
  [190, 150, 64],
  [196, 192, 180],
  [44, 46, 52],
  [112, 78, 52],
  [120, 124, 130],
];

function paintCar(g: CanvasRenderingContext2D, c: CarRect) {
  const horiz = c.w >= c.h;
  const L = Math.max(c.w, c.h) - 6;
  const W = Math.min(c.w, c.h) - 7;
  const col = CAR_COLS[Math.floor(h2(c.seed, 0, 841) * CAR_COLS.length)]!;
  const flip = h2(c.seed, 1, 842) < 0.5 ? -1 : 1;
  const wreck = h2(c.seed, 2, 843);
  const small = Math.max(c.w, c.h) <= TILE;
  g.save();
  g.translate(c.x + c.w / 2, c.y + c.h / 2);
  if (!horiz) g.rotate(Math.PI / 2);
  g.scale(flip, 1);
  if (small) {
    // sucata (tile isolado)
    g.fillStyle = "#3a3632";
    roundRectPath(g, -12, -10, 24, 20, 4);
    g.fill();
    g.fillStyle = rgb(shade(col, 0.6));
    roundRectPath(g, -10, -8, 20, 16, 3);
    g.fill();
    g.restore();
    return;
  }
  // rodas
  g.fillStyle = "#151517";
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      g.fillRect(sx * L * 0.3 - 5, sy * (W / 2) - 2.5 + (sy > 0 ? 0 : 0), 10, 5);
    }
  }
  // carroceria
  const body = shade(col, wreck > 0.8 ? 0.55 : 1);
  g.fillStyle = rgb(shade(body, 0.7));
  roundRectPath(g, -L / 2, -W / 2, L, W, 6);
  g.fill();
  g.fillStyle = rgb(body);
  roundRectPath(g, -L / 2 + 1, -W / 2 + 1, L - 2, W - 3, 5);
  g.fill();
  // capô e porta-malas (linhas)
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(L * 0.3, -W / 2 + 3);
  g.lineTo(L * 0.3, W / 2 - 3);
  g.moveTo(-L * 0.36, -W / 2 + 3);
  g.lineTo(-L * 0.36, W / 2 - 3);
  g.stroke();
  // para-brisa
  g.fillStyle = "#1c2830";
  g.beginPath();
  g.moveTo(L * 0.28, -W / 2 + 3);
  g.lineTo(L * 0.12, -W / 2 + 4.5);
  g.lineTo(L * 0.12, W / 2 - 4.5);
  g.lineTo(L * 0.28, W / 2 - 3);
  g.closePath();
  g.fill();
  // teto
  g.fillStyle = rgb(shade(body, 1.12));
  roundRectPath(g, -L * 0.22, -W / 2 + 4, L * 0.34, W - 8, 3);
  g.fill();
  // vidro traseiro
  g.fillStyle = "#1c2830";
  g.beginPath();
  g.moveTo(-L * 0.22, -W / 2 + 4.5);
  g.lineTo(-L * 0.33, -W / 2 + 3.5);
  g.lineTo(-L * 0.33, W / 2 - 3.5);
  g.lineTo(-L * 0.22, W / 2 - 4.5);
  g.closePath();
  g.fill();
  // reflexo
  g.strokeStyle = "rgba(190,215,235,0.35)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(L * 0.25, -W / 2 + 5);
  g.lineTo(L * 0.16, W / 2 - 7);
  g.stroke();
  // faróis / lanternas
  g.fillStyle = wreck > 0.7 ? "#6b6a5a" : "#f2e7b0";
  g.fillRect(L / 2 - 3, -W / 2 + 2.5, 2, 4);
  g.fillRect(L / 2 - 3, W / 2 - 7, 2, 4);
  g.fillStyle = "#a02a22";
  g.fillRect(-L / 2 + 1, -W / 2 + 2.5, 2, 4);
  g.fillRect(-L / 2 + 1, W / 2 - 7, 2, 4);
  // retrovisores
  g.fillStyle = rgb(shade(body, 0.75));
  g.fillRect(L * 0.1, -W / 2 - 1.5, 3, 2);
  g.fillRect(L * 0.1, W / 2 - 0.5, 3, 2);
  // brilho de laca no topo
  g.fillStyle = "rgba(255,255,255,0.12)";
  g.fillRect(-L / 2 + 5, -W / 2 + 2, L - 10, 1.5);
  // desgaste: ferrugem / queimado / vidro quebrado
  if (wreck > 0.45) {
    g.fillStyle = "rgba(118,62,30,0.5)";
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc((h2(c.seed, i, 844) - 0.5) * L * 0.8, (h2(c.seed, i, 845) - 0.5) * W * 0.7, 2 + h2(c.seed, i, 846) * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (wreck > 0.8) {
    const sc = g.createRadialGradient(0, 0, 2, 0, 0, L * 0.5);
    sc.addColorStop(0, "rgba(10,8,8,0.55)");
    sc.addColorStop(1, "rgba(10,8,8,0)");
    g.fillStyle = sc;
    g.fillRect(-L / 2, -W / 2, L, W);
  }
  if (wreck > 0.6) {
    g.strokeStyle = "rgba(210,225,235,0.45)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(L * 0.2, 0);
    g.lineTo(L * 0.26, -4);
    g.moveTo(L * 0.2, 0);
    g.lineTo(L * 0.14, 3);
    g.moveTo(L * 0.2, 0);
    g.lineTo(L * 0.25, 5);
    g.stroke();
  }
  g.restore();
}

function paintProps(g: CanvasRenderingContext2D, r: Region) {
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      const t = solidAt(tx, ty);
      if (t === T.CRATE) paintCrate(g, tx * TILE, ty * TILE, ty * MAP_W + tx);
      else if (t === T.BARREL) paintBarrel(g, tx * TILE, ty * TILE, ty * MAP_W + tx);
    }
  }
  const x0 = r.tx0 * TILE - 64;
  const y0 = r.ty0 * TILE - 64;
  const x1 = (r.tx1 + 1) * TILE + 64;
  const y1 = (r.ty1 + 1) * TILE + 64;
  for (const c of CARS) {
    if (c.x > x1 || c.y > y1 || c.x + c.w < x0 || c.y + c.h < y0) continue;
    paintCar(g, c);
  }
}

function paintChunk(g: CanvasRenderingContext2D, cx: number, cy: number, scale: number) {
  const x0 = cx * CH;
  const y0 = cy * CH;
  g.setTransform(scale, 0, 0, scale, (GUT - x0) * scale, (GUT - y0) * scale);
  g.imageSmoothingEnabled = true;
  const r: Region = {
    tx0: Math.max(-1, Math.floor((x0 - GUT) / TILE) - MARGIN),
    ty0: Math.max(-1, Math.floor((y0 - GUT) / TILE) - MARGIN),
    tx1: Math.min(MAP_W, Math.ceil((x0 + CH + GUT) / TILE) + MARGIN),
    ty1: Math.min(MAP_H, Math.ceil((y0 + CH + GUT) / TILE) + MARGIN),
  };
  const pats = makePats(g);
  g.save();
  g.beginPath();
  g.rect(x0 - GUT, y0 - GUT, CH + GUT * 2, CH + GUT * 2);
  g.clip();
  paintBase(g, r, pats);
  paintLots(g, r, pats);
  paintAsphaltDetail(g, r);
  paintSidewalks(g, r);
  paintPlazas(g, r);
  paintPlazaMosaics(g, r);
  paintInteriors(g, r);
  paintRoadMarkings(g, r);
  paintCurbs(g, r);
  paintVegetation(g, r);
  paintThresholds(g, r);
  paintSolidShadows(g, r);
  paintLamps(g, r);
  paintWalls(g, r);
  paintProps(g, r);
  g.restore();
}

/* ------------------------------------------------------------------ */
/* cache LRU + desenho por frame                                       */
/* ------------------------------------------------------------------ */

interface Chunk {
  canvas: HTMLCanvasElement;
  used: number;
}

const chunks = new Map<number, Chunk>();
const pool: HTMLCanvasElement[] = [];
let chunkScale = 1;
let frameNo = 0;

export function invalidateWorld() {
  for (const c of chunks.values()) if (pool.length < 12) pool.push(c.canvas);
  chunks.clear();
  roofCache.clear();
}

function newChunkCanvas(scale: number): HTMLCanvasElement {
  const px = Math.ceil((CH + GUT * 2) * scale);
  let c = pool.pop();
  if (!c) c = document.createElement("canvas");
  if (c.width !== px || c.height !== px) {
    c.width = px;
    c.height = px;
  }
  return c;
}

function getChunk(cx: number, cy: number): Chunk {
  const key = cy * 1024 + cx;
  let c = chunks.get(key);
  if (!c) {
    const canvas = newChunkCanvas(chunkScale);
    const g = canvas.getContext("2d", { alpha: false })!;
    paintChunk(g, cx, cy, chunkScale);
    c = { canvas, used: frameNo };
    chunks.set(key, c);
  }
  c.used = frameNo;
  return c;
}

function maxChunks() {
  return FX_MOBILE ? 150 : 110;
}

function evict() {
  const cap = maxChunks();
  if (chunks.size <= cap) return;
  const list = [...chunks.entries()].filter(([, c]) => c.used !== frameNo);
  list.sort((a, b) => a[1].used - b[1].used);
  for (const [k, c] of list) {
    if (chunks.size <= cap) break;
    chunks.delete(k);
    if (pool.length < 12) pool.push(c.canvas);
  }
}

/** Chão + paredes + props (tudo estático) — só a janela da câmera. */
export function drawWorld(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  viewW: number,
  viewH: number,
) {
  frameNo++;
  const scale = FX_MOBILE ? 0.5 : 1;
  if (scale !== chunkScale) {
    invalidateWorld();
    chunkScale = scale;
  }
  const cx0 = Math.max(0, Math.floor(camX / CH));
  const cy0 = Math.max(0, Math.floor(camY / CH));
  const cx1 = Math.min(NCX - 1, Math.floor((camX + viewW) / CH));
  const cy1 = Math.min(NCY - 1, Math.floor((camY + viewH) / CH));
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  const src = GUT * chunkScale;
  const sw = CH * chunkScale;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = getChunk(cx, cy);
      ctx.drawImage(c.canvas, src, src, sw, sw, cx * CH, cy * CH, CH, CH);
    }
  }
  ctx.imageSmoothingEnabled = prev;

  // pré-pinta 1 chunk do anel externo por frame (evita engasgo ao andar)
  let done = false;
  for (let cy = cy0 - 1; cy <= cy1 + 1 && !done; cy++) {
    for (let cx = cx0 - 1; cx <= cx1 + 1 && !done; cx++) {
      if (cx < 0 || cy < 0 || cx >= NCX || cy >= NCY) continue;
      if (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1) continue;
      if (chunks.has(cy * 1024 + cx)) {
        chunks.get(cy * 1024 + cx)!.used = frameNo;
        continue;
      }
      getChunk(cx, cy);
      done = true;
    }
  }
  evict();
}

/**
 * Pré-pinta até `budget` chunks em volta de (x, y) — chamar no lobby / antes
 * da partida, espalhando o custo (evita engasgo no 1º frame).
 * Retorna quantos chunks ainda faltam no raio.
 */
export function prewarmWorld(x: number, y: number, radiusPx = 1300, budget = 2): number {
  const scale = FX_MOBILE ? 0.5 : 1;
  if (scale !== chunkScale) {
    invalidateWorld();
    chunkScale = scale;
  }
  const cx0 = Math.max(0, Math.floor((x - radiusPx) / CH));
  const cy0 = Math.max(0, Math.floor((y - radiusPx * 0.7) / CH));
  const cx1 = Math.min(NCX - 1, Math.floor((x + radiusPx) / CH));
  const cy1 = Math.min(NCY - 1, Math.floor((y + radiusPx * 0.7) / CH));
  let missing = 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (chunks.has(cy * 1024 + cx)) continue;
      if (budget > 0 && chunks.size < maxChunks()) {
        getChunk(cx, cy);
        budget--;
      } else {
        missing++;
      }
    }
  }
  return missing;
}

/* ------------------------------------------------------------------ */
/* telhados (1 canvas pequeno por prédio)                              */
/* ------------------------------------------------------------------ */

const roofCache = new Map<number, HTMLCanvasElement>();
/** Quanto o telhado "sobe" na tela (3/4) — mostra a fachada sul. */
export const ROOF_LIFT = 14;

function buildingIsMetal(b: BuildingDef) {
  return solidAt(b.interior.tx - 1, b.interior.ty - 1) === T.METAL;
}

function paintRoof(b: BuildingDef): HTMLCanvasElement {
  const r = roofRect(b);
  const c = document.createElement("canvas");
  c.width = r.w;
  c.height = r.h;
  const g = c.getContext("2d")!;
  const seed = b.id * 7919 + 13;
  if (buildingIsMetal(b)) {
    // laje industrial: brita + platibanda + equipamentos
    const tex = ensureTextures().roofFlat;
    g.fillStyle = g.createPattern(tex, "repeat")!;
    g.fillRect(0, 0, r.w, r.h);
    g.strokeStyle = "rgba(0,0,0,0.18)";
    g.lineWidth = 1;
    for (let x = 40; x < r.w - 8; x += 48) {
      g.beginPath();
      g.moveTo(x + 0.5, 6);
      g.lineTo(x + 0.5, r.h - 6);
      g.stroke();
    }
    // platibanda
    g.fillStyle = "#8e918c";
    g.fillRect(0, 0, r.w, 5);
    g.fillRect(0, r.h - 5, r.w, 5);
    g.fillRect(0, 0, 5, r.h);
    g.fillRect(r.w - 5, 0, 5, r.h);
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(0, 0, r.w, 1.5);
    g.fillStyle = "rgba(0,0,0,0.28)";
    g.fillRect(5, 5, r.w - 10, 3);
    g.fillRect(5, 5, 3, r.h - 10);
    // ar-condicionado
    const ax = 14 + h2(seed, 1, 901) * (r.w - 56);
    const ay = 14 + h2(seed, 2, 902) * (r.h - 50);
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(ax + 4, ay + 5, 26, 20);
    g.fillStyle = "#b7bab4";
    g.fillRect(ax, ay, 26, 20);
    g.fillStyle = "#8a8d88";
    g.fillRect(ax, ay + 17, 26, 3);
    g.fillStyle = "#4b4e4b";
    g.beginPath();
    g.arc(ax + 13, ay + 9, 7, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#9da09a";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(ax + 7, ay + 9);
    g.lineTo(ax + 19, ay + 9);
    g.moveTo(ax + 13, ay + 3);
    g.lineTo(ax + 13, ay + 15);
    g.stroke();
    // claraboia
    if (r.w > 150 && r.h > 150) {
      const sx = r.w - 50 - h2(seed, 3, 903) * 30;
      const sy = r.h - 44 - h2(seed, 4, 904) * 30;
      g.fillStyle = "#5d625e";
      g.fillRect(sx - 2, sy - 2, 32, 22);
      g.fillStyle = "#4d6f84";
      g.fillRect(sx, sy, 28, 18);
      g.fillStyle = "rgba(210,235,250,0.35)";
      g.beginPath();
      g.moveTo(sx + 2, sy + 16);
      g.lineTo(sx + 12, sy + 2);
      g.lineTo(sx + 17, sy + 2);
      g.lineTo(sx + 7, sy + 16);
      g.closePath();
      g.fill();
    }
    // respiros
    for (let i = 0; i < 3; i++) {
      const vx = 12 + h2(seed, 10 + i, 905) * (r.w - 24);
      const vy = 12 + h2(seed, 20 + i, 906) * (r.h - 24);
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.beginPath();
      g.arc(vx + 2, vy + 3, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#6e716d";
      g.beginPath();
      g.arc(vx, vy, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#2a2c2b";
      g.beginPath();
      g.arc(vx, vy, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // telhado de telhas (duas águas) — cumeeira no eixo mais longo
    const alongX = r.w >= r.h;
    const lit: RGB = [168, 82, 58];
    const dark: RGB = [124, 58, 42];
    if (alongX) {
      g.fillStyle = rgb(lit);
      g.fillRect(0, 0, r.w, r.h / 2);
      g.fillStyle = rgb(dark);
      g.fillRect(0, r.h / 2, r.w, r.h / 2);
      for (let y = 5; y < r.h; y += 6) {
        const row = Math.floor(y / 6);
        g.fillStyle = y < r.h / 2 ? "rgba(70,24,14,0.35)" : "rgba(40,12,8,0.4)";
        g.fillRect(0, y, r.w, 1.5);
        for (let x = (row % 2) * 5; x < r.w; x += 10) {
          g.fillRect(x, y - 5, 1, 5);
          if (h2(x, row, 911 + seed) < 0.06) {
            g.fillStyle = "rgba(60,20,12,0.45)";
            g.fillRect(x + 1, y - 5, 9, 5);
            g.fillStyle = y < r.h / 2 ? "rgba(70,24,14,0.35)" : "rgba(40,12,8,0.4)";
          }
        }
      }
      g.fillStyle = "#b86a4c";
      g.fillRect(0, r.h / 2 - 3, r.w, 6);
      g.fillStyle = "rgba(255,230,200,0.25)";
      g.fillRect(0, r.h / 2 - 3, r.w, 1.5);
    } else {
      g.fillStyle = rgb(lit);
      g.fillRect(0, 0, r.w / 2, r.h);
      g.fillStyle = rgb(dark);
      g.fillRect(r.w / 2, 0, r.w / 2, r.h);
      for (let x = 5; x < r.w; x += 6) {
        const col = Math.floor(x / 6);
        g.fillStyle = x < r.w / 2 ? "rgba(70,24,14,0.35)" : "rgba(40,12,8,0.4)";
        g.fillRect(x, 0, 1.5, r.h);
        for (let y = (col % 2) * 5; y < r.h; y += 10) g.fillRect(x - 5, y, 5, 1);
      }
      g.fillStyle = "#b86a4c";
      g.fillRect(r.w / 2 - 3, 0, 6, r.h);
      g.fillStyle = "rgba(255,230,200,0.25)";
      g.fillRect(r.w / 2 - 3, 0, 1.5, r.h);
    }
    // chaminé
    const chx = 16 + h2(seed, 5, 912) * (r.w - 48);
    const chy = 12 + h2(seed, 6, 913) * (r.h - 44);
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(chx + 4, chy + 6, 16, 16);
    g.fillStyle = "#7a3d2c";
    g.fillRect(chx, chy, 16, 16);
    g.fillStyle = "#96543c";
    g.fillRect(chx, chy, 16, 3);
    g.fillStyle = "#1c1412";
    g.fillRect(chx + 4, chy + 4, 8, 8);
    // musgo
    for (let i = 0; i < 5; i++) {
      g.fillStyle = "rgba(96,120,58,0.35)";
      g.beginPath();
      g.arc(h2(seed, 30 + i, 914) * r.w, h2(seed, 40 + i, 915) * r.h, 3 + h2(seed, 50 + i, 916) * 5, 0, Math.PI * 2);
      g.fill();
    }
    // beiral
    g.strokeStyle = "rgba(40,14,8,0.8)";
    g.lineWidth = 2;
    g.strokeRect(1, 1, r.w - 2, r.h - 2);
  }
  return c;
}

function roofCanvas(b: BuildingDef): HTMLCanvasElement {
  let c = roofCache.get(b.id);
  if (!c) {
    c = paintRoof(b);
    roofCache.set(b.id, c);
  }
  return c;
}

/** Telhados por cima de tudo, com fade quando o jogador entra. */
export function drawRoofLayer(
  ctx: CanvasRenderingContext2D,
  roofAlpha: Map<number, number>,
  camX: number,
  camY: number,
  viewW: number,
  viewH: number,
) {
  const vx1 = camX + viewW;
  const vy1 = camY + viewH;
  for (const b of BUILDINGS) {
    const a = roofAlpha.get(b.id) ?? 1;
    if (a <= 0.02) continue;
    const r = roofRect(b);
    if (r.x + r.w + 12 < camX || r.x > vx1 || r.y + r.h + 16 < camY || r.y - ROOF_LIFT > vy1) continue;
    // sombra projetada do volume do prédio
    ctx.globalAlpha = a * 0.3;
    ctx.fillStyle = "#0b0910";
    ctx.fillRect(r.x + 8, r.y + 6, r.w, r.h);
    ctx.globalAlpha = a;
    ctx.drawImage(roofCanvas(b), r.x, r.y - ROOF_LIFT, r.w, r.h);
  }
  ctx.globalAlpha = 1;
}
