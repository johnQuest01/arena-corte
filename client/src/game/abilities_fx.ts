/**
 * abilities_fx.ts — visual do Jato de Água (ilusão de fluido, 100% client).
 * Flags de degradação: refração → metaballs → partículas.
 */
import { abilityOf } from "../../../shared/abilities";
import type { TickEvent } from "../../../shared/protocol";
import type { FeelState } from "./render";

/** Desligar se FPS cair (ordem: refração → metaballs). */
export let WATER_METABALLS = true;
/** Off por padrão — o bbox retangular da refração lia como “quadrado azul”. */
export let WATER_REFRACTION = false;

export function setWaterVisualFlags(opts: { metaballs?: boolean; refraction?: boolean }) {
  if (opts.metaballs != null) WATER_METABALLS = opts.metaballs;
  if (opts.refraction != null) WATER_REFRACTION = opts.refraction;
}

type Depth = "back" | "mid" | "front";

export interface AbilityParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  baseR: number;
  color: string;
  alpha: number;
  depth: Depth;
  splash: boolean;
}

interface Shockwave {
  x: number;
  y: number;
  t: number;
  max: number;
}

interface WetPuddle {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
}

interface WetTint {
  x: number;
  y: number;
  life: number;
  max: number;
}

const parts: AbilityParticle[] = [];
const shocks: Shockwave[] = [];
const puddles: WetPuddle[] = [];
const tints: WetTint[] = [];
const MAX = 1600;

const COL = {
  back: "#2a6a9a",
  mid: "#4aa8e8",
  front: "#c8ecff",
};

let metaOff: HTMLCanvasElement | null = null;
let metaCtx: CanvasRenderingContext2D | null = null;
let fxTime = 0;

function pushPart(p: AbilityParticle) {
  parts.push(p);
  while (parts.length > MAX) parts.shift();
}

function ensureMeta(w: number, h: number) {
  if (!metaOff || metaOff.width !== w || metaOff.height !== h) {
    metaOff = document.createElement("canvas");
    metaOff.width = w;
    metaOff.height = h;
    metaCtx = metaOff.getContext("2d", { willReadFrequently: true });
  }
}

/** Jato em 3 profundidades + onda de choque. */
export function spawnWaterJetFx(x: number, y: number, angle: number) {
  const ox = x - Math.cos(angle) * 8;
  const oy = y - Math.sin(angle) * 8;

  const emit = (
    n: number,
    depth: Depth,
    r0: number,
    r1: number,
    spd0: number,
    spd1: number,
    alpha: number,
    color: string,
    spread = 1.15,
  ) => {
    for (let i = 0; i < n; i++) {
      const ang = angle + (Math.random() - 0.5) * spread;
      const spd = spd0 + Math.random() * (spd1 - spd0);
      const life = 550 + Math.random() * 650;
      const r = r0 + Math.random() * (r1 - r0);
      pushPart({
        x: ox + (Math.random() - 0.5) * 6,
        y: oy + (Math.random() - 0.5) * 6,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life,
        max: life,
        r,
        baseR: r,
        color,
        alpha,
        depth,
        splash: false,
      });
    }
  };

  // jato volumoso — 3 profundidades + nuvens (sem retângulo de refração)
  emit(80, "back", 7, 14, 130, 300, 0.62, COL.back, 1.35);
  emit(100, "mid", 3.5, 8, 210, 420, 0.82, COL.mid, 1.2);
  emit(90, "front", 1.5, 4, 300, 580, 0.9, COL.front, 1.1);
  emit(55, "mid", 2.5, 6, 160, 340, 0.6, COL.mid, 1.75);
  emit(40, "back", 5, 10, 100, 220, 0.45, COL.back, 1.9);

  shocks.push({ x, y, t: 420, max: 420 });
}

/** Splash no alvo + tint molhado. */
export function spawnWaterSplash(x: number, y: number) {
  for (let i = 0; i < 64; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 80 + Math.random() * 220;
    const life = 300 + Math.random() * 360;
    const r = 2 + Math.random() * 4.5;
    pushPart({
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 60,
      life,
      max: life,
      r,
      baseR: r,
      color: i % 3 === 0 ? COL.front : COL.mid,
      alpha: 0.85,
      depth: "front",
      splash: true,
    });
  }
  tints.push({ x, y, life: 1400, max: 1400 });
  puddles.push({
    x: x + (Math.random() - 0.5) * 10,
    y: y + (Math.random() - 0.5) * 8,
    r: 16 + Math.random() * 14,
    life: 3800,
    max: 3800,
  });
}

export function processAbilityEvents(
  events: TickEvent[],
  feel: FeelState,
  selfId: number,
  onWhoosh?: (x: number, y: number) => void,
  onSplash?: (x: number, y: number) => void,
) {
  for (const e of events) {
    if (e.kind !== "ability") continue;
    const abilityId = e.b;
    const angle = e.angle ?? 0;
    if (abilityId === 0) {
      spawnWaterJetFx(e.x, e.y, angle);
      if (e.a === selfId) {
        feel.bodyKick = Math.max(feel.bodyKick, 0.7);
        feel.shake = Math.max(feel.shake, 1.2);
      }
      onWhoosh?.(e.x, e.y);
      void onSplash;
    }
    // Gigante: FX/som só em giantSpawn (evita dobrar com ability + spawn)
    if (abilityId === 1) {
      if (e.a === selfId) {
        feel.bodyKick = Math.max(feel.bodyKick, 0.55);
        feel.shake = Math.max(feel.shake, 1.4);
      }
    }
    void abilityOf;
    void angle;
    void onWhoosh;
    void onSplash;
  }
}

