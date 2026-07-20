/**
 * abilities.ts — framework de habilidades (receita: efeito + evento + cooldown).
 */
import type { PlayerState } from "./protocol";

export interface AbilityTargetRef {
  id: number;
  /** 0 = player, 1 = monstro, 2 = Gigante rival */
  kind: 0 | 1 | 2;
  x: number;
  y: number;
}

export interface AbilityCtx {
  emit: (ev: {
    kind: "ability";
    abilityId: number;
    x: number;
    y: number;
    angle: number;
    casterId: number;
  }) => void;
  mode: number;
  /** true se a habilidade gastou CD / teve efeito */
  didCast: boolean;
  spawnGiant?: (target: AbilityTargetRef) => void;
  /** candidatos já filtrados (players e/ou enemies vivos, sem o caster) */
  candidates?: AbilityTargetRef[];
}

export interface AbilityDef {
  id: number;
  name: string;
  cooldownMs: number;
  /** trava de ação durante o conjuro (0 = instantâneo) */
  castMs: number;
  range: number;
  /** meia-abertura do cone (0 = linha estreita) */
  coneRad: number;
  apply: (caster: PlayerState, targets: PlayerState[], now: number, ctx: AbilityCtx) => void;
}

const WATER_JET: AbilityDef = {
  id: 0,
  name: "Jato de Água",
  cooldownMs: 6000,
  castMs: 0,
  range: 280,
  /** ~80° de meia-abertura — generoso pra acertar no tiroteio */
  coneRad: 1.4,
  apply(caster, targets, now, ctx) {
    const aimX = Math.cos(caster.angle);
    const aimY = Math.sin(caster.angle);
    for (const t of targets) {
      const dx = t.x - caster.x;
      const dy = t.y - caster.y;
      const dist = Math.hypot(dx, dy) || 1;
      const awayX = dx / dist;
      const awayY = dy / dist;
      let nx = aimX * 0.8 + awayX * 0.2;
      let ny = aimY * 0.8 + awayY * 0.2;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const falloff = 1 - dist / 280;
      const strength = Math.max(0.7, falloff);
      t.vx = nx * (2800 * strength);
      t.vy = ny * (2800 * strength);
      const sp = t as PlayerState & { stunnedUntil?: number };
      sp.stunnedUntil = Math.max(sp.stunnedUntil ?? 0, now + 1600);
    }
    ctx.didCast = true;
  },
};

