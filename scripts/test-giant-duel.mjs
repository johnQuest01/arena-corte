import { createSim, addPlayer, queueInput, stepSim, startMatch } from "../shared/sim.ts";
import { spawnGiant, GIANT_LIFE_MS } from "../shared/enemies.ts";

let failed = 0;
function check(name, cond) {
  if (!cond) {
    failed++;
    console.error("FAIL:", name);
  } else console.log("ok:", name);
}

const sim = createSim();
sim.mode = 0;
const a = addPlayer(sim, "a");
const b = addPlayer(sim, "b");
startMatch(sim);
a.x = 300;
a.y = 400;
b.x = 500;
b.y = 400;
sim.serverTime = 1000;

const ctx = {
  serverTime: sim.serverTime,
  doorBits: 0,
  players: sim.players.map((p) => ({ id: p.id, x: p.x, y: p.y, alive: p.alive, hp: p.hp })),
  damagePlayer: () => {},
  emit: (ev) => sim.events.push({ ...ev }),
  resolveGiantTarget: () => null,
  executeGiantKill: () => {},
  findRivalGiant: () => null,
};

const gA = spawnGiant(
  sim.enemies,
  {
    x: 340,
    y: 400,
    ownerId: a.id,
    targetId: b.id,
    targetKind: 0,
    expiresAt: sim.serverTime + GIANT_LIFE_MS,
    doorBits: 0,
  },
  ctx,
);
const gB = spawnGiant(
  sim.enemies,
  {
    x: 460,
    y: 400,
    ownerId: b.id,
    targetId: a.id,
    targetKind: 0,
    expiresAt: sim.serverTime + GIANT_LIFE_MS,
    doorBits: 0,
  },
  ctx,
);

check("two giants spawned", gA.type === 2 && gB.type === 2);

let frames = 0;
for (; frames < 400; frames++) {
  stepSim(sim, 1 / 30);
  const alive = sim.enemies.filter((e) => e.type === 2 && e.state !== 3);
  if (alive.length < 2) break;
}

const aliveGiants = sim.enemies.filter((e) => e.type === 2 && e.state !== 3);
const deadGiants = sim.enemies.filter((e) => e.type === 2 && e.state === 3);
const hits = sim.events.filter((e) => e.kind === "giantHit").length;

check("duel happened (hit or one dead)", hits >= 1 || deadGiants.length >= 1 || aliveGiants.length <= 1);
check("not both immortal forever", frames < 400);
check("ambos mortos no duelo", aliveGiants.length === 0);

// ambos invocam via Q e brigam
const sim2 = createSim();
sim2.mode = 0;
const p1 = addPlayer(sim2, "p1");
const p2 = addPlayer(sim2, "p2");
startMatch(sim2);
p1.x = 350;
p1.y = 400;
p1.angle = 0;
p1.ability = 1;
p2.x = 550;
p2.y = 400;
p2.angle = Math.PI;
p2.ability = 1;

queueInput(sim2, p1.id, {
  seq: 1,
  dx: 0,
  dy: 0,
  aim: 0,
  fire: false,
  sprint: false,
  use: false,
  reload: false,
  cast: true,
  weapon: 0,
  throw: 0,
  ability: 1,
  clientTime: 0,
});
queueInput(sim2, p2.id, {
  seq: 1,
  dx: 0,
  dy: 0,
  aim: Math.PI,
  fire: false,
  sprint: false,
  use: false,
  reload: false,
  cast: true,
  weapon: 0,
  throw: 0,
  ability: 1,
  clientTime: 0,
});
stepSim(sim2, 1 / 30);
check(
  "both cast giants",
  sim2.enemies.filter((e) => e.type === 2).length >= 2,
);

let duelKill = false;
for (let i = 0; i < 400; i++) {
  stepSim(sim2, 1 / 30);
  if (sim2.events.some((e) => e.kind === "giantHit")) duelKill = true;
  const living = sim2.enemies.filter((e) => e.type === 2 && e.state !== 3);
  if (living.length <= 1 && duelKill) break;
}
check("cast duel produces giantHit", duelKill);

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("OK — duelo de Gigantes");