/** Poeira/energia na invocação do Gigante. */
export function spawnGiantSummonFx(x: number, y: number) {
  for (let i = 0; i < 28; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 40 + Math.random() * 160;
    const life = 320 + Math.random() * 280;
    const r = 2 + Math.random() * 3;
    pushPart({
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 20,
      life,
      max: life,
      r,
      baseR: r,
      color: i % 2 === 0 ? "#5a4030" : "#c8a060",
      alpha: 0.85,
      depth: "front",
      splash: false,
    });
  }
}

export function spawnGiantHitFx(x: number, y: number) {
  for (let i = 0; i < 22; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 180 + Math.random() * 220;
    const life = 200 + Math.random() * 180;
    const r = 2 + Math.random() * 2.5;
    pushPart({
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life,
      max: life,
      r,
      baseR: r,
      color: "#e8c070",
      alpha: 0.9,
      depth: "front",
      splash: true,
    });
  }
}

export function spawnGiantExpireFx(x: number, y: number) {
  for (let i = 0; i < 16; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 20 + Math.random() * 70;
    const life = 400 + Math.random() * 300;
    const r = 2 + Math.random() * 2;
    pushPart({
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 30,
      life,
      max: life,
      r,
      baseR: r,
      color: "#3a3028",
      alpha: 0.7,
      depth: "mid",
      splash: false,
    });
  }
}

function depositWet(x: number, y: number, r: number) {
  puddles.push({
    x,
    y,
    r: Math.max(4, r * 1.4),
    life: 3000,
    max: 3000,
  });
  if (puddles.length > 180) puddles.shift();
}

export function tickAbilityFx(dtMs: number) {
  const dt = dtMs / 1000;
  fxTime += dtMs;
  const next: AbilityParticle[] = [];

  for (const p of parts) {
    p.life -= dtMs;
    if (p.life <= 0) {
      if (!p.splash) {
        depositWet(p.x, p.y, p.baseR);
        for (let i = 0; i < 2; i++) {
          const ang = Math.random() * Math.PI * 2;
          const life = 120 + Math.random() * 80;
          const r = p.r * 0.45;
          next.push({
            x: p.x,
            y: p.y,
            vx: Math.cos(ang) * 40,
            vy: Math.sin(ang) * 40 - 20,
            life,
            max: life,
            r,
            baseR: r,
            color: p.color,
            alpha: p.alpha * 0.7,
            depth: "front",
            splash: true,
          });
        }
      }
      continue;
    }
    p.vy += 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const age = 1 - p.life / p.max;
    p.r = p.baseR * Math.max(0.25, 1 - age * 0.85);
    next.push(p);
  }
  parts.length = 0;
  parts.push(...next);
  while (parts.length > MAX) parts.shift();

  for (let i = shocks.length - 1; i >= 0; i--) {
    shocks[i]!.t -= dtMs;
    if (shocks[i]!.t <= 0) shocks.splice(i, 1);
  }
  for (let i = puddles.length - 1; i >= 0; i--) {
    puddles[i]!.life -= dtMs;
    if (puddles[i]!.life <= 0) puddles.splice(i, 1);
  }
  for (let i = tints.length - 1; i >= 0; i--) {
    tints[i]!.life -= dtMs;
    if (tints[i]!.life <= 0) tints.splice(i, 1);
  }
}

