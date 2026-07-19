/**
 * render.ts — rua noturna top-down, corpo completo, armas, luz/sombra.
 */
import {
  ARENA_H,
  ARENA_W,
  OBSTACLES,
  PLAYER_R,
  STREET_LAMPS,
} from "../../../shared/constants";
import { LOADOUTS, WEAPONS, weaponOf } from "../../../shared/gear";
import type {
  BulletState,
  PlayerState,
  ThrowableState,
  TickEvent,
} from "../../../shared/protocol";
import { getCharSprite, kenneyReady, pickPose } from "./sprites";

/** Paleta Lospec Resurrect-64 (tons usados na rua / UI do canvas). */
export const LOSPEC = {
  asphalt: "#313638",
  sidewalk: "#374e4a",
  line: "#f9c22b",
  night: "#2e222f",
  lamp: "#fbb954",
  shadow: "rgba(46,34,47,0.55)",
};

export interface MuzzleFlash {
  x: number;
  y: number;
  angle: number;
  t: number;
}

export interface FxPool {
  x: number;
  y: number;
  r: number;
  t: number;
  kind: "fire" | "smoke" | "explode";
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
  flashBlind: number; // 0..1
  events: TickEvent[];
}

/** Luz principal da rua (lua / poste dominante) — direção da sombra. */
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

function drawStreet(ctx: CanvasRenderingContext2D, tMs: number) {
  // asfalto (Lospec)
  ctx.fillStyle = LOSPEC.asphalt;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  // calçadas
  ctx.fillStyle = LOSPEC.sidewalk;
  ctx.fillRect(0, 0, 48, ARENA_H);
  ctx.fillRect(ARENA_W - 48, 0, 48, ARENA_H);
  ctx.fillRect(0, 0, ARENA_W, 36);
  ctx.fillRect(0, ARENA_H - 36, ARENA_W, 36);

  // faixa central
  ctx.strokeStyle = "rgba(249,194,43,0.4)";
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 16]);
  ctx.beginPath();
  ctx.moveTo(ARENA_W / 2, 40);
  ctx.lineTo(ARENA_W / 2, ARENA_H - 40);
  ctx.stroke();
  ctx.setLineDash([]);

  // faixa de pedestre
  ctx.fillStyle = "rgba(199,220,208,0.14)";
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(420 + i * 14, 300, 8, 50);
  }

  // rachaduras
  ctx.fillStyle = "rgba(46,34,47,0.35)";
  for (let i = 0; i < 30; i++) {
    const x = (i * 137 + tMs * 0.00002) % ARENA_W;
    const y = (i * 89) % ARENA_H;
    ctx.fillRect(x, y, 4 + (i % 3), 2);
  }
}

function drawObstacle(ctx: CanvasRenderingContext2D, o: (typeof OBSTACLES)[0]) {
  const kind = o.kind ?? "box";
  // sombra no chão (offset pela luz)
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(o.x + LIGHT_DIR.x * 8, o.y + LIGHT_DIR.y * 8, o.w, o.h);

  if (kind === "car") {
    ctx.fillStyle = "#2a3540";
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = "#1a2228";
    ctx.fillRect(o.x + 6, o.y + 6, o.w - 12, o.h - 12);
    ctx.fillStyle = "#4a8";
    ctx.fillRect(o.x + 4, o.y + 2, 10, 4);
    ctx.fillRect(o.x + o.w - 14, o.y + 2, 10, 4);
    ctx.fillStyle = "#111";
    ctx.fillRect(o.x + 8, o.y + o.h - 5, 12, 4);
    ctx.fillRect(o.x + o.w - 20, o.y + o.h - 5, 12, 4);
  } else if (kind === "dumpster") {
    ctx.fillStyle = "#1F4A3D";
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = "#2a6352";
    ctx.fillRect(o.x, o.y, o.w, 8);
    ctx.fillStyle = "#0f2a22";
    ctx.fillRect(o.x + 6, o.y + 14, o.w - 12, 10);
  } else {
    ctx.fillStyle = "#3a3228";
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = "#5a4a38";
    ctx.fillRect(o.x, o.y, o.w, 6);
    ctx.fillStyle = "#2F5FD0";
    ctx.fillRect(o.x + 8, o.y + 14, 12, 8);
  }
}

