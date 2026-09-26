/**
 * capes.ts — física de pano (verlet) para TODAS as capas + desenho em fita.
 *
 * Cada capa é uma corrente de 7 pontos presa nos ombros. Gravidade puxa pra
 * baixo da tela (3/4), um viés empurra pra trás do corpo e a inércia faz a
 * capa arrastar ao correr / esticar no dash. Custo: poucas dezenas de
 * operações por capa por frame.
 */
import type { CapeDef } from "../../../shared/cosmetics";

const N = 7;
const SEG = 7.2;
const GRAVITY = 820;
const BACK_PUSH = 210;
const DAMP = 0.962;
const ITERS = 4;
const STEP = 1 / 60;

interface CapeSim {
  x: Float32Array;
  y: Float32Array;
  ox: Float32Array;
  oy: Float32Array;
  lastT: number;
  ax: number;
  ay: number;
  stretch: number;
  usedAt: number;
  /** semente das dobras (cada capa balança diferente) */
  seed: number;
  /** barra (hem) do último desenho — origem das partículas da capa */
  hem: [number, number, number, number, number, number] | null;
}

const sims = new Map<string, CapeSim>();

function init(ax: number, ay: number, aim: number, t: number): CapeSim {
  const bx = -Math.cos(aim) * 0.35;
  const s: CapeSim = {
    x: new Float32Array(N),
    y: new Float32Array(N),
    ox: new Float32Array(N),
    oy: new Float32Array(N),
    lastT: t,
    ax,
    ay,
    stretch: 1,
    usedAt: t,
    seed: Math.random() * 10,
    hem: null,
  };
  for (let i = 0; i < N; i++) {
    s.x[i] = s.ox[i] = ax + bx * SEG * i;
    s.y[i] = s.oy[i] = ay + SEG * i * 0.9;
  }
  return s;
}

export interface CapeStepOpts {
  /** dash da Capa de Recuo: pano estica */
  dash?: boolean;
  frozen?: boolean;
  /** y do chão (pés) — a capa não passa disso */
  floorY: number;
  /** escala do corpo (comprimento da capa) */
  scale?: number;
}

/** Avança a simulação da capa `key` com a âncora (mundo) atual. */
export function stepCape(
  key: string,
  ax: number,
  ay: number,
  aim: number,
  tMs: number,
  opts: CapeStepOpts,
) {
  let s = sims.get(key);
  if (!s || Math.hypot(ax - s.ax, ay - s.ay) > 160 || tMs - s.usedAt > 1500) {
    s = init(ax, ay, aim, tMs);
    sims.set(key, s);
  }
  s.usedAt = tMs;
  let dt = (tMs - s.lastT) / 1000;
  s.lastT = tMs;
  if (!(dt > 0)) return;
  dt = Math.min(dt, 0.05);
  const targetStretch = opts.dash ? 1.55 : 1;
  s.stretch += (targetStretch - s.stretch) * Math.min(1, dt * 12);
  if (opts.frozen) {
    // congelado: pano duro, só acompanha a âncora
    const dx = ax - s.ax;
    const dy = ay - s.ay;
    for (let i = 0; i < N; i++) {
      s.x[i]! += dx;
      s.y[i]! += dy;
      s.ox[i] = s.x[i]!;
      s.oy[i] = s.y[i]!;
    }
    s.ax = ax;
    s.ay = ay;
    return;
  }
  const steps = Math.max(1, Math.ceil(dt / STEP));
  const h = dt / steps;
  const fx = Math.cos(aim);
  const fy = Math.sin(aim);
  const len = SEG * s.stretch * (opts.scale ?? 1);
  for (let k = 0; k < steps; k++) {
    // âncora interpolada no substep (anti-"teleporte" do pano)
    const u = (k + 1) / steps;
    const px = s.ax + (ax - s.ax) * u;
    const py = s.ay + (ay - s.ay) * u;
    for (let i = 1; i < N; i++) {
      const vx = (s.x[i]! - s.ox[i]!) * DAMP;
      const vy = (s.y[i]! - s.oy[i]!) * DAMP;
      s.ox[i] = s.x[i]!;
      s.oy[i] = s.y[i]!;
      const w = i / (N - 1);
      // tremulado leve na ponta
      const flutter = Math.sin(tMs * 0.012 + i * 1.3) * 60 * w;
      const ax2 = -fx * BACK_PUSH * (0.4 + w) + -fy * flutter;
      const ay2 = GRAVITY - fy * BACK_PUSH * 0.55 * (0.4 + w) + fx * flutter;
      s.x[i] = s.x[i]! + vx + ax2 * h * h;
      s.y[i] = s.y[i]! + vy + ay2 * h * h;
    }
    s.x[0] = px;
    s.y[0] = py;
    for (let it = 0; it < ITERS; it++) {
      for (let i = 1; i < N; i++) {
        const dx = s.x[i]! - s.x[i - 1]!;
        const dy = s.y[i]! - s.y[i - 1]!;
        const d = Math.hypot(dx, dy) || 0.0001;
        const diff = (d - len) / d;
        if (i === 1) {
          s.x[i] = s.x[i]! - dx * diff;
          s.y[i] = s.y[i]! - dy * diff;
        } else {
          s.x[i] = s.x[i]! - dx * diff * 0.5;
          s.y[i] = s.y[i]! - dy * diff * 0.5;
          s.x[i - 1] = s.x[i - 1]! + dx * diff * 0.5;
          s.y[i - 1] = s.y[i - 1]! + dy * diff * 0.5;
        }
      }
      s.x[0] = px;
      s.y[0] = py;
      for (let i = 1; i < N; i++) {
        if (s.y[i]! > opts.floorY) s.y[i] = opts.floorY;
      }
    }
  }
  s.ax = ax;
  s.ay = ay;
}

