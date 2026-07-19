/**
 * webrtc.ts — helper pra abrir RTCDataChannel (probe LAN + WebRtcTransport).
 */

export interface Signaling {
  send(msg: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }): void;
  onMessage(cb: (msg: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }) => void): void;
}

export interface OpenResult {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
}

export const DEFAULT_ICE: RTCIceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
];

export async function openDataChannel(
  signaling: Signaling,
  opts: { initiator: boolean; iceServers?: RTCIceServer[]; label?: string },
): Promise<OpenResult> {
  const pc = new RTCPeerConnection({ iceServers: opts.iceServers ?? DEFAULT_ICE });

  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) signaling.send({ ice: e.candidate.toJSON() });
  });

  let resolveCh!: (ch: RTCDataChannel) => void;
  const ready = new Promise<RTCDataChannel>((res) => (resolveCh = res));

  const wire = (ch: RTCDataChannel) => {
    ch.binaryType = "arraybuffer";
    if (ch.readyState === "open") resolveCh(ch);
    else ch.addEventListener("open", () => resolveCh(ch), { once: true });
  };

  if (opts.initiator) {
    wire(pc.createDataChannel(opts.label ?? "game", { ordered: false, maxRetransmits: 0 }));
  } else {
    pc.addEventListener("datachannel", (e) => wire(e.channel), { once: true });
  }

  signaling.onMessage(async (msg) => {
    if (msg.sdp) {
      await pc.setRemoteDescription(msg.sdp);
      if (msg.sdp.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signaling.send({ sdp: answer });
      }
    } else if (msg.ice) {
      try {
        await pc.addIceCandidate(msg.ice);
      } catch {
        /* ignore */
      }
    }
  });

  if (opts.initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signaling.send({ sdp: offer });
  }

  const channel = await ready;
  return { pc, channel };
}

/** Sinalização manual via troca de strings (QR / código). */
export function manualSignalingPair(): {
  a: Signaling;
  b: Signaling;
  serializeOffer: () => Promise<string>;
  applyRemote: (side: "a" | "b", json: string) => void;
} {
  type Msg = { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
  const inboxA: Msg[] = [];
  const inboxB: Msg[] = [];
  let cbA: ((m: Msg) => void) | null = null;
  let cbB: ((m: Msg) => void) | null = null;

  const a: Signaling = {
    send(msg) {
      if (cbB) cbB(msg);
      else inboxB.push(msg);
    },
    onMessage(cb) {
      cbA = cb;
      while (inboxA.length) cb(inboxA.shift()!);
    },
  };
  const b: Signaling = {
    send(msg) {
      if (cbA) cbA(msg);
      else inboxA.push(msg);
    },
    onMessage(cb) {
      cbB = cb;
      while (inboxB.length) cb(inboxB.shift()!);
    },
  };

  return {
    a,
    b,
    async serializeOffer() {
      return "";
    },
    applyRemote() {},
  };
}
