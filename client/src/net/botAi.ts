/**
 * botAi.ts — bots que NÃO congelam na parede: sempre deslizam / flanqueiam / atiram.
 */
import { ARENA_H, ARENA_W, PLAYER_R } from "../../../shared/constants";
import { WEAPONS, weaponOf } from "../../../shared/gear";
import { DOOR_DEFS, hitsSolid, resolveWalls } from "../../../shared/map";
import type { PlayerInput } from "../../../shared/protocol";
import type { SimPlayer } from "../../../shared/sim";
import type { Enemy } from "../../../shared/enemies";

type Style = "aggressive" | "tactical" | "trickster";

export interface BotMemory {
  style: Style;
  strafeSign: number;
  nextStrafeAt: number;
  nextBurstAt: number;
  nextThrowAt: number;
  nextCastAt: number;
  nextFlankAt: number;
  nextWeaponAt: number;
  flankX: number;
  flankY: number;
  stuckFrames: number;
  lastX: number;
  lastY: number;
  slideDx: number;
  slideDy: number;
  slideUntil: number;
  lastTargetHp: number;
  preferredWeapon: number;
}

const mem = new Map<number, BotMemory>();

function styleOf(id: number): Style {
  const s = id % 3;
  if (s === 0) return "aggressive";
  if (s === 1) return "tactical";
  return "trickster";
}

function memory(id: number, now: number): BotMemory {
  let m = mem.get(id);
  if (!m) {
    m = {
      style: styleOf(id),
      strafeSign: id % 2 === 0 ? 1 : -1,
      nextStrafeAt: now,
      nextBurstAt: now,
      nextThrowAt: now + 600 + id * 300,
      nextCastAt: now + 300,
      nextFlankAt: now,
      nextWeaponAt: now,
      flankX: 0,
      flankY: 0,
      stuckFrames: 0,
      lastX: 0,
      lastY: 0,
      slideDx: 0,
      slideDy: 0,
      slideUntil: 0,
      lastTargetHp: 100,
      preferredWeapon: id % WEAPONS.length,
    };
    mem.set(id, m);
  }
  return m;
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function normAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function hasLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  doorBits: number,
): boolean {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(4, Math.floor(dist / 18));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (hitsSolid(ax + (bx - ax) * t, ay + (by - ay) * t, 2, doorBits)) return false;
  }
  return true;
}

/** Direção livre? look curto pra não “ver” parede falsa. */
function canStep(x: number, y: number, ux: number, uy: number, doorBits: number, look = 20): boolean {
  return (
    !hitsSolid(x + ux * look, y + uy * look, PLAYER_R * 0.7, doorBits) &&
    !hitsSolid(x + ux * (look * 0.5), y + uy * (look * 0.5), PLAYER_R * 0.7, doorBits)
  );
}

function freeNormal(x: number, y: number, doorBits: number): { nx: number; ny: number } | null {
  let nx = 0;
  let ny = 0;
  const d = PLAYER_R + 6;
  const probes: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.7, -0.7],
    [-0.7, -0.7],
  ];
  for (const [px, py] of probes) {
    if (hitsSolid(x + px * d, y + py * d, 3, doorBits)) {
      nx -= px;
      ny -= py;
    }
  }
  const n = Math.hypot(nx, ny);
  if (n < 0.15) return null;
  return { nx: nx / n, ny: ny / n };
}

/**
 * Sempre devolve uma direção caminhável (nunca 0,0 se houver qualquer saída).
 * Pontua 16 rumos + intenção + slide atual.
 */
