/**
 * abilities.ts — framework de habilidades (receita: efeito + evento + cooldown).
 */
import { PLAYER_R } from "./constants";
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
  /** Fenda Sísmica — dispara a fissura até o alvo (ou reto até o range) */
  riftStrike?: (caster: PlayerState, target: AbilityTargetRef | null) => void;
  /** Bomba Devastadora — solta bomba com fuse na posição */
  spawnBomb?: (x: number, y: number, ownerId: number) => void;
  /** Totem de Espinhos — planta na posição (já clampada) */
  spawnTotem?: (x: number, y: number, ownerId: number) => void;
  /** distância mirada do totem (px), clampada no apply */
  totemDist?: number;
  /** doorBits pra clamp de parede no plant */
  doorBits?: number;
  /** teste de sólido (map.hitsSolid) — clamp do plant */
  hitsSolid?: (x: number, y: number, r: number, doorBits: number) => boolean;
  /** candidatos já filtrados (players e/ou enemies vivos, sem o caster) */
  candidates?: AbilityTargetRef[];
  /** Escudo Bumerangue — arremessa o escudo (false = já tem um no ar) */
  spawnShieldThrow?: (caster: PlayerState) => boolean;
  /** Raio em Cadeia — resolve os saltos e o dano */
  chainLightning?: (caster: PlayerState) => void;
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

/**
 * Mais próximo dentro do cone da mira e do alcance (Fenda Sísmica).
 * "Dependendo da distância": player OU gigante OU zumbi — o que estiver mais perto na linha.
 */
