/**
 * enemies.ts — zumbis + Brutamontes + WaveManager (autoritativo no host).
 * Cap: vários zumbis vivos; Brutamontes à parte a partir da onda 4.
 */
import { ARENA_H, ARENA_W, PLAYER_HIT_R } from "./constants";
import {
  BUILDINGS,
  DOOR_DEFS,
  buildingAt,
  hitsSolid,
  moveAndSlide,
  resolveWalls,
} from "./map";

export type EnemyType = 0 | 1 | 2; // 0 zumbi, 1 brutamontes, 2 gigante
export type EnemyStateId =
  | 0 // IDLE
  | 1 // CHASE
  | 2 // ATTACK / WINDUP
  | 3 // DYING
  | 4 // CHARGE_WINDUP
  | 5 // CHARGE_DASH
  | 6; // STUN

export interface EnemyDef {
  type: EnemyType;
  name: string;
  hp: number;
  speed: number;
  /** colisão com paredes / navegação */
  radius: number;
  /** acerto de balas — diâmetro visual da figura */
  hitRadius: number;
  /** offset Y do centro de hit (torso) */
  hitY: number;
  aggroRange: number;
  attackRange: number;
  attackDamage: number;
  windupMs: number;
  cooldownMs: number;
  /** escala visual (cliente) */
  visualScale: number;
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  0: {
    type: 0,
    name: "Zumbi",
    hp: 65,
    speed: 92,
    radius: 12,
    hitRadius: 26,
    hitY: -10,
    aggroRange: 360,
    attackRange: 26,
    attackDamage: 16,
    windupMs: 260,
    cooldownMs: 580,
    visualScale: 1.55,
  },
  1: {
    type: 1,
    name: "Brutamontes",
    hp: 2200,
    speed: 155,
    radius: 16,
    /** corpo visual ~36*s de raio horizontal (s≈1.7) */
    hitRadius: 62,
    hitY: -8,
    aggroRange: 780,
    attackRange: 46,
    attackDamage: 62,
    windupMs: 340,
    cooldownMs: 400,
    visualScale: 3.1,
  },
  2: {
    type: 2,
    name: "Gigante",
    hp: 9999,
    speed: 280,
    radius: 16,
    hitRadius: 36,
    hitY: -12,
    aggroRange: 99999,
    attackRange: 52,
    attackDamage: 999,
    windupMs: 150,
    cooldownMs: 0,
    visualScale: 1.85,
  },
};

/** vida do Gigante em ms (autoritativo) — tempo pra navegar mapa grande */
export const GIANT_LIFE_MS = 14000;
/** ms sem alvo antes de expirar (só se não houver retarget) */
export const GIANT_MISS_GRACE_MS = 1800;

export interface Enemy {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  state: EnemyStateId;
  targetId: number;
  /** 0 = player, 1 = monstro, 2 = Gigante rival (só Gigante) */
  targetKind: 0 | 1 | 2;
  /** conjurador (só Gigante; -1 nos demais) */
  ownerId: number;
  /** serverTime em que some (só Gigante) */
  expiresAt: number;
  /** ms sem ver o alvo vivo — grace antes de expirar */
  missTargetMs: number;
  timer: number;
  retargetAt: number;
  chargeX: number;
  chargeY: number;
  /** direção de deslize estável (anti-tremor) */
  slideX: number;
  slideY: number;
  slideUntil: number;
  stuck: number;
  lastX: number;
  lastY: number;
}

export interface EnemyState {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  hp: number;
  state: EnemyStateId;
}

export interface WaveManager {
  wave: number;
  /** quantos ainda faltam matar nesta onda (fila + vivos do tipo zumbi da onda) */
  remaining: number;
  /** quantos ainda na fila pra spawnar */
  queue: { type: EnemyType }[];
  /** próximo spawn permitidoc */
  nextSpawnAt: number;
  /** brutamontes vivo nesta onda? */
  bruteAlive: boolean;
  /** onda completa, pausa antes da próxima */
  intermissionUntil: number;
  active: boolean;
}

export const MAX_ZOMBIES = 16;

export function createWaveManager(): WaveManager {
  return {
    wave: 0,
    remaining: 0,
    queue: [],
    nextSpawnAt: 0,
    bruteAlive: false,
    intermissionUntil: 0,
    active: false,
  };
}

/** Total de zumbis a matar na onda N (1-based). */
export function waveZombieTotal(wave: number): number {
  return 8 + wave * 3;
}

export function waveHasBrute(wave: number): boolean {
  return wave >= 2;
}

export function startWaves(wm: WaveManager, serverTime: number) {
  wm.active = true;
  wm.wave = 0;
  wm.queue = [];
  wm.remaining = 0;
  wm.bruteAlive = false;
  wm.intermissionUntil = serverTime + 1200;
  beginNextWave(wm, serverTime);
}

function beginNextWave(wm: WaveManager, serverTime: number) {
  wm.wave += 1;
  const n = waveZombieTotal(wm.wave);
  wm.queue = [];
  // Brutamontes PRIMEIRO na fila — senão nunca spawna atrás do cap de zumbis
  if (waveHasBrute(wm.wave)) {
    wm.queue.push({ type: 1 });
  }
  for (let i = 0; i < n; i++) wm.queue.push({ type: 0 });
  wm.remaining = wm.queue.length;
  wm.nextSpawnAt = serverTime + 350;
  wm.intermissionUntil = 0;
  wm.bruteAlive = false;
}

export function enemyOf(e: Enemy): EnemyDef {
  return ENEMY_DEFS[e.type] ?? ENEMY_DEFS[0]!;
}

function pickTarget(
  ex: number,
  ey: number,
  players: { id: number; x: number; y: number; alive: boolean; hp: number }[],
  doorBits: number,
  preferWounded = false,
): number {
  let best = -1;
  let bestD = Infinity;
  for (const p of players) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - ex, p.y - ey);
    const blocked = hitsSolid((ex + p.x) / 2, (ey + p.y) / 2, 2, doorBits);
    // chefe prioriza feridos / isolados
    const woundBias = preferWounded ? (100 - Math.min(100, p.hp)) * 1.8 : 0;
    const score = d + (blocked ? 90 : 0) - woundBias;
    if (score < bestD) {
      bestD = score;
      best = p.id;
    }
  }
  return best;
}

