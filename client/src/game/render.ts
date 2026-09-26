/**
 * render.ts — mapa deserto tilemap, personagens estilo Gungeon (em pé), arma, feel.
 */
import { ARENA_H, ARENA_W, CAM_VIEW_H, CAM_VIEW_W } from "../../../shared/constants";
import {
  LOADOUTS,
  MAX_STAMINA,
  GUN_HAND_BODY_Y,
  GUN_HAND_VISUAL,
  GUN_VISUAL_SCALE,
  gunBarrelLocal,
  muzzlePoint,
  weaponOf,
} from "../../../shared/gear";
import {
  BUILDINGS,
  DOOR_DEFS,
  GROUND,
  SOLID,
  T,
  TILE,
  USE_VISION,
  buildingAt,
  doorWorldRect,
  doorsFromBits,
  roofRect,
} from "../../../shared/map";
import type {
  BulletState,
  EnemySnap,
  PlayerState,
  ThrowableState,
  TickEvent,
} from "../../../shared/protocol";
import { ENEMY_DEFS } from "../../../shared/enemies";
import {
  drawFrostBlock,
  FX_MOBILE,
  isRiftSinking,
  listEnemyRiftSinks,
  riftSinkHidden,
  riftSinkPose,
} from "./abilities_fx";
import {
  aimToDir8,
  drawDirFrame,
  drawSheetFrame,
  getCharAnim,
  getCharDirs,
  getDoorImg,
  getGunImg,
  getItemImg,
  getPropImg,
  getThrowImg,
  getTileImg,
} from "./art";
import { drawRoofLayer, drawWorld, invalidateWorld } from "./world";

export const LOSPEC = {
  sand: "#c8a35a",
  sandDark: "#a8843e",
  dirt: "#8a6a3a",
  wood: "#6b4a2a",
  concrete: "#6a6a60",
  wall: "#7a4a3a",
  metal: "#5a5a52",
  roof: "#4a3830",
  shadow: "rgba(46,34,47,0.5)",
  /** asfalto rachado / calçada suja / mato ressecado (Resurrect 64) */
  road: "#3a3a38",
  roadDark: "#2c2c2a",
  roadLine: "#b8a05a",
  sidewalk: "#7a7a72",
  sidewalkDark: "#5e5e58",
  grass: "#5a6a3a",
  grassDark: "#3e4a28",
  grassTall: "#6b7a40",
};

export interface MuzzleFlash {
  x: number;
  y: number;
  angle: number;
  t: number;
  /** id do atirador — evita muzzle/recoil no player errado */
  owner?: number;
  sparks?: { dx: number; dy: number; life: number }[];
}

export interface FxPool {
  x: number;
  y: number;
  r: number;
  t: number;
  kind: "fire" | "smoke" | "explode" | "dust";
}