function drawWeapon(
  ctx: CanvasRenderingContext2D,
  weaponId: number,
  muzzleFlash: boolean,
) {
  const w = weaponOf(weaponId);
  const L = w.length;
  const W = w.width;
  // corpo da arma (ao longo do +X, personagem olha pra +X após rotate)
  ctx.fillStyle = w.color;
  if (weaponId === 0) {
    // pistola — curta, guarda
    ctx.fillRect(6, -W / 2, L * 0.55, W);
    ctx.fillStyle = w.accent;
    ctx.fillRect(6 + L * 0.35, -W * 0.8, 4, W * 1.6);
    ctx.fillRect(4, 0, 6, W * 1.2);
  } else if (weaponId === 1) {
    // M4A1 — handguard + carry handle
    ctx.fillRect(8, -W / 2, L * 0.75, W);
    ctx.fillStyle = w.accent;
    ctx.fillRect(8 + L * 0.2, -W * 0.9, L * 0.35, W * 0.5);
    ctx.fillRect(8 + L * 0.55, -W * 1.1, 6, W * 0.7); // miras
    ctx.fillStyle = "#222";
    ctx.fillRect(8 + L * 0.7, -1.5, L * 0.25, 3); // cano
  } else if (weaponId === 2) {
    // M16 — mais longo, triangular handguard
    ctx.fillStyle = w.color;
    ctx.fillRect(8, -W / 2, L * 0.7, W);
    ctx.beginPath();
    ctx.moveTo(8 + L * 0.15, -W / 2);
    ctx.lineTo(8 + L * 0.45, -W * 1.2);
    ctx.lineTo(8 + L * 0.45, W / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = w.accent;
    ctx.fillRect(8 + L * 0.65, -1.5, L * 0.3, 3);
  } else {
    // AK-47 — madeira + curva do pente
    ctx.fillStyle = w.color;
    ctx.fillRect(8, -W / 2, L * 0.65, W);
    ctx.fillStyle = "#3a2818";
    ctx.fillRect(8, -W / 2, L * 0.22, W); // coronha madeira
    ctx.fillStyle = w.accent;
    ctx.fillRect(8 + L * 0.35, 0, 8, W * 1.4); // pente curvo
    ctx.fillRect(8 + L * 0.6, -1.5, L * 0.28, 3);
  }

  if (muzzleFlash) {
    const tip = 8 + L;
    const g = ctx.createRadialGradient(tip, 0, 0, tip, 0, 14);
    g.addColorStop(0, "rgba(255,230,120,0.95)");
    g.addColorStop(0.4, "rgba(255,140,40,0.55)");
    g.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(tip, 0, 14, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPerson(
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
) {
  const look = LOADOUTS[p.id % LOADOUTS.length]!;
  const speed = Math.hypot(p.vx ?? 0, p.vy ?? 0);
  // informations.MD: balanço leve ao correr
  const bob = speed > 20 ? Math.sin(tMs * 0.02 + p.id) * 2.2 : 0;
  const runLean = Math.min(0.12, speed / 1000);

  if (!p.alive) ctx.globalAlpha = 0.35;

  const shx = LIGHT_DIR.x * 10;
  const shy = LIGHT_DIR.y * 10;
  ctx.fillStyle = LOSPEC.shadow;
  ctx.beginPath();
  ctx.ellipse(p.x + shx, p.y + shy, PLAYER_R * 1.05, PLAYER_R * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  const pose = pickPose(p.weapon, speed);
  const sprite = kenneyReady() ? getCharSprite(p.id, pose) : null;

  if (sprite) {
    // Kenney PNG aponta pra cima → +PI/2 pro aim (+X)
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.rotate(p.angle + Math.PI / 2);
    ctx.transform(1, 0, runLean * 0.25, 1 - runLean * 0.04, 0, 0);
    const sc = 0.85;
    const w = sprite.naturalWidth * sc;
    const h = sprite.naturalHeight * sc;
    ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
    if (muzzle && isSelf) {
      const tip = h * 0.42;
      const g = ctx.createRadialGradient(0, -tip, 0, 0, -tip, 16);
      g.addColorStop(0, "rgba(255,230,120,0.95)");
      g.addColorStop(0.4, "rgba(255,140,40,0.5)");
      g.addColorStop(1, "rgba(255,80,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -tip, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    if (isSelf) {
      ctx.strokeStyle = "rgba(77,155,230,0.75)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    return;
  }

  // fallback se sprites ainda não carregaram
  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.rotate(p.angle);
  ctx.transform(1, 0, runLean * 0.3, 1 - runLean * 0.05, 0, 0);
  ctx.fillStyle = look.shoes;
  ctx.fillRect(-5, 7, 5, 5);
  ctx.fillRect(1, 7, 5, 5);
  ctx.fillStyle = look.pants;
  ctx.fillRect(-7, 1, 14, 8);
  ctx.fillStyle = look.shirt;
  ctx.fillRect(-8, -7, 16, 10);
  ctx.fillRect(-10, -5, 4, 6);
  ctx.fillRect(6, -5, 4, 6);
  ctx.fillStyle = look.skin;
  ctx.fillRect(4, -3, 8, 4);
  drawWeapon(ctx, p.weapon, muzzle && isSelf);
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(0, -2, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look.hair;
  ctx.beginPath();
  ctx.arc(0, -3.5, 5.2, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawLighting(
  ctx: CanvasRenderingContext2D,
  view: RenderView,
  extraLights: { x: number; y: number; r: number; a: number }[],
) {
  // noite base
  ctx.fillStyle = "rgba(4,8,14,0.42)";
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  ctx.globalCompositeOperation = "lighter";
  for (const lamp of STREET_LAMPS) {
    const g = ctx.createRadialGradient(lamp.x, lamp.y, 4, lamp.x, lamp.y, 130);
    g.addColorStop(0, "rgba(255,220,140,0.28)");
    g.addColorStop(0.4, "rgba(255,180,80,0.1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 130, 0, Math.PI * 2);
    ctx.fill();
    // poste
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#333";
    ctx.fillRect(lamp.x - 2, lamp.y - 8, 4, 12);
    ctx.fillStyle = "#e8c060";
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y - 8, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "lighter";
  }

  for (const L of extraLights) {
    const g = ctx.createRadialGradient(L.x, L.y, 2, L.x, L.y, L.r);
    g.addColorStop(0, `rgba(255,200,100,${L.a})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(L.x, L.y, L.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

export function drawFrame(ctx: CanvasRenderingContext2D, view: RenderView, tMs: number) {
  const { canvas } = ctx;
  const scale = Math.min(canvas.width / ARENA_W, canvas.height / ARENA_H);
  const ox = (canvas.width - ARENA_W * scale) / 2;
  const oy = (canvas.height - ARENA_H * scale) / 2;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#050608";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, ox, oy);

  drawStreet(ctx, tMs);
  for (const o of OBSTACLES) drawObstacle(ctx, o);

  // fx chão (fumaça / fogo) antes dos players
  for (const f of view.fx) {
    if (f.kind === "smoke") {
      const a = Math.min(0.55, f.t / 6000);
      const g = ctx.createRadialGradient(f.x, f.y, 10, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(160,160,160,${a})`);
      g.addColorStop(1, "rgba(80,80,80,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (f.kind === "fire") {
      const flicker = 0.7 + Math.sin(tMs * 0.02 + f.x) * 0.3;
      const g = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, f.r * flicker);
      g.addColorStop(0, "rgba(255,220,80,0.85)");
      g.addColorStop(0.4, "rgba(255,100,20,0.55)");
      g.addColorStop(1, "rgba(180,40,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * flicker, 0, Math.PI * 2);
      ctx.fill();
    } else if (f.kind === "explode") {
      const a = Math.max(0, f.t / 400);
      ctx.fillStyle = `rgba(255,180,60,${a})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1.2 - a), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // throwables em voo
  for (const t of view.throwables) {
    ctx.fillStyle = t.kind === 4 ? "#c45c20" : t.kind === 2 ? "#e8e0a0" : t.kind === 3 ? "#888" : "#3a5a30";
    ctx.beginPath();
    ctx.arc(t.x, t.y, 4, 0, Math.PI * 2);
    ctx.fill();
    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(t.x + 3, t.y + 4, 4, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // balas
  for (const b of view.bullets) {
    const grad = ctx.createLinearGradient(b.px, b.py, b.x, b.y);
    grad.addColorStop(0, "rgba(255,220,120,0)");
    grad.addColorStop(1, "rgba(255,220,120,0.95)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.px, b.py);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  const muzzleAt = new Set(
    view.flashes.map((f) => `${Math.round(f.x)}:${Math.round(f.y)}`),
  );

  for (const r of view.remotes) {
    if (r.id === view.selfId) continue;
    drawPerson(
      ctx,
      { ...r, weapon: r.weapon ?? 0 },
      tMs,
      false,
      false,
    );
  }
  if (view.local) {
    const nearMuzzle = view.flashes.some(
      (f) => Math.hypot(f.x - view.local!.x, f.y - view.local!.y) < 40,
    );
    drawPerson(ctx, { ...view.local, id: view.selfId }, tMs, true, nearMuzzle);
  }
  void muzzleAt;
  void WEAPONS;

  // luzes extras: muzzle + fogo
  const extras: { x: number; y: number; r: number; a: number }[] = [];
  for (const f of view.flashes) {
    extras.push({ x: f.x, y: f.y, r: 50, a: 0.35 * (f.t / 50) });
  }
  for (const f of view.fx) {
    if (f.kind === "fire") extras.push({ x: f.x, y: f.y, r: f.r * 1.4, a: 0.22 });
  }
  drawLighting(ctx, view, extras);

  // flashbang: tela branca (como print) → visão volta aos poucos
  if (view.flashBlind > 0.01) {
    // curva: começa opaco e demora a abrir (sensação de recuperação)
    const t = Math.min(1, Math.max(0, view.flashBlind));
    const alpha = Math.pow(t, 0.55); // permanece mais branco no início
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    // leve “véu” quente enquanto ainda está cego
    if (alpha > 0.15) {
      ctx.fillStyle = `rgba(255,250,230,${alpha * 0.2})`;
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    }
  }
}

export function pushFlashesFromEvents(flashes: MuzzleFlash[], events: TickEvent[]) {
  for (const e of events) {
    if (e.kind === "shot") flashes.push({ x: e.x, y: e.y, angle: 0, t: 50 });
  }
}

export function pushFxFromEvents(fx: FxPool[], events: TickEvent[]) {
  for (const e of events) {
    if (e.kind === "explode") fx.push({ x: e.x, y: e.y, r: 70, t: 400, kind: "explode" });
    if (e.kind === "smoke") fx.push({ x: e.x, y: e.y, r: 90, t: 6000, kind: "smoke" });
    if (e.kind === "fire") fx.push({ x: e.x, y: e.y, r: 55, t: 5000, kind: "fire" });
  }
}

export function tickFlashes(flashes: MuzzleFlash[], dtMs: number) {
  for (const f of flashes) f.t -= dtMs;
  return flashes.filter((f) => f.t > 0);
}

export function tickFx(fx: FxPool[], dtMs: number) {
  for (const f of fx) f.t -= dtMs;
  return fx.filter((f) => f.t > 0);
}