function spawnPointAwayFromPlayers(
  players: { x: number; y: number; alive: boolean }[],
): { x: number; y: number } {
  const margin = 48;
  const edges: { x: number; y: number }[] = [
    { x: margin, y: ARENA_H * 0.25 },
    { x: margin, y: ARENA_H * 0.5 },
    { x: margin, y: ARENA_H * 0.75 },
    { x: ARENA_W - margin, y: ARENA_H * 0.25 },
    { x: ARENA_W - margin, y: ARENA_H * 0.5 },
    { x: ARENA_W - margin, y: ARENA_H * 0.75 },
    { x: ARENA_W * 0.25, y: margin },
    { x: ARENA_W * 0.5, y: margin },
    { x: ARENA_W * 0.75, y: margin },
    { x: ARENA_W * 0.25, y: ARENA_H - margin },
    { x: ARENA_W * 0.5, y: ARENA_H - margin },
    { x: ARENA_W * 0.75, y: ARENA_H - margin },
  ];
  let best = edges[0]!;
  let bestMin = -1;
  for (const e of edges) {
    let minD = Infinity;
    for (const p of players) {
      if (!p.alive) continue;
      minD = Math.min(minD, Math.hypot(p.x - e.x, p.y - e.y));
    }
    if (minD > bestMin) {
      bestMin = minD;
      best = e;
    }
  }
  const jitter = 40;
  return {
    x: best.x + (Math.random() - 0.5) * jitter,
    y: best.y + (Math.random() - 0.5) * jitter,
  };
}

export type EnemyEmitKind =
  | "enemySpawn"
  | "enemyHit"
  | "enemyDeath"
  | "giantSpawn"
  | "giantHit"
  | "giantExpire";

export interface EnemySimCtx {
  serverTime: number;
  doorBits: number;
  players: { id: number; x: number; y: number; alive: boolean; hp: number }[];
  damagePlayer: (playerId: number, amount: number, fromEnemyId: number, knockX?: number, knockY?: number) => void;
  emit: (ev: {
    kind: EnemyEmitKind;
    a: number;
    b: number;
    x: number;
    y: number;
    weaponId?: number;
  }) => void;
  spawnAmmoDrop?: (x: number, y: number) => void;
  /** abre portas próximas — inimigos entram/saem da casa */
  openNearbyDoors?: (x: number, y: number) => number;
  /** força abrir porta por id (chefe saindo da casa) */
  forceOpenDoor?: (doorId: number) => number;
  /** resolve alvo travado do Gigante */
  resolveGiantTarget?: (
    kind: 0 | 1 | 2,
    id: number,
  ) => { x: number; y: number; alive: boolean } | null;
  /** kill + knockback creditados ao owner */
  executeGiantKill?: (
    kind: 0 | 1 | 2,
    targetId: number,
    ownerId: number,
    knockX: number,
    knockY: number,
  ) => void;
  /** Gigante rival mais próximo (outro owner) — duelo */
  findRivalGiant?: (
    myOwnerId: number,
    x: number,
    y: number,
  ) => { id: number; x: number; y: number } | null;
  /** novo alvo se o travado morreu/sumiu */
  pickGiantRetarget?: (
    ownerId: number,
    x: number,
    y: number,
  ) => { id: number; kind: 0 | 1 | 2 } | null;
}

let nextEnemyId = 1;

export function resetEnemyIds() {
  nextEnemyId = 1;
}

export function countZombies(enemies: Enemy[]): number {
  return enemies.filter((e) => e.type === 0 && e.state !== 3).length;
}

export function stepWaves(
  wm: WaveManager,
  enemies: Enemy[],
  ctx: EnemySimCtx,
): void {
  if (!wm.active) return;
  if (wm.intermissionUntil > 0) {
    if (ctx.serverTime >= wm.intermissionUntil) {
      beginNextWave(wm, ctx.serverTime);
    }
    return;
  }

  // spawn: prioriza Brutamontes; zumbis respeitam cap
  while (wm.queue.length > 0 && ctx.serverTime >= wm.nextSpawnAt) {
    let idx = wm.queue.findIndex((q) => q.type === 1);
    if (idx < 0) idx = 0;
    // se o da frente é zumbi e o cap encheu, para (brute já foi priorizado se existia)
    const next = wm.queue[idx]!;
    if (next.type === 0 && countZombies(enemies) >= MAX_ZOMBIES) break;
    if (next.type === 1 && enemies.some((e) => e.type === 1 && e.state !== 3)) {
      // já tem brute vivo — remove da fila espúria
      wm.queue.splice(idx, 1);
      continue;
    }
    wm.queue.splice(idx, 1);
    const pos = spawnPointAwayFromPlayers(ctx.players);
    const def = ENEMY_DEFS[next.type]!;
    const resolved = resolveWalls(pos.x, pos.y, def.radius, ctx.doorBits);
    const e: Enemy = {
      id: nextEnemyId++,
      type: next.type,
      x: resolved.x,
      y: resolved.y,
      vx: 0,
      vy: 0,
      hp: def.hp,
      state: 0,
      targetId: -1,
      targetKind: 0,
      ownerId: -1,
      expiresAt: 0,
      missTargetMs: 0,
      timer: 0,
      retargetAt: 0,
      chargeX: 0,
      chargeY: 0,
      slideX: 0,
      slideY: 0,
      slideUntil: 0,
      stuck: 0,
      lastX: resolved.x,
      lastY: resolved.y,
    };
    enemies.push(e);
    if (next.type === 1) wm.bruteAlive = true;
    ctx.emit({
      kind: "enemySpawn",
      a: e.id,
      b: e.type,
      x: e.x,
      y: e.y,
      weaponId: e.type,
    });
    // brute spawna imediato; zumbis com intervalo curto
    wm.nextSpawnAt = ctx.serverTime + (next.type === 1 ? 80 : 180 + Math.random() * 140);
  }

  // onda limpa? (ignora Gigantes — não são da wave)
  const waveEnemies = enemies.filter((e) => e.type !== 2);
  if (
    wm.remaining <= 0 &&
    wm.queue.length === 0 &&
    waveEnemies.every((e) => e.state === 3 || e.hp <= 0)
  ) {
    wm.intermissionUntil = ctx.serverTime + 2500;
  }
}

function separateEnemies(enemies: Enemy[]) {
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i]!;
    if (a.state === 3) continue;
    const ra = enemyOf(a).radius;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j]!;
      if (b.state === 3) continue;
      const rb = enemyOf(b).radius;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const min = ra + rb - 2;
      if (d < min) {
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }
}

