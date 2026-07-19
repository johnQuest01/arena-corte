/**
 * sim.ts — simulação autoritativa: movimento, armas, stamina, throwables.
 */
import {
  ARENA_H,
  ARENA_W,
  BULLET_R,
  MATCH_MS,
  MAX_HP,
  MAX_PLAYERS,
  MOVE_SPEED,
  OBSTACLES,
  PLAYER_R,
  RESPAWN_MS,
  SPAWNS,
  TICK_MS,
} from "./constants";
import {
  MAX_STAMINA,
  SPRINT_MULT,
  STAMINA_DRAIN_PER_S,
  STAMINA_REGEN_PER_S,
  THROWS,
  TIRED_MULT,
  TIRED_THRESHOLD,
  weaponOf,
  type ThrowId,
} from "./gear";
import type {
  BulletState,
  PlayerInput,
  PlayerState,
  Snapshot,
  ThrowableState,
  TickEvent,
} from "./protocol";

export interface FirePool {
  x: number;
  y: number;
  r: number;
  life: number; // ms
  owner: number;
}

export interface SmokeCloud {
  x: number;
  y: number;
  r: number;
  life: number;
}

export interface SimPlayer extends PlayerState {
  name: string;
  respawnAt: number;
  inputQueue: PlayerInput[];
  throwCd: number;
  flashUntil: number; // serverTime cego
}

