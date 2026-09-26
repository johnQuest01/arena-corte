/**
 * powers_fx.ts — visual dos poderes novos (client-side, barato):
 * Raio em Cadeia (zigue-zague com brilho), Passo Sombrio (fumaça + rastro)
 * e Escudo Bumerangue (disco girando com rastro).
 */
import type { ThrowableState } from "../../../shared/protocol";
import { BODY_K } from "./character";
import { drawStarShield } from "./shield";

interface Bolt {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
  max: number;
  seed: number;
  pts: number[];
  rebuildAt: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  max: number;
}

interface Streak {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
  max: number;
}

const bolts: Bolt[] = [];
const puffs: Puff[] = [];
const streaks: Streak[] = [];
let clock = 0;

function jag(b: Bolt) {
  const dx = b.x2 - b.x1;
  const dy = b.y2 - b.y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const n = Math.max(4, Math.min(14, Math.round(len / 22)));
  const pts: number[] = [b.x1, b.y1];
  for (let i = 1; i < n; i++) {
    const u = i / n;
    const amp = Math.sin(u * Math.PI) * Math.min(16, len * 0.09);
    const off = (Math.random() * 2 - 1) * amp;
    pts.push(b.x1 + dx * u + nx * off, b.y1 + dy * u + ny * off);
  }
  pts.push(b.x2, b.y2);
  b.pts = pts;
}

export function spawnLightningBolt(x1: number, y1: number, x2: number, y2: number, hop = 0) {
  const b: Bolt = { x1, y1, x2, y2, t: 280 + hop * 30, max: 280 + hop * 30, seed: Math.random(), pts: [], rebuildAt: 0 };
  jag(b);
  bolts.push(b);
  while (bolts.length > 24) bolts.shift();
  // faíscas no impacto
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 160;
    puffs.push({ x: x2, y: y2, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 1.6, life: 180, max: 180 });
  }
}

export function spawnBlinkFx(fromX: number, fromY: number, toX: number, toY: number) {
  streaks.push({ x1: fromX, y1: fromY - 34 * BODY_K, x2: toX, y2: toY - 34 * BODY_K, t: 320, max: 320 });
  for (const [x, y, n] of [
    [fromX, fromY, 14],
    [toX, toY, 10],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 20 + Math.random() * 70;
      puffs.push({
        x: x + Math.cos(a) * 8 * BODY_K,
        y: y + (-30 + Math.sin(a) * 18) * BODY_K,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.6 - 25,
        r: (7 + Math.random() * 9) * BODY_K,
        life: 420 + Math.random() * 240,
        max: 660,
      });
    }
  }
  while (puffs.length > 220) puffs.shift();
}

/** Brilho na mão ao conjurar (predição local). */
export function spawnCastSparkle(x: number, y: number, color = "#9fd8ff") {
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 40 + Math.random() * 90;
    puffs.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, r: 1.4 + Math.random(), life: 220, max: 220 });
  }
  void color;
}

export function tickPowersFx(dtMs: number) {
  clock += dtMs;
  const dt = dtMs / 1000;
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i]!;
    b.t -= dtMs;
    if (b.t <= 0) {
      bolts.splice(i, 1);
      continue;
    }
    if (clock >= b.rebuildAt) {
      jag(b);
      b.rebuildAt = clock + 45;
    }
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i]!;
    p.life -= dtMs;
    if (p.life <= 0) {
      puffs.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
  }
  for (let i = streaks.length - 1; i >= 0; i--) {
    streaks[i]!.t -= dtMs;
    if (streaks[i]!.t <= 0) streaks.splice(i, 1);
  }
}

export function clearPowersFx() {
  bolts.length = 0;
  puffs.length = 0;
  streaks.length = 0;
}

function strokePts(ctx: CanvasRenderingContext2D, pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.stroke();
}

/** Camada "ar" — por cima dos personagens. */
export function drawPowersFx(ctx: CanvasRenderingContext2D) {
  if (!bolts.length && !puffs.length && !streaks.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of streaks) {
    const a = s.t / s.max;
    ctx.strokeStyle = `rgba(120,70,190,${0.35 * a})`;
    ctx.lineWidth = 18 * a;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(230,210,255,${0.5 * a})`;
    ctx.lineWidth = 3 * a;
    ctx.stroke();
  }
  for (const p of puffs) {
    const a = p.life / p.max;
    if (p.r > 3) {
      ctx.fillStyle = `rgba(52,30,78,${0.42 * a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.6 - a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = `rgba(200,235,255,${a})`;
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
  }
  for (const b of bolts) {
    const a = Math.min(1, b.t / (b.max * 0.6));
    ctx.strokeStyle = `rgba(90,150,255,${0.28 * a})`;
    ctx.lineWidth = 10;
    strokePts(ctx, b.pts);
    ctx.strokeStyle = `rgba(150,200,255,${0.6 * a})`;
    ctx.lineWidth = 4;
    strokePts(ctx, b.pts);
    ctx.strokeStyle = `rgba(245,250,255,${a})`;
    ctx.lineWidth = 1.6;
    strokePts(ctx, b.pts);
    // clarão no impacto
    ctx.fillStyle = `rgba(200,230,255,${0.45 * a})`;
    ctx.beginPath();
    ctx.arc(b.x2, b.y2, 10 + (1 - a) * 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Altura visual do disco em voo (px acima do chão). */
const SHIELD_FLY_Y = -26 * BODY_K;
/** Raio visual do disco em voo. */
const SHIELD_FLY_R = 17 * BODY_K;

/** Escudo Bumerangue em voo (throwable kind 7). fuse: 1 voltando, 2 voltando por dentro de parede. */
export function drawThrownShield(ctx: CanvasRenderingContext2D, t: ThrowableState, tMs: number) {
  const sp = Math.hypot(t.vx, t.vy) || 1;
  const ux = t.vx / sp;
  const uy = t.vy / sp;
  const y = t.y + SHIELD_FLY_Y;
  const ghost = t.fuse >= 2;
  ctx.save();
  // atravessando parede na volta: translúcido (não fere ninguém)
  if (ghost) ctx.globalAlpha *= 0.4;
  // sombra no chão (posição lógica)
  ctx.fillStyle = "rgba(10,10,14,0.3)";
  ctx.beginPath();
  ctx.ellipse(t.x + 3, t.y + 4, 16 * BODY_K, 5.5 * BODY_K, 0, 0, Math.PI * 2);
  ctx.fill();
  // rastro
  for (let i = 3; i >= 1; i--) {
    ctx.save();
    ctx.globalAlpha *= 0.12 * (4 - i);
    drawStarShield(ctx, t.x - ux * i * 11 * BODY_K, y - uy * i * 11 * BODY_K, SHIELD_FLY_R, { squash: 0.62, spin: tMs * 0.03 - i * 0.4, t: tMs });
    ctx.restore();
  }
  drawStarShield(ctx, t.x, y, SHIELD_FLY_R, {
    squash: 0.62,
    spin: tMs * 0.03,
    glow: ghost ? 0 : t.fuse > 0 ? 0.35 : 0.6,
    t: tMs,
  });
  ctx.restore();
}
