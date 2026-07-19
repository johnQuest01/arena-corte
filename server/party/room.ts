/**
 * room.ts — Durable Object da sala (PartyServer).
 * Tick 30 Hz, hibernation API, cap de 3 jogadores.
 */
import { Server, type Connection, routePartykitRequest } from "partyserver";
import { TICK_MS, MAX_PLAYERS } from "../../shared/constants";
import { LagHistory } from "../../shared/laghistory";
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
} from "../../shared/protocol";
import {
  addPlayer,
  createSim,
  queueInput,
  startMatch,
  stepSim,
  toSnapshot,
  type GameSim,
} from "../../shared/sim";

interface ConnMeta {
  playerId: number;
  name: string;
  ping: number;
}

function roomCodeFromId(id: string): string {
  return id.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase() || "ARENA1";
}

export class GameRoom extends Server {
  static options = { hibernate: true };

  sim: GameSim = createSim();
  lag = new LagHistory();
  meta = new Map<string, ConnMeta>();
  tickTimer: ReturnType<typeof setInterval> | null = null;
  regionHint = "";

  onStart() {
    this.ensureTick();
  }

  private ensureTick() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTickIfIdle() {
    if (this.meta.size === 0 && this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  onConnect(conn: Connection, ctx?: { request?: Request }) {
    this.ensureTick();
    try {
      const url = ctx?.request ? new URL(ctx.request.url) : null;
      this.regionHint = url?.searchParams.get("region") ?? "";
    } catch {
      this.regionHint = "";
    }

    if (this.meta.size >= MAX_PLAYERS) {
      conn.send(encodeCtrl(MSG.ROOM_FULL));
      conn.close(4000, "sala cheia");
    }
  }

  onMessage(conn: Connection, message: ArrayBuffer | string) {
    if (typeof message === "string") return;
    const buf = message;
    const type = msgType(buf);

    if (type === MSG.HELLO) {
      if (this.meta.has(conn.id)) return;
      if (this.meta.size >= MAX_PLAYERS) {
        conn.send(encodeCtrl(MSG.ROOM_FULL));
        conn.close(4000, "sala cheia");
        return;
      }
      const name = decodeHello(buf) || "player";
      const p = addPlayer(this.sim, name);
      if (!p) {
        conn.send(encodeCtrl(MSG.ROOM_FULL));
        conn.close(4000, "sala cheia");
        return;
      }
      this.meta.set(conn.id, { playerId: p.id, name, ping: 0 });
      const code = roomCodeFromId(this.name);
      const isHost = this.meta.size === 1;
      conn.send(
        encodeWelcome({ selfId: p.id, roomCode: code, isHost }),
      );
      this.broadcastLobby();
      this.broadcast(encodeCtrl(MSG.JOIN, p.id), [conn.id]);
      return;
    }

    const m = this.meta.get(conn.id);
    if (!m) return;

    if (type === MSG.INPUT) {
      const input = decodeInput(buf);
      if (input) queueInput(this.sim, m.playerId, input);
      return;
    }

    if (type === MSG.PING) {
      const t = decodePingTime(buf);
      conn.send(encodePong(t));
      return;
    }

    if (type === MSG.START) {
      // só o primeiro conectado inicia
      const first = [...this.meta.values()][0];
      if (first && first.playerId === m.playerId) {
        if (startMatch(this.sim)) {
          this.broadcast(encodeCtrl(MSG.START));
        }
      }
    }
  }

  onClose(conn: Connection) {
    const m = this.meta.get(conn.id);
    if (m) {
      this.meta.delete(conn.id);
      // marca como morto / remove da lobby se ainda não começou
      if (this.sim.phase === 0) {
        this.sim.players = this.sim.players.filter((p) => p.id !== m.playerId);
      }
      this.broadcast(encodeCtrl(MSG.LEAVE, m.playerId));
      this.broadcastLobby();
    }
    this.stopTickIfIdle();
  }

  private broadcastLobby() {
    const players = [...this.meta.values()].map((m) => ({
      id: m.playerId,
      name: m.name,
      ready: true,
      ping: m.ping,
    }));
    const hostId = players[0]?.id ?? 0;
    this.broadcast(
      encodeLobby({
        players,
        hostId,
        canStart: players.length >= 2 && players.length <= MAX_PLAYERS,
      }),
    );
  }

  private tick() {
    if (this.sim.phase === 1) {
      this.lag.push(this.sim);
      stepSim(this.sim, TICK_MS / 1000, (shooterId, ox, oy, angle, clientTime) =>
        this.lag.hitscan(this.sim, shooterId, ox, oy, angle, clientTime),
      );
      const snap = encodeSnapshot(toSnapshot(this.sim));
      this.broadcast(snap);
    } else if (this.sim.phase === 2) {
      // envia snapshot final ocasionalmente
      this.broadcast(encodeSnapshot(toSnapshot(this.sim)));
    }
  }

}

export default {
  async fetch(
    request: Request,
    env: { GameRoom: DurableObjectNamespace },
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ping") {
      return new Response("pong", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    }
    return (
      (await routePartykitRequest(request, env as unknown as Record<string, unknown>)) ||
      new Response("not found", { status: 404 })
    );
  },
};
