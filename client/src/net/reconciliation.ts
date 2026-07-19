/**
 * reconciliation.ts — correção suave a partir do estado autoritativo.
 * Modelo do host: 1 input (o último) por tick → replay agrupa pendentes assim.
 */
import { SMOOTH_MS, TICK_MS } from "../../../shared/constants";
import type { PlayerInput, PlayerState } from "../../../shared/protocol";
import { applyInput, clonePlayerState } from "../../../shared/sim";
import type { PredictionBuffer } from "./prediction";

export interface SmoothState {
  x: number;
  y: number;
  angle: number;
  errX: number;
  errY: number;
  errAngle: number;
  t: number;
}

export function createSmooth(p: PlayerState): SmoothState {
  return { x: p.x, y: p.y, angle: p.angle, errX: 0, errY: 0, errAngle: 0, t: 0 };
}

/**
 * Reconcilia sem “matar” o hold: a partir do auth, re-simula os ticks pendentes
 * usando o último input de cada janela (~2 inputs de 60 Hz = 1 tick de 30 Hz).
 */
export function reconcile(
  auth: PlayerState,
  buffer: PredictionBuffer,
  smooth: SmoothState,
  held?: PlayerInput | null,
): PlayerState {
  buffer.discardUpTo(auth.lastProcessedInputSeq);
  const replayed = clonePlayerState(auth);
  // sincroniza slot autoritativo da arma atual; replay usa o bank nas trocas
  buffer.ammoBank[auth.weapon] = { mag: auth.mag, reserve: auth.reserve };
  buffer.attachAmmo(replayed);
  const pending = buffer.pendingAfter(auth.lastProcessedInputSeq);

  const tickDt = TICK_MS / 1000;
  let t = buffer.serverTime;
  // agrupa de 2 em 2 (60 Hz → 30 Hz); OR de fire/cast como o host
  for (let i = 0; i < pending.length; ) {
    const batch = pending.slice(i, i + 2);
    i += batch.length;
    const latest = batch[batch.length - 1]!;
    let wantFire = false;
    let wantCast = false;
    let wantReload = false;
    let wantUse = false;
    let wantThrow = 0;
    let castAim = latest.aim;
    let castAbility = latest.ability;
    for (const inp of batch) {
      if (inp.fire) wantFire = true;
      if (inp.reload) wantReload = true;
      if (inp.use) wantUse = true;
      if (inp.throw >= 1) wantThrow = inp.throw;
      if (inp.cast) {
        wantCast = true;
        castAim = inp.aim;
        castAbility = inp.ability;
      }
    }
    const merged: PlayerInput = {
      ...latest,
      ...(wantCast ? { aim: castAim, ability: castAbility ?? latest.ability } : {}),
      fire: wantFire,
      cast: wantCast,
      reload: wantReload,
      use: wantUse,
      throw: wantThrow,
    };
    t += TICK_MS;
    applyInput(replayed, merged, tickDt, { doorBits: buffer.doorBits, serverTime: t });
  }

  // se ainda há tecla segurada e não ficou pendente, garante 1 passo na direção atual
  if (held && (held.dx !== 0 || held.dy !== 0) && pending.length === 0) {
    // não anda de novo — só mantém ângulo; o frame seguinte aplica o hold
    replayed.angle = held.aim;
  }

  const prevX = buffer.predicted?.x ?? smooth.x;
  const prevY = buffer.predicted?.y ?? smooth.y;
  const prevA = buffer.predicted?.angle ?? smooth.angle;

  buffer.predicted = clonePlayerState(replayed);
  buffer.attachAmmo(buffer.predicted);

  const dx = prevX - replayed.x;
  const dy = prevY - replayed.y;
  const dist = Math.hypot(dx, dy);
  // erro grande = snap (parede/teleporte) — não interpolar (causa tremor)
  if (dist > 40) {
    smooth.errX = 0;
    smooth.errY = 0;
    smooth.errAngle = 0;
    smooth.t = 0;
  } else if (dist > 1) {
    smooth.errX = dx;
    smooth.errY = dy;
    let da = prevA - replayed.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    smooth.errAngle = da;
    smooth.t = SMOOTH_MS;
  }

  return replayed;
}

export function stepSmooth(
  smooth: SmoothState,
  target: PlayerState,
  dtMs: number,
): { x: number; y: number; angle: number } {
  if (smooth.t > 0) {
    const k = Math.min(1, dtMs / Math.max(16, smooth.t));
    smooth.errX *= 1 - k;
    smooth.errY *= 1 - k;
    smooth.errAngle *= 1 - k;
    smooth.t = Math.max(0, smooth.t - dtMs);
  } else {
    smooth.errX = 0;
    smooth.errY = 0;
    smooth.errAngle = 0;
  }
  smooth.x = target.x + smooth.errX;
  smooth.y = target.y + smooth.errY;
  smooth.angle = target.angle + smooth.errAngle;
  return { x: smooth.x, y: smooth.y, angle: smooth.angle };
}
