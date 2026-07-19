/**
 * laghistory.ts — ring buffer de posições para lag compensation (seção 4.3).
 * Guarda ~1s de histórico; o host rebobina alvos ao instante que o atirador via.
 */

import { INTERP_DELAY_MS, PLAYER_R } from "./constants";
import type { GameSim } from "./sim";

export interface PosSample {
  time: number;
  id: number;
  x: number;
  y: number;
  alive: boolean;
}

const HISTORY_MS = 1000;
const MAX_SAMPLES = 64;

export class LagHistory {
  private samples: PosSample[] = [];

  push(sim: GameSim) {
    const t = sim.serverTime;
    for (const p of sim.players) {
      this.samples.push({ time: t, id: p.id, x: p.x, y: p.y, alive: p.alive });
    }
    const cutoff = t - HISTORY_MS;
    while (this.samples.length && this.samples[0].time < cutoff) {
      this.samples.shift();
    }
    if (this.samples.length > MAX_SAMPLES * 8) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES * 4);
    }
  }

  /** Posição interpolada de um jogador em `time`. */
  at(id: number, time: number): { x: number; y: number; alive: boolean } | null {
    const mine = this.samples.filter((s) => s.id === id);
    if (mine.length === 0) return null;
    if (time <= mine[0].time) return { x: mine[0].x, y: mine[0].y, alive: mine[0].alive };
    if (time >= mine[mine.length - 1].time) {
      const last = mine[mine.length - 1];
      return { x: last.x, y: last.y, alive: last.alive };
    }
    for (let i = 0; i < mine.length - 1; i++) {
      const a = mine[i];
      const b = mine[i + 1];
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

  /**
   * Hitscan com rewind: valida se o raio do tiro acerta algum alvo
   * na posição que o atirador via (clientTime - interp delay).
   */
  hitscan(
    sim: GameSim,
    shooterId: number,
    ox: number,
    oy: number,
    angle: number,
    clientTime: number,
  ): { hitId: number; x: number; y: number } | null {
    // clientTime é performance.now do cliente — mapeamos pelo offset aproximado
    // usando serverTime atual como âncora. Em produção o DO sincroniza clocks;
    // aqui usamos: rewind = agora - INTERP_DELAY (o atraso visual do atirador).
    void clientTime;
    const rewindTime = sim.serverTime - INTERP_DELAY_MS;
    const range = 900;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let best: { hitId: number; x: number; y: number; dist: number } | null = null;

    for (const p of sim.players) {
      if (p.id === shooterId) continue;
      const pos = this.at(p.id, rewindTime);
      if (!pos || !pos.alive) continue;

      // distância ponto-raio (projeção)
      const fx = pos.x - ox;
      const fy = pos.y - oy;
      const proj = fx * dx + fy * dy;
      if (proj < 0 || proj > range) continue;
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
