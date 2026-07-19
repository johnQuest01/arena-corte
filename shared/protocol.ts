/**
 * protocol.ts — encode/decode binário de inputs e snapshots.
 */
export const MSG = {
  HELLO: 1,
  WELCOME: 2,
  JOIN: 3,
  LEAVE: 4,
  INPUT: 5,
  SNAPSHOT: 6,
  START: 7,
  PING: 8,
  PONG: 9,
  ROOM_FULL: 10,
  LOBBY: 11,
  RESULT: 12,
  RESYNC: 13,
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

export interface PlayerInput {
  seq: number;
  dx: number;
  dy: number;
  aim: number;
  fire: boolean;
  sprint: boolean;
  weapon: number; // 0..3
  throw: number; // 0 none, 1-4 throwable
  clientTime: number;
}

export interface PlayerState {
  id: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  hp: number;
  kills: number;
  alive: boolean;
  lastProcessedInputSeq: number;
  fireCd: number;
  weapon: number;
  stamina: number;
}

export interface BulletState {
  id: number;
  owner: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
}

export interface ThrowableState {
  id: number;
  kind: number; // 1..4
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuse: number; // ms remaining
}

export type EventKind =
  | "shot"
  | "hit"
  | "death"
  | "respawn"
  | "explode"
  | "flash"
  | "smoke"
  | "fire";

export interface TickEvent {
  kind: EventKind;
  a: number;
  b: number;
  x: number;
  y: number;
}

export interface Snapshot {
  tick: number;
  serverTime: number;
  matchLeftMs: number;
  phase: number;
  players: PlayerState[];
  bullets: BulletState[];
  throwables: ThrowableState[];
  events: TickEvent[];
}

export interface WelcomeMsg {
  selfId: number;
  roomCode: string;
  isHost: boolean;
}

export interface LobbyMsg {
  players: { id: number; name: string; ready: boolean; ping: number }[];
  hostId: number;
  canStart: boolean;
}

function f32(v: number) {
  return Math.fround(v);
}

export function encodeInput(input: PlayerInput): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 4 + 4 + 4 + 4 + 1 + 1 + 1 + 1 + 8);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, MSG.INPUT);
  v.setUint32(o, input.seq >>> 0, true);
  o += 4;
  v.setFloat32(o, f32(input.dx), true);
  o += 4;
  v.setFloat32(o, f32(input.dy), true);
  o += 4;
  v.setFloat32(o, f32(input.aim), true);
  o += 4;
  v.setUint8(o++, input.fire ? 1 : 0);
  v.setUint8(o++, input.sprint ? 1 : 0);
  v.setUint8(o++, input.weapon & 0xff);
  v.setUint8(o++, input.throw & 0xff);
  v.setFloat64(o, input.clientTime, true);
  return buf;
}

export function decodeInput(buf: ArrayBuffer): PlayerInput | null {
  if (buf.byteLength < 29) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG.INPUT) return null;
  let o = 1;
  const seq = v.getUint32(o, true);
  o += 4;
  const dx = v.getFloat32(o, true);
  o += 4;
  const dy = v.getFloat32(o, true);
  o += 4;
  const aim = v.getFloat32(o, true);
  o += 4;
  const fire = v.getUint8(o++) === 1;
  const sprint = v.getUint8(o++) === 1;
  const weapon = v.getUint8(o++);
  const thr = v.getUint8(o++);
  const clientTime = v.getFloat64(o, true);
  return { seq, dx, dy, aim, fire, sprint, weapon, throw: thr, clientTime };
}

const EVENT_KIND: Record<EventKind, number> = {
  shot: 0,
  hit: 1,
  death: 2,
  respawn: 3,
  explode: 4,
  flash: 5,
  smoke: 6,
  fire: 7,
};
const KIND_FROM: EventKind[] = [
  "shot",
  "hit",
  "death",
  "respawn",
  "explode",
  "flash",
  "smoke",
  "fire",
];

