/**
 * giant2.ts — Gigante "Novo": golem de pedra com veias de magma.
 * Mesmos estados do antigo (perseguindo, preparando o golpe, investida,
 * atordoado, congelado) e o mesmo tamanho no chão; só muda a aparência.
 */
import { glowSprite, hotSprite, TAU, twinkleSprite } from "./fx2_core";

export interface GiantPose2 {
  /** escala visual (ENEMY_DEFS[2].visualScale) */
  s: number;
  id: number;
  tMs: number;
  chase: boolean;
  windup: boolean;
  charge: boolean;
  stun: boolean;
  frozen: boolean;
  windupFlash: number;
  skew: number;
  facing: number;
  /** 0..1 — quão perto do jogador local (pulso da aura) */
  near: number;
}

const OUT = "#211d1a";
const MID = "#6b645b";
const LIGHT = "#8d857a";
const DARK = "#443e38";
const MOSS = "#667f41";

function limb(ctx: CanvasRenderingContext2D, pts: number[], w: number, k: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  };
  ctx.strokeStyle = OUT;
  ctx.lineWidth = w + 2.2 * k;
  path();
  ctx.stroke();
  ctx.strokeStyle = MID;
  ctx.lineWidth = w;
  path();
  ctx.stroke();
  ctx.save();
  ctx.translate(-w * 0.22, -w * 0.08);
  ctx.strokeStyle = LIGHT;
  ctx.lineWidth = w * 0.3;
  path();
  ctx.stroke();
  ctx.restore();
}

/** Pedra arredondada: sombra, corpo e luz em tons sólidos (sem gradiente). */
function boulder(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.fillStyle = DARK;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = MID;
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.1, y - ry * 0.12, rx * 0.86, ry * 0.84, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = LIGHT;
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.32, y - ry * 0.4, rx * 0.4, ry * 0.3, -0.3, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.stroke();
}

