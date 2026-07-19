/**
 * laghistory.ts â€” ring buffer de posiÃ§Ãµes + portas para lag compensation.
 */
import { INTERP_DELAY_MS, PLAYER_R } from "./constants";
import { hitsSolid } from "./map";
import type { GameSim } from "./sim";
import { doorBitsOf } from "./sim";
export interface PosSample {
  time: number;
  id: number;
  x: number;
  y: number;
  alive: boolean;
}
export interface DoorSample {
  time: number;
  bits: number;
}
const HISTORY_MS = 1000;
const MAX_SAMPLES = 64;
export class LagHistory {
  private samples: PosSample[] = [];
  private doors: DoorSample[] = [];
  push(sim: GameSim) {
    const t = sim.serverTime;
    for (const p of sim.players) {
      this.samples.push({ time: t, id: p.id, x: p.x, y: p.y, alive: p.alive });
    }
    this.doors.push({ time: t, bits: doorBitsOf(sim) });
    const cutoff = t - HISTORY_MS;
    while (this.samples.length && this.samples[0]!.time < cutoff) {
      this.samples.shift();
    }
    while (this.doors.length && this.doors[0]!.time < cutoff) {
      this.doors.shift();
    }
    if (this.samples.length > MAX_SAMPLES * 8) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES * 4);
    }
  }
  at(id: number, time: number): { x: number; y: number; alive: boolean } | null {
    const mine = this.samples.filter((s) => s.id === id);
    if (mine.length === 0) return null;
    if (time <= mine[0]!.time) return { x: mine[0]!.x, y: mine[0]!.y, alive: mine[0]!.alive };
    if (time >= mine[mine.length - 1]!.time) {
      const last = mine[mine.length - 1]!;
      return { x: last.x, y: last.y, alive: last.alive };
    }
    for (let i = 0; i < mine.length - 1; i++) {
      const a = mine[i]!;
      const b = mine[i + 1]!;
      if (time >= a.time && time <= b.time) {
        const u = (time - a.time) / Math.max(1, b.time - a.time);
        return {
          x: a.x + (b.x - a.x) * u,
          y: a.y + (b.y - a.y) * u,
          alive: b.alive && a.alive,
        };
      }
    }
    return null;
  }
  doorsAt(time: number): number {
    if (this.doors.length === 0) return 0;
    if (time <= this.doors[0]!.time) return this.doors[0]!.bits;
    let best = this.doors[0]!.bits;
    for (const d of this.doors) {
      if (d.time <= time) best = d.bits;
      else break;
    }
    return best;
  }
  hitscan(
    sim: GameSim,
    shooterId: number,
    ox: number,
    oy: number,
    angle: number,
    clientTime: number,
    doorBits?: number,
  ): { hitId: number; x: number; y: number } | null {
    void clientTime;
    const rewindTime = sim.serverTime - INTERP_DELAY_MS;
    const bits = doorBits ?? this.doorsAt(rewindTime);
    const range = 900;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // bloqueio por parede/porta no tick do disparo
    const step = 8;
    for (let dist = 0; dist < range; dist += step) {
      const x = ox + dx * dist;
      const y = oy + dy * dist;
      if (hitsSolid(x, y, 2, bits)) break;
    }
    let best: { hitId: number; x: number; y: number; dist: number } | null = null;
    for (const p of sim.players) {
      if (p.id === shooterId) continue;
      const pos = this.at(p.id, rewindTime);
      if (!pos || !pos.alive) continue;
      const fx = pos.x - ox;
      const fy = pos.y - oy;
      const proj = fx * dx + fy * dy;
      if (proj < 0 || proj > range) continue;
      // se hÃ¡ parede entre origem e alvo no rewind, ignore
      let blocked = false;
      for (let d = 0; d < proj; d += step) {
        if (hitsSolid(ox + dx * d, oy + dy * d, 2, bits)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const cx = ox + dx * proj;
      const cy = oy + dy * proj;
      const dist = Math.hypot(pos.x - cx, pos.y - cy);
      if (dist <= PLAYER_R + 4) {
        if (!best || proj < best.dist) {
          best = { hitId: p.id, x: pos.x, y: pos.y, dist: proj };
        }
      }
    }
    return best ? { hitId: best.hitId, x: best.x, y: best.y } : null;
  }
}
