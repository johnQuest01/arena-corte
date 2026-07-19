/**
 * render.ts — mapa deserto tilemap, personagens 3/4 8-dir, arma em camada, feel.
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

/** 8 dirs: 0=E, 1=SE, 2=S, 3=SO, 4=O, 5=NO, 6=N, 7=NE — a partir de angle (atan2, 0=+X). */
function aimDir(angle: number): number {
  return Math.round(angle / (Math.PI / 4)) & 7;
}

function moveDir(vx: number, vy: number, fallback: number): number {
  if (Math.hypot(vx, vy) < 20) return fallback;
  return Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) & 7;
}

function dirAngle(dir: number): number {
  return dir * (Math.PI / 4);
}

function drawWeaponLayer(
  ctx: CanvasRenderingContext2D,
  weaponId: number,
  aim: number,
  gunKick: number,
  muzzleFlash: boolean,
) {
  const w = weaponOf(weaponId);
  const L = w.length;
  const W = w.width;
  const facingLeft = aim > Math.PI / 2 || aim < -Math.PI / 2;
  ctx.save();
  ctx.rotate(aim);
  if (facingLeft) ctx.scale(1, -1);
  ctx.translate(-gunKick * 3.5, 0);

  ctx.fillStyle = w.color;
  if (weaponId === 0) {
    ctx.fillRect(6, -W / 2, L * 0.55, W);
    ctx.fillStyle = w.accent;
    ctx.fillRect(6 + L * 0.35, -W * 0.8, 4, W * 1.6);
  } else if (weaponId === 4) {
    ctx.fillRect(8, -W / 2, L * 0.7, W);
    ctx.fillStyle = w.accent;
    ctx.fillRect(8 + L * 0.5, -W * 0.3, L * 0.35, W * 0.6);
  } else if (weaponId === 5) {
    ctx.fillRect(7, -W / 2, L * 0.65, W);
    ctx.fillStyle = w.accent;
    ctx.fillRect(7 + L * 0.25, W / 2, 5, W);
  } else if (weaponId === 6) {
    ctx.fillRect(8, -W / 2, L * 0.85, W * 0.8);
    ctx.fillStyle = w.accent;
    ctx.fillRect(8 + L * 0.75, -1, L * 0.35, 2);
  } else if (weaponId === 2) {
    ctx.fillRect(8, -W / 2, L * 0.7, W);
    ctx.beginPath();
    ctx.moveTo(8 + L * 0.15, -W / 2);
    ctx.lineTo(8 + L * 0.45, -W * 1.2);
    ctx.lineTo(8 + L * 0.45, W / 2);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(8, -W / 2, L * 0.75, W);
    ctx.fillStyle = w.accent;
    ctx.fillRect(8 + L * 0.55, -W * 1.1, 6, W * 0.7);
    ctx.fillStyle = "#222";
    ctx.fillRect(8 + L * 0.7, -1.5, L * 0.25, 3);
  }

  if (muzzleFlash) {
    const tip = w.muzzleForward - 4;
    const g = ctx.createRadialGradient(tip, 0, 0, tip, 0, 14);
    g.addColorStop(0, "rgba(255,230,120,0.95)");
    g.addColorStop(0.4, "rgba(255,140,40,0.55)");
    g.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(tip, 0, 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPerson34(
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
  const bodyDir = aimDir(p.angle);
  let legDir = moveDir(p.vx ?? 0, p.vy ?? 0, bodyDir);
  // strafe: pernas vs mira > 90°
  let da = Math.abs(((dirAngle(legDir) - p.angle + Math.PI) % (Math.PI * 2)) - Math.PI);
  if (da > Math.PI / 2 && speed > 25) {
    /* keep legDir from movement */
  } else {
    legDir = bodyDir;
  }

  const bob = speed > 20 ? Math.sin(tMs * 0.02 + p.id) * 1.2 : 0;
  const idleScale = speed < 25 ? 1 + Math.sin(tMs * 0.004 + p.id) * 0.01 : 1;
  const runPhase = speed > 25 ? (tMs * 0.012 * (speed / 180)) % (Math.PI * 2) : 0;
  const legSwing = Math.sin(runPhase) * Math.min(5, speed / 50);
  const bodyKick = isSelf ? feel.bodyKick * 1.5 : 0;
  const gunKick = isSelf ? feel.gunKick : 0;
  const kickX = -Math.cos(p.angle) * bodyKick;
  const kickY = -Math.sin(p.angle) * bodyKick;

  if (!p.alive) ctx.globalAlpha = 0.35;

  ctx.fillStyle = LOSPEC.shadow;
  ctx.beginPath();
  ctx.ellipse(
    p.x + LIGHT_DIR.x * 8 + kickX,
    p.y + LIGHT_DIR.y * 8 + kickY,
    11,
    6,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.save();
  ctx.translate(p.x + kickX, p.y + bob + kickY);
  ctx.scale(1, idleScale);

  // --- pernas (dir do movimento) ---
  ctx.save();
  ctx.rotate(dirAngle(legDir) + Math.PI / 2); // 3/4: “frente” do sprite pra baixo-ish
  ctx.fillStyle = look.shoes;
  ctx.fillRect(-5, 8 + legSwing, 4, 5);
  ctx.fillRect(1, 8 - legSwing, 4, 5);
  ctx.fillStyle = look.pants;
  ctx.fillRect(-6, 2 + legSwing * 0.4, 5, 9);
  ctx.fillRect(1, 2 - legSwing * 0.4, 5, 9);
  ctx.restore();

  // --- tronco (dir da mira quantizada) ---
  ctx.save();
  ctx.rotate(dirAngle(bodyDir) + Math.PI / 2);
  ctx.fillStyle = look.shirt;
  ctx.fillRect(-8, -8, 16, 12);
  // ombros
  ctx.fillRect(-11, -6, 5, 7);
  ctx.fillRect(6, -6, 5, 7);
  // cabeça
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(0, -12, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look.hair;
  ctx.beginPath();
  ctx.arc(0, -14, 5.5, Math.PI * 1.1, Math.PI * 1.9);
  ctx.fill();
  ctx.restore();

  // --- arma (mira contínua) ---
  drawWeaponLayer(ctx, p.weapon, p.angle, gunKick, muzzle && isSelf);

  if (isSelf) {
    ctx.strokeStyle = "rgba(77,155,230,0.65)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-14, -20, 28, 36);
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

export function tickFeel(feel: FeelState, dtMs: number, origin?: { x: number; y: number; angle: number }) {
  feel.gunKick = Math.max(0, feel.gunKick - dtMs / 90);
  feel.bodyKick = Math.max(0, feel.bodyKick - dtMs / 60);
  feel.shake *= Math.exp(-dtMs / 40);
  if (feel.shake < 0.05) feel.shake = 0;
  feel.shells = feel.shells
    .map((s) => {
      if (origin && s.life === 400) {
        const m = muzzlePoint(origin.x, origin.y, origin.angle, weaponOf(0));
        s.x = m.x;
        s.y = m.y;
      }
      return {
        ...s,
        x: s.x + s.vx * (dtMs / 1000),
        y: s.y + s.vy * (dtMs / 1000),
        vy: s.vy + 280 * (dtMs / 1000),
        life: s.life - dtMs,
      };
    })
    .filter((s) => s.life > 0);
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

  ctx.setTransform(scale, 0, 0, scale, ox + sx * scale, oy + sy * scale);

  drawGround(ctx);
  drawSolids(ctx);
  drawDoors(ctx, view.doorsBits, view.doorAnim);

  // throwables
  for (const t of view.throwables) {
    ctx.fillStyle = "#c8a35a";
    ctx.beginPath();
    ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  const selfMuzzle = view.flashes.some((f) => f.t > 30);

  if (view.local) {
    drawPerson34(ctx, { ...view.local, id: view.selfId }, tMs, true, selfMuzzle, view.feel);
  }
  for (const r of view.remotes) {
    const muzzle = view.events.some((e) => e.kind === "shot" && e.a === r.id);
    drawPerson34(
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

  if (view.flashBlind > 0) {
    ctx.fillStyle = `rgba(255,255,255,${view.flashBlind})`;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  }

  void doorsFromBits;
}