function magma(ctx: CanvasRenderingContext2D, lines: number[][], k: number, glow: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1a120d";
  ctx.lineWidth = 2.6 * k;
  for (const l of lines) {
    ctx.beginPath();
    ctx.moveTo(l[0]! * k, l[1]! * k);
    for (let i = 2; i < l.length; i += 2) ctx.lineTo(l[i]! * k, l[i + 1]! * k);
    ctx.stroke();
  }
  if (glow <= 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const [w, col, a] of [
    [4.4, "255,108,34", 0.35],
    [1.5, "255,214,140", 0.95],
  ] as const) {
    ctx.strokeStyle = `rgba(${col},${a * glow})`;
    ctx.lineWidth = w * k;
    for (const l of lines) {
      ctx.beginPath();
      ctx.moveTo(l[0]! * k, l[1]! * k);
      for (let i = 2; i < l.length; i += 2) ctx.lineTo(l[i]! * k, l[i + 1]! * k);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const TORSO = [-21, -17, -13, -26, 0, -29, 14, -26, 22, -16, 20, -3, 13, 7, 0, 10, -13, 7, -20, -4];
const CHEST_CRACKS = [
  [0, -22, -2, -15, 2, -9, -1, -2, 1, 5],
  [-2, -15, -9, -12, -14, -6],
  [2, -9, 9, -7, 14, -12],
];

/** Desenha na origem atual (pés do Gigante). */
export function drawGiant2(ctx: CanvasRenderingContext2D, p: GiantPose2) {
  const k = p.s * 0.9;
  const t = p.tMs;
  const flip = Math.cos(p.facing) < 0 ? -1 : 1;
  const still = p.frozen;
  const walk = still ? 0 : p.chase ? Math.sin(t * 0.01 + p.id) : p.charge ? Math.sin(t * 0.022 + p.id) : 0;
  const pulse = 0.5 + 0.5 * Math.sin(t * (0.006 + p.near * 0.02) + p.id);
  const glow = still
    ? 0.25
    : p.stun
      ? 0.18 + 0.14 * Math.abs(Math.sin(t * 0.03))
      : p.windup
        ? 0.95 + 0.05 * pulse
        : p.chase
          ? 0.62 + 0.25 * pulse
          : 0.5;

  // sombra
  ctx.fillStyle = "rgba(6,4,8,0.5)";
  ctx.beginPath();
  ctx.ellipse(Math.cos(p.facing) * 4 * k, 22 * k, 27 * k, 9 * k, 0, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.transform(1, 0, p.skew, 1, 0, 0);

  // aura no chão (perseguição) / telegrafia do golpe
  if (!still && (p.chase || p.windup)) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const col = p.windup ? "255,54,30" : "255,120,40";
    ctx.globalAlpha = p.windup ? 0.55 + 0.35 * p.windupFlash : 0.14 + 0.2 * p.near * pulse;
    ctx.drawImage(glowSprite(col), -40 * k, 6 * k, 80 * k, 30 * k);
    if (p.windup) {
      const r = 34 * k * (1 + 0.06 * Math.sin(t * 0.05));
      ctx.strokeStyle = `rgba(255,70,40,${0.55 + 0.4 * p.windupFlash})`;
      ctx.lineWidth = 2.5 + p.windupFlash * 2;
      ctx.beginPath();
      ctx.ellipse(0, 20 * k, r, r * 0.36, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([6, 8]);
      ctx.lineDashOffset = -t * 0.08;
      ctx.beginPath();
      ctx.ellipse(0, 20 * k, r * 0.78, r * 0.28, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  ctx.scale(flip, 1);
  const lean = still ? 0 : p.charge ? 0.14 : p.chase ? 0.05 : 0;
  if (lean) {
    ctx.translate(0, 12 * k);
    ctx.rotate(lean);
    ctx.translate(0, -12 * k);
  }
  const breath = still ? 1 : 1 + Math.sin(t * 0.004 + p.id) * 0.02;

  // pedrinhas orbitando (energia do golem)
  const orbit = !still && (p.chase || p.windup);
  const pebble = (i: number, front: boolean) => {
    const a = t * (p.windup ? 0.006 : 0.0025) + i * (TAU / 3);
    const s = Math.sin(a);
    if (s >= 0 !== front) return;
    const px = Math.cos(a) * 27 * k;
    const py = -16 * k + s * 7 * k - (p.windup ? 8 * k : 0) + Math.sin(t * 0.004 + i) * 2 * k;
    ctx.fillStyle = DARK;
    ctx.beginPath();
    ctx.ellipse(px, py, 2.6 * k, 2 * k, a, 0, TAU);
    ctx.fill();
    ctx.fillStyle = LIGHT;
    ctx.beginPath();
    ctx.ellipse(px - 0.6 * k, py - 0.6 * k, 1.2 * k, 0.9 * k, a, 0, TAU);
    ctx.fill();
  };
  if (orbit) for (let i = 0; i < 3; i++) pebble(i, false);

  // braço de trás (pendurado, balança oposto ao passo)
  const swing = -walk * 3 * k;
  limb(ctx, [-18 * k, -18 * k, -24 * k, -4 * k, -22 * k, 8 * k + swing], 7.5 * k, k);
  boulder(ctx, -22 * k, 11 * k + swing, 6.6 * k, 6 * k);

  // pernas (pilares)
  for (const side of [-1, 1]) {
    const hx = side * 8 * k;
    const fx = hx + side * walk * 6 * k;
    limb(ctx, [hx, 2 * k, (hx + fx) / 2 + 2 * k, 11 * k, fx, 18 * k], 9 * k, k);
    boulder(ctx, fx + 1 * k, 20 * k, 7 * k, 3.4 * k);
  }

  // tronco (rocha facetada)
  ctx.save();
  ctx.scale(1, breath);
  ctx.beginPath();
  ctx.moveTo(TORSO[0]! * k, TORSO[1]! * k);
  for (let i = 2; i < TORSO.length; i += 2) ctx.lineTo(TORSO[i]! * k, TORSO[i + 1]! * k);
  ctx.closePath();
  const tg = ctx.createLinearGradient(-20 * k, -28 * k, 18 * k, 10 * k);
  tg.addColorStop(0, "#90887c");
  tg.addColorStop(0.5, "#655e55");
  tg.addColorStop(1, "#3c3732");
  ctx.fillStyle = tg;
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.stroke();
  // facetas
  ctx.strokeStyle = "rgba(40,35,30,0.8)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-13 * k, -26 * k);
  ctx.lineTo(-6 * k, -13 * k);
  ctx.lineTo(-20 * k, -4 * k);
  ctx.moveTo(14 * k, -26 * k);
  ctx.lineTo(6 * k, -13 * k);
  ctx.lineTo(20 * k, -3 * k);
  ctx.moveTo(-6 * k, -13 * k);
  ctx.lineTo(6 * k, -13 * k);
  ctx.moveTo(-13 * k, 7 * k);
  ctx.lineTo(-5 * k, 0);
  ctx.lineTo(5 * k, 0);
  ctx.lineTo(13 * k, 7 * k);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(-13 * k, -26 * k);
  ctx.lineTo(0, -29 * k);
  ctx.lineTo(-6 * k, -13 * k);
  ctx.closePath();
  ctx.fill();
  // musgo
  ctx.fillStyle = MOSS;
  for (const [mx, my, mr] of [
    [-14, -23, 3.2],
    [9, -26, 2.6],
    [17, -13, 2.2],
    [-17, -2, 2],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(mx * k, my * k, mr * k, mr * 0.6 * k, 0.3, 0, TAU);
    ctx.fill();
  }
  // núcleo
  if (glow > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.min(1, glow * (0.75 + 0.25 * pulse));
    const cs = 15 * k * (0.9 + 0.2 * pulse);
    ctx.drawImage(hotSprite(p.windup ? "255,70,40" : "255,130,50"), -cs / 2, -12 * k - cs / 2, cs, cs);
    ctx.restore();
  }
  ctx.restore();

  // cabeça afundada entre os ombros (pedra arredondada, sobrancelha pesada)
  const hx = 1.5 * k;
  ctx.beginPath();
  const H = [-8, -23.5, 8, -23.5, 10, -28.5, 6.5, -34, 0, -35.5, -6.5, -34, -10, -28.5];
  ctx.moveTo(hx + H[0]! * k, H[1]! * k);
  for (let i = 2; i < H.length; i += 2) ctx.lineTo(hx + H[i]! * k, H[i + 1]! * k);
  ctx.closePath();
  ctx.fillStyle = "#6c655b";
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = "#8a8276";
  ctx.beginPath();
  ctx.ellipse(hx - 2 * k, -32.5 * k, 5.5 * k, 2.2 * k, 0, 0, TAU);
  ctx.fill();
  // sobrancelha
  ctx.fillStyle = "#3b352f";
  ctx.beginPath();
  ctx.moveTo(hx - 9.2 * k, -29.8 * k);
  ctx.lineTo(hx + 9.2 * k, -29.8 * k);
  ctx.lineTo(hx + 7.5 * k, -32 * k);
  ctx.lineTo(hx - 7.5 * k, -32 * k);
  ctx.closePath();
  ctx.fill();
  // boca de magma

  // olhos
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const eyeCol = p.windup ? "255,70,40" : p.stun ? "255,200,120" : "255,150,50";
  const es = (p.windup ? 8 : 6) * k * (still ? 0.7 : 1);
  ctx.globalAlpha = still ? 0.45 : p.stun ? 0.5 : 1;
  for (const ex of [-3.6, 3.6]) ctx.drawImage(hotSprite(eyeCol), hx + ex * k - es / 2, -28.4 * k - es / 2, es, es);
  ctx.restore();

  // ombros (cobrem as laterais da cabeça)
  boulder(ctx, -18 * k, -21 * k, 8.6 * k, 7.4 * k);
  boulder(ctx, 18 * k, -21 * k, 8.6 * k, 7.4 * k);
  ctx.fillStyle = MOSS;
  ctx.beginPath();
  ctx.ellipse(-19 * k, -26.8 * k, 4 * k, 1.6 * k, 0, 0, TAU);
  ctx.fill();
  // magma do tronco, ombro e boca num passe só
  magma(
    ctx,
    [
      ...CHEST_CRACKS,
      [15, -25, 18, -21.5, 21, -22.5],
      [hx / k - 3.5, -25.6, hx / k - 1, -25, hx / k + 1.5, -25.7, hx / k + 3.8, -25.1],
    ],
    k,
    glow,
  );

  // braço da frente: erguido no golpe, pendurado andando
  if (p.windup && !still) {
    const up = p.windupFlash * 6 * k;
    limb(ctx, [18 * k, -19 * k, 27 * k, -27 * k - up * 0.5, 25 * k, -38 * k - up], 7.5 * k, k);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.6 + 0.4 * p.windupFlash;
    const gs = 26 * k;
    ctx.drawImage(hotSprite("255,80,40"), 25 * k - gs / 2, -40 * k - up - gs / 2, gs, gs);
    ctx.restore();
    boulder(ctx, 25 * k, -40 * k - up, 7.2 * k, 6.6 * k);
  } else {
    limb(ctx, [18 * k, -18 * k, 24 * k, -4 * k, 23 * k, 8 * k - swing], 7.5 * k, k);
    boulder(ctx, 23 * k, 11 * k - swing, 6.8 * k, 6.2 * k);
    ctx.strokeStyle = "rgba(30,26,22,0.7)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(19.5 * k, 10 * k - swing);
    ctx.lineTo(26 * k, 9.5 * k - swing);
    ctx.stroke();
  }

  if (orbit) for (let i = 0; i < 3; i++) pebble(i, true);

  // atordoado: estrelinhas girando
  if (p.stun && !still) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const tw = twinkleSprite("255,230,120");
    for (let i = 0; i < 3; i++) {
      const a = t * 0.006 + (i * TAU) / 3;
      const sx = Math.cos(a) * 11 * k;
      const sy = -42 * k + Math.sin(a) * 3 * k;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(tw, sx - 7 * k, sy - 7 * k, 14 * k, 14 * k);
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Topo visual (para a barra de vida). */
export const GIANT2_TOP = -38;