function steerAlways(
  x: number,
  y: number,
  wantDx: number,
  wantDy: number,
  goalX: number,
  goalY: number,
  doorBits: number,
  m: BotMemory,
  now: number,
  botId: number,
): { dx: number; dy: number } {
  const wantM = Math.hypot(wantDx, wantDy);
  const wx = wantM > 0.01 ? wantDx / wantM : 0;
  const wy = wantM > 0.01 ? wantDy / wantM : 0;
  const toGx = goalX - x;
  const toGy = goalY - y;
  const gDist = Math.hypot(toGx, toGy) || 1;
  const gx = toGx / gDist;
  const gy = toGy / gDist;

  type Cand = { dx: number; dy: number; score: number };
  const cands: Cand[] = [];

  const push = (dx: number, dy: number, bonus = 0) => {
    const mag = Math.hypot(dx, dy);
    if (mag < 0.05) return;
    const ux = dx / mag;
    const uy = dy / mag;
    if (!canStep(x, y, ux, uy, doorBits)) return;
    const alignWant = ux * wx + uy * wy;
    const alignGoal = ux * gx + uy * gy;
    const n = freeNormal(x, y, doorBits);
    const awayWall = n ? ux * n.nx + uy * n.ny : 0;
    cands.push({
      dx: ux,
      dy: uy,
      score: alignWant * 50 + alignGoal * 35 + awayWall * 25 + bonus,
    });
  };

  const n = freeNormal(x, y, doorBits);

  // perto da parede: mantém slide travado (anti-tremor)
  if (
    n &&
    now < m.slideUntil &&
    Math.hypot(m.slideDx, m.slideDy) > 0.2 &&
    canStep(x, y, m.slideDx, m.slideDy, doorBits)
  ) {
    return { dx: m.slideDx, dy: m.slideDy };
  }

  // intenção
  push(wx, wy, 10);
  // slide estável
  if (now < m.slideUntil) push(m.slideDx, m.slideDy, 18);
  // tangentes à intenção
  push(-wy * m.strafeSign, wx * m.strafeSign, 8);
  push(wy * m.strafeSign, -wx * m.strafeSign, 5);
  // 16 direções
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + botId * 0.2;
    push(Math.cos(a), Math.sin(a), 0);
  }
  // normal da parede (sair do canto)
  if (n) {
    push(n.nx, n.ny, 24);
    push(n.nx * 0.6 + gx * 0.4, n.ny * 0.6 + gy * 0.4, 14);
  }

  if (cands.length === 0) {
    // último recurso estável — NÃO orbitar no tempo (causava tremor)
    if (n) {
      m.slideDx = n.nx;
      m.slideDy = n.ny;
      m.slideUntil = now + 550;
      return { dx: n.nx, dy: n.ny };
    }
    if (Math.hypot(m.slideDx, m.slideDy) > 0.1) {
      return { dx: m.slideDx, dy: m.slideDy };
    }
    return { dx: gx, dy: gy };
  }

  cands.sort((a, b) => b.score - a.score);
  const best = cands[0]!;
  // trava slide mais tempo pra não oscilar
  if (now >= m.slideUntil || Math.hypot(m.slideDx - best.dx, m.slideDy - best.dy) > 1.05) {
    m.slideDx = best.dx;
    m.slideDy = best.dy;
    m.slideUntil = now + (n ? 520 : 380);
  } else if (canStep(x, y, m.slideDx, m.slideDy, doorBits)) {
    return { dx: m.slideDx, dy: m.slideDy };
  }
  return { dx: best.dx, dy: best.dy };
}

function nearestDoor(
  x: number,
  y: number,
  doorBits: number,
  onlyClosed: boolean,
): { x: number; y: number; dist: number; open: boolean } | null {
  let best: { x: number; y: number; dist: number; open: boolean } | null = null;
  for (const d of DOOR_DEFS) {
    const open = !!(doorBits & (1 << d.id));
    if (onlyClosed && open) continue;
    const cx = d.tx * 32 + 16;
    const cy = d.ty * 32 + 16;
    const dist = Math.hypot(x - cx, y - cy);
    if (!best || dist < best.dist) best = { x: cx, y: cy, dist, open };
  }
  return best;
}

