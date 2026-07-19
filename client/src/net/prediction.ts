/**
 * prediction.ts — movimento local contínuo + stamina/sprint.
 */
import {
  ARENA_H,
  ARENA_W,
  MOVE_SPEED,
  OBSTACLES,
  PLAYER_R,
} from "../../../shared/constants";
import {
  MAX_STAMINA,
  SPRINT_MULT,
  STAMINA_DRAIN_PER_S,
  STAMINA_REGEN_PER_S,
  TIRED_MULT,
  TIRED_THRESHOLD,
} from "../../../shared/gear";
import type { PlayerInput, PlayerState } from "../../../shared/protocol";
import { applyInput, clonePlayerState } from "../../../shared/sim";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function resolveWalls(x: number, y: number, r: number): { x: number; y: number } {
  let px = clamp(x, r, ARENA_W - r);
  let py = clamp(y, r, ARENA_H - r);
  for (const o of OBSTACLES) {
    const nx = clamp(px, o.x, o.x + o.w);
    const ny = clamp(py, o.y, o.y + o.h);
    const dx = px - nx;
    const dy = py - ny;
    if (dx * dx + dy * dy >= r * r) continue;
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

export class PredictionBuffer {
  inputs: PlayerInput[] = [];
  predicted: PlayerState | null = null;
  private maxKeep = 90;

  reset(state: PlayerState) {
    this.predicted = clonePlayerState(state);
    this.inputs = [];
  }

  record(input: PlayerInput) {
    this.inputs.push(input);
    if (this.inputs.length > this.maxKeep) this.inputs.shift();
  }

  applyHeld(dx: number, dy: number, aim: number, dt: number, sprint: boolean, weapon: number) {
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
    const pos = resolveWalls(p.x, p.y, PLAYER_R);
    p.x = pos.x;
    p.y = pos.y;
    p.angle = aim;
    p.weapon = weapon;
  }

  replayOne(input: PlayerInput, dt: number) {
    if (!this.predicted) return;
    applyInput(this.predicted, input, dt);
  }

  pendingAfter(seq: number): PlayerInput[] {
    return this.inputs.filter((i) => i.seq > seq);
  }

  discardUpTo(seq: number) {
    this.inputs = this.inputs.filter((i) => i.seq > seq);
  }
}