export interface ShellCas {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface FeelState {
  /** 0..1 arma recuo */
  gunKick: number;
  /** 0..1 coice corpo */
  bodyKick: number;
  /** amplitude shake restante */
  shake: number;
  /** 0..1 vinheta de dano (tomei hit) */
  hurt: number;
  shells: ShellCas[];
}

export interface RenderView {
  selfId: number;
  local: {
    x: number;
    y: number;
    angle: number;
    hp: number;
    alive: boolean;
    weapon: number;
    stamina: number;
    /** 0..1 enquanto recarrega; 0 = idle */
    reloadProgress: number;
    stunnedUntil: number;
    frozenUntil?: number;
    speedBoostUntil?: number;
    shieldUntil?: number;
    dashUntil?: number;
    ability?: number;
    vx: number;
    vy: number;
  } | null;
  remotes: (PlayerState & { flashUntil?: number })[];
  enemies: EnemySnap[];
  /** mapa giantId → alvo travado (pra marca visual) */
  giantTargets?: Map<number, { kind: 0 | 1 | 2; id: number }>;
  /** juice visual do Gigante (facing/skew/flash de windup) */
  giantVis?: Map<number, { facing: number; skew: number; windupFlash: number }>;
  bullets: BulletState[];
  throwables: ThrowableState[];
  flashes: MuzzleFlash[];
  fx: FxPool[];
  flashBlind: number;
  events: TickEvent[];
  doorsBits: number;
  feel: FeelState;
  doorAnim: Map<number, number>; // id → 0 fechada .. 1 aberta
  roofAlpha: Map<number, number>; // building id → alpha
  ammoDrops: { id: number; x: number; y: number; amount: number }[];
  weaponDrops: { id: number; x: number; y: number; weaponId: number; mag: number; reserve: number }[];
  abilityDrops: { id: number; x: number; y: number; abilityId: number }[];
  spikeTotems?: { id: number; x: number; y: number; ownerId: number; angle: number }[];
  /** Mira do totem (segurar Q) */
  totemAim?: { fromX: number; fromY: number; toX: number; toY: number } | null;
  drawSpikeTotems?: (
    ctx: CanvasRenderingContext2D,
    totems: { id: number; x: number; y: number; ownerId: number; angle: number }[],
    tMs: number,
  ) => void;
  drawTotemAimBeam?: (
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    tMs: number,
  ) => void;
  drawTotemHoloDissolves?: (ctx: CanvasRenderingContext2D, tMs: number) => void;
  camZoom: number;
  /** canto superior-esquerdo da câmera no mundo */
  camX: number;
  camY: number;
  damageFlash: number;
  hitFlashSelf: boolean;
  /** indicadores de direção do dano (ângulo mundo → atacante) */
  dmgArrows?: { angle: number; at: number }[];
  /** 0..1 hitmarker na mira */
  hitMarker?: number;
  /** performance.now() do frame */
  nowMs?: number;
  drawDecals: (
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ) => void;
  drawGore: (ctx: CanvasRenderingContext2D) => void;
  drawAbilityGround: (ctx: CanvasRenderingContext2D) => void;
  drawAbilityWater: (ctx: CanvasRenderingContext2D) => void;
  /** serverTime do snapshot (para stun UI) */
  serverTime: number;
}

/**
 * Câmera estilo tiro 2D: personagem no centro; mundo desliza.
 * Clamp nas bordas do mapa — nunca mostra fora do ambiente.
 */
export function computeCamera(
  focusX: number,
  focusY: number,
  zoom = 1,
): { camX: number; camY: number; viewW: number; viewH: number } {
  const z = Math.max(0.85, Math.min(1.4, zoom || 1));
  const viewW = CAM_VIEW_W / z;
  const viewH = CAM_VIEW_H / z;
  const maxX = Math.max(0, ARENA_W - viewW);
  const maxY = Math.max(0, ARENA_H - viewH);
  const camX = Math.max(0, Math.min(maxX, focusX - viewW / 2));
  const camY = Math.max(0, Math.min(maxY, focusY - viewH / 2));
  return { camX, camY, viewW, viewH };
}

const LIGHT_DIR = { x: 0.35, y: 0.55 };

/** Chão/props são pintados por chunks em world.ts — força repintura (troca Leve/Full). */
export function invalidateGroundCache() {
  invalidateWorld();
}

/** Layout tela↔câmera: encaixa a janela (contain), sem esticar o campo. */
export function cameraScreenLayout(
  canvasW: number,
  canvasH: number,
  zoom = 1,
): { scale: number; ox: number; oy: number; z: number } {
  const z = Math.max(0.85, Math.min(1.4, zoom || 1));
  const scale = Math.min(canvasW / CAM_VIEW_W, canvasH / CAM_VIEW_H);
  const ox = (canvasW - CAM_VIEW_W * scale) / 2;
  const oy = (canvasH - CAM_VIEW_H * scale) / 2;
  return { scale, ox, oy, z };
}

export function resizeCanvas(canvas: HTMLCanvasElement) {
  // Perfil Leve: DPR 1. Full (mesmo no celular): até 2× como no desktop
  const dpr = FX_MOBILE ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const fill = canvas.dataset.fill === "1";
  const parent = canvas.parentElement;
  let w: number;
  let h: number;
  if (fill && parent) {
    const r = parent.getBoundingClientRect();
    w = Math.max(320, Math.floor(r.width || window.innerWidth));
    h = Math.max(240, Math.floor(r.height || window.innerHeight));
  } else {
    w = Math.max(320, Math.min(window.innerWidth - 16, CAM_VIEW_W));
    h = Math.max(240, Math.min(window.innerHeight - 120, CAM_VIEW_H));
  }
  const bw = Math.floor(w * dpr);
  const bh = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
}

function drawDoors(
  ctx: CanvasRenderingContext2D,
  doorsBits: number,
  doorAnim: Map<number, number>,
) {
  const doorImg = getDoorImg();
  for (const d of DOOR_DEFS) {
    const openT = doorAnim.get(d.id) ?? (doorsBits & (1 << d.id) ? 1 : 0);
    const r = doorWorldRect(d);
    const hingeX = d.orient === "h" ? r.x : r.x + r.w / 2;
    const hingeY = d.orient === "v" ? r.y : r.y + r.h / 2;
    ctx.save();
    ctx.translate(hingeX, hingeY);
    const ang = openT * (Math.PI / 2) * (d.orient === "h" ? -1 : 1);
    ctx.rotate(ang);
    if (d.orient === "v") ctx.rotate(Math.PI / 2);
    if (doorImg) {
      ctx.drawImage(doorImg, 0, -6, TILE, 12);
    } else {
      // folha de madeira: sombra, tábuas, moldura e maçaneta
      ctx.fillStyle = "rgba(10,8,12,0.35)";
      ctx.fillRect(2, -2, TILE, 9);
      ctx.fillStyle = "#3e2618";
      ctx.fillRect(0, -5, TILE, 10);
      ctx.fillStyle = "#7a4e2e";
      ctx.fillRect(1, -4, TILE - 2, 8);
      ctx.fillStyle = "#8e5c36";
      ctx.fillRect(1, -4, TILE - 2, 2);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(10, -4, 1, 8);
      ctx.fillRect(21, -4, 1, 8);
      ctx.fillStyle = "#d8b25a";
      ctx.fillRect(TILE - 6, -1.5, 3, 3);
    }
    ctx.restore();
  }
}

/**
 * Arma em silhueta lateral (Gungeon): gira pela mira contínua.
 * Pivô na mão; tip = muzzleForward - HAND (casa com muzzlePoint do shared).
 */
function drawGripHands(ctx: CanvasRenderingContext2D, gunLen: number, skin = "#d4a574") {
  ctx.fillStyle = skin;
  // mão traseira (punho) — colada na origem/ombro com GUN_HAND_VISUAL
  ctx.beginPath();
  ctx.ellipse(1, 2.5, 5, 4, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(1, 3.5, 4, 2.5, 0.15, 0, Math.PI * 2);
  ctx.fill();
  // mão dianteira (guarda-mão) — ~55% do comprimento da arma
  const fx = gunLen * 0.55;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(fx, 4, 5.5, 4.2, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(fx, 5, 4.5, 2.8, -0.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawWeaponLayer(
  ctx: CanvasRenderingContext2D,
  weaponId: number,
  aim: number,
  gunKick: number,
  muzzleFlash: boolean,
  /** false = personagem com mãos no sprite (não desenhar elipses flutuantes) */
  gripHands = true,
  /** 0 = idle; 0..1 durante reload (client-side) */
  reloadProgress = 0,
) {
  const w = weaponOf(weaponId);
  const HAND = GUN_HAND_VISUAL;
  const facingLeft = Math.cos(aim) < 0;
  const side = w.muzzleSide * 0.35;
  const rp = Math.max(0, Math.min(1, reloadProgress));
  const reloading = rp > 0.001 && rp < 0.999;
  // tilt da arma durante reload (abaixa e sobe)
  const reloadTilt = reloading ? Math.sin(rp * Math.PI) * 0.42 : 0;
  const reloadDrop = reloading ? Math.sin(rp * Math.PI) * 4 : 0;

  ctx.save();
  // 1) sobe até a altura da mão do designer; 2) avança na mira
  ctx.translate(0, GUN_HAND_BODY_Y);
  ctx.translate(
    Math.cos(aim) * HAND - Math.sin(aim) * side,
    Math.sin(aim) * HAND + Math.cos(aim) * side,
  );
  ctx.rotate(aim + reloadTilt);
  if (facingLeft) ctx.scale(1, -1);
  ctx.translate(-gunKick * 5, reloadDrop);

  const gunImg = getGunImg(weaponId);
  const VISUAL_SCALE = GUN_VISUAL_SCALE;
  const grip = (w.gripInset ?? 4) * VISUAL_SCALE;
  const visualLen = w.length * VISUAL_SCALE;
  const magX = visualLen * 0.32;
  const magW = 5 * VISUAL_SCALE * 0.55;
  const magH = 9 * VISUAL_SCALE * 0.55;

  /** pente: cai no início (~0..0.18), novo entra no fim (~0.78..1) */
  const drawMag = (ox: number, oy: number, rot: number, a: number) => {
    if (a <= 0.02) return;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(ox, oy);
    ctx.rotate(rot);
    ctx.fillStyle = "#2a2418";
    ctx.fillRect(-magW / 2, 0, magW, magH);
    ctx.fillStyle = "#5a4a28";
    ctx.fillRect(-magW / 2 + 1, 1, magW - 2, 3);
    ctx.restore();
  };

  if (gunImg) {
    const scale = visualLen / Math.max(1, gunImg.naturalWidth);
    const dw = gunImg.naturalWidth * scale;
    const dh = gunImg.naturalHeight * scale;
    const barrel = gunBarrelLocal(w);

    ctx.drawImage(gunImg, -grip, -dh / 2, dw, dh);

    // só fallback procedural — no sheet do designer as mãos já estão no corpo
    if (gripHands) drawGripHands(ctx, visualLen);

    if (reloading) {
      if (rp < 0.18) {
        const t = rp / 0.18;
        drawMag(magX, 2 + t * t * 36, t * 1.4, 1 - t * 0.35);
      } else if (rp > 0.78) {
        const t = (rp - 0.78) / 0.22;
        drawMag(magX, (1 - t) * 22, (1 - t) * -0.35, 0.55 + t * 0.45);
      }
    }
    if (muzzleFlash) {
      const mx = barrel.x;
      const my = barrel.y;
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 20);
      g.addColorStop(0, "rgba(255,245,180,1)");
      g.addColorStop(0.25, "rgba(255,200,80,0.85)");
      g.addColorStop(0.55, "rgba(255,100,30,0.4)");
      g.addColorStop(1, "rgba(255,60,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mx, my, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,230,140,0.95)";
      ctx.beginPath();
      ctx.moveTo(mx - 1, my - 2.5);
      ctx.lineTo(mx + 14, my);
      ctx.lineTo(mx - 1, my + 2.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  // fallback procedural
  const barrel = gunBarrelLocal(w);
  const T = barrel.x;
  const th = 1.55;

  ctx.fillStyle = w.color;

  if (weaponId === 0) {
    ctx.fillRect(2, -4 * th, T * 0.55, 8 * th);
    ctx.fillStyle = w.accent;
    ctx.fillRect(2, 3 * th, 6, 11 * th);
    ctx.fillRect(8, -9 * th, 10, 5 * th);
    ctx.fillStyle = "#222";
    ctx.fillRect(2 + T * 0.45, -2.5 * th, T * 0.45, 5 * th);
  } else if (weaponId === 4) {
    ctx.fillRect(0, -5 * th, T * 0.85, 10 * th);
    ctx.fillStyle = "#3a2818";
    ctx.fillRect(0, -5 * th, 14, 10 * th);
    ctx.fillStyle = w.accent;
    ctx.fillRect(T * 0.35, 4 * th, 14, 8 * th);
    ctx.fillStyle = "#222";
    ctx.fillRect(T * 0.7, -3.5 * th, T * 0.32, 6 * th);
  } else if (weaponId === 5) {
    ctx.fillRect(1, -5 * th, T * 0.78, 9 * th);
    ctx.fillStyle = w.accent;
    ctx.fillRect(T * 0.25, 3 * th, 7, 12 * th);
    ctx.fillStyle = "#222";
    ctx.fillRect(T * 0.65, -2.5 * th, T * 0.35, 5 * th);
  } else if (weaponId === 6) {
    ctx.fillRect(0, -4.5 * th, T * 0.96, 7.5 * th);
    ctx.fillStyle = "#2a2018";
    ctx.fillRect(0, -4.5 * th, 15, 7.5 * th);
    ctx.fillStyle = w.accent;
    ctx.fillRect(T * 0.35, -10 * th, 20, 6 * th);
    ctx.fillStyle = "#111";
    ctx.fillRect(T * 0.75, -2.5 * th, T * 0.35, 5 * th);
  } else if (weaponId === 3) {
    ctx.fillRect(0, -5 * th, T * 0.85, 9 * th);
    ctx.fillStyle = "#3a2818";
    ctx.fillRect(0, -5 * th, 16, 9 * th);
    ctx.fillStyle = w.accent;
    ctx.beginPath();
    ctx.moveTo(T * 0.35, 3 * th);
    ctx.lineTo(T * 0.35 + 9, 3 * th);
    ctx.lineTo(T * 0.35 + 12, 15 * th);
    ctx.lineTo(T * 0.35 + 1, 14 * th);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.fillRect(T * 0.7, -2.5 * th, T * 0.32, 5 * th);
  } else if (weaponId === 2) {
    ctx.fillRect(0, -5 * th, T * 0.88, 9 * th);
    ctx.fillStyle = "#2a2a20";
    ctx.fillRect(0, -5 * th, 14, 9 * th);
    ctx.fillStyle = w.color;
    ctx.beginPath();
    ctx.moveTo(14, -5 * th);
    ctx.lineTo(T * 0.45, -10 * th);
    ctx.lineTo(T * 0.45, 3 * th);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = w.accent;
    ctx.fillRect(T * 0.35, 3 * th, 7, 11 * th);
    ctx.fillStyle = "#222";
    ctx.fillRect(T * 0.7, -2.5 * th, T * 0.34, 5 * th);
  } else {
    ctx.fillRect(0, -5 * th, T * 0.85, 9 * th);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, -5 * th, 14, 9 * th);
    ctx.fillStyle = w.accent;
    ctx.fillRect(T * 0.3, -10 * th, 14, 5 * th);
    ctx.fillRect(T * 0.32, 3 * th, 7, 11 * th);
    ctx.fillStyle = "#222";
    ctx.fillRect(T * 0.7, -2.5 * th, T * 0.32, 5 * th);
  }

  if (gripHands) drawGripHands(ctx, T);

  if (reloading) {
    if (rp < 0.18) {
      const t = rp / 0.18;
      drawMag(magX, 2 + t * t * 36, t * 1.4, 1 - t * 0.35);
    } else if (rp > 0.78) {
      const t = (rp - 0.78) / 0.22;
      drawMag(magX, (1 - t) * 22, (1 - t) * -0.35, 0.55 + t * 0.45);
    }
  }

  if (muzzleFlash) {
    const mx = barrel.x;
    const my = barrel.y;
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, 22);
    g.addColorStop(0, "rgba(255,230,120,0.95)");
    g.addColorStop(0.4, "rgba(255,140,40,0.55)");
    g.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx, my, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Corpo em pé (estilo Gungeon): cabeça cima / pés baixo; flip L/R pela mira. */
function drawHeadBars(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  stamina: number,
  reloadProgress: number,
) {
  const barW = 44;
  const barH = 5;
  const gap = 3;
  let by = y;

  const track = (yy: number) => {
    ctx.fillStyle = "rgba(10,12,14,0.7)";
    ctx.fillRect(x - barW / 2, yy, barW, barH);
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - barW / 2, yy, barW, barH);
  };

  // stamina — azul
  track(by);
  const st = Math.max(0, Math.min(1, stamina / MAX_STAMINA));
  ctx.fillStyle = st < 0.2 ? "#3a6ab0" : "#3d8bfd";
  ctx.fillRect(x - barW / 2, by, barW * st, barH);
  by += barH + gap;

  // reload — âmbar (só durante carregamento)
  if (reloadProgress > 0.001 && reloadProgress < 0.999) {
    track(by);
    const rp = Math.max(0, Math.min(1, reloadProgress));
    ctx.fillStyle = "#E8A838";
    ctx.fillRect(x - barW / 2, by, barW * rp, barH);
  }
}

function drawSilenceIcon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(40,90,160,0.85)";
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-4, -4);
  ctx.lineTo(4, 4);
  ctx.moveTo(4, -4);
  ctx.lineTo(-4, 4);
  ctx.stroke();
  // círculo com traço = mute
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawEnemy(ctx: CanvasRenderingContext2D, en: EnemySnap, tMs: number, view: RenderView) {
  const def =
    en.type === 2
      ? ENEMY_DEFS[2]!
      : en.type === 1
        ? ENEMY_DEFS[1]!
        : ENEMY_DEFS[0]!;
  const scale = def.visualScale;
  const frozen = (en.frozenUntil ?? 0) > (view.serverTime ?? 0);
  const bob = frozen ? 0 : Math.sin(tMs * 0.01 + en.id) * (en.state === 5 ? 0 : 2.5);
  const windup = !frozen && (en.state === 2 || en.state === 4);
  const stun = en.state === 6;
  const charge = !frozen && en.state === 5;
  const chase = !frozen && en.state === 1;
  const gVis = en.type === 2 ? view.giantVis?.get(en.id) : undefined;
  const skew = gVis?.skew ?? 0;
  const facing = gVis?.facing ?? 0;
  const windupFlash = gVis?.windupFlash ?? 0;

  ctx.save();
  ctx.translate(en.x, en.y + bob);

  if (en.type === 2) {
    // Gigante procedural — silhueta monstruosa (ombros largos, corcunda, olhos vermelhos)
    const s = scale;
    const shadowOx = Math.cos(facing) * 5 * s;
    const shadowOy = Math.sin(facing) * 3 * s;
    ctx.fillStyle = "rgba(6,4,8,0.55)";
    ctx.beginPath();
    ctx.ellipse(shadowOx, 22 * s + shadowOy, 26 * s, 9 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // massa ao virar (juice)
    ctx.transform(1, 0, skew, 1, 0, 0);

    // aura de aggro contínua (chase) + pulso perto do local
    if (chase) {
      let alpha = 0.08;
      if (view.local?.alive) {
        const dist = Math.hypot(en.x - view.local.x, en.y - view.local.y);
        const near = 1 - Math.min(1, dist / 520);
        const pulseHz = 0.012 + near * 0.05;
        alpha = 0.08 + near * 0.12 * (0.5 + 0.5 * Math.sin(tMs * pulseHz));
      }
      ctx.fillStyle = `rgba(190,24,18,${alpha})`;
      ctx.beginPath();
      ctx.arc(0, -4 * s, 30 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // halo de windup vermelho (perigo)
    if (windup) {
      const pulse = 0.4 + Math.sin(tMs * 0.05) * 0.22 + windupFlash * 0.3;
      ctx.fillStyle = `rgba(200,40,30,${Math.min(0.85, pulse)})`;
      ctx.beginPath();
      ctx.arc(0, -6 * s, 30 * s, 0, Math.PI * 2);
      ctx.fill();
      if (windupFlash > 0.05) {
        ctx.strokeStyle = `rgba(255,60,40,${0.5 + windupFlash * 0.4})`;
        ctx.lineWidth = 2.5 + windupFlash * 2;
        ctx.beginPath();
        ctx.arc(0, -4 * s, 32 * s, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // pernas grossas — balançam ao andar (fase do bob / passos)
    const walk = chase ? Math.sin(tMs * 0.01 + en.id) : 0;
    const stride = 7 * s;
    const hipY = 6 * s;
    const legLen = 15 * s;
    ctx.strokeStyle = "#0f0b10";
    ctx.lineWidth = 9 * s;
    ctx.lineCap = "round";
    // perna esquerda (atrasa quando walk > 0)
    ctx.beginPath();
    ctx.moveTo(-7 * s, hipY);
    ctx.lineTo(-7 * s - walk * stride, hipY + legLen);
    ctx.stroke();
    // perna direita (oposta)
    ctx.beginPath();
    ctx.moveTo(7 * s, hipY);
    ctx.lineTo(7 * s + walk * stride, hipY + legLen);
    ctx.stroke();
    // pés
    ctx.fillStyle = "#0a080c";
    ctx.beginPath();
    ctx.ellipse(-7 * s - walk * stride, hipY + legLen + 1.5 * s, 5 * s, 2.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(7 * s + walk * stride, hipY + legLen + 1.5 * s, 5 * s, 2.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // braços longos ANTES do torso (ficam atrás)
    ctx.strokeStyle = "#181016";
    ctx.lineWidth = 7 * s;
    ctx.lineCap = "round";
    const armUp = windup ? -30 * s - windupFlash * 6 * s : 14 * s;
    ctx.beginPath();
    ctx.moveTo(15 * s, -10 * s);
    ctx.lineTo(24 * s, armUp);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-15 * s, -10 * s);
    ctx.lineTo(-20 * s, 16 * s);
    ctx.stroke();
    // garras/mãos
    ctx.fillStyle = "#0f0b10";
    ctx.beginPath();
    ctx.arc(24 * s, armUp, 4.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-20 * s, 16 * s, 4.5 * s, 0, Math.PI * 2);
    ctx.fill();

    // torso — ombros largos retos, afunila na cintura (+ respiração)
    const breath = 1 + Math.sin(tMs * 0.004 + en.id) * 0.02;
    ctx.save();
    ctx.scale(1, breath);
    const bodyCol = windup ? "#3a1e18" : chase ? "#241820" : "#181016";
    ctx.fillStyle = bodyCol;
    ctx.beginPath();
    ctx.moveTo(-18 * s, -14 * s);
    ctx.lineTo(18 * s, -14 * s);
    ctx.lineTo(12 * s, 8 * s);
    ctx.lineTo(-12 * s, 8 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -6 * s, 15 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = chase || windup ? "#a03828" : "#5a3a30";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-18 * s, -14 * s);
    ctx.lineTo(18 * s, -14 * s);
    ctx.lineTo(12 * s, 8 * s);
    ctx.lineTo(-12 * s, 8 * s);
    ctx.closePath();
    ctx.stroke();

    // espinhos/crista nos ombros
    ctx.fillStyle = "#0f0b10";
    ctx.beginPath();
    ctx.moveTo(-18 * s, -14 * s);
    ctx.lineTo(-24 * s, -26 * s);
    ctx.lineTo(-10 * s, -16 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(18 * s, -14 * s);
    ctx.lineTo(24 * s, -26 * s);
    ctx.lineTo(10 * s, -16 * s);
    ctx.closePath();
    ctx.fill();

    // cabeça baixa entre os ombros (corcunda)
    ctx.fillStyle = "#0d0a10";
    ctx.beginPath();
    ctx.arc(0, -20 * s, 9 * s, 0, Math.PI * 2);
    ctx.fill();
    // olhos vermelhos brilhantes
    const eye = windup ? "#ff3a3a" : chase ? "#e02020" : "#a01818";
    ctx.fillStyle = eye;
    ctx.shadowColor = eye;
    ctx.shadowBlur = windup ? 14 : chase ? 8 : 4;
    ctx.beginPath();
    ctx.arc(-3.5 * s, -21 * s, 2.4 * s, 0, Math.PI * 2);
    ctx.arc(3.5 * s, -21 * s, 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  } else if (en.type === 1) {
    // Brutamontes — monstro enorme, inconfundível
    const s = scale * 0.55;
    ctx.fillStyle = "rgba(20,8,8,0.55)";
    ctx.beginPath();
    ctx.ellipse(0, 22 * s, 34 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // aura de ameaça
    if (charge || windup) {
      const pulse = 0.35 + Math.sin(tMs * 0.02) * 0.15;
      ctx.fillStyle = `rgba(180,30,20,${pulse})`;
      ctx.beginPath();
      ctx.arc(0, 0, 48 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // corpo gordo
    ctx.fillStyle = stun ? "#6a5a4a" : charge ? "#8a2820" : "#3a2218";
    ctx.beginPath();
    ctx.ellipse(0, 4 * s, 36 * s, 40 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // barriga
    ctx.fillStyle = stun ? "#7a6a55" : "#4a3020";
    ctx.beginPath();
    ctx.ellipse(0, 12 * s, 28 * s, 24 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // cabeça
    ctx.fillStyle = "#2a1810";
    ctx.beginPath();
    ctx.arc(0, -28 * s, 22 * s, 0, Math.PI * 2);
    ctx.fill();
    // mandíbula / ombros
    ctx.fillStyle = "#1a1008";
    ctx.fillRect(-26 * s, -18 * s, 52 * s, 10 * s);
    // olhos vermelhos grandes
    const eye = windup || charge ? "#ff3030" : "#e02020";
    ctx.fillStyle = eye;
    ctx.shadowColor = eye;
    ctx.shadowBlur = charge ? 12 : 6;
    ctx.beginPath();
    ctx.arc(-8 * s, -30 * s, 4.5 * s, 0, Math.PI * 2);
    ctx.arc(8 * s, -30 * s, 4.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // chifres / crista
    ctx.fillStyle = "#1a1008";
    ctx.beginPath();
    ctx.moveTo(-14 * s, -42 * s);
    ctx.lineTo(-22 * s, -58 * s);
    ctx.lineTo(-6 * s, -46 * s);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(14 * s, -42 * s);
    ctx.lineTo(22 * s, -58 * s);
    ctx.lineTo(6 * s, -46 * s);
    ctx.fill();
    // label
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(-38 * s, -72 * s, 76 * s, 12 * s);
    ctx.fillStyle = "#ffcc44";
    ctx.font = `bold ${Math.round(10 * s)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("BRUTAMONTES", 0, -63 * s);
  } else {
    // Zumbi — silhueta podre mais legível
    const s = scale;
    ctx.fillStyle = "rgba(20,10,10,0.4)";
    ctx.beginPath();
    ctx.ellipse(0, 16 * s, 14 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    if (windup) {
      ctx.fillStyle = "rgba(100,180,40,0.25)";
      ctx.beginPath();
      ctx.arc(0, 0, 22 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // pernas
    ctx.fillStyle = "#3a4a28";
    ctx.fillRect(-8 * s, 6 * s, 5 * s, 12 * s);
    ctx.fillRect(3 * s, 6 * s, 5 * s, 12 * s);
    // torso
    ctx.fillStyle = windup ? "#6a8a40" : chase ? "#4a6a30" : "#3a5a28";
    ctx.fillRect(-11 * s, -10 * s, 22 * s, 20 * s);
    // braços caídos
    ctx.strokeStyle = "#5a7a38";
    ctx.lineWidth = 4 * s;
    ctx.lineCap = "round";
    const armSwing = Math.sin(tMs * 0.012 + en.id) * 0.35;
    ctx.beginPath();
    ctx.moveTo(-10 * s, -4 * s);
    ctx.lineTo(-16 * s, 8 * s + armSwing * 6);
    ctx.moveTo(10 * s, -4 * s);
    ctx.lineTo(16 * s, 8 * s - armSwing * 6);
    ctx.stroke();
    // cabeça
    ctx.fillStyle = "#6a8a48";
    ctx.beginPath();
    ctx.arc(0, -18 * s, 10 * s, 0, Math.PI * 2);
    ctx.fill();
    // olhos pretos / vazios
    ctx.fillStyle = windup ? "#ff4040" : "#101808";
    ctx.fillRect(-5 * s, -20 * s, 3.5 * s, 2.5 * s);
    ctx.fillRect(2 * s, -20 * s, 3.5 * s, 2.5 * s);
    // boca
    ctx.fillStyle = "#2a1808";
    ctx.fillRect(-3 * s, -14 * s, 6 * s, 2 * s);
  }

  // barra de HP só nos zumbis — chefe sem barra (mistério / pressão)
  if (en.type !== 1) {
    const pct = Math.max(0, Math.min(1, en.hp / 255));
    const bw = 26 * scale;
    const by = -32 * scale;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(-bw / 2, by, bw, 4);
    ctx.fillStyle = "#6ecf5a";
    ctx.fillRect(-bw / 2, by, bw * pct, 4);
  }

  if (windup && en.type !== 2) {
    ctx.strokeStyle = en.type === 1 ? "rgba(255,60,30,0.9)" : "rgba(180,255,80,0.7)";
    ctx.lineWidth = en.type === 1 ? 3 : 2;
    ctx.beginPath();
    ctx.arc(0, 0, (en.type === 1 ? 42 : 20) * (en.type === 1 ? scale * 0.55 : scale * 0.5), 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  // Congelamento — bloco sobre inimigo/Gigante
  if (frozen) {
    const iceScale = en.type === 2 ? 2.35 : en.type === 1 ? 1.65 : 1.05;
    ctx.fillStyle = "rgba(100,180,230,0.28)";
    ctx.beginPath();
    ctx.ellipse(en.x, en.y + bob - 8 * scale, 22 * iceScale, 30 * iceScale, 0, 0, Math.PI * 2);
    ctx.fill();
    drawFrostBlock(ctx, en.x, en.y + bob, tMs, iceScale, en.id * 0.91);
  }
}

function drawBossEdgeMarker(
  ctx: CanvasRenderingContext2D,
  en: EnemySnap,
  camX: number,
  camY: number,
  viewW: number,
  viewH: number,
  tMs: number,
  view: RenderView,
) {
  if (en.type !== 1 && en.type !== 2) return;
  const isGiant = en.type === 2;
  // seta do Gigante: só quem É o alvo travado
  if (isGiant) {
    const t = view.giantTargets?.get(en.id);
    if (!t || t.kind !== 0 || t.id !== view.selfId) return;
  }
  const pad = 28;
  const onScreen =
    en.x >= camX - 20 &&
    en.x <= camX + viewW + 20 &&
    en.y >= camY - 20 &&
    en.y <= camY + viewH + 20;
  if (onScreen) return;

  const mx = Math.max(camX + pad, Math.min(camX + viewW - pad, en.x));
  const my = Math.max(camY + pad, Math.min(camY + viewH - pad, en.y));
  const ang = Math.atan2(en.y - my, en.x - mx);
  let pulseHz = 0.015;
  if (isGiant && view.local) {
    const dist = Math.hypot(en.x - view.local.x, en.y - view.local.y);
    pulseHz = 0.018 + (1 - Math.min(1, dist / 700)) * 0.06;
  }
  const pulse = 0.7 + Math.sin(tMs * pulseHz) * 0.3;

  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(ang);
  ctx.fillStyle = isGiant ? `rgba(220,40,30,${pulse})` : `rgba(232,168,56,${pulse})`;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-8, 10);
  ctx.lineTo(-8, -10);
  ctx.closePath();
  ctx.fill();
  ctx.rotate(-ang);
  ctx.fillStyle = isGiant ? "#ff5040" : "#ffcc44";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(isGiant ? "GIGANTE" : "CHEFE", 0, -16);
  ctx.restore();
}

function drawGiantTargetMarks(
  ctx: CanvasRenderingContext2D,
  view: RenderView,
  tMs: number,
) {
  const marks = view.giantTargets;
  if (!marks || marks.size === 0) return;

  for (const [, t] of marks) {
    let x = 0;
    let y = 0;
    let ok = false;
    const isSelfTarget = t.kind === 0 && t.id === view.selfId;
    if (t.kind === 0) {
      if (view.local && view.selfId === t.id) {
        x = view.local.x;
        y = view.local.y;
        ok = view.local.alive;
      } else {
        const p = view.remotes.find((r) => r.id === t.id);
        if (p?.alive) {
          x = p.x;
          y = p.y;
          ok = true;
        }
      }
    } else {
      const en = view.enemies.find((e) =>
        e.id === t.id && (t.kind === 2 ? e.type === 2 : e.type !== 2),
      );
      if (en) {
        x = en.x;
        y = en.y;
        ok = true;
      }
    }
    if (!ok) continue;
    // ALVO intensificado só pra quem é o alvo
    const pulseHz = isSelfTarget ? 0.045 : 0.02;
    const pulse = isSelfTarget
      ? 0.7 + Math.sin(tMs * pulseHz) * 0.3
      : 0.45 + Math.sin(tMs * pulseHz) * 0.2;
    const col = isSelfTarget
      ? `rgba(255,48,32,${pulse})`
      : `rgba(232,168,56,${pulse})`;
    ctx.save();
    ctx.translate(x, y - 36);
    if (isSelfTarget) {
      ctx.strokeStyle = `rgba(255,80,50,${0.25 + pulse * 0.35})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 8, 18 + Math.sin(tMs * pulseHz) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = isSelfTarget ? 2.6 : 2;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(0, -8);
    ctx.lineTo(8, 0);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.font = isSelfTarget ? "bold 11px sans-serif" : "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ALVO", 0, -12);
    ctx.restore();
  }
}

function drawImpulseBoots(
  ctx: CanvasRenderingContext2D,
  legSwing: number,
  scale: number,
) {
  // botas de energia nos pés (acompanham o passo)
  const boot = (ox: number) => {
    ctx.fillStyle = "#E07A3A";
    ctx.fillRect(ox, 7.5 * scale, 5 * scale, 3.2 * scale);
    ctx.fillStyle = "#F0C060";
    ctx.fillRect(ox + 0.5 * scale, 8.2 * scale, 4 * scale, 1.2 * scale);
    ctx.fillStyle = "rgba(255,200,80,0.55)";
    ctx.fillRect(ox - 0.5 * scale, 9.5 * scale, 6 * scale, 1.2 * scale);
  };
  boot((-3 + legSwing) * scale);
  boot((1 - legSwing) * scale);
}

function drawBoostTrail(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  vx: number,
  vy: number,
  tMs: number,
) {
  const spd = Math.hypot(vx, vy);
  if (spd < 40) return;
  const ux = -vx / spd;
  const uy = -vy / spd;
  const n = Math.min(5, 2 + Math.floor(spd / 120));
  for (let i = 0; i < n; i++) {
    const jitter = ((tMs * 0.02 + i * 17) % 7) - 3;
    const dist = 10 + i * 9 + (tMs * 0.04 + i * 5) % 6;
    const px = x + ux * dist + uy * jitter;
    const py = y + uy * dist - ux * jitter;
    const a = 0.45 - i * 0.07;
    ctx.strokeStyle = `rgba(240,160,60,${a})`;
    ctx.lineWidth = 2.2 - i * 0.25;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + ux * 8, py + uy * 8);
    ctx.stroke();
  }
}

/** Desenha o boneco — se estiver caindo na Fenda, anima giro/encolhe no buraco. */
function drawPersonMaybeSink(
  ctx: CanvasRenderingContext2D,
  p: {
    id: number;
    x: number;
    y: number;
    angle: number;
    alive: boolean;
    weapon: number;
    stamina?: number;
    reloadProgress?: number;
    stunnedUntil?: number;
    frozenUntil?: number;
    speedBoostUntil?: number;
    shieldUntil?: number;
    dashUntil?: number;
    ability?: number;
    flashUntil?: number;
    vx?: number;
    vy?: number;
  },
  tMs: number,
  isSelf: boolean,
  muzzle: boolean,
  feel: FeelState,
  serverTime = 0,
) {
  if (riftSinkHidden(p.id)) return;
  const sink = riftSinkPose(p.id);
  if (!sink) {
    drawPersonSide(ctx, p, tMs, isSelf, muzzle, feel, serverTime);
    return;
  }
  ctx.save();
  if (sink.clip) {
    ctx.beginPath();
    ctx.ellipse(sink.hx, sink.hy, sink.holeRx, sink.holeRy, 0, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.translate(sink.x, sink.y);
  ctx.rotate(sink.rot);
  ctx.scale(sink.scale, sink.scale * sink.squashY);
  ctx.globalAlpha = sink.alpha;
  drawPersonSide(
    ctx,
    { ...p, x: 0, y: 0, alive: true, vx: 0, vy: 0 },
    tMs,
    isSelf,
    false,
    feel,
    serverTime,
  );
  ctx.restore();
}

function drawPersonSide(
  ctx: CanvasRenderingContext2D,
  p: {
    id: number;
    x: number;
    y: number;
    angle: number;
    alive: boolean;
    weapon: number;
    stamina?: number;
    reloadProgress?: number;
    stunnedUntil?: number;
    frozenUntil?: number;
    speedBoostUntil?: number;
    shieldUntil?: number;
    dashUntil?: number;
    ability?: number;
    flashUntil?: number;
    vx?: number;
    vy?: number;
  },
  tMs: number,
  isSelf: boolean,
  muzzle: boolean,
  feel: FeelState,
  serverTime = 0,
) {
  const look = LOADOUTS[p.id % LOADOUTS.length]!;
  const frozen = p.alive && (p.frozenUntil ?? 0) > serverTime;
  const speed = frozen ? 0 : Math.hypot(p.vx ?? 0, p.vy ?? 0);
  const facingLeft = Math.cos(p.angle) < 0;
  const gunBehind = Math.sin(p.angle) < -0.3;
  const dirs = getCharDirs(p.id);

  // congelado = estátua (sem bob / corrida / idle breathe)
  const bob = frozen ? 0 : speed > 20 ? Math.sin(tMs * 0.02 + p.id) * 1.4 : 0;
  const idleScale = frozen ? 1 : speed < 25 ? 1 + Math.sin(tMs * 0.004 + p.id) * 0.012 : 1;
  const runPhase = speed > 25 ? (tMs * 0.012 * (speed / 180)) % (Math.PI * 2) : 0;
  const legSwing = speed > 25 ? Math.sin(runPhase) * Math.min(4.5, speed / 55) : 0;
  const bodyKick = isSelf ? feel.bodyKick * 1.5 : 0;
  const gunKick = isSelf ? feel.gunKick : 0;
  const kickX = -Math.cos(p.angle) * bodyKick;
  const kickY = -Math.sin(p.angle) * bodyKick;
  /** ~3.5 tiles — leitura grande no mapa. */
  const CHAR_PX = 112;
  const CHAR = 5.0;
  const bootsOn = (p.ability ?? 0) === 2;
  const shieldCapeOn = (p.ability ?? 0) === 4;
  const recoilCapeOn = (p.ability ?? 0) === 3;
  const capeOn = shieldCapeOn || recoilCapeOn;
  const boosted =
    (p.speedBoostUntil ?? 0) > 0 && (p.speedBoostUntil ?? 0) > serverTime;
  const shieldUp =
    (p.shieldUntil ?? 0) > 0 && (p.shieldUntil ?? 0) > serverTime;
  const dashing =
    recoilCapeOn && (p.dashUntil ?? 0) > 0 && (p.dashUntil ?? 0) > serverTime;

  if (!p.alive) ctx.globalAlpha = 0.35;

  // rastro fantasma no dash da Capa de Recuo
  if (p.alive && dashing) {
    const spd = Math.hypot(p.vx ?? 0, p.vy ?? 0) || 1;
    const bx = -((p.vx ?? 0) / spd) * 16;
    const by = -((p.vy ?? 0) / spd) * 16;
    for (let g = 4; g >= 1; g--) {
      ctx.globalAlpha = 0.1 * g;
      ctx.fillStyle = g % 2 === 0 ? "#6a2848" : "#a03058";
      ctx.beginPath();
      ctx.ellipse(
        p.x + kickX + bx * g * 0.6,
        p.y + kickY + by * g * 0.6 + bob,
        16 + g,
        26 + g * 0.5,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = p.alive ? 1 : 0.35;
  }

  // motion streak + rastro enquanto o boost está ativo
  if (p.alive && boosted) {
    drawBoostTrail(ctx, p.x + kickX, p.y + kickY, p.vx ?? 0, p.vy ?? 0, tMs);
    const spd = Math.hypot(p.vx ?? 0, p.vy ?? 0) || 1;
    const bx = -((p.vx ?? 0) / spd) * 14;
    const by = -((p.vy ?? 0) / spd) * 14;
    for (let g = 3; g >= 1; g--) {
      ctx.globalAlpha = 0.12 * g;
      ctx.fillStyle = "#E8A838";
      ctx.beginPath();
      ctx.ellipse(
        p.x + kickX + bx * g * 0.55,
        p.y + kickY + by * g * 0.55 + bob,
        18,
        28,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = p.alive ? 1 : 0.35;
  }

  ctx.fillStyle = LOSPEC.shadow;
  ctx.beginPath();
  ctx.ellipse(
    p.x + LIGHT_DIR.x * 12 + kickX,
    p.y + LIGHT_DIR.y * 12 + kickY,
    dirs ? 32 : 34,
    dirs ? 16 : 18,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.save();
  ctx.translate(p.x + kickX, p.y + bob + kickY);
  ctx.scale(1, idleScale);

  // Capas nas costas (equipada) — balança com o passo; Recuo estica no dash
  if (capeOn && !shieldUp && p.alive) {
    const moveAng = speed > 20 ? Math.atan2(p.vy ?? 0, p.vx ?? 0) : p.angle + Math.PI;
    const drag = Math.sin(tMs * 0.012 + p.id) * (speed > 25 ? 0.2 : 0.07);
    // capa "arrasta" atrás do movimento
    const baseRot = recoilCapeOn
      ? moveAng + Math.PI + drag * 0.5
      : p.angle + Math.PI + drag;
    const stretch = dashing ? 1.65 : 1;
    const flare = dashing ? 1.25 : 1;
    ctx.save();
    ctx.rotate(baseRot);
    ctx.scale(1, stretch);
    if (recoilCapeOn) {
      ctx.fillStyle = dashing ? "#8a2048" : "#5a1838";
      ctx.beginPath();
      ctx.moveTo(-7 * flare, 3);
      ctx.quadraticCurveTo(-20 * flare, 24, -12 * flare, 42);
      ctx.lineTo(12 * flare, 42);
      ctx.quadraticCurveTo(20 * flare, 24, 7 * flare, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = dashing ? "#c04070" : "#8a3060";
      ctx.fillRect(-5, 5, 10, 16);
      ctx.strokeStyle = "rgba(220,120,160,0.4)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (dashing) {
        ctx.fillStyle = "rgba(255,100,140,0.35)";
        ctx.beginPath();
        ctx.moveTo(-10, 36);
        ctx.lineTo(0, 56);
        ctx.lineTo(10, 36);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = "#3a4a58";
      ctx.beginPath();
      ctx.moveTo(-6, 4);
      ctx.quadraticCurveTo(-18, 22, -10, 38);
      ctx.lineTo(10, 38);
      ctx.quadraticCurveTo(18, 22, 6, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#5a7a90";
      ctx.fillRect(-4, 6, 8, 14);
      ctx.strokeStyle = "rgba(180,210,230,0.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // sprite dirs já traz as mãos do designer — não desenhar elipses por cima
  const showGripHands = !dirs;

  if (gunBehind) {
    drawWeaponLayer(
      ctx,
      p.weapon,
      p.angle,
      gunKick,
      muzzle && isSelf,
      showGripHands,
      p.reloadProgress ?? 0,
    );
  }

  if (dirs) {
    // 3/4 · 8 direções (Atomic Exile) — sem flip de perfil
    const dir8 = aimToDir8(p.angle);
    const moving = speed > 25 && p.alive;
    // layout: 4 linhas de walk (0–3) + espelho para o hemisferio oposto
    let row = dir8 % 4;
    let flipX = false;
    if (dir8 >= 4) {
      row = dir8 - 4;
      flipX = true;
    }
    const fps = dirs.fps * (moving ? Math.max(0.7, Math.min(2.2, speed / 130)) : 1);
    const frame = moving ? Math.floor((tMs / 1000) * fps) % Math.min(4, dirs.cols) : 0;
    // idle: linha 0 da sheet com col = dir (8 poses); walk: row/frame
    const useIdleRow = !moving;
    ctx.save();
    if (flipX) ctx.scale(-1, 1);
    if (useIdleRow) {
      drawDirFrame(ctx, dirs, 0, dir8, -CHAR_PX / 2, -CHAR_PX * 0.62, CHAR_PX, CHAR_PX);
    } else {
      // drawDirFrame usa row=dir — passamos row via “dir” e frame via col
      const fs = dirs.frameSize;
      const col = frame % dirs.cols;
      ctx.drawImage(
        dirs.img,
        col * fs,
        row * fs,
        fs,
        fs,
        -CHAR_PX / 2,
        -CHAR_PX * 0.62,
        CHAR_PX,
        CHAR_PX,
      );
    }
    ctx.restore();
    // botas por cima do sheet (pés ~bottom do sprite)
    if (bootsOn) {
      ctx.save();
      if (facingLeft) ctx.scale(-1, 1);
      const footY = CHAR_PX * 0.28;
      const swing = legSwing * 2.2;
      ctx.fillStyle = "#E07A3A";
      ctx.fillRect(-22 + swing, footY, 16, 10);
      ctx.fillRect(6 - swing, footY, 16, 10);
      ctx.fillStyle = "#F0C060";
      ctx.fillRect(-20 + swing, footY + 3, 12, 3);
      ctx.fillRect(8 - swing, footY + 3, 12, 3);
      if (boosted) {
        ctx.fillStyle = "rgba(255,200,80,0.55)";
        ctx.fillRect(-24 + swing, footY + 8, 20, 3);
        ctx.fillRect(4 - swing, footY + 8, 20, 3);
      }
      ctx.restore();
    }
  } else {
    // fallback: sheet lateral OU procedural
    ctx.save();
    if (facingLeft) ctx.scale(-1, 1);
    ctx.scale(CHAR, CHAR);

    const animState = !p.alive ? "death" : speed > 25 ? "walk" : "idle";
    const anim = getCharAnim(p.id, animState as "idle" | "walk" | "death");
    if (anim) {
      const speedFps =
        animState === "walk"
          ? anim.fps * Math.max(0.55, Math.min(2.2, speed / 140))
          : anim.fps;
      const frame =
        animState === "death"
          ? anim.frames - 1
          : Math.floor((tMs / 1000) * speedFps) % anim.frames;
      const fs = anim.frameSize;
      drawSheetFrame(ctx, anim, frame, -fs / 2, -fs * 0.72, fs, fs);
      if (bootsOn) {
        ctx.fillStyle = "#E07A3A";
        ctx.fillRect(-4 + legSwing * 0.2, 7.2, 4.5, 2.8);
        ctx.fillRect(0.5 - legSwing * 0.2, 7.2, 4.5, 2.8);
        ctx.fillStyle = "#F0C060";
        ctx.fillRect(-3.5 + legSwing * 0.2, 8, 3.5, 1);
        ctx.fillRect(1 - legSwing * 0.2, 8, 3.5, 1);
      }
    } else {
      ctx.fillStyle = look.shoes;
      ctx.fillRect(-3 + legSwing, 8, 4, 3);
      ctx.fillRect(1 - legSwing, 8, 4, 3);
      if (bootsOn) drawImpulseBoots(ctx, legSwing, 1);
      ctx.fillStyle = look.pants;
      ctx.fillRect(-2.5 + legSwing * 0.7, 1, 3.5, 8);
      ctx.fillRect(0.5 - legSwing * 0.7, 1, 3.5, 8);
      ctx.fillStyle = look.shirt;
      ctx.fillRect(-5, -9, 10, 11);
      ctx.fillRect(3, -7, 7, 3);
      ctx.fillStyle = look.skin;
      ctx.fillRect(8, -6.5, 4, 2.5);
      ctx.fillStyle = look.shirt;
      ctx.fillRect(-1, -5, 5, 2.5);
      ctx.fillStyle = look.skin;
      ctx.beginPath();
      ctx.arc(0, -14, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = look.hair;
      ctx.beginPath();
      ctx.arc(0, -15.5, 5.2, Math.PI * 1.05, Math.PI * 1.95);
      ctx.fill();
    }
    ctx.restore();
  }

  if (!gunBehind) {
    drawWeaponLayer(
      ctx,
      p.weapon,
      p.angle,
      gunKick,
      muzzle && isSelf,
      showGripHands,
      p.reloadProgress ?? 0,
    );
  }

  // Escudo aberto na FRENTE do corpo (por cima) — leque ~108° com a mira
  if (shieldCapeOn && shieldUp && p.alive) {
    const pulse = 0.75 + 0.25 * Math.sin(tMs * 0.02);
    ctx.save();
    ctx.rotate(p.angle);
    ctx.translate(26, 0);
    const half = Math.PI * 0.55;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 36, -half, half);
    ctx.closePath();
    const grad = ctx.createRadialGradient(4, 0, 4, 10, 0, 38);
    grad.addColorStop(0, `rgba(160,190,210,${0.6 * pulse})`);
    grad.addColorStop(0.55, `rgba(70,100,120,${0.55 * pulse})`);
    grad.addColorStop(1, "rgba(40,55,70,0.12)");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = `rgba(200,230,255,${0.8 * pulse})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = `rgba(180,210,230,${0.4 * pulse})`;
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      const a = (i / 2) * half * 0.85;
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.lineTo(Math.cos(a) * 34, Math.sin(a) * 34);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (isSelf) {
    ctx.strokeStyle = shieldUp
      ? "rgba(160,210,240,0.9)"
      : "rgba(77,155,230,0.65)";
    ctx.lineWidth = shieldUp ? 2.2 : 1.5;
    ctx.strokeRect(-CHAR_PX / 2 - 2, -CHAR_PX * 0.65, CHAR_PX + 4, CHAR_PX + 8);
  }

  ctx.restore();

  if (isSelf && p.alive) {
    const headY = p.y + bob + kickY - CHAR_PX * 0.72;
    drawHeadBars(ctx, p.x + kickX, headY, p.stamina ?? MAX_STAMINA, p.reloadProgress ?? 0);
  }

  // contorno de escudo ativo (próprio e remotos)
  if (p.alive && shieldUp) {
    ctx.save();
    ctx.translate(p.x + kickX, p.y + bob + kickY);
    ctx.strokeStyle = "rgba(170,210,240,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -8, 36, 42, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (p.alive && (p.stunnedUntil ?? 0) > serverTime) {
    drawSilenceIcon(ctx, p.x + kickX, p.y + bob + kickY - CHAR_PX * 0.82);
  }

  // Congelamento — tint frio + bloco de gelo (por cima do corpo)
  if (frozen) {
    ctx.fillStyle = "rgba(100,180,230,0.32)";
    ctx.beginPath();
    ctx.ellipse(p.x + kickX, p.y + bob + kickY - 10, 28, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    drawFrostBlock(ctx, p.x + kickX, p.y + bob + kickY, tMs, 1, p.id * 1.37);
  }

  // flashbang: halo branco (bots / outros jogadores)
  if (p.alive && !isSelf && (p.flashUntil ?? 0) > serverTime) {
    const left = (p.flashUntil! - serverTime) / 2800;
    const a = Math.min(0.85, 0.35 + left * 0.55);
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.ellipse(p.x + kickX, p.y + bob + kickY - 18, 28, 36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,250,220,${0.5 * a})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x + kickX, p.y + bob + kickY - 22, 22 + (1 - left) * 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawVisionMask(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  doorsBits: number,
) {
  if (!USE_VISION) return;
  // máscara simples: escurece fora de um cone/raio; paredes bloqueiam raios grossos
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.globalCompositeOperation = "destination-out";
  const rays = 72;
  const range = 280;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  for (let i = 0; i <= rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    let dist = range;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    for (let d = 0; d < range; d += 6) {
      const x = ox + dx * d;
      const y = oy + dy * d;
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      if (tx < 0 || ty < 0 || tx >= 30 || ty >= 20) {
        dist = d;
        break;
      }
      const solid = SOLID[ty]![tx]!;
      if (solid >= 10) {
        dist = d;
        break;
      }
      // porta fechada
      for (const def of DOOR_DEFS) {
        if (doorsBits & (1 << def.id)) continue;
        const r = doorWorldRect(def);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          dist = d;
          break;
        }
      }
      if (dist < range && dist === d) break;
    }
    ctx.lineTo(ox + dx * dist, oy + dy * dist);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

export function pushFlashesFromEvents(flashes: MuzzleFlash[], events: TickEvent[]) {
  for (const e of events) {
    if (e.kind !== "shot") continue;
    const sparks = [0, 1, 2].map(() => {
      const ang = Math.random() * Math.PI * 2;
      return { dx: Math.cos(ang) * 8, dy: Math.sin(ang) * 8, life: 80 };
    });
    flashes.push({ x: e.x, y: e.y, angle: 0, t: 50, owner: e.a, sparks });
  }
}

export function pushFxFromEvents(fx: FxPool[], events: TickEvent[]) {
  for (const e of events) {
    // explode.b=1 = Bomba Devastadora — FX massivo em abilities_fx (spawnBigBoomFx)
    if (e.kind === "explode" && e.b !== 1) {
      fx.push({ x: e.x, y: e.y, r: 40, t: 400, kind: "explode" });
    }
    if (e.kind === "smoke") fx.push({ x: e.x, y: e.y, r: 50, t: 2000, kind: "smoke" });
    if (e.kind === "fire") fx.push({ x: e.x, y: e.y, r: 35, t: 1500, kind: "fire" });
    if (e.kind === "hit" && e.b === 255) fx.push({ x: e.x, y: e.y, r: 8, t: 120, kind: "dust" });
  }
}

export function tickFlashes(flashes: MuzzleFlash[], dtMs: number): MuzzleFlash[] {
  return flashes
    .map((f) => ({
      ...f,
      t: f.t - dtMs,
      sparks: f.sparks?.map((s) => ({ ...s, life: s.life - dtMs })).filter((s) => s.life > 0),
    }))
    .filter((f) => f.t > 0);
}

export function tickFx(fx: FxPool[], dtMs: number): FxPool[] {
  return fx.map((f) => ({ ...f, t: f.t - dtMs })).filter((f) => f.t > 0);
}

export function createFeel(): FeelState {
  return { gunKick: 0, bodyKick: 0, shake: 0, hurt: 0, shells: [] };
}

export function pulseShotFeel(feel: FeelState, weapon: number, isSelf: boolean) {
  if (!isSelf) return;
  const w = weaponOf(weapon);
  feel.gunKick = 1;
  feel.bodyKick = 1;
  feel.shake = 2 + (w.damage / 70) * 1.5;
  const ang = Math.random() * Math.PI * 2;
  feel.shells.push({
    x: 0,
    y: 0,
    vx: Math.cos(ang) * 60,
    vy: Math.sin(ang) * 40 - 40,
    life: 400,
  });
}

export function tickFeel(
  feel: FeelState,
  dtMs: number,
  origin?: { x: number; y: number; angle: number },
  onShellLand?: (x: number, y: number) => void,
) {
  feel.gunKick = Math.max(0, feel.gunKick - dtMs / 90);
  feel.bodyKick = Math.max(0, feel.bodyKick - dtMs / 60);
  feel.hurt = Math.max(0, feel.hurt - dtMs / 250);
  feel.shake *= Math.exp(-dtMs / 40);
  if (feel.shake < 0.05) feel.shake = 0;
  const next: ShellCas[] = [];
  for (const s of feel.shells) {
    let sh = s;
    if (origin && s.life >= 399) {
      const m = muzzlePoint(origin.x, origin.y, origin.angle, weaponOf(0));
      sh = { ...s, x: m.x, y: m.y };
    }
    sh = {
      ...sh,
      x: sh.x + sh.vx * (dtMs / 1000),
      y: sh.y + sh.vy * (dtMs / 1000),
      vy: sh.vy + 280 * (dtMs / 1000),
      life: sh.life - dtMs,
    };
    if (sh.life <= 0) onShellLand?.(sh.x, sh.y);
    else next.push(sh);
  }
  feel.shells = next;
}

export function tickDoorAnim(
  anim: Map<number, number>,
  bits: number,
  dtMs: number,
): Map<number, number> {
  const step = dtMs / 150;
  for (const d of DOOR_DEFS) {
    const target = bits & (1 << d.id) ? 1 : 0;
    const cur = anim.get(d.id) ?? target;
    let v = cur;
    if (v < target) v = Math.min(target, v + step);
    else if (v > target) v = Math.max(target, v - step);
    anim.set(d.id, v);
  }
  return anim;
}

export function tickRoofAlpha(
  alphas: Map<number, number>,
  selfX: number,
  selfY: number,
  dtMs: number,
): Map<number, number> {
  const inside = buildingAt(selfX, selfY);
  const step = dtMs / 200;
  for (const b of BUILDINGS) {
    const target = inside === b.id ? 0.15 : 1;
    const cur = alphas.get(b.id) ?? 1;
    let v = cur;
    if (v < target) v = Math.min(target, v + step);
    else if (v > target) v = Math.max(target, v - step);
    alphas.set(b.id, v);
  }
  return alphas;
}

export function drawFrame(ctx: CanvasRenderingContext2D, view: RenderView, tMs: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const { scale, ox, oy, z } = cameraScreenLayout(cw, ch, view.camZoom || 1);
  const viewW = CAM_VIEW_W / z;
  const viewH = CAM_VIEW_H / z;
  const camX = view.camX;
  const camY = view.camY;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cw, ch);

  const shake = view.feel.shake;
  const sx = shake ? (Math.random() - 0.5) * shake * 2 : 0;
  const sy = shake ? (Math.random() - 0.5) * shake * 2 : 0;

  // mundo: câmera segue o player; escala contain (tamanho normal)
  ctx.setTransform(
    scale * z,
    0,
    0,
    scale * z,
    ox - camX * scale * z + sx * scale,
    oy - camY * scale * z + sy * scale,
  );
  ctx.imageSmoothingEnabled = false;

  // não deixa FX (água etc.) vazar pro letterbox / fora do layout
  ctx.save();
  ctx.beginPath();
  ctx.rect(camX, camY, viewW, viewH);
  ctx.clip();

  drawWorld(ctx, camX, camY, viewW, viewH);
  view.drawDecals(ctx, camX, camY, viewW, viewH);
  view.drawAbilityGround(ctx);
  if (view.spikeTotems?.length && view.drawSpikeTotems) {
    view.drawSpikeTotems(ctx, view.spikeTotems, tMs);
  }
  if (view.drawTotemHoloDissolves) {
    view.drawTotemHoloDissolves(ctx, tMs);
  }
  if (view.totemAim && view.drawTotemAimBeam) {
    view.drawTotemAimBeam(
      ctx,
      view.totemAim.fromX,
      view.totemAim.fromY,
      view.totemAim.toX,
      view.totemAim.toY,
      tMs,
    );
  }
  drawDoors(ctx, view.doorsBits, view.doorAnim);

  // drops de munição
  const ammoImg = getItemImg("ammo");
  for (const d of view.ammoDrops) {
    const bob = Math.sin(tMs * 0.006 + d.id) * 3;
    ctx.fillStyle = LOSPEC.shadow;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y + 6, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    if (ammoImg) {
      ctx.drawImage(ammoImg, d.x - 8, d.y - 8 + bob, 16, 16);
    } else {
      ctx.fillStyle = "#E8A838";
      ctx.fillRect(d.x - 7, d.y - 6 + bob, 14, 10);
      ctx.fillStyle = "#2a2010";
      ctx.fillRect(d.x - 5, d.y - 3 + bob, 10, 5);
    }
  }

  // armas dropadas na morte
  for (const d of view.weaponDrops) {
    const bob = Math.sin(tMs * 0.005 + d.id * 1.7) * 2.5;
    const gun = getGunImg(d.weaponId);
    const w = weaponOf(d.weaponId);
    ctx.fillStyle = LOSPEC.shadow;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y + 8, 26, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    if (gun) {
      const dw = Math.min(110, Math.max(64, w.length * 1.55));
      const scale = dw / Math.max(1, gun.naturalWidth);
      const dh = gun.naturalHeight * scale;
      ctx.drawImage(gun, d.x - dw / 2, d.y - dh / 2 + bob, dw, dh);
    } else {
      ctx.fillStyle = w.color;
      ctx.fillRect(d.x - 36, d.y - 5 + bob, 72, 10);
      ctx.fillStyle = w.accent;
      ctx.fillRect(d.x - 36, d.y - 5 + bob, 16, 10);
    }
  }

  // drops de habilidade (Survival) — bota ou capa
  for (const d of view.abilityDrops ?? []) {
    const bob = Math.sin(tMs * 0.007 + d.id * 2.1) * 3.5;
    const pulse = 0.55 + 0.45 * Math.sin(tMs * 0.008 + d.id);
    ctx.fillStyle = LOSPEC.shadow;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y + 8, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (d.abilityId === 4) {
      ctx.fillStyle = `rgba(120,170,210,${0.28 * pulse})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y + bob, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3a4a58";
      ctx.beginPath();
      ctx.moveTo(d.x - 8, d.y - 2 + bob);
      ctx.quadraticCurveTo(d.x - 14, d.y + 14 + bob, d.x - 4, d.y + 16 + bob);
      ctx.lineTo(d.x + 4, d.y + 16 + bob);
      ctx.quadraticCurveTo(d.x + 14, d.y + 14 + bob, d.x + 8, d.y - 2 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#8ab0c8";
      ctx.fillRect(d.x - 5, d.y - 4 + bob, 10, 6);
    } else if (d.abilityId === 3) {
      ctx.fillStyle = `rgba(180,60,100,${0.28 * pulse})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y + bob, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5a1838";
      ctx.beginPath();
      ctx.moveTo(d.x - 8, d.y - 2 + bob);
      ctx.quadraticCurveTo(d.x - 14, d.y + 14 + bob, d.x - 4, d.y + 16 + bob);
      ctx.lineTo(d.x + 4, d.y + 16 + bob);
      ctx.quadraticCurveTo(d.x + 14, d.y + 14 + bob, d.x + 8, d.y - 2 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#c04070";
      ctx.fillRect(d.x - 5, d.y - 4 + bob, 10, 6);
    } else if (d.abilityId === 5) {
      // Fenda Sísmica — rachadura + magma
      ctx.fillStyle = `rgba(220,90,40,${0.3 * pulse})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y + bob, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#2a1810";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(d.x - 10, d.y - 6 + bob);
      ctx.lineTo(d.x - 4, d.y + 2 + bob);
      ctx.lineTo(d.x + 2, d.y - 2 + bob);
      ctx.lineTo(d.x + 10, d.y + 8 + bob);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,140,40,${0.7 * pulse})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(d.x - 8, d.y - 4 + bob);
      ctx.lineTo(d.x - 2, d.y + 2 + bob);
      ctx.lineTo(d.x + 4, d.y - 1 + bob);
      ctx.lineTo(d.x + 8, d.y + 6 + bob);
      ctx.stroke();
      ctx.fillStyle = "#1a1008";
      ctx.beginPath();
      ctx.ellipse(d.x + 2, d.y + 6 + bob, 5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.abilityId === 6) {
      // Bomba Devastadora — casco escuro + pavio
      ctx.fillStyle = `rgba(220,80,30,${0.32 * pulse})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y + bob, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a1210";
      ctx.beginPath();
      ctx.ellipse(d.x, d.y + 2 + bob, 8, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3a2820";
      ctx.fillRect(d.x - 3, d.y - 8 + bob, 6, 5);
      ctx.strokeStyle = `rgba(255,160,40,${0.75 * pulse})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y - 8 + bob);
      ctx.quadraticCurveTo(d.x + 5, d.y - 14 + bob, d.x + 3, d.y - 18 + bob);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,200,80,${0.85 * pulse})`;
      ctx.beginPath();
      ctx.arc(d.x + 3, d.y - 18 + bob, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.abilityId === 7) {
      // Escudo em C + espinhos
      const by = d.y + bob;
      ctx.fillStyle = `rgba(60,255,120,${0.22 * pulse})`;
      ctx.beginPath();
      ctx.arc(d.x, by, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(d.x, by, 11, 0.7, Math.PI * 2 - 0.7, false);
      ctx.arc(d.x, by, 6, Math.PI * 2 - 0.7, 0.7, true);
      ctx.closePath();
      ctx.fillStyle = "#1a8a48";
      ctx.fill();
      ctx.strokeStyle = `rgba(180,255,210,${0.85 * pulse})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // espinhos mini
      for (let i = 0; i < 5; i++) {
        const a = 0.9 + i * 0.85;
        const bx = d.x + Math.cos(a) * 12;
        const by2 = by + Math.sin(a) * 12;
        ctx.fillStyle = "#3dff8a";
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(a) * 4, by2 + Math.sin(a) * 4);
        ctx.lineTo(bx + Math.cos(a + 1.2) * 2, by2 + Math.sin(a + 1.2) * 2);
        ctx.lineTo(bx + Math.cos(a - 1.2) * 2, by2 + Math.sin(a - 1.2) * 2);
        ctx.closePath();
        ctx.fill();
      }
    } else if (d.abilityId === 8) {
      // Congelamento — cristal de gelo
      const by = d.y + bob;
      ctx.fillStyle = `rgba(140,210,255,${0.3 * pulse})`;
      ctx.beginPath();
      ctx.arc(d.x, by, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(d.x, by - 14);
      ctx.lineTo(d.x + 10, by - 2);
      ctx.lineTo(d.x + 7, by + 10);
      ctx.lineTo(d.x - 7, by + 10);
      ctx.lineTo(d.x - 10, by - 2);
      ctx.closePath();
      ctx.fillStyle = `rgba(168,216,240,${0.75 * pulse})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(240,251,255,${0.9 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.65 * pulse})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(d.x - 4, by - 8);
      ctx.lineTo(d.x + 2, by + 4);
      ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(240,160,60,${0.25 * pulse})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y + bob, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#E07A3A";
      ctx.fillRect(d.x - 8, d.y - 4 + bob, 16, 10);
      ctx.fillStyle = "#F0C060";
      ctx.fillRect(d.x - 6, d.y - 1 + bob, 12, 3);
      ctx.fillStyle = "#2a2010";
      ctx.fillRect(d.x - 7, d.y + 4 + bob, 5, 3);
      ctx.fillRect(d.x + 2, d.y + 4 + bob, 5, 3);
    }
  }

  // throwables
  for (const t of view.throwables) {
    if (t.kind === 5) {
      // Bomba Devastadora — pavio pisca mais rápido perto do fim
      const fuseLeft = Math.max(0, t.fuse);
      const urgency = 1 - Math.min(1, fuseLeft / 1200);
      const blinkHz = 3 + urgency * 14;
      const lit = Math.sin(tMs * 0.001 * blinkHz * Math.PI * 2) > (urgency > 0.7 ? -0.2 : 0);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(t.x, t.y + 7, 9, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // casco
      const body = ctx.createRadialGradient(t.x - 3, t.y - 2, 1, t.x, t.y, 11);
      body.addColorStop(0, "#3a2a22");
      body.addColorStop(0.55, "#1a1210");
      body.addColorStop(1, "#0c0806");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(t.x, t.y + 1, 9, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#5a4030";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // faixa
      ctx.strokeStyle = "#8a6040";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(t.x, t.y + 1, 9, 8, 0, -0.4, 0.4);
      ctx.stroke();
      // pavio
      ctx.strokeStyle = "#c8a060";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y - 7);
      ctx.quadraticCurveTo(t.x + 5, t.y - 14, t.x + 4, t.y - 18 - urgency * 2);
      ctx.stroke();
      if (lit) {
        const spark = 2.2 + urgency * 2.5;
        ctx.fillStyle = `rgba(255,${220 - urgency * 80 | 0},40,${0.85 + urgency * 0.15})`;
        ctx.beginPath();
        ctx.arc(t.x + 4, t.y - 18 - urgency * 2, spark, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,220,${0.7 + urgency * 0.3})`;
        ctx.beginPath();
        ctx.arc(t.x + 4, t.y - 18 - urgency * 2, spark * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      // anel de perigo perto do fim
      if (urgency > 0.55) {
        const a = (urgency - 0.55) / 0.45;
        ctx.strokeStyle = `rgba(255,80,30,${0.35 * a * (lit ? 1 : 0.4)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 14 + a * 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      continue;
    }
    const timg = getThrowImg(t.kind);
    if (timg) {
      ctx.drawImage(timg, t.x - 8, t.y - 8, 16, 16);
    } else {
      ctx.fillStyle = "#c8a35a";
      ctx.beginPath();
      ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  view.drawGore(ctx);

  // inimigos + Gigante — sinks de fenda em pass separado (zumbi some do snap ao morrer)
  for (const en of view.enemies ?? []) {
    if (isRiftSinking(en.id, "enemy")) continue;
    drawEnemy(ctx, en, tMs, view);
  }
  for (const sink of listEnemyRiftSinks()) {
    const pose = sink.pose;
    ctx.save();
    if (pose.clip) {
      ctx.beginPath();
      ctx.ellipse(pose.hx, pose.hy, pose.holeRx, pose.holeRy, 0, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.rot);
    ctx.scale(pose.scale, pose.scale * pose.squashY);
    ctx.globalAlpha = pose.alpha;
    drawEnemy(
      ctx,
      {
        id: sink.id,
        type: sink.enemyType,
        x: 0,
        y: 0,
        hp: 0,
        state: 1,
        frozenUntil: 0,
      },
      tMs,
      view,
    );
    ctx.restore();
  }
  for (const en of view.enemies ?? []) {
    drawBossEdgeMarker(ctx, en, camX, camY, viewW, viewH, tMs, view);
  }
  drawGiantTargetMarks(ctx, view, tMs);

  const selfMuzzle = view.flashes.some(
    (f) => f.t > 30 && (f.owner === undefined || f.owner === view.selfId),
  );

  if (view.local) {
    drawPersonMaybeSink(
      ctx,
      { ...view.local, id: view.selfId },
      tMs,
      true,
      selfMuzzle,
      view.feel,
      view.serverTime,
    );
  }
  for (const r of view.remotes) {
    const muzzle = view.events.some((e) => e.kind === "shot" && e.a === r.id);
    drawPersonMaybeSink(
      ctx,
      { ...r, weapon: r.weapon ?? 0 },
      tMs,
      false,
      muzzle,
      view.feel,
      view.serverTime,
    );
  }

  // massa de água / spray por cima dos personagens
  view.drawAbilityWater(ctx);

  // balas — rastro
  for (const b of view.bullets) {
    const sniper = b.weapon === 6;
    ctx.strokeStyle = sniper ? "rgba(255,240,200,0.85)" : "rgba(255,220,120,0.75)";
    ctx.lineWidth = sniper ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(b.px, b.py);
    ctx.lineTo(b.x, b.y);
    if (sniper) {
      const dx = b.x - b.px;
      const dy = b.y - b.py;
      ctx.lineTo(b.x + dx * 2, b.y + dy * 2);
    }
    ctx.stroke();
  }

  for (const f of view.flashes) {
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 16);
    g.addColorStop(0, "rgba(255,230,120,0.9)");
    g.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 16, 0, Math.PI * 2);
    ctx.fill();
    for (const s of f.sparks ?? []) {
      ctx.strokeStyle = `rgba(255,200,80,${s.life / 80})`;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(f.x + s.dx, f.y + s.dy);
      ctx.stroke();
    }
  }

  for (const s of view.feel.shells) {
    ctx.fillStyle = "#c8a060";
    ctx.fillRect(s.x, s.y, 2, 1);
  }

  for (const f of view.fx) {
    const a = Math.min(1, f.t / 300);
    if (f.kind === "smoke") {
      ctx.fillStyle = `rgba(120,120,110,${0.35 * a})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1.2 - a * 0.2), 0, Math.PI * 2);
      ctx.fill();
    } else if (f.kind === "fire") {
      ctx.fillStyle = `rgba(220,80,20,${0.5 * a})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (f.kind === "dust") {
      ctx.fillStyle = `rgba(200,180,120,${0.6 * a})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = `rgba(255,180,60,${0.55 * a})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * a, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // telhados por cima
  drawRoofLayer(ctx, view.roofAlpha, camX, camY, viewW, viewH);

  if (view.local) {
    drawVisionMask(ctx, view.local.x, view.local.y, view.doorsBits);
  }

  const hurt = Math.max(view.feel.hurt, view.damageFlash, view.hitFlashSelf ? 0.55 : 0);
  if (hurt > 0.02) {
    // vinheta de dano nas bordas
    const g = ctx.createRadialGradient(
      camX + viewW / 2,
      camY + viewH / 2,
      Math.min(viewW, viewH) * 0.28,
      camX + viewW / 2,
      camY + viewH / 2,
      Math.max(viewW, viewH) * 0.72,
    );
    g.addColorStop(0, "rgba(180,20,20,0)");
    g.addColorStop(1, `rgba(160,10,10,${0.55 * hurt})`);
    ctx.fillStyle = g;
    ctx.fillRect(camX, camY, viewW, viewH);
    ctx.strokeStyle = `rgba(200,30,30,${0.4 * hurt})`;
    ctx.lineWidth = 14 + hurt * 10;
    ctx.strokeRect(camX + 6, camY + 6, viewW - 12, viewH - 12);
  }

  // indicadores direcionais — perto da cabeça, um pouco afastados na direção do tiro
  const nowMs = view.nowMs ?? performance.now();
  if (view.local && (view.dmgArrows?.length ?? 0) > 0) {
    const headX = view.local.x;
    const headY = view.local.y - 28; // altura da cabeça (sprite em pé)
    const ring = 88; // bem afastado da cabeça, ainda perto do personagem
    for (const arr of view.dmgArrows!) {
      const age = nowMs - arr.at;
      if (age < 0 || age > 800) continue;
      const life = 1 - age / 800;
      const dx = Math.cos(arr.angle);
      const dy = Math.sin(arr.angle);
      const px = headX + dx * ring;
      const py = headY + dy * ring;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(arr.angle);
      ctx.globalAlpha = 0.4 + life * 0.6;
      ctx.fillStyle = "#e04030";
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-8, 8);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-8, -8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  if (view.flashBlind > 0) {
    ctx.fillStyle = `rgba(255,255,255,${view.flashBlind})`;
    ctx.fillRect(camX, camY, viewW, viewH);
  }

  ctx.restore(); // clip da janela da câmera

  // hitmarker no centro da tela (espaço tela)
  const hm = view.hitMarker ?? 0;
  if (hm > 0.02) {
    const sw = ctx.canvas.clientWidth || ctx.canvas.width;
    const sh = ctx.canvas.clientHeight || ctx.canvas.height;
    const mx = sw / 2;
    const my = sh / 2;
    const s = 7 + (1 - hm) * 4;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = hm;
    ctx.strokeStyle = "#e8efe9";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx - s, my - s);
    ctx.lineTo(mx - s * 0.25, my - s * 0.25);
    ctx.moveTo(mx + s, my - s);
    ctx.lineTo(mx + s * 0.25, my - s * 0.25);
    ctx.moveTo(mx - s, my + s);
    ctx.lineTo(mx - s * 0.25, my + s * 0.25);
    ctx.moveTo(mx + s, my + s);
    ctx.lineTo(mx + s * 0.25, my + s * 0.25);
    ctx.stroke();
    ctx.restore();
  }

  void doorsFromBits;
  void dpr;
}