function pickWeapon(bot: SimPlayer, dist: number, style: Style, m: BotMemory, now: number): number {
  if (now < m.nextWeaponAt) return m.preferredWeapon;

  const has = (id: number) => {
    if (bot.weapon === id) return bot.mag + bot.reserve > 0;
    const slot = bot.ammoBank?.[id];
    return slot ? slot.mag + slot.reserve > 0 : true;
  };

  let prefer: number[];
  if (dist < 140) prefer = [4, 5, 0, 3];
  else if (dist < 320) prefer = style === "aggressive" ? [3, 1, 5, 2] : [1, 2, 3, 5];
  else prefer = [2, 1, 6, 3];

  for (const id of prefer) {
    if (id < WEAPONS.length && has(id)) {
      if (id !== m.preferredWeapon) {
        m.preferredWeapon = id;
        m.nextWeaponAt = now + 1800;
      }
      return id;
    }
  }
  return bot.weapon;
}

function pickFlank(
  bot: SimPlayer,
  target: SimPlayer,
  doorBits: number,
  m: BotMemory,
  now: number,
): { x: number; y: number } {
  if (now < m.nextFlankAt && (m.flankX || m.flankY)) {
    // se flanco atual está em sólido, renova
    if (!hitsSolid(m.flankX, m.flankY, PLAYER_R, doorBits)) {
      return { x: m.flankX, y: m.flankY };
    }
  }
  let best = { x: target.x, y: target.y, score: -1e9 };
  const base = Math.atan2(bot.y - target.y, bot.x - target.x);
  for (let i = 0; i < 12; i++) {
    const a = base + ((i / 12) * 2 - 1) * Math.PI + i * 0.15;
    const radius = 120 + (i % 4) * 50;
    const px = clamp(target.x + Math.cos(a) * radius, 80, ARENA_W - 80);
    const py = clamp(target.y + Math.sin(a) * radius, 80, ARENA_H - 80);
    if (hitsSolid(px, py, PLAYER_R, doorBits)) continue;
    const los = hasLineOfSight(px, py, target.x, target.y, doorBits) ? 150 : 0;
    const travel = Math.hypot(px - bot.x, py - bot.y);
    const score = los - travel * 0.1 + Math.abs(normAngle(a - base)) * 20;
    if (score > best.score) best = { x: px, y: py, score };
  }
  m.flankX = best.x;
  m.flankY = best.y;
  m.nextFlankAt = now + 500;
  return { x: best.x, y: best.y };
}

