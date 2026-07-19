/**
 * transport.ts — contrato único de transporte (seções 3 e 6).
 * Trocar de modo = trocar a implementação; netcode/render/gameplay não mudam.
 */

export type PlayerId = string;

export type TransportKind = "cloud" | "lan" | "webrtc";

export interface TransportHandlers {
  onMessage: (data: ArrayBuffer, from: PlayerId) => void;
  onPeerJoin: (id: PlayerId) => void;
  onPeerLeave: (id: PlayerId) => void;
  onClose?: (reason?: string) => void;
}

export interface Transport {
  readonly kind: TransportKind;
  selfId: PlayerId;
  /** true se ESTE lado roda a simulação autoritativa (LAN host / WebRTC host). Online: sempre false. */
  isHost: boolean;

  on(handlers: TransportHandlers): void;
  connect(): Promise<void>;
  send(data: ArrayBuffer): void;
  close(): void;
}
