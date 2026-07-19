/**
 * sim.ts â€” simulaÃ§Ã£o autoritativa: movimento, armas, mapa, portas.
 */
import {
  ARENA_H,
  ARENA_W,
  BULLET_R,
  DOOR_AUTO_CLOSE_MS,
  DOOR_USE_RADIUS,
  MATCH_MS,
  MAX_HP,
  MAX_PLAYERS,
  MOVE_SPEED,
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
  WEAPONS,
  fullAmmoBank,
  muzzlePoint,
  weaponOf,
  type AmmoStack,
  type ThrowId,
} from "./gear";
import {
  BUILDINGS,
  DOOR_DEFS,
  MAP_H,
  MAP_W,
  SOLID,
  TILE,
  buildingAt,
  doorsBitfield,
  hitsSolid,
  isSolidTile,
  resolveWalls,
} from "./map";
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
  life: number;
  owner: number;
}
export interface SmokeCloud {
  x: number;
  y: number;
  r: number;
  life: number;
}
export interface SimDoor {
  id: number;
  open: boolean;
  /** serverTime do Ãºltimo uso; auto-close */
  lastUseAt: number;
}
export interface SimPlayer extends PlayerState {
  name: string;
  respawnAt: number;
  inputQueue: PlayerInput[];
  throwCd: number;
  flashUntil: number;
  /** serverTime em que o reload termina; 0 = idle */
  reloadingUntil: number;
  /** munição independente por arma */
  ammoBank: AmmoStack[];
}

/** PlayerState + campos locais de sim/prediction (não vão no snapshot). */
export type SimLikePlayer = PlayerState & {
  throwCd?: number;
  reloadingUntil?: number;
  ammoBank?: AmmoStack[];
};

function ensureAmmoBank(p: SimLikePlayer): AmmoStack[] {
  if (!p.ammoBank || p.ammoBank.length !== WEAPONS.length) {
    p.ammoBank = fullAmmoBank();
    p.ammoBank[p.weapon] = { mag: p.mag, reserve: p.reserve };
  }
  return p.ammoBank;
}

