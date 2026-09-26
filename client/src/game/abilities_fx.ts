/**
 * abilities_fx.ts — visual do Jato de Água (ilusão de fluido, 100% client).
 * Flags de degradação: refração → metaballs → partículas.
 */
import { abilityOf, TOTEM_BODY_INNER_R, TOTEM_BODY_OUTER_R, TOTEM_C_HALF_OPEN, TOTEM_RADIUS } from "../../../shared/abilities";
import type { SpikeTotemSnap, TickEvent } from "../../../shared/protocol";
import type { FeelState } from "./render";

/** Desligar se FPS cair (ordem: refração → metaballs). */
export let WATER_METABALLS = true;
/** Off por padrão — o bbox retangular da refração lia como “quadrado azul”. */
export let WATER_REFRACTION = false;
/** Orçamento mobile: menos partículas / totem mais leve. */
export let FX_MOBILE = false;
let MAX_PARTS = 1600;

export function setWaterVisualFlags(opts: { metaballs?: boolean; refraction?: boolean }) {
  if (opts.metaballs != null) WATER_METABALLS = opts.metaballs;
  if (opts.refraction != null) WATER_REFRACTION = opts.refraction;
}

/** Aplica perfil leve (touch/celular) — chama 1× no start. */
export function applyMobileFxBudget(on = true) {
  FX_MOBILE = on;
  if (on) {
    WATER_METABALLS = false;
    WATER_REFRACTION = false;
    MAX_PARTS = 400;
  } else {
    WATER_METABALLS = true;
    MAX_PARTS = 1600;
  }
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
  while (parts.length > MAX_PARTS) parts.shift();
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
  const mul = FX_MOBILE ? 0.35 : 1;
  emit(Math.round(80 * mul), "back", 7, 14, 130, 300, 0.62, COL.back, 1.35);
  emit(Math.round(100 * mul), "mid", 3.5, 8, 210, 420, 0.82, COL.mid, 1.2);
  emit(Math.round(90 * mul), "front", 1.5, 4, 300, 580, 0.9, COL.front, 1.1);
  emit(Math.round(55 * mul), "mid", 2.5, 6, 160, 340, 0.6, COL.mid, 1.75);
  emit(Math.round(40 * mul), "back", 5, 10, 100, 220, 0.45, COL.back, 1.9);

  shocks.push({ x, y, t: 420, max: 420 });
}

/** Splash no alvo + tint molhado. */
export function spawnWaterSplash(x: number, y: number) {
  const n = FX_MOBILE ? 22 : 64;
  for (let i = 0; i < n; i++) {
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

/* ═══════════════════════════════════════════════════════════
 * Congelamento — cristais, bloco, vapor, estilhaço (capricho)
 * ═══════════════════════════════════════════════════════════ */

const ICE = {
  deep: "#3a7aaa",
  mid: "#7ec8e8",
  lite: "#c8ecff",
  edge: "#f0fbff",
  mist: "rgba(220,240,255,0.55)",
};

/** Jato/cone de cristais no cast. */
export function spawnFrostCastFx(x: number, y: number, angle: number) {
  const ox = x - Math.cos(angle) * 6;
  const oy = y - Math.sin(angle) * 6;
  const nMain = FX_MOBILE ? 32 : 88;
  const nSide = FX_MOBILE ? 8 : 22;
  for (let i = 0; i < nMain; i++) {
    const ang = angle + (Math.random() - 0.5) * 1.35;
    const spd = 220 + Math.random() * 520;
    const life = 360 + Math.random() * 520;
    const r = 1.2 + Math.random() * 3.2;
    pushPart({
      x: ox + (Math.random() - 0.5) * 8,
      y: oy + (Math.random() - 0.5) * 8,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 20,
      life,
      max: life,
      r,
      baseR: r,
      color: i % 4 === 0 ? ICE.edge : i % 2 === 0 ? ICE.lite : ICE.mid,
      alpha: 0.88,
      depth: i % 3 === 0 ? "front" : "mid",
      splash: true,
    });
  }
  // estilhaços laterais (formação do cone)
  for (let i = 0; i < nSide; i++) {
    const side = (i % 2 === 0 ? 1 : -1) * (0.55 + Math.random() * 0.5);
    const ang = angle + side;
    const spd = 120 + Math.random() * 220;
    const life = 280 + Math.random() * 260;
    const r = 1.5 + Math.random() * 2.5;
    pushPart({
      x: ox,
      y: oy,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 40,
      life,
      max: life,
      r,
      baseR: r,
      color: ICE.lite,
      alpha: 0.75,
      depth: "front",
      splash: true,
    });
  }
  shocks.push({ x, y, t: 420, max: 420 });
}

/** Impacto no alvo — cristais se formando ao redor. */
export function spawnFrostFreezeFx(x: number, y: number) {
  const n = FX_MOBILE ? 18 : 48;
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 40 + Math.random() * 180;
    const life = 320 + Math.random() * 380;
    const r = 1.5 + Math.random() * 3.5;
    pushPart({
      x: x + Math.cos(ang) * (4 + Math.random() * 10),
      y: y + Math.sin(ang) * (3 + Math.random() * 8) - 8,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 50,
      life,
      max: life,
      r,
      baseR: r,
      color: i % 3 === 0 ? ICE.edge : ICE.mid,
      alpha: 0.9,
      depth: "front",
      splash: true,
    });
  }
  // anel de formação
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const life = 260 + Math.random() * 120;
    pushPart({
      x: x + Math.cos(ang) * 18,
      y: y + Math.sin(ang) * 14 - 10,
      vx: Math.cos(ang) * 30,
      vy: Math.sin(ang) * 20 - 10,
      life,
      max: life,
      r: 2.2,
      baseR: 2.2,
      color: ICE.lite,
      alpha: 0.7,
      depth: "mid",
      splash: true,
    });
  }
}

/** Fim do gelo — bloco racha e cacos caem. */
export function spawnFrostShatterFx(x: number, y: number, scale = 1) {
  const n = Math.round((FX_MOBILE ? 16 : 36) + scale * (FX_MOBILE ? 8 : 18));
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = (70 + Math.random() * 260) * (0.7 + scale * 0.35);
    const life = 380 + Math.random() * 420;
    const r = (1.4 + Math.random() * 4.2) * (0.85 + scale * 0.2);
    pushPart({
      x: x + (Math.random() - 0.5) * 14 * scale,
      y: y + (Math.random() - 0.5) * 18 * scale - 12,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 80 - Math.random() * 120,
      life,
      max: life,
      r,
      baseR: r,
      color: i % 4 === 0 ? ICE.edge : i % 2 === 0 ? ICE.lite : ICE.mid,
      alpha: 0.95,
      depth: "front",
      splash: true,
    });
  }
  // pó frio residual
  for (let i = 0; i < 12; i++) {
    const ang = Math.random() * Math.PI * 2;
    pushPart({
      x,
      y: y - 6,
      vx: Math.cos(ang) * (20 + Math.random() * 50),
      vy: -30 - Math.random() * 60,
      life: 500 + Math.random() * 300,
      max: 700,
      r: 2 + Math.random() * 2,
      baseR: 3,
      color: ICE.mist,
      alpha: 0.5,
      depth: "back",
      splash: true,
    });
  }
}

/** Rastreia freeze→thaw pra disparar shatter (autoritativo via frozenUntil). */
const frostWasFrozen = new Map<string, boolean>();