export interface GameSim {
  tick: number;
  serverTime: number;
  matchLeftMs: number;
  phase: number;
  players: SimPlayer[];
  bullets: BulletState[];
  throwables: ThrowableState[];
  fires: FirePool[];
  smokes: SmokeCloud[];
  nextBulletId: number;
  nextThrowId: number;
  events: TickEvent[];
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function circleRect(cx: number, cy: number, r: number, o: { x: number; y: number; w: number; h: number }) {
  const nx = clamp(cx, o.x, o.x + o.w);
  const ny = clamp(cy, o.y, o.y + o.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

function resolveWalls(x: number, y: number, r: number): { x: number; y: number } {
  let px = clamp(x, r, ARENA_W - r);
  let py = clamp(y, r, ARENA_H - r);
  for (const o of OBSTACLES) {
    if (!circleRect(px, py, r, o)) continue;
    const left = Math.abs(px - o.x);
    const right = Math.abs(px - (o.x + o.w));
    const top = Math.abs(py - o.y);
    const bottom = Math.abs(py - (o.y + o.h));
    const m = Math.min(left, right, top, bottom);
    if (m === left) px = o.x - r;
    else if (m === right) px = o.x + o.w + r;
    else if (m === top) py = o.y - r;
    else py = o.y + o.h + r;
    px = clamp(px, r, ARENA_W - r);
    py = clamp(py, r, ARENA_H - r);
  }
  return { x: px, y: py };
}

export function createSim(): GameSim {
  return {
    tick: 0,
    serverTime: 0,
    matchLeftMs: MATCH_MS,
    phase: 0,
    players: [],
    bullets: [],
    throwables: [],
    fires: [],
    smokes: [],
    nextBulletId: 1,
    nextThrowId: 1,
    events: [],
  };
}

export function addPlayer(sim: GameSim, name: string): SimPlayer | null {
  if (sim.players.length >= MAX_PLAYERS) return null;
  const id = sim.players.length;
  const spawn = SPAWNS[id % SPAWNS.length]!;
  const p: SimPlayer = {
    id,
    name,
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    vx: 0,
    vy: 0,
    hp: MAX_HP,
    kills: 0,
    alive: true,
    lastProcessedInputSeq: 0,
    fireCd: 0,
    weapon: id % 4,
    stamina: MAX_STAMINA,
    respawnAt: 0,
    inputQueue: [],
    throwCd: 0,
    flashUntil: 0,
  };
  sim.players.push(p);
  return p;
}

export function removePlayer(sim: GameSim, id: number) {
  sim.players = sim.players.filter((p) => p.id !== id);
  sim.bullets = sim.bullets.filter((b) => b.owner !== id);
}

export function queueInput(sim: GameSim, playerId: number, input: PlayerInput) {
  const p = sim.players.find((x) => x.id === playerId);
  if (!p) return;
  if (input.seq <= p.lastProcessedInputSeq) return;
  p.inputQueue.push(input);
  p.inputQueue.sort((a, b) => a.seq - b.seq);
}

export function applyInput(
  p: Pick<
    SimPlayer,
    | "x"
    | "y"
    | "angle"
    | "vx"
    | "vy"
    | "alive"
    | "fireCd"
    | "lastProcessedInputSeq"
    | "weapon"
    | "stamina"
  > & { throwCd?: number },
  input: PlayerInput,
  dt: number,
  opts?: {
    spawnBullet?: (angle: number, x: number, y: number, weapon: number) => void;
    spawnThrow?: (kind: number, angle: number, x: number, y: number) => void;
  },
) {
  if (!p.alive) {
    p.lastProcessedInputSeq = input.seq;
    return;
  }

  p.weapon = clamp(input.weapon | 0, 0, 3);
  const wpn = weaponOf(p.weapon);

  let mx = clamp(input.dx, -1, 1);
  let my = clamp(input.dy, -1, 1);
  const mag = Math.hypot(mx, my);
  if (mag > 1) {
    mx /= mag;
    my /= mag;
  }

  const moving = mag > 0.1;
  const canSprint = input.sprint && moving && p.stamina > TIRED_THRESHOLD;
  let speedMult = 1;
  if (canSprint) {
    speedMult = SPRINT_MULT;
    p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN_PER_S * dt);
  } else {
    p.stamina = Math.min(MAX_STAMINA, p.stamina + STAMINA_REGEN_PER_S * dt);
    if (p.stamina < TIRED_THRESHOLD) speedMult = TIRED_MULT;
  }

  const speed = MOVE_SPEED * speedMult;
  p.vx = mx * speed;
  p.vy = my * speed;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  const pos = resolveWalls(p.x, p.y, PLAYER_R);
  p.x = pos.x;
  p.y = pos.y;
  p.angle = input.aim;
  p.fireCd = Math.max(0, p.fireCd - dt * 1000);
  p.throwCd = Math.max(0, (p.throwCd ?? 0) - dt * 1000);

  if (input.fire && p.fireCd <= 0) {
    p.fireCd = wpn.cooldownMs;
    // spread só no host (opts.spawnBullet); prediction não precisa
    opts?.spawnBullet?.(p.angle, p.x, p.y, p.weapon);
  }

  if (input.throw >= 1 && input.throw <= 4 && (p.throwCd ?? 0) <= 0) {
    p.throwCd = 2200;
    opts?.spawnThrow?.(input.throw, p.angle, p.x, p.y);
  }

  p.lastProcessedInputSeq = input.seq;
}

export function startMatch(sim: GameSim) {
  if (sim.players.length < 2) return false;
  sim.phase = 1;
  sim.matchLeftMs = MATCH_MS;
  sim.tick = 0;
  sim.bullets = [];
  sim.throwables = [];
  sim.fires = [];
  sim.smokes = [];
  sim.events = [];
  sim.players.forEach((p, i) => {
    const s = SPAWNS[i % SPAWNS.length]!;
    p.x = s.x;
    p.y = s.y;
    p.hp = MAX_HP;
    p.alive = true;
    p.kills = 0;
    p.fireCd = 0;
    p.throwCd = 0;
    p.stamina = MAX_STAMINA;
    p.weapon = i % 4;
    p.respawnAt = 0;
    p.flashUntil = 0;
    p.inputQueue = [];
    p.lastProcessedInputSeq = 0;
  });
  return true;
}

export type HitTestFn = (
  shooterId: number,
  ox: number,
  oy: number,
  angle: number,
  clientTime: number,
) => { hitId: number; x: number; y: number } | null;

function damagePlayer(sim: GameSim, target: SimPlayer, amount: number, killerId: number) {
  if (!target.alive) return;
  target.hp -= amount;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.respawnAt = sim.serverTime + RESPAWN_MS;
    const killer = sim.players.find((k) => k.id === killerId);
    if (killer && killer.id !== target.id) killer.kills++;
    sim.events.push({
      kind: "death",
      a: killerId,
      b: target.id,
      x: target.x,
      y: target.y,
    });
  }
}

function detonate(sim: GameSim, t: ThrowableState) {
  const def = THROWS[t.kind as Exclude<ThrowId, 0>];
  if (!def) return;

  if (t.kind === 1) {
    // granada — dano em área
    sim.events.push({ kind: "explode", a: t.owner, b: 0, x: t.x, y: t.y });
    for (const p of sim.players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d < def.radius) {
        const falloff = 1 - d / def.radius;
        damagePlayer(sim, p, Math.round(55 * falloff), t.owner);
        sim.events.push({ kind: "hit", a: t.owner, b: p.id, x: p.x, y: p.y });
      }
    }
  } else if (t.kind === 2) {
    // flash — cada vítima recebe evento (b = id); a tela dela fica branca
    for (const p of sim.players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - t.x, p.y - t.y) < def.radius) {
        p.flashUntil = sim.serverTime + 2800;
        sim.events.push({ kind: "flash", a: t.owner, b: p.id, x: t.x, y: t.y });
      }
    }
  } else if (t.kind === 3) {
    sim.events.push({ kind: "smoke", a: t.owner, b: 0, x: t.x, y: t.y });
    sim.smokes.push({ x: t.x, y: t.y, r: def.radius, life: 6000 });
  } else if (t.kind === 4) {
    // molotov — poça de fogo
    sim.events.push({ kind: "fire", a: t.owner, b: 0, x: t.x, y: t.y });
    sim.fires.push({ x: t.x, y: t.y, r: def.radius, life: 5000, owner: t.owner });
  }
}

