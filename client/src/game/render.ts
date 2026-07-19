/**
 * render.ts — mapa deserto tilemap, personagens estilo Gungeon (em pé), arma, feel.
 */
import { ARENA_H, ARENA_W } from "../../../shared/constants";
import { LOADOUTS, muzzlePoint, weaponOf } from "../../../shared/gear";
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
  PlayerState,
  ThrowableState,
  TickEvent,
} from "../../../shared/protocol";

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
  night: "rgba(20,16,12,0.28)",
};

export interface MuzzleFlash {
  x: number;
  y: number;
  angle: number;
  t: number;
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
    vx: number;
    vy: number;
  } | null;
  remotes: PlayerState[];
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
  camZoom: number;
  damageFlash: number;
  hitFlashSelf: boolean;
  drawDecals: (ctx: CanvasRenderingContext2D) => void;
  drawGore: (ctx: CanvasRenderingContext2D) => void;
}

const LIGHT_DIR = { x: 0.35, y: 0.55 };

export function resizeCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(320, Math.min(window.innerWidth - 16, ARENA_W + 40));
  const h = Math.max(240, Math.min(window.innerHeight - 120, ARENA_H + 40));
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

function drawGround(ctx: CanvasRenderingContext2D) {
  for (let ty = 0; ty < GROUND.length; ty++) {
    for (let tx = 0; tx < GROUND[0]!.length; tx++) {
      const t = GROUND[ty]![tx]!;
      const shade = (tx * 3 + ty * 5) % 2;
      ctx.fillStyle = tileColor(t, shade);
      ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      if (t === T.SAND || t === T.DIRT) {
        ctx.fillStyle = "rgba(0,0,0,0.06)";
        ctx.fillRect(tx * TILE + 4, ty * TILE + 8, 3, 2);
        ctx.fillRect(tx * TILE + 18, ty * TILE + 20, 4, 2);
      }
      // detalhe fixo por tile (semente do mapa)
      if ((tx * 17 + ty * 31) % 8 === 0) {
        ctx.fillStyle = "rgba(60,40,20,0.18)";
        ctx.fillRect(tx * TILE + ((tx * 3) % 20), ty * TILE + ((ty * 5) % 22), 3, 2);
        ctx.fillRect(tx * TILE + 10, ty * TILE + 14, 5, 1);
      }
    }
  }
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
  for (const d of DOOR_DEFS) {
    const openT = doorAnim.get(d.id) ?? (doorsBits & (1 << d.id) ? 1 : 0);
    const r = doorWorldRect(d);
    const hingeX = d.orient === "h" ? r.x : r.x + r.w / 2;
    const hingeY = d.orient === "v" ? r.y : r.y + r.h / 2;
    ctx.save();
    ctx.translate(hingeX, hingeY);
    const ang = openT * (Math.PI / 2) * (d.orient === "h" ? -1 : 1);
    ctx.rotate(ang);
    ctx.fillStyle = "#5a3a28";
    if (d.orient === "h") ctx.fillRect(0, -6, TILE, 12);
    else ctx.fillRect(-6, 0, 12, TILE);
    ctx.fillStyle = "#c8a35a";
    ctx.fillRect(d.orient === "h" ? TILE - 6 : -2, d.orient === "h" ? -2 : TILE - 6, 4, 4);
    ctx.restore();
  }
}

/**
 * Arma em silhueta lateral (Gungeon): gira pela mira contínua.
 * Pivô na mão; tip = muzzleForward - HAND (casa com muzzlePoint do shared).
 */