/** Limpa capas que não aparecem há tempo (jogador saiu). */
export function pruneCapes(tMs: number) {
  for (const [k, s] of sims) if (tMs - s.usedAt > 5000) sims.delete(k);
}

const RAINBOW = ["#e04040", "#f08a30", "#f0d040", "#50b050", "#3a80e0", "#6a4ac0", "#b04ab0"];

export interface CapeDrawOpts {
  /** largura nos ombros (px) */
  width: number;
  /** dash: brilho nas bordas */
  glow?: string;
  alpha?: number;
}

/** Desenha a capa `key` (coordenadas de mundo — chamar sem translate do corpo). */
export function drawCape(ctx: CanvasRenderingContext2D, key: string, def: CapeDef, o: CapeDrawOpts) {
  const s = sims.get(key);
  if (!s) return;
  if (def.style === "draftRecoil" || def.style === "draftShield") drawCapeDraft(ctx, s, def, o);
  else drawCapeNew(ctx, s, def, o);
}

/** Barra da capa no último desenho (mundo): pontas esquerda/direita + direção "pra baixo". */
export function capeHem(key: string): { x0: number; y0: number; x1: number; y1: number; dx: number; dy: number } | null {
  const h = sims.get(key)?.hem;
  if (!h) return null;
  return { x0: h[0], y0: h[1], x1: h[2], y1: h[3], dx: h[4], dy: h[5] };
}

