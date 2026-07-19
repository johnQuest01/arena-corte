/**
 * lanTransport.ts — seção 6.2a: cliente WebSocket → host Node na LAN.
 * Carregue a página via HTTP do host (evita mixed content).
 */
import type { Transport, TransportHandlers, PlayerId } from "./transport";

export class LanClientTransport implements Transport {
  readonly kind = "lan" as const;
  selfId: PlayerId = "";
  isHost = false;
  private ws?: WebSocket;
  private handlers?: TransportHandlers;

  constructor(private url: string) {}

  on(h: TransportHandlers) {
    this.handlers = h;
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";
    this.ws.addEventListener("message", (ev) => {
      if (ev.data instanceof ArrayBuffer) this.handlers?.onMessage(ev.data, "host");
    });
    this.ws.addEventListener("close", () => this.handlers?.onClose?.("lan close"));

    await new Promise<void>((res, rej) => {
      this.ws!.addEventListener("open", () => res(), { once: true });
      this.ws!.addEventListener("error", () => rej(new Error("LAN connect falhou")), {
        once: true,
      });
    });
  }

  send(data: ArrayBuffer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  close() {
    this.ws?.close();
  }
}

/** Converte http(s)://host:port em ws(s)://host:port */
export function httpToWs(url: string): string {
  return url.replace(/^http/, "ws").replace(/\/$/, "");
}