export function botInput(
  bot: SimPlayer,
  target: SimPlayer | undefined,
  doorBits: number,
  seq: number,
  serverTime: number,
  enemies?: Enemy[],
): PlayerInput {
  // Survival FFA: mira no mais perto — zumbi OU player (equipe é escolha de vocês)
  let coopFocus: { x: number; y: number; id: number } | null = null;
  let bestD = Infinity;
  if (enemies && enemies.length > 0) {
    for (const e of enemies) {
      if (e.state === 3 || e.hp <= 0) continue;
      const d = Math.hypot(e.x - bot.x, e.y - bot.y);
      if (d < bestD) {
        bestD = d;
        coopFocus = { x: e.x, y: e.y, id: e.id };
      }
    }
  }
  if (target?.alive) {
    const d = Math.hypot(target.x - bot.x, target.y - bot.y);
    // às vezes prioriza player (traição / FFA); senão só se mais perto que zumbi
    const preferPlayer = d < bestD * 0.85 || (d < 220 && Math.random() < 0.35);
    if (preferPlayer || !coopFocus) {
      bestD = d;
      coopFocus = null; // usa o player real como fightTarget abaixo
    }
  }

  const m = memory(bot.id, serverTime);
  let weapon = m.preferredWeapon;
  let dx = 0;
  let dy = 0;
  let aim = bot.angle;
  let fire = false;
  let sprint = false;
  let reload = false;
  let use = false;
  let cast = false;
  let thr = 0;
  let ability = bot.ability ?? 0;
  let goalX = bot.x;
  let goalY = bot.y;

  // alvo: zumbi sintético OU player humano/bots
  const fightTarget: SimPlayer | undefined = coopFocus
    ? ({
        id: 250,
        name: "enemy",
        x: coopFocus.x,
        y: coopFocus.y,
        angle: 0,
        vx: 0,
        vy: 0,
        hp: 55,
        kills: 0,
        alive: true,
        lastProcessedInputSeq: 0,
        fireCd: 0,
        weapon: 0,
        stamina: 100,
        mag: 1,
        reserve: 1,
        ability: 0,
        abilityCdUntil: 0,
        stunnedUntil: 0,
        respawnAt: 0,
        inputQueue: [],
        throwCd: 0,
        flashUntil: 0,
        reloadingUntil: 0,
        ammoBank: [],
      } as SimPlayer)
    : target;

  const stunned = (bot.stunnedUntil ?? 0) > serverTime;
  const reloading = (bot.reloadingUntil ?? 0) > serverTime;
  const abilityReady = (bot.abilityCdUntil ?? 0) <= serverTime;
  const canThrow = (bot.throwCd ?? 0) <= 0;

  if (hitsSolid(bot.x, bot.y, PLAYER_R * 0.9, doorBits)) {
    const free = resolveWalls(bot.x, bot.y, PLAYER_R, doorBits);
    const escX = free.x - bot.x;
    const escY = free.y - bot.y;
    const em = Math.hypot(escX, escY) || 1;
    return {
      seq,
      dx: escX / em,
      dy: escY / em,
      aim: bot.angle,
      fire: false,
      sprint: true,
      use: true,
      reload: false,
      cast: false,
      weapon: bot.weapon,
      throw: 0,
      ability: bot.ability ?? 0,
      clientTime: performance.now(),
    };
  }

  // flash: foge pra espaço aberto / porta — sempre andando
  if ((bot.flashUntil ?? 0) > serverTime) {
    const door = nearestDoor(bot.x, bot.y, doorBits, true);
    const n = freeNormal(bot.x, bot.y, doorBits);
    if (door && door.dist < 200) {
      dx = door.x - bot.x;
      dy = door.y - bot.y;
      goalX = door.x;
      goalY = door.y;
      if (door.dist < 40) use = true;
    } else if (n) {
      dx = n.nx;
      dy = n.ny;
      goalX = bot.x + n.nx * 80;
      goalY = bot.y + n.ny * 80;
    } else {
      dx = Math.cos(serverTime * 0.01 + bot.id);
      dy = Math.sin(serverTime * 0.01 + bot.id);
    }
    const slid = steerAlways(bot.x, bot.y, dx, dy, goalX, goalY, doorBits, m, serverTime, bot.id);
    return {
      seq,
      dx: slid.dx,
      dy: slid.dy,
      aim: bot.angle + (Math.random() - 0.5) * 1.5,
      fire: false,
      sprint: true,
      use,
      reload: false,
      cast: false,
      weapon: bot.weapon,
      throw: 0,
      ability: bot.ability ?? 0,
      clientTime: performance.now(),
    };
  }

  if (bot.mag <= 0 && bot.reserve > 0) reload = true;

  if (fightTarget?.alive) {
    const target = fightTarget;
    const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
    const los = hasLineOfSight(bot.x, bot.y, target.x, target.y, doorBits);
    weapon = pickWeapon(bot, dist, m.style, m, serverTime);
    const wpn = weaponOf(weapon);

    const leadT = clamp(dist / Math.max(180, wpn.bulletSpeed), 0, 0.5);
    const tx = target.x + target.vx * leadT;
    const ty = target.y + target.vy * leadT;
    const desiredAim = Math.atan2(ty - bot.y, tx - bot.x);
    let da = normAngle(desiredAim - bot.angle);
    // vira rápido pra não ficar “burro” parado mirando errado
    aim = bot.angle + clamp(da, -1.1, 1.1);
    da = normAngle(desiredAim - aim);

    if (serverTime >= m.nextStrafeAt) {
      m.strafeSign *= -1;
      m.nextStrafeAt = serverTime + 400 + Math.random() * 600;
    }

    const toTx = (target.x - bot.x) / Math.max(1, dist);
    const toTy = (target.y - bot.y) / Math.max(1, dist);
    const sideX = -toTy * m.strafeSign;
    const sideY = toTx * m.strafeSign;
    m.lastTargetHp = target.hp;

    goalX = target.x;
    goalY = target.y;

    if (stunned) {
      dx = -toTx * 0.3 + sideX;
      dy = -toTy * 0.3 + sideY;
      sprint = true;
    } else if (!los) {
      const flank = pickFlank(bot, target, doorBits, m, serverTime);
      goalX = flank.x;
      goalY = flank.y;
      const door = nearestDoor(bot.x, bot.y, doorBits, true);
      const flankDist = Math.hypot(flank.x - bot.x, flank.y - bot.y);
      if (door && door.dist < 140 && door.dist < flankDist * 0.85) {
        dx = door.x - bot.x;
        dy = door.y - bot.y;
        goalX = door.x;
        goalY = door.y;
        if (door.dist < 40) use = true;
      } else {
        dx = flank.x - bot.x;
        dy = flank.y - bot.y;
      }
      sprint = true;
    } else if (bot.hp < 30) {
      // recua mas continua orbitando (não cola na parede)
      dx = -toTx * 0.55 + sideX * 1.0;
      dy = -toTy * 0.55 + sideY * 1.0;
      goalX = bot.x + dx * 100;
      goalY = bot.y + dy * 100;
      sprint = true;
    } else if (dist > 260) {
      dx = toTx * 0.9 + sideX * 0.45;
      dy = toTy * 0.9 + sideY * 0.45;
      sprint = true;
    } else if (dist < 110) {
      dx = -toTx * 0.7 + sideX * 0.85;
      dy = -toTy * 0.7 + sideY * 0.85;
    } else {
      // combate: sempre orbitando — nunca parado
      const push = m.style === "aggressive" ? 0.35 : 0.1;
      dx = sideX * 1.0 + toTx * push;
      dy = sideY * 1.0 + toTy * push;
      sprint = m.style === "aggressive";
    }

    // Q — jato perto; Gigante se alvo longe/preso
    if (
      !stunned &&
      abilityReady &&
      serverTime >= m.nextCastAt &&
      los &&
      Math.abs(da) < 0.55
    ) {
      if (dist > 160 && dist < 420 && (m.style === "aggressive" || !!coopFocus)) {
        ability = 1;
        cast = true;
        m.nextCastAt = serverTime + 26000;
      } else if (dist < 240 && dist > 35) {
        ability = 0;
        if (m.style === "aggressive" || dist < 170 || target.hp < 60 || !!coopFocus) {
          cast = true;
          m.nextCastAt = serverTime + 6500;
        }
      }
    }

    // granadas (só PvP — no co-op evita FF de splash)
    if (!stunned && canThrow && serverTime >= m.nextThrowAt && Math.abs(da) < 0.55) {
      if (m.style === "trickster" && dist > 80 && dist < 250) {
        thr = 2;
        m.nextThrowAt = serverTime + 3200;
      } else if (dist > 100 && dist < 300 && (los || m.style === "tactical")) {
        thr = m.style === "aggressive" ? (Math.random() < 0.5 ? 4 : 1) : 1;
        m.nextThrowAt = serverTime + 4000;
      }
    }

    // TIRO — independente de estar “travado” no movimento
    const aimOk = Math.abs(da) < (wpn.pellets > 1 ? 0.55 : 0.32);
    const rangeOk = dist < (weapon === 6 ? 720 : weapon === 4 ? 300 : 580);
    if (
      !stunned &&
      !reloading &&
      bot.mag > 0 &&
      los &&
      aimOk &&
      rangeOk &&
      !cast &&
      thr === 0 &&
      serverTime >= m.nextBurstAt
    ) {
      fire = true;
      // não cancela reload flag se ainda tem bala
      reload = false;
      const cd = wpn.cooldownMs;
      m.nextBurstAt =
        serverTime + (cd < 100 ? 40 + Math.random() * 40 : cd * (0.7 + Math.random() * 0.35));
    }
  } else {
    const roam = serverTime * 0.0015 + bot.id * 2.1;
    goalX = ARENA_W * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(roam)));
    goalY = ARENA_H * (0.3 + 0.4 * (0.5 + 0.5 * Math.cos(roam * 0.8)));
    dx = goalX - bot.x;
    dy = goalY - bot.y;
    aim = Math.atan2(dy, dx);
    sprint = true;
  }

  // bordas da arena
  if (bot.x < 90) dx = Math.max(dx, 0.6);
  if (bot.x > ARENA_W - 90) dx = Math.min(dx, -0.6);
  if (bot.y < 90) dy = Math.max(dy, 0.6);
  if (bot.y > ARENA_H - 90) dy = Math.min(dy, -0.6);

  // se intenção sumiu, força órbita
  if (Math.hypot(dx, dy) < 0.08 && fightTarget?.alive) {
    const a = Math.atan2(fightTarget.y - bot.y, fightTarget.x - bot.x) + m.strafeSign * (Math.PI / 2);
    dx = Math.cos(a);
    dy = Math.sin(a);
    goalX = bot.x + dx * 80;
    goalY = bot.y + dy * 80;
  }

  const slid = steerAlways(bot.x, bot.y, dx, dy, goalX, goalY, doorBits, m, serverTime, bot.id);
  dx = slid.dx;
  dy = slid.dy;
  sprint = sprint || Math.hypot(dx, dy) > 0.3;

  // porta perto — só ABRE (nunca fecha: toggle trancava o player)
  const door = nearestDoor(bot.x, bot.y, doorBits, true);
  if (door && door.dist < 48) use = true;

  // stuck → inverte e corre
  const moved = Math.hypot(bot.x - m.lastX, bot.y - m.lastY);
  if (moved < 1.0) m.stuckFrames++;
  else m.stuckFrames = Math.max(0, m.stuckFrames - 3);
  m.lastX = bot.x;
  m.lastY = bot.y;

  if (m.stuckFrames > 8) {
    m.strafeSign *= -1;
    m.nextFlankAt = 0;
    const closed = nearestDoor(bot.x, bot.y, doorBits, true);
    const anyDoor = closed ?? nearestDoor(bot.x, bot.y, doorBits, false);
    const ex = anyDoor ? anyDoor.x - bot.x : Math.cos(bot.id);
    const ey = anyDoor ? anyDoor.y - bot.y : Math.sin(bot.id);
    const escape = steerAlways(
      bot.x,
      bot.y,
      ex,
      ey,
      anyDoor ? anyDoor.x : bot.x + ex * 120,
      anyDoor ? anyDoor.y : bot.y + ey * 120,
      doorBits,
      m,
      serverTime,
      bot.id,
    );
    dx = escape.dx;
    dy = escape.dy;
    sprint = true;
    if (closed && closed.dist < 64) use = true;
    if (m.stuckFrames > 22) m.stuckFrames = 0;
  }

  return {
    seq,
    dx,
    dy,
    aim,
    fire,
    sprint,
    use,
    reload,
    cast,
    weapon,
    throw: thr,
    ability,
    clientTime: performance.now(),
  };
}

export function clearBotMemory() {
  mem.clear();
}
