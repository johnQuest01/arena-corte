/**
 * fx2_core.ts — motor dos efeitos "Novos" dos poderes.
 *
 * Partículas com altura (z) e gravidade (arcos 3/4 de verdade), brilho aditivo
 * com sprites pré-renderizados (sem shadowBlur e sem gradiente por partícula),
 * anéis de choque, marcas no chão e animações curtas por closure.
 * Tudo client-side — não mexe na simulação.
 */

export const TAU = Math.PI * 2;

/** Perfil leve (celular): menos partículas. */
export let FX2_LITE = false;
let MAX_PARTS = 1100;
let MAX_DECALS = 20;

export function setFx2Lite(on: boolean) {
  FX2_LITE = on;
  MAX_PARTS = on ? 380 : 1100;
  MAX_DECALS = on ? 10 : 20;
}

/** Quantidade no orçamento atual (celular ≈ 40%). */
export function qty(n: number): number {
  return FX2_LITE ? Math.max(1, Math.round(n * 0.4)) : n;
}

export function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function hash01(seed: number, i: number): number {
  let n = (seed ^ Math.imul(i + 1, 374761393) ^ 668265263) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function clamp01(u: number): number {
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

export function easeOut(u: number): number {
  const k = 1 - clamp01(u);
  return 1 - k * k * k;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ═══════════════════════ sprites (cache) ═══════════════════════ */

const sprites = new Map<string, HTMLCanvasElement>();

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function cached(key: string, build: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = sprites.get(key);
  if (!c) {
    c = build();
    sprites.set(key, c);
  }
  return c;
}

/** Brilho radial suave (para "lighter"). rgb = "255,180,60". */
export function glowSprite(rgb: string): HTMLCanvasElement {
  return cached("g" + rgb, () => {
    const c = makeCanvas(64, 64);
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},1)`);
    gr.addColorStop(0.2, `rgba(${rgb},0.72)`);
    gr.addColorStop(0.48, `rgba(${rgb},0.26)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return c;
  });
}

/** Núcleo quente: miolo branco e borda colorida (fogo, raio, magia). */
export function hotSprite(rgb: string): HTMLCanvasElement {
  return cached("h" + rgb, () => {
    const c = makeCanvas(64, 64);
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.16, "rgba(255,255,245,0.95)");
    gr.addColorStop(0.34, `rgba(${rgb},0.7)`);
    gr.addColorStop(0.62, `rgba(${rgb},0.2)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return c;
  });
}

/** Bolha de fumaça/névoa irregular (4 variantes por cor). */
export function puffSprite(rgb: string, v: number): HTMLCanvasElement {
  const vi = v & 3;
  return cached(`p${rgb}|${vi}`, () => {
    const c = makeCanvas(64, 64);
    const g = c.getContext("2d")!;
    const seed = 97 + vi * 131;
    for (let i = 0; i < 6; i++) {
      const a = hash01(seed, i) * TAU;
      const d = i === 0 ? 0 : 6 + hash01(seed, i + 9) * 9;
      const cx = 32 + Math.cos(a) * d;
      const cy = 32 + Math.sin(a) * d * 0.85;
      const r = i === 0 ? 20 : 11 + hash01(seed, i + 19) * 8;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, `rgba(${rgb},0.55)`);
      gr.addColorStop(0.55, `rgba(${rgb},0.32)`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();
    }
    return c;
  });
}

/** Floco de neve de 6 pontas. */
export function flakeSprite(): HTMLCanvasElement {
  return cached("flake", () => {
    const c = makeCanvas(32, 32);
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(220,245,255,0.55)");
    gr.addColorStop(1, "rgba(220,245,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 32, 32);
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.lineCap = "round";
    g.lineWidth = 1.6;
    g.translate(16, 16);
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -12);
      g.moveTo(0, -7);
      g.lineTo(-3.2, -10);
      g.moveTo(0, -7);
      g.lineTo(3.2, -10);
      g.stroke();
    }
    return c;
  });
}

/** Cintilar em cruz (estrela de 4 pontas). */
export function twinkleSprite(rgb: string): HTMLCanvasElement {
  return cached("t" + rgb, () => {
    const c = makeCanvas(48, 48);
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(24, 24, 0, 24, 24, 10);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.4, `rgba(${rgb},0.6)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 48, 48);
    for (const [w, h] of [
      [24, 1.6],
      [1.6, 24],
    ] as const) {
      const lg = w > h ? g.createLinearGradient(0, 24, 48, 24) : g.createLinearGradient(24, 0, 24, 48);
      lg.addColorStop(0, `rgba(${rgb},0)`);
      lg.addColorStop(0.5, "rgba(255,255,255,1)");
      lg.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = lg;
      g.fillRect(24 - w, 24 - h, w * 2, h * 2);
    }
    return c;
  });
}

