/**
 * fx2.ts — visual "Novo" de todos os poderes. O antigo continua em
 * abilities_fx.ts / powers_fx.ts como "Rascunho" (look.fx = 1).
 *
 * Só aparência: mesmos eventos, mesmas áreas e durações — nada muda na
 * jogabilidade. Tudo sai do motor fx2_core (sprites em cache, "lighter").
 */
import {
  BOMB_FUSE_MS,
  BOMB_RADIUS,
  SHIELD_HALF_ARC,
  TOTEM_BODY_INNER_R,
  TOTEM_BODY_OUTER_R,
  TOTEM_C_HALF_OPEN,
  TOTEM_RADIUS,
} from "../../../shared/abilities";
import type { Look } from "../../../shared/cosmetics";
import type { SpikeTotemSnap, ThrowableState } from "../../../shared/protocol";
import { riftScarsForFx2, riftsForFx2, type RiftFx, type RiftScar } from "./abilities_fx";
import { BODY_K, drawBody } from "./character";
import {
  anim,
  clamp01,
  clearFx2Core,
  decal,
  drawFx2CoreAir,
  drawFx2CoreGround,
  easeOut,
  emit,
  EMBER,
  FLAKE,
  FX2_LITE,
  GLOW,
  glowSprite,
  hash01,
  puffSprite,
  HOT,
  hotSprite,
  makeCanvas,
  qty,
  ring,
  rnd,
  ROCK,
  SHARD,
  SMOKE,
  SPARK,
  DROP,
  TAU,
  tickFx2Core,
  TWINKLE,
  twinkleSprite,
  lerp,
} from "./fx2_core";
import type { FeelState } from "./render";
import { drawStarShield } from "./shield";

/* ═══════════════════════ paletas ═══════════════════════ */

const WATER_L = "205,238,255";
const WATER_M = "92,178,240";
const WATER_D = "38,116,196";
const ICE_L = "228,247,255";
const ICE_M = "160,220,250";
const ICE_D = "92,166,226";
const FIRE_W = "255,238,196";
const FIRE_Y = "255,192,84";
const FIRE_O = "255,122,42";
const EARTH = ["92,70,50", "118,92,66", "66,50,36", "140,112,80"];
const STONE = ["88,82,76", "110,103,94", "66,61,56"];
const EMERALD = "56,226,138";
const EMERALD_L = "176,255,214";
const VOLT = "120,160,255";
const VOLT_L = "214,228,255";
const SHADOW = "156,96,255";
const SHADOW_D = "58,26,104";
const PINK = "255,96,182";
const PINK_L = "255,204,236";
const STAR = "140,192,255";
const BOOST = "255,170,70";

function pick<T>(a: readonly T[]): T {
  return a[(Math.random() * a.length) | 0]!;
}

/* ═══════════════════════ sprites próprios ═══════════════════════ */

const own = new Map<string, HTMLCanvasElement>();
function spr(key: string, build: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = own.get(key);
  if (!c) {
    c = build();
    own.set(key, c);
  }
  return c;
}

/** Poça d'água (3 variantes). */
function wetSprite(v: number): HTMLCanvasElement {
  const vi = v % 3;
  return spr("wet" + vi, () => {
    const c = makeCanvas(96, 48);
    const g = c.getContext("2d")!;
    const seed = 11 + vi * 37;
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const cx = 48 + (hash01(seed, i) - 0.5) * 38;
      const cy = 24 + (hash01(seed, i + 5) - 0.5) * 12;
      const rx = 13 + hash01(seed, i + 9) * 15;
      g.moveTo(cx + rx, cy);
      g.ellipse(cx, cy, rx, rx * 0.46, 0, 0, TAU);
    }
    g.fillStyle = "rgba(22,58,96,0.46)";
    g.fill();
    g.globalCompositeOperation = "source-atop";
    const gr = g.createLinearGradient(0, 8, 0, 44);
    gr.addColorStop(0, "rgba(150,210,245,0.35)");
    gr.addColorStop(0.5, "rgba(40,100,160,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 96, 48);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "rgba(235,248,255,0.55)";
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.ellipse(34 + hash01(seed, i + 30) * 28, 18 + hash01(seed, i + 33) * 8, 4 + i, 1.2, -0.2, 0, TAU);
      g.fill();
    }
    return c;
  });
}

/** Rachaduras em estrela (pisão, impacto do Gigante). */
function crackSprite(v: number, rgb = "18,12,8"): HTMLCanvasElement {
  const vi = v % 3;
  return spr(`crack${vi}|${rgb}`, () => {
    const c = makeCanvas(160, 90);
    const g = c.getContext("2d")!;
    const seed = 71 + vi * 53;
    g.translate(80, 45);
    g.scale(1, 0.56);
    const cg = g.createRadialGradient(0, 0, 2, 0, 0, 30);
    cg.addColorStop(0, `rgba(${rgb},0.55)`);
    cg.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = cg;
    g.beginPath();
    g.arc(0, 0, 30, 0, TAU);
    g.fill();
    g.lineCap = "round";
    g.lineJoin = "round";
    const n = 7 + vi;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + (hash01(seed, k) - 0.5) * 0.6;
      const len = 36 + hash01(seed, k + 20) * 38;
      const pts: number[] = [0, 0];
      let x = 0;
      let y = 0;
      const steps = 5;
      for (let s = 1; s <= steps; s++) {
        const d = (len * s) / steps;
        const j = (hash01(seed, k * 10 + s) - 0.5) * 0.7;
        x = Math.cos(a + j) * d;
        y = Math.sin(a + j) * d;
        pts.push(x, y);
      }
      for (const [w, col] of [
        [3.4, `rgba(${rgb},0.9)`],
        [1.2, "rgba(150,120,90,0.35)"],
      ] as const) {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(pts[0]!, pts[1]! + (w < 2 ? 1.6 : 0));
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]! + (w < 2 ? 1.6 : 0));
        g.stroke();
      }
    }
    return c;
  });
}

/** Cratera chamuscada da Bomba (3 variantes). */
function scorchSprite(v: number): HTMLCanvasElement {
  const vi = v % 3;
  return spr("scorch" + vi, () => {
    const c = makeCanvas(320, 200);
    const g = c.getContext("2d")!;
    const seed = 13 + vi * 97;
    g.translate(160, 100);
    g.scale(1, 0.62);
    const burn = g.createRadialGradient(0, 0, 10, 0, 0, 150);
    burn.addColorStop(0, "rgba(12,8,6,0.9)");
    burn.addColorStop(0.35, "rgba(26,18,12,0.72)");
    burn.addColorStop(0.7, "rgba(44,30,18,0.32)");
    burn.addColorStop(1, "rgba(44,30,18,0)");
    g.fillStyle = burn;
    g.beginPath();
    g.arc(0, 0, 150, 0, TAU);
    g.fill();
    // raios de fuligem
    g.fillStyle = "rgba(10,7,5,0.34)";
    for (let i = 0; i < 26; i++) {
      const a = hash01(seed, i) * TAU;
      const w = 0.04 + hash01(seed, i + 40) * 0.09;
      const len = 80 + hash01(seed, i + 80) * 70;
      g.beginPath();
      g.moveTo(Math.cos(a - w) * 30, Math.sin(a - w) * 30);
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      g.lineTo(Math.cos(a + w) * 30, Math.sin(a + w) * 30);
      g.closePath();
      g.fill();
    }
    // cratera
    const cr = g.createRadialGradient(0, 4, 4, 0, 0, 50);
    cr.addColorStop(0, "rgba(4,3,2,0.95)");
    cr.addColorStop(0.7, "rgba(20,14,10,0.85)");
    cr.addColorStop(1, "rgba(40,28,18,0)");
    g.fillStyle = cr;
    g.beginPath();
    g.arc(0, 0, 50, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(150,112,76,0.45)";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, 42, 0.15, Math.PI - 0.15);
    g.stroke();
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 40, Math.PI + 0.2, TAU - 0.2);
    g.stroke();
    // rachaduras
    g.strokeStyle = "rgba(8,6,4,0.8)";
    g.lineWidth = 2.4;
    g.lineCap = "round";
    for (let k = 0; k < 7; k++) {
      let a = hash01(seed, k + 200) * TAU;
      let r = 44;
      g.beginPath();
      g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      for (let s = 0; s < 4; s++) {
        a += (hash01(seed, k * 7 + s + 300) - 0.5) * 0.5;
        r += 12 + hash01(seed, k * 7 + s + 400) * 14;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.stroke();
    }
    return c;
  });
}

/** Círculo rúnico (Gigante, Passo Sombrio, mira do Totem). */
function runeSprite(rgb: string): HTMLCanvasElement {
  return spr("rune" + rgb, () => {
    const c = makeCanvas(160, 160);
    const g = c.getContext("2d")!;
    g.translate(80, 80);
    const pass = (w: number, a: number) => {
      g.strokeStyle = `rgba(${rgb},${a})`;
      g.lineWidth = w;
      g.lineCap = "round";
      g.beginPath();
      g.arc(0, 0, 72, 0, TAU);
      g.stroke();
      g.lineWidth = w * 0.7;
      g.beginPath();
      g.arc(0, 0, 58, 0, TAU);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 18, 0, TAU);
      g.stroke();
      // hexagrama
      for (let t = 0; t < 2; t++) {
        g.beginPath();
        for (let i = 0; i <= 3; i++) {
          const a = -Math.PI / 2 + t * Math.PI + (i / 3) * TAU;
          const x = Math.cos(a) * 52;
          const y = Math.sin(a) * 52;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      // glifos entre os anéis
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const cx = Math.cos(a) * 65;
        const cy = Math.sin(a) * 65;
        const tx = -Math.sin(a);
        const ty = Math.cos(a);
        g.beginPath();
        switch (i % 4) {
          case 0:
            g.moveTo(cx - Math.cos(a) * 4, cy - Math.sin(a) * 4);
            g.lineTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4);
            break;
          case 1:
            g.moveTo(cx + tx * 3 - Math.cos(a) * 3, cy + ty * 3 - Math.sin(a) * 3);
            g.lineTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4);
            g.lineTo(cx - tx * 3 - Math.cos(a) * 3, cy - ty * 3 - Math.sin(a) * 3);
            break;
          case 2:
            g.arc(cx, cy, 2.4, 0, TAU);
            break;
          default:
            g.moveTo(cx + tx * 3, cy + ty * 3);
            g.lineTo(cx - tx * 3, cy - ty * 3);
            g.moveTo(cx + tx * 3 + Math.cos(a) * 3, cy + ty * 3 + Math.sin(a) * 3);
            g.lineTo(cx - tx * 3 + Math.cos(a) * 3, cy - ty * 3 + Math.sin(a) * 3);
        }
        g.stroke();
      }
    };
    pass(7, 0.18);
    pass(2.2, 0.95);
    return c;
  });
}

/** Bomba polida (casco, cinta de metal, rebites, tampa do pavio). */
function bombSprite(): HTMLCanvasElement {
  return spr("bomb", () => {
    const c = makeCanvas(40, 40);
    const g = c.getContext("2d")!;
    const body = g.createRadialGradient(15, 16, 1, 20, 22, 15);
    body.addColorStop(0, "#7b8390");
    body.addColorStop(0.35, "#353a44");
    body.addColorStop(1, "#0b0d11");
    g.fillStyle = body;
    g.beginPath();
    g.arc(20, 22, 14, 0, TAU);
    g.fill();
    g.strokeStyle = "#07080a";
    g.lineWidth = 1.4;
    g.stroke();
    // cinta
    g.strokeStyle = "#8f96a1";
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(20, 24, 14, 5, 0, 0.05, Math.PI - 0.05);
    g.stroke();
    g.fillStyle = "#d3d8df";
    for (const t of [0.3, 0.9, 1.5, 2.1, 2.7]) {
      g.beginPath();
      g.arc(20 + Math.cos(t) * 14, 24 + Math.sin(t) * 5, 1, 0, TAU);
      g.fill();
    }
    // faixa de perigo
    g.save();
    g.beginPath();
    g.arc(20, 22, 14, 0, TAU);
    g.clip();
    g.fillStyle = "rgba(230,176,40,0.9)";
    for (let i = -3; i < 4; i++) {
      g.beginPath();
      g.moveTo(8 + i * 6, 13);
      g.lineTo(11 + i * 6, 13);
      g.lineTo(15 + i * 6, 17);
      g.lineTo(12 + i * 6, 17);
      g.closePath();
      g.fill();
    }
    g.restore();
    // brilho
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.beginPath();
    g.ellipse(14, 15, 4.2, 2.4, -0.6, 0, TAU);
    g.fill();
    // tampa do pavio
    g.fillStyle = "#b8914c";
    g.strokeStyle = "#3a2a14";
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(20, 8.5, 4.2, 2.2, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.fillRect(16.4, 8.5, 7.2, 2.4);
    return c;
  });
}

/* ═══════════════════════ helpers de desenho ═══════════════════════ */

function poly(ctx: CanvasRenderingContext2D, pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.closePath();
}

function strokeLine(ctx: CanvasRenderingContext2D, pts: number[], n = pts.length) {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < n; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.stroke();
}

/**
 * Cristal de 2 faces com crista (totem, espinhos do gelo).
 * Base no chão em (bx, by); ponta em (bx + lean, by - h).
 */
function crystal(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  w: number,
  h: number,
  lean: number,
  left: string,
  right: string,
  edge: string,
) {
  if (h < 0.6) return;
  const tipX = bx + lean;
  const tipY = by - h;
  const sy = by - h * 0.74;
  const sl = lean * 0.74;
  const fx = bx + w * 0.1;
  const fy = by + w * 0.16;
  ctx.fillStyle = left;
  poly(ctx, [bx - w / 2, by, fx, fy, fx + sl, sy + w * 0.12, tipX, tipY, bx - w / 2 + sl, sy]);
  ctx.fill();
  ctx.fillStyle = right;
  poly(ctx, [fx, fy, bx + w / 2, by, bx + w / 2 + sl, sy, tipX, tipY, fx + sl, sy + w * 0.12]);
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(fx + sl, sy + w * 0.12);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
}

/* ═══════════════════════ 0 · Jato de Água ═══════════════════════ */

const WATER_RANGE = 280;

/** Leque macio: setores aninhados (mais denso no centro) + bordas em nuvem. */
function softFan(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  half: number,
  R: number,
  fade: number,
  inner: string,
  outer: string,
  alpha: number,
) {
  const layers = [
    [1, 0.42],
    [0.62, 0.38],
    [0.3, 0.46],
  ] as const;
  for (const [hf, a] of layers) {
    const rr = R * (0.9 + 0.1 * hf);
    const gr = ctx.createRadialGradient(x, y, 4, x, y, rr);
    gr.addColorStop(0, `rgba(${inner},${a * alpha * fade})`);
    gr.addColorStop(0.55, `rgba(${outer},${a * alpha * 0.8 * fade})`);
    gr.addColorStop(1, `rgba(${outer},0)`);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, rr, ang - half * hf, ang + half * hf);
    ctx.closePath();
    ctx.fill();
  }
}

