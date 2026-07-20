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
  PLAYER_HIT_R,
  PLAYER_HIT_Y,
  PLAYER_R,
  RESPAWN_MS,
  SPAWNS,
  TICK_MS,
} from "./constants";
import {
  ABILITY_DROP_IDS,
  abilityOf,
  DASH_BURST_DT,
  DASH_MAX_CHARGES,
  isFrontalShieldHit,
  selectAbilityTargets,
  SHIELD_SPEED_MUL,
  SPRINT_BOOTS_SPEED_MUL,
  tickDashCharges,
  tryAutoRecoilCape,
  type AbilityCtx,
  type AbilityTargetRef,
} from "./abilities";
import {
  createWaveManager,
  damageEnemy,
  resetEnemyIds,
  GIANT_LIFE_MS,
  spawnGiant,
  startWaves,
  stepEnemies,
  stepGiants,
  stepWaves,
  toEnemyStates,
  type Enemy,
  type WaveManager,
  enemyOf,
} from "./enemies";
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
  moveAndSlide,
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
  /** Capa de Recuo: próximo auto-dodge permitido (não vai no wire) */
  dashAutoReadyAt?: number;
}

/** PlayerState + campos locais de sim/prediction (não vão no snapshot). */
export type SimLikePlayer = PlayerState & {
  throwCd?: number;
  reloadingUntil?: number;
  ammoBank?: AmmoStack[];
  flashUntil?: number;
  dashAutoReadyAt?: number;
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
export interface WeaponDrop {
  id: number;
  x: number;
  y: number;
  weaponId: number;
  mag: number;
  reserve: number;
  spawnAt: number;
}
export interface AbilityDrop {
  id: number;
  x: number;
  y: number;
  abilityId: number;
  spawnAt: number;
}
export interface GameSim {
  tick: number;
  serverTime: number;
  matchLeftMs: number;
  phase: number;
  /** 0 = PvP, 1 = COOP survival */
  mode: number;
  players: SimPlayer[];
  bullets: BulletState[];
  throwables: ThrowableState[];
  fires: FirePool[];
  smokes: SmokeCloud[];
  doors: SimDoor[];
  ammoDrops: AmmoDrop[];
  weaponDrops: WeaponDrop[];
  abilityDrops: AbilityDrop[];
  enemies: Enemy[];
  waves: WaveManager;
  nextBulletId: number;
  nextThrowId: number;
  nextDropId: number;
  nextDropAt: number;
  nextAbilityDropAt: number;
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
    mode: 0,
    players: [],
    bullets: [],
    throwables: [],
    fires: [],
    smokes: [],
    doors: DOOR_DEFS.map((d) => ({ id: d.id, open: false, lastUseAt: 0 })),
    ammoDrops: [],
    weaponDrops: [],
    abilityDrops: [],
    enemies: [],
    waves: createWaveManager(),
    nextBulletId: 1,
    nextThrowId: 1,
    nextDropId: 1,
    nextDropAt: 0,
    nextAbilityDropAt: 0,
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
    ability: 0,
    abilityCdUntil: 0,
    stunnedUntil: 0,
    speedBoostUntil: 0,
    shieldUntil: 0,
    dashCharges: DASH_MAX_CHARGES,
    dashRechargeAt: 0,
    dashUntil: 0,
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
/** Capa de Recuo estilo Cloak of Levitation — auto-fuga autoritativa. */
function tickAutoRecoilCapes(sim: GameSim, doorBits: number) {
  const now = sim.serverTime;
  for (const p of sim.players) {
    if (!p.alive || (p.ability ?? 0) !== 3) continue;
    if (p.stunnedUntil > 0 && now < p.stunnedUntil) continue;
    const did = tryAutoRecoilCape(p, now, sim.bullets, sim.enemies);
    if (!did) continue;
    // deslocamento imediato pra sair da trajetória neste tick
    const slid = moveAndSlide(p.x, p.y, p.vx, p.vy, DASH_BURST_DT, PLAYER_R, doorBits);
    p.x = slid.x;
    p.y = slid.y;
    sim.events.push({
      kind: "ability",
      a: p.id,
      b: 3,
      x: p.x,
      y: p.y,
      angle: p.angle,
      weaponId: 3,
    });
  }
}

function tryCastAbility(sim: GameSim, p: SimPlayer) {
  const now = sim.serverTime;
  if (!p.alive) return;
  if (p.stunnedUntil > 0 && now < p.stunnedUntil) return;
  const ab = abilityOf(p.ability ?? 0);
  // Capa de Recuo (id 3): CD via cargas — ignora abilityCdUntil
  if (ab.id !== 3 && p.abilityCdUntil > 0 && now < p.abilityCdUntil) return;
  const bits = doorBitsOf(sim);

  const emitAbility = (abilityId: number) => {
    sim.events.push({
      kind: "ability",
      a: p.id,
      b: abilityId,
      x: p.x,
      y: p.y,
      angle: p.angle,
      weaponId: abilityId,
    });
  };

  // Self-buffs (Botas / Capa Recuo / Capa-Escudo) — sem alvos / jato
  if (ab.id === 2 || ab.id === 3 || ab.id === 4) {
    const ctx: AbilityCtx = {
      didCast: false,
      mode: sim.mode,
      emit: (ev) => {
        sim.events.push({
          kind: "ability",
          a: ev.casterId,
          b: ev.abilityId,
          x: ev.x,
          y: ev.y,
          angle: ev.angle,
          weaponId: ev.abilityId,
        });
      },
    };
    ab.apply(p, [], now, ctx);
    if (!ctx.didCast) return;
    if (ab.id !== 3) p.abilityCdUntil = now + ab.cooldownMs;
    emitAbility(ab.id);
    return;
  }

  if (ab.id === 1) {
    const candidates: AbilityTargetRef[] = [];
    // players/bots + Gigantes rivais; no Survival também zumbis/brute (nunca o conjurador)
    for (const o of sim.players) {
      if (!o.alive || o.id === p.id) continue;
      candidates.push({ id: o.id, kind: 0, x: o.x, y: o.y });
    }
    for (const en of sim.enemies) {
      if (en.state === 3) continue;
      if (en.type === 2) {
        if (en.ownerId === p.id) continue;
        candidates.push({ id: en.id, kind: 2, x: en.x, y: en.y });
      } else if (sim.mode === 1) {
        candidates.push({ id: en.id, kind: 1, x: en.x, y: en.y });
      }
    }
    const ctx: AbilityCtx = {
      didCast: false,
      mode: sim.mode,
      candidates,
      spawnGiant: (target) => {
        const ox = p.x + Math.cos(p.angle) * 28;
        const oy = p.y + Math.sin(p.angle) * 28;
        spawnGiant(
          sim.enemies,
          {
            x: ox,
            y: oy,
            ownerId: p.id,
            targetId: target.id,
            targetKind: target.kind,
            expiresAt: now + GIANT_LIFE_MS,
            doorBits: bits,
          },
          makeEnemyCtx(sim),
        );
      },
      emit: (ev) => {
        sim.events.push({
          kind: "ability",
          a: ev.casterId,
          b: ev.abilityId,
          x: ev.x,
          y: ev.y,
          angle: ev.angle,
          weaponId: ev.abilityId,
        });
      },
    };
    ab.apply(p, [], now, ctx);
    if (!ctx.didCast) return;
    p.abilityCdUntil = now + ab.cooldownMs;
    emitAbility(1);
    return;
  }

  const targets = selectAbilityTargets(
    p,
    sim.players.filter((o) => o.id !== p.id),
    ab,
  );
  const ctx: AbilityCtx = {
    didCast: false,
    mode: sim.mode,
    emit: (ev) => {
      sim.events.push({
        kind: "ability",
        a: ev.casterId,
        b: ev.abilityId,
        x: ev.x,
        y: ev.y,
        angle: ev.angle,
        weaponId: ev.abilityId,
      });
    },
  };
  ab.apply(p, targets, now, ctx);
  // burst imediato de knockback (autoritativo — bots, peers e host)
  for (const t of targets) {
    for (let i = 0; i < 3; i++) {
      if (Math.hypot(t.vx, t.vy) < 60) break;
      const slid = moveAndSlide(t.x, t.y, t.vx, t.vy, 1 / 30, PLAYER_R, bits);
      t.x = slid.x;
      t.y = slid.y;
      const damp = Math.exp(-1.55 / 30);
      t.vx = slid.vx * damp;
      t.vy = slid.vy * damp;
    }
    const pos = resolveWalls(t.x, t.y, PLAYER_R, bits);
    t.x = pos.x;
    t.y = pos.y;
    sim.events.push({
      kind: "ability",
      a: p.id,
      b: ab.id,
      x: t.x,
      y: t.y,
      angle: p.angle,
      weaponId: 1000 + (t.id & 0xff),
    });
  }
  // COOP: jato acerta zumbis/brutamontes (não Gigantes)
  if (sim.mode === 1) {
    const aimX = Math.cos(p.angle);
    const aimY = Math.sin(p.angle);
    const minDot = Math.cos(Math.max(0.35, ab.coneRad));
    for (const en of sim.enemies) {
      if (en.state === 3 || en.type === 2) continue;
      const dx = en.x - p.x;
      const dy = en.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist > ab.range || dist < 0.5) continue;
      if ((dx / dist) * aimX + (dy / dist) * aimY < minDot) continue;
      const jetDmg = en.type === 1 ? 4 : 35;
      const died = damageEnemy(sim.enemies, sim.waves, en.id, jetDmg, makeEnemyCtx(sim));
      if (died) p.kills++;
      else {
        const shove = en.type === 1 ? 120 : 900;
        en.vx += aimX * shove;
        en.vy += aimY * shove;
      }
      sim.events.push({
        kind: "ability",
        a: p.id,
        b: ab.id,
        x: en.x,
        y: en.y,
        angle: p.angle,
        weaponId: 1000 + (en.id & 0xff),
      });
    }
  }
  p.abilityCdUntil = now + ab.cooldownMs;
  ctx.emit({
    kind: "ability",
    abilityId: p.ability ?? 0,
    x: p.x,
    y: p.y,
    angle: p.angle,
    casterId: p.id,
  });
}

function tryUseDoor(sim: GameSim, p: SimPlayer) {
  let best: SimDoor | null = null;
  let bestD = DOOR_USE_RADIUS + 24; // alcança a porta de dentro da casa
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
    onCast?: () => void;
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
  if (p.abilityCdUntil == null) p.abilityCdUntil = 0;
  if (p.stunnedUntil == null) p.stunnedUntil = 0;
  if (p.speedBoostUntil == null) p.speedBoostUntil = 0;
  if (p.shieldUntil == null) p.shieldUntil = 0;
  if (p.dashCharges == null) p.dashCharges = DASH_MAX_CHARGES;
  if (p.dashRechargeAt == null) p.dashRechargeAt = 0;
  if (p.dashUntil == null) p.dashUntil = 0;
  if (p.ability == null) p.ability = 0;
  tickDashCharges(p, now);
  if (input.ability != null && input.ability >= 0) {
    p.ability = input.ability & 0xff;
  }
  const stunned = p.stunnedUntil > 0 && now < p.stunnedUntil;
  const flashed = (p.flashUntil ?? 0) > now;
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

  // completar reload (também no replay de predição)
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
  if (p.speedBoostUntil > 0 && now < p.speedBoostUntil) {
    speedMult *= SPRINT_BOOTS_SPEED_MUL;
  }
  // Capa-Escudo: protegido mas lento (trade-off)
  if (p.shieldUntil > 0 && now < p.shieldUntil) {
    speedMult *= SHIELD_SPEED_MUL;
  }
  const speed = MOVE_SPEED * speedMult;
  // movimento + knockback residual em vx/vy (habilidades somam impulso)
  const moveVx = mx * speed;
  const moveVy = my * speed;
  // knockback alto: movimento quase não contra-ataca (bots e players online)
  const kb = Math.hypot(p.vx, p.vy);
  const moveScale = kb > 1500 ? 0.18 : kb > 800 ? 0.35 : kb > 300 ? 0.65 : 1;
  const totalVx = moveVx * moveScale + p.vx;
  const totalVy = moveVy * moveScale + p.vy;
  const slid = moveAndSlide(p.x, p.y, totalVx, totalVy, dt, PLAYER_R, bits);
  p.x = slid.x;
  p.y = slid.y;
  // damp mais leve enquanto voa no knockback → viaja mais longe
  const damp = Math.exp(-(kb > 500 ? 1.55 : 2.8) * dt);
  if (Math.abs(totalVx) > 1 && Math.abs(slid.vx) < 1e-6) p.vx = 0;
  else p.vx *= damp;
  if (Math.abs(totalVy) > 1 && Math.abs(slid.vy) < 1e-6) p.vy = 0;
  else p.vy *= damp;
  if (Math.abs(p.vx) < 3) p.vx = 0;
  if (Math.abs(p.vy) < 3) p.vy = 0;
  // flash: mira treme (bots/jogadores); ângulo aplicado fica impreciso
  if (flashed) {
    p.angle = input.aim + (Math.random() - 0.5) * 1.8;
  } else {
    p.angle = input.aim;
  }
  p.fireCd = Math.max(0, p.fireCd - dt * 1000);
  p.throwCd = Math.max(0, (p.throwCd ?? 0) - dt * 1000);
  if (input.use) opts?.onUse?.();

  const reloading = p.reloadingUntil > 0 && now < p.reloadingUntil;

  const startReload = () => {
    if (stunned || reloading || p.reserve <= 0 || p.mag >= wpn.magSize) return;
    p.reloadingUntil = now + wpn.reloadMs;
    opts?.onReloadStart?.();
  };

  if (input.reload && !stunned) startReload();

  // Atirar cancela reload se ainda tem bala no pente (não trava o hold-fire)
  if (input.fire && reloading && p.mag > 0) {
    p.reloadingUntil = 0;
  }
  // mag já encheu (reload terminou neste tick) — libera tiro imediato
  if (input.fire && p.reloadingUntil > 0 && now >= p.reloadingUntil) {
    p.reloadingUntil = 0;
  }

  const stillReloading = p.reloadingUntil > 0 && now < p.reloadingUntil;

  // flashbang bloqueia tiro preciso (igual stun de habilidade)
  if (input.fire && p.fireCd <= 0 && !stunned && !flashed) {
    if (stillReloading && p.mag <= 0) {
      // espera reload do pente vazio
    } else if (p.mag <= 0) {
      opts?.onEmptyClick?.();
      startReload();
      p.fireCd = 100;
    } else {
      p.mag -= 1;
      p.fireCd = wpn.cooldownMs;
      const m = muzzlePoint(p.x, p.y, p.angle, wpn);
      opts?.spawnBullet?.(p.angle, m.x, m.y, p.weapon);
    }
  }
  if (input.throw >= 1 && input.throw <= 4 && (p.throwCd ?? 0) <= 0 && !stunned && !flashed) {
    p.throwCd = 2200;
    const m = muzzlePoint(p.x, p.y, p.angle, wpn);
    opts?.spawnThrow?.(input.throw, p.angle, m.x, m.y);
  }
  if (input.cast && !stunned && !flashed) {
    opts?.onCast?.();
  }
  syncAmmoToBank(p);
  p.lastProcessedInputSeq = input.seq;
}
export function startMatch(sim: GameSim) {
  const minPlayers = sim.mode === 1 ? 1 : 2;
  if (sim.players.length < minPlayers) return false;
  sim.phase = 1;
  sim.matchLeftMs = MATCH_MS;
  sim.tick = 0;
  sim.bullets = [];
  sim.throwables = [];
  sim.fires = [];
  sim.smokes = [];
  sim.events = [];
  sim.enemies = [];
  sim.waves = createWaveManager();
  resetEnemyIds();
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
    p.ability = 0;
    p.abilityCdUntil = 0;
    p.stunnedUntil = 0;
    p.speedBoostUntil = 0;
    p.shieldUntil = 0;
    p.dashCharges = DASH_MAX_CHARGES;
    p.dashRechargeAt = 0;
    p.dashUntil = 0;
    p.respawnAt = 0;
    p.flashUntil = 0;
    p.inputQueue = [];
    p.lastProcessedInputSeq = 0;
  });
  sim.ammoDrops = [];
  sim.weaponDrops = [];
  sim.abilityDrops = [];
  sim.nextDropAt = 2000 + Math.random() * 4000;
  sim.nextAbilityDropAt = 8000 + Math.random() * 6000;
  if (sim.mode === 1) startWaves(sim.waves, sim.serverTime);
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
  cause: "weapon" | "explosion" | "fire" | "enemy" = "weapon",
) {
  if (!target.alive) return;
  target.hp -= amount;
  const causeCode = cause === "explosion" ? 100 : cause === "fire" ? 101 : cause === "enemy" ? 200 : weaponId;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    // survival: respawn pra FFA continuar; PvP também
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
    spawnWeaponDropsFromPlayer(sim, target);
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
          const nowHit = sim.serverTime;
          if (
            target.shieldUntil > 0 &&
            nowHit < target.shieldUntil &&
            isFrontalShieldHit(target.angle, target.x, target.y, ox, oy)
          ) {
            sim.events.push({
              kind: "hit",
              a: p.id,
              b: 253,
              x: hit.x,
              y: hit.y,
              weaponId: weapon,
            });
            continue;
          }
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
  const now = sim.serverTime;

  // Termina reload mesmo sem input (hold-fire após recarregar)
  for (const p of sim.players) {
    if (!p.alive) continue;
    if (p.reloadingUntil == null) p.reloadingUntil = 0;
    if (p.reloadingUntil > 0 && now >= p.reloadingUntil) {
      const wpn = weaponOf(p.weapon);
      const need = wpn.magSize - p.mag;
      const take = Math.min(need, p.reserve);
      p.mag += take;
      p.reserve -= take;
      p.reloadingUntil = 0;
      syncAmmoToBank(p);
    }
  }

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
      p.abilityCdUntil = 0;
      p.stunnedUntil = 0;
      p.speedBoostUntil = 0;
      p.shieldUntil = 0;
      p.dashCharges = DASH_MAX_CHARGES;
      p.dashRechargeAt = 0;
      p.dashUntil = 0;
      p.respawnAt = 0;
      sim.events.push({ kind: "respawn", a: p.id, b: 0, x: p.x, y: p.y });
    }
  }
  const stepped = new Set<number>();
  for (const p of sim.players) {
    if (p.inputQueue.length === 0) continue;
    stepped.add(p.id);
    let latest = p.inputQueue[0]!;
    let wantFire = false;
    let wantThrow = 0;
    let wantUse = false;
    let wantReload = false;
    let wantCast = false;
    /** pacote do Q — ability/aim devem vir DESTE input, não do último do tick */
    let castPacket: PlayerInput | null = null;
    while (p.inputQueue.length) {
      latest = p.inputQueue.shift()!;
      if (latest.fire) wantFire = true;
      if (latest.throw >= 1) wantThrow = latest.throw;
      if (latest.use) wantUse = true;
      if (latest.reload) wantReload = true;
      if (latest.cast) {
        wantCast = true;
        castPacket = latest;
      }
    }
    const merged = {
      ...latest,
      // se Q veio no tick, trava habilidade + mira do momento do cast
      ...(castPacket
        ? { aim: castPacket.aim, ability: castPacket.ability ?? latest.ability }
        : {}),
      fire: wantFire,
      throw: wantThrow,
      use: wantUse,
      reload: wantReload,
      cast: wantCast,
    };
    applyInput(p, merged, dt, {
      doorBits: bits,
      serverTime: sim.serverTime,
      onUse: () => tryUseDoor(sim, p),
      onCast: () => tryCastAbility(sim, p),
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

  // alvo sem input no tick: ainda avança fireCd + knockback
  for (const p of sim.players) {
    if (!p.alive || stepped.has(p.id)) continue;
    p.fireCd = Math.max(0, (p.fireCd ?? 0) - dt * 1000);
    p.throwCd = Math.max(0, (p.throwCd ?? 0) - dt * 1000);
    if (Math.hypot(p.vx, p.vy) < 1) continue;
    const kb = Math.hypot(p.vx, p.vy);
    const slid = moveAndSlide(p.x, p.y, p.vx, p.vy, dt, PLAYER_R, bits);
    p.x = slid.x;
    p.y = slid.y;
    const damp = Math.exp(-(kb > 500 ? 1.55 : 2.8) * dt);
    p.vx = slid.vx * damp;
    p.vy = slid.vy * damp;
    if (Math.abs(p.vx) < 3) p.vx = 0;
    if (Math.abs(p.vy) < 3) p.vy = 0;
  }

  // drops de munição / armas / habilidades (survival)
  tickAmmoDrops(sim, dt);
  tickWeaponDrops(sim, dt);
  tickAbilityDrops(sim, dt);

  // Ninguém fica trancado: se o player está DENTRO, a porta da casa abre
  for (const def of DOOR_DEFS) {
    const door = sim.doors.find((d) => d.id === def.id);
    if (!door || door.open) continue;
    const cx = def.tx * 32 + 16;
    const cy = def.ty * 32 + 16;
    for (const p of sim.players) {
      if (!p.alive) continue;
      if (buildingAt(p.x, p.y) === def.id) {
        door.open = true;
        door.lastUseAt = sim.serverTime;
        sim.events.push({ kind: "doorOpen", a: p.id, b: door.id, x: cx, y: cy });
        break;
      }
    }
  }

  // auto-close portas — quem está DENTRO da casa mantém a porta aberta
  for (const door of sim.doors) {
    if (!door.open || door.lastUseAt <= 0) continue;
    let someoneNear = false;
    const def = DOOR_DEFS.find((d) => d.id === door.id)!;
    const cx = def.tx * 32 + 16;
    const cy = def.ty * 32 + 16;
    for (const p of sim.players) {
      if (!p.alive) continue;
      const inHouse = buildingAt(p.x, p.y) === door.id;
      if (inHouse || Math.hypot(p.x - cx, p.y - cy) < DOOR_USE_RADIUS + 36) {
        someoneNear = true;
        door.lastUseAt = sim.serverTime;
        break;
      }
    }
    if (!someoneNear && sim.mode === 1) {
      for (const en of sim.enemies) {
        if (en.state === 3 || en.hp <= 0) continue;
        const inHouse = buildingAt(en.x, en.y) === door.id;
        if (inHouse || Math.hypot(en.x - cx, en.y - cy) < DOOR_USE_RADIUS + 48) {
          someoneNear = true;
          door.lastUseAt = sim.serverTime;
          break;
        }
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
  // Capa de Recuo inteligente: auto-fuga de balas ANTES do hit-test
  tickAutoRecoilCapes(sim, bitsAfter);
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
    // COOP: balas acertam inimigos
    if (sim.mode === 1) {
      for (const en of sim.enemies) {
        if (en.state === 3 || en.type === 2) continue;
        const def = enemyOf(en);
        const hx = en.x;
        const hy = en.y + def.hitY;
        if (Math.hypot(hx - b.x, hy - b.y) < def.hitRadius + BULLET_R) {
          const died = damageEnemy(sim.enemies, sim.waves, en.id, dmg, makeEnemyCtx(sim));
          if (died) {
            const killer = sim.players.find((p) => p.id === b.owner);
            if (killer) killer.kills++;
          }
          sim.events.push({
            kind: "hit",
            a: b.owner,
            b: 254,
            x: b.x,
            y: b.y,
            weaponId: b.weapon,
          });
          consumed = true;
          break;
        }
      }
    }
    if (!consumed) {
      for (const t of sim.players) {
        if (!t.alive || t.id === b.owner) continue;
        const hx = t.x;
        const hy = t.y + PLAYER_HIT_Y;
        if (Math.hypot(hx - b.x, hy - b.y) < PLAYER_HIT_R + BULLET_R) {
          // Capa-Escudo: anula projétil no arco frontal (~108°)
          const nowHit = sim.serverTime;
          if (
            t.shieldUntil > 0 &&
            nowHit < t.shieldUntil &&
            isFrontalShieldHit(t.angle, t.x, t.y, b.px, b.py)
          ) {
            sim.events.push({
              kind: "hit",
              a: b.owner,
              b: 253, // sentinela: bloqueio (faísca, sem sangue)
              x: b.x,
              y: b.y,
              weaponId: b.weapon,
            });
            consumed = true;
            break;
          }
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

  // Capa de Recuo: auto-fuga de Gigante/chefe antes do passo de ataque
  tickAutoRecoilCapes(sim, doorBitsOf(sim));

  // Gigante existe nos dois modos
  stepGiants(sim.enemies, dt, makeEnemyCtx(sim));

  if (sim.mode === 1) {
    const ctx = makeEnemyCtx(sim);
    stepWaves(sim.waves, sim.enemies, ctx);
    stepEnemies(sim.enemies, dt, ctx);
    // fim raro: todos mortos sem respawn agendado
    if (sim.players.length > 0 && sim.players.every((p) => !p.alive && p.respawnAt <= 0)) {
      sim.phase = 2;
    }
  } else {
    const leader = [...sim.players].sort((a, b) => b.kills - a.kills)[0];
    if (sim.matchLeftMs <= 0 || (leader && leader.kills >= 15)) {
      sim.phase = 2;
    }
  }
}

function makeEnemyCtx(sim: GameSim) {
  return {
    serverTime: sim.serverTime,
    doorBits: doorBitsOf(sim),
    players: sim.players.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      alive: p.alive,
      hp: p.hp,
    })),
    damagePlayer: (playerId: number, amount: number, fromEnemyId: number, knockX = 0, knockY = 0) => {
      const p = sim.players.find((x) => x.id === playerId);
      if (!p) return;
      damagePlayer(sim, p, amount, fromEnemyId, 0, "enemy");
      if (knockX || knockY) {
        p.vx += knockX;
        p.vy += knockY;
      }
      sim.events.push({
        kind: "hit",
        a: fromEnemyId,
        b: playerId,
        x: p.x,
        y: p.y,
        weaponId: 200,
      });
    },
    resolveGiantTarget: (kind: 0 | 1 | 2, id: number) => {
      if (kind === 0) {
        const pl = sim.players.find((x) => x.id === id);
        if (!pl) return null;
        return { x: pl.x, y: pl.y, alive: pl.alive };
      }
      if (kind === 2) {
        const g = sim.enemies.find((x) => x.id === id && x.type === 2);
        if (!g) return null;
        return { x: g.x, y: g.y, alive: g.state !== 3 && g.hp > 0 };
      }
      const en = sim.enemies.find((x) => x.id === id && x.type !== 2);
      if (!en) return null;
      return { x: en.x, y: en.y, alive: en.state !== 3 && en.hp > 0 };
    },
    findRivalGiant: (myOwnerId: number, x: number, y: number, maxDist?: number) => {
      let best: { id: number; x: number; y: number } | null = null;
      let bestD = Infinity;
      const limit = maxDist ?? Infinity;
      for (const en of sim.enemies) {
        if (en.type !== 2 || en.state === 3 || en.ownerId === myOwnerId) continue;
        const d = Math.hypot(en.x - x, en.y - y);
        if (d > limit) continue;
        if (d < bestD) {
          bestD = d;
          best = { id: en.id, x: en.x, y: en.y };
        }
      }
      return best;
    },
    pickGiantRetarget: (
      ownerId: number,
      x: number,
      y: number,
      primaryId?: number,
      primaryKind?: 0 | 1 | 2,
    ) => {
      // 1) rival perto do conjurador — proteger o owner
      const owner = sim.players.find((p) => p.id === ownerId);
      if (owner?.alive) {
        let bestRival: { id: number; kind: 2 } | null = null;
        let bestRD = Infinity;
        for (const en of sim.enemies) {
          if (en.type !== 2 || en.state === 3 || en.ownerId === ownerId) continue;
          const d = Math.hypot(en.x - owner.x, en.y - owner.y);
          if (d < 360 && d < bestRD) {
            bestRD = d;
            bestRival = { id: en.id, kind: 2 };
          }
        }
        if (bestRival) return bestRival;
      }

      // 2) alvo da mira ainda existe? (caso edge de resolve falho)
      if (primaryId != null && primaryId >= 0 && primaryKind != null) {
        if (primaryKind === 0) {
          const pl = sim.players.find((p) => p.id === primaryId);
          if (pl?.alive) return { id: primaryId, kind: 0 as const };
        } else if (primaryKind === 1 || primaryKind === 2) {
          const en = sim.enemies.find((e) => e.id === primaryId);
          if (en && en.state !== 3 && en.hp > 0) {
            return { id: primaryId, kind: primaryKind };
          }
        }
      }

      // 3) fallback: mais perto (player > rival > monstro)
      let best: { id: number; kind: 0 | 1 | 2 } | null = null;
      let bestD = Infinity;
      for (const o of sim.players) {
        if (!o.alive || o.id === ownerId) continue;
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < bestD) {
          bestD = d;
          best = { id: o.id, kind: 0 };
        }
      }
      for (const en of sim.enemies) {
        if (en.state === 3 || en.hp <= 0) continue;
        if (en.type === 2) {
          if (en.ownerId === ownerId) continue;
          const d = Math.hypot(en.x - x, en.y - y);
          if (d < bestD) {
            bestD = d;
            best = { id: en.id, kind: 2 };
          }
        } else if (sim.mode === 1) {
          const d = Math.hypot(en.x - x, en.y - y);
          if (d < bestD) {
            bestD = d;
            best = { id: en.id, kind: 1 };
          }
        }
      }
      return best;
    },
    executeGiantKill: (
      kind: 0 | 1 | 2,
      targetId: number,
      ownerId: number,
      knockX: number,
      knockY: number,
    ) => {
      // direção unitária estável (já vem travada do windup)
      let kx = knockX;
      let ky = knockY;
      let kl = Math.hypot(kx, ky);
      if (kl < 1) {
        kx = 1;
        ky = 0;
        kl = 1;
      }
      kx /= kl;
      ky /= kl;

      if (kind === 0) {
        const t = sim.players.find((x) => x.id === targetId);
        if (!t || !t.alive) return;
        // SUBSTITUI velocidade — não soma (correr contra o Gigante invertia o voo)
        const throwSpd = 3800;
        t.vx = kx * throwSpd;
        t.vy = ky * throwSpd;
        // burst autoritativo: corpo voa longe NA direção do golpe
        const bits = doorBitsOf(sim);
        for (let i = 0; i < 10; i++) {
          const spd = Math.hypot(t.vx, t.vy);
          if (spd < 80) break;
          const slid = moveAndSlide(t.x, t.y, t.vx, t.vy, 1 / 30, PLAYER_R, bits);
          t.x = slid.x;
          t.y = slid.y;
          // se bateu na parede, preserva componente paralela à direção do throw
          if (Math.hypot(slid.vx, slid.vy) < spd * 0.35) {
            // desliza ao longo da parede na direção do arremesso
            const alongX = kx * spd * 0.85;
            const alongY = ky * spd * 0.85;
            const slid2 = moveAndSlide(t.x, t.y, alongX, alongY, 1 / 30, PLAYER_R, bits);
            t.x = slid2.x;
            t.y = slid2.y;
            t.vx = slid2.vx * 0.9;
            t.vy = slid2.vy * 0.9;
          } else {
            t.vx = slid.vx * 0.94;
            t.vy = slid.vy * 0.94;
          }
        }
        // kill forçado após o arremesso
        damagePlayer(sim, t, Math.max(9999, (t.hp || 0) + 1), ownerId, 0, "weapon");
        if (t.alive) {
          t.hp = 0;
          t.alive = false;
          t.respawnAt = sim.serverTime + RESPAWN_MS;
          const killer = sim.players.find((k) => k.id === ownerId);
          if (killer && killer.id !== t.id) killer.kills++;
          sim.events.push({
            kind: "death",
            a: ownerId,
            b: t.id,
            x: t.x,
            y: t.y,
            weaponId: 0,
          });
          spawnWeaponDropsFromPlayer(sim, t);
        }
        // mantém impulso residual no cadáver (próximos ticks ainda “voam” se vivos… já morto:
        // deixa vx/vy altos — clients interpolam a posição final do burst)
        t.vx = kx * 900;
        t.vy = ky * 900;
        return;
      }

      // Gigante rival — duelo: OS DOIS morrem (se matam)
      if (kind === 2) {
        const rival = sim.enemies.find((x) => x.id === targetId && x.type === 2);
        if (!rival || rival.state === 3) return;
        const me = sim.enemies.find(
          (x) => x.type === 2 && x.ownerId === ownerId && x.state !== 3 && x.id !== rival.id,
        );
        const bits = doorBitsOf(sim);
        const finishGiant = (g: typeof rival, throwKx: number, throwKy: number) => {
          const rr = enemyOf(g).radius;
          g.vx = throwKx * 2000;
          g.vy = throwKy * 2000;
          for (let i = 0; i < 6; i++) {
            if (Math.hypot(g.vx, g.vy) < 50) break;
            const slid = moveAndSlide(g.x, g.y, g.vx, g.vy, 1 / 30, rr, bits);
            g.x = slid.x;
            g.y = slid.y;
            g.vx = slid.vx * 0.9;
            g.vy = slid.vy * 0.9;
          }
          g.hp = 0;
          g.state = 3;
          g.timer = 200;
          // só giantHit — expire no mesmo tick dobrava FX pra todos
          sim.events.push({
            kind: "giantHit",
            a: g.id,
            b: g.ownerId,
            x: g.x,
            y: g.y,
            weaponId: ((2 & 3) << 8) | (g.id & 0xff),
          });
        };
        // um voa pra frente do golpe, o outro pro sentido oposto
        finishGiant(rival, kx, ky);
        if (me) finishGiant(me, -kx, -ky);
        return;
      }

      const en = sim.enemies.find((x) => x.id === targetId && x.type !== 2);
      if (!en || en.state === 3) return;
      en.vx = kx * 1600;
      en.vy = ky * 1600;
      const bits = doorBitsOf(sim);
      for (let i = 0; i < 6; i++) {
        if (Math.hypot(en.vx, en.vy) < 60) break;
        const slid = moveAndSlide(en.x, en.y, en.vx, en.vy, 1 / 30, enemyOf(en).radius, bits);
        en.x = slid.x;
        en.y = slid.y;
        en.vx = slid.vx * 0.92;
        en.vy = slid.vy * 0.92;
      }
      en.hp = 0;
      const died = damageEnemy(sim.enemies, sim.waves, en.id, 99999, makeEnemyCtx(sim));
      if (died) {
        const owner = sim.players.find((x) => x.id === ownerId);
        if (owner) owner.kills++;
      }
    },
    emit: (ev: {
      kind: "enemySpawn" | "enemyHit" | "enemyDeath" | "giantSpawn" | "giantHit" | "giantExpire";
      a: number;
      b: number;
      x: number;
      y: number;
      weaponId?: number;
    }) => {
      sim.events.push({
        kind: ev.kind,
        a: ev.a,
        b: ev.b,
        x: ev.x,
        y: ev.y,
        weaponId: ev.weaponId,
      });
    },
    spawnAmmoDrop: (x: number, y: number) => {
      const id = sim.nextDropId++;
      const amount = 12 + Math.floor(Math.random() * 12);
      sim.ammoDrops.push({
        id,
        x,
        y,
        amount,
        spawnAt: sim.serverTime,
      });
      sim.events.push({ kind: "dropSpawn", a: id, b: amount, x, y });
    },
    openNearbyDoors: (x: number, y: number) => {
      for (const def of DOOR_DEFS) {
        const door = sim.doors.find((d) => d.id === def.id);
        if (!door || door.open) continue;
        const cx = def.tx * 32 + 16;
        const cy = def.ty * 32 + 16;
        if (Math.hypot(x - cx, y - cy) < DOOR_USE_RADIUS + 56) {
          door.open = true;
          door.lastUseAt = sim.serverTime;
          sim.events.push({
            kind: "doorOpen",
            a: 0,
            b: door.id,
            x: cx,
            y: cy,
          });
        }
      }
      return doorBitsOf(sim);
    },
    forceOpenDoor: (doorId: number) => {
      const door = sim.doors.find((d) => d.id === doorId);
      const def = DOOR_DEFS.find((d) => d.id === doorId);
      if (door && def && !door.open) {
        door.open = true;
        door.lastUseAt = sim.serverTime;
        sim.events.push({
          kind: "doorOpen",
          a: 0,
          b: door.id,
          x: def.tx * 32 + 16,
          y: def.ty * 32 + 16,
        });
      } else if (door && door.open) {
        door.lastUseAt = sim.serverTime;
      }
      return doorBitsOf(sim);
    },
  };
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
      ability: p.ability ?? 0,
      abilityCdUntil: p.abilityCdUntil ?? 0,
      stunnedUntil: p.stunnedUntil ?? 0,
      speedBoostUntil: p.speedBoostUntil ?? 0,
      shieldUntil: p.shieldUntil ?? 0,
      dashCharges: p.dashCharges ?? DASH_MAX_CHARGES,
      dashRechargeAt: p.dashRechargeAt ?? 0,
      dashUntil: p.dashUntil ?? 0,
    })),
    bullets: sim.bullets.map((b) => ({ ...b })),
    throwables: sim.throwables.map((t) => ({ ...t })),
    events: [...sim.events],
    doorsBits: doorBitsOf(sim),
    enemies: toEnemyStates(sim.enemies),
    mode: sim.mode,
    wave: sim.waves?.wave ?? 0,
    waveLeft: sim.waves?.remaining ?? 0,
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

/** Empacota mag/reserve no u16 do evento (cada um 0..255). */
function packAmmo(mag: number, reserve: number): number {
  return (mag & 0xff) | ((reserve & 0xff) << 8);
}

function spawnWeaponDropsFromPlayer(sim: GameSim, target: SimPlayer) {
  syncAmmoToBank(target);
  const bank = ensureAmmoBank(target);
  let slot = 0;
  for (let i = 0; i < WEAPONS.length; i++) {
    const stack = bank[i]!;
    // sempre dropa a arma equipada; as outras só se tiverem munição
    if (i !== target.weapon && stack.mag <= 0 && stack.reserve <= 0) continue;
    const ang = (slot / Math.max(1, WEAPONS.length)) * Math.PI * 2 + target.id * 0.7;
    const dist = 18 + (slot % 3) * 8;
    const drop: WeaponDrop = {
      id: sim.nextDropId++ & 0xff,
      x: target.x + Math.cos(ang) * dist,
      y: target.y + Math.sin(ang) * dist,
      weaponId: i,
      mag: Math.max(0, Math.min(255, stack.mag | 0)),
      reserve: Math.max(0, Math.min(255, stack.reserve | 0)),
      spawnAt: sim.serverTime,
    };
    sim.weaponDrops.push(drop);
    sim.events.push({
      kind: "weaponDropSpawn",
      a: drop.id,
      b: drop.weaponId,
      x: drop.x,
      y: drop.y,
      weaponId: packAmmo(drop.mag, drop.reserve),
    });
    slot++;
  }
  // morto fica sem inventário até o respawn (fullAmmoBank)
  target.ammoBank = WEAPONS.map(() => ({ mag: 0, reserve: 0 }));
  target.mag = 0;
  target.reserve = 0;
  target.reloadingUntil = 0;
}

function tickWeaponDrops(sim: GameSim, _dt: number) {
  sim.weaponDrops = sim.weaponDrops.filter((d) => sim.serverTime - d.spawnAt <= 45000);

  for (const p of sim.players) {
    if (!p.alive) continue;
    for (let i = sim.weaponDrops.length - 1; i >= 0; i--) {
      const d = sim.weaponDrops[i]!;
      if (Math.hypot(p.x - d.x, p.y - d.y) > 22) continue;
      const wpn = weaponOf(d.weaponId);
      const bank = ensureAmmoBank(p);
      const slot = bank[d.weaponId] ?? { mag: 0, reserve: 0 };
      // soma a munição do drop (mesmas quantidades do inventário do morto), com cap
      slot.mag = Math.min(wpn.magSize, slot.mag + d.mag);
      slot.reserve = Math.min(wpn.reserveMax, slot.reserve + d.reserve);
      bank[d.weaponId] = slot;
      if (p.weapon === d.weaponId) {
        p.mag = slot.mag;
        p.reserve = slot.reserve;
      } else {
        syncAmmoToBank(p);
      }
      sim.events.push({
        kind: "weaponDropTaken",
        a: d.id,
        b: p.id,
        x: d.x,
        y: d.y,
        weaponId: d.weaponId,
      });
      sim.weaponDrops.splice(i, 1);
    }
  }
}

function tickAbilityDrops(sim: GameSim, _dt: number) {
  // só Survival — Botas (e futuros poderes) no chão
  if (sim.mode !== 1) {
    sim.abilityDrops = [];
    return;
  }
  sim.abilityDrops = sim.abilityDrops.filter((d) => sim.serverTime - d.spawnAt <= 40000);

  if (sim.nextAbilityDropAt <= 0) {
    sim.nextAbilityDropAt = sim.serverTime + 10000 + Math.random() * 8000;
  }
  if (sim.serverTime >= sim.nextAbilityDropAt && sim.abilityDrops.length < 3) {
    const pos = pickDropTile();
    if (pos) {
      const pool = ABILITY_DROP_IDS;
      const abilityId = pool[Math.floor(Math.random() * pool.length)]!;
      const drop: AbilityDrop = {
        id: sim.nextDropId++ & 0xff,
        x: pos.x,
        y: pos.y,
        abilityId,
        spawnAt: sim.serverTime,
      };
      sim.abilityDrops.push(drop);
      sim.events.push({
        kind: "abilityDropSpawn",
        a: drop.id,
        b: drop.abilityId,
        x: drop.x,
        y: drop.y,
        weaponId: drop.abilityId,
      });
    }
    sim.nextAbilityDropAt = sim.serverTime + 14000 + Math.random() * 10000;
  }

  for (const p of sim.players) {
    if (!p.alive) continue;
    for (let i = sim.abilityDrops.length - 1; i >= 0; i--) {
      const d = sim.abilityDrops[i]!;
      if (Math.hypot(p.x - d.x, p.y - d.y) > 16) continue;
      p.ability = d.abilityId & 0xff;
      if (d.abilityId === 3) {
        p.dashCharges = DASH_MAX_CHARGES;
        p.dashRechargeAt = 0;
        p.dashUntil = 0;
      }
      sim.events.push({
        kind: "abilityDropTaken",
        a: d.id,
        b: p.id,
        x: d.x,
        y: d.y,
        weaponId: d.abilityId,
      });
      sim.abilityDrops.splice(i, 1);
    }
  }
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
