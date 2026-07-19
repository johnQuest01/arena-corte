/**
 * cloudTransport.ts — seção 6.1: online via PartySocket → Durable Object.
 */
import PartySocket from "partysocket";
import type { Transport, TransportHandlers, PlayerId } from "./transport";

export class CloudTransport implements Transport {
  readonly kind = "cloud" as const;
  selfId: PlayerId = "";
  isHost = false;
  private socket?: PartySocket;
  private handlers?: TransportHandlers;

  constructor(private opts: { host: string; room: string; region?: string }) {}

  on(h: TransportHandlers) {
    this.handlers = h;
  }

  async connect() {
    this.socket = new PartySocket({
      host: this.opts.host,
      room: this.opts.room,
      party: "GameRoom",
      query: this.opts.region ? { region: this.opts.region } : undefined,
    });
    this.socket.binaryType = "arraybuffer";

    this.socket.addEventListener("message", (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        this.handlers?.onMessage(ev.data, "server");
      } else if (ev.data instanceof Blob) {
        void ev.data.arrayBuffer().then((ab) => this.handlers?.onMessage(ab, "server"));
      }
    });
    this.socket.addEventListener("close", () => this.handlers?.onClose?.("socket close"));

    await new Promise<void>((res, rej) => {
      this.socket!.addEventListener("open", () => res(), { once: true });
      this.socket!.addEventListener("error", () => rej(new Error("cloud connect falhou")), {
        once: true,
      });
    });
  }

  send(data: ArrayBuffer) {
    this.socket?.send(data);
  }

  close() {
    this.socket?.close();
  }
}