export function damageEnemy(
  enemies: Enemy[],
  wm: WaveManager,
  enemyId: number,
  amount: number,
  ctx: EnemySimCtx,
): boolean {
  const e = enemies.find((x) => x.id === enemyId);
  if (!e || e.state === 3) return false;

  // Brutamontes: armadura brutal — sem saber o HP, luta longa
  let dmg = amount;
  if (e.type === 1) {
    const armor =
      e.state === 5 ? 0.15 : // quase imune no dash
      e.state === 4 ? 0.28 : // tanka no windup
      e.state === 6 ? 0.55 : // janela de stun (única chance boa)
      0.32; // chase normal
    dmg = Math.max(1, Math.round(amount * armor));
  }

  e.hp -= dmg;
  ctx.emit({
    kind: "enemyHit",
    a: enemyId,
    b: e.type,
    x: e.x,
    y: e.y,
    weaponId: e.type,
  });
  if (e.hp <= 0) {
    e.hp = 0;
    e.state = 3;
    e.timer = 200;
    if (e.type !== 2) {
      wm.remaining = Math.max(0, wm.remaining - 1);
      if (e.type === 1) wm.bruteAlive = false;
      if (Math.random() < 0.55) ctx.spawnAmmoDrop?.(e.x, e.y);
    }
    ctx.emit({
      kind: e.type === 2 ? "giantExpire" : "enemyDeath",
      a: enemyId,
      b: e.type === 2 ? e.ownerId : e.type,
      x: e.x,
      y: e.y,
      weaponId: e.type,
    });
    return true;
  }
  // só sniper / hit MUITO pesado cancela windup
  if (e.type === 1 && e.state === 4 && amount >= 65) {
    e.state = 1;
    e.timer = 80;
  }
  // hit no chefe: ele foca quem atirou se estiver perto
  if (e.type === 1 && e.state === 1) {
    e.timer = Math.min(e.timer, 80);
  }
  return false;
}

/** Spawna Gigante (habilidade) — autoritativo no host. */
export function spawnGiant(
  enemies: Enemy[],
  opts: {
    x: number;
    y: number;
    ownerId: number;
    targetId: number;
    targetKind: 0 | 1 | 2;
    expiresAt: number;
    doorBits: number;
  },
  ctx: EnemySimCtx,
): Enemy {
  const def = ENEMY_DEFS[2]!;
  const resolved = resolveWalls(opts.x, opts.y, def.radius, opts.doorBits);
  const e: Enemy = {
    id: nextEnemyId++,
    type: 2,
    x: resolved.x,
    y: resolved.y,
    vx: 0,
    vy: 0,
    hp: def.hp,
    state: 1,
    targetId: opts.targetId,
    targetKind: opts.targetKind,
    ownerId: opts.ownerId,
    expiresAt:
      opts.expiresAt > ctx.serverTime
        ? opts.expiresAt
        : ctx.serverTime + GIANT_LIFE_MS,
    missTargetMs: 0,
    timer: 0,
    retargetAt: Number.POSITIVE_INFINITY,
    chargeX: 0,
    chargeY: 0,
    slideX: 0,
    slideY: 0,
    slideUntil: 0,
    stuck: 0,
    lastX: resolved.x,
    lastY: resolved.y,
  };
  enemies.push(e);
  ctx.emit({
    kind: "giantSpawn",
    a: e.id,
    b: e.ownerId,
    x: e.x,
    y: e.y,
    weaponId: ((e.targetKind & 3) << 8) | (e.targetId & 0xff),
  });
  return e;
}

/** Atualiza Gigantes (PvP e co-op). */
export function stepGiants(enemies: Enemy[], dt: number, ctx: EnemySimCtx) {
  const dtMs = dt * 1000;
  const keep: Enemy[] = [];
  for (const e of enemies) {
    if (e.type !== 2) {
      keep.push(e);
      continue;
    }
    if (e.state === 3) {
      e.timer -= dtMs;
      if (e.timer > 0) keep.push(e);
      continue;
    }
    if (!stepGiant(e, dt, dtMs, ctx)) continue;
    keep.push(e);
  }
  enemies.length = 0;
  enemies.push(...keep);
}

function tryRetargetGiant(e: Enemy, ctx: EnemySimCtx): boolean {
  const next = ctx.pickGiantRetarget?.(e.ownerId, e.x, e.y);
  if (!next) return false;
  e.targetId = next.id;
  e.targetKind = next.kind;
  e.missTargetMs = 0;
  e.state = 1;
  e.timer = 0;
  return true;
}

function stepGiant(e: Enemy, dt: number, dtMs: number, ctx: EnemySimCtx): boolean {
  const def = ENEMY_DEFS[2]!;

  // só corrige expiresAt inválido (0/NaN) — NÃO renovar vida se já expirou
  if (!(e.expiresAt > 0)) {
    e.expiresAt = ctx.serverTime + GIANT_LIFE_MS;
  } else if (ctx.serverTime >= e.expiresAt) {
    ctx.emit({
      kind: "giantExpire",
      a: e.id,
      b: e.ownerId,
      x: e.x,
      y: e.y,
      weaponId: e.targetId,
    });
    return false;
  }

  // Duelo: se existe Gigante rival, prioriza brigar com ele
  const rival = ctx.findRivalGiant?.(e.ownerId, e.x, e.y);
  if (rival) {
    e.targetId = rival.id;
    e.targetKind = 2;
    e.missTargetMs = 0;
  }

  let target = ctx.resolveGiantTarget?.(e.targetKind, e.targetId);
  if (!target || !target.alive) {
    e.missTargetMs = (e.missTargetMs || 0) + dtMs;
    // alvo morreu/sumiu → pega outro em vez de sumir do nada
    if (tryRetargetGiant(e, ctx)) {
      target = ctx.resolveGiantTarget?.(e.targetKind, e.targetId);
      if (target?.alive) {
        // continua perseguição neste tick
      } else {
        return true;
      }
    } else if (e.missTargetMs < GIANT_MISS_GRACE_MS) {
      return true;
    } else {
      ctx.emit({
        kind: "giantExpire",
        a: e.id,
        b: e.ownerId,
        x: e.x,
        y: e.y,
        weaponId: e.targetId,
      });
      return false;
    }
  }
  if (!target || !target.alive) return true;
  e.missTargetMs = 0;

  const dist = Math.hypot(target.x - e.x, target.y - e.y);

  if (e.state === 2) {
    e.timer -= dtMs;
    if (e.timer <= 0) {
      // usa direção TRAVADA no início do windup (não recalcula — evita inverter
      // quando o Gigante já está em cima/além do alvo)
      let kx = e.chargeX;
      let ky = e.chargeY;
      let kl = Math.hypot(kx, ky);
      if (kl < 0.15) {
        kx = target.x - e.x;
        ky = target.y - e.y;
        kl = Math.hypot(kx, ky) || 1;
      }
      kx /= kl;
      ky /= kl;
      const knock = 4200;
      const hitKind = e.targetKind;
      const hitId = e.targetId;
      const before = ctx.resolveGiantTarget?.(hitKind, hitId);
      ctx.executeGiantKill?.(hitKind, hitId, e.ownerId, kx * knock, ky * knock);
      // duelo: executeGiantKill mata os DOIS — se eu morri, sai
      if (e.hp <= 0 || (e.state as number) === 3) return false;
      const after = ctx.resolveGiantTarget?.(hitKind, hitId);
      const killed = !!before?.alive && (!after || !after.alive);
      if (killed) {
        ctx.emit({
          kind: "giantHit",
          a: e.id,
          b: e.ownerId,
          x: target.x,
          y: target.y,
          weaponId: ((hitKind & 3) << 8) | (hitId & 0xff),
        });
        return false; // missão cumprida — some após o arremesso
      }
      // golpe falhou (alvo saiu/morreu no windup) — NÃO some: retarget ou persegue
      if (tryRetargetGiant(e, ctx)) return true;
      e.state = 1;
      e.timer = 0;
      return true;
    }
    return true;
  }

  // só golpeia se "vê" o alvo (LOS) ou está colado — não esmurra parede
  const seesTarget = clearPath(e.x, e.y, target.x, target.y, def.radius * 0.7, ctx.doorBits);
  if (dist < def.attackRange && (seesTarget || dist < 30)) {
    // trava direção do arremesso: Gigante → alvo (ou heading de aproximação)
    let tx = target.x - e.x;
    let ty = target.y - e.y;
    let tl = Math.hypot(tx, ty);
    if (tl < 8) {
      // já colados: usa velocidade de aproximação / último heading
      const spd = Math.hypot(e.vx, e.vy);
      if (spd > 20) {
        tx = e.vx;
        ty = e.vy;
        tl = spd;
      } else if (Math.hypot(e.chargeX, e.chargeY) > 0.2) {
        tx = e.chargeX;
        ty = e.chargeY;
        tl = Math.hypot(tx, ty);
      } else {
        tl = 1;
      }
    }
    e.chargeX = tx / tl;
    e.chargeY = ty / tl;
    e.state = 2;
    e.timer = def.windupMs;
    e.vx *= 0.15;
    e.vy *= 0.15;
    return true;
  }

  e.state = 1;
  chaseGiant(e, def, target.x, target.y, dt, ctx);
  const pos = resolveWalls(e.x, e.y, def.radius, ctx.doorBits);
  e.x = pos.x;
  e.y = pos.y;
  return true;
}

