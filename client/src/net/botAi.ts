/**
 * botAi.ts — IA de bots no treino (seek, strafe, mira, reload).
 */
import { ARENA_H, ARENA_W } from "../../../shared/constants";
import { weaponOf } from "../../../shared/gear";
import { hitsSolid } from "../../../shared/map";
import type { PlayerInput } from "../../../shared/protocol";
import type { SimPlayer } from "../../../shared/sim";

export interface BotMemory {
  strafeSign: number;
  nextStrafeAt: number;
  nextBurstAt: number;
  coverBiasX: number;
  coverBiasY: number;
}

const mem = new Map<number, BotMemory>();

function memory(id: number, now: number): BotMemory {
  let m = mem.get(id);
  if (!m) {
    m = {
      strafeSign: id % 2 === 0 ? 1 : -1,
      nextStrafeAt: now,
      nextBurstAt: now + 400 + id * 200,
      coverBiasX: (id % 3) - 1,
      coverBiasY: ((id + 1) % 3) - 1,
    };
    mem.set(id, m);
  }
  return m;
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function hasLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  doorBits: number,
): boolean {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(4, Math.floor(dist / 16));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (hitsSolid(x, y, 2, doorBits)) return false;
  }
  return true;
}

/** Gera input de um bot para um tick. */
export function botInput(
  bot: SimPlayer,
  target: SimPlayer | undefined,
  doorBits: number,
  seq: number,
  serverTime: number,
): PlayerInput {
  const m = memory(bot.id, serverTime);
  const wpn = weaponOf(bot.weapon);

  let dx = 0;
  let dy = 0;
  let aim = bot.angle;
  let fire = false;
  let sprint = false;
  let reload = false;

  if (bot.mag <= 0 && bot.reserve > 0) reload = true;

  if (target?.alive) {
    const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
    const los = hasLineOfSight(bot.x, bot.y, target.x, target.y, doorBits);

    // lead leve na mira
    const lead = clamp(dist / Math.max(200, wpn.bulletSpeed), 0, 0.35);
    const tx = target.x + target.vx * lead;
    const ty = target.y + target.vy * lead;
    const desiredAim = Math.atan2(ty - bot.y, tx - bot.x);
    // suaviza mira (não aimbot perfeito)
    let da = desiredAim - bot.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    aim = bot.angle + clamp(da, -0.55, 0.55);

    if (serverTime >= m.nextStrafeAt) {
      m.strafeSign *= -1;
      m.nextStrafeAt = serverTime + 700 + Math.random() * 900;
    }

    const toTx = (tx - bot.x) / Math.max(1, dist);
    const toTy = (ty - bot.y) / Math.max(1, dist);
    const sideX = -toTy * m.strafeSign;
    const sideY = toTx * m.strafeSign;

    if (dist > 280) {
      // aproxima
      dx = toTx * 0.95 + sideX * 0.25;
      dy = toTy * 0.95 + sideY * 0.25;
      sprint = dist > 380;
    } else if (dist < 110) {
      // afasta
      dx = -toTx * 0.85 + sideX * 0.5;
      dy = -toTy * 0.85 + sideY * 0.5;
    } else {
      // strafe de combate
      dx = sideX * 0.9 + toTx * 0.1;
      dy = sideY * 0.9 + toTy * 0.1;
      // leve viés pra cobertura
      dx += m.coverBiasX * 0.15;
      dy += m.coverBiasY * 0.15;
    }

    // se sem LOS, tenta contornar em vez de atirar
    if (!los) {
      dx = toTx * 0.5 + sideX * 0.8;
      dy = toTy * 0.5 + sideY * 0.8;
      sprint = true;
    } else if (bot.mag > 0 && Math.abs(da) < 0.28 && dist < 520) {
      if (serverTime >= m.nextBurstAt) {
        fire = true;
        // rajada curta dependendo da arma
        const cd = wpn.cooldownMs;
        m.nextBurstAt = serverTime + (cd < 100 ? 80 + Math.random() * 40 : cd + Math.random() * 120);
      }
    }
  } else {
    // sem alvo: patrulha
    const roam = serverTime * 0.0015 + bot.id * 2.1;
    dx = Math.cos(roam) * 0.65;
    dy = Math.sin(roam * 0.85) * 0.65;
    aim = Math.atan2(dy, dx);
  }

  // evita cantos da arena
  if (bot.x < 80) dx = Math.max(dx, 0.4);
  if (bot.x > ARENA_W - 80) dx = Math.min(dx, -0.4);
  if (bot.y < 80) dy = Math.max(dy, 0.4);
  if (bot.y > ARENA_H - 80) dy = Math.min(dy, -0.4);

  const mag = Math.hypot(dx, dy);
  if (mag > 1) {
    dx /= mag;
    dy /= mag;
  }

  return {
    seq,
    dx,
    dy,
    aim,
    fire,
    sprint,
    use: false,
    reload,
    weapon: bot.weapon,
    throw: 0,
    clientTime: performance.now(),
  };
}

export function clearBotMemory() {
  mem.clear();
}