export function stepSim(sim: GameSim, dt = TICK_MS / 1000, hitTest?: HitTestFn | null) {
  sim.events = [];
  if (sim.phase !== 1) {
    sim.serverTime += dt * 1000;
    return;
  }

  sim.tick++;
  sim.serverTime += dt * 1000;
  sim.matchLeftMs = Math.max(0, sim.matchLeftMs - dt * 1000);

  for (const p of sim.players) {
    if (!p.alive && p.respawnAt > 0 && sim.serverTime >= p.respawnAt) {
      const s = SPAWNS[Math.floor(Math.random() * SPAWNS.length)]!;
      p.x = s.x;
      p.y = s.y;
      p.hp = MAX_HP;
      p.alive = true;
      p.stamina = MAX_STAMINA;
      p.respawnAt = 0;
      sim.events.push({ kind: "respawn", a: p.id, b: 0, x: p.x, y: p.y });
    }
  }

  for (const p of sim.players) {
    if (p.inputQueue.length === 0) continue;
    let latest = p.inputQueue[0]!;
    let wantFire = false;
    let wantThrow = 0;
    while (p.inputQueue.length) {
      latest = p.inputQueue.shift()!;
      if (latest.fire) wantFire = true;
      if (latest.throw >= 1) wantThrow = latest.throw;
    }
    const merged = { ...latest, fire: wantFire, throw: wantThrow };

    applyInput(p, merged, dt, {
      spawnBullet: (angle, x, y, weapon) => {
        const wpn = weaponOf(weapon);
        const spread = (Math.random() - 0.5) * 2 * wpn.spread;
        const a = angle + spread;
        const muzzle = PLAYER_R + 8;
        const bx = x + Math.cos(a) * muzzle;
        const by = y + Math.sin(a) * muzzle;
        sim.events.push({ kind: "shot", a: p.id, b: weapon, x: bx, y: by });

        if (hitTest) {
          const hit = hitTest(p.id, bx, by, a, merged.clientTime);
          if (hit) {
            const target = sim.players.find((t) => t.id === hit.hitId);
            if (target && target.alive) {
              damagePlayer(sim, target, wpn.damage, p.id);
              sim.events.push({ kind: "hit", a: p.id, b: target.id, x: hit.x, y: hit.y });
              return;
            }
          }
        }

        sim.bullets.push({
          id: sim.nextBulletId++,
          owner: p.id,
          x: bx,
          y: by,
          px: bx,
          py: by,
          vx: Math.cos(a) * wpn.bulletSpeed,
          vy: Math.sin(a) * wpn.bulletSpeed,
        });
      },
      spawnThrow: (kind, angle, x, y) => {
        const def = THROWS[kind as Exclude<ThrowId, 0>];
        if (!def) return;
        const ox = x + Math.cos(angle) * (PLAYER_R + 10);
        const oy = y + Math.sin(angle) * (PLAYER_R + 10);
        sim.throwables.push({
          id: sim.nextThrowId++,
          kind,
          owner: p.id,
          x: ox,
          y: oy,
          vx: Math.cos(angle) * def.throwSpeed,
          vy: Math.sin(angle) * def.throwSpeed,
          fuse: def.fuseMs,
        });
      },
    });
  }

  // balas
  const keepB: BulletState[] = [];
  for (const b of sim.bullets) {
    b.px = b.x;
    b.py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < 0 || b.y < 0 || b.x > ARENA_W || b.y > ARENA_H) continue;
    let hitWall = false;
    for (const o of OBSTACLES) {
      if (circleRect(b.x, b.y, BULLET_R, o)) {
        hitWall = true;
        break;
      }
    }
    if (hitWall) continue;
    let consumed = false;
    const owner = sim.players.find((p) => p.id === b.owner);
    const dmg = weaponOf(owner?.weapon ?? 0).damage;
    for (const t of sim.players) {
      if (!t.alive || t.id === b.owner) continue;
      if (Math.hypot(t.x - b.x, t.y - b.y) < PLAYER_R + BULLET_R) {
        damagePlayer(sim, t, dmg, b.owner);
        sim.events.push({ kind: "hit", a: b.owner, b: t.id, x: b.x, y: b.y });
        consumed = true;
        break;
      }
    }
    if (!consumed) keepB.push(b);
  }
  sim.bullets = keepB;

  // throwables — física: desaceleração (arrasto) + fuse
  const keepT: ThrowableState[] = [];
  for (const t of sim.throwables) {
    t.vx *= 0.985;
    t.vy *= 0.985;
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    const pos = resolveWalls(t.x, t.y, 4);
    if (pos.x !== t.x) t.vx *= -0.4;
    if (pos.y !== t.y) t.vy *= -0.4;
    t.x = pos.x;
    t.y = pos.y;
    t.fuse -= dt * 1000;
    if (t.fuse <= 0) detonate(sim, t);
    else keepT.push(t);
  }
  sim.throwables = keepT;

  // fogo (molotov) — dano contínuo
  sim.fires = sim.fires.filter((f) => {
    f.life -= dt * 1000;
    if (f.life <= 0) return false;
    for (const p of sim.players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - f.x, p.y - f.y) < f.r) {
        damagePlayer(sim, p, 12 * dt, f.owner);
      }
    }
    return true;
  });

  sim.smokes = sim.smokes.filter((s) => {
    s.life -= dt * 1000;
    return s.life > 0;
  });

  const leader = [...sim.players].sort((a, b) => b.kills - a.kills)[0];
  if (sim.matchLeftMs <= 0 || (leader && leader.kills >= 15)) {
    sim.phase = 2;
  }
}

export function toSnapshot(sim: GameSim): Snapshot {
  return {
    tick: sim.tick,
    serverTime: sim.serverTime,
    matchLeftMs: sim.matchLeftMs,
    phase: sim.phase,
    players: sim.players.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      angle: p.angle,
      vx: p.vx,
      vy: p.vy,
      hp: p.hp,
      kills: p.kills,
      alive: p.alive,
      lastProcessedInputSeq: p.lastProcessedInputSeq,
      fireCd: p.fireCd,
      weapon: p.weapon,
      stamina: p.stamina,
    })),
    bullets: sim.bullets.map((b) => ({ ...b })),
    throwables: sim.throwables.map((t) => ({ ...t })),
    events: [...sim.events],
  };
}

export function clonePlayerState(p: PlayerState): PlayerState {
  return { ...p };
}