function syncAmmoToBank(p: SimLikePlayer) {
  const bank = ensureAmmoBank(p);
  bank[p.weapon] = { mag: p.mag, reserve: p.reserve };
}
export interface AmmoDrop {
  id: number;
  x: number;
  y: number;
  amount: number;
  spawnAt: number;
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
  doors: SimDoor[];
  ammoDrops: AmmoDrop[];
  nextBulletId: number;
  nextThrowId: number;
  nextDropId: number;
  nextDropAt: number;
  events: TickEvent[];
}
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
export function doorBitsOf(sim: GameSim): number {
  return doorsBitfield(sim.doors);
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
    doors: DOOR_DEFS.map((d) => ({ id: d.id, open: false, lastUseAt: 0 })),
    ammoDrops: [],
    nextBulletId: 1,
    nextThrowId: 1,
    nextDropId: 1,
    nextDropAt: 0,
    events: [],
  };
}
export function addPlayer(sim: GameSim, name: string): SimPlayer | null {
  if (sim.players.length >= MAX_PLAYERS) return null;
  const id = sim.players.length;
  const spawn = SPAWNS[id % SPAWNS.length]!;
  const weapon = id % WEAPONS.length;
  const ammoBank = fullAmmoBank();
  const ammo = ammoBank[weapon]!;
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
    weapon,
    stamina: MAX_STAMINA,
    mag: ammo.mag,
    reserve: ammo.reserve,
    ammoBank,
    respawnAt: 0,
    inputQueue: [],
    throwCd: 0,
    flashUntil: 0,
    reloadingUntil: 0,
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
function tryUseDoor(sim: GameSim, p: SimPlayer) {
  let best: SimDoor | null = null;
  let bestD = DOOR_USE_RADIUS;
  for (const def of DOOR_DEFS) {
    const door = sim.doors.find((d) => d.id === def.id);
    if (!door) continue;
    const cx = def.tx * 32 + 16;
    const cy = def.ty * 32 + 16;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestD) {
      bestD = d;
      best = door;
    }
  }
  if (!best) return;
  best.open = !best.open;
  best.lastUseAt = sim.serverTime;
  const def = DOOR_DEFS.find((d) => d.id === best!.id)!;
  sim.events.push({
    kind: best.open ? "doorOpen" : "doorClose",
    a: p.id,
    b: best.id,
    x: def.tx * 32 + 16,
    y: def.ty * 32 + 16,
  });
}
export function applyInput(
  p: SimLikePlayer,
  input: PlayerInput,
  dt: number,
  opts?: {
    spawnBullet?: (angle: number, x: number, y: number, weapon: number) => void;
    spawnThrow?: (kind: number, angle: number, x: number, y: number) => void;
    onUse?: () => void;
    onReloadStart?: () => void;
    onEmptyClick?: () => void;
    doorBits?: number;
    serverTime?: number;
  },
) {
  if (!p.alive) {
    p.lastProcessedInputSeq = input.seq;
    return;
  }
  const now = opts?.serverTime ?? 0;
  if (p.reloadingUntil == null) p.reloadingUntil = 0;
  const bank = ensureAmmoBank(p);
  const prevWeapon = p.weapon;
  const nextWeapon = clamp(input.weapon | 0, 0, WEAPONS.length - 1);
  if (nextWeapon !== prevWeapon) {
    bank[prevWeapon] = { mag: p.mag, reserve: p.reserve };
    p.weapon = nextWeapon;
    p.reloadingUntil = 0;
    const slot = bank[nextWeapon]!;
    p.mag = slot.mag;
    p.reserve = slot.reserve;
  }
  const wpn = weaponOf(p.weapon);
  const bits = opts?.doorBits ?? 0;

  // completar reload
  if (p.reloadingUntil > 0 && now >= p.reloadingUntil) {
    const need = wpn.magSize - p.mag;
    const take = Math.min(need, p.reserve);
    p.mag += take;
    p.reserve -= take;
    p.reloadingUntil = 0;
  }

  let mx = clamp(input.dx, -1, 1);
  let my = clamp(input.dy, -1, 1);
  const moveMag = Math.hypot(mx, my);
  if (moveMag > 1) {
    mx /= moveMag;
    my /= moveMag;
  }
  const moving = moveMag > 0.1;
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
  const pos = resolveWalls(p.x, p.y, PLAYER_R, bits);
  p.x = pos.x;
  p.y = pos.y;
  p.angle = input.aim;
  p.fireCd = Math.max(0, p.fireCd - dt * 1000);
  p.throwCd = Math.max(0, (p.throwCd ?? 0) - dt * 1000);
  if (input.use) opts?.onUse?.();

  const reloading = p.reloadingUntil > 0 && now < p.reloadingUntil;

  const startReload = () => {
    if (reloading || p.reserve <= 0 || p.mag >= wpn.magSize) return;
    p.reloadingUntil = now + wpn.reloadMs;
    opts?.onReloadStart?.();
  };

  if (input.reload) startReload();

  if (input.fire && p.fireCd <= 0) {
    if (reloading) {
      // trava
    } else if (p.mag <= 0) {
      opts?.onEmptyClick?.();
      startReload();
      p.fireCd = 180;
    } else {
      p.mag -= 1;
      p.fireCd = wpn.cooldownMs;
      const m = muzzlePoint(p.x, p.y, p.angle, wpn);
      opts?.spawnBullet?.(p.angle, m.x, m.y, p.weapon);
    }
  }
  if (input.throw >= 1 && input.throw <= 4 && (p.throwCd ?? 0) <= 0) {
    p.throwCd = 2200;
    const m = muzzlePoint(p.x, p.y, p.angle, wpn);
    opts?.spawnThrow?.(input.throw, p.angle, m.x, m.y);
  }
  syncAmmoToBank(p);
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
  sim.doors = DOOR_DEFS.map((d) => ({ id: d.id, open: false, lastUseAt: 0 }));
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
    p.weapon = i % WEAPONS.length;
    p.ammoBank = fullAmmoBank();
    const ammo = p.ammoBank[p.weapon]!;
    p.mag = ammo.mag;
    p.reserve = ammo.reserve;
    p.reloadingUntil = 0;
    p.respawnAt = 0;
    p.flashUntil = 0;
    p.inputQueue = [];
    p.lastProcessedInputSeq = 0;
  });
  sim.ammoDrops = [];
  sim.nextDropAt = 2000 + Math.random() * 4000;
  return true;
}
export type HitTestFn = (
  shooterId: number,
  ox: number,
  oy: number,
  angle: number,
  clientTime: number,
  doorBits: number,
) => { hitId: number; x: number; y: number } | null;
function damagePlayer(
  sim: GameSim,
  target: SimPlayer,
  amount: number,
  killerId: number,
  weaponId = 0,
  cause: "weapon" | "explosion" | "fire" = "weapon",
) {
  if (!target.alive) return;
  target.hp -= amount;
  const causeCode = cause === "explosion" ? 100 : cause === "fire" ? 101 : weaponId;
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
      weaponId: causeCode,
    });
  }
}
function detonate(sim: GameSim, t: ThrowableState) {
  const def = THROWS[t.kind as Exclude<ThrowId, 0>];
  if (!def) return;
  if (t.kind === 1) {
    sim.events.push({ kind: "explode", a: t.owner, b: 0, x: t.x, y: t.y });
    for (const p of sim.players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d < def.radius) {
        const falloff = 1 - d / def.radius;
        damagePlayer(sim, p, Math.round(55 * falloff), t.owner, 0, "explosion");
        sim.events.push({
          kind: "hit",
          a: t.owner,
          b: p.id,
          x: p.x,
          y: p.y,
          weaponId: 100,
        });
      }
    }
  } else if (t.kind === 2) {
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
    sim.events.push({ kind: "fire", a: t.owner, b: 0, x: t.x, y: t.y });
    sim.fires.push({ x: t.x, y: t.y, r: def.radius, life: 5000, owner: t.owner });
  }
}
function spawnPellets(
  sim: GameSim,
  p: SimPlayer,
  angle: number,
  ox: number,
  oy: number,
  weapon: number,
  clientTime: number,
  hitTest?: HitTestFn | null,
) {
  const wpn = weaponOf(weapon);
  const bits = doorBitsOf(sim);
  const n = wpn.pellets;
  for (let i = 0; i < n; i++) {
    let spread = (Math.random() - 0.5) * 2 * wpn.spread;
    if (n > 1) {
      // leque determinÃ­stico + jitter leve
      spread = ((i / (n - 1)) - 0.5) * 2 * wpn.spread + (Math.random() - 0.5) * wpn.spread * 0.15;
    }
    const a = angle + spread;
    if (i === 0) {
      sim.events.push({ kind: "shot", a: p.id, b: weapon, x: ox, y: oy, weaponId: weapon });
    }
    if (hitTest) {
      const hit = hitTest(p.id, ox, oy, a, clientTime, bits);
      if (hit) {
        const target = sim.players.find((t) => t.id === hit.hitId);
        if (target && target.alive) {
          damagePlayer(sim, target, wpn.damage, p.id, weapon);
          sim.events.push({
            kind: "hit",
            a: p.id,
            b: target.id,
            x: hit.x,
            y: hit.y,
            weaponId: weapon,
          });
          continue;
        }
      }
    }
    sim.bullets.push({
      id: sim.nextBulletId++,
      owner: p.id,
      x: ox,
      y: oy,
      px: ox,
      py: oy,
      vx: Math.cos(a) * wpn.bulletSpeed,
      vy: Math.sin(a) * wpn.bulletSpeed,
      weapon,
      life: wpn.bulletLifeMs,
    });
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
  const bits = doorBitsOf(sim);
  for (const p of sim.players) {
    if (!p.alive && p.respawnAt > 0 && sim.serverTime >= p.respawnAt) {
      const s = SPAWNS[Math.floor(Math.random() * SPAWNS.length)]!;
      p.x = s.x;
      p.y = s.y;
      p.hp = MAX_HP;
      p.alive = true;
      p.stamina = MAX_STAMINA;
      p.ammoBank = fullAmmoBank();
      const ammo = p.ammoBank[p.weapon]!;
      p.mag = ammo.mag;
      p.reserve = ammo.reserve;
      p.reloadingUntil = 0;
      p.respawnAt = 0;
      sim.events.push({ kind: "respawn", a: p.id, b: 0, x: p.x, y: p.y });
    }
  }
  for (const p of sim.players) {
    if (p.inputQueue.length === 0) continue;
    let latest = p.inputQueue[0]!;
    let wantFire = false;
    let wantThrow = 0;
    let wantUse = false;
    let wantReload = false;
    while (p.inputQueue.length) {
      latest = p.inputQueue.shift()!;
      if (latest.fire) wantFire = true;
      if (latest.throw >= 1) wantThrow = latest.throw;
      if (latest.use) wantUse = true;
      if (latest.reload) wantReload = true;
    }
    const merged = {
      ...latest,
      fire: wantFire,
      throw: wantThrow,
      use: wantUse,
      reload: wantReload,
    };
    applyInput(p, merged, dt, {
      doorBits: bits,
      serverTime: sim.serverTime,
      onUse: () => tryUseDoor(sim, p),
      onReloadStart: () => {
        sim.events.push({
          kind: "reloadStart",
          a: p.id,
          b: p.weapon,
          x: p.x,
          y: p.y,
          weaponId: p.weapon,
        });
      },
      spawnBullet: (angle, x, y, weapon) => {
        spawnPellets(sim, p, angle, x, y, weapon, merged.clientTime, hitTest);
      },
      spawnThrow: (kind, angle, x, y) => {
        const def = THROWS[kind as Exclude<ThrowId, 0>];
        if (!def) return;
        sim.throwables.push({
          id: sim.nextThrowId++,
          kind,
          owner: p.id,
          x,
          y,
          vx: Math.cos(angle) * def.throwSpeed,
          vy: Math.sin(angle) * def.throwSpeed,
          fuse: def.fuseMs,
        });
      },
    });
  }

  // drops de munição
  tickAmmoDrops(sim, dt);
  // auto-close portas
  for (const door of sim.doors) {
    if (!door.open || door.lastUseAt <= 0) continue;
    let someoneNear = false;
    const def = DOOR_DEFS.find((d) => d.id === door.id)!;
    const cx = def.tx * 32 + 16;
    const cy = def.ty * 32 + 16;
    for (const p of sim.players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - cx, p.y - cy) < DOOR_USE_RADIUS + 10) {
        someoneNear = true;
        door.lastUseAt = sim.serverTime;
        break;
      }
    }
    if (!someoneNear && sim.serverTime - door.lastUseAt >= DOOR_AUTO_CLOSE_MS) {
      door.open = false;
      sim.events.push({
        kind: "doorClose",
        a: 255,
        b: door.id,
        x: cx,
        y: cy,
      });
    }
  }
  const bitsAfter = doorBitsOf(sim);
  const keepB: BulletState[] = [];
  for (const b of sim.bullets) {
    b.px = b.x;
    b.py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.life > 0) {
      b.life -= dt * 1000;
      if (b.life <= 0) continue;
    }
    if (b.x < 0 || b.y < 0 || b.x > ARENA_W || b.y > ARENA_H) continue;
    if (hitsSolid(b.x, b.y, BULLET_R, bitsAfter)) {
      sim.events.push({
        kind: "hit",
        a: b.owner,
        b: 255,
        x: b.x,
        y: b.y,
        weaponId: b.weapon,
      });
      continue;
    }
    let consumed = false;
    const dmg = weaponOf(b.weapon).damage;
    for (const t of sim.players) {
      if (!t.alive || t.id === b.owner) continue;
      if (Math.hypot(t.x - b.x, t.y - b.y) < PLAYER_R + BULLET_R) {
        damagePlayer(sim, t, dmg, b.owner, b.weapon);
        sim.events.push({
          kind: "hit",
          a: b.owner,
          b: t.id,
          x: b.x,
          y: b.y,
          weaponId: b.weapon,
        });
        consumed = true;
        break;
      }
    }
    if (!consumed) keepB.push(b);
  }
  sim.bullets = keepB;
  const keepT: ThrowableState[] = [];
  for (const t of sim.throwables) {
    t.vx *= 0.985;
    t.vy *= 0.985;
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    const pos = resolveWalls(t.x, t.y, 4, bitsAfter);
    if (pos.x !== t.x) t.vx *= -0.4;
    if (pos.y !== t.y) t.vy *= -0.4;
    t.x = pos.x;
    t.y = pos.y;
    t.fuse -= dt * 1000;
    if (t.fuse <= 0) detonate(sim, t);
    else keepT.push(t);
  }
  sim.throwables = keepT;
  sim.fires = sim.fires.filter((f) => {
    f.life -= dt * 1000;
    if (f.life <= 0) return false;
    for (const p of sim.players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - f.x, p.y - f.y) < f.r) {
        damagePlayer(sim, p, 12 * dt, f.owner, 0, "fire");
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
      mag: p.mag,
      reserve: p.reserve,
    })),
    bullets: sim.bullets.map((b) => ({ ...b })),
    throwables: sim.throwables.map((t) => ({ ...t })),
    events: [...sim.events],
    doorsBits: doorBitsOf(sim),
  };
}

