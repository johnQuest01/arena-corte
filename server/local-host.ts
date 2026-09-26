/**
 * local-host.ts — modo 6.2a: processo Node que serve HTTP + WebSocket na LAN.
 * Reusa sim.ts / protocol.ts. 100% offline na rede local.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import os from "node:os";
import { TICK_MS, ONLINE_ROOM_CAP } from "../shared/constants";
import { LagHistory } from "../shared/laghistory";
import {
  MSG,
  decodeHello,
  decodeHelloLook,
  decodeLookMsg,
  decodeInput,
  decodePingTime,
  encodeCtrl,
  encodeLobby,
  encodePong,
  encodeSnapshot,
  encodeWelcome,
  msgType,
} from "../shared/protocol";
import { decodeLook, encodeLook } from "../shared/cosmetics";
import {
  addPlayer,
  createSim,
  queueInput,
  startMatch,
  stepSim,
  toSnapshot,
} from "../shared/sim";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const CLIENT_DIST = path.resolve(__dirname, "../client/dist");
const CLIENT_ROOT = path.resolve(__dirname, "../client");

function lanIps(): string[] {
  const nets = os.networkInterfaces();
  const out: string[] = [];
  for (const list of Object.values(nets)) {
    for (const n of list ?? []) {
      if (n.family === "IPv4" && !n.internal) out.push(n.address);
    }
  }
  return out;
}

function mime(p: string): string {
  if (p.endsWith(".html")) return "text/html";
  if (p.endsWith(".js")) return "text/javascript";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

interface Peer {
  ws: WebSocket;
  playerId: number;
  name: string;
  ping: number;
  /** visual (bytes validados); null = automático */
  look: number[] | null;
}

function cleanLook(bytes: number[] | null): number[] | null {
  const look = decodeLook(bytes);
  return look ? encodeLook(look) : null;
}

const sim = createSim();
const lag = new LagHistory();
const peers = new Map<WebSocket, Peer>();
let roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();

function broadcast(data: ArrayBuffer | Buffer, except?: WebSocket) {
  for (const [ws] of peers) {
    if (ws === except || ws.readyState !== WebSocket.OPEN) continue;
    ws.send(data);
  }
}

function broadcastLobby() {
  const players = [...peers.values()].map((p) => ({
    id: p.playerId,
    name: p.name,
    ready: true,
    ping: p.ping,
    ...(p.look ? { look: p.look } : {}),
  }));
  const hostId = players[0]?.id ?? 0;
  broadcast(
    Buffer.from(
      encodeLobby({
        players,
        hostId,
        canStart: players.length >= 2 && players.length <= ONLINE_ROOM_CAP,
      }),
    ),
  );
}

function tick() {
  if (sim.phase === 1) {
    lag.push(sim);
    stepSim(sim, TICK_MS / 1000, (shooterId, ox, oy, angle, clientTime) =>
      lag.hitscan(sim, shooterId, ox, oy, angle, clientTime),
    );
    broadcast(Buffer.from(encodeSnapshot(toSnapshot(sim))));
  } else if (sim.phase === 2) {
    broadcast(Buffer.from(encodeSnapshot(toSnapshot(sim))));
  }
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/ping") {
    res.writeHead(200, { "Cache-Control": "no-store" });
    res.end("pong");
    return;
  }
  if (req.url === "/host-info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ips: lanIps(),
        port: PORT,
        roomCode,
        url: `http://${lanIps()[0] ?? "127.0.0.1"}:${PORT}`,
      }),
    );
    return;
  }

  let urlPath = req.url?.split("?")[0] || "/";
  if (urlPath === "/") urlPath = "/index.html";

  const candidates = [
    path.join(CLIENT_DIST, urlPath),
    path.join(CLIENT_ROOT, urlPath),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "Content-Type": mime(file) });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }

  // fallback SPA / index do Vite em dev: página mínima apontando pro jogo
  if (urlPath === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><title>Arena Host</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
</head><body style="margin:0;background:#0e1210;color:#d8e0dc;font-family:Archivo,sans-serif">
<p style="padding:2rem">Rode <code>npm run build</code> no client, ou em dev use o proxy Vite.
Host LAN ativo em porta ${PORT}.</p>
<script>location.href=location.origin</script>
</body></html>`);
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  if (peers.size >= ONLINE_ROOM_CAP) {
    ws.send(Buffer.from(encodeCtrl(MSG.ROOM_FULL)));
    ws.close(4000, "sala cheia");
    return;
  }

  ws.binaryType = "arraybuffer";
  ws.on("message", (data) => {
    const buf =
      data instanceof ArrayBuffer
        ? data
        : (data as Buffer).buffer.slice(
            (data as Buffer).byteOffset,
            (data as Buffer).byteOffset + (data as Buffer).byteLength,
          );
    const type = msgType(buf as ArrayBuffer);

    if (type === MSG.HELLO) {
      if (peers.has(ws)) return;
      if (peers.size >= ONLINE_ROOM_CAP) {
        ws.send(Buffer.from(encodeCtrl(MSG.ROOM_FULL)));
        ws.close(4000, "sala cheia");
        return;
      }
      const name = decodeHello(buf as ArrayBuffer) || "player";
      const p = addPlayer(sim, name);
      if (!p) {
        ws.send(Buffer.from(encodeCtrl(MSG.ROOM_FULL)));
        ws.close(4000, "sala cheia");
        return;
      }
      peers.set(ws, {
        ws,
        playerId: p.id,
        name,
        ping: 0,
        look: cleanLook(decodeHelloLook(buf as ArrayBuffer)),
      });
      ws.send(
        Buffer.from(
          encodeWelcome({
            selfId: p.id,
            roomCode,
            isHost: peers.size === 1,
          }),
        ),
      );
      broadcastLobby();
      return;
    }

    const peer = peers.get(ws);
    if (!peer) return;

    if (type === MSG.INPUT) {
      const input = decodeInput(buf as ArrayBuffer);
      if (input) queueInput(sim, peer.playerId, input);
      return;
    }
    if (type === MSG.PING) {
      ws.send(Buffer.from(encodePong(decodePingTime(buf as ArrayBuffer))));
      return;
    }
    if (type === MSG.LOOK) {
      const look = cleanLook(decodeLookMsg(buf as ArrayBuffer));
      if (look) {
        peer.look = look;
        broadcastLobby();
      }
      return;
    }
    if (type === MSG.START) {
      const first = [...peers.values()][0];
      if (first?.playerId === peer.playerId && startMatch(sim)) {
        broadcast(Buffer.from(encodeCtrl(MSG.START)));
      }
    }
  });

  ws.on("close", () => {
    const peer = peers.get(ws);
    if (peer) {
      peers.delete(ws);
      if (sim.phase === 0) {
        sim.players = sim.players.filter((p) => p.id !== peer.playerId);
      }
      broadcast(Buffer.from(encodeCtrl(MSG.LEAVE, peer.playerId)));
      broadcastLobby();
    }
  });
});

setInterval(tick, TICK_MS);

server.listen(PORT, "0.0.0.0", () => {
  const ips = lanIps();
  console.log("\n=== Host LAN (modo local / offline) ===");
  console.log(`Código da sala: ${roomCode}`);
  for (const ip of ips) {
    console.log(`  http://${ip}:${PORT}`);
  }
  console.log(`  http://127.0.0.1:${PORT}`);
  console.log("Mostre o QR / URL aos outros 2 jogadores.\n");
});
