/**
 * webrtcTransport.ts — seção 6.2b: P2P via RTCDataChannel.
 */
import type { Transport, TransportHandlers, PlayerId } from "./transport";
import { openDataChannel, DEFAULT_ICE, type Signaling } from "./webrtc";

export class WebRtcTransport implements Transport {
  readonly kind = "webrtc" as const;
  selfId: PlayerId;
  isHost: boolean;
  private channels = new Map<PlayerId, RTCDataChannel>();
  private handlers?: TransportHandlers;

  constructor(
    private opts: {
      selfId: PlayerId;
      isHost: boolean;
      peers: { id: PlayerId; signaling: Signaling; initiator: boolean }[];
      iceServers?: RTCIceServer[];
    },
  ) {
    this.selfId = opts.selfId;
    this.isHost = opts.isHost;
  }

  on(h: TransportHandlers) {
    this.handlers = h;
  }

  async connect() {
    await Promise.all(
      this.opts.peers.map(async (p) => {
        const { channel } = await openDataChannel(p.signaling, {
          initiator: p.initiator,
          iceServers: this.opts.iceServers ?? DEFAULT_ICE,
        });
        channel.addEventListener("message", (ev) => {
          if (ev.data instanceof ArrayBuffer) this.handlers?.onMessage(ev.data, p.id);
        });
        channel.addEventListener("close", () => {
          this.channels.delete(p.id);
          this.handlers?.onPeerLeave(p.id);
        });
        this.channels.set(p.id, channel);
        this.handlers?.onPeerJoin(p.id);
      }),
    );
  }

  send(data: ArrayBuffer) {
    this.channels.forEach((ch) => {
      if (ch.readyState === "open") ch.send(data);
    });
  }

  close() {
    this.channels.forEach((ch) => ch.close());
    this.channels.clear();
  }
}
