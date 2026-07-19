/**
 * protocol.ts â€” encode/decode binÃ¡rio de inputs e snapshots.
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
  /** tecla E — abrir/fechar porta */
  use: boolean;
  /** tecla R — recarregar */
  reload: boolean;
  /** tecla Q — conjurar habilidade */
  cast: boolean;
  weapon: number; // 0..6
  throw: number; // 0 none, 1-4 throwable
  /** habilidade equipada (0 jato, 1 gigante) — byte pad do INPUT */
  ability?: number;
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
  mag: number;
  reserve: number;
  /** id da habilidade equipada */
  ability: number;
  /** serverTime em que o CD acaba; 0 = pronto */
  abilityCdUntil: number;
  /** serverTime até quando está silenciado (não atira); 0 = livre */
  stunnedUntil: number;
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
  /** arma que disparou (byte reservado do protocolo) */
  weapon: number;
  /** ms restantes (0 = sem limite) â€” host; sync aproximado via byte */
  life: number;
}
export interface ThrowableState {
  id: number;
  kind: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuse: number;
}
export type EventKind =
  | "shot"
  | "hit"
  | "death"
  | "respawn"
  | "explode"
  | "flash"
  | "smoke"
  | "fire"
  | "doorOpen"
  | "doorClose"
  | "reloadStart"
  | "dropSpawn"
  | "dropTaken"
  | "weaponDropSpawn"
  | "weaponDropTaken"
  | "ability"
  | "enemySpawn"
  | "enemyHit"
  | "enemyDeath"
  | "giantSpawn"
  | "giantHit"
  | "giantExpire";
export interface TickEvent {
  kind: EventKind;
  a: number;
  b: number;
  x: number;
  y: number;
  /** arma/causa (hit/death/shot) — packed no u16 reservado */
  weaponId?: number;
  /** ângulo do evento (habilidade); 0 se N/A */
  angle?: number;
}
/** Snapshot de inimigo (~11 bytes). */
export interface EnemySnap {
  id: number;
  type: number;
  x: number;
  y: number;
  hp: number;
  state: number;
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
  /** bitfield: bit i = porta i aberta */
  doorsBits: number;
  enemies?: EnemySnap[];
  /** 0 = pvp, 1 = coop */
  mode?: number;
  wave?: number;
  waveLeft?: number;
}
export interface WelcomeMsg {
  selfId: number;
  roomCode: string;
  isHost: boolean;
  /** 0 pvp, 1 coop */
  mode?: number;
}
export interface LobbyMsg {
  players: { id: number; name: string; ready: boolean; ping: number }[];
  hostId: number;
  canStart: boolean;
  mode?: number;
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
  const flags =
    (input.fire ? 1 : 0) |
    (input.sprint ? 2 : 0) |
    (input.use ? 4 : 0) |
    (input.reload ? 8 : 0) |
    (input.cast ? 16 : 0);
  v.setUint8(o++, flags);
  v.setUint8(o++, (input.ability ?? 0) & 0xff);
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
  const flags = v.getUint8(o++);
  const ability = v.getUint8(o++);
  const weapon = v.getUint8(o++);
  const thr = v.getUint8(o++);
  const clientTime = v.getFloat64(o, true);
  return {
    seq,
    dx,
    dy,
    aim,
    fire: (flags & 1) !== 0,
    sprint: (flags & 2) !== 0,
    use: (flags & 4) !== 0,
    reload: (flags & 8) !== 0,
    cast: (flags & 16) !== 0,
    weapon,
    throw: thr,
    ability,
    clientTime,
  };
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
  doorOpen: 8,
  doorClose: 9,
  reloadStart: 10,
  dropSpawn: 11,
  dropTaken: 12,
  weaponDropSpawn: 13,
  weaponDropTaken: 14,
  ability: 15,
  enemySpawn: 16,
  enemyHit: 17,
  enemyDeath: 18,
  giantSpawn: 19,
  giantHit: 20,
  giantExpire: 21,
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
  "doorOpen",
  "doorClose",
  "reloadStart",
  "dropSpawn",
  "dropTaken",
  "weaponDropSpawn",
  "weaponDropTaken",
  "ability",
  "enemySpawn",
  "enemyHit",
  "enemyDeath",
  "giantSpawn",
  "giantHit",
  "giantExpire",
];
const PLAYER_BYTES = 41;
const BULLET_BYTES = 28;
const THROW_BYTES = 24;
const EVENT_BYTES = 18;
const ENEMY_BYTES = 11;
/** Eventos que todos precisam ver — prioridade se o tick passar de 255. */
const EVENT_PRIORITY: ReadonlySet<EventKind> = new Set([
  "death",
  "respawn",
  "ability",
  "giantSpawn",
  "giantHit",
  "giantExpire",
  "enemySpawn",
  "enemyDeath",
  "explode",
  "flash",
]);