const PLAYER_BYTES = 36;
const BULLET_BYTES = 28;
const THROW_BYTES = 24;
const EVENT_BYTES = 14;

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const nP = s.players.length;
  const nB = s.bullets.length;
  const nT = s.throwables.length;
  const nE = s.events.length;
  const size =
    1 + 4 + 8 + 4 + 1 + 1 + 1 + 1 + 1 + nP * PLAYER_BYTES + nB * BULLET_BYTES + nT * THROW_BYTES + nE * EVENT_BYTES;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, MSG.SNAPSHOT);
  v.setUint32(o, s.tick >>> 0, true);
  o += 4;
  v.setFloat64(o, s.serverTime, true);
  o += 8;
  v.setUint32(o, s.matchLeftMs >>> 0, true);
  o += 4;
  v.setUint8(o++, s.phase);
  v.setUint8(o++, nP);
  v.setUint8(o++, nB);
  v.setUint8(o++, nT);
  v.setUint8(o++, nE);

  for (const p of s.players) {
    v.setUint8(o++, p.id);
    v.setFloat32(o, f32(p.x), true);
    o += 4;
    v.setFloat32(o, f32(p.y), true);
    o += 4;
    v.setFloat32(o, f32(p.angle), true);
    o += 4;
    v.setFloat32(o, f32(p.vx), true);
    o += 4;
    v.setFloat32(o, f32(p.vy), true);
    o += 4;
    v.setUint8(o++, Math.max(0, Math.min(255, p.hp | 0)));
    v.setUint8(o++, Math.max(0, Math.min(255, p.kills | 0)));
    v.setUint8(o++, p.alive ? 1 : 0);
    v.setUint32(o, p.lastProcessedInputSeq >>> 0, true);
    o += 4;
    v.setFloat32(o, f32(p.fireCd), true);
    o += 4;
    v.setUint8(o++, p.weapon & 0xff);
    v.setUint8(o++, Math.max(0, Math.min(255, Math.round(p.stamina))));
    v.setUint16(o, 0, true);
    o += 2;
  }

  for (const b of s.bullets) {
    v.setUint16(o, b.id, true);
    o += 2;
    v.setUint8(o++, b.owner);
    v.setFloat32(o, f32(b.x), true);
    o += 4;
    v.setFloat32(o, f32(b.y), true);
    o += 4;
    v.setFloat32(o, f32(b.px), true);
    o += 4;
    v.setFloat32(o, f32(b.py), true);
    o += 4;
    v.setFloat32(o, f32(b.vx), true);
    o += 4;
    v.setFloat32(o, f32(b.vy), true);
    o += 4;
    v.setUint8(o++, 0);
  }

  for (const t of s.throwables) {
    v.setUint16(o, t.id, true);
    o += 2;
    v.setUint8(o++, t.kind);
    v.setUint8(o++, t.owner);
    v.setFloat32(o, f32(t.x), true);
    o += 4;
    v.setFloat32(o, f32(t.y), true);
    o += 4;
    v.setFloat32(o, f32(t.vx), true);
    o += 4;
    v.setFloat32(o, f32(t.vy), true);
    o += 4;
    v.setFloat32(o, f32(t.fuse), true);
    o += 4;
  }

  for (const e of s.events) {
    v.setUint8(o++, EVENT_KIND[e.kind] ?? 0);
    v.setUint8(o++, e.a);
    v.setUint8(o++, e.b);
    v.setFloat32(o, f32(e.x), true);
    o += 4;
    v.setFloat32(o, f32(e.y), true);
    o += 4;
    v.setUint16(o, 0, true);
    o += 2;
  }

  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot | null {
  if (buf.byteLength < 21) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG.SNAPSHOT) return null;
  let o = 1;
  const tick = v.getUint32(o, true);
  o += 4;
  const serverTime = v.getFloat64(o, true);
  o += 8;
  const matchLeftMs = v.getUint32(o, true);
  o += 4;
  const phase = v.getUint8(o++);
  const nP = v.getUint8(o++);
  const nB = v.getUint8(o++);
  const nT = v.getUint8(o++);
  const nE = v.getUint8(o++);

  const players: PlayerState[] = [];
  for (let i = 0; i < nP; i++) {
    const id = v.getUint8(o++);
    const x = v.getFloat32(o, true);
    o += 4;
    const y = v.getFloat32(o, true);
    o += 4;
    const angle = v.getFloat32(o, true);
    o += 4;
    const vx = v.getFloat32(o, true);
    o += 4;
    const vy = v.getFloat32(o, true);
    o += 4;
    const hp = v.getUint8(o++);
    const kills = v.getUint8(o++);
    const alive = v.getUint8(o++) === 1;
    const lastProcessedInputSeq = v.getUint32(o, true);
    o += 4;
    const fireCd = v.getFloat32(o, true);
    o += 4;
    const weapon = v.getUint8(o++);
    const stamina = v.getUint8(o++);
    o += 2;
    players.push({
      id,
      x,
      y,
      angle,
      vx,
      vy,
      hp,
      kills,
      alive,
      lastProcessedInputSeq,
      fireCd,
      weapon,
      stamina,
    });
  }

  const bullets: BulletState[] = [];
  for (let i = 0; i < nB; i++) {
    const id = v.getUint16(o, true);
    o += 2;
    const owner = v.getUint8(o++);
    const x = v.getFloat32(o, true);
    o += 4;
    const y = v.getFloat32(o, true);
    o += 4;
    const px = v.getFloat32(o, true);
    o += 4;
    const py = v.getFloat32(o, true);
    o += 4;
    const vx = v.getFloat32(o, true);
    o += 4;
    const vy = v.getFloat32(o, true);
    o += 4;
    o += 1;
    bullets.push({ id, owner, x, y, px, py, vx, vy });
  }

  const throwables: ThrowableState[] = [];
  for (let i = 0; i < nT; i++) {
    const id = v.getUint16(o, true);
    o += 2;
    const kind = v.getUint8(o++);
    const owner = v.getUint8(o++);
    const x = v.getFloat32(o, true);
    o += 4;
    const y = v.getFloat32(o, true);
    o += 4;
    const vx = v.getFloat32(o, true);
    o += 4;
    const vy = v.getFloat32(o, true);
    o += 4;
    const fuse = v.getFloat32(o, true);
    o += 4;
    throwables.push({ id, kind, owner, x, y, vx, vy, fuse });
  }

  const events: TickEvent[] = [];
  for (let i = 0; i < nE; i++) {
    const kind = KIND_FROM[v.getUint8(o++)] ?? "shot";
    const a = v.getUint8(o++);
    const b = v.getUint8(o++);
    const x = v.getFloat32(o, true);
    o += 4;
    const y = v.getFloat32(o, true);
    o += 4;
    o += 2;
    events.push({ kind, a, b, x, y });
  }

  return { tick, serverTime, matchLeftMs, phase, players, bullets, throwables, events };
}