/** Desenho das capas "Rascunho" (o de antes, preservado). */
function drawCapeDraft(ctx: CanvasRenderingContext2D, s: CapeSim, def: CapeDef, o: CapeDrawOpts) {
  const L: [number, number][] = [];
  const R: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(N - 1, i + 1);
    let tx = s.x[i1]! - s.x[i0]!;
    let ty = s.y[i1]! - s.y[i0]!;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const w = i / (N - 1);
    const half = (o.width / 2) * (1 + w * 0.75) * (1 + Math.sin(s.lastT * 0.01 + i) * 0.04 * w);
    L.push([s.x[i]! - ty * half, s.y[i]! + tx * half]);
    R.push([s.x[i]! + ty * half, s.y[i]! - tx * half]);
  }
  const tattered = def.style === "tattered";
  ctx.save();
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  ctx.lineJoin = "round";
  // contorno + corpo
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(L[0]![0], L[0]![1]);
    for (let i = 1; i < N; i++) ctx.lineTo(L[i]![0], L[i]![1]);
    // barra (reta, ou esfarrapada)
    const a = L[N - 1]!;
    const b = R[N - 1]!;
    if (tattered) {
      const cuts = 6;
      for (let k = 1; k <= cuts; k++) {
        const u = k / cuts;
        const mx = a[0] + (b[0] - a[0]) * u;
        const my = a[1] + (b[1] - a[1]) * u;
        const up = k % 2 === 0 ? 0 : -7 - (k % 3) * 2;
        // "para dentro" = direção do penúltimo ponto
        const ix = s.x[N - 2]! - s.x[N - 1]!;
        const iy = s.y[N - 2]! - s.y[N - 1]!;
        const il = Math.hypot(ix, iy) || 1;
        ctx.lineTo(mx - (ix / il) * up, my - (iy / il) * up);
      }
    } else {
      ctx.quadraticCurveTo(
        (a[0] + b[0]) / 2 + (s.x[N - 1]! - s.x[N - 2]!) * 0.4,
        (a[1] + b[1]) / 2 + (s.y[N - 1]! - s.y[N - 2]!) * 0.4,
        b[0],
        b[1],
      );
    }
    for (let i = N - 1; i >= 0; i--) ctx.lineTo(R[i]![0], R[i]![1]);
    ctx.closePath();
  };
  outline();
  if (def.style === "rainbow") {
    ctx.save();
    ctx.clip();
    for (let i = 0; i < N - 1; i++) {
      ctx.fillStyle = RAINBOW[i % RAINBOW.length]!;
      ctx.beginPath();
      ctx.moveTo(L[i]![0], L[i]![1]);
      ctx.lineTo(L[i + 1]![0], L[i + 1]![1]);
      ctx.lineTo(R[i + 1]![0], R[i + 1]![1]);
      ctx.lineTo(R[i]![0], R[i]![1]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  } else {
    ctx.fillStyle = def.main;
    ctx.fill();
  }
  // dobras: faixas escuras ao longo do comprimento (lado de dentro)
  ctx.save();
  outline();
  ctx.clip();
  ctx.strokeStyle = def.inner;
  ctx.globalAlpha *= 0.55;
  ctx.lineWidth = 3;
  for (const off of [-0.34, 0.3]) {
    ctx.beginPath();
    for (let i = 1; i < N; i++) {
      const w = i / (N - 1);
      const lx = L[i]![0] + (R[i]![0] - L[i]![0]) * (0.5 + off * (0.6 + w * 0.4));
      const ly = L[i]![1] + (R[i]![1] - L[i]![1]) * (0.5 + off * (0.6 + w * 0.4));
      if (i === 1) ctx.moveTo(lx, ly);
      else ctx.lineTo(lx, ly);
    }
    ctx.stroke();
  }
  ctx.globalAlpha /= 0.55;
  // luz na borda esquerda
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(L[1]![0], L[1]![1]);
  for (let i = 2; i < N; i++) ctx.lineTo(L[i]![0], L[i]![1]);
  ctx.stroke();
  // barra decorada
  if (!tattered && def.trim) {
    ctx.strokeStyle = def.trim;
    ctx.lineWidth = def.style === "royal" ? 4.5 : 2.2;
    ctx.beginPath();
    const a = L[N - 1]!;
    const b = R[N - 1]!;
    const ix = (s.x[N - 2]! - s.x[N - 1]!) * 0.3;
    const iy = (s.y[N - 2]! - s.y[N - 1]!) * 0.3;
    ctx.moveTo(a[0] + ix, a[1] + iy);
    ctx.lineTo(b[0] + ix, b[1] + iy);
    ctx.stroke();
  }
  // emblema dos itens "Rascunho" (retângulo das capas antigas)
  if (def.style === "draftRecoil" || def.style === "draftShield") {
    const mx = (s.x[1]! + s.x[2]!) / 2;
    const my = (s.y[1]! + s.y[2]!) / 2;
    ctx.fillStyle = def.inner;
    ctx.fillRect(mx - 4, my - 6, 8, 12);
  }
  ctx.restore();
  // contorno
  outline();
  ctx.strokeStyle = "rgba(20,14,12,0.85)";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  if (o.glow) {
    ctx.strokeStyle = o.glow;
    ctx.lineWidth = 3;
    ctx.globalAlpha *= 0.5;
    ctx.stroke();
  }
  ctx.restore();
  // fecho nos ombros
  if (def.style === "hero" || def.style === "royal" || def.style === "gold" || def.style === "emerald" || def.style === "dark") {
    ctx.fillStyle = def.style === "dark" ? "#6a6e78" : def.trim;
    for (const p of [L[0]!, R[0]!]) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Capa da habilidade Capa de Recuo (efeitos "Rascunho"). */
export const RECOIL_CAPE_DEF: CapeDef = {
  name: "Capa de Recuo",
  style: "hero",
  main: "#8e1f4c",
  inner: "#4e0f2a",
  trim: "#ff7ab0",
};

/** Capa de Recuo com efeitos novos: costuras de energia que acendem no dash. */
export const RECOIL_CAPE2_DEF: CapeDef = {
  name: "Capa de Recuo",
  style: "recoil",
  main: "#7a1a44",
  inner: "#3a0a20",
  trim: "#ff7ab0",
};

/** Capa de Recuo "das trevas" (quem veste a capa Sombria): preta com costuras rubras. */
export const RECOIL_DARK_DEF: CapeDef = {
  name: "Capa de Recuo das Trevas",
  style: "recoilDark",
  main: "#121016",
  inner: "#4a0c16",
  trim: "#ff3050",
};

/* ═══════════════════════ desenho novo (tecido) ═══════════════════════ */

const rgbCache = new Map<string, [number, number, number]>();
function rgbOf(hex: string): [number, number, number] {
  let c = rgbCache.get(hex);
  if (!c) {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
    const n = parseInt(full, 16) || 0;
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}

/** k > 0 clareia (rumo ao branco), k < 0 escurece. */
function tone(hex: string, k: number): string {
  const c = rgbOf(hex);
  if (k >= 0) {
    return `rgb(${(c[0] + (255 - c[0]) * k) | 0},${(c[1] + (255 - c[1]) * k) | 0},${(c[2] + (255 - c[2]) * k) | 0})`;
  }
  const m = 1 + k;
  return `rgb(${(c[0] * m) | 0},${(c[1] * m) | 0},${(c[2] * m) | 0})`;
}

const LX = new Float32Array(N);
const LY = new Float32Array(N);
const RX = new Float32Array(N);
const RY = new Float32Array(N);
const HX = new Float32Array(9);
const HY = new Float32Array(9);

/** Ponto na coluna `u` (0 = borda esquerda, 1 = direita) da fileira `r` (pode ser fracionária). */
function col(r: number, u: number): [number, number] {
  const i = Math.max(0, Math.min(N - 1, r));
  const i0 = Math.floor(i);
  const i1 = Math.min(N - 1, i0 + 1);
  const f = i - i0;
  const lx = LX[i0]! + (LX[i1]! - LX[i0]!) * f;
  const ly = LY[i0]! + (LY[i1]! - LY[i0]!) * f;
  const rx = RX[i0]! + (RX[i1]! - RX[i0]!) * f;
  const ry = RY[i0]! + (RY[i1]! - RY[i0]!) * f;
  return [lx + (rx - lx) * u, ly + (ry - ly) * u];
}

function drawCapeNew(ctx: CanvasRenderingContext2D, s: CapeSim, def: CapeDef, o: CapeDrawOpts) {
  const t = s.lastT;
  const style = def.style;
  const dark = style === "dark" || style === "recoilDark";
  const energy = style === "recoil" || style === "recoilDark";
  const tattered = style === "tattered";
  // bordas da fita (a capa alarga na barra)
  for (let i = 0; i < N; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(N - 1, i + 1);
    let tx = s.x[i1]! - s.x[i0]!;
    let ty = s.y[i1]! - s.y[i0]!;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const w = i / (N - 1);
    const half = (o.width / 2) * (1 + w * 0.75) * (1 + Math.sin(t * 0.01 + i) * 0.04 * w);
    LX[i] = s.x[i]! - ty * half;
    LY[i] = s.y[i]! + tx * half;
    RX[i] = s.x[i]! + ty * half;
    RY[i] = s.y[i]! - tx * half;
  }
  let hdx = s.x[N - 1]! - s.x[N - 2]!;
  let hdy = s.y[N - 1]! - s.y[N - 2]!;
  const hl = Math.hypot(hdx, hdy) || 1;
  hdx /= hl;
  hdy /= hl;
  // barra: curva suave, ou recortada (esfarrapada)
  const K = tattered ? 6 : 7;
  for (let j = 0; j <= K; j++) {
    const u = j / K;
    let x = LX[N - 1]! + (RX[N - 1]! - LX[N - 1]!) * u;
    let y = LY[N - 1]! + (RY[N - 1]! - LY[N - 1]!) * u;
    if (tattered) {
      const cut = j % 2 === 0 ? 0 : 7 + (j % 3) * 2;
      x -= hdx * cut;
      y -= hdy * cut;
    } else {
      const sag = 4 * u * (1 - u) * 3.2 * (dark ? 0.6 : 1);
      x += hdx * sag;
      y += hdy * sag;
    }
    HX[j] = x;
    HY[j] = y;
  }
  s.hem = [HX[0]!, HY[0]!, HX[K]!, HY[K]!, hdx, hdy];
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(LX[0]!, LY[0]!);
    for (let i = 1; i < N - 1; i++) ctx.lineTo(LX[i]!, LY[i]!);
    for (let j = 0; j <= K; j++) ctx.lineTo(HX[j]!, HY[j]!);
    for (let i = N - 2; i >= 0; i--) ctx.lineTo(RX[i]!, RY[i]!);
    ctx.closePath();
  };

  ctx.save();
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // sombra viva: fiapos de escuridão pendendo da barra (atrás do pano)
  if (dark) {
    const maxLen = 15;
    const tg = ctx.createLinearGradient(
      (HX[0]! + HX[K]!) / 2,
      (HY[0]! + HY[K]!) / 2,
      (HX[0]! + HX[K]!) / 2 + hdx * maxLen,
      (HY[0]! + HY[K]!) / 2 + hdy * maxLen,
    );
    tg.addColorStop(0, "rgba(14,10,20,0.92)");
    tg.addColorStop(0.55, "rgba(30,14,44,0.5)");
    tg.addColorStop(1, "rgba(40,10,50,0)");
    ctx.fillStyle = tg;
    ctx.beginPath();
    for (let j = 0; j < K; j++) {
      const um = (j + 0.5) / K;
      const mx = (HX[j]! + HX[j + 1]!) / 2;
      const my = (HY[j]! + HY[j + 1]!) / 2;
      const len = (8 + 5 * Math.sin(t * 0.006 + j * 1.9 + s.seed)) * (0.7 + 0.6 * Math.sin(um * Math.PI));
      const sway = Math.sin(t * 0.004 + j * 2.3 + s.seed) * 3;
      const tipX = mx + hdx * len - hdy * sway;
      const tipY = my + hdy * len + hdx * sway;
      ctx.moveTo(HX[j]!, HY[j]!);
      ctx.quadraticCurveTo(mx + hdx * len * 0.35 - hdy * 2, my + hdy * len * 0.35 + hdx * 2, tipX, tipY);
      ctx.quadraticCurveTo(mx + hdx * len * 0.35 + hdy * 2, my + hdy * len * 0.35 - hdx * 2, HX[j + 1]!, HY[j + 1]!);
      ctx.closePath();
    }
    ctx.fill();
  }

  // base
  outline();
  if (style === "rainbow") {
    ctx.save();
    ctx.clip();
    for (let i = 0; i < N - 1; i++) {
      const ext = i === N - 2 ? 12 : 0;
      ctx.fillStyle = RAINBOW[i % RAINBOW.length]!;
      ctx.beginPath();
      ctx.moveTo(LX[i]!, LY[i]!);
      ctx.lineTo(LX[i + 1]! + hdx * ext, LY[i + 1]! + hdy * ext);
      ctx.lineTo(RX[i + 1]! + hdx * ext, RY[i + 1]! + hdy * ext);
      ctx.lineTo(RX[i]!, RY[i]!);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  } else {
    ctx.fillStyle = def.main;
    ctx.fill();
  }

  // dobras: faixas claras/escuras que convergem nos ombros e ondulam com o vento
  const phase = t * 0.0032 + s.seed + (s.x[N - 1]! - s.x[0]!) * 0.05;
  const lightA = dark ? 0.1 : 0.1;
  const darkA = dark ? 0.42 : 0.22;
  for (let j = 0; j < K; j++) {
    const u0 = j / K;
    const u1 = (j + 1) / K;
    const um = (u0 + u1) / 2;
    const v = Math.sin(um * Math.PI * 3.1 + phase) * 0.9 + (0.5 - um) * 0.8;
    if (Math.abs(v) < 0.05) continue;
    ctx.fillStyle =
      v > 0
        ? dark
          ? `rgba(150,118,220,${Math.min(0.3, v * lightA)})`
          : `rgba(255,255,255,${Math.min(0.3, v * lightA)})`
        : `rgba(0,0,0,${Math.min(0.5, -v * darkA)})`;
    ctx.beginPath();
    let p = col(0, u0);
    ctx.moveTo(p[0], p[1]);
    for (let i = 1; i < N - 1; i++) {
      p = col(i, u0);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.lineTo(HX[j]!, HY[j]!);
    ctx.lineTo(HX[j + 1]!, HY[j + 1]!);
    for (let i = N - 2; i >= 0; i--) {
      p = col(i, u1);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    ctx.fill();
  }

  // volume ao longo do comprimento (luz nos ombros, sombra na barra)
  {
    const cx0 = (LX[0]! + RX[0]!) / 2;
    const cy0 = (LY[0]! + RY[0]!) / 2;
    const cx1 = (HX[0]! + HX[K]!) / 2;
    const cy1 = (HY[0]! + HY[K]!) / 2;
    const lg = ctx.createLinearGradient(cx0, cy0, cx1, cy1);
    lg.addColorStop(0, dark ? "rgba(160,130,220,0.08)" : "rgba(255,255,255,0.12)");
    lg.addColorStop(0.5, "rgba(0,0,0,0)");
    lg.addColorStop(1, dark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.26)");
    ctx.fillStyle = lg;
    outline();
    ctx.fill();
  }

  // brilho de seda correndo na diagonal
  if (style !== "tattered") {
    ctx.save();
    outline();
    ctx.clip();
    const v = ((t * 0.00032 + s.seed * 0.37) % 1.7) - 0.35;
    const r = v * (N - 1);
    const a = col(r - 1, -0.1);
    const b = col(r + 1, 1.1);
    ctx.strokeStyle =
      style === "gold"
        ? "rgba(255,250,215,0.3)"
        : dark
          ? "rgba(180,150,255,0.16)"
          : style === "rainbow"
            ? "rgba(255,255,255,0.22)"
            : "rgba(255,255,255,0.14)";
    ctx.lineWidth = Math.max(3, o.width * 0.38);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.restore();
  }

  // barra bordada
  const band = () => {
    ctx.beginPath();
    for (let j = 0; j <= K; j++) {
      const top = col(N - 2 + 0.62, j / K);
      if (j === 0) ctx.moveTo(top[0], top[1]);
      else ctx.lineTo(top[0], top[1]);
    }
    for (let j = K; j >= 0; j--) ctx.lineTo(HX[j]!, HY[j]!);
    ctx.closePath();
  };
  if (style === "hero" || style === "royal" || style === "gold" || style === "emerald" || style === "rainbow" || energy) {
    const fill =
      style === "royal" ? "#f4f1ea" : style === "emerald" ? "#e2c25a" : style === "rainbow" ? "#ffffff" : def.trim;
    band();
    ctx.fillStyle = energy ? tone(def.trim, -0.35) : fill;
    ctx.fill();
    // linha de costura em cima da barra
    ctx.strokeStyle = style === "royal" ? "rgba(120,110,100,0.7)" : "rgba(60,40,20,0.45)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let j = 0; j <= K; j++) {
      const top = col(N - 2 + 0.62, j / K);
      if (j === 0) ctx.moveTo(top[0], top[1]);
      else ctx.lineTo(top[0], top[1]);
    }
    ctx.stroke();
    // arminho (Real) / pedras (Dourada, Esmeralda)
    if (style === "royal" || style === "gold" || style === "emerald") {
      for (let j = 0; j < K; j++) {
        const um = (j + 0.5) / K;
        const top = col(N - 2 + 0.62, um);
        const bx = (top[0] + (HX[j]! + HX[j + 1]!) / 2) / 2;
        const by = (top[1] + (HY[j]! + HY[j + 1]!) / 2) / 2;
        if (style === "royal") {
          ctx.fillStyle = "#1a1714";
          ctx.beginPath();
          ctx.ellipse(bx, by, 0.9, 1.5, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = style === "gold" ? def.inner : "#1fbf6a";
          ctx.beginPath();
          ctx.arc(bx, by, 1.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillRect(bx - 0.6, by - 0.8, 0.7, 0.7);
        }
      }
    }
  }

  // costuras de energia (Capa de Recuo) — acendem no dash
  if (energy) {
    const pulse = 0.55 + 0.45 * Math.sin(t * 0.008 + s.seed);
    const boost = o.glow ? 1 : 0;
    const seam = style === "recoilDark" ? "255,44,70" : "255,110,190";
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const u of [0.3, 0.7]) {
      for (const [w, a] of [
        [3.2, 0.18 + 0.2 * boost],
        [1.1, 0.5 + 0.35 * pulse + 0.3 * boost],
      ] as const) {
        ctx.strokeStyle = `rgba(${seam},${Math.min(1, a)})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        for (let i = 1; i < N; i++) {
          const p = i === N - 1 ? col(N - 2 + 0.62, u) : col(i, u);
          if (i === 1) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
        }
        ctx.stroke();
      }
    }
    band();
    ctx.fillStyle = `rgba(${seam},${0.35 + 0.35 * pulse + 0.3 * boost})`;
    ctx.fill();
    ctx.restore();
  }

  // símbolo das trevas nas costas (Sombria) — brasa rubra que pulsa
  if (dark && o.width > 7) {
    const c = col(1.75, 0.5);
    const sz = Math.max(2.5, o.width * 0.2);
    const pulse = 0.6 + 0.4 * Math.sin(t * 0.005 + s.seed);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(255,40,60,${0.45 + 0.35 * pulse})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(c[0] - sz, c[1] - sz * 0.6);
    ctx.lineTo(c[0] + sz, c[1] - sz * 0.6);
    ctx.lineTo(c[0], c[1] + sz);
    ctx.closePath();
    ctx.moveTo(c[0], c[1] - sz * 1.3);
    ctx.lineTo(c[0], c[1] + sz * 1.5);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,60,80,${0.25 * pulse})`;
    ctx.beginPath();
    ctx.arc(c[0], c[1] - sz * 0.05, sz * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // forro aparecendo na borda de dentro + luz na borda de fora
  ctx.strokeStyle = dark ? "rgba(120,20,36,0.85)" : tone(def.inner || def.main, -0.1);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(RX[1]!, RY[1]!);
  for (let i = 2; i < N - 1; i++) ctx.lineTo(RX[i]!, RY[i]!);
  ctx.stroke();
  ctx.strokeStyle = dark ? "rgba(160,130,240,0.45)" : "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(LX[1]!, LY[1]!);
  for (let i = 2; i < N - 1; i++) ctx.lineTo(LX[i]!, LY[i]!);
  ctx.stroke();

  // contorno
  outline();
  ctx.strokeStyle = dark ? "rgba(8,6,12,0.9)" : "rgba(20,14,12,0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (o.glow) {
    ctx.strokeStyle = o.glow;
    ctx.lineWidth = 3;
    ctx.globalAlpha *= 0.5;
    ctx.stroke();
    ctx.globalAlpha /= 0.5;
  }

  // gola com o forro (dobrada nos ombros)
  {
    const mx = (LX[0]! + RX[0]!) / 2 - hdx * 1.5;
    const my = (LY[0]! + RY[0]!) / 2 - hdy * 1.5;
    ctx.strokeStyle = dark ? "#3a0a14" : tone(def.inner || def.main, -0.15);
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(LX[0]!, LY[0]!);
    ctx.quadraticCurveTo(mx, my, RX[0]!, RY[0]!);
    ctx.stroke();
    ctx.strokeStyle = dark ? "rgba(200,60,80,0.55)" : "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  // fecho nos ombros
  if (style !== "rainbow" && style !== "tattered") {
    ctx.fillStyle = dark ? "#8a8f9a" : style === "royal" ? "#e8e4d8" : def.trim;
    for (const [px, py] of [
      [LX[0]!, LY[0]!],
      [RX[0]!, RY[0]!],
    ] as const) {
      ctx.beginPath();
      ctx.arc(px, py, 2.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(20,14,12,0.7)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    if (dark) {
      // corrente fina entre os fechos
      ctx.strokeStyle = "rgba(150,155,170,0.8)";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(LX[0]!, LY[0]!);
      ctx.quadraticCurveTo((LX[0]! + RX[0]!) / 2, (LY[0]! + RY[0]!) / 2 + 3, RX[0]!, RY[0]!);
      ctx.stroke();
    }
  }
}
