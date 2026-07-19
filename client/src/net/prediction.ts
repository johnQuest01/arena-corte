/**
 * prediction.ts — movimento local + colisão do mapa + spawn visual de balas.
 */
import { ARENA_H, ARENA_W, MOVE_SPEED, PLAYER_R } from "../../../shared/constants";
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
import { resolveWalls } from "../../../shared/map";
import type { BulletState, PlayerInput, PlayerState } from "../../../shared/protocol";
import { applyInput, clonePlayerState, type SimLikePlayer } from "../../../shared/sim";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export class PredictionBuffer {
  inputs: PlayerInput[] = [];
  predicted: PlayerState | null = null;
  doorBits = 0;
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
  ) {
    const p = this.predicted;
    if (!p || !p.alive) return;

    let mx = clamp(dx, -1, 1);
    let my = clamp(dy, -1, 1);
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }

    const moving = mag > 0.1;
    const canSprint = sprint && moving && p.stamina > TIRED_THRESHOLD;
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
    const pos = resolveWalls(p.x, p.y, PLAYER_R, this.doorBits);
    p.x = pos.x;
    p.y = pos.y;
    p.angle = aim;
    p.weapon = clamp(weapon, 0, WEAPONS.length - 1);

    this.localBullets = this.localBullets
      .map((b) => ({
        ...b,
        px: b.x,
        py: b.y,
        x: b.x + b.vx * dt,
        y: b.y + b.vy * dt,
        life: b.life - dt * 1000,
      }))
      .filter(
        (b) =>
          b.life > 0 &&
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
        life: wpn.bulletLifeMs || 800,
      });
    }
  }

  replayOne(input: PlayerInput, dt: number) {
    if (!this.predicted) return;
    applyInput(this.predicted, input, dt, {
      doorBits: this.doorBits,
      serverTime: this.serverTime,
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