/** Melhor candidato no cone da mira (menor erro angular; empate → mais perto). */
function bestInAimCone(
  caster: PlayerState,
  cands: AbilityTargetRef[],
  coneRad: number,
  kindFilter?: 0 | 1 | 2,
): AbilityTargetRef | null {
  const aimX = Math.cos(caster.angle);
  const aimY = Math.sin(caster.angle);
  const minDot = Math.cos(Math.max(0.2, coneRad));
  let best: AbilityTargetRef | null = null;
  let bestScore = -Infinity;
  for (const t of cands) {
    if (kindFilter != null && t.kind !== kindFilter) continue;
    const dx = t.x - caster.x;
    const dy = t.y - caster.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < 0.5) continue;
    const dot = (dx / dist) * aimX + (dy / dist) * aimY;
    if (dot < minDot) continue;
    // alinhamento manda; empate → o da frente (mais perto na mira)
    const score = dot * 2000 - dist;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Melhor alinhado à frente da mira (hemisfério), mesmo fora do cone apertado. */
function bestFacingAim(
  caster: PlayerState,
  cands: AbilityTargetRef[],
  kindFilter?: 0 | 1 | 2,
  minDot = 0.12,
): AbilityTargetRef | null {
  const aimX = Math.cos(caster.angle);
  const aimY = Math.sin(caster.angle);
  let best: AbilityTargetRef | null = null;
  let bestScore = -Infinity;
  for (const t of cands) {
    if (kindFilter != null && t.kind !== kindFilter) continue;
    const dx = t.x - caster.x;
    const dy = t.y - caster.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < 0.5) continue;
    const dot = (dx / dist) * aimX + (dy / dist) * aimY;
    if (dot < minDot) continue;
    const score = dot * 2500 - dist * 0.35;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function nearestCandidate(
  caster: PlayerState,
  cands: AbilityTargetRef[],
  kindFilter?: 0 | 1 | 2,
): AbilityTargetRef | null {
  let best: AbilityTargetRef | null = null;
  let bestD = Infinity;
  for (const t of cands) {
    if (kindFilter != null && t.kind !== kindFilter) continue;
    const d = Math.hypot(t.x - caster.x, t.y - caster.y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** Invocar Gigante — persegue um alvo travado e executa (25 s CD). */
export const SUMMON_GIANT: AbilityDef = {
  id: 1,
  name: "Invocar Gigante",
  cooldownMs: 25000,
  castMs: 0,
  range: 99999,
  /** cone da mira (~55° meia-abertura) — mais permissivo com crowd */
  coneRad: 0.95,
  apply(caster, _targets, _now, ctx) {
    const cands = ctx.candidates ?? [];
    if (cands.length === 0 || !ctx.spawnGiant) return;
    const cone = Math.max(0.45, this.coneRad);
    /** cone largo pra player: a mira manda, não o vizinho mais perto */
    const playerCone = Math.max(cone, 1.05);

    // Prioridade: player na mira > melhor alinhado à frente > rival na mira > monstro
    // nearest só no fim extremo (ninguém à frente)
    const best =
      bestInAimCone(caster, cands, playerCone, 0) ??
      bestFacingAim(caster, cands, 0, 0.08) ??
      bestInAimCone(caster, cands, cone, 2) ??
      bestFacingAim(caster, cands, 2, 0.15) ??
      bestInAimCone(caster, cands, cone, 1) ??
      bestFacingAim(caster, cands, 1, 0.15) ??
      nearestCandidate(caster, cands, 0) ??
      nearestCandidate(caster, cands, 2) ??
      nearestCandidate(caster, cands, 1) ??
      nearestCandidate(caster, cands);

    if (!best) return;
    ctx.spawnGiant(best);
    ctx.didCast = true;
  },
};

/** Duração do buff de velocidade (ms) — espelhar na predição do cliente. */
export const SPRINT_BOOTS_DURATION_MS = 4000;

/** Botas de Impulso — self-buff de corrida (id 2). */
export const SPRINT_BOOTS: AbilityDef = {
  id: 2,
  name: "Botas de Impulso",
  cooldownMs: 12000,
  castMs: 0,
  range: 0,
  coneRad: 0,
  apply(caster, _targets, now, ctx) {
    const p = caster as PlayerState & { speedBoostUntil?: number };
    p.speedBoostUntil = now + SPRINT_BOOTS_DURATION_MS;
    ctx.didCast = true;
  },
};

/** Capa de Recuo — cargas. */
export const DASH_MAX_CHARGES = 2;
export const DASH_RECHARGE_MS = 8000;
export const DASH_IMPULSE = 4200;
export const DASH_WINDOW_MS = 220;
/** Intervalo mínimo entre auto-fugas (não gasta as 2 cargas num spray). */
export const DASH_AUTO_COOLDOWN_MS = 700;
/** Deslocamento imediato no auto-dodge (s) — sai da trajetória da bala no mesmo tick. */
export const DASH_BURST_DT = 0.075;
/** Bala considerada ameaça se TTC / miss nestes limites. */
export const DASH_AUTO_BULLET_RANGE = 300;
export const DASH_AUTO_BULLET_TTC = 0.34;
export const DASH_AUTO_BULLET_MISS = 56;
/** Gigante / chefe (brutamontes) perto demais. */
export const DASH_AUTO_GIANT_RANGE = 168;
export const DASH_AUTO_BOSS_RANGE = 138;

export type DashPlayer = PlayerState & {
  dashCharges?: number;
  dashRechargeAt?: number;
  dashUntil?: number;
  /** serverTime em que o auto-dodge pode de novo (não vai no wire) */
  dashAutoReadyAt?: number;
  vx: number;
  vy: number;
  ability?: number;
  alive?: boolean;
  id?: number;
};

export type CapeThreatBullet = {
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type CapeThreatEnemy = {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  type: number;
  state: number;
  /** se souber: alvo atual do Gigante/chefe */
  targetId?: number;
};

/** Recarrega cargas da Capa de Recuo (host + predição). */
export function tickDashCharges(p: DashPlayer, now: number): void {
  if (p.dashCharges == null) p.dashCharges = DASH_MAX_CHARGES;
  if (p.dashRechargeAt == null) p.dashRechargeAt = 0;
  if (p.dashUntil == null) p.dashUntil = 0;
  while (
    (p.dashCharges ?? 0) < DASH_MAX_CHARGES &&
    (p.dashRechargeAt ?? 0) > 0 &&
    now >= (p.dashRechargeAt ?? 0)
  ) {
    p.dashCharges = (p.dashCharges ?? 0) + 1;
    if ((p.dashCharges ?? 0) < DASH_MAX_CHARGES) {
      p.dashRechargeAt = now + DASH_RECHARGE_MS;
    } else {
      p.dashRechargeAt = 0;
    }
  }
}

/**
 * Executa o arremesso da capa na direção (dirX, dirY).
 * Manual: direção da mira. Auto: longe da ameaça.
 */
export function performRecoilDash(
  p: DashPlayer,
  now: number,
  dirX: number,
  dirY: number,
): boolean {
  tickDashCharges(p, now);
  if ((p.dashCharges ?? 0) <= 0) return false;
  let len = Math.hypot(dirX, dirY);
  if (len < 1e-4) {
    dirX = -Math.cos(p.angle);
    dirY = -Math.sin(p.angle);
    len = 1;
  } else {
    dirX /= len;
    dirY /= len;
  }
  p.vx = dirX * DASH_IMPULSE;
  p.vy = dirY * DASH_IMPULSE;
  p.dashUntil = now + DASH_WINDOW_MS;
  p.dashCharges = (p.dashCharges ?? 0) - 1;
  if (p.dashCharges === DASH_MAX_CHARGES - 1) {
    p.dashRechargeAt = now + DASH_RECHARGE_MS;
  } else if ((p.dashRechargeAt ?? 0) <= 0) {
    p.dashRechargeAt = now + DASH_RECHARGE_MS;
  }
  return true;
}

/**
 * Sentido estilo Cloak of Levitation: detecta bala a caminho,
 * Gigante ou chefe fechando — devolve direção de FUGA (longe da ameaça).
 */
export function senseCapeEscapeDir(
  px: number,
  py: number,
  playerId: number,
  bullets: readonly CapeThreatBullet[],
  enemies: readonly CapeThreatEnemy[],
): { x: number; y: number; score: number } | null {
  let best: { x: number; y: number; score: number } | null = null;

  const consider = (ex: number, ey: number, score: number) => {
    const len = Math.hypot(ex, ey);
    if (len < 1e-4) return;
    const nx = ex / len;
    const ny = ey / len;
    if (!best || score > best.score) best = { x: nx, y: ny, score };
  };

  for (const b of bullets) {
    if (b.owner === playerId) continue;
    const dx = px - b.x;
    const dy = py - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist > DASH_AUTO_BULLET_RANGE || dist < 2) continue;
    const sp2 = b.vx * b.vx + b.vy * b.vy;
    if (sp2 < 100) continue;
    // (dx,dy) = player - bullet; TTC do ponto mais perto na trajetória
    const closing = b.vx * dx + b.vy * dy; // >0 = bala indo na nossa direção
    if (closing <= 0) continue;
    const tClose = Math.max(0, Math.min(DASH_AUTO_BULLET_TTC, closing / sp2));
    const cx = b.x + b.vx * tClose;
    const cy = b.y + b.vy * tClose;
    const miss = Math.hypot(px - cx, py - cy);
    if (miss > DASH_AUTO_BULLET_MISS) continue;
    // fuga: sair da linha de tiro (longe do ponto de impacto previsto)
    let ex = px - cx;
    let ey = py - cy;
    if (Math.hypot(ex, ey) < 6) {
      // head-on: desvia perpendicular à velocidade
      const sp = Math.sqrt(sp2);
      ex = -b.vy / sp;
      ey = b.vx / sp;
    }
    const urgency =
      (1.2 - tClose / DASH_AUTO_BULLET_TTC) * (1.1 - miss / DASH_AUTO_BULLET_MISS);
    consider(ex, ey, 2.5 + urgency * 3);
  }

  for (const en of enemies) {
    if (en.state === 3) continue;
    if (en.type !== 1 && en.type !== 2) continue;
    const dx = px - en.x;
    const dy = py - en.y;
    const dist = Math.hypot(dx, dy);
    const range = en.type === 2 ? DASH_AUTO_GIANT_RANGE : DASH_AUTO_BOSS_RANGE;
    if (dist > range || dist < 1) continue;
    const evx = en.vx ?? 0;
    const evy = en.vy ?? 0;
    const toward = evx * dx + evy * dy; // vel · (player - en): >0 aproximando
    const hunting = en.targetId == null || en.targetId === playerId;
    const veryClose = dist < range * 0.55;
    const charging = toward > 80 || Math.hypot(evx, evy) > 180;
    if (!hunting && !veryClose) continue;
    if (!veryClose && !charging && dist > range * 0.75) continue;
    const score =
      (en.type === 2 ? 4.2 : 3.6) +
      (veryClose ? 2 : 0) +
      (charging ? 1.4 : 0) +
      (1 - dist / range);
    consider(dx, dy, score);
  }

  return best;
}

/**
 * Auto-ativação (Cloak of Levitation): se equipada e há ameaça iminente, gasta 1 carga.
 * Retorna true se dashou.
 */
export function tryAutoRecoilCape(
  p: DashPlayer,
  now: number,
  bullets: readonly CapeThreatBullet[],
  enemies: readonly CapeThreatEnemy[],
): boolean {
  if (!p.alive) return false;
  if ((p.ability ?? 0) !== 3) return false;
  if ((p.dashAutoReadyAt ?? 0) > now) return false;
  if ((p.dashUntil ?? 0) > now) return false;
  tickDashCharges(p, now);
  if ((p.dashCharges ?? 0) <= 0) return false;
  const escape = senseCapeEscapeDir(p.x, p.y, p.id, bullets, enemies);
  if (!escape) return false;
  if (!performRecoilDash(p, now, escape.x, escape.y)) return false;
  p.dashAutoReadyAt = now + DASH_AUTO_COOLDOWN_MS;
  return true;
}

/** Capa de Recuo — dash com 2 cargas (id 3). CD via cargas, não abilityCdUntil. */
export const RECOIL_CAPE: AbilityDef = {
  id: 3,
  name: "Capa de Recuo",
  cooldownMs: 0,
  castMs: 0,
  range: 0,
  coneRad: 0,
  apply(caster, _targets, now, ctx) {
    const p = caster as DashPlayer;
    // Manual (Q): arremessa NA direção da mira (você aponta pra onde quer ir)
    const ok = performRecoilDash(
      p,
      now,
      Math.cos(caster.angle),
      Math.sin(caster.angle),
    );
    if (ok) ctx.didCast = true;
  },
};

/** Duração da Capa-Escudo (ms). */
export const SHIELD_MS = 3000;
/** Cobertura frontal (~108° meia-abertura). */
export const SHIELD_HALF_ARC = Math.PI * 0.6;
/** Lentidão com escudo aberto. */
export const SHIELD_SPEED_MUL = 0.6;

/** Capa-Escudo — bloqueia projéteis frontais (id 4). */
export const SHIELD_CAPE: AbilityDef = {
  id: 4,
  name: "Capa-Escudo",
  cooldownMs: 14000,
  castMs: 0,
  range: 0,
  coneRad: 0,
  apply(caster, _targets, now, ctx) {
    const p = caster as PlayerState & { shieldUntil?: number };
    p.shieldUntil = now + SHIELD_MS;
    ctx.didCast = true;
  },
};

export const ABILITIES: AbilityDef[] = [
  WATER_JET,
  SUMMON_GIANT,
  SPRINT_BOOTS,
  RECOIL_CAPE,
  SHIELD_CAPE,
];

/** Ordem do ciclo T no treino. */
export const ABILITY_CYCLE_IDS = [0, 1, 2, 3, 4] as const;

/** Drops de habilidade no Survival. */
export const ABILITY_DROP_IDS = [2, 3, 4] as const;

export function abilityOf(id: number): AbilityDef {
  return ABILITIES.find((a) => a.id === id) ?? WATER_JET;
}

/** Multiplicador de velocidade com Botas ativas. */
export const SPRINT_BOOTS_SPEED_MUL = 1.8;

/**
 * Bala vem do arco frontal do jogador?
 * `fromX/fromY` = posição de onde a bala veio (ex.: px/py).
 */
export function isFrontalShieldHit(
  facing: number,
  playerX: number,
  playerY: number,
  fromX: number,
  fromY: number,
): boolean {
  const approach = Math.atan2(fromY - playerY, fromX - playerX);
  const diff = Math.atan2(
    Math.sin(approach - facing),
    Math.cos(approach - facing),
  );
  return Math.abs(diff) < SHIELD_HALF_ARC;
}

/** Ângulo menor entre a e b, em [-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function selectAbilityTargets(
  caster: PlayerState,
  others: PlayerState[],
  ab: AbilityDef,
): PlayerState[] {
  if (ab.range <= 0) return [];
  const aimX = Math.cos(caster.angle);
  const aimY = Math.sin(caster.angle);
  const minDot = Math.cos(Math.max(0.35, ab.coneRad));
  const out: PlayerState[] = [];
  for (const t of others) {
    if (!t.alive || t.id === caster.id) continue;
    const dx = t.x - caster.x;
    const dy = t.y - caster.y;
    const dist = Math.hypot(dx, dy);
    if (dist > ab.range || dist < 0.5) continue;
    const dot = (dx / dist) * aimX + (dy / dist) * aimY;
    if (dot < minDot) continue;
    out.push(t);
  }
  return out;
}