function drawWeaponLayer(
  ctx: CanvasRenderingContext2D,
  weaponId: number,
  aim: number,
  gunKick: number,
  muzzleFlash: boolean,
) {
  const w = weaponOf(weaponId);
  const HAND = 10;
  const tip = w.muzzleForward - HAND;
  const facingLeft = Math.cos(aim) < 0;

  ctx.save();
  ctx.translate(
    Math.cos(aim) * HAND - Math.sin(aim) * (w.muzzleSide * 0.45),
    Math.sin(aim) * HAND + Math.cos(aim) * (w.muzzleSide * 0.45),
  );
  ctx.rotate(aim);
  if (facingLeft) ctx.scale(1, -1);
  ctx.translate(-gunKick * 5, 0);

  ctx.fillStyle = w.color;

  if (weaponId === 0) {
    // pistola
    ctx.fillRect(2, -4, tip * 0.55, 8);
    ctx.fillStyle = w.accent;
    ctx.fillRect(2, 3, 5, 10);
    ctx.fillRect(8, -8, 9, 4);
    ctx.fillStyle = "#222";
    ctx.fillRect(2 + tip * 0.45, -2.5, tip * 0.45, 4);
  } else if (weaponId === 4) {
    // shotgun
    ctx.fillRect(0, -5, tip * 0.8, 9);
    ctx.fillStyle = "#3a2818";
    ctx.fillRect(0, -5, 12, 9);
    ctx.fillStyle = w.accent;
    ctx.fillRect(tip * 0.35, 4, 12, 7);
    ctx.fillStyle = "#222";
    ctx.fillRect(tip * 0.7, -3.5, tip * 0.32, 5);
  } else if (weaponId === 5) {
    // SMG
    ctx.fillRect(1, -4.5, tip * 0.75, 8);
    ctx.fillStyle = w.accent;
    ctx.fillRect(tip * 0.25, 3, 6, 11);
    ctx.fillStyle = "#222";
    ctx.fillRect(tip * 0.65, -2.5, tip * 0.35, 4.5);
  } else if (weaponId === 6) {
    // sniper
    ctx.fillRect(0, -4, tip * 0.94, 6.5);
    ctx.fillStyle = "#2a2018";
    ctx.fillRect(0, -4, 13, 6.5);
    ctx.fillStyle = w.accent;
    ctx.fillRect(tip * 0.35, -9, 18, 5);
    ctx.fillStyle = "#111";
    ctx.fillRect(tip * 0.75, -2, tip * 0.35, 4);
  } else if (weaponId === 3) {
    // AK
    ctx.fillRect(0, -4.5, tip * 0.82, 8);
    ctx.fillStyle = "#3a2818";
    ctx.fillRect(0, -4.5, 14, 8);
    ctx.fillStyle = w.accent;
    ctx.beginPath();
    ctx.moveTo(tip * 0.35, 3);
    ctx.lineTo(tip * 0.35 + 8, 3);
    ctx.lineTo(tip * 0.35 + 11, 14);
    ctx.lineTo(tip * 0.35 + 1, 13);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.fillRect(tip * 0.7, -2.5, tip * 0.32, 4.5);
  } else if (weaponId === 2) {
    // M16
    ctx.fillRect(0, -4.5, tip * 0.84, 8);
    ctx.fillStyle = "#2a2a20";
    ctx.fillRect(0, -4.5, 12, 8);
    ctx.fillStyle = w.color;
    ctx.beginPath();
    ctx.moveTo(12, -4.5);
    ctx.lineTo(tip * 0.45, -9);
    ctx.lineTo(tip * 0.45, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = w.accent;
    ctx.fillRect(tip * 0.35, 3, 6, 10);
    ctx.fillStyle = "#222";
    ctx.fillRect(tip * 0.7, -2.5, tip * 0.34, 4.5);
  } else {
    // M4A1
    ctx.fillRect(0, -4.5, tip * 0.82, 8);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, -4.5, 12, 8);
    ctx.fillStyle = w.accent;
    ctx.fillRect(tip * 0.3, -9, 12, 4.5);
    ctx.fillRect(tip * 0.32, 3, 6, 10);
    ctx.fillStyle = "#222";
    ctx.fillRect(tip * 0.7, -2.5, tip * 0.32, 4.5);
  }

  if (muzzleFlash) {
    const mx = tip;
    const g = ctx.createRadialGradient(mx, 0, 0, mx, 0, 22);
    g.addColorStop(0, "rgba(255,230,120,0.95)");
    g.addColorStop(0.4, "rgba(255,140,40,0.55)");
    g.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx, 0, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Corpo em pé (estilo Gungeon): cabeça cima / pés baixo; flip L/R pela mira. */
function drawPersonSide(
  ctx: CanvasRenderingContext2D,
  p: {
    id: number;
    x: number;
    y: number;
    angle: number;
    alive: boolean;
    weapon: number;
    vx?: number;
    vy?: number;
  },
  tMs: number,
  isSelf: boolean,
  muzzle: boolean,
  feel: FeelState,
) {
  const look = LOADOUTS[p.id % LOADOUTS.length]!;
  const speed = Math.hypot(p.vx ?? 0, p.vy ?? 0);
  const facingLeft = Math.cos(p.angle) < 0;
  const gunBehind = Math.sin(p.angle) < -0.3;

  const bob = speed > 20 ? Math.sin(tMs * 0.02 + p.id) * 1.2 : 0;
  const idleScale = speed < 25 ? 1 + Math.sin(tMs * 0.004 + p.id) * 0.01 : 1;
  const runPhase = speed > 25 ? (tMs * 0.012 * (speed / 180)) % (Math.PI * 2) : 0;
  const legSwing = speed > 25 ? Math.sin(runPhase) * Math.min(4.5, speed / 55) : 0;
  const bodyKick = isSelf ? feel.bodyKick * 1.5 : 0;
  const gunKick = isSelf ? feel.gunKick : 0;
  const kickX = -Math.cos(p.angle) * bodyKick;
  const kickY = -Math.sin(p.angle) * bodyKick;
  const aimSkew = Math.cos(p.angle) >= 0 ? 0.06 : -0.06;
  /** Corpo + leitura; arma usa muzzleForward maior (gear). */
  const CHAR = 1.8;

  if (!p.alive) ctx.globalAlpha = 0.35;

  ctx.fillStyle = LOSPEC.shadow;
  ctx.beginPath();
  ctx.ellipse(
    p.x + LIGHT_DIR.x * 8 + kickX,
    p.y + LIGHT_DIR.y * 8 + kickY,
    17,
    9,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.save();
  ctx.translate(p.x + kickX, p.y + bob + kickY);
  ctx.scale(1, idleScale);

  // arma atrás do corpo quando mira pra cima
  if (gunBehind) {
    drawWeaponLayer(ctx, p.weapon, p.angle, gunKick, muzzle && isSelf);
  }

  // corpo sempre em pé; espelha só esquerda/direita
  ctx.save();
  if (facingLeft) ctx.scale(-1, 1);
  ctx.scale(CHAR, CHAR);
  ctx.transform(1, 0, aimSkew, 1, 0, 0);

  // pés (swing em X)
  ctx.fillStyle = look.shoes;
  ctx.fillRect(-3 + legSwing, 8, 4, 3);
  ctx.fillRect(1 - legSwing, 8, 4, 3);

  // pernas
  ctx.fillStyle = look.pants;
  ctx.fillRect(-2.5 + legSwing * 0.7, 1, 3.5, 8);
  ctx.fillRect(0.5 - legSwing * 0.7, 1, 3.5, 8);

  // tronco
  ctx.fillStyle = look.shirt;
  ctx.fillRect(-5, -9, 10, 11);

  // braços apontando pra arma (lado direito local = mira)
  ctx.fillStyle = look.shirt;
  ctx.fillRect(3, -7, 7, 3);
  ctx.fillStyle = look.skin;
  ctx.fillRect(8, -6.5, 4, 2.5);
  // braço de trás (sutil)
  ctx.fillStyle = look.shirt;
  ctx.fillRect(-1, -5, 5, 2.5);

  // cabeça no topo
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(0, -14, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look.hair;
  ctx.beginPath();
  ctx.arc(0, -15.5, 5.2, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();

  ctx.restore(); // fim flip corpo

  if (!gunBehind) {
    drawWeaponLayer(ctx, p.weapon, p.angle, gunKick, muzzle && isSelf);
  }

  if (isSelf) {
    ctx.strokeStyle = "rgba(77,155,230,0.65)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-18, -34, 36, 54);
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawRoofs(
  ctx: CanvasRenderingContext2D,
  roofAlpha: Map<number, number>,
) {
  for (const b of BUILDINGS) {
    const a = roofAlpha.get(b.id) ?? 1;
    if (a <= 0.02) continue;
    const r = roofRect(b);
    ctx.globalAlpha = a;
    ctx.fillStyle = LOSPEC.roof;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    for (let i = 0; i < r.w; i += 16) {
      ctx.fillRect(r.x + i, r.y, 2, r.h);
    }
    ctx.fillStyle = "rgba(180,120,80,0.25)";
    ctx.fillRect(r.x + 4, r.y + 4, r.w - 8, 6);
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
    const sparks = [0, 1, 2].map((i) => {
      const a = e.b /* unused */ + i;
      void a;
      const ang = Math.random() * Math.PI * 2;
      return { dx: Math.cos(ang) * 8, dy: Math.sin(ang) * 8, life: 80 };
    });
    flashes.push({ x: e.x, y: e.y, angle: 0, t: 50, sparks });
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
  const w = weaponOf(weapon);
  feel.gunKick = 1;
  feel.bodyKick = 1;
  if (isSelf) {
    feel.shake = 2 + (w.damage / 70) * 1.5;
  }
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
  const scale = Math.min(cw / ARENA_W, ch / ARENA_H);
  const ox = (cw - ARENA_W * scale) / 2;
  const oy = (ch - ARENA_H * scale) / 2;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#1a1410";
  ctx.fillRect(0, 0, cw, ch);

  const shake = view.feel.shake;
  const sx = shake ? (Math.random() - 0.5) * shake * 2 : 0;
  const sy = shake ? (Math.random() - 0.5) * shake * 2 : 0;
  const z = view.camZoom || 1;
  const zx = (ARENA_W * (1 - z)) / 2;
  const zy = (ARENA_H * (1 - z)) / 2;

  ctx.setTransform(scale * z, 0, 0, scale * z, ox + sx * scale - zx * scale, oy + sy * scale - zy * scale);

  drawGround(ctx);
  view.drawDecals(ctx);
  drawSolids(ctx);
  drawDoors(ctx, view.doorsBits, view.doorAnim);

  // drops de munição
  for (const d of view.ammoDrops) {
    const bob = Math.sin(tMs * 0.006 + d.id) * 3;
    ctx.fillStyle = LOSPEC.shadow;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y + 6, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#E8A838";
    ctx.fillRect(d.x - 7, d.y - 6 + bob, 14, 10);
    ctx.fillStyle = "#2a2010";
    ctx.fillRect(d.x - 5, d.y - 3 + bob, 10, 5);
  }

  // throwables
  for (const t of view.throwables) {
    ctx.fillStyle = "#c8a35a";
    ctx.beginPath();
    ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  view.drawGore(ctx);

  const selfMuzzle = view.flashes.some((f) => f.t > 30);

  if (view.local) {
    drawPersonSide(ctx, { ...view.local, id: view.selfId }, tMs, true, selfMuzzle, view.feel);
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
    );
  }

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

  // noite suave
  ctx.fillStyle = LOSPEC.night;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  if (view.local) {
    drawVisionMask(ctx, view.local.x, view.local.y, view.doorsBits);
  }

  // vinheta
  const vg = ctx.createRadialGradient(
    ARENA_W / 2,
    ARENA_H / 2,
    ARENA_H * 0.25,
    ARENA_W / 2,
    ARENA_H / 2,
    ARENA_W * 0.72,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.18)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  if (view.damageFlash > 0 || view.hitFlashSelf) {
    ctx.strokeStyle = `rgba(180,20,20,${0.25 * Math.max(view.damageFlash, view.hitFlashSelf ? 1 : 0)})`;
    ctx.lineWidth = 18;
    ctx.strokeRect(8, 8, ARENA_W - 16, ARENA_H - 16);
  }

  if (view.flashBlind > 0) {
    ctx.fillStyle = `rgba(255,255,255,${view.flashBlind})`;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  }

  void doorsFromBits;
}
