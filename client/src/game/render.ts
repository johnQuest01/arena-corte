/**
 * render.ts — mapa deserto tilemap, personagens estilo Gungeon (em pé), arma, feel.
 */
import { ARENA_H, ARENA_W, CAM_VIEW_H, CAM_VIEW_W } from "../../../shared/constants";
import { LOADOUTS, MAX_STAMINA, GUN_HAND, GUN_VISUAL_SCALE, gunBarrelLocal, muzzlePoint, weaponOf } from "../../../shared/gear";
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
  camZoom: number;
  /** canto superior-esquerdo da câmera no mundo */
  camX: number;
  camY: number;
  damageFlash: number;
  hitFlashSelf: boolean;
  drawDecals: (ctx: CanvasRenderingContext2D) => void;
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

/** Chão estático pré-renderizado (não redesenha tile a tile por frame). */
let groundCache: HTMLCanvasElement | null = null;

export function invalidateGroundCache() {
  groundCache = null;
}

function ensureGroundCache() {
  if (groundCache) return groundCache;
  const c = document.createElement("canvas");
  c.width = ARENA_W;
  c.height = ARENA_H;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  paintGround(g);
  groundCache = c;
  return c;
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
  const dpr = Math.min(2, window.devicePixelRatio || 1);
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

function tileColor(t: number, shade: number): string {
  const base =
    t === T.DIRT
      ? LOSPEC.dirt
      : t === T.WOOD
        ? LOSPEC.wood
        : t === T.CONCRETE
          ? LOSPEC.concrete
          : t === T.WALL
            ? LOSPEC.wall
            : t === T.METAL
              ? LOSPEC.metal
              : t === T.CRATE
                ? "#8a7040"
                : t === T.BARREL
                  ? "#4a5a30"
                  : t === T.CAR
                    ? "#3a4048"
                    : shade ? LOSPEC.sandDark : LOSPEC.sand;
  return base;
}

function paintGround(ctx: CanvasRenderingContext2D) {
  for (let ty = 0; ty < GROUND.length; ty++) {
    for (let tx = 0; tx < GROUND[0]!.length; tx++) {
      const t = GROUND[ty]![tx]!;
      const shade = (tx * 3 + ty * 5) % 2;
      const x = tx * TILE;
      const y = ty * TILE;
      let img: HTMLImageElement | null = null;
      if (t === T.SAND || t === T.DIRT) img = getTileImg("sand", tx, ty);
      else if (t === T.WOOD) img = getTileImg("floorWood", tx, ty);
      else if (t === T.CONCRETE) img = getTileImg("floorConcrete", tx, ty);

      if (img) {
        ctx.drawImage(img, x, y, TILE, TILE);
      } else {
        ctx.fillStyle = tileColor(t, shade);
        ctx.fillRect(x, y, TILE, TILE);
        if (t === T.SAND || t === T.DIRT) {
          ctx.fillStyle = "rgba(0,0,0,0.06)";
          ctx.fillRect(x + 4, y + 8, 3, 2);
          ctx.fillRect(x + 18, y + 20, 4, 2);
        }
        if ((tx * 17 + ty * 31) % 8 === 0) {
          ctx.fillStyle = "rgba(60,40,20,0.18)";
          ctx.fillRect(x + ((tx * 3) % 20), y + ((ty * 5) % 22), 3, 2);
          ctx.fillRect(x + 10, y + 14, 5, 1);
        }
      }
    }
  }
}

function drawGround(ctx: CanvasRenderingContext2D) {
  ctx.drawImage(ensureGroundCache(), 0, 0);
}

function drawSolids(ctx: CanvasRenderingContext2D) {
  for (let ty = 0; ty < SOLID.length; ty++) {
    for (let tx = 0; tx < SOLID[0]!.length; tx++) {
      const t = SOLID[ty]![tx]!;
      if (t < 10) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      ctx.fillStyle = LOSPEC.shadow;
      ctx.fillRect(x + LIGHT_DIR.x * 6, y + LIGHT_DIR.y * 6, TILE, TILE);

      if (t === T.CRATE) {
        const prop = getPropImg("crate");
        if (prop) {
          ctx.drawImage(prop, x, y, TILE, TILE);
          continue;
        }
      } else if (t === T.BARREL) {
        const prop = getPropImg("barrel");
        if (prop) {
          ctx.drawImage(prop, x, y, TILE, TILE);
          continue;
        }
      } else if (t === T.CAR) {
        const prop = getPropImg("car");
        if (prop) {
          // carcaça pode ser 96×48 — encaixa no tile atual (vizinho também CAR)
          ctx.drawImage(prop, x, y, TILE, TILE);
          continue;
        }
      } else if (t === T.WALL || t === T.METAL) {
        const wall = getTileImg("wall", tx, ty);
        if (wall) {
          ctx.drawImage(wall, x, y, TILE, TILE);
          continue;
        }
      }

      ctx.fillStyle = tileColor(t, 0);
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x, y, TILE, 4);
      if (t === T.CRATE) {
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
      } else if (t === T.CAR) {
        ctx.fillStyle = "#1a2228";
        ctx.fillRect(x + 4, y + 8, TILE - 8, TILE - 14);
      } else if (t === T.BARREL) {
        ctx.fillStyle = "#2a3a20";
        ctx.beginPath();
        ctx.ellipse(x + 16, y + 16, 10, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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
    if (doorImg) {
      if (d.orient === "h") ctx.drawImage(doorImg, 0, -6, TILE, 12);
      else {
        ctx.save();
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(doorImg, 0, -6, TILE, 12);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = "#5a3a28";
      if (d.orient === "h") ctx.fillRect(0, -6, TILE, 12);
      else ctx.fillRect(-6, 0, 12, TILE);
      ctx.fillStyle = "#c8a35a";
      ctx.fillRect(d.orient === "h" ? TILE - 6 : -2, d.orient === "h" ? -2 : TILE - 6, 4, 4);
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
  // mão traseira (punho/coronha) — logo à frente da origem
  ctx.beginPath();
  ctx.ellipse(3, 3, 5, 4, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(3, 4, 4, 2.5, 0.15, 0, Math.PI * 2);
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
) {
  const w = weaponOf(weaponId);
  const HAND = GUN_HAND;
  const barrel = gunBarrelLocal(w);
  const facingLeft = Math.cos(aim) < 0;

  ctx.save();
  ctx.translate(
    Math.cos(aim) * HAND - Math.sin(aim) * (w.muzzleSide * 0.35),
    Math.sin(aim) * HAND + Math.cos(aim) * (w.muzzleSide * 0.35),
  );
  ctx.rotate(aim);
  if (facingLeft) ctx.scale(1, -1);
  ctx.translate(-gunKick * 5, 0);

  const gunImg = getGunImg(weaponId);
  if (gunImg) {
    const VISUAL_SCALE = GUN_VISUAL_SCALE;
    const grip = (w.gripInset ?? 4) * VISUAL_SCALE;
    const visualLen = w.length * VISUAL_SCALE;
    const scale = visualLen / Math.max(1, gunImg.naturalWidth);
    const dw = gunImg.naturalWidth * scale;
    const dh = gunImg.naturalHeight * scale;

    const backX = -grip;
    ctx.drawImage(gunImg, backX, -dh / 2, dw, dh);

    drawGripHands(ctx, visualLen);
    if (muzzleFlash) {
      // buraco real do cano (acima do centro da sprite)
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

  drawGripHands(ctx, T);

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
  const bob = Math.sin(tMs * 0.01 + en.id) * (en.state === 5 ? 0 : 2.5);
  const windup = en.state === 2 || en.state === 4;
  const stun = en.state === 6;
  const charge = en.state === 5;
  const chase = en.state === 1;
  const gVis = en.type === 2 ? view.giantVis?.get(en.id) : undefined;
  const skew = gVis?.skew ?? 0;
  const facing = gVis?.facing ?? 0;
  const windupFlash = gVis?.windupFlash ?? 0;

  ctx.save();
  ctx.translate(en.x, en.y + bob);

  if (en.type === 2) {
    // Gigante — humanoide grande, silhueta escura + peso visual
    const s = scale;
    const shadowOx = Math.cos(facing) * 6 * s;
    const shadowOy = Math.sin(facing) * 4 * s;
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.beginPath();
    ctx.ellipse(shadowOx, 22 * s + shadowOy, 34 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // massa ao virar
    ctx.transform(1, 0, skew, 1, 0, 0);

    // halo de aggro (CHASE) — pulso mais rápido perto do local
    if (chase && view.local?.alive) {
      const dist = Math.hypot(en.x - view.local.x, en.y - view.local.y);
      const near = 1 - Math.min(1, dist / 520);
      const pulseHz = 0.012 + near * 0.05;
      const pulse = 0.18 + (0.12 + near * 0.14) * (0.5 + 0.5 * Math.sin(tMs * pulseHz));
      ctx.fillStyle = `rgba(190,24,18,${pulse})`;
      ctx.beginPath();
      ctx.arc(0, -4 * s, 30 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    if (windup) {
      const pulse = 0.4 + Math.sin(tMs * 0.055) * 0.22 + windupFlash * 0.35;
      ctx.fillStyle = `rgba(220,30,20,${Math.min(0.85, pulse)})`;
      ctx.beginPath();
      ctx.arc(0, -8 * s, 30 * s, 0, Math.PI * 2);
      ctx.fill();
      if (windupFlash > 0.05) {
        ctx.strokeStyle = `rgba(255,60,40,${0.55 + windupFlash * 0.4})`;
        ctx.lineWidth = 3 + windupFlash * 2;
        ctx.beginPath();
        ctx.arc(0, -4 * s, 32 * s, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // pernas
    ctx.fillStyle = "#1a1418";
    ctx.fillRect(-10 * s, 4 * s, 7 * s, 16 * s);
    ctx.fillRect(3 * s, 4 * s, 7 * s, 16 * s);
    // torso largo
    ctx.fillStyle = windup ? "#4a2018" : chase ? "#221820" : "#1a1418";
    ctx.beginPath();
    ctx.ellipse(0, -4 * s, 16 * s, 18 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // contorno
    ctx.strokeStyle = windup ? "#ff5030" : "#c8a060";
    ctx.lineWidth = windup ? 2.2 : 1.5;
    ctx.beginPath();
    ctx.ellipse(0, -4 * s, 16 * s, 18 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
    // braço levantado no windup
    ctx.strokeStyle = "#2a2028";
    ctx.lineWidth = 5 * s;
    ctx.lineCap = "round";
    const armUp = windup ? -32 * s - windupFlash * 6 * s : 10 * s;
    ctx.beginPath();
    ctx.moveTo(14 * s, -8 * s);
    ctx.lineTo(22 * s, armUp);
    ctx.moveTo(-14 * s, -8 * s);
    ctx.lineTo(-18 * s, 8 * s);
    ctx.stroke();
    // cabeça
    ctx.fillStyle = "#141018";
    ctx.beginPath();
    ctx.arc(0, -26 * s, 11 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = windup ? "#ff7050" : "#e8c070";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // olhos
    ctx.fillStyle = windup ? "#ff4020" : "#e8a838";
    ctx.beginPath();
    ctx.arc(-4 * s, -27 * s, 2 * s, 0, Math.PI * 2);
    ctx.arc(4 * s, -27 * s, 2 * s, 0, Math.PI * 2);
    ctx.fill();
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
  const speed = Math.hypot(p.vx ?? 0, p.vy ?? 0);
  const facingLeft = Math.cos(p.angle) < 0;
  const gunBehind = Math.sin(p.angle) < -0.3;
  const dirs = getCharDirs(p.id);

  const bob = speed > 20 ? Math.sin(tMs * 0.02 + p.id) * 1.4 : 0;
  const idleScale = speed < 25 ? 1 + Math.sin(tMs * 0.004 + p.id) * 0.012 : 1;
  const runPhase = speed > 25 ? (tMs * 0.012 * (speed / 180)) % (Math.PI * 2) : 0;
  const legSwing = speed > 25 ? Math.sin(runPhase) * Math.min(4.5, speed / 55) : 0;
  const bodyKick = isSelf ? feel.bodyKick * 1.5 : 0;
  const gunKick = isSelf ? feel.gunKick : 0;
  const kickX = -Math.cos(p.angle) * bodyKick;
  const kickY = -Math.sin(p.angle) * bodyKick;
  /** ~3.5 tiles — leitura grande no mapa. */
  const CHAR_PX = 112;
  const CHAR = 5.0;

  if (!p.alive) ctx.globalAlpha = 0.35;

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

  if (gunBehind) {
    drawWeaponLayer(ctx, p.weapon, p.angle, gunKick, muzzle && isSelf);
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
    } else {
      ctx.fillStyle = look.shoes;
      ctx.fillRect(-3 + legSwing, 8, 4, 3);
      ctx.fillRect(1 - legSwing, 8, 4, 3);
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
    drawWeaponLayer(ctx, p.weapon, p.angle, gunKick, muzzle && isSelf);
  }

  if (isSelf) {
    ctx.strokeStyle = "rgba(77,155,230,0.65)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-CHAR_PX / 2 - 2, -CHAR_PX * 0.65, CHAR_PX + 4, CHAR_PX + 8);
  }

  ctx.restore();

  if (isSelf && p.alive) {
    const headY = p.y + bob + kickY - CHAR_PX * 0.72;
    drawHeadBars(ctx, p.x + kickX, headY, p.stamina ?? MAX_STAMINA, p.reloadProgress ?? 0);
  }

  if (p.alive && (p.stunnedUntil ?? 0) > serverTime) {
    drawSilenceIcon(ctx, p.x + kickX, p.y + bob + kickY - CHAR_PX * 0.82);
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

function drawRoofs(
  ctx: CanvasRenderingContext2D,
  roofAlpha: Map<number, number>,
) {
  const roofTile = getTileImg("roof");
  for (const b of BUILDINGS) {
    const a = roofAlpha.get(b.id) ?? 1;
    if (a <= 0.02) continue;
    const r = roofRect(b);
    ctx.globalAlpha = a;
    if (roofTile) {
      for (let y = r.y; y < r.y + r.h; y += TILE) {
        for (let x = r.x; x < r.x + r.w; x += TILE) {
          const dw = Math.min(TILE, r.x + r.w - x);
          const dh = Math.min(TILE, r.y + r.h - y);
          ctx.drawImage(roofTile, 0, 0, dw, dh, x, y, dw, dh);
        }
      }
    } else {
      ctx.fillStyle = LOSPEC.roof;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      for (let i = 0; i < r.w; i += 16) {
        ctx.fillRect(r.x + i, r.y, 2, r.h);
      }
      ctx.fillStyle = "rgba(180,120,80,0.25)";
      ctx.fillRect(r.x + 4, r.y + 4, r.w - 8, 6);
    }
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
    if (e.kind === "explode") fx.push({ x: e.x, y: e.y, r: 40, t: 400, kind: "explode" });
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
  return { gunKick: 0, bodyKick: 0, shake: 0, shells: [] };
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
  const next = new Map(anim);
  for (const d of DOOR_DEFS) {
    const target = bits & (1 << d.id) ? 1 : 0;
    const cur = next.get(d.id) ?? target;
    const step = dtMs / 150;
    let v = cur;
    if (v < target) v = Math.min(target, v + step);
    else if (v > target) v = Math.max(target, v - step);
    next.set(d.id, v);
  }
  return next;
}

export function tickRoofAlpha(
  alphas: Map<number, number>,
  selfX: number,
  selfY: number,
  dtMs: number,
): Map<number, number> {
  const inside = buildingAt(selfX, selfY);
  const next = new Map(alphas);
  const step = dtMs / 200;
  for (const b of BUILDINGS) {
    const target = inside === b.id ? 0.15 : 1;
    const cur = next.get(b.id) ?? 1;
    let v = cur;
    if (v < target) v = Math.min(target, v + step);
    else if (v > target) v = Math.max(target, v - step);
    next.set(b.id, v);
  }
  return next;
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

  drawGround(ctx);
  view.drawDecals(ctx);
  view.drawAbilityGround(ctx);
  drawSolids(ctx);
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

  // throwables
  for (const t of view.throwables) {
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

  // inimigos + Gigante
  for (const en of view.enemies ?? []) {
    drawEnemy(ctx, en, tMs, view);
  }
  for (const en of view.enemies ?? []) {
    drawBossEdgeMarker(ctx, en, camX, camY, viewW, viewH, tMs, view);
  }
  drawGiantTargetMarks(ctx, view, tMs);

  const selfMuzzle = view.flashes.some(
    (f) => f.t > 30 && (f.owner === undefined || f.owner === view.selfId),
  );

  if (view.local) {
    drawPersonSide(
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
    drawPersonSide(
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
  drawRoofs(ctx, view.roofAlpha);

  if (view.local) {
    drawVisionMask(ctx, view.local.x, view.local.y, view.doorsBits);
  }

  if (view.damageFlash > 0 || view.hitFlashSelf) {
    ctx.strokeStyle = `rgba(180,20,20,${0.25 * Math.max(view.damageFlash, view.hitFlashSelf ? 1 : 0)})`;
    ctx.lineWidth = 18;
    ctx.strokeRect(camX + 8, camY + 8, viewW - 16, viewH - 16);
  }

  if (view.flashBlind > 0) {
    ctx.fillStyle = `rgba(255,255,255,${view.flashBlind})`;
    ctx.fillRect(camX, camY, viewW, viewH);
  }

  ctx.restore(); // clip da janela da câmera

  void doorsFromBits;
  void dpr;
}