/** Camada de chão: onda de choque + poças (antes dos personagens). */
export function drawAbilityGround(ctx: CanvasRenderingContext2D) {
  for (const s of shocks) {
    const u = 1 - s.t / s.max;
    const radius = 280 * u;
    const a = 0.35 * (1 - u);
    ctx.strokeStyle = `rgba(180, 220, 255, ${a})`;
    ctx.lineWidth = Math.max(1, 6 * (1 - u));
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 6, radius, radius * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const p of puddles) {
    const a = 0.28 * (p.life / p.max);
    ctx.fillStyle = `rgba(30, 70, 110, ${a})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function particleBBox(): { x0: number; y0: number; x1: number; y1: number } | null {
  if (parts.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of parts) {
    const pad = p.r + 8;
    x0 = Math.min(x0, p.x - pad);
    y0 = Math.min(y0, p.y - pad);
    x1 = Math.max(x1, p.x + pad);
    y1 = Math.max(y1, p.y + pad);
  }
  return { x0, y0, x1, y1 };
}

function drawSoftBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  a: number,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawMetaballs(
  ctx: CanvasRenderingContext2D,
  list: AbilityParticle[],
  fill: string,
) {
  const bb = particleBBox();
  if (!bb || list.length === 0) return;
  const pad = 12;
  const x0 = Math.floor(bb.x0 - pad);
  const y0 = Math.floor(bb.y0 - pad);
  const w = Math.max(8, Math.ceil(bb.x1 - bb.x0 + pad * 2));
  const h = Math.max(8, Math.ceil(bb.y1 - bb.y0 + pad * 2));
  // limita região (perf) — um pouco maior pra massa não “cortar” em quadro
  const cw = Math.min(420, w);
  const ch = Math.min(320, h);
  ensureMeta(cw, ch);
  if (!metaOff || !metaCtx) return;

  metaCtx.clearRect(0, 0, cw, ch);
  metaCtx.save();
  const sx = cw / w;
  const sy = ch / h;
  metaCtx.scale(sx, sy);
  metaCtx.translate(-x0, -y0);
  for (const p of list) {
    const age = p.life / p.max;
    drawSoftBlob(metaCtx, p.x, p.y, p.r * 1.55, p.alpha * age);
  }
  metaCtx.restore();

  // blur
  metaCtx.save();
  metaCtx.filter = "blur(5px)";
  metaCtx.drawImage(metaOff, 0, 0);
  metaCtx.filter = "none";
  metaCtx.restore();

  // threshold de alpha (~0.5) → massa sólida; borda suave (sem retângulo)
  try {
    const img = metaCtx.getImageData(0, 0, cw, ch);
    const d = img.data;
    const edge = 10;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4;
        const a = d[i + 3]!;
        // fade nas bordas do offscreen — mata o “quadrado”
        const ex = Math.min(x, cw - 1 - x);
        const ey = Math.min(y, ch - 1 - y);
        const edgeFade = Math.min(1, Math.min(ex, ey) / edge);
        if (a > 100) {
          d[i] = 74;
          d[i + 1] = 168;
          d[i + 2] = 232;
          d[i + 3] = Math.min(235, Math.floor(a * 1.2 * edgeFade));
        } else if (a > 45) {
          d[i] = 160;
          d[i + 1] = 210;
          d[i + 2] = 245;
          d[i + 3] = Math.floor(a * 0.95 * edgeFade);
        } else {
          d[i + 3] = 0;
        }
      }
    }
    metaCtx.putImageData(img, 0, 0);
  } catch {
    /* cross-origin / segurança — fallback colorize */
    metaCtx.globalCompositeOperation = "source-in";
    metaCtx.fillStyle = fill;
    metaCtx.fillRect(0, 0, cw, ch);
    metaCtx.globalCompositeOperation = "source-over";
  }

  ctx.drawImage(metaOff, 0, 0, cw, ch, x0, y0, w, h);
}

/** Brilhos locais nas gotas — NÃO desenha retângulo/bbox (era o “quadrado azul”). */
function drawWaterSparkles(ctx: CanvasRenderingContext2D) {
  if (parts.length === 0) return;
  ctx.save();
  const t = fxTime * 0.012;
  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.depth !== "front" && p.depth !== "mid") continue;
    if (i % 5 !== 0) continue;
    const age = p.life / p.max;
    if (age < 0.15 || age > 0.85) continue;
    ctx.globalAlpha = 0.14 * age;
    ctx.fillStyle = "#e8f6ff";
    const ox = Math.sin(t + p.x * 0.05) * 2;
    ctx.beginPath();
    ctx.ellipse(p.x + ox, p.y, Math.max(2, p.r * 0.9), Math.max(1, p.r * 0.35), 0, 0, Math.PI * 2);
    ctx.fill();
    n++;
    if (n > 28) break;
  }
  ctx.restore();
}

function drawDots(ctx: CanvasRenderingContext2D, list: AbilityParticle[]) {
  for (const p of list) {
    const age = p.life / p.max;
    ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha * age));
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.r), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Massa de água + refração + spray (depois dos personagens).
 * Ordem: refração → metaball/mid → spray frente → tint.
 */
export function drawAbilityWater(ctx: CanvasRenderingContext2D) {
  const back = parts.filter((p) => p.depth === "back");
  const mid = parts.filter((p) => p.depth === "mid");
  const front = parts.filter((p) => p.depth === "front");

  if (WATER_METABALLS) {
    drawDots(ctx, back);
    drawMetaballs(ctx, [...back, ...mid], COL.mid);
    drawDots(ctx, front);
  } else {
    drawDots(ctx, back);
    drawDots(ctx, mid);
    drawDots(ctx, front);
  }

  // brilho nas gotas (sem o retângulo azul antigo da refração)
  drawWaterSparkles(ctx);

  for (const t of tints) {
    const a = 0.22 * (t.life / t.max);
    ctx.fillStyle = `rgba(90, 170, 230, ${a})`;
    ctx.beginPath();
    ctx.ellipse(t.x, t.y - 8, 22, 28, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** @deprecated use drawAbilityGround + drawAbilityWater */
export function drawAbilityFx(ctx: CanvasRenderingContext2D) {
  drawAbilityGround(ctx);
  drawAbilityWater(ctx);
}

export function clearAbilityFx() {
  parts.length = 0;
  shocks.length = 0;
  puddles.length = 0;
  tints.length = 0;
}