/* ═══════════════════════ partículas ═══════════════════════ */

export const GLOW = 0;
export const SPARK = 1;
export const SMOKE = 2;
export const DROP = 3;
export const SHARD = 4;
export const ROCK = 5;
export const EMBER = 6;
export const FLAKE = 7;
export const TWINKLE = 8;
export const HOT = 9;

export interface Part {
  k: number;
  x: number;
  y: number;
  /** altura acima do chão (desenha em y - z) */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** gravidade em z (px/s²) */
  g: number;
  /** amortecimento (1/s) */
  drag: number;
  /** quique no chão (0 = gruda) */
  bounce: number;
  life: number;
  max: number;
  /** ms antes de aparecer */
  delay: number;
  r0: number;
  r1: number;
  a: number;
  rot: number;
  vr: number;
  /** "r,g,b" */
  rgb: string;
  /** cor sólida pronta (rgb(...)) */
  css: string;
  /** borda/face clara (cacos, pedras) */
  css2: string;
  add: boolean;
  ground: boolean;
  /** fração da vida com fade-in */
  fin: number;
  /** a partir de que fração começa o fade-out */
  fout: number;
  v: number;
}

const parts: Part[] = [];
const pool: Part[] = [];

const DEF: Omit<Part, "k" | "x" | "y"> = {
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  g: 0,
  drag: 0,
  bounce: 0,
  life: 500,
  max: 500,
  delay: 0,
  r0: 2,
  r1: 2,
  a: 1,
  rot: 0,
  vr: 0,
  rgb: "255,255,255",
  css: "",
  css2: "",
  add: false,
  ground: false,
  fin: 0.06,
  fout: 0.5,
  v: 0,
};

export type PartOpts = Partial<Omit<Part, "k" | "x" | "y" | "css">>;

export function emit(k: number, x: number, y: number, o: PartOpts = {}): Part {
  const p = pool.pop() ?? ({} as Part);
  Object.assign(p, DEF, o);
  p.k = k;
  p.x = x;
  p.y = y;
  if (o.life != null && o.max == null) p.max = o.life;
  if (o.max != null && o.life == null) p.life = o.max;
  p.css = `rgb(${p.rgb})`;
  if (!o.css2) p.css2 = p.css;
  if (o.v == null) p.v = (Math.random() * 1024) | 0;
  if (parts.length >= MAX_PARTS) {
    const old = parts[0]!;
    parts[0] = parts[parts.length - 1]!;
    parts.pop();
    pool.push(old);
  }
  parts.push(p);
  return p;
}

/* ═══════════════════════ anéis de choque ═══════════════════════ */

export interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  w0: number;
  w1: number;
  life: number;
  max: number;
  delay: number;
  css: string;
  a: number;
  /** achatamento vertical (perspectiva do chão) */
  sq: number;
  add: boolean;
  ground: boolean;
  /** halo largo por baixo */
  soft: boolean;
}

const rings: Ring[] = [];

export function ring(
  x: number,
  y: number,
  o: Partial<Omit<Ring, "x" | "y" | "css">> & { rgb?: string },
) {
  const max = o.max ?? o.life ?? 400;
  rings.push({
    x,
    y,
    r0: o.r0 ?? 4,
    r1: o.r1 ?? 80,
    w0: o.w0 ?? 6,
    w1: o.w1 ?? 1,
    life: max,
    max,
    delay: o.delay ?? 0,
    css: `rgb(${o.rgb ?? "255,255,255"})`,
    a: o.a ?? 0.8,
    sq: o.sq ?? 0.6,
    add: o.add ?? true,
    ground: o.ground ?? true,
    soft: o.soft ?? true,
  });
  while (rings.length > 40) rings.shift();
}

/* ═══════════════════════ marcas no chão ═══════════════════════ */

export interface Decal {
  img: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  life: number;
  max: number;
  fadeIn: number;
  fadeOut: number;
  a: number;
  add: boolean;
  /** brilho que esfria (desenho extra por cima) */
  over?: (ctx: CanvasRenderingContext2D, d: Decal, u: number, tMs: number) => void;
}

const decals: Decal[] = [];