export function syncFrostShatter(
  entities: readonly { key: string; x: number; y: number; frozen: boolean; scale?: number }[],
  onShatter?: (x: number, y: number) => void,
  /** estilhaço alternativo (visual novo) por entidade; null = antigo */
  pick?: (key: string) => ((x: number, y: number, scale: number) => void) | null,
) {
  const live = new Set<string>();
  for (const e of entities) {
    live.add(e.key);
    const was = frostWasFrozen.get(e.key) ?? false;
    if (was && !e.frozen) {
      const alt = pick?.(e.key);
      if (alt) alt(e.x, e.y, e.scale ?? 1);
      else spawnFrostShatterFx(e.x, e.y, e.scale ?? 1);
      onShatter?.(e.x, e.y);
    }
    frostWasFrozen.set(e.key, e.frozen);
  }
  for (const k of [...frostWasFrozen.keys()]) {
    if (!live.has(k)) frostWasFrozen.delete(k);
  }
}

/**
 * Bloco/cristal de gelo semi-transparente envolvendo o alvo.
 * `scale` ~1 player, ~1.6 brute, ~2.4 Gigante.
 */
export function drawFrostBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tMs: number,
  scale = 1,
  seed = 0,
) {
  const s = scale;
  const pulse = 0.92 + 0.08 * Math.sin(tMs * 0.006 + seed);
  ctx.save();
  ctx.translate(x, y - 10 * s);

  // sombra fria no chão
  ctx.fillStyle = `rgba(40,90,130,${0.22 * pulse})`;
  ctx.beginPath();
  ctx.ellipse(0, 22 * s, 22 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // corpo facetado (hexágono irregular)
  const verts: { x: number; y: number }[] = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + Math.sin(seed * 1.7 + i) * 0.08;
    const rx = (18 + (i % 2) * 3.5 + Math.sin(seed + i * 2.1) * 1.5) * s;
    const ry = (26 + (i % 3) * 2.2 + Math.cos(seed * 0.9 + i) * 1.2) * s;
    verts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry - 4 * s });
  }

  // fill azul-claro
  ctx.beginPath();
  ctx.moveTo(verts[0]!.x, verts[0]!.y);
  for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i]!.x, verts[i]!.y);
  ctx.closePath();
  ctx.fillStyle = `rgba(168,216,240,${0.52 * pulse})`;
  ctx.fill();

  // camada interna mais clara (cristal)
  ctx.beginPath();
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]!;
    const px = v.x * 0.62;
    const py = v.y * 0.62;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = `rgba(210,240,255,${0.28 * pulse})`;
  ctx.fill();

  // arestas brancas
  ctx.strokeStyle = `rgba(240,251,255,${0.85 * pulse})`;
  ctx.lineWidth = 1.6 + 0.4 * s;
  ctx.beginPath();
  ctx.moveTo(verts[0]!.x, verts[0]!.y);
  for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i]!.x, verts[i]!.y);
  ctx.closePath();
  ctx.stroke();

  // faces internas (linhas de faceta)
  ctx.strokeStyle = `rgba(255,255,255,${0.35 * pulse})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(verts[0]!.x * 0.15, verts[0]!.y * 0.15);
  ctx.lineTo(verts[2]!.x * 0.85, verts[2]!.y * 0.85);
  ctx.moveTo(verts[1]!.x * 0.2, verts[1]!.y * 0.2);
  ctx.lineTo(verts[4]!.x * 0.8, verts[4]!.y * 0.8);
  ctx.stroke();

  // highlights diagonais (brilho de gelo)
  const gleam = 0.45 + 0.35 * Math.sin(tMs * 0.008 + seed);
  ctx.strokeStyle = `rgba(255,255,255,${gleam})`;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-10 * s, -18 * s);
  ctx.lineTo(4 * s, 8 * s);
  ctx.moveTo(-4 * s, -22 * s);
  ctx.lineTo(12 * s, 2 * s);
  ctx.stroke();

  // vapor frio subindo na base
  for (let i = 0; i < 3; i++) {
    const ph = tMs * 0.0035 + seed * 0.7 + i * 2.1;
    const vx = Math.sin(ph) * 10 * s + (i - 1) * 7 * s;
    const vy = 14 * s - ((ph * 18) % (28 * s));
    const a = 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(ph * 1.3));
    ctx.fillStyle = `rgba(230,245,255,${a})`;
    ctx.beginPath();
    ctx.ellipse(vx, vy, (3.5 + i) * s * 0.55, (5 + i * 0.8) * s * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function processAbilityEvents(
  events: TickEvent[],
  feel: FeelState,
  selfId: number,
  onWhoosh?: (x: number, y: number) => void,
  onSplash?: (x: number, y: number) => void,
  /** true = visual novo (fx2) cuida das partículas; aqui só tremor/som */
  skipFx = false,
) {
  for (const e of events) {
    if (e.kind !== "ability") continue;
    const abilityId = e.b;
    const angle = e.angle ?? 0;
    if (abilityId === 0) {
      if (!skipFx) spawnWaterJetFx(e.x, e.y, angle);
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
    // Botas: whoosh no cast (próprio já toca na predição)
    if (abilityId === 2) {
      if (e.a !== selfId) onWhoosh?.(e.x, e.y);
      if (e.a === selfId) {
        feel.bodyKick = Math.max(feel.bodyKick, 0.3);
      }
    }
    // Capa de Recuo
    if (abilityId === 3) {
      if (e.a !== selfId) onWhoosh?.(e.x, e.y);
      if (e.a === selfId) {
        feel.bodyKick = Math.max(feel.bodyKick, 0.5);
        feel.shake = Math.max(feel.shake, 0.7);
      }
    }
    // Capa-Escudo
    if (abilityId === 4) {
      if (e.a !== selfId) onWhoosh?.(e.x, e.y);
      if (e.a === selfId) {
        feel.bodyKick = Math.max(feel.bodyKick, 0.25);
      }
    }
    // Fenda Sísmica — pisão telegrafa
    if (abilityId === 5) {
      if (!skipFx) spawnRiftStompFx(e.x, e.y);
      if (e.a === selfId) {
        feel.bodyKick = Math.max(feel.bodyKick, 0.65);
        feel.shake = Math.max(feel.shake, 1.1);
      } else {
        feel.shake = Math.max(feel.shake, 0.55);
      }
      onWhoosh?.(e.x, e.y);
    }
    // Bomba Devastadora — solta a bomba (FX leve; detonação vem do explode.b=1)
    if (abilityId === 6) {
      if (!skipFx) spawnBombDropFx(e.x, e.y);
      if (e.a === selfId) {
        feel.bodyKick = Math.max(feel.bodyKick, 0.35);
        feel.shake = Math.max(feel.shake, 0.45);
      }
      onWhoosh?.(e.x, e.y);
    }
    // Totem de Espinhos — plantio (entidade vem do snap)
    if (abilityId === 7) {
      if (e.a === selfId) {
        feel.bodyKick = Math.max(feel.bodyKick, 0.3);
        feel.shake = Math.max(feel.shake, 0.4);
      }
      onWhoosh?.(e.x, e.y);
    }
    // Congelamento — cone de cristais
    if (abilityId === 8) {
      if (!skipFx) spawnFrostCastFx(e.x, e.y, angle);
      if (e.a === selfId) {
        feel.bodyKick = Math.max(feel.bodyKick, 0.45);
        feel.shake = Math.max(feel.shake, 0.55);
      }
      onWhoosh?.(e.x, e.y);
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
  for (let i = 0; i < 28; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 180 + Math.random() * 260;
    const life = 200 + Math.random() * 200;
    const r = 2 + Math.random() * 3;
    pushPart({
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life,
      max: life,
      r,
      baseR: r,
      color: i % 3 === 0 ? "#ff6040" : "#e8c070",
      alpha: 0.9,
      depth: "front",
      splash: true,
    });
  }
  // poeira pesada no impacto
  for (let i = 0; i < 8; i++) {
    const ang = Math.random() * Math.PI * 2;
    pushPart({
      x: x + Math.cos(ang) * 8,
      y: y + Math.sin(ang) * 6,
      vx: Math.cos(ang) * (40 + Math.random() * 60),
      vy: Math.sin(ang) * (30 + Math.random() * 40) - 20,
      life: 320,
      max: 320,
      r: 3,
      baseR: 3,
      color: "#6a5040",
      alpha: 0.75,
      depth: "mid",
      splash: false,
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

export function tickAbilityFx(dtMs: number, feel?: FeelState) {
  const dt = dtMs / 1000;
  fxTime += dtMs;
  if (feel) tickRiftFx(dtMs, feel);
  tickBigBoomFx(dtMs, feel);
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
  while (parts.length > MAX_PARTS) parts.shift();

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
  for (let i = totemHolos.length - 1; i >= 0; i--) {
    totemHolos[i]!.age += dtMs;
    if (totemHolos[i]!.age >= totemHolos[i]!.dur) totemHolos.splice(i, 1);
  }
}

/** Camada de chão: onda de choque + poças + fendas (antes dos personagens). */
export function drawAbilityGround(ctx: CanvasRenderingContext2D) {
  drawBurnCraters(ctx);
  drawRiftScars(ctx);
  drawRiftsGround(ctx);
  drawBigBoomGround(ctx);

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

  // bola de fogo da Bomba Devastadora por cima
  drawBigBoomAir(ctx);
}

/** @deprecated use drawAbilityGround + drawAbilityWater */
export function drawAbilityFx(ctx: CanvasRenderingContext2D) {
  drawAbilityGround(ctx);
  drawAbilityWater(ctx);
}

/** performance.now() em que cada totem nasceu (queda → espinhos). */
const totemBornAt = new Map<number, number>();
/** Ângulo do C por id — pra dissolve holográfico no expire. */
const totemAngleAt = new Map<number, number>();
/** Queda do céu até o chão. */
const TOTEM_FALL_MS = 380;
/** Depois da queda: espinhos abrem e travam. */
const TOTEM_SPIKE_MS = 420;
/** Dissolve holográfico ao expirar (estilo construto do anel). */
const TOTEM_HOLO_MS = 780;

interface TotemHoloDissolve {
  x: number;
  y: number;
  angle: number;
  age: number;
  dur: number;
  seed: number;
}
const totemHolos: TotemHoloDissolve[] = [];

export function clearAbilityFx() {
  parts.length = 0;
  shocks.length = 0;
  puddles.length = 0;
  tints.length = 0;
  rifts.length = 0;
  riftScars.length = 0;
  sinks.length = 0;
  bigBooms.length = 0;
  burnCraters.length = 0;
  totemBornAt.clear();
  totemAngleAt.clear();
  totemHolos.length = 0;
  frostWasFrozen.clear();
}

/* ═══════════════════════════════════════════════════════════
 * Fenda Sísmica — rachadura em ziguezague + buraco (capricho)
 * ═══════════════════════════════════════════════════════════ */

export interface RiftFx {
  /** visual novo (fx2 desenha; aqui só a lógica do buraco/queda) */
  v2?: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  travelMs: number;
  age: number;
  seed: number;
  locked: boolean;
  /** pontos do ziguezague (mundo) */
  pts: { x: number; y: number }[];
  holeOpen: boolean;
  holeT: number;
  collapsed: boolean;
}

export interface RiftScar {
  v2?: boolean;
  pts: { x: number; y: number }[];
  x1: number;
  y1: number;
  life: number;
  max: number;
}

const rifts: RiftFx[] = [];
const riftScars: RiftScar[] = [];

/** Estado das fendas para o visual novo (fx2) — só leitura. */
export function riftsForFx2(): readonly RiftFx[] {
  return rifts;
}
export function riftScarsForFx2(): readonly RiftScar[] {
  return riftScars;
}
const MAX_RIFTS = 8;
const MAX_SCARS = 24;

function riftHash(seed: number, i: number): number {
  let n = (seed ^ (i * 374761393) ^ 668265263) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function buildZigzag(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  seed: number,
): { x: number; y: number }[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const px = -uy;
  const py = ux;
  const segs = Math.max(8, Math.min(14, Math.round(dist / 48)));
  const pts: { x: number; y: number }[] = [{ x: x0, y: y0 }];
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const amp = (6 + riftHash(seed, i) * 12) * (i % 2 === 0 ? 1 : -1);
    const jitter = (riftHash(seed, i + 40) - 0.5) * 6;
    pts.push({
      x: x0 + dx * t + px * (amp + jitter),
      y: y0 + dy * t + py * (amp + jitter),
    });
  }
  pts.push({ x: x1, y: y1 });
  return pts;
}

/** Pisão inicial — onda de terra sob os pés. */
export function spawnRiftStompFx(x: number, y: number) {
  shocks.push({ x, y, t: 280, max: 280 });
  for (let i = 0; i < 18; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 50 + Math.random() * 140;
    const life = 220 + Math.random() * 200;
    const r = 1.5 + Math.random() * 2.5;
    pushPart({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 8,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 40,
      life,
      max: life,
      r,
      baseR: r,
      color: i % 2 === 0 ? "#6a4a28" : "#3a2818",
      alpha: 0.85,
      depth: "mid",
      splash: true,
    });
  }
}

/** Dispara a rachadura a partir do evento `rift` do host. */
export function spawnRiftFx(
  e: TickEvent,
  feel: FeelState,
  onCrack?: (x: number, y: number) => void,
  v2 = false,
) {
  const x0 = e.x;
  const y0 = e.y;
  const x1 = e.x2 ?? e.x + Math.cos(e.angle ?? 0) * 200;
  const y1 = e.y2 ?? e.y + Math.sin(e.angle ?? 0) * 200;
  const travelMs = Math.max(120, Math.min(800, e.weaponId ?? 400));
  const seed = ((e.a * 131 + Math.round(x0) * 17 + Math.round(y0) * 31) >>> 0) || 1;
  const fx: RiftFx = {
    v2,
    x0,
    y0,
    x1,
    y1,
    travelMs,
    age: 0,
    seed,
    locked: (e.b & 1) === 1,
    pts: buildZigzag(x0, y0, x1, y1, seed),
    holeOpen: false,
    holeT: 0,
    collapsed: false,
  };
  rifts.push(fx);
  while (rifts.length > MAX_RIFTS) rifts.shift();
  feel.shake = Math.max(feel.shake, 0.9);
  onCrack?.(x0, y0);
}

/** Pose do boneco caindo no buraco (client-only). */
export interface RiftSinkPose {
  x: number;
  y: number;
  rot: number;
  scale: number;
  squashY: number;
  alpha: number;
  t: number;
  hx: number;
  hy: number;
  holeRx: number;
  holeRy: number;
  clip: boolean;
}

interface RiftSink {
  id: number;
  /** player = bot/humano; enemy = zumbi/chefe/Gigante */
  kind: "player" | "enemy";
  /** tipo do inimigo (0 zumbi, 1 chefe, 2 gigante) — p/ desenhar sem snapshot */
  enemyType: number;
  hx: number;
  hy: number;
  x0: number;
  y0: number;
  age: number;
  dur: number;
}

const sinks: RiftSink[] = [];

function nearestOpenHole(x: number, y: number): { hx: number; hy: number } {
  let best = { hx: x, hy: y };
  let bestD = Infinity;
  for (const fx of rifts) {
    if (!fx.holeOpen && fx.age < fx.travelMs) {
      // rachadura ainda chegando — usa o fim previsto
      const d = Math.hypot(fx.x1 - x, fx.y1 - y);
      if (d < bestD) {
        bestD = d;
        best = { hx: fx.x1, hy: fx.y1 };
      }
      continue;
    }
    if (!fx.holeOpen) continue;
    const d = Math.hypot(fx.x1 - x, fx.y1 - y);
    if (d < bestD) {
      bestD = d;
      best = { hx: fx.x1, hy: fx.y1 };
    }
  }
  for (const s of riftScars) {
    const d = Math.hypot(s.x1 - x, s.y1 - y);
    if (d < bestD && d < 120) {
      bestD = d;
      best = { hx: s.x1, hy: s.y1 };
    }
  }
  return best;
}

/**
 * Inicia a animação caindo no buraco (morte por Fenda).
 * `kind: "player"` = bot/humano; `"enemy"` = zumbi/chefe/Gigante.
 */
export function beginRiftSink(
  victimId: number,
  x: number,
  y: number,
  feel: FeelState,
  kind: "player" | "enemy" = "player",
  enemyType = 0,
) {
  const hole = nearestOpenHole(x, y);
  for (let i = sinks.length - 1; i >= 0; i--) {
    if (sinks[i]!.id === victimId && sinks[i]!.kind === kind) sinks.splice(i, 1);
  }
  sinks.push({
    id: victimId,
    kind,
    enemyType,
    hx: hole.hx,
    hy: hole.hy,
    x0: x,
    y0: y,
    age: 0,
    dur: kind === "enemy" ? 1100 : 980,
  });
  for (let i = 0; i < 22; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 30 + Math.random() * 90;
    const life = 400 + Math.random() * 350;
    const r = 2 + Math.random() * 3;
    pushPart({
      x: hole.hx,
      y: hole.hy,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 10,
      life,
      max: life,
      r,
      baseR: r,
      color: i % 3 === 0 ? "#c06030" : "#2a1810",
      alpha: 0.9,
      depth: "front",
      splash: true,
    });
  }
  feel.shake = Math.max(feel.shake, 2.4);
  feel.bodyKick = Math.max(feel.bodyKick, 0.4);
}

/** @deprecated use beginRiftSink */
export function spawnRiftSinkFx(x: number, y: number, feel: FeelState) {
  beginRiftSink(-1, x, y, feel, "player");
}

export function tickRiftSinks(dtMs: number) {
  for (let i = sinks.length - 1; i >= 0; i--) {
    sinks[i]!.age += dtMs;
    if (sinks[i]!.age >= sinks[i]!.dur + 80) sinks.splice(i, 1);
  }
}

export function isRiftSinking(
  id: number,
  kind: "player" | "enemy" = "player",
): boolean {
  return sinks.some((s) => s.id === id && s.kind === kind);
}

/** Já sumiu no buraco — não desenhar. */
export function riftSinkHidden(
  id: number,
  kind: "player" | "enemy" = "player",
): boolean {
  const s = sinks.find((x) => x.id === id && x.kind === kind);
  if (!s) return false;
  return s.age / s.dur >= 0.92;
}

/** Sinks de inimigos ativos (mesmo se já saíram do snapshot). */
export function listEnemyRiftSinks(): {
  id: number;
  enemyType: number;
  pose: RiftSinkPose;
}[] {
  const out: { id: number; enemyType: number; pose: RiftSinkPose }[] = [];
  for (const s of sinks) {
    if (s.kind !== "enemy") continue;
    const pose = riftSinkPose(s.id, "enemy");
    if (!pose || riftSinkHidden(s.id, "enemy")) continue;
    out.push({ id: s.id, enemyType: s.enemyType, pose });
  }
  return out;
}

export function riftSinkPose(
  id: number,
  kind: "player" | "enemy" = "player",
): RiftSinkPose | null {
  const s = sinks.find((x) => x.id === id && x.kind === kind);
  if (!s) return null;
  const t = Math.min(1, s.age / s.dur);
  // ease-in: acelera a queda
  const ease = t * t * (3 - 2 * t);
  const pull = Math.pow(t, 0.65);
  const x = s.x0 + (s.hx - s.x0) * pull;
  const y = s.y0 + (s.hy - s.y0) * pull + ease * 36;
  const rot = t * Math.PI * 2.6;
  const scale = Math.max(0.08, 1 - t * 0.92);
  const squashY = Math.max(0.2, 1 - t * 0.55);
  const alpha = Math.max(0, 1 - Math.pow(t, 1.35));
  const holeRx = 48 + 36 * Math.min(1, t + 0.3);
  const holeRy = holeRx * 0.58;
  return {
    x,
    y,
    rot,
    scale,
    squashY,
    alpha,
    t,
    hx: s.hx,
    hy: s.hy,
    holeRx,
    holeRy,
    clip: t > 0.28,
  };
}

function emitRiftDebris(fx: RiftFx, progress: number) {
  const idx = Math.min(fx.pts.length - 1, Math.floor(progress * (fx.pts.length - 1)));
  const p = fx.pts[idx]!;
  for (let i = 0; i < 3; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 40 + Math.random() * 120;
    const life = 180 + Math.random() * 160;
    const r = 1.2 + Math.random() * 2;
    pushPart({
      x: p.x,
      y: p.y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 50,
      life,
      max: life,
      r,
      baseR: r,
      color: "#5a3a20",
      alpha: 0.75,
      depth: "mid",
      splash: true,
    });
  }
}

export function tickRiftFx(dtMs: number, feel: FeelState) {
  tickRiftSinks(dtMs);
  for (let i = rifts.length - 1; i >= 0; i--) {
    const fx = rifts[i]!;
    fx.age += dtMs;
    const travelU = Math.min(1, fx.age / fx.travelMs);

    // tremor crescente enquanto a rachadura corre
    if (travelU < 1) {
      feel.shake = Math.max(feel.shake, 0.7 + travelU * 1.6);
      if (!fx.v2 && Math.floor(fx.age / 40) !== Math.floor((fx.age - dtMs) / 40)) {
        emitRiftDebris(fx, travelU);
      }
    }

    if (!fx.holeOpen && travelU >= 1) {
      fx.holeOpen = true;
      fx.holeT = 0;
      feel.shake = Math.max(feel.shake, 2.8);
      if (!fx.v2) shocks.push({ x: fx.x1, y: fx.y1, t: 420, max: 420 });
      for (let k = 0; k < (fx.v2 ? 0 : 28); k++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 80 + Math.random() * 220;
        const life = 320 + Math.random() * 280;
        const r = 2 + Math.random() * 3.5;
        pushPart({
          x: fx.x1,
          y: fx.y1,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 80,
          life,
          max: life,
          r,
          baseR: r,
          color: k % 2 === 0 ? "#e07030" : "#4a3020",
          alpha: 0.95,
          depth: "front",
          splash: true,
        });
      }
      // cicatriz permanente no chão
      riftScars.push({
        v2: fx.v2,
        pts: fx.pts.map((p) => ({ ...p })),
        x1: fx.x1,
        y1: fx.y1,
        life: 45000,
        max: 45000,
      });
      while (riftScars.length > MAX_SCARS) riftScars.shift();
    }

    if (fx.holeOpen) {
      fx.holeT += dtMs;
      // fica aberto ~5.5s, depois encolhe ~1.2s (fica o scar)
      if (fx.holeT > 6700) {
        fx.collapsed = true;
        rifts.splice(i, 1);
      }
    }
  }

  for (let i = riftScars.length - 1; i >= 0; i--) {
    riftScars[i]!.life -= dtMs;
    if (riftScars[i]!.life <= 0) riftScars.splice(i, 1);
  }
}

function strokeZigzag(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  until: number,
) {
  if (pts.length < 2 || until <= 0) return;
  const maxLen = pts.length - 1;
  const end = Math.min(maxLen, until * maxLen);
  const whole = Math.floor(end);
  const frac = end - whole;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i <= whole; i++) {
    ctx.lineTo(pts[i]!.x, pts[i]!.y);
  }
  if (frac > 0 && whole < maxLen) {
    const a = pts[whole]!;
    const b = pts[whole + 1]!;
    ctx.lineTo(a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac);
  }
  ctx.stroke();
}

function drawRiftScars(ctx: CanvasRenderingContext2D) {
  for (const s of riftScars) {
    if (s.v2) continue;
    const a = 0.55 * Math.min(1, s.life / 8000);
    ctx.strokeStyle = `rgba(18, 12, 8, ${a})`;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokeZigzag(ctx, s.pts, 1);
    ctx.strokeStyle = `rgba(40, 28, 16, ${a * 0.7})`;
    ctx.lineWidth = 2.2;
    strokeZigzag(ctx, s.pts, 1);
    // buraco residual
    const hr = 22 + 14 * (s.life / s.max);
    ctx.fillStyle = `rgba(8, 6, 4, ${a * 0.85})`;
    ctx.beginPath();
    ctx.ellipse(s.x1, s.y1, hr, hr * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRiftsGround(ctx: CanvasRenderingContext2D) {
  for (const fx of rifts) {
    if (fx.v2) continue;
    const travelU = Math.min(1, fx.age / fx.travelMs);
    const pulse = 0.55 + 0.45 * Math.sin(fx.age * 0.03);

    // borda de terra levantada
    ctx.strokeStyle = `rgba(90, 60, 30, ${0.75 * travelU})`;
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokeZigzag(ctx, fx.pts, travelU);

    // fenda escura
    ctx.strokeStyle = `rgba(12, 8, 6, ${0.92})`;
    ctx.lineWidth = 4.5;
    strokeZigzag(ctx, fx.pts, travelU);

    // brilho magma interno
    ctx.strokeStyle = `rgba(255, 110, 40, ${0.35 * pulse * travelU})`;
    ctx.lineWidth = 2;
    strokeZigzag(ctx, fx.pts, travelU);
    ctx.strokeStyle = `rgba(255, 200, 80, ${0.2 * pulse * travelU})`;
    ctx.lineWidth = 1;
    strokeZigzag(ctx, fx.pts, travelU);

    if (fx.holeOpen) {
      const t = Math.min(1, fx.holeT / 220);
      const shrink =
        fx.holeT > 5500 ? Math.max(0.15, 1 - (fx.holeT - 5500) / 1200) : 1;
      const rx = (48 + 36 * t) * shrink;
      const ry = rx * 0.58;
      // borda de terra
      ctx.fillStyle = `rgba(70, 45, 22, ${0.85 * shrink})`;
      ctx.beginPath();
      ctx.ellipse(fx.x1, fx.y1, rx + 12, ry + 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // buraco
      const g = ctx.createRadialGradient(fx.x1, fx.y1, 4, fx.x1, fx.y1, rx);
      g.addColorStop(0, `rgba(40, 12, 4, ${0.95 * shrink})`);
      g.addColorStop(0.45, `rgba(10, 6, 4, ${0.98 * shrink})`);
      g.addColorStop(1, `rgba(0, 0, 0, ${0.9 * shrink})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(fx.x1, fx.y1, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // magma no fundo
      ctx.fillStyle = `rgba(255, 90, 30, ${0.4 * pulse * shrink})`;
      ctx.beginPath();
      ctx.ellipse(fx.x1, fx.y1 + 4, rx * 0.4, ry * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Processa eventos `rift` do snapshot. */
export function processRiftEvents(
  events: TickEvent[],
  feel: FeelState,
  onCrack?: (x: number, y: number) => void,
  onSlam?: (x: number, y: number) => void,
  v2 = false,
) {
  for (const e of events) {
    if (e.kind !== "rift") continue;
    spawnRiftFx(e, feel, onCrack, v2);
    // slam agendado no tick quando o buraco abre — marca via callback leve
    void onSlam;
  }
}

/* ═══════════════════════════════════════════════════════════
 * Bomba Devastadora — explosão massiva (capricho)
 * ═══════════════════════════════════════════════════════════ */

interface BigBoomFx {
  x: number;
  y: number;
  t: number;
  max: number;
  seed: number;
}

interface BurnCrater {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  seed: number;
}

const bigBooms: BigBoomFx[] = [];
const burnCraters: BurnCrater[] = [];
const MAX_BOOMS = 4;
const MAX_CRATERS = 12;

function boomHash(seed: number, i: number): number {
  const n = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/** Partículas ao soltar a bomba (pavio aceso). */
export function spawnBombDropFx(x: number, y: number) {
  for (let i = 0; i < 10; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 20 + Math.random() * 50;
    const life = 180 + Math.random() * 160;
    pushPart({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 40,
      life,
      max: life,
      r: 1.5 + Math.random() * 2,
      baseR: 1.5 + Math.random() * 2,
      color: i % 2 === 0 ? "#ffaa40" : "#3a2a20",
      alpha: 0.85,
      depth: "front",
      splash: true,
    });
  }
  shocks.push({ x, y, t: 220, max: 220 });
  while (shocks.length > 40) shocks.shift();
}

/**
 * Explosão massiva a partir de `explode` com b=1.
 * Flash / shake / som ficam no loop; aqui é a bola de fogo + onda + cratera.
 */
export function spawnBigBoomFx(x: number, y: number, feel: FeelState) {
  const seed = ((x * 17) ^ (y * 31) ^ (performance.now() | 0)) >>> 0;
  bigBooms.push({ x, y, t: 900, max: 900, seed });
  while (bigBooms.length > MAX_BOOMS) bigBooms.shift();

  burnCraters.push({
    x,
    y,
    r: 118,
    life: 14000,
    max: 14000,
    seed,
  });
  while (burnCraters.length > MAX_CRATERS) burnCraters.shift();

  // onda de choque (reusa shocks do chão — elipse grande)
  shocks.push({ x, y, t: 520, max: 520 });
  while (shocks.length > 40) shocks.shift();

  // detritos / brasas / fumaça
  for (let i = 0; i < 52; i++) {
    const ang = (i / 52) * Math.PI * 2 + boomHash(seed, i) * 0.4;
    const spd = 90 + boomHash(seed, i + 3) * 280;
    const life = 420 + boomHash(seed, i + 7) * 520;
    const hot = boomHash(seed, i + 11) > 0.45;
    pushPart({
      x: x + Math.cos(ang) * 8,
      y: y + Math.sin(ang) * 8,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 30 - boomHash(seed, i + 13) * 80,
      life,
      max: life,
      r: hot ? 2.5 + boomHash(seed, i) * 4 : 3 + boomHash(seed, i) * 5,
      baseR: hot ? 3 : 4,
      color: hot
        ? boomHash(seed, i + 17) > 0.5
          ? "#ffe8a0"
          : "#ff6a20"
        : boomHash(seed, i + 19) > 0.5
          ? "#2a2218"
          : "#4a3a28",
      alpha: hot ? 0.95 : 0.7,
      depth: hot ? "front" : "back",
      splash: true,
    });
  }

  feel.shake = Math.max(feel.shake, 9.5);
  feel.bodyKick = Math.max(feel.bodyKick, 0.85);
}

export function tickBigBoomFx(dtMs: number, feel?: FeelState) {
  for (let i = bigBooms.length - 1; i >= 0; i--) {
    const b = bigBooms[i]!;
    b.t -= dtMs;
    if (feel && b.t > b.max * 0.55) {
      // tremor residual curto no início
      feel.shake = Math.max(feel.shake, 3.2 * (b.t / b.max));
    }
    if (b.t <= 0) bigBooms.splice(i, 1);
  }
  for (let i = burnCraters.length - 1; i >= 0; i--) {
    burnCraters[i]!.life -= dtMs;
    if (burnCraters[i]!.life <= 0) burnCraters.splice(i, 1);
  }
}

function drawBurnCraters(ctx: CanvasRenderingContext2D) {
  for (const c of burnCraters) {
    const u = c.life / c.max;
    const fade = Math.min(1, u * 1.4);
    const rx = c.r;
    const ry = c.r * 0.55;
    // solo carbonizado
    const g = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, rx);
    g.addColorStop(0, `rgba(18, 10, 6, ${0.78 * fade})`);
    g.addColorStop(0.45, `rgba(40, 22, 12, ${0.55 * fade})`);
    g.addColorStop(0.78, `rgba(70, 40, 18, ${0.28 * fade})`);
    g.addColorStop(1, `rgba(50, 30, 14, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + 4, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // anel scorched irregular
    ctx.strokeStyle = `rgba(20, 10, 6, ${0.55 * fade})`;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const jig = 0.88 + boomHash(c.seed, i) * 0.22;
      const px = c.x + Math.cos(a) * rx * jig;
      const py = c.y + 4 + Math.sin(a) * ry * jig;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    // brasas residuais
    for (let i = 0; i < 7; i++) {
      const a = boomHash(c.seed, i + 40) * Math.PI * 2;
      const d = 0.25 + boomHash(c.seed, i + 50) * 0.55;
      const px = c.x + Math.cos(a) * rx * d;
      const py = c.y + 4 + Math.sin(a) * ry * d;
      const pulse = 0.35 + 0.65 * Math.sin(fxTime * 0.012 + i);
      ctx.fillStyle = `rgba(255, 110, 30, ${0.22 * fade * pulse})`;
      ctx.beginPath();
      ctx.arc(px, py, 2 + boomHash(c.seed, i) * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBigBoomGround(ctx: CanvasRenderingContext2D) {
  for (const b of bigBooms) {
    const u = 1 - b.t / b.max;
    // onda de choque no chão (anel rápido)
    if (u < 0.55) {
      const wu = u / 0.55;
      const rr = 40 + wu * 280;
      const a = 0.55 * (1 - wu);
      ctx.strokeStyle = `rgba(255, 220, 160, ${a})`;
      ctx.lineWidth = Math.max(1.2, 10 * (1 - wu));
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + 6, rr, rr * 0.48, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(40, 20, 10, ${a * 0.7})`;
      ctx.lineWidth = Math.max(1, 4 * (1 - wu));
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + 6, rr * 0.92, rr * 0.44, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** Camada aérea da bola de fogo (chama após personagens / água). */
export function drawBigBoomAir(ctx: CanvasRenderingContext2D) {
  for (const b of bigBooms) {
    const u = 1 - b.t / b.max;
    // expansão rápida → fumaça
    const grow = u < 0.35 ? u / 0.35 : 1;
    const fade = u < 0.45 ? 1 : 1 - (u - 0.45) / 0.55;
    const R = 28 + grow * 150;

    // fumaça externa
    const smokeA = 0.45 * fade * Math.min(1, u * 2.2);
    const sg = ctx.createRadialGradient(b.x, b.y, R * 0.2, b.x, b.y, R * 1.15);
    sg.addColorStop(0, `rgba(40, 28, 20, ${smokeA * 0.35})`);
    sg.addColorStop(0.55, `rgba(20, 14, 10, ${smokeA * 0.55})`);
    sg.addColorStop(1, `rgba(10, 8, 6, 0)`);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, R * 1.1, R * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();

    // laranja
    const og = ctx.createRadialGradient(b.x - 8, b.y - 10, 4, b.x, b.y, R * 0.85);
    og.addColorStop(0, `rgba(255, 160, 40, ${0.75 * fade})`);
    og.addColorStop(0.45, `rgba(220, 70, 20, ${0.55 * fade})`);
    og.addColorStop(1, `rgba(80, 20, 8, 0)`);
    ctx.fillStyle = og;
    ctx.beginPath();
    ctx.arc(b.x, b.y, R * 0.85, 0, Math.PI * 2);
    ctx.fill();

    // núcleo branco-quente
    const coreR = R * (0.22 + 0.18 * (1 - Math.min(1, u * 2)));
    const cg = ctx.createRadialGradient(b.x - 4, b.y - 6, 1, b.x, b.y, coreR);
    cg.addColorStop(0, `rgba(255, 255, 240, ${0.95 * fade})`);
    cg.addColorStop(0.35, `rgba(255, 220, 120, ${0.7 * fade})`);
    cg.addColorStop(1, `rgba(255, 120, 40, 0)`);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(b.x, b.y, coreR, 0, Math.PI * 2);
    ctx.fill();

    // línguas de fogo irregulares
    if (u < 0.5) {
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2 + boomHash(b.seed, i) * 0.5;
        const len = R * (0.55 + boomHash(b.seed, i + 2) * 0.45) * grow;
        const tipX = b.x + Math.cos(a0) * len;
        const tipY = b.y + Math.sin(a0) * len * 0.9;
        ctx.strokeStyle = `rgba(255, ${140 + boomHash(b.seed, i + 4) * 80 | 0}, 40, ${0.55 * fade})`;
        ctx.lineWidth = 3 + boomHash(b.seed, i + 5) * 4;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.quadraticCurveTo(
          b.x + Math.cos(a0 + 0.4) * len * 0.45,
          b.y + Math.sin(a0 + 0.4) * len * 0.45,
          tipX,
          tipY,
        );
        ctx.stroke();
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════
 * Totem de Espinhos — escudo verde neon (capricho)
 * ═══════════════════════════════════════════════════════════ */

export function spawnTotemSpawnFx(x: number, y: number, id?: number, angle = 0) {
  if (id != null) {
    totemBornAt.set(id & 0xff, performance.now());
    totemAngleAt.set(id & 0xff, angle);
  }
  shocks.push({ x, y, t: 420, max: 420 });
  while (shocks.length > 40) shocks.shift();
  for (let i = 0; i < 36; i++) {
    const ang = (i / 36) * Math.PI * 2;
    const spd = 70 + Math.random() * 160;
    const life = 300 + Math.random() * 240;
    pushPart({
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 25,
      life,
      max: life,
      r: 2.5 + Math.random() * 3.5,
      baseR: 3,
      color: i % 2 === 0 ? "#7dff9a" : "#2a6a3a",
      alpha: 0.9,
      depth: "front",
      splash: true,
    });
  }
}

export function spawnTotemHitFx(x: number, y: number) {
  for (let i = 0; i < 10; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 40 + Math.random() * 120;
    const life = 140 + Math.random() * 120;
    pushPart({
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 30,
      life,
      max: life,
      r: 1.5 + Math.random() * 2,
      baseR: 2,
      color: "#b8ffc8",
      alpha: 0.95,
      depth: "front",
      splash: true,
    });
  }
}

export function spawnTotemExpireFx(x: number, y: number, id?: number, angle = 0) {
  const aid = id != null ? id & 0xff : -1;
  const openAng = angle || (aid >= 0 ? (totemAngleAt.get(aid) ?? 0) : 0);
  if (aid >= 0) {
    totemBornAt.delete(aid);
    totemAngleAt.delete(aid);
  }
  // holograma estilo Lanterna Verde — construto se desfaz em luz
  totemHolos.push({
    x,
    y,
    angle: openAng,
    age: 0,
    dur: TOTEM_HOLO_MS,
    seed: ((id ?? 0) * 7919 + (Math.random() * 1e6) | 0) >>> 0,
  });
  while (totemHolos.length > 6) totemHolos.shift();

  // partículas de energia (sobe e dissolve — não “poeira”)
  for (let i = 0; i < 42; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 20 + Math.random() * 140;
    const life = 380 + Math.random() * 520;
    const rise = 40 + Math.random() * 120;
    pushPart({
      x: x + (Math.random() - 0.5) * (TOTEM_BODY_OUTER_R + 40),
      y: y + (Math.random() - 0.5) * (TOTEM_BODY_OUTER_R * 0.5),
      vx: Math.cos(ang) * spd * 0.35,
      vy: Math.sin(ang) * spd * 0.2 - rise,
      life,
      max: life,
      r: 1.2 + Math.random() * 2.8,
      baseR: 2.2,
      color: i % 3 === 0 ? "#e8ffe8" : i % 3 === 1 ? "#5dff9a" : "#1aff6a",
      alpha: 0.95,
      depth: "front",
      splash: true,
    });
  }
  // anel de energia
  shocks.push({ x, y, t: 520, max: 520 });
  while (shocks.length > 40) shocks.shift();
}

/** Dissolve holográfico do Escudo de Espinhos (quando some). */
export function drawTotemHoloDissolves(ctx: CanvasRenderingContext2D, tMs: number) {
  for (const h of totemHolos) {
    const u = Math.min(1, h.age / h.dur);
    // flicker / glitch como construto do anel
    const flicker =
      u < 0.15
        ? 0.85 + 0.15 * Math.sin(tMs * 0.08)
        : u < 0.55
          ? 0.55 + 0.45 * Math.abs(Math.sin(tMs * 0.11 + h.seed)) * (1 - (u - 0.15) / 0.4)
          : Math.max(0, 1 - (u - 0.55) / 0.45) * (0.3 + 0.7 * ((Math.sin(tMs * 0.2 + h.seed) * 0.5 + 0.5) > 0.35 ? 1 : 0.15));
    const alpha = Math.max(0, flicker * (1 - u * 0.35));
    if (alpha < 0.02) continue;

    const openAng = h.angle;
    const halfOpen = TOTEM_C_HALF_OPEN;
    const arcStart = openAng + halfOpen;
    const arcEnd = openAng + Math.PI * 2 - halfOpen;
    const innerR = TOTEM_BODY_INNER_R;
    const outerR = TOTEM_BODY_OUTER_R;
    // dilata / desfaz — construto “solta”
    const expand = 1 + u * 0.35;
    const rise = -u * 18;
    const scan = (tMs * 0.12 + h.seed) % 1;

    ctx.save();
    ctx.translate(h.x, h.y + rise);
    ctx.globalAlpha = alpha;

    // glow externo
    const glow = ctx.createRadialGradient(0, 0, outerR * 0.2, 0, 0, outerR * 1.4 * expand);
    glow.addColorStop(0, `rgba(120, 255, 180, ${0.25 * alpha})`);
    glow.addColorStop(0.55, `rgba(40, 220, 120, ${0.12 * alpha})`);
    glow.addColorStop(1, "rgba(0, 80, 40, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, outerR * 1.35 * expand, 0, Math.PI * 2);
    ctx.fill();

    // corpo do C em wireframe + fill translúcido
    ctx.beginPath();
    ctx.arc(0, 0, outerR * expand, arcStart, arcEnd, false);
    ctx.arc(0, 0, innerR * expand, arcEnd, arcStart, true);
    ctx.closePath();
    ctx.fillStyle = `rgba(60, 255, 140, ${0.22 * alpha})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(200, 255, 220, ${0.85 * alpha})`;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // linhas de varredura (scanlines do holograma)
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, outerR * expand + 2, arcStart, arcEnd, false);
    ctx.arc(0, 0, innerR * expand - 2, arcEnd, arcStart, true);
    ctx.closePath();
    ctx.clip();
    const bandH = 5;
    for (let y = -outerR * expand; y < outerR * expand; y += bandH) {
      const bandU = (y / (outerR * expand * 2) + 0.5 + scan) % 1;
      const bright = bandU > 0.82 ? 0.55 : 0.12;
      ctx.fillStyle = `rgba(180, 255, 210, ${bright * alpha})`;
      ctx.fillRect(-outerR * expand, y, outerR * 2 * expand, bandH * 0.55);
    }
    // faixa de scan brilhante que sobe
    const scanY = -outerR * expand + scan * outerR * 2 * expand;
    ctx.fillStyle = `rgba(220, 255, 240, ${0.45 * alpha})`;
    ctx.fillRect(-outerR * expand, scanY - 3, outerR * 2 * expand, 6);
    ctx.restore();

    // fragmentos do arco se soltando
    const nFrag = 10;
    for (let i = 0; i < nFrag; i++) {
      const h1 = ((h.seed + i * 374761393) >>> 0) / 4294967296;
      const a = arcStart + h1 * (arcEnd - arcStart);
      const midR = ((innerR + outerR) * 0.5) * expand;
      const drift = u * (18 + h1 * 40);
      const fx = Math.cos(a) * (midR + drift);
      const fy = Math.sin(a) * (midR + drift) - u * 10;
      const fragA = alpha * (1 - u);
      ctx.strokeStyle = `rgba(140, 255, 190, ${fragA})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, midR + drift * 0.3, a - 0.12, a + 0.12);
      ctx.stroke();
      ctx.fillStyle = `rgba(200, 255, 220, ${fragA})`;
      ctx.beginPath();
      ctx.arc(fx, fy, 2.2 + (1 - u) * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // espinhos fantasma se desfazendo em pixels de luz
    const nSpikes = 16;
    for (let i = 0; i < nSpikes; i++) {
      const h1 = ((h.seed + i * 1274126177) >>> 0) / 4294967296;
      const a = arcStart + h1 * (arcEnd - arcStart);
      const dist = (outerR + 20 + h1 * (TOTEM_RADIUS - outerR - 30)) * (1 + u * 0.2);
      const sx = Math.cos(a) * dist;
      const sy = Math.sin(a) * dist * 0.62;
      const hh = (12 + (i % 4) * 5) * (1 - u * 0.7);
      ctx.globalAlpha = alpha * (0.4 + 0.6 * (1 - u));
      ctx.strokeStyle = "#7dff9a";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a) * 2, sy - hh);
      ctx.stroke();
    }

    // flash final
    if (u > 0.72) {
      const flash = (1 - (u - 0.72) / 0.28) * alpha;
      ctx.globalAlpha = flash;
      ctx.fillStyle = `rgba(180, 255, 210, ${0.35 * flash})`;
      ctx.beginPath();
      ctx.ellipse(0, 4, outerR * (1.1 + u), outerR * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

/** Feixe + marcador de mira enquanto segura Q. */
export function drawTotemAimBeam(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  tMs: number,
) {
  const pulse = 0.55 + 0.45 * Math.sin(tMs * 0.012);
  // mão → alvo
  const handX = fromX + Math.cos(Math.atan2(toY - fromY, toX - fromX)) * 14;
  const handY = fromY + Math.sin(Math.atan2(toY - fromY, toX - fromX)) * 14 - 6;
  ctx.strokeStyle = `rgba(80, 255, 140, ${0.35 * pulse})`;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.strokeStyle = `rgba(180, 255, 200, ${0.75 * pulse})`;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  // anel da mão
  ctx.fillStyle = `rgba(120, 255, 170, ${0.55 * pulse})`;
  ctx.beginPath();
  ctx.arc(handX, handY, 4 + pulse * 2, 0, Math.PI * 2);
  ctx.fill();
  // área dos espinhos + preview do escudo em C (abertura aponta pro conjurador)
  const r = TOTEM_RADIUS;
  const openAng = Math.atan2(fromY - toY, fromX - toX);
  const halfOpen = TOTEM_C_HALF_OPEN;
  const arcStart = openAng + halfOpen;
  const arcEnd = openAng + Math.PI * 2 - halfOpen;
  // aura grande nas COSTAS
  ctx.fillStyle = `rgba(40, 220, 100, ${0.1 * pulse})`;
  ctx.beginPath();
  ctx.ellipse(toX, toY + 4, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(60, 255, 120, ${0.4 * pulse})`;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(toX, toY + 4, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();
  // setor de espinhos (costas)
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.arc(toX, toY, r * 0.92, arcStart, arcEnd);
  ctx.closePath();
  ctx.fillStyle = `rgba(30, 180, 90, ${0.18 * pulse})`;
  ctx.fill();
  // C bem aberto (maior)
  ctx.save();
  ctx.translate(toX, toY);
  ctx.beginPath();
  ctx.arc(0, 0, TOTEM_BODY_OUTER_R * 0.85, arcStart, arcEnd, false);
  ctx.arc(0, 0, TOTEM_BODY_INNER_R * 0.85, arcEnd, arcStart, true);
  ctx.closePath();
  ctx.fillStyle = `rgba(40, 200, 100, ${0.4 * pulse})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(180, 255, 210, ${0.75 * pulse})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Escudo em C + espinhos pontiagudos no chão (fora do C). */
export function drawSpikeTotems(
  ctx: CanvasRenderingContext2D,
  totems: readonly SpikeTotemSnap[],
  tMs: number,
) {
  const now = performance.now();
  for (const t of totems) {
    const born = totemBornAt.get(t.id);
    const age = born != null ? Math.max(0, now - born) : TOTEM_FALL_MS + TOTEM_SPIKE_MS;

    // queda do escudo C
    const fallU = Math.min(1, age / TOTEM_FALL_MS);
    const fallEase = fallU * fallU;
    const dropY = (1 - fallEase) * -90;
    const impact = fallU >= 1 ? Math.min(1, (age - TOTEM_FALL_MS) / 100) : 0;
    const squash = fallU >= 1 ? 1 + (1 - impact) * 0.12 : 1;

    // espinhos sobem do chão depois do pouso e ficam FIXOS
    const spikeAge = Math.max(0, age - TOTEM_FALL_MS);
    const spikeU = Math.min(1, spikeAge / TOTEM_SPIKE_MS);
    const spikeRise = spikeU <= 0 ? 0 : 1 - Math.pow(1 - spikeU, 2.2);

    const grounded = fallU >= 1 ? 1 : fallEase;
    const pulse = 0.7 + 0.3 * Math.sin(tMs * 0.008 + t.id);
    const openAng = t.angle ?? 0;
    if (t.id != null) totemAngleAt.set(t.id & 0xff, openAng);
    // C bem aberto (~190° de abertura)
    const halfOpen = TOTEM_C_HALF_OPEN;
    const arcStart = openAng + halfOpen;
    const arcEnd = openAng + Math.PI * 2 - halfOpen;

    const innerR = TOTEM_BODY_INNER_R;
    const outerR = TOTEM_BODY_OUTER_R;
    const fieldR = TOTEM_RADIUS;

    // sombra no chão
    ctx.fillStyle = `rgba(0,0,0,${0.22 + 0.2 * grounded})`;
    ctx.beginPath();
    ctx.ellipse(t.x, t.y + 16, fieldR * 0.55 * grounded + 10, fieldR * 0.22 * grounded + 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // aura GRANDE nas costas (campo de espinhos)
    if (spikeRise > 0.05) {
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.arc(t.x, t.y, fieldR, arcStart, arcEnd);
      ctx.closePath();
      const ag = ctx.createRadialGradient(t.x, t.y, outerR * 0.4, t.x, t.y, fieldR);
      ag.addColorStop(0, `rgba(40, 200, 100, ${0.08 * spikeRise * pulse})`);
      ag.addColorStop(0.45, `rgba(30, 160, 80, ${0.16 * spikeRise * pulse})`);
      ag.addColorStop(1, "rgba(10, 60, 30, 0)");
      ctx.fillStyle = ag;
      ctx.fill();
      ctx.strokeStyle = `rgba(80, 255, 140, ${0.28 * spikeRise * pulse})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(t.x, t.y, fieldR, arcStart, arcEnd);
      ctx.stroke();
    }

    // —— espinhos pontiagudos só nas COSTAS do C ——
    if (spikeRise > 0.02) {
      const seed = (t.id * 7919) >>> 0;
      const nSpikes = FX_MOBILE ? 16 : 48;
      const arcSpan = arcEnd - arcStart;
      for (let i = 0; i < nSpikes; i++) {
        const h1 = ((seed + i * 374761393) >>> 0) / 4294967296;
        const h3 = ((seed + i * 1274126177) >>> 0) / 4294967296;
        const a = arcStart + h1 * arcSpan;
        const dist = outerR + 12 + h3 * (fieldR - outerR - 16);
        const sx = t.x + Math.cos(a) * dist;
        const sy = t.y + Math.sin(a) * dist * 0.62;
        const h = (18 + (i % 6) * 7) * spikeRise;
        const lean = a;

        ctx.fillStyle = `rgba(20, 50, 28, ${0.55 * spikeRise})`;
        ctx.beginPath();
        ctx.ellipse(sx, sy + 2, 2.4, 1.2, 0, 0, Math.PI * 2);
        ctx.fill();

        const tipX = sx + Math.cos(lean) * 1.5;
        const tipY = sy - h;
        const baseW = 2.1 + (i % 3) * 0.35;
        const px = -Math.sin(lean) * baseW;
        const py = Math.cos(lean) * baseW * 0.28;
        const g = ctx.createLinearGradient(sx, sy, tipX, tipY);
        g.addColorStop(0, "#1a4a28");
        g.addColorStop(0.45, "#3dff8a");
        g.addColorStop(1, "#e8ffe8");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(sx + px, sy + py);
        ctx.lineTo(sx - px, sy - py);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `rgba(200, 255, 220, ${0.55 * spikeRise})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    }

    // —— ESCUDO em C (cai do alto) ——
    const cx = t.x;
    const cy = t.y + dropY;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(squash, 2 - squash);

    // glow do C
    ctx.strokeStyle = `rgba(60, 255, 140, ${0.2 * pulse * grounded})`;
    ctx.lineWidth = outerR - innerR + 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, (innerR + outerR) * 0.5, arcStart, arcEnd);
    ctx.stroke();

    // corpo do C (anel grosso)
    const ring = ctx.createLinearGradient(-outerR, -outerR, outerR, outerR);
    ring.addColorStop(0, "#5dff9a");
    ring.addColorStop(0.45, "#1a8a48");
    ring.addColorStop(1, "#0a3a22");
    ctx.strokeStyle = ring as unknown as string;
    // fill as thick arc via path
    ctx.beginPath();
    ctx.arc(0, 0, outerR, arcStart, arcEnd, false);
    ctx.arc(0, 0, innerR, arcEnd, arcStart, true);
    ctx.closePath();
    ctx.fillStyle = ring;
    ctx.fill();
    ctx.strokeStyle = `rgba(200, 255, 220, ${0.75 * pulse})`;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // borda interna brilhante
    ctx.strokeStyle = `rgba(180, 255, 210, ${0.45 * pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, innerR + 1, arcStart, arcEnd);
    ctx.stroke();

    // pontas do C (remates) — maiores = batem com a hitbox
    for (const tip of [arcStart, arcEnd]) {
      const tx = Math.cos(tip) * ((innerR + outerR) * 0.5);
      const ty = Math.sin(tip) * ((innerR + outerR) * 0.5);
      ctx.fillStyle = `rgba(220, 255, 230, ${0.85 * pulse})`;
      ctx.beginPath();
      ctx.arc(tx, ty, 8.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0a3a22";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // núcleo suave no bolso (proteção)
    if (grounded > 0.9) {
      const ox = Math.cos(openAng) * 8;
      const oy = Math.sin(openAng) * 8;
      ctx.fillStyle = `rgba(80, 255, 160, ${0.12 * pulse})`;
      ctx.beginPath();
      ctx.ellipse(ox, oy, 18, 14, openAng, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // flash no impacto
    if (fallU >= 1 && spikeAge < 140) {
      const flash = 1 - spikeAge / 140;
      ctx.fillStyle = `rgba(120, 255, 180, ${0.3 * flash})`;
      ctx.beginPath();
      ctx.ellipse(t.x, t.y + 6, 36 + flash * 24, 14 + flash * 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
