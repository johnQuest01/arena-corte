/**
 * interpolation.ts — entity interpolation dos jogadores remotos (seção 4.2).
 * Buffer de snapshots; render ~100ms atrasado.
 */
import { INTERP_DELAY_MS } from "../../../shared/constants";
import type { PlayerState, Snapshot } from "../../../shared/protocol";

interface SnapEntry {
  recvAt: number;
  snap: Snapshot;
}

export class InterpBuffer {
  private snaps: SnapEntry[] = [];
  private max = 12;

  push(snap: Snapshot) {
    this.snaps.push({ recvAt: performance.now(), snap });
    if (this.snaps.length > this.max) this.snaps.shift();
  }

  clear() {
    this.snaps = [];
  }

  /** Posição interpolada de um player remoto no tempo de render. */
  sample(playerId: number, now = performance.now()): PlayerState | null {
    if (this.snaps.length < 2) {
      const last = this.snaps[this.snaps.length - 1];
      return last?.snap.players.find((p) => p.id === playerId) ?? null;
    }

    const renderAt = now - INTERP_DELAY_MS;

    // acha dois snapshots que envolvem renderAt (por recvAt)
    let a: SnapEntry | null = null;
    let b: SnapEntry | null = null;
    for (let i = 0; i < this.snaps.length - 1; i++) {
      if (this.snaps[i]!.recvAt <= renderAt && this.snaps[i + 1]!.recvAt >= renderAt) {
        a = this.snaps[i]!;
        b = this.snaps[i + 1]!;
        break;
      }
    }
    if (!a || !b) {
      const last = this.snaps[this.snaps.length - 1]!;
      return last.snap.players.find((p) => p.id === playerId) ?? null;
    }

    const u =
      (renderAt - a.recvAt) / Math.max(1, b.recvAt - a.recvAt);
    const pa = a.snap.players.find((p) => p.id === playerId);
    const pb = b.snap.players.find((p) => p.id === playerId);
    if (!pa || !pb) return pb ?? pa ?? null;

    let da = pb.angle - pa.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;

    return {
      ...pb,
      x: pa.x + (pb.x - pa.x) * u,
      y: pa.y + (pb.y - pa.y) * u,
      angle: pa.angle + da * u,
      vx: pa.vx + (pb.vx - pa.vx) * u,
      vy: pa.vy + (pb.vy - pa.vy) * u,
    };
  }

  latest(): Snapshot | null {
    return this.snaps[this.snaps.length - 1]?.snap ?? null;
  }
}
