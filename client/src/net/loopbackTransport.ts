/**
 * LoopbackTransport — host autoritativo na própria aba (treino / demo).
 * Reusa sim.ts; útil pra validar prediction/render sem rede.
 */
import { TICK_MS, MAX_PLAYERS } from "../../../shared/constants";
import { LagHistory } from "../../../shared/laghistory";
import {
  MSG,
  decodeHello,
  decodeInput,
  decodePingTime,
  encodeCtrl,
  encodeLobby,
  encodePong,
  encodeSnapshot,
  encodeWelcome,
  msgType,
} from "../../../shared/protocol";
import {
  addPlayer,
  createSim,
  doorBitsOf,
  queueInput,
  startMatch,
  stepSim,
  toSnapshot,
  type GameSim,
} from "../../../shared/sim";
import { botInput, clearBotMemory } from "./botAi";
import type { Transport, TransportHandlers, PlayerId } from "./transport";

export class LoopbackTransport implements Transport {
  readonly kind = "lan" as const;
  selfId: PlayerId = "0";
  isHost = true;
  private handlers?: TransportHandlers;
  private sim: GameSim = createSim();
  private lag = new LagHistory();
  private timer: ReturnType<typeof setInterval> | null = null;
  private name = "player";
  private bots = true;

  constructor(opts?: { bots?: boolean }) {
    this.bots = opts?.bots ?? true;
  }

  on(h: TransportHandlers) {
    this.handlers = h;
  }

  async connect() {
    // noop — pronto imediatamente
  }

  send(data: ArrayBuffer) {
    const type = msgType(data);

    if (type === MSG.HELLO) {
      const name = decodeHello(data) || "player";
      this.name = name;
      const p = addPlayer(this.sim, name);
      if (!p) {
        this.handlers?.onMessage(encodeCtrl(MSG.ROOM_FULL), "host");
        return;
      }
      this.selfId = String(p.id);
      if (this.bots) {
        while (this.sim.players.length < MAX_PLAYERS) {
          addPlayer(this.sim, `bot${this.sim.players.length}`);
        }
      }
      this.handlers?.onMessage(
        encodeWelcome({ selfId: p.id, roomCode: "TREINO", isHost: true }),
        "host",
      );
      this.emitLobby();
      this.ensureTick();
      return;
    }

    if (type === MSG.INPUT) {
      const input = decodeInput(data);
      if (input) queueInput(this.sim, Number(this.selfId), input);
      return;
    }

    if (type === MSG.PING) {
      this.handlers?.onMessage(encodePong(decodePingTime(data)), "host");
      return;
    }

    if (type === MSG.START) {
      clearBotMemory();
      if (startMatch(this.sim)) {
        this.handlers?.onMessage(encodeCtrl(MSG.START), "host");
      }
    }
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private emitLobby() {
    const players = this.sim.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: true,
      ping: 0,
    }));
    this.handlers?.onMessage(
      encodeLobby({
        players,
        hostId: 0,
        canStart: players.length >= 2,
      }),
      "host",
    );
  }

  private ensureTick() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.sim.phase === 1) {
        this.driveBots();
        this.lag.push(this.sim);
        // treino: só projéteis (sem hitscan) — bots com lag-comp viram aimbot
        stepSim(this.sim, TICK_MS / 1000, null);
        this.handlers?.onMessage(encodeSnapshot(toSnapshot(this.sim)), "host");
      } else if (this.sim.phase === 2) {
        this.handlers?.onMessage(encodeSnapshot(toSnapshot(this.sim)), "host");
      }
    }, TICK_MS);
  }

  private driveBots() {
    const self = this.sim.players.find((x) => x.id === Number(this.selfId));
    const bits = doorBitsOf(this.sim);
    for (const p of this.sim.players) {
      if (p.id === Number(this.selfId)) continue;
      if (!p.alive) continue;
      const input = botInput(
        p,
        self,
        bits,
        this.sim.tick * 10 + p.id,
        this.sim.serverTime,
      );
      queueInput(this.sim, p.id, input);
    }
  }
}