export function nearestInAimCone(
  caster: PlayerState,
  cands: AbilityTargetRef[],
  coneRad: number,
  maxRange: number,
): AbilityTargetRef | null {
  const aimX = Math.cos(caster.angle);
  const aimY = Math.sin(caster.angle);
  const minDot = Math.cos(Math.max(0.12, coneRad));
  let best: AbilityTargetRef | null = null;
  let bestD = Infinity;
  for (const t of cands) {
    const dx = t.x - caster.x;
    const dy = t.y - caster.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5 || dist > maxRange) continue;
    const dot = (dx / dist) * aimX + (dy / dist) * aimY;
    if (dot < minDot) continue;
    if (dist < bestD) {
      bestD = dist;
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
  name: "Escudo Estelar",
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

/** Causa de morte no killfeed (death.weaponId). */
export const RIFT_CAUSE_CODE = 102;
/** Velocidade visual/autoritativa da fissura (px/s). */
export const RIFT_TRAVEL_SPEED = 1350;
/** Raio em que o alvo travado ainda é engolido ao chegar. */
export const RIFT_ESCAPE_RADIUS = 78;
/** Raio do buraco aberto (quem pisar cai — bots/players). */
export const RIFT_HOLE_RADIUS = 58;
/** Quanto tempo o buraco engole quem passa (ms), alinhado ao visual. */
export const RIFT_HOLE_HAZARD_MS = 6500;

/** Buraco ativo (para IA desviar). */
export type RiftHoleSense = {
  x: number;
  y: number;
  r: number;
  activeAt: number;
  openUntil: number;
};

export function activeRiftHoles(
  holes: readonly RiftHoleSense[] | undefined,
  now: number,
): RiftHoleSense[] {
  if (!holes?.length) return [];
  return holes.filter((h) => now >= h.activeAt && now <= h.openUntil);
}

/** Ponto está dentro (ou na margem) de algum buraco aberto? */
export function pointInActiveRiftHole(
  x: number,
  y: number,
  holes: readonly RiftHoleSense[] | undefined,
  now: number,
  margin = 18,
): boolean {
  for (const h of activeRiftHoles(holes, now)) {
    if (Math.hypot(x - h.x, y - h.y) <= h.r + margin) return true;
  }
  return false;
}

/**
 * IA: empurra a direção de movimento para longe dos buracos abertos.
 * Bots/Gigantes/zumbis “sabem” que o buraco é perigo.
 */
export function avoidRiftHolesDir(
  x: number,
  y: number,
  dx: number,
  dy: number,
  holes: readonly RiftHoleSense[] | undefined,
  now: number,
  margin = 36,
): { dx: number; dy: number } {
  const active = activeRiftHoles(holes, now);
  if (!active.length) return { dx, dy };
  let ax = dx;
  let ay = dy;
  for (const h of active) {
    const danger = h.r + margin;
    const ox = x - h.x;
    const oy = y - h.y;
    const d = Math.hypot(ox, oy) || 0.01;
    const ux = ox / d;
    const uy = oy / d;
    if (d < danger) {
      // dentro/perto: foge com força
      const push = 1.4 + ((danger - d) / danger) * 3.2;
      ax += ux * push;
      ay += uy * push;
    } else if (d < danger * 2.2) {
      // no anel externo: só desvia se estiver indo na direção do buraco
      const toHx = h.x - x;
      const toHy = h.y - y;
      const td = Math.hypot(toHx, toHy) || 1;
      const mag = Math.hypot(dx, dy) || 1;
      const closing = (dx / mag) * (toHx / td) + (dy / mag) * (toHy / td);
      if (closing > 0.12) {
        const soft = (1 - (d - danger) / (danger * 1.2)) * 1.6;
        ax += ux * soft;
        ay += uy * soft;
      }
    }
  }
  const m = Math.hypot(ax, ay);
  if (m < 0.05) return { dx, dy };
  return { dx: ax / m, dy: ay / m };
}

/** Fenda Sísmica — rachadura + buraco (id 5). */
export const SEISMIC_RIFT: AbilityDef = {
  id: 5,
  name: "Fenda Sísmica",
  cooldownMs: 22000,
  castMs: 250,
  range: 700,
  coneRad: 0.4,
  apply(caster, _targets, _now, ctx) {
    const cands = ctx.candidates ?? [];
    const target = nearestInAimCone(caster, cands, this.coneRad, this.range);
    // sem alvo: fissura ainda corre reto até o range (só visual)
    ctx.riftStrike?.(caster, target);
    ctx.didCast = true;
  },
};

/** Kind do throwable da Bomba Devastadora (THROWS[5]). */
export const BOMB_THROW_KIND = 5;
/** Fuse até detonar (ms). */
export const BOMB_FUSE_MS = 1200;
/** Raio da explosão massiva (px mundo). */
export const BOMB_RADIUS = 260;
/** Causa no killfeed/gore (despedaça como explosão). */
export const BOMB_CAUSE_CODE = 103;

/** Bomba Devastadora — explosão gigante com fuse (id 6). */
export const DEVASTATOR_BOMB: AbilityDef = {
  id: 6,
  name: "Bomba Devastadora",
  cooldownMs: 30000,
  castMs: 0,
  range: 0,
  coneRad: 0,
  apply(caster, _targets, _now, ctx) {
    // solta à frente dos pés (não no peito) — fuse curto, sem arremesso
    const ox = caster.x + Math.cos(caster.angle) * 20;
    const oy = caster.y + Math.sin(caster.angle) * 20;
    ctx.spawnBomb?.(ox, oy, caster.id);
    ctx.didCast = true;
  },
};

/** Totem de Espinhos — duração (ms). */
export const TOTEM_MS = 10000;
/** Raio de dano por contato (área grande de espinhos no chão). */
export const TOTEM_RADIUS = 200;
/** Alcance máximo de plantio. */
export const TOTEM_RANGE = 340;
/** Distância mínima de plantio. */
export const TOTEM_MIN_DIST = 70;
/** Dano por segundo em zumbis/players (passar por cima dói forte). */
export const TOTEM_TICK_DPS = 72;
/** Causa killfeed. */
export const TOTEM_CAUSE_CODE = 104;
/**
 * Margem EXTRA de evitação da IA (além do raio de dano).
 */
export const TOTEM_AVOID_MARGIN = 56;
/** Raio em que o dono fica protegido (bolso do C). */
export const TOTEM_PROTECT_R = 82;
/** Meia-abertura do C (rad) — abertura ~190°, arco ~170° (C bem aberto). */
export const TOTEM_C_HALF_OPEN = 1.66;
/** Raio interno do corpo sólido do C (hitbox = visual). */
export const TOTEM_BODY_INNER_R = 44;
/** Raio externo do corpo sólido do C. */
export const TOTEM_BODY_OUTER_R = 74;
/** Remates laterais (pontas do C) — colisão um pouco maior que o visual. */
export const TOTEM_TIP_R = 14;
/** Abertura efetiva na colisão (bem mais fechada que o visual nas pontas). */
const TOTEM_OPEN_COLLIDE = TOTEM_C_HALF_OPEN - 0.55;
/** Hitbox do anel um pouco mais grossa que o desenho (anti-túnel de bala). */
const TOTEM_HIT_INNER = TOTEM_BODY_INNER_R - 4;
const TOTEM_HIT_OUTER = TOTEM_BODY_OUTER_R + 8;

/** Totem ativo (nav / senso). */
export type SpikeTotemSense = {
  x: number;
  y: number;
  r: number;
  ownerId: number;
  /** ângulo da abertura do C (aponta pro dono) */
  angle?: number;
};

/** Delta angular normalizado (−π..π) do ponto em relação à abertura do C. */
function totemAngleDelta(
  x: number,
  y: number,
  tx: number,
  ty: number,
  openAng: number,
): number {
  const toPt = Math.atan2(y - ty, x - tx);
  let delta = toPt - openAng;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * Zona de espinhos = costas do C (fora da abertura).
 * Abertura aponta para `angle` (totem → dono).
 */
export function inTotemSpikeField(
  x: number,
  y: number,
  t: { x: number; y: number; r: number; angle?: number },
): boolean {
  const d = Math.hypot(x - t.x, y - t.y);
  if (d > t.r || d < 8) return false;
  const delta = totemAngleDelta(x, y, t.x, t.y, t.angle ?? 0);
  // abertura = sem espinhos; costas = dano
  return Math.abs(delta) > TOTEM_C_HALF_OPEN;
}

/** Centros dos remates laterais do C. */
function totemTipCenters(t: { x: number; y: number; angle?: number }): { x: number; y: number }[] {
  const a = t.angle ?? 0;
  const mid = (TOTEM_HIT_INNER + TOTEM_HIT_OUTER) * 0.5;
  return [
    { x: t.x + Math.cos(a + TOTEM_C_HALF_OPEN) * mid, y: t.y + Math.sin(a + TOTEM_C_HALF_OPEN) * mid },
    { x: t.x + Math.cos(a - TOTEM_C_HALF_OPEN) * mid, y: t.y + Math.sin(a - TOTEM_C_HALF_OPEN) * mid },
  ];
}

function hitsTotemTip(
  x: number,
  y: number,
  r: number,
  t: { x: number; y: number; angle?: number },
): boolean {
  for (const tip of totemTipCenters(t)) {
    if (Math.hypot(x - tip.x, y - tip.y) <= TOTEM_TIP_R + r) return true;
  }
  return false;
}

/** Ponto/círculo intersecta o corpo sólido do C (arco + pontas laterais)? */
export function hitsTotemBody(
  x: number,
  y: number,
  r: number,
  totems: readonly SpikeTotemSense[] | undefined,
  /** reservado (balas NÃO ignoram o próprio escudo) */
  ignoreOwnerId?: number,
): boolean {
  if (!totems?.length) return false;
  const openSoft = TOTEM_OPEN_COLLIDE;
  for (const t of totems) {
    if (ignoreOwnerId != null && t.ownerId === ignoreOwnerId) continue;
    if (hitsTotemTip(x, y, r, t)) return true;
    const d = Math.hypot(x - t.x, y - t.y);
    const delta = totemAngleDelta(x, y, t.x, t.y, t.angle ?? 0);
    if (Math.abs(delta) <= openSoft) continue;
    if (d + r >= TOTEM_HIT_INNER && d - r <= TOTEM_HIT_OUTER) return true;
  }
  return false;
}

/**
 * Empurra círculo pra fora do corpo do C (ninguém atravessa — nem o dono).
 * Abertura permanece livre (exceto as pontas laterais).
 */
export function resolveTotemBody(
  x: number,
  y: number,
  r: number,
  totems: readonly SpikeTotemSense[] | undefined,
): { x: number; y: number } {
  if (!totems?.length) return { x, y };
  const openSoft = TOTEM_OPEN_COLLIDE;
  let px = x;
  let py = y;
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (const t of totems) {
      for (const tip of totemTipCenters(t)) {
        const dx = px - tip.x;
        const dy = py - tip.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const min = TOTEM_TIP_R + r;
        if (d < min) {
          const s = (min + 0.5) / d;
          px = tip.x + dx * s;
          py = tip.y + dy * s;
          moved = true;
        }
      }
      const dx = px - t.x;
      const dy = py - t.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const delta = totemAngleDelta(px, py, t.x, t.y, t.angle ?? 0);
      if (Math.abs(delta) <= openSoft) continue;
      const inner = TOTEM_HIT_INNER - r;
      const outer = TOTEM_HIT_OUTER + r;
      if (d > inner && d < outer) {
        const mid = (TOTEM_HIT_INNER + TOTEM_HIT_OUTER) * 0.5;
        const target = d < mid ? Math.max(0.5, inner - 0.5) : outer + 0.5;
        const s = target / d;
        px = t.x + dx * s;
        py = t.y + dy * s;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: px, y: py };
}

/** Segmento cruza o corpo do C? Retorna ponto de impacto. */
export function segmentHitsTotemBody(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  totems: readonly SpikeTotemSense[] | undefined,
  probeR = 2,
  ignoreOwnerId?: number,
): { x: number; y: number } | null {
  if (!totems?.length) return null;
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 0.5) {
    return hitsTotemBody(x0, y0, probeR, totems, ignoreOwnerId) ? { x: x0, y: y0 } : null;
  }
  // passo bem fino — balas rápidas (AWM ~900) atravessavam com step grosso
  const step = 1.5;
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const x = x0 + (x1 - x0) * u;
    const y = y0 + (y1 - y0) * u;
    if (hitsTotemBody(x, y, probeR, totems, ignoreOwnerId)) return { x, y };
  }
  return null;
}

/**
 * Ricochete no corpo do C (dentro ou fora + pontas).
 * Sempre devolve reflexão se houver impacto (nunca “fura” por falha de normal).
 */
export function ricochetOffTotemBody(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  vx: number,
  vy: number,
  totems: readonly SpikeTotemSense[] | undefined,
  probeR = 2,
): { x: number; y: number; vx: number; vy: number } | null {
  if (!totems?.length) return null;
  const hit =
    segmentHitsTotemBody(x0, y0, x1, y1, totems, probeR) ??
    (hitsTotemBody(x1, y1, probeR, totems) ? { x: x1, y: y1 } : null);
  if (!hit) return null;
  return ricochetAtPoint(hit.x, hit.y, vx, vy, totems, probeR);
}

function ricochetAtPoint(
  hx: number,
  hy: number,
  vx: number,
  vy: number,
  totems: readonly SpikeTotemSense[],
  probeR: number,
): { x: number; y: number; vx: number; vy: number } {
  const openSoft = TOTEM_OPEN_COLLIDE;
  let nx = 0;
  let ny = 1;

  // 1) remate lateral mais próximo
  let bestTipD = Infinity;
  for (const t of totems) {
    for (const tip of totemTipCenters(t)) {
      const dx = hx - tip.x;
      const dy = hy - tip.y;
      const d = Math.hypot(dx, dy) || 0.001;
      if (d < bestTipD && d <= TOTEM_TIP_R + probeR + 6) {
        bestTipD = d;
        nx = dx / d;
        ny = dy / d;
      }
    }
  }

  // 2) senão normal do anel (radial)
  if (bestTipD === Infinity) {
    let best: SpikeTotemSense | null = null;
    let bestPen = Infinity;
    for (const t of totems) {
      const d = Math.hypot(hx - t.x, hy - t.y) || 0.001;
      const mid = (TOTEM_HIT_INNER + TOTEM_HIT_OUTER) * 0.5;
      const pen = Math.abs(d - mid);
      const delta = totemAngleDelta(hx, hy, t.x, t.y, t.angle ?? 0);
      // aceita mesmo na borda da abertura — impacto já foi confirmado
      if (pen < bestPen && (Math.abs(delta) > openSoft * 0.5 || pen < 20)) {
        bestPen = pen;
        best = t;
      }
    }
    if (best) {
      const dx = hx - best.x;
      const dy = hy - best.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const ux = dx / d;
      const uy = dy / d;
      const mid = (TOTEM_HIT_INNER + TOTEM_HIT_OUTER) * 0.5;
      nx = d >= mid ? ux : -ux;
      ny = d >= mid ? uy : -uy;
    } else {
      // fallback: afasta do totem mais próximo
      let nearest = totems[0]!;
      let nd = Infinity;
      for (const t of totems) {
        const d = Math.hypot(hx - t.x, hy - t.y);
        if (d < nd) {
          nd = d;
          nearest = t;
        }
      }
      const dx = hx - nearest.x;
      const dy = hy - nearest.y;
      const d = Math.hypot(dx, dy) || 0.001;
      nx = dx / d;
      ny = dy / d;
    }
  }

  const vin = vx * nx + vy * ny;
  let rvx = vx;
  let rvy = vy;
  if (vin < 0) {
    rvx = vx - 2 * vin * nx;
    rvy = vy - 2 * vin * ny;
  } else {
    // já saindo — ainda empurra pra fora e inverte se rasante
    rvx = vx - 1.4 * vin * nx;
    rvy = vy - 1.4 * vin * ny;
  }
  rvx *= 0.9;
  rvy *= 0.9;
  const push = probeR + 3.5;
  return {
    x: hx + nx * push,
    y: hy + ny * push,
    vx: rvx,
    vy: rvy,
  };
}

/**
 * Dono está no bolso do C e protegido?
 * Abertura do C aponta para `angle` (direção totem → dono no plantio).
 */
export function ownerProtectedByTotem(
  ownerX: number,
  ownerY: number,
  ownerId: number,
  totems: readonly SpikeTotemSense[] | undefined,
): boolean {
  if (!totems?.length) return false;
  for (const t of totems) {
    if (t.ownerId !== ownerId) continue;
    const dx = ownerX - t.x;
    const dy = ownerY - t.y;
    const d = Math.hypot(dx, dy);
    if (d > TOTEM_PROTECT_R) continue;
    const delta = totemAngleDelta(ownerX, ownerY, t.x, t.y, t.angle ?? 0);
    if (Math.abs(delta) <= TOTEM_C_HALF_OPEN + 0.2) return true;
    // muito perto do centro: ainda protege
    if (d < 34) return true;
  }
  return false;
}

/** Ponto dentro da aura de EVITAR (maior que dano)? */
export function blockedByTotem(
  x: number,
  y: number,
  totems: readonly SpikeTotemSense[] | undefined,
  margin = TOTEM_AVOID_MARGIN,
): boolean {
  if (!totems?.length) return false;
  for (const t of totems) {
    if (Math.hypot(x - t.x, y - t.y) <= t.r + margin) return true;
  }
  return false;
}

/** Empurra direção pra longe dos totens (como avoidRiftHolesDir). */
export function avoidSpikeTotemsDir(
  x: number,
  y: number,
  dx: number,
  dy: number,
  totems: readonly SpikeTotemSense[] | undefined,
  margin = TOTEM_AVOID_MARGIN,
): { dx: number; dy: number } {
  if (!totems?.length) return { dx, dy };
  let ax = dx;
  let ay = dy;
  for (const t of totems) {
    const danger = t.r + margin;
    const ox = x - t.x;
    const oy = y - t.y;
    const d = Math.hypot(ox, oy) || 0.01;
    const ux = ox / d;
    const uy = oy / d;
    if (d < danger) {
      const push = 1.5 + ((danger - d) / danger) * 3.5;
      ax += ux * push;
      ay += uy * push;
    } else if (d < danger * 2.4) {
      const toTx = t.x - x;
      const toTy = t.y - y;
      const td = Math.hypot(toTx, toTy) || 1;
      const mag = Math.hypot(dx, dy) || 1;
      const closing = (dx / mag) * (toTx / td) + (dy / mag) * (toTy / td);
      if (closing > 0.1) {
        const soft = (1 - (d - danger) / (danger * 1.4)) * 1.8;
        ax += ux * soft;
        ay += uy * soft;
      }
    }
  }
  const m = Math.hypot(ax, ay);
  if (m < 0.05) return { dx, dy };
  return { dx: ax / m, dy: ay / m };
}

/** Recua ao longo do raio até achar chão livre (não planta em sólido). */
export function clampTotemPlant(
  ox: number,
  oy: number,
  tx: number,
  ty: number,
  doorBits: number,
  hitsSolidFn: (x: number, y: number, r: number, doorBits: number) => boolean,
): { x: number; y: number } {
  const dist = Math.hypot(tx - ox, ty - oy);
  if (dist < 1) return { x: ox, y: oy };
  const steps = Math.max(4, Math.ceil(dist / 6));
  let lx = ox;
  let ly = oy;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const x = ox + (tx - ox) * u;
    const y = oy + (ty - oy) * u;
    if (hitsSolidFn(x, y, 14, doorBits)) break;
    lx = x;
    ly = y;
  }
  // se ainda sólido (ex.: spawn), fica no caster
  if (hitsSolidFn(lx, ly, 14, doorBits)) return { x: ox, y: oy };
  return { x: lx, y: ly };
}

/** Quantiza dist 0..TOTEM_RANGE → byte 0..255 (wire no throw). */
export function encodeTotemDist(dist: number): number {
  const d = Math.max(0, Math.min(TOTEM_RANGE, dist));
  return Math.max(0, Math.min(255, Math.round((d / TOTEM_RANGE) * 255)));
}

export function decodeTotemDist(byte: number): number {
  return ((byte & 0xff) / 255) * TOTEM_RANGE;
}

/** Escudo de Espinhos — C protetor + campo de espinhos (id 7). */
export const SPIKE_TOTEM: AbilityDef = {
  id: 7,
  name: "Escudo de Espinhos",
  cooldownMs: 18000,
  castMs: 0,
  range: TOTEM_RANGE,
  coneRad: 0,
  apply(caster, _targets, _now, ctx) {
    const dx = Math.cos(caster.angle);
    const dy = Math.sin(caster.angle);
    const dist = Math.max(
      TOTEM_MIN_DIST,
      Math.min(ctx.totemDist ?? TOTEM_RANGE, TOTEM_RANGE),
    );
    let tx = caster.x + dx * dist;
    let ty = caster.y + dy * dist;
    if (ctx.doorBits != null && ctx.hitsSolid) {
      const p = clampTotemPlant(caster.x, caster.y, tx, ty, ctx.doorBits, ctx.hitsSolid);
      tx = p.x;
      ty = p.y;
    }
    ctx.spawnTotem?.(tx, ty, caster.id);
    ctx.didCast = true;
  },
};

/** Duração do congelamento (ms). */
export const FROST_MS = 5000;

/** Congelamento — bloco de gelo total (id 8). */
export const FROST_NOVA: AbilityDef = {
  id: 8,
  name: "Congelamento",
  cooldownMs: 14000,
  castMs: 0,
  range: 360,
  /** cone largo à frente (~138°) */
  coneRad: 1.2,
  apply(caster, targets, now, ctx) {
    for (const t of targets) {
      const ft = t as PlayerState & { frozenUntil?: number };
      ft.frozenUntil = Math.max(ft.frozenUntil ?? 0, now + FROST_MS);
      ft.vx = 0;
      ft.vy = 0;
    }
    ctx.didCast = true;
    void caster;
  },
};

/* ------------------------------------------------------------------ */
/* Poderes novos                                                        */
/* ------------------------------------------------------------------ */

/** Escudo Bumerangue: kind no wire de throwables (snapshot). */
export const SHIELD_THROW_KIND = 7;
export const SHIELD_THROW_SPEED = 820;
/** Ida (ms) antes de voltar pro dono. */
export const SHIELD_THROW_OUT_MS = 820;
/** Some se não conseguir voltar. */
export const SHIELD_THROW_MAX_MS = 3200;
export const SHIELD_THROW_BOUNCES = 3;
/** Raio do disco (acerto em alvos / visual). */
export const SHIELD_THROW_R = 17;
/**
 * Raio do disco contra paredes: menor que o do jogador (PLAYER_R), senão o
 * disco nasce dentro da parede quando o dono está encostado nela e não passa
 * em portas de 1 tile.
 */
export const SHIELD_THROW_WALL_R = 10;
export const SHIELD_THROW_DMG = 34;
export const SHIELD_THROW_ENEMY_DMG = 60;
/** Empurrão no alvo. */
export const SHIELD_THROW_KNOCK = 950;
/** Causa killfeed. */
export const SHIELD_THROW_CAUSE = 105;

/** Escudo Bumerangue — arremessa o Escudo Estelar; ricocheteia e volta (id 9). */
export const SHIELD_BOOMERANG: AbilityDef = {
  id: 9,
  name: "Escudo Bumerangue",
  cooldownMs: 6500,
  castMs: 0,
  range: 0,
  coneRad: 0,
  apply(caster, _targets, _now, ctx) {
    if (ctx.spawnShieldThrow?.(caster)) ctx.didCast = true;
  },
};

export const CHAIN_RANGE = 440;
export const CHAIN_HOP = 240;
export const CHAIN_MAX = 4;
export const CHAIN_DMG = [30, 24, 18, 14] as const;
export const CHAIN_STUN_MS = 650;
export const CHAIN_CAUSE = 106;
/** weaponId dos eventos de segmento do raio (3000 + salto). */
export const CHAIN_SEGMENT_BASE = 3000;

/** Raio em Cadeia — acerta o alvo na mira e salta pra até 3 vizinhos (id 10). */
export const CHAIN_LIGHTNING: AbilityDef = {
  id: 10,
  name: "Raio em Cadeia",
  cooldownMs: 11000,
  castMs: 0,
  range: CHAIN_RANGE,
  coneRad: 0.55,
  apply(caster, _targets, _now, ctx) {
    ctx.chainLightning?.(caster);
    ctx.didCast = true;
  },
};

export const BLINK_RANGE = 270;
export const BLINK_CD_MS = 7000;
/** Menor salto que conta (evita gastar CD encostado na parede). */
export const BLINK_MIN = 26;

type SolidFn = (x: number, y: number, r: number, doorBits: number) => boolean;

/**
 * Sonda do teleporte: meio px menor que o jogador — quem desliza encostado
 * na parede fica a exatamente PLAYER_R dela e não pode contar como colisão.
 */
const BLINK_PROBE_R = PLAYER_R - 0.5;
const BLINK_STEP = 6;

/**
 * Destino do Passo Sombrio: anda na mira em passos curtos; se bater em
 * parede/totem, desliza no eixo livre (como o movimento). Nunca atravessa.
 */
export function blinkDestination(
  x: number,
  y: number,
  aim: number,
  doorBits: number,
  hitsSolidFn: SolidFn,
  totems?: readonly SpikeTotemSense[],
): { x: number; y: number } {
  const sx = Math.cos(aim) * BLINK_STEP;
  const sy = Math.sin(aim) * BLINK_STEP;
  const blocked = (px: number, py: number) =>
    hitsSolidFn(px, py, BLINK_PROBE_R, doorBits) ||
    (!!totems?.length && hitsTotemBody(px, py, BLINK_PROBE_R, totems));
  // quina (os dois eixos livres): anda no eixo dominante da mira
  const xFirst = Math.abs(sx) >= Math.abs(sy);
  let bx = x;
  let by = y;
  for (let d = BLINK_STEP; d <= BLINK_RANGE; d += BLINK_STEP) {
    if (!blocked(bx + sx, by + sy)) {
      bx += sx;
      by += sy;
      continue;
    }
    const canX = Math.abs(sx) > 0.5 && !blocked(bx + sx, by);
    const canY = Math.abs(sy) > 0.5 && !blocked(bx, by + sy);
    if (canX && (xFirst || !canY)) bx += sx;
    else if (canY) by += sy;
    else break;
  }
  return { x: bx, y: by };
}

/**
 * Passo Sombrio (host + predição + replay): teleporta na mira.
 * Retorna origem/destino ou null (CD / sem espaço).
 */
export function performBlink(
  p: PlayerState,
  now: number,
  aim: number,
  doorBits: number,
  hitsSolidFn: SolidFn,
  totems?: readonly SpikeTotemSense[],
): { fromX: number; fromY: number; x: number; y: number } | null {
  if ((p.abilityCdUntil ?? 0) > now) return null;
  const dest = blinkDestination(p.x, p.y, aim, doorBits, hitsSolidFn, totems);
  if (Math.hypot(dest.x - p.x, dest.y - p.y) < BLINK_MIN) return null;
  const fromX = p.x;
  const fromY = p.y;
  p.x = dest.x;
  p.y = dest.y;
  p.vx *= 0.25;
  p.vy *= 0.25;
  p.abilityCdUntil = now + BLINK_CD_MS;
  return { fromX, fromY, x: dest.x, y: dest.y };
}

/** Passo Sombrio — teleporte curto na mira (id 11). Resolvido no sim. */
export const SHADOW_STEP: AbilityDef = {
  id: 11,
  name: "Passo Sombrio",
  cooldownMs: BLINK_CD_MS,
  castMs: 0,
  range: BLINK_RANGE,
  coneRad: 0,
  apply(_caster, _targets, _now, ctx) {
    ctx.didCast = true;
  },
};

export const ABILITIES: AbilityDef[] = [
  WATER_JET,
  SUMMON_GIANT,
  SPRINT_BOOTS,
  RECOIL_CAPE,
  SHIELD_CAPE,
  SEISMIC_RIFT,
  DEVASTATOR_BOMB,
  SPIKE_TOTEM,
  FROST_NOVA,
  SHIELD_BOOMERANG,
  CHAIN_LIGHTNING,
  SHADOW_STEP,
];

/** Ordem do ciclo T no treino. */
export const ABILITY_CYCLE_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/** Drops de habilidade no Survival (6 = bomba rara; 7 = totem; 8 = gelo; 9–11 novos). */
export const ABILITY_DROP_IDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

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
