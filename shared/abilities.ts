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
  /** cone da mira (~40° meia-abertura) */
  coneRad: 0.7,
  apply(caster, _targets, _now, ctx) {
    const cands = ctx.candidates ?? [];
    if (cands.length === 0 || !ctx.spawnGiant) return;
    const cone = Math.max(0.35, this.coneRad);
    /** cone mais apertado só pra priorizar bot — se a mira está nele, ganha do chefe */
    const playerCone = Math.min(cone, 0.55);

    // Prioridade: player na mira > Gigante rival na mira > monstro > próximos
    const best =
      bestInAimCone(caster, cands, playerCone, 0) ??
      bestInAimCone(caster, cands, cone, 2) ??
      bestInAimCone(caster, cands, cone, 1) ??
      nearestCandidate(caster, cands, 0) ??
      nearestCandidate(caster, cands, 2) ??
      nearestCandidate(caster, cands, 1) ??
      nearestCandidate(caster, cands);

    if (!best) return;
    ctx.spawnGiant(best);
    ctx.didCast = true;
  },
};

export const ABILITIES: AbilityDef[] = [WATER_JET, SUMMON_GIANT];

export function abilityOf(id: number): AbilityDef {
  return ABILITIES[id] ?? WATER_JET;
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
