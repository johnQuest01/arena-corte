/**
 * Roundtrip: eventos giant* sobrevivem encode/decode e ficam no snap pra todos.
 * Run: npx tsx scripts/test-giant-events-wire.mjs
 */
import { encodeSnapshot, decodeSnapshot } from "../shared/protocol.ts";

let failed = 0;
function check(name, cond) {
  if (!cond) {
    failed++;
    console.error("FAIL:", name);
  } else {
    console.log("ok:", name);
  }
}

const player = {
  id: 1,
  x: 100,
  y: 200,
  angle: 0.5,
  vx: 0,
  vy: 0,
  hp: 100,
  kills: 0,
  alive: true,
  lastProcessedInputSeq: 0,
  fireCd: 0,
  weapon: 0,
  stamina: 100,
  mag: 30,
  reserve: 90,
  ability: 1,
  abilityCdUntil: 0,
  stunnedUntil: 0,
};

const snap = {
  tick: 42,
  serverTime: 1234.5,
  matchLeftMs: 60000,
  phase: 1,
  mode: 1,
  wave: 3,
  doorsBits: 0,
  players: [player],
  bullets: [],
  throwables: [],
  events: [
    { kind: "ability", a: 1, b: 1, x: 100, y: 200, angle: 0.5, weaponId: 1 },
    {
      kind: "giantSpawn",
      a: 7,
      b: 1,
      x: 128,
      y: 214,
      weaponId: ((0 & 3) << 8) | 2,
    },
    {
      kind: "giantHit",
      a: 7,
      b: 1,
      x: 300,
      y: 400,
      weaponId: ((0 & 3) << 8) | 2,
    },
    { kind: "giantExpire", a: 8, b: 2, x: 50, y: 60, weaponId: 3 },
    { kind: "death", a: 1, b: 2, x: 300, y: 400, weaponId: 0 },
  ],
  enemies: [
    { id: 7, type: 2, x: 128, y: 214, hp: 255, state: 1 },
    { id: 9, type: 2, x: 310, y: 410, hp: 0, state: 3 },
  ],
};

const out = decodeSnapshot(encodeSnapshot(snap));
check("decode ok", !!out);
const kinds = out?.events.map((e) => e.kind) ?? [];
for (const k of ["ability", "giantSpawn", "giantHit", "giantExpire", "death"]) {
  check(`event ${k}`, kinds.includes(k));
}
const spawn = out?.events.find((e) => e.kind === "giantSpawn");
check(
  "giantSpawn fields",
  !!spawn && spawn.a === 7 && spawn.b === 1 && Math.abs(spawn.x - 128) < 0.01,
);
const hit = out?.events.find((e) => e.kind === "giantHit");
const packed = hit?.weaponId ?? -1;
check("giantHit weaponId pack", ((packed >> 8) & 3) === 0 && (packed & 0xff) === 2);
const dying = out?.enemies?.find((e) => e.id === 9);
check("dying giant in enemy snap", !!dying && dying.type === 2 && dying.state === 3);

const flood = {
  ...snap,
  events: [
    ...Array.from({ length: 250 }, (_, i) => ({
      kind: "shot",
      a: 1,
      b: 0,
      x: i,
      y: i,
      weaponId: 0,
    })),
    { kind: "giantSpawn", a: 11, b: 1, x: 1, y: 2, weaponId: 0 },
    { kind: "giantHit", a: 11, b: 1, x: 3, y: 4, weaponId: 0 },
    { kind: "giantExpire", a: 12, b: 2, x: 5, y: 6, weaponId: 0 },
  ],
};
const out2 = decodeSnapshot(encodeSnapshot(flood));
const k2 = new Set(out2?.events.map((e) => e.kind) ?? []);
check(
  "giant* kept when nE > 255",
  k2.has("giantSpawn") && k2.has("giantHit") && k2.has("giantExpire"),
);

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all wire checks passed");