/**
 * Perseguição inteligente do Gigante:
 * - sempre o alvo travado na invocação (tx,ty atualizado)
 * - se vê o alvo (LOS livre) → vai direto
 * - se não vê → desvia (laterais / porta), nunca empurrar cego na parede
 */
function chaseGiant(
  e: Enemy,
  def: EnemyDef,
  tx: number,
  ty: number,
  dt: number,
  ctx: EnemySimCtx,
) {
  if (ctx.openNearbyDoors) {
    ctx.doorBits = ctx.openNearbyDoors(e.x, e.y);
  }

  const inside = buildingAt(e.x, e.y);
  const targetInside = buildingAt(tx, ty);
  let goalX = tx;
  let goalY = ty;

  // casa: entra/sai pela porta (não atravessa muro)
  if (inside != null && targetInside !== inside) {
    const goals = doorExitGoals(inside);
    if (goals) {
      ctx.doorBits = ctx.forceOpenDoor?.(inside) ?? ctx.doorBits;
      if (ctx.openNearbyDoors) ctx.doorBits = ctx.openNearbyDoors(goals.doorX, goals.doorY);
      const distDoor = Math.hypot(e.x - goals.doorX, e.y - goals.doorY);
      goalX = distDoor > 16 ? goals.doorX : goals.outX;
      goalY = distDoor > 16 ? goals.doorY : goals.outY;
    }
  } else if (inside == null && targetInside != null) {
    const goals = doorExitGoals(targetInside);
    if (goals) {
      ctx.doorBits = ctx.forceOpenDoor?.(targetInside) ?? ctx.doorBits;
      if (ctx.openNearbyDoors) ctx.doorBits = ctx.openNearbyDoors(goals.doorX, goals.doorY);
      if (!clearPath(e.x, e.y, tx, ty, 8, ctx.doorBits)) {
        goalX = goals.doorX;
        goalY = goals.doorY;
      }
    }
  } else if (!clearPath(e.x, e.y, tx, ty, def.radius * 0.75, ctx.doorBits)) {
    // sem LOS: waypoint lateral em volta do obstáculo (vê o bloqueio à frente)
    const detour = giantDetourWaypoint(e.x, e.y, tx, ty, def.radius, ctx.doorBits);
    if (detour) {
      goalX = detour.x;
      goalY = detour.y;
    }
  }

  const nearDoor = DOOR_DEFS.some(
    (d) => Math.hypot(e.x - (d.tx * 32 + 16), e.y - (d.ty * 32 + 16)) < 48,
  );
  const navR = nearDoor ? 8 : def.radius;

  const gx = goalX - e.x;
  const gy = goalY - e.y;
  const gDist = Math.hypot(gx, gy) || 1;
  const gUx = gx / gDist;
  const gUy = gy / gDist;

  // stuck tracking
  const moved = Math.hypot(e.x - e.lastX, e.y - e.lastY);
  if (moved < 0.5) e.stuck++;
  else e.stuck = Math.max(0, e.stuck - 2);
  e.lastX = e.x;
  e.lastY = e.y;

  // mantém desvio lateral se ainda funciona
  if (
    e.stuck < 8 &&
    ctx.serverTime < e.slideUntil &&
    Math.hypot(e.slideX, e.slideY) > 0.2 &&
    canStepEnemy(e.x, e.y, e.slideX, e.slideY, navR, ctx.doorBits)
  ) {
    const spd = def.speed;
    const slid = moveAndSlide(
      e.x,
      e.y,
      e.slideX * spd * 0.85 + e.vx * 0.2,
      e.slideY * spd * 0.85 + e.vy * 0.2,
      dt,
      navR,
      ctx.doorBits,
    );
    e.x = slid.x;
    e.y = slid.y;
    e.vx = slid.vx;
    e.vy = slid.vy;
    return;
  }

  // escolhe direção que AVANÇA ao alvo e tem passo livre (não vai cego)
  type Cand = { ux: number; uy: number; score: number };
  const cands: Cand[] = [];
  const consider = (dx: number, dy: number, bonus: number) => {
    const mag = Math.hypot(dx, dy);
    if (mag < 0.05) return;
    const ux = dx / mag;
    const uy = dy / mag;
    if (!canStepEnemy(e.x, e.y, ux, uy, navR, ctx.doorBits)) return;
    // progresso: quanto essa direção aproxima do goal
    const step = 28;
    const nx = e.x + ux * step;
    const ny = e.y + uy * step;
    const before = Math.hypot(goalX - e.x, goalY - e.y);
    const after = Math.hypot(goalX - nx, goalY - ny);
    const progress = before - after;
    const align = ux * gUx + uy * gUy;
    // bônus se daqui enxerga melhor o alvo final
    const losBonus = clearPath(nx, ny, tx, ty, navR * 0.7, ctx.doorBits) ? 40 : 0;
    cands.push({
      ux,
      uy,
      score: progress * 3.2 + align * 40 + losBonus + bonus,
    });
  };

  consider(gUx, gUy, 20);
  consider(-gUy, gUx, 12); // esquerda
  consider(gUy, -gUx, 12); // direita
  consider(-gUy * 0.7 + gUx * 0.3, gUx * 0.7 + gUy * 0.3, 8);
  consider(gUy * 0.7 + gUx * 0.3, -gUx * 0.7 + gUy * 0.3, 8);
  const wallN = freeNormalEnemy(e.x, e.y, navR, ctx.doorBits);
  if (wallN) {
    consider(wallN.nx, wallN.ny, 28);
    consider(wallN.nx * 0.6 + gUx * 0.4, wallN.ny * 0.6 + gUy * 0.4, 18);
  }
  // leque fino em volta da mira do alvo (vê o que tem na frente)
  for (let i = -4; i <= 4; i++) {
    if (i === 0) continue;
    const a = Math.atan2(gUy, gUx) + i * 0.28;
    consider(Math.cos(a), Math.sin(a), 4 - Math.abs(i));
  }

  let ux = gUx;
  let uy = gUy;
  if (cands.length > 0) {
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0]!;
    ux = best.ux;
    uy = best.uy;
    e.slideX = ux;
    e.slideY = uy;
    e.slideUntil = ctx.serverTime + 380;
  } else if (wallN) {
    ux = wallN.nx;
    uy = wallN.ny;
    e.slideX = ux;
    e.slideY = uy;
    e.slideUntil = ctx.serverTime + 500;
  }

  // unstick: se ainda sem progresso, empurra pra fora da parede
  if (e.stuck > 12) {
    if (wallN) {
      e.x += wallN.nx * 16;
      e.y += wallN.ny * 16;
      const p = resolveWalls(e.x, e.y, navR, ctx.doorBits);
      e.x = p.x;
      e.y = p.y;
      ux = wallN.nx;
      uy = wallN.ny;
    }
    e.stuck = 0;
  }

  const desiredVx = ux * def.speed;
  const desiredVy = uy * def.speed;
  const blend = Math.min(1, 8 * dt);
  e.vx = e.vx * (1 - blend) + desiredVx * blend;
  e.vy = e.vy * (1 - blend) + desiredVy * blend;

  const slid = moveAndSlide(e.x, e.y, e.vx, e.vy, dt, navR, ctx.doorBits);
  e.x = slid.x;
  e.y = slid.y;
  e.vx = slid.vx;
  e.vy = slid.vy;

  // memoriza "olhar" pro alvo (heading)
  e.chargeX = gUx;
  e.chargeY = gUy;
}