export function decal(
  img: HTMLCanvasElement,
  x: number,
  y: number,
  o: Partial<Omit<Decal, "img" | "x" | "y">> = {},
): Decal {
  const max = o.max ?? o.life ?? 6000;
  const d: Decal = {
    img,
    x,
    y,
    w: o.w ?? img.width,
    h: o.h ?? img.height,
    life: max,
    max,
    fadeIn: o.fadeIn ?? 120,
    fadeOut: o.fadeOut ?? Math.min(2500, max * 0.4),
    a: o.a ?? 1,
    add: o.add ?? false,
    over: o.over,
  };
  decals.push(d);
  while (decals.length > MAX_DECALS) decals.shift();
  return d;
}

/* ═══════════════════════ animações por closure ═══════════════════════ */

export interface Anim {
  age: number;
  dur: number;
  delay: number;
  /** 0 = chão (antes dos personagens), 1 = ar (depois) */
  layer: 0 | 1;
  draw: (ctx: CanvasRenderingContext2D, u: number, age: number, tMs: number) => void;
  tick?: (dtMs: number, age: number) => void;
}

const anims: Anim[] = [];

export function anim(a: Omit<Anim, "age" | "delay"> & { delay?: number }): Anim {
  const full: Anim = { age: 0, delay: a.delay ?? 0, ...a };
  anims.push(full);
  while (anims.length > 48) anims.shift();
  return full;
}

/* ═══════════════════════ tick / clear ═══════════════════════ */

let clock = 0;
export function fx2Clock(): number {
  return clock;
}

export function tickFx2Core(dtMs: number) {
  clock += dtMs;
  const dt = dtMs / 1000;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (p.delay > 0) {
      p.delay -= dtMs;
      continue;
    }
    p.life -= dtMs;
    if (p.life <= 0) {
      parts[i] = parts[parts.length - 1]!;
      parts.pop();
      pool.push(p);
      continue;
    }
    if (p.drag > 0) {
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vz *= d;
    }
    p.vz -= p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    if (p.z < 0) {
      if (p.bounce > 0 && p.vz < -60) {
        p.z = 0;
        p.vz = -p.vz * p.bounce;
        p.vx *= 0.55;
        p.vy *= 0.55;
        p.vr *= 0.5;
      } else {
        p.z = 0;
        p.vz = 0;
        if (p.g > 0) {
          // no chão: atrito
          const f = Math.exp(-9 * dt);
          p.vx *= f;
          p.vy *= f;
          p.vr *= f;
        }
      }
    }
    p.rot += p.vr * dt;
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]!;
    if (r.delay > 0) {
      r.delay -= dtMs;
      continue;
    }
    r.life -= dtMs;
    if (r.life <= 0) rings.splice(i, 1);
  }
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i]!;
    d.life -= dtMs;
    if (d.life <= 0) decals.splice(i, 1);
  }
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i]!;
    if (a.delay > 0) {
      a.delay -= dtMs;
      continue;
    }
    a.age += dtMs;
    a.tick?.(dtMs, a.age);
    if (a.age >= a.dur) anims.splice(i, 1);
  }
}

export function clearFx2Core() {
  for (const p of parts) pool.push(p);
  parts.length = 0;
  rings.length = 0;
  decals.length = 0;
  anims.length = 0;
}

export function fx2Counts() {
  return { parts: parts.length, rings: rings.length, decals: decals.length, anims: anims.length };
}

/* ═══════════════════════ desenho ═══════════════════════ */

let vx0 = -1e9;
let vy0 = -1e9;
let vx1 = 1e9;
let vy1 = 1e9;

/** Retângulo visível (mundo) — pula o que está fora da tela. */
export function setFx2View(x: number, y: number, w: number, h: number) {
  const pad = 160;
  vx0 = x - pad;
  vy0 = y - pad;
  vx1 = x + w + pad;
  vy1 = y + h + pad;
}

function partAlpha(p: Part, u: number): number {
  let a = p.a;
  if (p.fin > 0 && u < p.fin) a *= u / p.fin;
  if (u > p.fout) a *= 1 - (u - p.fout) / (1 - p.fout);
  return a;
}

