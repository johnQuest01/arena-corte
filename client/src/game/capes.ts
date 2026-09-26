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

/** Capa da habilidade Capa de Recuo (visual novo). */
export const RECOIL_CAPE_DEF: CapeDef = {
  name: "Capa de Recuo",
  style: "hero",
  main: "#8e1f4c",
  inner: "#4e0f2a",
  trim: "#ff7ab0",
};