export function encodeHello(name: string): ArrayBuffer {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(name.slice(0, 16));
  const buf = new ArrayBuffer(2 + nameBytes.length);
  const v = new DataView(buf);
  v.setUint8(0, MSG.HELLO);
  v.setUint8(1, nameBytes.length);
  new Uint8Array(buf, 2).set(nameBytes);
  return buf;
}

export function decodeHello(buf: ArrayBuffer): string | null {
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG.HELLO) return null;
  const len = v.getUint8(1);
  return new TextDecoder().decode(new Uint8Array(buf, 2, len));
}

export function encodeWelcome(w: WelcomeMsg): ArrayBuffer {
  const enc = new TextEncoder();
  const code = enc.encode(w.roomCode.slice(0, 8));
  const buf = new ArrayBuffer(4 + code.length);
  const v = new DataView(buf);
  v.setUint8(0, MSG.WELCOME);
  v.setUint8(1, w.selfId);
  v.setUint8(2, w.isHost ? 1 : 0);
  v.setUint8(3, code.length);
  new Uint8Array(buf, 4).set(code);
  return buf;
}

export function decodeWelcome(buf: ArrayBuffer): WelcomeMsg | null {
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG.WELCOME) return null;
  const selfId = v.getUint8(1);
  const isHost = v.getUint8(2) === 1;
  const len = v.getUint8(3);
  const roomCode = new TextDecoder().decode(new Uint8Array(buf, 4, len));
  return { selfId, roomCode, isHost };
}

export function encodeLobby(m: LobbyMsg): ArrayBuffer {
  const json = JSON.stringify(m);
  const bytes = new TextEncoder().encode(json);
  const buf = new ArrayBuffer(1 + bytes.length);
  new DataView(buf).setUint8(0, MSG.LOBBY);
  new Uint8Array(buf, 1).set(bytes);
  return buf;
}

export function decodeLobby(buf: ArrayBuffer): LobbyMsg | null {
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG.LOBBY) return null;
  try {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 1))) as LobbyMsg;
  } catch {
    return null;
  }
}

export function encodeCtrl(type: MsgType, ...nums: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(1 + nums.length * 4);
  const v = new DataView(buf);
  v.setUint8(0, type);
  nums.forEach((n, i) => v.setFloat32(1 + i * 4, n, true));
  return buf;
}

export function msgType(buf: ArrayBuffer): number {
  if (buf.byteLength < 1) return -1;
  return new DataView(buf).getUint8(0);
}

export function encodePing(t: number): ArrayBuffer {
  const buf = new ArrayBuffer(9);
  const v = new DataView(buf);
  v.setUint8(0, MSG.PING);
  v.setFloat64(1, t, true);
  return buf;
}

export function encodePong(t: number): ArrayBuffer {
  const buf = new ArrayBuffer(9);
  const v = new DataView(buf);
  v.setUint8(0, MSG.PONG);
  v.setFloat64(1, t, true);
  return buf;
}

export function decodePingTime(buf: ArrayBuffer): number {
  return new DataView(buf).getFloat64(1, true);
}