function drawPart(ctx: CanvasRenderingContext2D, p: Part, m: DOMMatrix, tMs: number) {
  const u = 1 - p.life / p.max;
  const r = p.r0 + (p.r1 - p.r0) * u;
  let a = partAlpha(p, u);
  if (a <= 0.004 || r <= 0.05) return;
  const sy = p.y - p.z;
  switch (p.k) {
    case GLOW:
    case HOT:
    case EMBER: {
      if (p.k === EMBER) a *= 0.55 + 0.45 * Math.sin(tMs * 0.03 + p.v);
      const img = p.k === HOT ? hotSprite(p.rgb) : glowSprite(p.rgb);
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(img, p.x - r, sy - r, r * 2, r * 2);
      return;
    }
    case SMOKE: {
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(puffSprite(p.rgb, p.v), p.x - r, sy - r, r * 2, r * 2);
      return;
    }
    case SPARK: {
      const svx = p.vx;
      const svy = p.vy - p.vz;
      const sp = Math.hypot(svx, svy);
      const len = Math.max(2, Math.min(30, sp * 0.032));
      const ux = sp > 1 ? svx / sp : 0;
      const uy = sp > 1 ? svy / sp : 1;
      batchLine(p.css, Math.max(0.5, Math.round(r * 2) / 2), a, p.x, sy, p.x - ux * len, sy - uy * len);
      return;
    }
    case DROP: {
      const svx = p.vx;
      const svy = p.vy - p.vz;
      const sp = Math.hypot(svx, svy);
      const len = Math.min(16, sp * 0.02);
      const x2 = sp > 1 ? p.x - (svx / sp) * len : p.x + 0.01;
      const y2 = sp > 1 ? sy - (svy / sp) * len : sy;
      batchLine(p.css, Math.max(1, Math.round(r * 2)), a, p.x, sy, x2, y2);
      if (r > 1.6) batchLine("#fff", 1, a * 0.85, p.x - r * 0.2, sy - r * 0.35, p.x - r * 0.1, sy - r * 0.3);
      return;
    }
    case SHARD:
    case ROCK: {
      ctx.globalAlpha = Math.min(1, a);
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      const n = p.k === SHARD ? 3 : 5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU;
        const rr =
          p.k === SHARD
            ? r * (i === 0 ? 1.35 : 0.6 + ((p.v >> i) & 1) * 0.25)
            : r * (0.72 + hash01(p.v, i) * 0.4);
        const lx = Math.cos(ang) * rr;
        const ly = Math.sin(ang) * rr * (p.k === SHARD ? 0.7 : 0.8);
        const X = p.x + lx * c - ly * s;
        const Y = sy + lx * s + ly * c;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      }
      ctx.closePath();
      ctx.fillStyle = p.css;
      ctx.fill();
      ctx.strokeStyle = p.css2;
      ctx.lineWidth = p.k === SHARD ? 1 : 1.2;
      ctx.stroke();
      return;
    }
    case FLAKE:
    case TWINKLE: {
      const img = p.k === FLAKE ? flakeSprite() : twinkleSprite(p.rgb);
      const size = r * 2 * (p.k === TWINKLE ? 0.75 + 0.25 * Math.sin(tMs * 0.02 + p.v) : 1);
      ctx.globalAlpha = Math.min(1, a);
      if (p.k === FLAKE && p.rot !== 0) {
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        ctx.setTransform(
          m.a * c + m.c * s,
          m.b * c + m.d * s,
          -m.a * s + m.c * c,
          -m.b * s + m.d * c,
          m.a * p.x + m.c * sy + m.e,
          m.b * p.x + m.d * sy + m.f,
        );
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
        ctx.setTransform(m);
      } else {
        ctx.drawImage(img, p.x - size / 2, sy - size / 2, size, size);
      }
      return;
    }
  }
}

/* Lotes: traços com a mesma cor/espessura/alfa saem num único stroke. */
const lineBatches = new Map<string, number[]>();
let shadowPath = new Path2D();
let shadowCount = 0;

function batchLine(css: string, w: number, a: number, x1: number, y1: number, x2: number, y2: number) {
  const aq = Math.round(Math.min(1, a) * 10);
  if (aq <= 0) return;
  const key = css + "|" + w + "|" + aq;
  let arr = lineBatches.get(key);
  if (!arr) {
    arr = [];
    lineBatches.set(key, arr);
  }
  arr.push(x1, y1, x2, y2);
}

function flushLines(ctx: CanvasRenderingContext2D) {
  for (const [key, arr] of lineBatches) {
    if (!arr.length) continue;
    const i1 = key.indexOf("|");
    const i2 = key.indexOf("|", i1 + 1);
    ctx.strokeStyle = key.slice(0, i1);
    ctx.lineWidth = Number(key.slice(i1 + 1, i2));
    ctx.globalAlpha = Number(key.slice(i2 + 1)) / 10;
    ctx.beginPath();
    for (let i = 0; i < arr.length; i += 4) {
      ctx.moveTo(arr[i]!, arr[i + 1]!);
      ctx.lineTo(arr[i + 2]!, arr[i + 3]!);
    }
    ctx.stroke();
    arr.length = 0;
  }
  if (lineBatches.size > 256) lineBatches.clear();
}