function pickDropTile(): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const tx = 1 + Math.floor(Math.random() * (MAP_W - 2));
    const ty = 1 + Math.floor(Math.random() * (MAP_H - 2));
    if (isSolidTile(SOLID[ty]![tx]!)) continue;
    const inside = buildingAt(tx * TILE + 16, ty * TILE + 16);
    if (inside != null && Math.random() < 0.5) continue;
    // evita spawn em interior se quiser open field — 50% já filtrado
    void BUILDINGS;
    return { x: tx * TILE + 16, y: ty * TILE + 16 };
  }
  return null;
}

function tickAmmoDrops(sim: GameSim, dt: number) {
  // despawn 30s
  sim.ammoDrops = sim.ammoDrops.filter((d) => {
    if (sim.serverTime - d.spawnAt > 30000) return false;
    return true;
  });

  if (sim.nextDropAt <= 0) sim.nextDropAt = sim.serverTime + 12000 + Math.random() * 6000;
  if (sim.serverTime >= sim.nextDropAt && sim.ammoDrops.length < 5) {
    const pos = pickDropTile();
    if (pos) {
      const amount = 20 + Math.floor(Math.random() * 21);
      const drop: AmmoDrop = {
        id: sim.nextDropId++,
        x: pos.x,
        y: pos.y,
        amount,
        spawnAt: sim.serverTime,
      };
      sim.ammoDrops.push(drop);
      sim.events.push({
        kind: "dropSpawn",
        a: drop.id,
        b: amount,
        x: drop.x,
        y: drop.y,
      });
    }
    sim.nextDropAt = sim.serverTime + 12000 + Math.random() * 6000;
  }

  for (const p of sim.players) {
    if (!p.alive) continue;
    const wpn = weaponOf(p.weapon);
    for (let i = sim.ammoDrops.length - 1; i >= 0; i--) {
      const d = sim.ammoDrops[i]!;
      if (Math.hypot(p.x - d.x, p.y - d.y) > 16) continue;
      if (p.reserve >= wpn.reserveMax) continue;
      const room = wpn.reserveMax - p.reserve;
      const take = Math.min(room, d.amount);
      p.reserve += take;
      syncAmmoToBank(p);
      sim.events.push({
        kind: "dropTaken",
        a: d.id,
        b: p.id,
        x: d.x,
        y: d.y,
      });
      sim.ammoDrops.splice(i, 1);
    }
  }
  void dt;
}
export function clonePlayerState(p: PlayerState): PlayerState {
  const src = p as SimLikePlayer;
  const out: SimLikePlayer = { ...p };
  if (src.ammoBank) {
    out.ammoBank = src.ammoBank.map((a) => ({ mag: a.mag, reserve: a.reserve }));
  }
  if (src.reloadingUntil != null) out.reloadingUntil = src.reloadingUntil;
  return out;
}
