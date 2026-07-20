/**
 * LoopbackTransport — host autoritativo na própria aba (treino PvP / co-op).
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
  /** 0 pvp, 1 coop */
  private mode = 0;

  constructor(opts?: { bots?: boolean; mode?: number }) {
    this.bots = opts?.bots ?? true;
    this.mode = opts?.mode ?? 0;
    this.sim.mode = this.mode;
  }

  on(h: TransportHandlers) {
    this.handlers = h;
  }

  async connect() {
    // noop
  }

  send(data: ArrayBuffer) {
    const type = msgType(data);

    if (type === MSG.HELLO) {
      const name = decodeHello(data) || "player";
      this.name = name;
      this.sim.mode = this.mode;
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
        encodeWelcome({
          selfId: p.id,
          roomCode: this.mode === 1 ? "SURVIVAL" : "TREINO",
          isHost: true,
          mode: this.mode,
        }),
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
      this.sim.mode = this.mode;
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
    const min = this.mode === 1 ? 1 : 2;
    this.handlers?.onMessage(
      encodeLobby({
        players,
        hostId: 0,
        canStart: players.length >= min,
        mode: this.mode,
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
        stepSim(this.sim, TICK_MS / 1000, null);
        this.handlers?.onMessage(encodeSnapshot(toSnapshot(this.sim)), "host");
      } else if (this.sim.phase === 2) {
        this.handlers?.onMessage(encodeSnapshot(toSnapshot(this.sim)), "host");
      }
    }, TICK_MS);
  }

  private driveBots() {
    const bits = doorBitsOf(this.sim);
    const enemies = this.sim.enemies;
    for (const p of this.sim.players) {
      if (p.id === Number(this.selfId)) continue;
      if (!p.alive) continue;
      // FFA: cada bot vê todos os outros (humanos + bots) e duelam entre si
      const opponents = this.sim.players.filter((x) => x.id !== p.id);
      const input = botInput(
        p,
        opponents,
        bits,
        this.sim.tick * 10 + p.id,
        this.sim.serverTime,
        this.mode === 1 ? enemies : undefined,
      );
      queueInput(this.sim, p.id, input);
    }
  }
}