/** Leque macio pré-desenhado (apontando pra +x, raio `range`) — por quadro só gira/escala. */
function fanSprite(key: string, half: number, range: number, inner: string, outer: string, alpha: number) {
  return spr("fan" + key, () => {
    const pad = 4;
    const hh = Math.ceil(Math.sin(Math.min(half, Math.PI / 2)) * range) + pad;
    const c = makeCanvas(range + pad * 2, hh * 2);
    softFan(c.getContext("2d")!, pad, hh, 0, half, range, 1, inner, outer, alpha);
    return c;
  });
}

function drawFanSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  x: number,
  y: number,
  ang: number,
  R: number,
  range: number,
  alpha: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const k = R / range;
  ctx.scale(k, k);
  ctx.globalAlpha *= alpha;
  ctx.drawImage(img, -4, -img.height / 2);
  ctx.restore();
}

/** Nuvem/espuma ao longo da frente do leque. */
function fanFront(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  half: number,
  R: number,
  fade: number,
  seed: number,
  rgb: string,
  size: number,
  alpha: number,
) {
  const n = FX2_LITE ? 6 : 9;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const a = ang - half * 0.92 + f * half * 1.84;
    const center = 1 - Math.abs(f - 0.5) * 2;
    const rr = R * (0.86 + hash01(seed, i + 120) * 0.12);
    const s = size * (0.65 + 0.55 * center) * (0.8 + hash01(seed, i + 140) * 0.4);
    ctx.globalAlpha = alpha * fade * (0.45 + 0.55 * center);
    ctx.drawImage(puffSprite(rgb, i), x + Math.cos(a) * rr - s / 2, y + Math.sin(a) * rr - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

function drawWaterFan(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  half: number,
  u: number,
  age: number,
  seed: number,
) {
  const grow = easeOut(u / 0.3);
  const R = 16 + (WATER_RANGE - 16) * grow;
  const fade = u < 0.4 ? 1 : 1 - (u - 0.4) / 0.6;
  if (fade <= 0.01) return;
  drawFanSprite(ctx, fanSprite("w", half, WATER_RANGE, WATER_L, WATER_M, 0.62), x, y, ang, R, WATER_RANGE, fade);
  // jatos de alta pressão (pulsos correndo pra fora), mais fortes no centro
  ctx.lineCap = "round";
  ctx.setLineDash([22, 18]);
  ctx.lineDashOffset = -age * 1.3;
  for (let i = 0; i < 7; i++) {
    const s = hash01(seed, i) * 2 - 1;
    const a = ang + s * Math.abs(s) * half * 0.8;
    const center = 1 - Math.abs(s);
    const r0 = 12 + hash01(seed, i + 20) * 16;
    const r1 = R * (0.78 + 0.2 * center);
    const x0 = x + Math.cos(a) * r0;
    const y0 = y + Math.sin(a) * r0;
    const x1 = x + Math.cos(a) * r1;
    const y1 = y + Math.sin(a) * r1;
    ctx.strokeStyle = `rgba(${WATER_M},${0.35 * fade})`;
    ctx.lineWidth = 5 + center * 5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = `rgba(245,252,255,${(0.45 + 0.4 * center) * fade})`;
    ctx.lineWidth = 1.6 + center * 2;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  fanFront(ctx, x, y, ang, half, R, fade, seed, "240,250,255", 44, 0.85);
}

export function spawnWaterJet2(x: number, y: number, angle: number) {
  const half = 1.02;
  const hx = x + Math.cos(angle) * 10;
  const hy = y + Math.sin(angle) * 10;
  const seed = (Math.random() * 1e9) | 0;
  anim({
    layer: 1,
    dur: 540,
    draw: (ctx, u, age) => drawWaterFan(ctx, hx, hy, angle, half, u, age, seed),
  });
  // gotas voando em arco (altura da mão → chão)
  for (let i = 0; i < qty(48); i++) {
    const s = Math.random() * 2 - 1;
    const a = angle + s * Math.abs(s) * half * 1.1;
    const spd = rnd(360, 760);
    emit(DROP, hx, hy, {
      z: rnd(10, 18),
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      vz: rnd(10, 150),
      g: 560,
      drag: 1.3,
      life: rnd(360, 640),
      r0: rnd(1.3, 2.8),
      r1: 0.9,
      rgb: i % 3 === 0 ? WATER_L : i % 3 === 1 ? WATER_M : "170,220,250",
      a: 0.92,
      fout: 0.6,
    });
  }
  // névoa na frente
  for (let i = 0; i < qty(16); i++) {
    const a = angle + rnd(-half, half) * 0.9;
    const spd = rnd(220, 420);
    emit(SMOKE, hx + Math.cos(a) * 20, hy + Math.sin(a) * 20, {
      z: rnd(8, 22),
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      vz: rnd(0, 20),
      drag: 2.6,
      life: rnd(520, 860),
      r0: rnd(8, 12),
      r1: rnd(26, 38),
      rgb: "226,244,255",
      a: 0.4,
      fin: 0.1,
      fout: 0.3,
    });
  }
  // chão molhado no leque
  for (let i = 0; i < qty(5); i++) {
    const a = angle + rnd(-half, half) * 0.85;
    const d = rnd(0.3, 0.95) * WATER_RANGE;
    const w = rnd(44, 76);
    decal(wetSprite(i), x + Math.cos(a) * d, y + Math.sin(a) * d, {
      w,
      h: w * 0.5,
      life: rnd(3800, 5200),
      fadeIn: 260,
      fadeOut: 1800,
      a: 0.9,
    });
  }
  ring(hx, hy + 4, { r0: 6, r1: 38, w0: 5, w1: 1, max: 300, rgb: WATER_L, a: 0.7, sq: 0.5 });
}

/** Acerto do jato no alvo: coroa de gotas + espuma + poça. */
export function spawnWaterSplash2(x: number, y: number) {
  ring(x, y + 4, { r0: 6, r1: 44, w0: 5, w1: 1, max: 440, rgb: "235,248,255", a: 0.95, sq: 0.48, add: false });
  ring(x, y + 4, { r0: 2, r1: 26, w0: 3, w1: 1, max: 300, rgb: WATER_M, a: 0.7, sq: 0.48, add: false, delay: 90 });
  for (let i = 0; i < qty(22); i++) {
    const a = Math.random() * TAU;
    const out = rnd(40, 180);
    emit(DROP, x + Math.cos(a) * 6, y + Math.sin(a) * 4, {
      z: rnd(12, 34),
      vx: Math.cos(a) * out,
      vy: Math.sin(a) * out * 0.7,
      vz: rnd(120, 320),
      g: 820,
      life: rnd(420, 720),
      r0: rnd(1.4, 2.6),
      r1: 1,
      rgb: i % 2 ? WATER_L : WATER_M,
      a: 0.95,
      fout: 0.65,
    });
  }
  for (let i = 0; i < qty(6); i++) {
    const a = Math.random() * TAU;
    emit(SMOKE, x + Math.cos(a) * 8, y, {
      z: rnd(18, 34),
      vx: Math.cos(a) * rnd(20, 60),
      vy: Math.sin(a) * rnd(10, 30),
      vz: rnd(10, 30),
      drag: 1.8,
      life: rnd(500, 800),
      r0: 8,
      r1: rnd(20, 28),
      rgb: "230,246,255",
      a: 0.45,
      fin: 0.1,
      fout: 0.35,
    });
  }
  decal(wetSprite((Math.random() * 3) | 0), x, y + 3, { w: 64, h: 30, life: 4200, fadeIn: 150, fadeOut: 1600 });
}

/* ═══════════════════════ 8 · Congelamento ═══════════════════════ */

const FROST_RANGE = 360;

export function spawnFrost2(x: number, y: number, angle: number) {
  const half = 0.98;
  const hx = x + Math.cos(angle) * 8;
  const hy = y + Math.sin(angle) * 8;
  const seed = (Math.random() * 1e9) | 0;
  // samambaias de gelo no chão (reveladas conforme a frente avança)
  const ferns: number[] = [];
  const nF = FX2_LITE ? 14 : 24;
  for (let i = 0; i < nF; i++) {
    const a = angle + (hash01(seed, i) * 2 - 1) * half * 0.94;
    const r0 = 22 + hash01(seed, i + 50) * FROST_RANGE * 0.82;
    const len = 16 + hash01(seed, i + 90) * 36;
    const bx = Math.cos(a) * r0;
    const by = Math.sin(a) * r0;
    const ex = bx + Math.cos(a) * len;
    const ey = by + Math.sin(a) * len;
    ferns.push(r0, bx, by, ex, ey);
    for (const f of [0.35, 0.62, 0.85]) {
      const px = bx + (ex - bx) * f;
      const py = by + (ey - by) * f;
      const bl = len * 0.34 * (1 - f * 0.5);
      for (const sg of [-1, 1]) {
        const ba = a + sg * 0.75;
        ferns.push(r0, px, py, px + Math.cos(ba) * bl, py + Math.sin(ba) * bl);
      }
    }
  }
  anim({
    layer: 0,
    dur: 2300,
    draw: (ctx, u, age) => {
      const reveal = FROST_RANGE * easeOut(age / 300);
      const fade = u < 0.5 ? 1 : 1 - (u - 0.5) / 0.5;
      ctx.fillStyle = `rgba(${ICE_L},${0.16 * fade})`;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.arc(hx, hy, reveal * 0.94, angle - half * 0.86, angle + half * 0.86);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(244,252,255,${0.75 * fade})`;
      ctx.lineWidth = 1.3;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < ferns.length; i += 5) {
        if (ferns[i]! > reveal) continue;
        ctx.moveTo(hx + ferns[i + 1]!, hy + ferns[i + 2]!);
        ctx.lineTo(hx + ferns[i + 3]!, hy + ferns[i + 4]!);
      }
      ctx.stroke();
    },
  });
  // sopro gelado (leque de névoa macia)
  anim({
    layer: 1,
    dur: 560,
    draw: (ctx, u, age) => {
      const R = 18 + (FROST_RANGE - 18) * easeOut(u / 0.34);
      const fade = u < 0.35 ? 1 : 1 - (u - 0.35) / 0.65;
      if (fade <= 0.01) return;
      drawFanSprite(ctx, fanSprite("f", half, FROST_RANGE, "255,255,255", ICE_M, 0.55), hx, hy, angle, R, FROST_RANGE, fade);
      ctx.strokeStyle = `rgba(255,255,255,${0.4 * fade})`;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.setLineDash([8, 18]);
      ctx.lineDashOffset = -age * 0.9;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(hx, hy, R * (0.4 + k * 0.2), angle - half * (0.5 + k * 0.12), angle + half * (0.5 + k * 0.12));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      fanFront(ctx, hx, hy, angle, half, R, fade, seed, "236,248,255", 52, 0.8);
    },
  });
  for (let i = 0; i < qty(13); i++) {
    const a = angle + rnd(-half, half);
    const spd = rnd(260, 520);
    emit(SMOKE, hx, hy, {
      z: rnd(8, 20),
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      drag: 2.4,
      life: rnd(520, 820),
      r0: rnd(8, 12),
      r1: rnd(26, 38),
      rgb: "222,244,255",
      a: 0.42,
      fin: 0.08,
      fout: 0.3,
    });
  }
  for (let i = 0; i < qty(16); i++) {
    const a = angle + rnd(-half, half) * 0.9;
    const spd = rnd(220, 560);
    emit(FLAKE, hx, hy, {
      z: rnd(8, 26),
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      vz: rnd(-10, 30),
      drag: 1.8,
      life: rnd(700, 1200),
      r0: rnd(4, 7),
      r1: rnd(3, 5),
      vr: rnd(-4, 4),
      a: 0.95,
      fout: 0.5,
    });
  }
  for (let i = 0; i < qty(16); i++) {
    const a = angle + rnd(-half, half) * 0.8;
    const spd = rnd(420, 820);
    emit(SHARD, hx, hy, {
      z: rnd(10, 20),
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      vz: rnd(20, 160),
      g: 600,
      drag: 1.6,
      life: rnd(360, 620),
      r0: rnd(2.2, 4),
      r1: 1.5,
      rot: a,
      vr: rnd(-10, 10),
      rgb: pick([ICE_L, ICE_M, "200,236,255"]),
      css2: "rgba(255,255,255,0.9)",
      a: 0.95,
    });
  }
  ring(hx, hy + 4, { r0: 6, r1: 44, w0: 5, w1: 1, max: 320, rgb: ICE_L, a: 0.8, sq: 0.5 });
}

/** Alvo congelado: espinhos de gelo brotam em volta. */
export function spawnFreeze2(x: number, y: number) {
  const seed = (Math.random() * 1e9) | 0;
  anim({
    layer: 0,
    dur: 900,
    draw: (ctx, u) => {
      const grow = easeOut(u / 0.22);
      const shrink = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      const list: number[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + hash01(seed, i) * 0.5;
        list.push(a);
      }
      list.sort((p, q) => Math.sin(p) - Math.sin(q));
      ctx.globalAlpha = shrink;
      for (const a of list) {
        const d = 18 + hash01(seed, (a * 100) | 0) * 8;
        const bx = x + Math.cos(a) * d;
        const by = y + 2 + Math.sin(a) * d * 0.5;
        const h = (10 + hash01(seed, (a * 50) | 0) * 12) * grow;
        crystal(ctx, bx, by, 7, h, Math.cos(a) * 4, "rgba(120,190,236,0.9)", "rgba(215,242,255,0.95)", "rgba(255,255,255,0.9)");
      }
    },
  });
  ring(x, y + 4, { r0: 6, r1: 48, w0: 5, w1: 1, max: 420, rgb: ICE_L, a: 0.9, sq: 0.5 });
  for (let i = 0; i < qty(18); i++) {
    const a = Math.random() * TAU;
    emit(FLAKE, x + Math.cos(a) * 10, y + Math.sin(a) * 5, {
      z: rnd(10, 50),
      vx: Math.cos(a) * rnd(30, 110),
      vy: Math.sin(a) * rnd(20, 60),
      vz: rnd(20, 90),
      drag: 1.6,
      life: rnd(600, 1000),
      r0: rnd(3.5, 6),
      r1: 3,
      vr: rnd(-5, 5),
      a: 0.95,
    });
  }
  for (let i = 0; i < qty(6); i++) {
    emit(SMOKE, x + rnd(-14, 14), y + rnd(-4, 4), {
      z: rnd(10, 40),
      vz: rnd(10, 30),
      drag: 1.2,
      life: rnd(600, 900),
      r0: 10,
      r1: 26,
      rgb: "230,246,255",
      a: 0.4,
      fin: 0.12,
    });
  }
  emit(HOT, x, y, { z: 34, r0: 30, r1: 10, life: 260, rgb: ICE_M, add: true, a: 0.7, fin: 0, fout: 0.2 });
}

/**
 * Bloco de gelo novo: prisma facetado translúcido (o alvo aparece dentro).
 * (x, y) = pés; w = meia-largura; h = altura.
 */
export function drawIceBlock2(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tMs: number,
  w: number,
  h: number,
  seed: number,
) {
  const sq = 0.42;
  const top = y - h;
  const capH = w * 0.55;
  const bx: number[] = [];
  const by: number[] = [];
  const tx: number[] = [];
  const ty: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + 0.12 * Math.sin(seed + k);
    const r = w * (0.94 + 0.08 * Math.sin(seed * 1.7 + k * 2.3));
    bx.push(x + Math.cos(a) * r);
    by.push(y + 4 + Math.sin(a) * r * sq);
    tx.push(x + Math.cos(a) * r * 0.9);
    ty.push(top + Math.sin(a) * r * 0.9 * sq);
  }
  const apexX = x + Math.sin(seed) * w * 0.12;
  const apexY = top - capH;
  ctx.save();
  // geada no chão
  ctx.fillStyle = "rgba(210,240,255,0.26)";
  ctx.beginPath();
  ctx.ellipse(x, y + 4, w * 1.35, w * 1.35 * sq, 0, 0, TAU);
  ctx.fill();
  // faces de trás (vistas através do gelo)
  ctx.fillStyle = "rgba(120,188,236,0.18)";
  for (let k = 3; k < 6; k++) {
    const k2 = (k + 1) % 6;
    poly(ctx, [bx[k]!, by[k]!, bx[k2]!, by[k2]!, tx[k2]!, ty[k2]!, tx[k]!, ty[k]!]);
    ctx.fill();
  }
  // faces da frente
  const faceCol = ["rgba(170,222,250,0.26)", "rgba(206,240,255,0.3)", "rgba(132,196,240,0.28)"];
  for (let k = 0; k < 3; k++) {
    const k2 = k + 1;
    poly(ctx, [bx[k]!, by[k]!, bx[k2]!, by[k2]!, tx[k2]!, ty[k2]!, tx[k]!, ty[k]!]);
    ctx.fillStyle = faceCol[k]!;
    ctx.fill();
  }
  // tampa em ponta (3 facetas da frente + 3 de trás)
  for (let k = 0; k < 6; k++) {
    const k2 = (k + 1) % 6;
    const front = k < 3;
    poly(ctx, [tx[k]!, ty[k]!, tx[k2]!, ty[k2]!, apexX, apexY]);
    ctx.fillStyle = front ? (k === 1 ? "rgba(236,250,255,0.55)" : "rgba(196,234,255,0.45)") : "rgba(150,206,242,0.25)";
    ctx.fill();
  }
  // brilho interno correndo (recortado no prisma)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bx[0]!, by[0]!);
  for (let k = 1; k <= 3; k++) ctx.lineTo(bx[k]!, by[k]!);
  ctx.lineTo(tx[3]!, ty[3]!);
  ctx.lineTo(apexX, apexY);
  ctx.lineTo(tx[0]!, ty[0]!);
  ctx.closePath();
  ctx.clip();
  const sweep = ((tMs * 0.05 + seed * 40) % (h * 2.2)) - h * 0.6;
  const lg = ctx.createLinearGradient(x - w, top + sweep - 20, x + w, top + sweep + 20);
  lg.addColorStop(0, "rgba(255,255,255,0)");
  lg.addColorStop(0.5, "rgba(255,255,255,0.35)");
  lg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = lg;
  ctx.fillRect(x - w * 1.2, top - capH, w * 2.4, h + capH + 10);
  ctx.restore();
  // arestas
  ctx.strokeStyle = "rgba(250,254,255,0.9)";
  ctx.lineWidth = 1.3;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let k = 0; k <= 3; k++) {
    ctx.moveTo(bx[k]!, by[k]!);
    ctx.lineTo(tx[k]!, ty[k]!);
    ctx.lineTo(apexX, apexY);
  }
  ctx.moveTo(bx[0]!, by[0]!);
  for (let k = 1; k <= 3; k++) ctx.lineTo(bx[k]!, by[k]!);
  ctx.moveTo(tx[0]!, ty[0]!);
  for (let k = 1; k <= 3; k++) ctx.lineTo(tx[k]!, ty[k]!);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx[3]!, by[3]!);
  for (let k = 4; k <= 6; k++) ctx.lineTo(bx[k % 6]!, by[k % 6]!);
  ctx.stroke();
  // espinhos na base
  for (let i = 0; i < 5; i++) {
    const a = 0.25 + (i / 4) * (Math.PI - 0.5);
    const cx = x + Math.cos(a) * w * 1.12;
    const cy = y + 5 + Math.sin(a) * w * 1.12 * sq;
    crystal(ctx, cx, cy, 5, 7 + ((i * 7 + seed) % 5), Math.cos(a) * 3, "rgba(140,200,240,0.9)", "rgba(230,248,255,0.95)", "rgba(255,255,255,0.85)");
  }
  // cintilar nas arestas
  ctx.globalCompositeOperation = "lighter";
  const tw = twinkleSprite(ICE_L);
  for (let i = 0; i < 2; i++) {
    const ph = tMs * 0.004 + seed + i * 2.4;
    const k = i === 0 ? 1 : 2;
    const f = 0.5 + 0.5 * Math.sin(ph * 0.7);
    const px = lerp(bx[k]!, tx[k]!, f);
    const py = lerp(by[k]!, ty[k]!, f);
    const s = 12 + 6 * Math.sin(ph * 2.1);
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(ph * 1.3);
    ctx.drawImage(tw, px - s / 2, py - s / 2, s, s);
  }
  // vapor frio escorrendo
  ctx.globalCompositeOperation = "source-over";
  for (let i = 0; i < 3; i++) {
    const ph = (tMs * 0.0006 + seed * 0.3 + i / 3) % 1;
    const px = x + (i - 1) * w * 0.8 + Math.sin(ph * 6 + i) * 4;
    const py = y + 2 - ph * 14;
    ctx.globalAlpha = 0.28 * Math.sin(ph * Math.PI);
    ctx.fillStyle = "#eaf7ff";
    ctx.beginPath();
    ctx.ellipse(px, py, 7 + ph * 6, 3.5 + ph * 2, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Fim do gelo: estilhaços caindo em arco. */
export function spawnShatter2(x: number, y: number, scale = 1) {
  const h = 70 * scale;
  for (let i = 0; i < qty(Math.round(18 + scale * 12)); i++) {
    const a = Math.random() * TAU;
    const out = rnd(60, 220) * (0.8 + scale * 0.25);
    emit(SHARD, x + Math.cos(a) * 10 * scale, y + Math.sin(a) * 5 * scale, {
      z: rnd(4, h),
      vx: Math.cos(a) * out,
      vy: Math.sin(a) * out * 0.7,
      vz: rnd(80, 260),
      g: 900,
      bounce: 0.28,
      life: rnd(700, 1150),
      r0: rnd(2.6, 6) * (0.8 + scale * 0.25),
      r1: rnd(1.6, 3),
      rot: Math.random() * TAU,
      vr: rnd(-12, 12),
      rgb: pick([ICE_L, ICE_M, "196,232,255"]),
      css2: "rgba(255,255,255,0.95)",
      a: 0.95,
      fout: 0.7,
    });
  }
  for (let i = 0; i < qty(8); i++) {
    emit(SMOKE, x + rnd(-12, 12) * scale, y, {
      z: rnd(6, 40) * scale,
      vx: rnd(-30, 30),
      vz: rnd(10, 40),
      drag: 1.4,
      life: rnd(600, 900),
      r0: 10 * scale,
      r1: 28 * scale,
      rgb: "232,246,255",
      a: 0.45,
      fin: 0.1,
    });
  }
  for (let i = 0; i < qty(5); i++) {
    emit(TWINKLE, x + rnd(-16, 16) * scale, y, {
      z: rnd(10, 60) * scale,
      vz: rnd(10, 40),
      life: rnd(300, 500),
      r0: 8,
      r1: 4,
      rgb: ICE_L,
      add: true,
    });
  }
  ring(x, y + 4, { r0: 8, r1: 46 * scale, w0: 4, w1: 1, max: 360, rgb: ICE_L, a: 0.8, sq: 0.5 });
}

/* ═══════════════════════ 1 · Gigante (efeitos) ═══════════════════════ */

function runeFlash(
  x: number,
  y: number,
  rgb: string,
  size: number,
  dur: number,
  spin: number,
  layer: 0 | 1 = 0,
) {
  const img = runeSprite(rgb);
  anim({
    layer,
    dur,
    draw: (ctx, u, age) => {
      const a = u < 0.15 ? u / 0.15 : u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1;
      const s = size * (0.85 + 0.15 * easeOut(u / 0.3));
      ctx.translate(x, y);
      ctx.scale(1, 0.55);
      ctx.rotate(age * 0.001 * spin);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = a;
      ctx.drawImage(img, -s / 2, -s / 2, s, s);
    },
  });
}

function rockBurst(x: number, y: number, n: number, spd: number, up: number, rgbs = STONE) {
  for (let i = 0; i < qty(n); i++) {
    const a = Math.random() * TAU;
    const out = rnd(spd * 0.3, spd);
    const rgb = pick(rgbs);
    emit(ROCK, x + Math.cos(a) * 8, y + Math.sin(a) * 4, {
      z: rnd(2, 12),
      vx: Math.cos(a) * out,
      vy: Math.sin(a) * out * 0.7,
      vz: rnd(up * 0.5, up),
      g: 1000,
      bounce: 0.3,
      life: rnd(800, 1300),
      r0: rnd(2.4, 5),
      r1: rnd(2, 4),
      rot: Math.random() * TAU,
      vr: rnd(-9, 9),
      rgb,
      css2: "rgba(0,0,0,0.45)",
      a: 1,
      fout: 0.75,
    });
  }
}

function dustRing(x: number, y: number, n: number, spd: number, rgb = "150,130,108", size = 30) {
  for (let i = 0; i < qty(n); i++) {
    const a = (i / n) * TAU + rnd(-0.2, 0.2);
    const s = rnd(spd * 0.6, spd);
    emit(SMOKE, x + Math.cos(a) * 10, y + Math.sin(a) * 5, {
      z: rnd(2, 10),
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s * 0.6,
      vz: rnd(4, 26),
      drag: 3,
      life: rnd(700, 1100),
      r0: size * 0.4,
      r1: size,
      rgb,
      a: 0.5,
      fin: 0.05,
      fout: 0.35,
    });
  }
}

export function spawnGiantSummon2(x: number, y: number) {
  runeFlash(x, y + 6, "255,140,52", 176, 1400, 1.4);
  decal(crackSprite((Math.random() * 3) | 0), x, y + 6, { w: 170, h: 96, life: 6500, fadeIn: 120 });
  // pilar de luz
  anim({
    layer: 1,
    dur: 460,
    draw: (ctx, u) => {
      const a = (1 - u) * (u < 0.1 ? u / 0.1 : 1);
      const w = 30 * (1 - u * 0.5);
      const lg = ctx.createLinearGradient(0, y - 190, 0, y);
      lg.addColorStop(0, "rgba(255,160,70,0)");
      lg.addColorStop(0.7, `rgba(255,190,110,${0.55 * a})`);
      lg.addColorStop(1, `rgba(255,236,200,${0.9 * a})`);
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = lg;
      ctx.fillRect(x - w / 2, y - 190, w, 190);
      ctx.globalAlpha = a;
      const g = hotSprite(FIRE_O);
      ctx.drawImage(g, x - 60, y - 30, 120, 60);
    },
  });
  rockBurst(x, y, 10, 110, 380);
  dustRing(x, y + 4, 10, 190);
  for (let i = 0; i < qty(8); i++) {
    emit(EMBER, x + rnd(-40, 40), y + rnd(-14, 14), {
      z: rnd(0, 20),
      vx: rnd(-20, 20),
      vz: rnd(40, 110),
      drag: 0.8,
      life: rnd(900, 1500),
      r0: rnd(2.5, 4),
      r1: 1,
      rgb: FIRE_O,
      add: true,
    });
  }
  ring(x, y + 6, { r0: 10, r1: 120, w0: 7, w1: 1, max: 560, rgb: "255,160,70", a: 0.85, sq: 0.55 });
}

export function spawnGiantHit2(x: number, y: number) {
  decal(crackSprite((Math.random() * 3) | 0), x, y + 4, { w: 190, h: 106, life: 7000, fadeIn: 60 });
  emit(HOT, x, y, { z: 20, r0: 60, r1: 20, life: 240, rgb: FIRE_O, add: true, a: 0.9, fin: 0, fout: 0.15 });
  ring(x, y + 4, { r0: 12, r1: 150, w0: 10, w1: 1, max: 420, rgb: "255,196,130", a: 0.9, sq: 0.55 });
  ring(x, y + 4, { r0: 8, r1: 110, w0: 18, w1: 3, max: 700, rgb: "130,108,86", a: 0.45, sq: 0.55, add: false, delay: 40 });
  rockBurst(x, y, 18, 260, 420);
  dustRing(x, y + 4, 16, 260);
  for (let i = 0; i < qty(16); i++) {
    const a = Math.random() * TAU;
    const s = rnd(200, 520);
    emit(SPARK, x, y, {
      z: rnd(6, 24),
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s * 0.7,
      vz: rnd(60, 260),
      g: 700,
      drag: 1.5,
      life: rnd(260, 520),
      r0: 2,
      r1: 0.6,
      rgb: pick([FIRE_Y, FIRE_W]),
      add: true,
    });
  }
}

export function spawnGiantExpire2(x: number, y: number) {
  for (let i = 0; i < qty(24); i++) {
    const a = Math.random() * TAU;
    const out = rnd(20, 90);
    emit(ROCK, x + Math.cos(a) * rnd(4, 26), y + Math.sin(a) * rnd(2, 10), {
      z: rnd(10, 80),
      vx: Math.cos(a) * out,
      vy: Math.sin(a) * out * 0.6,
      vz: rnd(-20, 120),
      g: 1000,
      bounce: 0.3,
      life: rnd(900, 1400),
      r0: rnd(3, 6.5),
      r1: rnd(2.5, 4),
      rot: Math.random() * TAU,
      vr: rnd(-8, 8),
      rgb: pick(STONE),
      css2: "rgba(0,0,0,0.45)",
      fout: 0.75,
    });
  }
  dustRing(x, y + 2, 12, 120, "140,128,116", 34);
  for (let i = 0; i < qty(10); i++) {
    emit(EMBER, x + rnd(-24, 24), y + rnd(-8, 8), {
      z: rnd(10, 60),
      vx: rnd(-20, 20),
      vz: rnd(20, 70),
      drag: 0.9,
      life: rnd(700, 1200),
      r0: 3,
      r1: 1,
      rgb: FIRE_O,
      add: true,
    });
  }
  ring(x, y + 4, { r0: 8, r1: 70, w0: 6, w1: 1, max: 500, rgb: "150,140,128", a: 0.5, sq: 0.55, add: false });
}

/* ═══════════════════════ 2 · Botas · 3 · Capa · 4 · Escudo ═══════════════════════ */

export function spawnBootsCast2(x: number, y: number) {
  ring(x, y + 6, { r0: 6, r1: 54, w0: 6, w1: 1, max: 380, rgb: BOOST, a: 0.9, sq: 0.45 });
  emit(HOT, x, y + 4, { z: 4, r0: 30, r1: 12, life: 260, rgb: FIRE_O, add: true, a: 0.8, fin: 0, fout: 0.2 });
  for (let i = 0; i < qty(16); i++) {
    const a = Math.random() * TAU;
    const s = rnd(80, 240);
    emit(SPARK, x + Math.cos(a) * 6, y + 6, {
      z: 2,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s * 0.5,
      vz: rnd(80, 260),
      g: 500,
      drag: 1.5,
      life: rnd(260, 460),
      r0: 1.8,
      r1: 0.6,
      rgb: pick([FIRE_Y, FIRE_W, BOOST]),
      add: true,
    });
  }
  dustRing(x, y + 6, 8, 120, "170,150,120", 18);
}

export function spawnDash2(x: number, y: number, dirAngle: number) {
  const dx = Math.cos(dirAngle);
  const dy = Math.sin(dirAngle);
  ring(x, y + 6, { r0: 8, r1: 64, w0: 4, w1: 1, max: 360, rgb: PINK, a: 0.8, sq: 0.5 });
  // estouro sônico à frente
  anim({
    layer: 1,
    dur: 280,
    draw: (ctx, u) => {
      const a = 1 - u;
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (let k = 0; k < 3; k++) {
        const r = 18 + k * 9 + u * 40;
        const cx = x + dx * (10 + u * 50);
        const cy = y - 30 * BODY_K + dy * (10 + u * 50) * 0.8;
        ctx.strokeStyle = `rgba(${k === 0 ? PINK_L : PINK},${0.7 * a * (1 - k * 0.25)})`;
        ctx.lineWidth = 3 - k * 0.7;
        ctx.beginPath();
        ctx.arc(cx, cy, r, dirAngle - 0.9, dirAngle + 0.9);
        ctx.stroke();
      }
    },
  });
  for (let i = 0; i < qty(14); i++) {
    const a = dirAngle + Math.PI + rnd(-0.8, 0.8);
    const s = rnd(260, 620);
    emit(SPARK, x, y, {
      z: rnd(10, 50),
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s * 0.8,
      drag: 3,
      life: rnd(200, 360),
      r0: rnd(1.6, 2.6),
      r1: 0.6,
      rgb: pick([PINK, PINK_L, "255,255,255"]),
      add: true,
    });
  }
  for (let i = 0; i < qty(6); i++) {
    const a = dirAngle + Math.PI + rnd(-0.7, 0.7);
    emit(SMOKE, x, y + 6, {
      z: 2,
      vx: Math.cos(a) * rnd(80, 180),
      vy: Math.sin(a) * rnd(50, 110),
      vz: rnd(4, 20),
      drag: 3,
      life: rnd(500, 800),
      r0: 8,
      r1: 22,
      rgb: "196,184,176",
      a: 0.45,
      fin: 0.05,
    });
  }
}

export function spawnShieldCast2(x: number, y: number, angle: number) {
  const cx = x + Math.cos(angle) * 24 * BODY_K;
  const cy = y + Math.sin(angle) * 10 * BODY_K;
  ring(x, y + 6, { r0: 8, r1: 58, w0: 6, w1: 1, max: 360, rgb: STAR, a: 0.9, sq: 0.45 });
  emit(HOT, cx, cy, { z: 30 * BODY_K, r0: 34, r1: 12, life: 260, rgb: STAR, add: true, a: 0.8, fin: 0, fout: 0.2 });
  for (let i = 0; i < qty(8); i++) {
    const a = Math.random() * TAU;
    emit(TWINKLE, cx + Math.cos(a) * 18, cy + Math.sin(a) * 8, {
      z: rnd(16, 50),
      vx: Math.cos(a) * rnd(20, 60),
      vy: Math.sin(a) * rnd(10, 30),
      vz: rnd(10, 40),
      drag: 2,
      life: rnd(320, 560),
      r0: rnd(10, 14),
      r1: 4,
      rgb: STAR,
      add: true,
    });
  }
}

/** Bloqueio do Escudo Estelar: ondulação de energia no ponto do impacto. */
export function spawnShieldRipple2(x: number, y: number) {
  ring(x, y, { r0: 3, r1: 20, w0: 3, w1: 1, max: 240, rgb: "120,180,255", a: 0.9, sq: 0.8, ground: false });
  emit(HOT, x, y, { r0: 18, r1: 6, life: 180, rgb: STAR, add: true, a: 0.8, fin: 0, fout: 0.2 });
  emit(TWINKLE, x, y, { life: 260, r0: 14, r1: 6, rgb: STAR, add: true });
}

/**
 * Barreira de energia do Escudo Estelar (só no visual novo): meia-cápsula
 * translúcida em volta do corpo, cobrindo o arco bloqueado (±SHIELD_HALF_ARC).
 * `part` = "back" antes do corpo, "front" depois.
 */
export function drawShieldBarrier2(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  aim: number,
  tMs: number,
  part: "back" | "front",
  strength = 1,
) {
  const R = 31;
  const H = 66;
  const sq = 0.45;
  const n = 20;
  const a0 = aim - SHIELD_HALF_ARC;
  const step = (SHIELD_HALF_ARC * 2) / n;
  const pulse = 0.85 + 0.15 * Math.sin(tMs * 0.012);
  const want = part === "front";
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + i * step;
    px.push(x + Math.cos(t) * R);
    py.push(y + 4 + Math.sin(t) * R * sq);
  }
  const inPart = (i: number) => Math.sin(a0 + (i + 0.5) * step) >= 0 === want;
  ctx.save();
  // faixas translúcidas (mais fortes nas bordas da silhueta — efeito fresnel);
  // um gradiente só, a força de cada faixa vai no globalAlpha
  const lg = ctx.createLinearGradient(0, y + 4 + R * sq, 0, y + 4 - R * sq - H);
  lg.addColorStop(0, "rgba(60,130,255,1)");
  lg.addColorStop(0.55, "rgba(90,160,255,0.5)");
  lg.addColorStop(1, "rgba(150,205,255,0.9)");
  ctx.fillStyle = lg;
  const base = ctx.globalAlpha;
  for (let i = 0; i < n; i++) {
    if (!inPart(i)) continue;
    const mid = a0 + (i + 0.5) * step;
    const edge = Math.min(1, Math.min(i, n - 1 - i) / 2.5);
    const fres = Math.pow(Math.abs(Math.cos(mid)), 2);
    ctx.globalAlpha = base * Math.min(1, (0.12 + 0.24 * fres) * pulse * strength * (0.3 + 0.7 * edge));
    poly(ctx, [px[i]!, py[i]!, px[i + 1]!, py[i + 1]!, px[i + 1]!, py[i + 1]! - H, px[i]!, py[i]! - H]);
    ctx.fill();
  }
  ctx.globalAlpha = base;
  // malha hexagonal (zigue-zague + nervuras)
  ctx.strokeStyle = `rgba(120,180,255,${0.6 * pulse * strength})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const band of [0.3, 0.64]) {
    let first = true;
    for (let i = 0; i <= n; i++) {
      if (i < n && !inPart(i) && (i === 0 || !inPart(i - 1))) {
        first = true;
        continue;
      }
      const yy = py[i]! - H * band + (i % 2 ? 4 : -4);
      if (first) ctx.moveTo(px[i]!, yy);
      else ctx.lineTo(px[i]!, yy);
      first = false;
    }
  }
  for (let i = 2; i < n - 1; i += 2) {
    if (!inPart(i) || !inPart(i - 1)) continue;
    for (const [b0, b1] of [
      [0.3, 0.64],
      [0.64, 0.98],
      [0.02, 0.3],
    ] as const) {
      ctx.moveTo(px[i]!, py[i]! - H * b0 + (i % 2 ? 4 : -4));
      ctx.lineTo(px[i]!, py[i]! - H * b1 + (i % 2 ? 4 : -4));
    }
  }
  ctx.stroke();
  // aros (aditivo) + varredura
  ctx.globalCompositeOperation = "lighter";
  const scan = (tMs * 0.0012) % 1;
  for (const [hh, w, al] of [
    [0, 2.2, 0.7],
    [H, 1.8, 0.6],
    [H * scan, 1.4, 0.5 * (1 - scan)],
  ] as const) {
    ctx.strokeStyle = `rgba(120,190,255,${al * pulse * strength})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    let first = true;
    for (let i = 0; i <= n; i++) {
      const ok = (i < n && inPart(i)) || (i > 0 && inPart(i - 1));
      if (!ok) {
        first = true;
        continue;
      }
      if (first) ctx.moveTo(px[i]!, py[i]! - hh);
      else ctx.lineTo(px[i]!, py[i]! - hh);
      first = false;
    }
    ctx.stroke();
  }
  ctx.restore();
}

/* ═══════════════════════ 5 · Fenda Sísmica ═══════════════════════ */

export function spawnRiftStomp2(x: number, y: number) {
  decal(crackSprite((Math.random() * 3) | 0), x, y + 5, { w: 110, h: 62, life: 5200, fadeIn: 60 });
  ring(x, y + 6, { r0: 8, r1: 78, w0: 8, w1: 1, max: 380, rgb: "176,132,86", a: 0.7, sq: 0.55, add: false });
  dustRing(x, y + 6, 12, 200, "150,122,92", 26);
  rockBurst(x, y + 4, 10, 120, 300, EARTH);
}

const riftState = new WeakMap<RiftFx, { lastEmit: number; opened: boolean; bubble: number }>();

function riftVisible(fx: RiftFx, travelU: number): number[] {
  const pts = fx.pts;
  const maxLen = pts.length - 1;
  const end = Math.min(maxLen, travelU * maxLen);
  const whole = Math.floor(end);
  const frac = end - whole;
  const out: number[] = [];
  for (let i = 0; i <= whole; i++) out.push(pts[i]!.x, pts[i]!.y);
  if (frac > 0 && whole < maxLen) {
    const a = pts[whole]!;
    const b = pts[whole + 1]!;
    out.push(a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac);
  }
  return out;
}

function tickRifts2(dtMs: number) {
  for (const fx of riftsForFx2()) {
    if (!fx.v2) continue;
    let st = riftState.get(fx);
    if (!st) {
      st = { lastEmit: 0, opened: false, bubble: 0 };
      riftState.set(fx, st);
    }
    const travelU = Math.min(1, fx.age / fx.travelMs);
    if (travelU < 1 && fx.age - st.lastEmit > 34) {
      st.lastEmit = fx.age;
      const vis = riftVisible(fx, travelU);
      const tx = vis[vis.length - 2]!;
      const ty = vis[vis.length - 1]!;
      rockBurst(tx, ty, 2, 110, 260, EARTH);
      emit(SMOKE, tx, ty, {
        z: 4,
        vx: rnd(-30, 30),
        vy: rnd(-20, 20),
        vz: rnd(10, 30),
        drag: 2,
        life: rnd(500, 800),
        r0: 8,
        r1: 22,
        rgb: "140,112,84",
        a: 0.45,
        fin: 0.05,
      });
      emit(EMBER, tx, ty, { z: 2, vz: rnd(60, 140), vx: rnd(-40, 40), drag: 1, life: rnd(400, 700), r0: 2.4, r1: 1, rgb: FIRE_O, add: true });
    }
    if (fx.holeOpen && !st.opened) {
      st.opened = true;
      const x = fx.x1;
      const y = fx.y1;
      ring(x, y, { r0: 20, r1: 150, w0: 10, w1: 1, max: 460, rgb: "255,170,90", a: 0.85, sq: 0.58 });
      ring(x, y, { r0: 10, r1: 120, w0: 20, w1: 3, max: 760, rgb: "120,94,70", a: 0.45, sq: 0.58, add: false, delay: 40 });
      rockBurst(x, y, 16, 240, 460, EARTH);
      dustRing(x, y, 12, 240, "140,112,84", 34);
      emit(HOT, x, y, { z: 6, r0: 70, r1: 30, life: 320, rgb: FIRE_O, add: true, a: 0.85, fin: 0, fout: 0.2 });
      for (let i = 0; i < qty(12); i++) {
        const a = Math.random() * TAU;
        const s = rnd(60, 220);
        emit(EMBER, x + Math.cos(a) * 10, y + Math.sin(a) * 6, {
          z: 4,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s * 0.6,
          vz: rnd(120, 300),
          g: 380,
          drag: 0.8,
          life: rnd(700, 1200),
          r0: rnd(2.5, 4),
          r1: 1,
          rgb: pick([FIRE_O, FIRE_Y]),
          add: true,
        });
      }
    }
    if (fx.holeOpen && fx.holeT < 5600) {
      st.bubble += dtMs;
      if (st.bubble > (FX2_LITE ? 160 : 70)) {
        st.bubble = 0;
        const a = Math.random() * TAU;
        const d = rnd(0, 26);
        emit(EMBER, fx.x1 + Math.cos(a) * d, fx.y1 + Math.sin(a) * d * 0.5, {
          z: 0,
          vx: rnd(-14, 14),
          vz: rnd(50, 120),
          drag: 0.6,
          life: rnd(700, 1200),
          r0: rnd(2, 3.4),
          r1: 0.8,
          rgb: pick([FIRE_O, FIRE_Y]),
          add: true,
        });
        if (Math.random() < 0.3) {
          emit(SMOKE, fx.x1 + rnd(-20, 20), fx.y1, {
            z: 6,
            vz: rnd(20, 40),
            drag: 0.8,
            life: rnd(900, 1400),
            r0: 10,
            r1: 30,
            rgb: "60,48,40",
            a: 0.35,
            fin: 0.15,
          });
        }
      }
    }
  }
}

function jaggedRim(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, seed: number, amp: number) {
  const n = 18;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + (hash01(seed, i) - 0.5) * amp;
    const px = x + Math.cos(a) * rx * k;
    const py = y + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Lábios de terra + fenda escura (parte estática — vai pro cache). */
function drawRiftCrackBase(ctx: CanvasRenderingContext2D, vis: number[]) {
  if (vis.length < 4) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(92,68,44,0.95)";
  ctx.lineWidth = 15;
  strokeLine(ctx, vis);
  ctx.strokeStyle = "rgba(146,112,78,0.9)";
  ctx.lineWidth = 11;
  ctx.save();
  ctx.translate(0, -2);
  strokeLine(ctx, vis);
  ctx.restore();
  ctx.strokeStyle = "#140c07";
  ctx.lineWidth = 7.5;
  strokeLine(ctx, vis);
}

/** Calor e magma (dinâmico — pulsa e esfria). */
function drawRiftCrackHeat(ctx: CanvasRenderingContext2D, vis: number[], heat: number, tMs: number, seed: number) {
  if (vis.length < 4 || heat <= 0.02) return;
  const pulse = 0.75 + 0.25 * Math.sin(tMs * 0.012 + seed);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(255,110,34,${0.14 * heat})`;
  ctx.lineWidth = 16;
  strokeLine(ctx, vis);
  ctx.strokeStyle = `rgba(255,112,36,${0.85 * heat * pulse})`;
  ctx.lineWidth = 3.4;
  strokeLine(ctx, vis);
  ctx.strokeStyle = `rgba(255,222,140,${0.8 * heat * pulse})`;
  ctx.lineWidth = 1.2;
  strokeLine(ctx, vis);
  ctx.globalCompositeOperation = "source-over";
}

function drawRiftSlabs(ctx: CanvasRenderingContext2D, fx: RiftFx, travelU: number) {
  const pts = fx.pts;
  const reach = travelU * (pts.length - 1);
  for (let i = 1; i < pts.length - 1; i++) {
    const pop = clamp01((reach - i + 0.4) / 0.5);
    if (pop <= 0) break;
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (const side of [-1, 1]) {
      const h = hash01(fx.seed, i * 2 + (side > 0 ? 1 : 0));
      if (h < 0.35) continue;
      const d = 11 + h * 7;
      const cx = p.x + nx * side * d + (dx / len) * 6;
      const cy = p.y + ny * side * d + (dy / len) * 6;
      const sz = (4 + h * 5) * easeOut(pop);
      const rot = h * TAU;
      const quad: number[] = [];
      const low: number[] = [];
      for (let k = 0; k < 4; k++) {
        const a = rot + (k / 4) * TAU;
        const qx = cx + Math.cos(a) * sz;
        const qy = cy + Math.sin(a) * sz * 0.62;
        quad.push(qx, qy);
        low.push(qx, qy + 3);
      }
      ctx.fillStyle = "#3e2c1c";
      poly(ctx, low);
      ctx.fill();
      ctx.fillStyle = h > 0.7 ? "#9a7a56" : "#7d6044";
      poly(ctx, quad);
      ctx.fill();
      ctx.strokeStyle = "rgba(20,12,6,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

/** Borda + poço do buraco no tamanho cheio (desenhado escalado depois). */
function bakeRiftHole(seed: number): HTMLCanvasElement {
  const rx = 84;
  const ry = rx * 0.58;
  const W = Math.ceil(rx * 1.4 * 2 + 16);
  const H = Math.ceil(ry * 1.4 * 2 + 16);
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d")!;
  const x = W / 2;
  const y = H / 2;
  ctx.fillStyle = "rgba(88,66,46,0.7)";
  jaggedRim(ctx, x, y + 2, rx * 1.32, ry * 1.32, seed + 3, 0.28);
  ctx.fill();
  const rim = ctx.createLinearGradient(0, y - ry * 1.2, 0, y + ry * 1.2);
  rim.addColorStop(0, "#a4845e");
  rim.addColorStop(0.5, "#6e5234");
  rim.addColorStop(1, "#4a3522");
  ctx.fillStyle = rim;
  jaggedRim(ctx, x, y, rx * 1.1, ry * 1.1, seed + 7, 0.2);
  ctx.fill();
  const pit = ctx.createRadialGradient(x, y + ry * 0.2, 2, x, y, rx);
  pit.addColorStop(0, "#050302");
  pit.addColorStop(0.7, "#120a05");
  pit.addColorStop(1, "#2a1a0e");
  ctx.fillStyle = pit;
  jaggedRim(ctx, x, y, rx * 0.92, ry * 0.92, seed + 11, 0.16);
  ctx.fill();
  ctx.strokeStyle = "rgba(160,110,70,0.45)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y + 3, rx * 0.8, ry * 0.72, 0, Math.PI + 0.35, TAU - 0.35);
  ctx.stroke();
  for (let i = 0; i < 9; i++) {
    const a = hash01(seed, i + 60) * TAU;
    const k = 1.05 + hash01(seed, i + 70) * 0.25;
    const px = x + Math.cos(a) * rx * k;
    const py = y + Math.sin(a) * ry * k;
    const sz = 3 + hash01(seed, i + 80) * 4;
    ctx.fillStyle = "#3a2a1a";
    ctx.beginPath();
    ctx.ellipse(px, py + 1.5, sz, sz * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = i % 2 ? "#8a6c4c" : "#735a3e";
    ctx.beginPath();
    ctx.ellipse(px, py, sz, sz * 0.6, 0, 0, TAU);
    ctx.fill();
  }
  return c;
}

interface RiftBake {
  crack: HTMLCanvasElement;
  heat: HTMLCanvasElement;
  cx: number;
  cy: number;
  hole: HTMLCanvasElement | null;
  vis: number[];
}
const riftBakes = new WeakMap<RiftFx, RiftBake>();

function bakeRift(fx: RiftFx): RiftBake {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of fx.pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const pad = 34;
  const c = makeCanvas(x1 - x0 + pad * 2, y1 - y0 + pad * 2);
  const g = c.getContext("2d")!;
  g.translate(-(x0 - pad), -(y0 - pad));
  const vis = riftVisible(fx, 1);
  drawRiftCrackBase(g, vis);
  drawRiftSlabs(g, fx, 1);
  // calor em intensidade cheia (por quadro: um drawImage aditivo com alfa = calor)
  const hc = makeCanvas(c.width, c.height);
  const hg = hc.getContext("2d")!;
  hg.translate(-(x0 - pad), -(y0 - pad));
  hg.lineCap = "round";
  hg.lineJoin = "round";
  hg.strokeStyle = "rgba(255,110,34,0.16)";
  hg.lineWidth = 16;
  strokeLine(hg, vis);
  hg.strokeStyle = "rgba(255,112,36,0.9)";
  hg.lineWidth = 3.4;
  strokeLine(hg, vis);
  hg.strokeStyle = "rgba(255,222,140,0.85)";
  hg.lineWidth = 1.2;
  strokeLine(hg, vis);
  return { crack: c, heat: hc, cx: x0 - pad, cy: y0 - pad, hole: null, vis };
}

function drawRiftHole(ctx: CanvasRenderingContext2D, fx: RiftFx, bake: RiftBake, tMs: number) {
  const t = Math.min(1, fx.holeT / 220);
  const shrink = fx.holeT > 5500 ? Math.max(0.15, 1 - (fx.holeT - 5500) / 1200) : 1;
  const k = ((48 + 36 * t) * shrink) / 84;
  const rx = 84 * k;
  const ry = rx * 0.58;
  const x = fx.x1;
  const y = fx.y1;
  if (!bake.hole) bake.hole = bakeRiftHole(fx.seed);
  const img = bake.hole;
  ctx.drawImage(img, x - (img.width / 2) * k, y - (img.height / 2) * k, img.width * k, img.height * k);
  const pulse = 0.75 + 0.25 * Math.sin(tMs * 0.01 + fx.seed);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.85 * pulse * shrink;
  ctx.drawImage(hotSprite(FIRE_O), x - rx * 0.62, y - ry * 0.3, rx * 1.24, ry * 0.9);
  ctx.globalAlpha = 0.5 * pulse * shrink;
  ctx.drawImage(glowSprite("255,90,30"), x - rx, y - ry * 0.7, rx * 2, ry * 1.6);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

const scarBakes = new WeakMap<RiftScar, { img: HTMLCanvasElement; x: number; y: number; flat: number[] }>();

function bakeScar(s: RiftScar) {
  const flat: number[] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of s.pts) {
    flat.push(p.x, p.y);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const pad = 8;
  const img = makeCanvas(x1 - x0 + pad * 2, y1 - y0 + pad * 2);
  const g = img.getContext("2d")!;
  g.translate(-(x0 - pad), -(y0 - pad));
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = "rgba(96,74,52,0.8)";
  g.lineWidth = 9;
  strokeLine(g, flat);
  g.strokeStyle = "#1a110a";
  g.lineWidth = 4.5;
  strokeLine(g, flat);
  return { img, x: x0 - pad, y: y0 - pad, flat };
}

function drawRiftScar2(ctx: CanvasRenderingContext2D, s: RiftScar, tMs: number) {
  const a = 0.75 * Math.min(1, s.life / 8000);
  const age = s.max - s.life;
  const heat = Math.max(0, 1 - age / 9000);
  let b = scarBakes.get(s);
  if (!b) {
    b = bakeScar(s);
    scarBakes.set(s, b);
  }
  ctx.globalAlpha = a;
  ctx.drawImage(b.img, b.x, b.y);
  if (heat > 0.02) {
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(255,100,30,${0.6 * heat * (0.8 + 0.2 * Math.sin(tMs * 0.008))})`;
    ctx.lineWidth = 1.8;
    strokeLine(ctx, b.flat);
    ctx.globalCompositeOperation = "source-over";
  }
  const hr = 22 + 14 * (s.life / s.max);
  ctx.fillStyle = "rgba(70,52,36,0.8)";
  jaggedRim(ctx, s.x1, s.y1, hr * 1.25, hr * 0.7, 91, 0.3);
  ctx.fill();
  ctx.fillStyle = "rgba(10,7,4,0.9)";
  jaggedRim(ctx, s.x1, s.y1, hr, hr * 0.55, 57, 0.22);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawRifts2(ctx: CanvasRenderingContext2D, tMs: number) {
  const scars = riftScarsForFx2();
  const rifts = riftsForFx2();
  let any = false;
  for (const s of scars) if (s.v2) any = true;
  for (const r of rifts) if (r.v2) any = true;
  if (!any) return;
  ctx.save();
  for (const s of scars) if (s.v2) drawRiftScar2(ctx, s, tMs);
  for (const fx of rifts) {
    if (!fx.v2) continue;
    const travelU = Math.min(1, fx.age / fx.travelMs);
    const heat = fx.holeOpen ? Math.max(0.35, 1 - fx.holeT / 6700) : 1;
    if (travelU < 1) {
      // correndo: desenha ao vivo
      const vis = riftVisible(fx, travelU);
      drawRiftCrackBase(ctx, vis);
      drawRiftSlabs(ctx, fx, travelU);
      drawRiftCrackHeat(ctx, vis, heat, tMs, fx.seed);
      continue;
    }
    // completa: a parte estática vira uma imagem só
    let bake = riftBakes.get(fx);
    if (!bake) {
      bake = bakeRift(fx);
      riftBakes.set(fx, bake);
    }
    ctx.drawImage(bake.crack, bake.cx, bake.cy);
    if (heat > 0.02) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = heat * (0.75 + 0.25 * Math.sin(tMs * 0.012 + fx.seed));
      ctx.drawImage(bake.heat, bake.cx, bake.cy);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    if (fx.holeOpen) drawRiftHole(ctx, fx, bake, tMs);
  }
  ctx.restore();
}

/* ═══════════════════════ 6 · Bomba Devastadora ═══════════════════════ */

export function spawnBombDrop2(x: number, y: number) {
  ring(x, y + 5, { r0: 4, r1: 30, w0: 4, w1: 1, max: 260, rgb: "255,190,110", a: 0.7, sq: 0.5 });
  for (let i = 0; i < qty(10); i++) {
    const a = Math.random() * TAU;
    emit(SPARK, x, y - 12, {
      z: 6,
      vx: Math.cos(a) * rnd(40, 140),
      vy: Math.sin(a) * rnd(30, 90),
      vz: rnd(60, 180),
      g: 500,
      drag: 1.2,
      life: rnd(220, 400),
      r0: 1.6,
      r1: 0.5,
      rgb: pick([FIRE_Y, FIRE_W]),
      add: true,
    });
  }
  dustRing(x, y + 5, 6, 80, "170,150,126", 14);
}

const bombSparkAt = new Map<number, number>();

/** Bomba no chão: zona de perigo real (BOMB_RADIUS) + casco polido + pavio. */
export function drawBomb2(ctx: CanvasRenderingContext2D, t: ThrowableState, tMs: number) {
  const fuseLeft = Math.max(0, t.fuse);
  const left = Math.min(1, fuseLeft / BOMB_FUSE_MS);
  const urgency = 1 - left;
  const blinkHz = 2.5 + urgency * 13;
  const lit = Math.sin(tMs * 0.001 * blinkHz * TAU) > 0;
  ctx.save();
  // zona de perigo (círculo real do dano)
  ctx.beginPath();
  ctx.arc(t.x, t.y, BOMB_RADIUS, 0, TAU);
  if (urgency > 0.45) {
    ctx.fillStyle = `rgba(255,56,24,${0.07 * ((urgency - 0.45) / 0.55) * (lit ? 1 : 0.6)})`;
    ctx.fill();
  }
  ctx.setLineDash([22, 14]);
  ctx.lineDashOffset = -tMs * 0.06;
  ctx.strokeStyle = `rgba(255,96,48,${0.28 + 0.4 * urgency})`;
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.setLineDash([]);
  // contagem: anel que fecha na bomba
  ctx.strokeStyle = `rgba(255,214,150,${0.25 + 0.35 * urgency})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(t.x, t.y, Math.max(6, BOMB_RADIUS * left), 0, TAU);
  ctx.stroke();
  // sombra
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.ellipse(t.x + 2, t.y + 8, 12, 4.5, 0, 0, TAU);
  ctx.fill();
  // casco (balança de leve)
  const wob = Math.sin(tMs * 0.02) * 0.06 * (0.3 + urgency);
  ctx.translate(t.x, t.y - 4);
  ctx.rotate(wob);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bombSprite(), -20, -22, 40, 40);
  // luz de alerta na cinta
  if (lit) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.9;
    ctx.drawImage(hotSprite("255,40,30"), -9, -1, 18, 18);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  // pavio
  const tipX = 5;
  const tipY = -21 - urgency * 2;
  ctx.strokeStyle = "#c8a060";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.quadraticCurveTo(6, -17, tipX, tipY);
  ctx.stroke();
  ctx.globalCompositeOperation = "lighter";
  const fl = 10 + urgency * 8 + Math.sin(tMs * 0.05) * 3;
  ctx.drawImage(hotSprite(FIRE_O), tipX - fl / 2, tipY - fl / 2, fl, fl);
  ctx.restore();
  // faíscas do pavio
  const last = bombSparkAt.get(t.id) ?? 0;
  if (tMs - last > (FX2_LITE ? 70 : 32) || tMs < last) {
    bombSparkAt.set(t.id, tMs);
    if (bombSparkAt.size > 32) bombSparkAt.clear();
    const a = Math.random() * TAU;
    emit(SPARK, t.x + tipX, t.y - 4 + tipY, {
      vx: Math.cos(a) * rnd(40, 120),
      vy: Math.sin(a) * rnd(20, 60),
      vz: rnd(40, 140),
      g: 400,
      drag: 1,
      life: rnd(160, 300),
      r0: 1.4,
      r1: 0.4,
      rgb: pick([FIRE_Y, FIRE_W]),
      add: true,
    });
  }
}

interface Boom2 {
  t: number;
  max: number;
}
const booms2: Boom2[] = [];

export function spawnBigBoom2(x: number, y: number, feel: FeelState) {
  booms2.push({ t: 900, max: 900 });
  while (booms2.length > 4) booms2.shift();
  const v = (Math.random() * 3) | 0;
  // cratera + brasas que esfriam
  const seed = (Math.random() * 1e9) | 0;
  decal(scorchSprite(v), x, y + 4, {
    w: 320,
    h: 200,
    life: 14000,
    fadeIn: 160,
    fadeOut: 4200,
    over: (ctx, _d, u, tMs) => {
      if (u > 0.25) return;
      const heat = 1 - u / 0.25;
      ctx.globalCompositeOperation = "lighter";
      const g = glowSprite(FIRE_O);
      for (let i = 0; i < 6; i++) {
        const a = hash01(seed, i) * TAU;
        const d = 30 + hash01(seed, i + 9) * 70;
        const px = x + Math.cos(a) * d;
        const py = y + 4 + Math.sin(a) * d * 0.62;
        const s = 8 + hash01(seed, i + 19) * 10;
        ctx.globalAlpha = heat * (0.45 + 0.35 * Math.sin(tMs * 0.01 + i));
        ctx.drawImage(g, px - s, py - s * 0.6, s * 2, s * 1.2);
      }
      ctx.globalAlpha = heat * 0.6;
      ctx.drawImage(hotSprite("255,90,30"), x - 44, y - 20, 88, 50);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  });
  // clarão no chão
  anim({
    layer: 0,
    dur: 480,
    draw: (ctx, u) => {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.pow(1 - u, 2) * 0.85;
      const R = BOMB_RADIUS * (0.55 + 0.3 * u);
      ctx.drawImage(glowSprite("255,170,80"), x - R, y - R * 0.62, R * 2, R * 1.24);
    },
  });
  // flash
  emit(HOT, x, y, { z: 26, r0: 60, r1: 150, life: 200, rgb: "255,170,90", add: true, a: 0.85, fin: 0, fout: 0.1 });
  // bola de fogo: corpo laranja (mistura normal, não estoura pro branco)…
  for (let i = 0; i < qty(12); i++) {
    const a = Math.random() * TAU;
    const d = rnd(0, 56);
    emit(SMOKE, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, {
      z: rnd(10, 56),
      vx: Math.cos(a) * rnd(60, 190),
      vy: Math.sin(a) * rnd(40, 120),
      vz: rnd(40, 170),
      drag: 2.6,
      life: rnd(380, 700),
      r0: rnd(20, 28),
      r1: rnd(46, 68),
      rgb: pick(["255,150,40", "245,108,28", "255,196,84", "210,70,24"]),
      a: 0.95,
      fin: 0.02,
      fout: 0.3,
    });
  }
  // …e miolo quente aditivo por cima
  for (let i = 0; i < qty(7); i++) {
    const a = Math.random() * TAU;
    const d = rnd(0, 34);
    emit(i < 3 ? HOT : GLOW, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, {
      z: rnd(16, 48),
      vx: Math.cos(a) * rnd(30, 110),
      vy: Math.sin(a) * rnd(20, 70),
      vz: rnd(40, 120),
      drag: 2.6,
      life: rnd(260, 480),
      r0: rnd(18, 26),
      r1: rnd(34, 50),
      rgb: pick([FIRE_Y, FIRE_O]),
      add: true,
      a: 0.55,
      fin: 0.02,
      fout: 0.2,
    });
  }
  // coluna de fumaça (sobe e cresce)
  for (let i = 0; i < qty(8); i++) {
    const a = Math.random() * TAU;
    const d = rnd(0, 64);
    emit(SMOKE, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, {
      z: rnd(10, 50),
      vx: Math.cos(a) * rnd(10, 50),
      vy: Math.sin(a) * rnd(10, 30),
      vz: rnd(30, 100),
      drag: 0.9,
      life: rnd(1700, 2900),
      delay: rnd(60, 280),
      r0: rnd(22, 30),
      r1: rnd(52, 80),
      rgb: pick(["44,38,34", "64,56,50", "30,26,24"]),
      a: 0.78,
      fin: 0.1,
      fout: 0.45,
    });
  }
  dustRing(x, y + 4, 10, 420, "128,108,88", 34);
  // detritos em arco
  for (let i = 0; i < qty(14); i++) {
    const a = Math.random() * TAU;
    const s = rnd(140, 440);
    emit(ROCK, x, y, {
      z: rnd(6, 24),
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s * 0.7,
      vz: rnd(220, 520),
      g: 1100,
      bounce: 0.3,
      life: rnd(900, 1500),
      r0: rnd(2.4, 5),
      r1: rnd(2, 4),
      rot: Math.random() * TAU,
      vr: rnd(-12, 12),
      rgb: pick(["58,48,40", "84,70,56", "40,34,30"]),
      css2: "rgba(0,0,0,0.5)",
      fout: 0.75,
    });
  }
  // faíscas
  for (let i = 0; i < qty(22); i++) {
    const a = Math.random() * TAU;
    const s = rnd(320, 760);
    emit(SPARK, x, y, {
      z: rnd(8, 34),
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s * 0.75,
      vz: rnd(40, 320),
      g: 520,
      drag: 1.4,
      life: rnd(300, 680),
      r0: rnd(1.4, 2.6),
      r1: 0.6,
      rgb: pick([FIRE_W, FIRE_Y]),
      add: true,
    });
  }
  // brasas flutuando
  for (let i = 0; i < qty(14); i++) {
    emit(EMBER, x + rnd(-90, 90), y + rnd(-50, 50), {
      z: rnd(10, 70),
      vx: rnd(-40, 40),
      vy: rnd(-24, 24),
      vz: rnd(20, 90),
      drag: 0.7,
      life: rnd(1500, 2800),
      r0: rnd(2, 4),
      r1: 1,
      rgb: FIRE_O,
      add: true,
    });
  }
  ring(x, y + 6, { r0: 24, r1: 320, w0: 8, w1: 1, max: 440, rgb: "255,196,140", a: 0.7, sq: 0.62 });
  ring(x, y + 6, { r0: 12, r1: 250, w0: 30, w1: 4, max: 820, rgb: "120,98,76", a: 0.4, sq: 0.62, add: false, delay: 50 });
  feel.shake = Math.max(feel.shake, 9.5);
  feel.bodyKick = Math.max(feel.bodyKick, 0.85);
}

/* ═══════════════════════ 7 · Escudo de Espinhos (cristais) ═══════════════════════ */

const totemBorn2 = new Map<number, number>();
const TOTEM_RISE_MS = 420;

/** `quiet`: só marca o nascimento (o conjurador já viu o efeito predito). */
export function spawnTotem2(x: number, y: number, id: number | undefined, angle: number, quiet = false) {
  if (id != null) totemBorn2.set(id & 0xff, performance.now());
  if (totemBorn2.size > 32) totemBorn2.clear();
  if (quiet) return;
  decal(crackSprite((Math.random() * 3) | 0, "46,62,52"), x, y + 4, { w: 150, h: 84, life: 10500, fadeIn: 80, a: 0.55 });
  ring(x, y + 2, { r0: 20, r1: TOTEM_RADIUS, w0: 8, w1: 1, max: 520, rgb: EMERALD, a: 0.8, sq: 1 });
  ring(x, y + 2, { r0: 10, r1: 90, w0: 14, w1: 2, max: 420, rgb: "120,110,96", a: 0.45, sq: 0.6, add: false });
  rockBurst(x, y, 8, 150, 360, STONE);
  dustRing(x, y + 2, 10, 220, "140,130,116", 28);
  for (let i = 0; i < qty(10); i++) {
    const a = angle + Math.PI + rnd(-1.4, 1.4);
    const d = rnd(TOTEM_BODY_OUTER_R, TOTEM_RADIUS);
    emit(EMBER, x + Math.cos(a) * d, y + Math.sin(a) * d, {
      z: 2,
      vz: rnd(40, 110),
      drag: 0.8,
      life: rnd(700, 1200),
      delay: rnd(100, 400),
      r0: rnd(2.2, 3.4),
      r1: 1,
      rgb: EMERALD,
      add: true,
    });
  }
}

export function spawnTotemHit2(x: number, y: number) {
  for (let i = 0; i < qty(10); i++) {
    const a = Math.random() * TAU;
    const s = rnd(80, 240);
    emit(SPARK, x, y, {
      z: rnd(10, 40),
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s * 0.7,
      vz: rnd(40, 160),
      g: 500,
      drag: 1.6,
      life: rnd(200, 360),
      r0: 1.6,
      r1: 0.5,
      rgb: pick([EMERALD, EMERALD_L]),
      add: true,
    });
  }
  for (let i = 0; i < qty(3); i++) {
    const a = Math.random() * TAU;
    emit(SHARD, x, y, {
      z: rnd(10, 30),
      vx: Math.cos(a) * rnd(40, 120),
      vy: Math.sin(a) * rnd(30, 80),
      vz: rnd(80, 200),
      g: 900,
      life: rnd(400, 600),
      r0: 3,
      r1: 2,
      rot: Math.random() * TAU,
      vr: rnd(-10, 10),
      rgb: EMERALD,
      css2: "rgba(220,255,236,0.9)",
    });
  }
  emit(TWINKLE, x, y, { z: 26, life: 280, r0: 14, r1: 6, rgb: EMERALD_L, add: true });
}

export function spawnTotemExpire2(x: number, y: number, id: number | undefined, angle: number) {
  if (id != null) totemBorn2.delete(id & 0xff);
  const arcStart = angle + TOTEM_C_HALF_OPEN;
  const span = TAU - TOTEM_C_HALF_OPEN * 2;
  const mid = (TOTEM_BODY_INNER_R + TOTEM_BODY_OUTER_R) / 2;
  for (let i = 0; i < qty(40); i++) {
    const a = arcStart + Math.random() * span;
    const px = x + Math.cos(a) * mid;
    const py = y + Math.sin(a) * mid;
    const s = rnd(40, 180);
    emit(SHARD, px, py, {
      z: rnd(6, 40),
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s * 0.7,
      vz: rnd(100, 280),
      g: 900,
      bounce: 0.25,
      life: rnd(700, 1100),
      r0: rnd(3, 6),
      r1: rnd(2, 3),
      rot: Math.random() * TAU,
      vr: rnd(-12, 12),
      rgb: pick([EMERALD, "30,160,96", "120,240,180"]),
      css2: "rgba(220,255,236,0.9)",
      fout: 0.7,
    });
  }
  for (let i = 0; i < qty(24); i++) {
    const a = arcStart + Math.random() * span;
    const d = rnd(TOTEM_BODY_OUTER_R, TOTEM_RADIUS);
    emit(EMBER, x + Math.cos(a) * d, y + Math.sin(a) * d, {
      z: rnd(0, 20),
      vz: rnd(30, 90),
      drag: 0.8,
      life: rnd(600, 1100),
      r0: rnd(2, 3.4),
      r1: 1,
      rgb: EMERALD,
      add: true,
    });
  }
  dustRing(x, y, 12, 160, "140,150,136", 30);
  ring(x, y, { r0: 30, r1: 150, w0: 8, w1: 1, max: 480, rgb: EMERALD, a: 0.7, sq: 0.6 });
}

interface TotemLayout {
  angle: number;
  wall: number[];
  field: number[];
}
const totemLayouts = new Map<number, TotemLayout>();

/** Posições dos cristais (cache por totem): [x, y, w, h, lean, idx]… ordenados por y. */
function layoutOf(t: SpikeTotemSnap): TotemLayout {
  const key = t.id & 0xff;
  const hit = totemLayouts.get(key);
  if (hit && hit.angle === t.angle) return hit;
  const seed = ((t.id * 7919) ^ Math.round(t.angle * 1000)) >>> 0;
  const arcStart = t.angle + TOTEM_C_HALF_OPEN;
  const span = TAU - TOTEM_C_HALF_OPEN * 2;
  const mid = (TOTEM_BODY_INNER_R + TOTEM_BODY_OUTER_R) / 2;
  const wall: number[][] = [];
  const nW = FX2_LITE ? 9 : 14;
  for (let j = 0; j < nW; j++) {
    const a = arcStart + ((j + 0.5) / nW) * span;
    const h1 = hash01(seed, j);
    const r = mid + (h1 - 0.5) * 14;
    wall.push([Math.cos(a) * r, Math.sin(a) * r, 14 + h1 * 6, 30 + hash01(seed, j + 40) * 20, Math.cos(a) * 5, j]);
  }
  wall.sort((p, q) => p[1]! - q[1]!);
  const field: number[][] = [];
  const nF = FX2_LITE ? 14 : 36;
  for (let i = 0; i < nF; i++) {
    const a = arcStart + hash01(seed, i + 100) * span;
    const d = TOTEM_BODY_OUTER_R + 18 + hash01(seed, i + 200) * (TOTEM_RADIUS - TOTEM_BODY_OUTER_R - 30);
    field.push([Math.cos(a) * d, Math.sin(a) * d, 5 + hash01(seed, i + 300) * 3, 10 + hash01(seed, i + 400) * 16, Math.cos(a) * 3, d]);
  }
  field.sort((p, q) => p[1]! - q[1]!);
  const out: TotemLayout = { angle: t.angle, wall: wall.flat(), field: field.flat() };
  totemLayouts.set(key, out);
  if (totemLayouts.size > 16) {
    const first = totemLayouts.keys().next().value;
    if (first != null) totemLayouts.delete(first);
  }
  return out;
}

export function drawSpikeTotems2(ctx: CanvasRenderingContext2D, totems: readonly SpikeTotemSnap[], tMs: number) {
  const now = performance.now();
  for (const t of totems) {
    const born = totemBorn2.get(t.id & 0xff);
    const age = born != null ? Math.max(0, now - born) : 99999;
    const L = layoutOf(t);
    const arcStart = t.angle + TOTEM_C_HALF_OPEN;
    const arcEnd = t.angle + TAU - TOTEM_C_HALF_OPEN;
    const pulse = 0.75 + 0.25 * Math.sin(tMs * 0.006 + t.id);
    const fieldU = clamp01((age - 180) / 500);
    ctx.save();
    // campo (setor de trás)
    if (fieldU > 0) {
      const gr = ctx.createRadialGradient(t.x, t.y, TOTEM_BODY_OUTER_R * 0.6, t.x, t.y, TOTEM_RADIUS);
      gr.addColorStop(0, `rgba(40,200,110,${0.16 * fieldU})`);
      gr.addColorStop(0.7, `rgba(20,150,80,${0.1 * fieldU})`);
      gr.addColorStop(1, "rgba(10,80,40,0)");
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.arc(t.x, t.y, TOTEM_RADIUS, arcStart, arcEnd);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(80,255,160,${0.45 * fieldU * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, TOTEM_RADIUS, arcStart, arcEnd);
      ctx.stroke();
      ctx.setLineDash([3, 10]);
      ctx.lineDashOffset = -tMs * 0.02;
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(150,255,200,${0.35 * fieldU})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, TOTEM_RADIUS - 10, arcStart + 0.05, arcEnd - 0.05);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = "source-over";
    }
    // espinhos de cristal no campo — em lote: poucas chamadas pra dezenas de cristais
    const F = L.field;
    const g = glowSprite(EMERALD);
    const shadows = new Path2D();
    const lefts = new Path2D();
    const rights = new Path2D();
    const ridges = new Path2D();
    const tips: number[] = [];
    for (let i = 0; i < F.length; i += 6) {
      const d = F[i + 5]!;
      const grow = easeOut((age - 200 - (d - TOTEM_BODY_OUTER_R) * 1.4) / 260);
      if (grow <= 0) continue;
      const bx = t.x + F[i]!;
      const by = t.y + F[i + 1]!;
      const w = F[i + 2]!;
      const h = F[i + 3]! * grow;
      const lean = F[i + 4]!;
      shadows.moveTo(bx + 1 + w * 0.8, by + 1);
      shadows.ellipse(bx + 1, by + 1, w * 0.8, 2, 0, 0, TAU);
      const tipX = bx + lean;
      const tipY = by - h;
      const sy = by - h * 0.74;
      const sl = lean * 0.74;
      const fx = bx + w * 0.1;
      const fy = by + w * 0.16;
      lefts.moveTo(bx - w / 2, by);
      lefts.lineTo(fx, fy);
      lefts.lineTo(fx + sl, sy + w * 0.12);
      lefts.lineTo(tipX, tipY);
      lefts.lineTo(bx - w / 2 + sl, sy);
      lefts.closePath();
      rights.moveTo(fx, fy);
      rights.lineTo(bx + w / 2, by);
      rights.lineTo(bx + w / 2 + sl, sy);
      rights.lineTo(tipX, tipY);
      rights.lineTo(fx + sl, sy + w * 0.12);
      rights.closePath();
      ridges.moveTo(fx, fy);
      ridges.lineTo(fx + sl, sy + w * 0.12);
      ridges.lineTo(tipX, tipY);
      if ((i / 6) % 2 === 0) tips.push(tipX, tipY, grow);
    }
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fill(shadows);
    ctx.fillStyle = "#0e6a3c";
    ctx.fill(lefts);
    ctx.fillStyle = "#3fe394";
    ctx.fill(rights);
    ctx.strokeStyle = "rgba(220,255,236,0.85)";
    ctx.lineWidth = 1;
    ctx.stroke(ridges);
    if (tips.length) {
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < tips.length; i += 3) {
        ctx.globalAlpha = 0.55 * pulse * tips[i + 2]!;
        ctx.drawImage(g, tips[i]! - 5, tips[i + 1]! - 5, 10, 10);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    // base de pedra do C (o corpo sólido)
    const riseAll = easeOut(age / TOTEM_RISE_MS);
    ctx.beginPath();
    ctx.arc(t.x, t.y, TOTEM_BODY_OUTER_R, arcStart, arcEnd, false);
    ctx.arc(t.x, t.y, TOTEM_BODY_INNER_R, arcEnd, arcStart, true);
    ctx.closePath();
    ctx.fillStyle = `rgba(28,40,34,${0.9 * riseAll})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(70,110,90,${0.8 * riseAll})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    // brilho interno do muro
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(60,230,140,${0.18 * pulse * riseAll})`;
    ctx.lineWidth = TOTEM_BODY_OUTER_R - TOTEM_BODY_INNER_R;
    ctx.beginPath();
    ctx.arc(t.x, t.y, (TOTEM_BODY_INNER_R + TOTEM_BODY_OUTER_R) / 2, arcStart, arcEnd);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    // cristais do muro (brotam em sequência)
    tips.length = 0;
    const W = L.wall;
    for (let i = 0; i < W.length; i += 6) {
      const j = W[i + 5]!;
      const grow = easeOut((age - j * 20) / 300);
      if (grow <= 0) continue;
      const bx = t.x + W[i]!;
      const by = t.y + W[i + 1]!;
      const h = W[i + 3]! * grow;
      crystal(ctx, bx, by, W[i + 2]!, h, W[i + 4]!, "#0b5a33", "#2fcf7d", "rgba(214,255,232,0.95)");
      // reflexo na face clara
      ctx.fillStyle = "rgba(220,255,236,0.28)";
      ctx.beginPath();
      ctx.moveTo(bx + W[i + 2]! * 0.18, by - h * 0.15);
      ctx.lineTo(bx + W[i + 2]! * 0.34, by - h * 0.18);
      ctx.lineTo(bx + W[i + 4]! * 0.7 + 1, by - h * 0.7);
      ctx.closePath();
      ctx.fill();
      tips.push(bx + W[i + 4]!, by - h, grow * 1.4);
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < tips.length; i += 3) {
      ctx.globalAlpha = Math.min(1, 0.5 * pulse * tips[i + 2]!);
      ctx.drawImage(g, tips[i]! - 7, tips[i + 1]! - 7, 14, 14);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }
}

/** Mira do totem: arco pontilhado até o alvo + prévia do C e do campo. */
export function drawTotemAim2(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  tMs: number,
) {
  const pulse = 0.65 + 0.35 * Math.sin(tMs * 0.01);
  const hx = fromX + Math.cos(Math.atan2(toY - fromY, toX - fromX)) * 12;
  const hy = fromY - 18 * BODY_K;
  const dist = Math.hypot(toX - hx, toY - hy);
  const cx = (hx + toX) / 2;
  const cy = (hy + toY) / 2 - 40 - dist * 0.18;
  const openAng = Math.atan2(fromY - toY, fromX - toX);
  const arcStart = openAng + TOTEM_C_HALF_OPEN;
  const arcEnd = openAng + TAU - TOTEM_C_HALF_OPEN;
  ctx.save();
  // campo
  ctx.fillStyle = `rgba(40,200,110,${0.08 * pulse})`;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.arc(toX, toY, TOTEM_RADIUS, arcStart, arcEnd);
  ctx.closePath();
  ctx.fill();
  ctx.setLineDash([12, 10]);
  ctx.lineDashOffset = -tMs * 0.03;
  ctx.strokeStyle = `rgba(90,255,170,${0.5 * pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(toX, toY, TOTEM_RADIUS, 0, TAU);
  ctx.stroke();
  // trajetória
  ctx.setLineDash([6, 8]);
  ctx.lineDashOffset = -tMs * 0.05;
  ctx.strokeStyle = `rgba(160,255,210,${0.8 * pulse})`;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.quadraticCurveTo(cx, cy, toX, toY);
  ctx.stroke();
  ctx.setLineDash([]);
  // prévia do C
  ctx.beginPath();
  ctx.arc(toX, toY, TOTEM_BODY_OUTER_R, arcStart, arcEnd, false);
  ctx.arc(toX, toY, TOTEM_BODY_INNER_R, arcEnd, arcStart, true);
  ctx.closePath();
  ctx.fillStyle = `rgba(40,210,120,${0.28 * pulse})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(190,255,220,${0.8 * pulse})`;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // runa no alvo + mão
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.6 * pulse;
  const rs = runeSprite(EMERALD);
  ctx.translate(toX, toY);
  ctx.scale(1, 0.55);
  ctx.rotate(tMs * 0.0015);
  ctx.drawImage(rs, -34, -34, 68, 68);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.8 * pulse;
  ctx.drawImage(hotSprite(EMERALD), hx - 9, hy - 9, 18, 18);
  ctx.restore();
}

/* ═══════════════════════ 9 · Escudo Bumerangue ═══════════════════════ */

const discTrail = new Map<number, { x: number; y: number; t: number }[]>();
const discTwinkleAt = new Map<number, number>();
const DISC_Y = -26 * BODY_K;
const DISC_R = 17 * BODY_K;

export function drawThrownShield2(ctx: CanvasRenderingContext2D, t: ThrowableState, tMs: number) {
  const ghost = t.fuse >= 2;
  const y = t.y + DISC_Y;
  let tr = discTrail.get(t.id);
  if (!tr) {
    tr = [];
    discTrail.set(t.id, tr);
    if (discTrail.size > 16) {
      const first = discTrail.keys().next().value;
      if (first != null && first !== t.id) discTrail.delete(first);
    }
  }
  const last = tr[tr.length - 1];
  if (!last || last.t > tMs || Math.hypot(last.x - t.x, last.y - y) > 1.5) tr.push({ x: t.x, y, t: tMs });
  while (tr.length && (tMs - tr[0]!.t > 170 || tr[0]!.t > tMs)) tr.shift();
  ctx.save();
  if (ghost) ctx.globalAlpha *= 0.4;
  // sombra
  ctx.fillStyle = "rgba(10,10,14,0.3)";
  ctx.beginPath();
  ctx.ellipse(t.x + 3, t.y + 4, 16 * BODY_K, 5.5 * BODY_K, 0, 0, TAU);
  ctx.fill();
  // fita de luz
  if (tr.length > 1 && !ghost) {
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const n = tr.length;
    for (let i = 1; i < n; i++) {
      const f = i / (n - 1);
      const p0 = tr[i - 1]!;
      const p1 = tr[i]!;
      ctx.strokeStyle = `rgba(${STAR},${0.32 * f})`;
      ctx.lineWidth = 3 + f * 16 * BODY_K;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(235,244,255,${0.6 * f})`;
      ctx.lineWidth = 1 + f * 3;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  // halo
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha *= ghost ? 0.2 : 0.55;
  ctx.drawImage(glowSprite(STAR), t.x - 26, y - 18, 52, 36);
  ctx.restore();
  drawStarShield(ctx, t.x, y, DISC_R, {
    squash: 0.62,
    spin: tMs * 0.03,
    glow: ghost ? 0 : t.fuse > 0 ? 0.45 : 0.7,
    t: tMs,
  });
  ctx.restore();
  if (!ghost) {
    const lt = discTwinkleAt.get(t.id) ?? 0;
    if (tMs - lt > 70 || tMs < lt) {
      discTwinkleAt.set(t.id, tMs);
      if (discTwinkleAt.size > 16) discTwinkleAt.clear();
      const a = Math.random() * TAU;
      emit(TWINKLE, t.x + Math.cos(a) * DISC_R, y + Math.sin(a) * DISC_R * 0.62, {
        life: 220,
        r0: 10,
        r1: 3,
        rgb: STAR,
        add: true,
      });
    }
  }
}

export function spawnDiscBounce2(x: number, y: number) {
  const yy = y + DISC_Y;
  for (let i = 0; i < qty(14); i++) {
    const a = Math.random() * TAU;
    const s = rnd(140, 380);
    emit(SPARK, x, yy, {
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s * 0.8,
      drag: 3,
      life: rnd(180, 320),
      r0: 1.8,
      r1: 0.5,
      rgb: pick([FIRE_W, "255,255,255", STAR]),
      add: true,
    });
  }
  emit(HOT, x, yy, { r0: 22, r1: 8, life: 180, rgb: STAR, add: true, a: 0.9, fin: 0, fout: 0.2 });
  ring(x, yy, { r0: 4, r1: 26, w0: 3, w1: 1, max: 220, rgb: VOLT_L, a: 0.9, sq: 0.8, ground: false });
}

export function spawnDiscCatch2(x: number, y: number) {
  const yy = y + DISC_Y;
  ring(x, y + 6, { r0: 6, r1: 34, w0: 4, w1: 1, max: 280, rgb: STAR, a: 0.8, sq: 0.45 });
  emit(HOT, x, yy, { r0: 24, r1: 8, life: 220, rgb: STAR, add: true, a: 0.85, fin: 0, fout: 0.2 });
  for (let i = 0; i < qty(5); i++) {
    const a = Math.random() * TAU;
    emit(TWINKLE, x + Math.cos(a) * 12, yy + Math.sin(a) * 6, {
      vz: rnd(10, 40),
      life: rnd(240, 420),
      r0: 10,
      r1: 3,
      rgb: STAR,
      add: true,
    });
  }
}

/* ═══════════════════════ 10 · Raio em Cadeia ═══════════════════════ */

function boltPoints(x1: number, y1: number, x2: number, y2: number, disp: number, levels: number): number[] {
  let pts = [x1, y1, x2, y2];
  let d = disp;
  for (let l = 0; l < levels; l++) {
    const next: number[] = [pts[0]!, pts[1]!];
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i]!;
      const ay = pts[i + 1]!;
      const bx = pts[i + 2]!;
      const by = pts[i + 3]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const off = (Math.random() - 0.5) * 2 * d;
      next.push((ax + bx) / 2 - (dy / len) * off, (ay + by) / 2 + (dx / len) * off, bx, by);
    }
    pts = next;
    d *= 0.55;
  }
  return pts;
}

function strokeBolt(ctx: CanvasRenderingContext2D, pts: number[], a: number, scale: number) {
  // halo azul em mistura normal: aparece até em chão claro (o aditivo vira branco)
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = `rgba(52,86,230,${0.32 * a})`;
  ctx.lineWidth = 7 * scale;
  strokeLine(ctx, pts);
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(140,180,255,${0.6 * a})`;
  ctx.lineWidth = 5.5 * scale;
  strokeLine(ctx, pts);
  ctx.strokeStyle = `rgba(255,255,255,${0.95 * a})`;
  ctx.lineWidth = 2.1 * scale;
  strokeLine(ctx, pts);
}

export function spawnBolt2(x1: number, y1: number, x2: number, y2: number, hop = 0) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const disp = Math.min(30, len * 0.16);
  let main: number[] = [];
  let branches: number[][] = [];
  let rebuildAt = -1;
  const rebuild = () => {
    main = boltPoints(x1, y1, x2, y2, disp, 4);
    branches = [];
    const nb = FX2_LITE ? 1 : 2 + ((Math.random() * 2) | 0);
    for (let b = 0; b < nb; b++) {
      const k = 2 * (4 + ((Math.random() * (main.length / 2 - 8)) | 0));
      const bx = main[k]!;
      const by = main[k + 1]!;
      const dir = Math.atan2(y2 - y1, x2 - x1) + (Math.random() < 0.5 ? -1 : 1) * rnd(0.45, 1);
      const bl = len * rnd(0.15, 0.32);
      branches.push(boltPoints(bx, by, bx + Math.cos(dir) * bl, by + Math.sin(dir) * bl, bl * 0.25, 3));
    }
  };
  rebuild();
  const dur = 300 + hop * 40;
  anim({
    layer: 1,
    dur,
    tick: (_dt, age) => {
      if (age >= rebuildAt) {
        rebuild();
        rebuildAt = age + 45;
      }
    },
    draw: (ctx, u) => {
      const a = (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4) * (0.8 + 0.2 * Math.random());
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      strokeBolt(ctx, main, a, 1);
      for (const b of branches) strokeBolt(ctx, b, a * 0.75, 0.55);
    },
  });
  // impacto
  emit(HOT, x2, y2, { r0: 30, r1: 10, life: 280, rgb: VOLT, add: true, a: 0.95, fin: 0, fout: 0.25 });
  ring(x2, y2, { r0: 4, r1: 34, w0: 4, w1: 1, max: 280, rgb: VOLT_L, a: 0.9, sq: 0.7, ground: false });
  for (let i = 0; i < qty(12); i++) {
    const a = Math.random() * TAU;
    const s = rnd(160, 420);
    emit(SPARK, x2, y2, {
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      drag: 3.2,
      life: rnd(160, 320),
      r0: rnd(1.2, 2),
      r1: 0.4,
      rgb: pick([VOLT_L, "255,255,255", VOLT]),
      add: true,
    });
  }
  // arcos rastejando no alvo
  let crawl: number[][] = [];
  let crawlAt = -1;
  anim({
    layer: 1,
    dur: 420,
    tick: (_dt, age) => {
      if (age < crawlAt) return;
      crawlAt = age + 40;
      crawl = [];
      for (let k = 0; k < 2; k++) {
        const a0 = Math.random() * TAU;
        const r = rnd(8, 18);
        const a1 = a0 + rnd(0.8, 1.8);
        crawl.push(
          boltPoints(x2 + Math.cos(a0) * r, y2 + Math.sin(a0) * r, x2 + Math.cos(a1) * r, y2 + Math.sin(a1) * r, 5, 2),
        );
      }
    },
    draw: (ctx, u) => {
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (const c of crawl) strokeBolt(ctx, c, 1 - u, 0.35);
    },
  });
  if (hop === 0) emit(HOT, x1, y1, { r0: 22, r1: 8, life: 220, rgb: VOLT, add: true, a: 0.9, fin: 0, fout: 0.2 });
}

/** Brilho na mão ao conjurar (Bumerangue/Raio). */
export function spawnCastGlint2(x: number, y: number, rgb = VOLT) {
  emit(HOT, x, y, { r0: 18, r1: 6, life: 240, rgb, add: true, a: 0.9, fin: 0, fout: 0.2 });
  emit(TWINKLE, x, y, { life: 300, r0: 16, r1: 6, rgb, add: true });
  for (let i = 0; i < qty(7); i++) {
    const a = Math.random() * TAU;
    const s = rnd(60, 160);
    emit(SPARK, x, y, {
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      drag: 3,
      life: rnd(160, 280),
      r0: 1.4,
      r1: 0.4,
      rgb,
      add: true,
    });
  }
}

export const CAST_RGB_DISC = STAR;
export const CAST_RGB_VOLT = VOLT;

/* ═══════════════════════ 11 · Passo Sombrio ═══════════════════════ */

const silPool: HTMLCanvasElement[] = [];
let silNext = 0;
const SIL_W = 96;
const SIL_H = 112;

function silhouette(look: Look, aim: number): HTMLCanvasElement {
  if (silPool.length < 4) silPool.push(makeCanvas(SIL_W, SIL_H));
  const c = silPool[silNext % silPool.length]!;
  silNext++;
  const g = c.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, SIL_W, SIL_H);
  g.translate(SIL_W / 2, SIL_H - 12);
  drawBody(g, look, { aim, speed: 0, leanX: 0, t: 0, frozen: true, seed: 0 });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-atop";
  const lg = g.createLinearGradient(0, 0, 0, SIL_H);
  lg.addColorStop(0, "rgba(190,140,255,0.95)");
  lg.addColorStop(0.35, "rgba(88,40,160,0.95)");
  lg.addColorStop(1, "rgba(30,10,60,0.95)");
  g.fillStyle = lg;
  g.fillRect(0, 0, SIL_W, SIL_H);
  g.globalCompositeOperation = "source-over";
  return c;
}

export function spawnBlink2(fromX: number, fromY: number, toX: number, toY: number, look: Look | null) {
  const ang = Math.atan2(toY - fromY, toX - fromX);
  const chest = 30 * BODY_K;
  // silhueta que se desfaz em fumaça
  if (look) {
    const img = silhouette(look, ang);
    const seed = (Math.random() * 1e9) | 0;
    anim({
      layer: 1,
      dur: 560,
      draw: (ctx, u) => {
        const slices = 10;
        const sh = SIL_H / slices;
        const dx0 = fromX - SIL_W / 2;
        const dy0 = fromY - (SIL_H - 12);
        for (let i = 0; i < slices; i++) {
          const h = hash01(seed, i);
          const off = (h - 0.5) * 2 * u * 34;
          const rise = u * (10 + h * 16);
          const a = Math.max(0, (1 - u) * (1 - u * h * 1.2)) * 0.9;
          if (a <= 0.01) continue;
          ctx.globalAlpha = a;
          ctx.drawImage(img, 0, i * sh, SIL_W, sh, dx0 + off, dy0 + i * sh - rise, SIL_W, sh);
        }
      },
    });
  }
  // rastro sombrio
  anim({
    layer: 1,
    dur: 340,
    draw: (ctx, u) => {
      const a = 1 - u;
      const x1 = fromX;
      const y1 = fromY - chest;
      const x2 = toX;
      const y2 = toY - chest;
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      const w = 16 * (1 - u * 0.5);
      ctx.fillStyle = `rgba(${SHADOW_D},${0.55 * a})`;
      poly(ctx, [x1, y1, x2 + nx * w, y2 + ny * w, x2 - nx * w, y2 - ny * w]);
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(${SHADOW},${0.6 * a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 + nx * w, y2 + ny * w);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 - nx * w, y2 - ny * w);
      ctx.stroke();
      ctx.strokeStyle = `rgba(240,225,255,${0.7 * a})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    },
  });
  // runas nas duas pontas
  runeFlash(fromX, fromY + 4, SHADOW, 92, 760, -2.2);
  runeFlash(toX, toY + 4, SHADOW, 92, 760, 2.2);
  // fumaça roxa
  for (const [x, y, n] of [
    [fromX, fromY, 8],
    [toX, toY, 6],
  ] as const) {
    for (let i = 0; i < qty(n); i++) {
      const a = Math.random() * TAU;
      emit(SMOKE, x + Math.cos(a) * 8, y + Math.sin(a) * 4, {
        z: rnd(4, 50) * BODY_K * 1.2,
        vx: Math.cos(a) * rnd(20, 70),
        vy: Math.sin(a) * rnd(10, 40),
        vz: rnd(10, 40),
        drag: 1.6,
        life: rnd(500, 900),
        r0: rnd(8, 12),
        r1: rnd(22, 32),
        rgb: pick(["48,22,84", "70,34,120", "34,16,60"]),
        a: 0.6,
        fin: 0.08,
        fout: 0.4,
      });
    }
  }
  // implosão no destino + estouro
  for (let i = 0; i < qty(10); i++) {
    const a = (i / 10) * TAU;
    const r = rnd(36, 54);
    emit(GLOW, toX + Math.cos(a) * r, toY - chest + Math.sin(a) * r * 0.6, {
      vx: -Math.cos(a) * r * 5,
      vy: -Math.sin(a) * r * 3,
      life: 200,
      r0: 6,
      r1: 2,
      rgb: SHADOW,
      add: true,
    });
  }
  emit(HOT, toX, toY - chest, { r0: 34, r1: 10, life: 260, delay: 150, rgb: SHADOW, add: true, a: 0.9, fin: 0, fout: 0.2 });
  ring(toX, toY + 4, { r0: 6, r1: 50, w0: 5, w1: 1, max: 360, delay: 150, rgb: SHADOW, a: 0.9, sq: 0.5 });
  for (let i = 0; i < qty(10); i++) {
    emit(EMBER, fromX + rnd(-14, 14), fromY - rnd(0, 60) * BODY_K, {
      vx: rnd(-20, 20),
      vz: rnd(20, 70),
      drag: 1,
      life: rnd(500, 900),
      r0: rnd(2, 3),
      r1: 1,
      rgb: SHADOW,
      add: true,
    });
  }
}

/* ═══════════════════════ auras contínuas (botas / capa) ═══════════════════════ */

export interface AuraActor {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  boost: boolean;
  dash: boolean;
}

const auraAcc = new Map<number, { boost: number; dash: number; dust: number; dashOn: boolean }>();

/** Chamas nos calcanhares (Botas) e vento rosa (Capa) enquanto ativos. */
export function tickAuras2(actors: readonly AuraActor[], dtMs: number) {
  for (const p of actors) {
    let acc = auraAcc.get(p.id);
    if (!acc) {
      acc = { boost: 0, dash: 0, dust: 0, dashOn: false };
      auraAcc.set(p.id, acc);
    }
    const sp = Math.hypot(p.vx, p.vy);
    const ux = sp > 1 ? p.vx / sp : 0;
    const uy = sp > 1 ? p.vy / sp : 0;
    if (p.boost && sp > 60) {
      acc.boost += dtMs;
      const step = FX2_LITE ? 60 : 26;
      while (acc.boost > step) {
        acc.boost -= step;
        for (const side of [-1, 1]) {
          const fx = p.x + side * 5 * BODY_K * 1.3 - ux * 4;
          const fy = p.y + 6 * BODY_K;
          // jato de chama saindo do calcanhar
          emit(GLOW, fx, fy, {
            z: rnd(2, 6),
            vx: -ux * rnd(90, 190) + rnd(-24, 24),
            vy: -uy * rnd(90, 190) + rnd(-14, 14),
            vz: rnd(10, 46),
            drag: 2.6,
            life: rnd(200, 320),
            r0: rnd(8, 11),
            r1: 2,
            rgb: Math.random() < 0.5 ? FIRE_Y : FIRE_O,
            add: true,
            a: 0.85,
            fin: 0,
            fout: 0.3,
          });
          emit(HOT, fx - ux * 3, fy - uy * 3, { z: 3, life: 90, r0: 9, r1: 6, rgb: FIRE_O, add: true, a: 0.75, fin: 0 });
          // rastro de brasa no chão
          emit(GLOW, fx, fy + 2, {
            ground: true,
            life: 460,
            r0: 7,
            r1: 3,
            rgb: FIRE_O,
            add: true,
            a: 0.5,
            fin: 0,
            fout: 0.15,
          });
        }
        if (Math.random() < 0.55) {
          emit(SPARK, p.x + rnd(-12, 12), p.y - rnd(8, 56) * BODY_K, {
            vx: -ux * rnd(560, 760),
            vy: -uy * rnd(560, 760),
            drag: 6,
            life: rnd(130, 200),
            r0: 1.6,
            r1: 0.5,
            rgb: "255,236,200",
            add: true,
          });
        }
      }
      acc.dust += dtMs;
      if (acc.dust > 110) {
        acc.dust = 0;
        emit(SMOKE, p.x - ux * 10, p.y + 8, {
          z: 1,
          vx: -ux * 30 + rnd(-10, 10),
          vy: -uy * 30,
          vz: rnd(4, 14),
          drag: 2,
          life: rnd(420, 640),
          r0: 5,
          r1: 14,
          rgb: "176,160,140",
          a: 0.35,
          fin: 0.05,
        });
      }
    } else {
      acc.boost = 0;
    }
    if (p.dash) {
      if (!acc.dashOn && sp > 30) spawnDash2(p.x, p.y, Math.atan2(p.vy, p.vx));
      acc.dashOn = true;
      acc.dash += dtMs;
      while (acc.dash > (FX2_LITE ? 40 : 18)) {
        acc.dash -= FX2_LITE ? 40 : 18;
        emit(GLOW, p.x + rnd(-8, 8), p.y, {
          z: rnd(8, 60) * BODY_K,
          vx: -ux * rnd(40, 120),
          vy: -uy * rnd(40, 120),
          drag: 3,
          life: rnd(220, 320),
          r0: rnd(11, 15),
          r1: 3,
          rgb: Math.random() < 0.6 ? PINK : PINK_L,
          add: true,
          a: 0.5,
          fin: 0,
          fout: 0.3,
        });
        emit(SMOKE, p.x, p.y, {
          z: rnd(10, 50) * BODY_K,
          vx: -ux * rnd(20, 60),
          vy: -uy * rnd(20, 60),
          drag: 3,
          life: rnd(260, 380),
          r0: 9,
          r1: 20,
          rgb: pick(["255,130,200", "240,90,170"]),
          a: 0.55,
          fin: 0,
          fout: 0.2,
        });
        if (sp > 60 && Math.random() < 0.6) {
          emit(SPARK, p.x + rnd(-10, 10), p.y - rnd(10, 60) * BODY_K, {
            vx: -ux * rnd(500, 700),
            vy: -uy * rnd(500, 700),
            drag: 7,
            life: rnd(100, 160),
            r0: 1.3,
            r1: 0.4,
            rgb: PINK_L,
            add: true,
          });
        }
      }
    } else {
      acc.dashOn = false;
      acc.dash = 0;
    }
  }
  if (auraAcc.size > 64) auraAcc.clear();
}

/* ═══════════════════════ tick / clear / camadas ═══════════════════════ */

export function tickFx2(dtMs: number, feel?: FeelState) {
  tickFx2Core(dtMs);
  tickRifts2(dtMs);
  for (let i = booms2.length - 1; i >= 0; i--) {
    const b = booms2[i]!;
    b.t -= dtMs;
    if (feel && b.t > b.max * 0.55) feel.shake = Math.max(feel.shake, 3.2 * (b.t / b.max));
    if (b.t <= 0) booms2.splice(i, 1);
  }
}

export function clearFx2() {
  clearFx2Core();
  booms2.length = 0;
  totemBorn2.clear();
  totemLayouts.clear();
  discTrail.clear();
  discTwinkleAt.clear();
  bombSparkAt.clear();
  auraAcc.clear();
}

/** Antes dos personagens (chão). */
export function drawFx2Ground(ctx: CanvasRenderingContext2D, tMs: number) {
  drawRifts2(ctx, tMs);
  drawFx2CoreGround(ctx, tMs);
}

/** Depois dos personagens (ar). */
export function drawFx2Air(ctx: CanvasRenderingContext2D, tMs: number) {
  drawFx2CoreAir(ctx, tMs);
}