function drawPartsLayer(ctx: CanvasRenderingContext2D, ground: boolean, tMs: number) {
  if (!parts.length) return;
  const m = ctx.getTransform();
  ctx.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    const add = pass === 1;
    ctx.globalCompositeOperation = add ? "lighter" : "source-over";
    if (!add) {
      // sombras das pedras/cacos: um preenchimento só, antes deles
      shadowPath = new Path2D();
      shadowCount = 0;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]!;
        if (p.add || p.ground !== ground || p.delay > 0 || (p.k !== ROCK && p.k !== SHARD) || p.z <= 3) continue;
        if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
        const r = p.r0 + (p.r1 - p.r0) * (1 - p.life / p.max);
        // moveTo antes de cada elipse: sem isso o path liga uma à outra e vira um polígono enorme
        shadowPath.moveTo(p.x + r * 0.9, p.y);
        shadowPath.ellipse(p.x, p.y, r * 0.9, r * 0.4, 0, 0, TAU);
        shadowCount++;
      }
      if (shadowCount) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = "#000";
        ctx.fill(shadowPath);
      }
    }
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p.add !== add || p.ground !== ground || p.delay > 0) continue;
      if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
      drawPart(ctx, p, m, tMs);
    }
    flushLines(ctx);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

function drawRingsLayer(ctx: CanvasRenderingContext2D, ground: boolean) {
  for (const g of rings) {
    if (g.delay > 0 || g.ground !== ground) continue;
    const u = 1 - g.life / g.max;
    const e = easeOut(u);
    const r = g.r0 + (g.r1 - g.r0) * e;
    const w = Math.max(0.5, g.w0 + (g.w1 - g.w0) * u);
    const a = g.a * Math.pow(1 - u, 1.3);
    if (a < 0.01) continue;
    ctx.globalCompositeOperation = g.add ? "lighter" : "source-over";
    ctx.strokeStyle = g.css;
    // halo largo só nos anéis pequenos (nos grandes custa caro e quase não aparece)
    if (g.soft && g.r1 <= 130) {
      ctx.globalAlpha = a * 0.22;
      ctx.lineWidth = w * 3.2;
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, r, r * g.sq, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, r, r * g.sq, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

function drawAnimsLayer(ctx: CanvasRenderingContext2D, layer: 0 | 1, tMs: number) {
  for (const a of anims) {
    if (a.layer !== layer || a.delay > 0) continue;
    ctx.save();
    a.draw(ctx, Math.min(1, a.age / a.dur), a.age, tMs);
    ctx.restore();
  }
}

/** Camada do chão: marcas, anéis, animações rasteiras e partículas "ground". */
export function drawFx2CoreGround(ctx: CanvasRenderingContext2D, tMs: number) {
  if (!decals.length && !rings.length && !anims.length && !parts.length) return;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  for (const d of decals) {
    if (d.x + d.w < vx0 || d.x - d.w > vx1 || d.y + d.h < vy0 || d.y - d.h > vy1) continue;
    const age = d.max - d.life;
    let a = d.a;
    if (age < d.fadeIn) a *= age / d.fadeIn;
    if (d.life < d.fadeOut) a *= d.life / d.fadeOut;
    if (a <= 0.01) continue;
    ctx.globalCompositeOperation = d.add ? "lighter" : "source-over";
    ctx.globalAlpha = a;
    ctx.drawImage(d.img, d.x - d.w / 2, d.y - d.h / 2, d.w, d.h);
    if (d.over) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      d.over(ctx, d, 1 - d.life / d.max, tMs);
    }
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  drawAnimsLayer(ctx, 0, tMs);
  drawRingsLayer(ctx, true);
  drawPartsLayer(ctx, true, tMs);
  ctx.restore();
}

/** Camada do ar (por cima dos personagens). */
export function drawFx2CoreAir(ctx: CanvasRenderingContext2D, tMs: number) {
  if (!rings.length && !anims.length && !parts.length) return;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  drawAnimsLayer(ctx, 1, tMs);
  drawRingsLayer(ctx, false);
  drawPartsLayer(ctx, false, tMs);
  ctx.restore();
}