/** Waypoint curto pra contornar obstáculo entre o Gigante e o alvo. */
function giantDetourWaypoint(
  x: number,
  y: number,
  tx: number,
  ty: number,
  r: number,
  doorBits: number,
): { x: number; y: number } | null {
  const dx = tx - x;
  const dy = ty - y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  // laterais à esquerda/direita do bloqueio
  const sides: [number, number][] = [
    [-uy, ux],
    [uy, -ux],
    [-uy * 0.7 - ux * 0.3, ux * 0.7 - uy * 0.3],
    [uy * 0.7 - ux * 0.3, -ux * 0.7 - uy * 0.3],
  ];
  let best: { x: number; y: number; score: number } | null = null;
  for (const [sx, sy] of sides) {
    for (const reach of [48, 80, 120]) {
      const px = x + sx * reach + ux * 20;
      const py = y + sy * reach + uy * 20;
      if (hitsSolid(px, py, r * 0.8, doorBits)) continue;
      // precisa conseguir dar o primeiro passo nessa direção
      const toDx = px - x;
      const toDy = py - y;
      const tm = Math.hypot(toDx, toDy) || 1;
      if (!canStepEnemy(x, y, toDx / tm, toDy / tm, r, doorBits)) continue;
      // e de lá idealmente enxergar o alvo (ou chegar mais perto)
      const los = clearPath(px, py, tx, ty, r * 0.7, doorBits);
      const closer = Math.hypot(tx - px, ty - py);
      const score = (los ? 500 : 0) - closer;
      if (!best || score > best.score) best = { x: px, y: py, score };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

export function stepEnemies(enemies: Enemy[], dt: number, ctx: EnemySimCtx) {
  const dtMs = dt * 1000;
  const keep: Enemy[] = [];

  for (const e of enemies) {
    if (e.type === 2) {
      keep.push(e);
      continue;
    }
    const def = enemyOf(e);

    if (e.state === 3) {
      e.timer -= dtMs;
      if (e.timer > 0) keep.push(e);
      continue;
    }

    if (ctx.serverTime >= e.retargetAt || e.targetId < 0) {
      e.targetId = pickTarget(
        e.x,
        e.y,
        ctx.players,
        ctx.doorBits,
        e.type === 1,
      );
      // chefe reavalia alvo mais rápido (caça feridos)
      e.retargetAt =
        ctx.serverTime + (e.type === 1 ? 280 + Math.random() * 120 : 450 + Math.random() * 150);
    }
    const target = ctx.players.find((p) => p.id === e.targetId && p.alive);

    if (e.type === 1) {
      stepBrute(e, def, target, dt, dtMs, ctx);
    } else {
      stepZombie(e, def, target, dt, dtMs, ctx);
    }

    // damp residual
    e.vx *= Math.exp(-3 * dt);
    e.vy *= Math.exp(-3 * dt);
    if (Math.abs(e.vx) < 2) e.vx = 0;
    if (Math.abs(e.vy) < 2) e.vy = 0;

    keep.push(e);
  }

  enemies.length = 0;
  enemies.push(...keep);
  separateEnemies(enemies);
  for (const e of enemies) {
    if (e.state === 3) continue;
    const def = enemyOf(e);
    const nearDoor = DOOR_DEFS.some(
      (d) => Math.hypot(e.x - (d.tx * 32 + 16), e.y - (d.ty * 32 + 16)) < 56,
    );
    const r = nearDoor ? 8 : def.radius;
    const pos = resolveWalls(e.x, e.y, r, ctx.doorBits);
    e.x = pos.x;
    e.y = pos.y;
  }
}

function canStepEnemy(
  x: number,
  y: number,
  ux: number,
  uy: number,
  r: number,
  doorBits: number,
): boolean {
  const look = r + 10;
  return (
    !hitsSolid(x + ux * look, y + uy * look, r * 0.85, doorBits) &&
    !hitsSolid(x + ux * (look * 0.5), y + uy * (look * 0.5), r * 0.85, doorBits)
  );
}

function freeNormalEnemy(
  x: number,
  y: number,
  r: number,
  doorBits: number,
): { nx: number; ny: number } | null {
  let nx = 0;
  let ny = 0;
  const d = r + 6;
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

function nearestDoorGoal(
  x: number,
  y: number,
  doorBits: number,
  preferClosed: boolean,
): { x: number; y: number; dist: number; id: number } | null {
  let best: { x: number; y: number; dist: number; id: number } | null = null;
  for (const d of DOOR_DEFS) {
    const open = !!(doorBits & (1 << d.id));
    if (preferClosed && open) continue;
    const cx = d.tx * 32 + 16;
    const cy = d.ty * 32 + 16;
    const dist = Math.hypot(x - cx, y - cy);
    if (!best || dist < best.dist) best = { x: cx, y: cy, dist, id: d.id };
  }
  if (preferClosed && !best) return nearestDoorGoal(x, y, doorBits, false);
  return best;
}

/** Porta + ponto FORA da casa (pra entrar/sair de verdade). */
function doorExitGoals(doorId: number): {
  doorX: number;
  doorY: number;
  outX: number;
  outY: number;
} | null {
  const d = DOOR_DEFS.find((x) => x.id === doorId);
  if (!d) return null;
  const doorX = d.tx * 32 + 16;
  const doorY = d.ty * 32 + 16;
  const b = BUILDINGS.find((x) => x.id === doorId);
  let outX = doorX;
  let outY = doorY;
  if (b) {
    const icx = (b.interior.tx + b.interior.tw * 0.5) * 32;
    const icy = (b.interior.ty + b.interior.th * 0.5) * 32;
    const dx = doorX - icx;
    const dy = doorY - icy;
    const len = Math.hypot(dx, dy) || 1;
    outX = doorX + (dx / len) * 56;
    outY = doorY + (dy / len) * 56;
  } else if (d.orient === "h") {
    outY = doorY + 56;
  } else {
    outX = doorX + 56;
  }
  return { doorX, doorY, outX, outY };
}

function clearPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
  doorBits: number,
): boolean {
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (hitsSolid(ax + (bx - ax) * t, ay + (by - ay) * t, r * 0.9, doorBits)) return false;
  }
  return true;
}

function stepZombie(
  e: Enemy,
  def: EnemyDef,
  target: { id: number; x: number; y: number; alive: boolean } | undefined,
  dt: number,
  dtMs: number,
  ctx: EnemySimCtx,
) {
  if (!target) {
    e.state = 0;
    wander(e, def, dt, ctx);
    return;
  }
  const dist = Math.hypot(target.x - e.x, target.y - e.y);

  if (e.state === 2) {
    e.timer -= dtMs;
    if (e.timer <= 0) {
      if (dist < def.attackRange + 6) {
        ctx.damagePlayer(target.id, def.attackDamage, e.id);
      }
      e.state = 1;
      e.timer = def.cooldownMs;
    }
    return;
  }

  if (e.timer > 0) {
    e.timer -= dtMs;
  }

  if (dist < def.attackRange && e.timer <= 0) {
    e.state = 2;
    e.timer = def.windupMs;
    return;
  }

  if (dist < def.aggroRange || e.state === 1) {
    e.state = 1;
    moveToward(e, def, target.x, target.y, dt, ctx);
  } else {
    e.state = 0;
    wander(e, def, dt, ctx);
  }
}

function stepBrute(
  e: Enemy,
  def: EnemyDef,
  target: { id: number; x: number; y: number; alive: boolean; hp?: number } | undefined,
  dt: number,
  dtMs: number,
  ctx: EnemySimCtx,
) {
  const enraged = e.hp < def.hp * 0.4;
  const rageMul = enraged ? 1.35 : 1;

  if (e.state === 6) {
    // stun curto — chefe se recupera rápido e volta à caça
    e.timer -= dtMs;
    e.vx *= 0.88;
    e.vy *= 0.88;
    if (Math.hypot(e.slideX, e.slideY) > 0.1) {
      const slid = moveAndSlide(
        e.x,
        e.y,
        e.slideX * 90,
        e.slideY * 90,
        dt,
        def.radius,
        ctx.doorBits,
      );
      e.x = slid.x;
      e.y = slid.y;
    }
    if (e.timer <= 0) {
      e.state = 1;
      e.timer = enraged ? 80 : 180;
    }
    return;
  }

  if (e.state === 4) {
    e.timer -= dtMs;
    // durante windup: ainda vira pro alvo (mira inteligente)
    if (target) {
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.chargeX = dx / d;
      e.chargeY = dy / d;
    }
    if (e.timer <= 0 && target) {
      // mira à frente do alvo (lead curto)
      const aimX = target.x + e.chargeX * 55;
      const aimY = target.y + e.chargeY * 55;
      const dx = aimX - e.x;
      const dy = aimY - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (!clearPath(e.x, e.y, target.x, target.y, def.radius, ctx.doorBits)) {
        e.state = 1;
        e.timer = 100;
        moveToward(e, def, target.x, target.y, dt, ctx, 1.45 * rageMul);
        return;
      }
      e.chargeX = dx / d;
      e.chargeY = dy / d;
      const dashSpd = (enraged ? 420 : 360) * rageMul;
      e.vx = e.chargeX * dashSpd;
      e.vy = e.chargeY * dashSpd;
      e.state = 5;
      e.timer = enraged ? 1100 : 950;
    }
    return;
  }

  if (e.state === 5) {
    // charge dentro de casa sem caminho → aborta e sai pela porta
    const room = buildingAt(e.x, e.y);
    if (room != null && target && buildingAt(target.x, target.y) !== room) {
      e.state = 1;
      e.vx *= 0.2;
      e.vy *= 0.2;
      e.timer = 0;
      moveToward(e, def, target.x, target.y, dt, ctx, 1.5 * rageMul);
      return;
    }
    e.timer -= dtMs;
    // micro-correção no dash em direção ao alvo (inteligente, não burro)
    if (target && e.timer > 200) {
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const steer = enraged ? 0.12 : 0.07;
      const spd = Math.hypot(e.vx, e.vy) || 360;
      e.vx = e.vx * (1 - steer) + (dx / d) * spd * steer;
      e.vy = e.vy * (1 - steer) + (dy / d) * spd * steer;
      const nd = Math.hypot(e.vx, e.vy) || 1;
      e.vx = (e.vx / nd) * spd;
      e.vy = (e.vy / nd) * spd;
      e.chargeX = e.vx / nd;
      e.chargeY = e.vy / nd;
    }
    const beforeX = e.x;
    const beforeY = e.y;
    const slid = moveAndSlide(e.x, e.y, e.vx, e.vy, dt, def.radius, ctx.doorBits);
    e.x = slid.x;
    e.y = slid.y;
    const blocked =
      (Math.abs(slid.vx) < 1 && Math.abs(e.vx) > 50) ||
      (Math.abs(slid.vy) < 1 && Math.abs(e.vy) > 50) ||
      Math.hypot(e.x - beforeX, e.y - beforeY) < Math.hypot(e.vx, e.vy) * dt * 0.25;
    if (blocked) {
      e.vx = 0;
      e.vy = 0;
      const n = freeNormalEnemy(e.x, e.y, def.radius, ctx.doorBits);
      if (n) {
        e.slideX = n.nx;
        e.slideY = n.ny;
        e.slideUntil = ctx.serverTime + 700;
      }
      e.state = 6;
      e.timer = enraged ? 320 : 420; // recupera rápido
      return;
    }
    e.vx = slid.vx;
    e.vy = slid.vy;
    for (const p of ctx.players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - e.x, p.y - e.y) < def.radius + PLAYER_HIT_R + 6) {
        const smash = def.attackDamage + (enraged ? 28 : 18);
        ctx.damagePlayer(
          p.id,
          smash,
          e.id,
          e.chargeX * (enraged ? 1400 : 1100),
          e.chargeY * (enraged ? 1400 : 1100),
        );
      }
    }
    if (e.timer <= 0) {
      e.state = 1;
      e.vx *= 0.35;
      e.vy *= 0.35;
      e.timer = enraged ? def.cooldownMs * 0.55 : def.cooldownMs;
    }
    return;
  }

  if (!target) {
    e.state = 0;
    wander(e, def, dt, ctx);
    return;
  }

  const dist = Math.hypot(target.x - e.x, target.y - e.y);
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const face = Math.atan2(e.vy || dy, e.vx || dx);
  const angAlign = Math.abs(Math.atan2(dy, dx) - face);
  const angOk = Math.min(angAlign, Math.PI * 2 - angAlign);

  if (e.state === 2) {
    e.timer -= dtMs;
    if (e.timer <= 0) {
      if (dist < def.attackRange + 10) {
        const knock = 700;
        ctx.damagePlayer(
          target.id,
          def.attackDamage + (enraged ? 12 : 0),
          e.id,
          (dx / (dist || 1)) * knock,
          (dy / (dist || 1)) * knock,
        );
      }
      e.state = 1;
      e.timer = enraged ? def.cooldownMs * 0.5 : def.cooldownMs * 0.75;
    }
    return;
  }

  if (e.timer > 0) e.timer -= dtMs;

  const bruteInside = buildingAt(e.x, e.y);
  // dentro da casa com alvo fora → sai pela porta (sem charge na parede)
  if (bruteInside != null && buildingAt(target.x, target.y) !== bruteInside) {
    e.state = 1;
    moveToward(e, def, target.x, target.y, dt, ctx, (dist > 220 ? 1.55 : 1.35) * rageMul);
    return;
  }

  // investida frequente, de longe — pressão constante
  const chargeMax = enraged ? 380 : 320;
  const chargeMin = enraged ? 45 : 55;
  if (
    dist < chargeMax &&
    dist > chargeMin &&
    e.timer <= 0 &&
    angOk < (enraged ? 1.1 : 0.85) &&
    clearPath(e.x, e.y, target.x, target.y, def.radius, ctx.doorBits)
  ) {
    e.state = 4;
    e.timer = enraged ? def.windupMs * 0.7 : def.windupMs;
    e.vx = 0;
    e.vy = 0;
    return;
  }

  if (dist < def.attackRange + (enraged ? 8 : 0) && e.timer <= 0) {
    e.state = 2;
    e.timer = enraged ? 200 : 260;
    return;
  }

  e.state = 1;
  moveToward(e, def, target.x, target.y, dt, ctx, (dist > 220 ? 1.55 : 1.35) * rageMul);
}

