/**
 * prediction.ts — movimento local + colisão do mapa + spawn visual de balas.
 */
import {
  DASH_MAX_CHARGES,
  ricochetOffTotemBody,
  SHIELD_SPEED_MUL,
  SPRINT_BOOTS_SPEED_MUL,
  resolveTotemBody,
  tickDashCharges,
  type SpikeTotemSense,
} from "../../../shared/abilities";
import { ARENA_H, ARENA_W, BULLET_R, MOVE_SPEED, PLAYER_R } from "../../../shared/constants";
import {
  MAX_STAMINA,
  SPRINT_MULT,
  STAMINA_DRAIN_PER_S,
  STAMINA_REGEN_PER_S,
  TIRED_MULT,
  TIRED_THRESHOLD,
  WEAPONS,
  fullAmmoBank,
  muzzlePoint,
  weaponOf,
  type AmmoStack,
} from "../../../shared/gear";
import { moveAndSlide } from "../../../shared/map";
import type { BulletState, PlayerInput, PlayerState } from "../../../shared/protocol";
import { applyInput, clonePlayerState, type SimLikePlayer } from "../../../shared/sim";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export class PredictionBuffer {
  inputs: PlayerInput[] = [];
  predicted: PlayerState | null = null;
  doorBits = 0;
  /** totens ativos (corpo do C sólido na predição) */
  spikeTotems: SpikeTotemSense[] = [];
  /** tempo do último snapshot (para replay de reload) */
  serverTime = 0;
  /** inventário de munição por arma (preservado na reconciliação) */
  ammoBank: AmmoStack[] = fullAmmoBank();
  /** balas locais (shotgun leque / feel) — não autoritativas */
  localBullets: BulletState[] = [];
  private nextLocalId = 900000;
  private maxKeep = 90;

  attachAmmo(p: PlayerState) {
    const sp = p as SimLikePlayer;
    sp.ammoBank = this.ammoBank;
    this.ammoBank[p.weapon] = { mag: p.mag, reserve: p.reserve };
  }

  reset(state: PlayerState) {
    this.predicted = clonePlayerState(state);
    this.ammoBank = fullAmmoBank();
    this.ammoBank[state.weapon] = { mag: state.mag, reserve: state.reserve };
    this.attachAmmo(this.predicted);
    this.inputs = [];
    this.localBullets = [];
  }

  record(input: PlayerInput) {
    this.inputs.push(input);
    if (this.inputs.length > this.maxKeep) this.inputs.shift();
  }

  applyHeld(
    dx: number,
    dy: number,
    aim: number,
    dt: number,
    sprint: boolean,
    weapon: number,
    /** serverTime estimado — boost das Botas */
    now = 0,
  ) {
    const p = this.predicted;
    if (!p || !p.alive) return;
    if (p.speedBoostUntil == null) p.speedBoostUntil = 0;
    if (p.shieldUntil == null) p.shieldUntil = 0;
    if (p.dashCharges == null) p.dashCharges = DASH_MAX_CHARGES;
    if (p.dashRechargeAt == null) p.dashRechargeAt = 0;
    if (p.dashUntil == null) p.dashUntil = 0;
    if (p.frozenUntil == null) p.frozenUntil = 0;
    if (now > 0) tickDashCharges(p, now);

    // Congelado: estátua — trava movimento local (igual applyInput no host)
    const frozen = p.frozenUntil > 0 && now > 0 && now < p.frozenUntil;
    let mx = frozen ? 0 : clamp(dx, -1, 1);
    let my = frozen ? 0 : clamp(dy, -1, 1);
    if (frozen) {
      p.vx = 0;
      p.vy = 0;
    }
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }

    const moving = mag > 0.1;
    const canSprint = !frozen && sprint && moving && p.stamina > TIRED_THRESHOLD;
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
    if (p.shieldUntil > 0 && now < p.shieldUntil) {
      speedMult *= SHIELD_SPEED_MUL;
    }

    const speed = MOVE_SPEED * speedMult;
    const moveVx = mx * speed;
    const moveVy = my * speed;
    const kb = Math.hypot(p.vx, p.vy);
    const moveScale = kb > 1500 ? 0.18 : kb > 800 ? 0.35 : kb > 300 ? 0.65 : 1;
    const totalVx = moveVx * moveScale + p.vx;
    const totalVy = moveVy * moveScale + p.vy;
    const slid = moveAndSlide(p.x, p.y, totalVx, totalVy, dt, PLAYER_R, this.doorBits);
    const solid = resolveTotemBody(slid.x, slid.y, PLAYER_R, this.spikeTotems);
    p.x = solid.x;
    p.y = solid.y;
    const damp = Math.exp(-(kb > 500 ? 1.55 : 2.8) * dt);
    if (Math.abs(totalVx) > 1 && Math.abs(slid.vx) < 1e-6) p.vx = 0;
    else p.vx *= damp;
    if (Math.abs(totalVy) > 1 && Math.abs(slid.vy) < 1e-6) p.vy = 0;
    else p.vy *= damp;
    if (Math.abs(p.vx) < 3) p.vx = 0;
    if (Math.abs(p.vy) < 3) p.vy = 0;
    p.angle = aim;
    p.weapon = clamp(weapon, 0, WEAPONS.length - 1);

    // life === 0 → sem TTL (igual host/sim): vai até parede/borda/alvo
    // life > 0 → countdown em ms (ex.: shotgun); ao expirar vira -1
    this.localBullets = this.localBullets
      .map((b) => {
        let life = b.life;
        if (life > 0) {
          life -= dt * 1000;
          if (life <= 0) life = -1;
        }
        const nx = b.x + b.vx * dt;
        const ny = b.y + b.vy * dt;
        let vx = b.vx;
        let vy = b.vy;
        let x = nx;
        let y = ny;
        let bounces = b.totemBounces ?? 0;
        // mesma colisão do host — balas locais não atravessam o C
        if (this.spikeTotems.length) {
          const bounce = ricochetOffTotemBody(b.x, b.y, nx, ny, vx, vy, this.spikeTotems, BULLET_R);
          if (bounce) {
            bounces += 1;
            if (bounces > 4) life = -1;
            x = bounce.x;
            y = bounce.y;
            vx = bounce.vx;
            vy = bounce.vy;
            if (life > 0) life = Math.max(40, life * 0.85);
          }
        }
        return {
          ...b,
          px: b.x,
          py: b.y,
          x,
          y,
          vx,
          vy,
          life,
          totemBounces: bounces,
        };
      })
      .filter(
        (b) =>
          b.life >= 0 &&
          b.x > -40 &&
          b.y > -40 &&
          b.x < ARENA_W + 40 &&
          b.y < ARENA_H + 40,
      );
  }

  /** Disparo previsto — mesma origem/spread envelope do host. */
  predictFire(angle: number, weapon: number) {
    const p = this.predicted;
    if (!p || !p.alive) return;
    const wpn = weaponOf(weapon);
    const m = muzzlePoint(p.x, p.y, angle, wpn);
    const n = wpn.pellets;
    for (let i = 0; i < n; i++) {
      let spread = (Math.random() - 0.5) * 2 * wpn.spread;
      if (n > 1) {
        spread =
          (i / (n - 1) - 0.5) * 2 * wpn.spread + (Math.random() - 0.5) * wpn.spread * 0.15;
      }
      const a = angle + spread;
      this.localBullets.push({
        id: this.nextLocalId++,
        owner: p.id,
        x: m.x,
        y: m.y,
        px: m.x,
        py: m.y,
        vx: Math.cos(a) * wpn.bulletSpeed,
        vy: Math.sin(a) * wpn.bulletSpeed,
        weapon,
        // 0 = sem TTL (AWM/rifles); NÃO usar fallback 800 — sumia no meio do mapa
        life: wpn.bulletLifeMs,
      });
    }
  }

  /** Aplica loot de arma dropada (host) no inventário local. */
  applyWeaponLoot(weaponId: number, mag: number, reserve: number) {
    const wpn = weaponOf(weaponId);
    const slot = this.ammoBank[weaponId] ?? { mag: 0, reserve: 0 };
    slot.mag = Math.min(wpn.magSize, slot.mag + mag);
    slot.reserve = Math.min(wpn.reserveMax, slot.reserve + reserve);
    this.ammoBank[weaponId] = slot;
    if (this.predicted && this.predicted.weapon === weaponId) {
      this.predicted.mag = slot.mag;
      this.predicted.reserve = slot.reserve;
    }
    if (this.predicted) this.attachAmmo(this.predicted);
  }

  replayOne(input: PlayerInput, dt: number) {
    if (!this.predicted) return;
    applyInput(this.predicted, input, dt, {
      doorBits: this.doorBits,
      serverTime: this.serverTime,
      spikeTotems: this.spikeTotems,
    });
    this.serverTime += dt * 1000;
  }

  pendingAfter(seq: number): PlayerInput[] {
    return this.inputs.filter((i) => i.seq > seq);
  }

  discardUpTo(seq: number) {
    this.inputs = this.inputs.filter((i) => i.seq > seq);
  }
}