function pickEventsForWire(events: TickEvent[]): TickEvent[] {
  if (events.length <= 255) return events;
  const important = events.filter((e) => EVENT_PRIORITY.has(e.kind));
  const rest = events.filter((e) => !EVENT_PRIORITY.has(e.kind));
  return [...important, ...rest].slice(0, 255);
}

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const nP = s.players.length;
  const nB = s.bullets.length;
  const nT = s.throwables.length;
  const wireEvents = pickEventsForWire(s.events);
  const nE = wireEvents.length;
  const enemies = s.enemies ?? [];
  const nEn = Math.min(255, enemies.length);
  const size =
    1 +
    4 +
    8 +
    4 +
    1 +
    1 +
    1 +
    1 +
    1 +
    2 + // doorsBits
    nP * PLAYER_BYTES +
    nB * BULLET_BYTES +
    nT * THROW_BYTES +
    nE * EVENT_BYTES +
    1 + // nEn
    nEn * ENEMY_BYTES +
    1 + // mode
    1 + // wave
    2; // waveLeft
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
  v.setUint16(o, (s.doorsBits ?? 0) & 0xffff, true);
  o += 2;
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
    v.setUint8(o++, Math.max(0, Math.min(255, p.mag | 0)));
    v.setUint8(o++, Math.max(0, Math.min(255, p.reserve | 0)));
    v.setUint8(o++, (p.ability ?? 0) & 0xff);
    const cdLeft = Math.max(0, Math.min(65535, Math.round((p.abilityCdUntil ?? 0) - s.serverTime)));
    const stunLeft = Math.max(0, Math.min(65535, Math.round((p.stunnedUntil ?? 0) - s.serverTime)));
    v.setUint16(o, cdLeft, true);
    o += 2;
    v.setUint16(o, stunLeft, true);
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
    v.setUint8(o++, (b.weapon ?? 0) & 0xff);
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
  for (const e of wireEvents) {
    const kindByte = EVENT_KIND[e.kind];
    v.setUint8(o++, kindByte !== undefined ? kindByte : 0);
    v.setUint8(o++, e.a & 0xff);
    v.setUint8(o++, e.b & 0xff);
    v.setFloat32(o, f32(e.x), true);
    o += 4;
    v.setFloat32(o, f32(e.y), true);
    o += 4;
    v.setUint16(o, (e.weaponId ?? 0) & 0xffff, true);
    o += 2;
    v.setFloat32(o, f32(e.angle ?? 0), true);
    o += 4;
  }
  v.setUint8(o++, nEn);
  for (let i = 0; i < nEn; i++) {
    const en = enemies[i]!;
    v.setUint8(o++, en.id & 0xff);
    v.setUint8(o++, ((en.type & 0x3) << 3) | (en.state & 0x7));
    v.setFloat32(o, f32(en.x), true);
    o += 4;
    v.setFloat32(o, f32(en.y), true);
    o += 4;
    v.setUint8(o++, Math.max(0, Math.min(255, en.hp | 0)));
  }
  v.setUint8(o++, (s.mode ?? 0) & 0xff);
  v.setUint8(o++, (s.wave ?? 0) & 0xff);
  v.setUint16(o, (s.waveLeft ?? 0) & 0xffff, true);
  o += 2;
  return buf;
}
export function decodeSnapshot(buf: ArrayBuffer): Snapshot | null {
  if (buf.byteLength < 23) return null;
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
  const doorsBits = v.getUint16(o, true);
  o += 2;
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
    const mag = v.getUint8(o++);
    const reserve = v.getUint8(o++);
    const ability = v.getUint8(o++);
    const cdLeft = v.getUint16(o, true);
    o += 2;
    const stunLeft = v.getUint16(o, true);
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
      mag,
      reserve,
      ability,
      abilityCdUntil: serverTime + cdLeft,
      stunnedUntil: serverTime + stunLeft,
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
    const weapon = v.getUint8(o++);
    bullets.push({ id, owner, x, y, px, py, vx, vy, weapon, life: 0 });
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
    const weaponId = v.getUint16(o, true);
    o += 2;
    const angle = v.getFloat32(o, true);
    o += 4;
    events.push({ kind, a, b, x, y, weaponId, angle });
  }
  const enemies: EnemySnap[] = [];
  let mode = 0;
  let wave = 0;
  let waveLeft = 0;
  if (o < buf.byteLength) {
    const nEn = v.getUint8(o++);
    for (let i = 0; i < nEn && o + ENEMY_BYTES <= buf.byteLength; i++) {
      const id = v.getUint8(o++);
      const packed = v.getUint8(o++);
      const type = (packed >> 3) & 0x3;
      const state = packed & 0x7;
      const ex = v.getFloat32(o, true);
      o += 4;
      const ey = v.getFloat32(o, true);
      o += 4;
      const hp = v.getUint8(o++);
      enemies.push({ id, type, x: ex, y: ey, hp, state });
    }
    if (o + 4 <= buf.byteLength) {
      mode = v.getUint8(o++);
      wave = v.getUint8(o++);
      waveLeft = v.getUint16(o, true);
      o += 2;
    }
  }
  return {
    tick,
    serverTime,
    matchLeftMs,
    phase,
    players,
    bullets,
    throwables,
    events,
    doorsBits,
    enemies,
    mode,
    wave,
    waveLeft,
  };
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
  const buf = new ArrayBuffer(5 + code.length);
  const v = new DataView(buf);
  v.setUint8(0, MSG.WELCOME);
  v.setUint8(1, w.selfId);
  v.setUint8(2, w.isHost ? 1 : 0);
  v.setUint8(3, code.length);
  new Uint8Array(buf, 4).set(code);
  v.setUint8(4 + code.length, (w.mode ?? 0) & 0xff);
  return buf;
}
export function decodeWelcome(buf: ArrayBuffer): WelcomeMsg | null {
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG.WELCOME) return null;
  const selfId = v.getUint8(1);
  const isHost = v.getUint8(2) === 1;
  const len = v.getUint8(3);
  const roomCode = new TextDecoder().decode(new Uint8Array(buf, 4, len));
  const mode = buf.byteLength > 4 + len ? v.getUint8(4 + len) : roomCode === "COOP" || roomCode === "SURVIVAL" ? 1 : 0;
  return { selfId, roomCode, isHost, mode };
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