function moveToward(
  e: Enemy,
  def: EnemyDef,
  tx: number,
  ty: number,
  dt: number,
  ctx: EnemySimCtx,
  speedMult = 1,
) {
  if (ctx.openNearbyDoors) {
    ctx.doorBits = ctx.openNearbyDoors(e.x, e.y);
  }

  const inside = buildingAt(e.x, e.y);
  const targetInside = buildingAt(tx, ty);

  // Só força saída quando o ALVO está fora desta casa (não por clearPath falhar)
  if (inside != null && targetInside !== inside) {
    exitBuilding(e, def, inside, dt, ctx, speedMult);
    // se já saiu neste frame, continua a perseguir o alvo abaixo
    if (buildingAt(e.x, e.y) != null) return;
  }

  let goalX = tx;
  let goalY = ty;

  // Fora → entrar na casa do alvo (só neste caso usa porta)
  if (inside == null && targetInside != null) {
    const goals = doorExitGoals(targetInside);
    if (goals) {
      ctx.doorBits = ctx.forceOpenDoor?.(targetInside) ?? ctx.doorBits;
      if (ctx.openNearbyDoors) ctx.doorBits = ctx.openNearbyDoors(goals.doorX, goals.doorY);
      const distDoor = Math.hypot(e.x - goals.doorX, e.y - goals.doorY);
      if (distDoor > 18 || !clearPath(e.x, e.y, tx, ty, 8, ctx.doorBits)) {
        goalX = goals.doorX;
        goalY = goals.doorY;
      }
    }
  }

  // preso genérico — sem redirecionar pra porta longe (causava correr sem parar)
  const moved = Math.hypot(e.x - e.lastX, e.y - e.lastY);
  if (moved < 0.45) e.stuck++;
  else e.stuck = Math.max(0, e.stuck - 2);
  e.lastX = e.x;
  e.lastY = e.y;

  if (e.stuck > 14) {
    e.slideUntil = 0;
    const room = buildingAt(e.x, e.y);
    if (room != null && targetInside !== room) {
      exitBuilding(e, def, room, dt, ctx, speedMult * 1.2);
      return;
    }
    const n = freeNormalEnemy(e.x, e.y, def.radius, ctx.doorBits);
    if (n) {
      e.x += n.nx * 14;
      e.y += n.ny * 14;
      const pos = resolveWalls(e.x, e.y, def.radius, ctx.doorBits);
      e.x = pos.x;
      e.y = pos.y;
      e.slideX = n.nx;
      e.slideY = n.ny;
      e.slideUntil = ctx.serverTime + 400;
    }
    e.stuck = 0;
  }

  const gx = goalX - e.x;
  const gy = goalY - e.y;
  const gDist = Math.hypot(gx, gy) || 1;
  const gUx = gx / gDist;
  const gUy = gy / gDist;

  const nearDoor = DOOR_DEFS.some(
    (d) => Math.hypot(e.x - (d.tx * 32 + 16), e.y - (d.ty * 32 + 16)) < 48,
  );
  const navR = nearDoor ? 8 : def.radius;

  if (
    e.stuck < 6 &&
    ctx.serverTime < e.slideUntil &&
    Math.hypot(e.slideX, e.slideY) > 0.2 &&
    canStepEnemy(e.x, e.y, e.slideX, e.slideY, navR, ctx.doorBits)
  ) {
    const spd = def.speed * speedMult;
    const slid = moveAndSlide(
      e.x,
      e.y,
      e.slideX * spd + e.vx * 0.25,
      e.slideY * spd + e.vy * 0.25,
      dt,
      navR,
      ctx.doorBits,
    );
    e.x = slid.x;
    e.y = slid.y;
    return;
  }

  type Cand = { ux: number; uy: number; score: number };
  const cands: Cand[] = [];
  const push = (dx: number, dy: number, bonus = 0) => {
    const mag = Math.hypot(dx, dy);
    if (mag < 0.05) return;
    const ux = dx / mag;
    const uy = dy / mag;
    if (!canStepEnemy(e.x, e.y, ux, uy, navR, ctx.doorBits)) return;
    const align = ux * gUx + uy * gUy;
    const n = freeNormalEnemy(e.x, e.y, navR, ctx.doorBits);
    const away = n ? ux * n.nx + uy * n.ny : 0;
    cands.push({ ux, uy, score: align * 55 + away * 30 + bonus });
  };

  push(gUx, gUy, 12);
  push(-gUy, gUx, 8);
  push(gUy, -gUx, 8);
  const n = freeNormalEnemy(e.x, e.y, navR, ctx.doorBits);
  if (n) {
    push(n.nx, n.ny, 22);
    push(n.nx * 0.55 + gUx * 0.45, n.ny * 0.55 + gUy * 0.45, 14);
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + e.id * 0.31;
    push(Math.cos(a), Math.sin(a), 0);
  }

  let ux = gUx;
  let uy = gUy;
  if (cands.length > 0) {
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0]!;
    ux = best.ux;
    uy = best.uy;
    e.slideX = ux;
    e.slideY = uy;
    e.slideUntil = ctx.serverTime + 420;
  } else if (n) {
    ux = n.nx;
    uy = n.ny;
    e.slideX = ux;
    e.slideY = uy;
    e.slideUntil = ctx.serverTime + 500;
  }

  const spd = def.speed * speedMult;
  const slid = moveAndSlide(
    e.x,
    e.y,
    ux * spd + e.vx * 0.25,
    uy * spd + e.vy * 0.25,
    dt,
    navR,
    ctx.doorBits,
  );
  e.x = slid.x;
  e.y = slid.y;
}

/** Move reto até a porta da casa e para o ponto externo — não erra o vão. */
function exitBuilding(
  e: Enemy,
  def: EnemyDef,
  buildingId: number,
  dt: number,
  ctx: EnemySimCtx,
  speedMult: number,
) {
  const goals = doorExitGoals(buildingId);
  if (!goals) return;

  ctx.doorBits = ctx.forceOpenDoor?.(buildingId) ?? ctx.doorBits;
  if (ctx.openNearbyDoors) {
    ctx.doorBits = ctx.openNearbyDoors(goals.doorX, goals.doorY);
    ctx.doorBits = ctx.openNearbyDoors(e.x, e.y);
  }

  const stillInside = buildingAt(e.x, e.y) === buildingId;
  const distDoor = Math.hypot(e.x - goals.doorX, e.y - goals.doorY);
  const distOut = Math.hypot(e.x - goals.outX, e.y - goals.outY);

  // já saiu e afastou da porta → para o modo saída (evita correr pro infinito)
  if (!stillInside && distOut < 28) {
    e.stuck = 0;
    e.slideUntil = 0;
    return;
  }

  const goalX = stillInside && distDoor > 14 ? goals.doorX : goals.outX;
  const goalY = stillInside && distDoor > 14 ? goals.doorY : goals.outY;

  const dx = goalX - e.x;
  const dy = goalY - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const navR = 8;
  const spd = def.speed * Math.max(1.15, speedMult) * 1.25;
  const beforeX = e.x;
  const beforeY = e.y;

  let mx = (dx / d) * spd;
  let my = (dy / d) * spd;
  if (stillInside && distDoor < 80) {
    const dd = Math.hypot(goals.doorX - e.x, goals.doorY - e.y) || 1;
    const align = 0.55;
    mx = mx * (1 - align) + ((goals.doorX - e.x) / dd) * spd * align;
    my = my * (1 - align) + ((goals.doorY - e.y) / dd) * spd * align;
  }

  const slid = moveAndSlide(e.x, e.y, mx, my, dt, navR, ctx.doorBits);
  e.x = slid.x;
  e.y = slid.y;
  e.slideX = dx / d;
  e.slideY = dy / d;
  e.slideUntil = ctx.serverTime + 160;

  const moved = Math.hypot(e.x - beforeX, e.y - beforeY);
  if (moved < 0.4) e.stuck++;
  else e.stuck = Math.max(0, e.stuck - 3);
  e.lastX = e.x;
  e.lastY = e.y;

  if (e.stuck > 10 && stillInside) {
    e.x = e.x * 0.5 + goals.doorX * 0.5;
    e.y = e.y * 0.5 + goals.doorY * 0.5;
    const mid = resolveWalls(e.x, e.y, navR, ctx.doorBits);
    e.x = mid.x;
    e.y = mid.y;
  }
  if (e.stuck > 22 && stillInside) {
    const out = resolveWalls(goals.outX, goals.outY, navR, ctx.doorBits);
    e.x = out.x;
    e.y = out.y;
    e.vx = 0;
    e.vy = 0;
    e.stuck = 0;
    e.slideUntil = 0;
  }
}

function wander(e: Enemy, def: EnemyDef, dt: number, ctx: EnemySimCtx) {
  if (ctx.openNearbyDoors) ctx.doorBits = ctx.openNearbyDoors(e.x, e.y);
  const a = e.id * 1.7 + Math.floor(ctx.serverTime / 800) * 0.7;
  moveToward(
    e,
    def,
    e.x + Math.cos(a) * 80,
    e.y + Math.sin(a * 0.9) * 80,
    dt,
    ctx,
    0.4,
  );
}

export function toEnemyStates(enemies: Enemy[]): EnemyState[] {
  return enemies
    // Gigantes morrendo ficam no snap um instante pra TODOS verem o arremesso
    .filter((e) => e.state !== 3 || e.type === 2)
    .map((e) => {
      const def = enemyOf(e);
      // HP como fração 0–255 (protocolo 1 byte) — chefe >255 não some da barra
      const hpByte =
        e.state === 3
          ? 0
          : Math.max(0, Math.min(255, Math.round((e.hp / def.hp) * 255)));
      return {
        id: e.id,
        type: e.type,
        x: e.x,
        y: e.y,
        hp: hpByte,
        state: e.state,
      };
    });
}
