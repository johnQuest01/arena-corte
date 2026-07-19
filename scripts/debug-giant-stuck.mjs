import { createSim, addPlayer, queueInput, stepSim, startMatch } from "../shared/sim.ts";
import { ARENA_W, ARENA_H } from "../shared/constants.ts";

const sim = createSim(0);
addPlayer(sim, "A");
addPlayer(sim, "B");
startMatch(sim);
const a = sim.players[0];
const b = sim.players[1];
// player A in open, B far / maybe hard to reach
a.x = 120;
a.y = 120;
a.angle = Math.atan2(400, 400);
a.ability = 1;
b.x = 820;
b.y = 520;

queueInput(sim, a.id, {
  seq: 1, dx: 0, dy: 0, aim: a.angle, fire: false, sprint: false,
  use: false, reload: false, cast: true, weapon: 0, throw: 0, ability: 1, clientTime: 0,
});
stepSim(sim, 1 / 30);

let reason = "alive";
for (let i = 0; i < 400; i++) {
  stepSim(sim, 1 / 30);
  const g = sim.enemies.find((e) => e.type === 2 && e.state !== 3);
  const hit = sim.events.some((e) => e.kind === "giantHit");
  const exp = sim.events.some((e) => e.kind === "giantExpire");
  if (hit) {
    reason = `hit@${i} t=${Math.round(sim.serverTime)}`;
    break;
  }
  if (exp || !g) {
    const ev = sim.events.find((e) => e.kind === "giantExpire" || e.kind === "giantHit");
    reason = `vanish@${i} t=${Math.round(sim.serverTime)} kind=${ev?.kind} lifeMs=${GIANT()}`;
    console.log("last giant", g);
    break;
  }
}
function GIANT() {
  return Math.round(sim.serverTime);
}
console.log({ reason, bAlive: b.alive, arena: [ARENA_W, ARENA_H] });

// caso 2: alvo some (morer) enquanto gigante anda
const sim2 = createSim(0);
addPlayer(sim2, "A");
addPlayer(sim2, "B");
startMatch(sim2);
const a2 = sim2.players[0];
const b2 = sim2.players[1];
a2.x = 200; a2.y = 300; a2.angle = 0; a2.ability = 1;
b2.x = 600; b2.y = 300;
queueInput(sim2, a2.id, {
  seq: 1, dx: 0, dy: 0, aim: 0, fire: false, sprint: false,
  use: false, reload: false, cast: true, weapon: 0, throw: 0, ability: 1, clientTime: 0,
});
stepSim(sim2, 1 / 30);
for (let i = 0; i < 20; i++) stepSim(sim2, 1 / 30);
b2.alive = false;
b2.hp = 0;
let r2 = "alive";
for (let i = 0; i < 40; i++) {
  stepSim(sim2, 1 / 30);
  const g = sim2.enemies.find((e) => e.type === 2 && e.state !== 3);
  if (!g) {
    r2 = `gone after death@${i} events=${sim2.events.map((e) => e.kind).filter((k) => k.startsWith("giant"))}`;
    break;
  }
}
console.log("target dies mid chase:", r2);

// caso 3: alvo morre, existe outro vivo → deve retargetar
const sim3 = createSim(0);
addPlayer(sim3, "A");
addPlayer(sim3, "B");
addPlayer(sim3, "C");
startMatch(sim3);
const a3 = sim3.players[0];
const b3 = sim3.players[1];
const c3 = sim3.players[2];
a3.x = 200; a3.y = 300; a3.angle = 0; a3.ability = 1;
b3.x = 500; b3.y = 300;
c3.x = 450; c3.y = 360;
queueInput(sim3, a3.id, {
  seq: 1, dx: 0, dy: 0, aim: 0, fire: false, sprint: false,
  use: false, reload: false, cast: true, weapon: 0, throw: 0, ability: 1, clientTime: 0,
});
stepSim(sim3, 1 / 30);
const g0 = sim3.enemies.find((e) => e.type === 2);
const locked = g0?.targetId;
for (let i = 0; i < 15; i++) stepSim(sim3, 1 / 30);
const victim = sim3.players.find((p) => p.id === locked);
if (victim) {
  victim.alive = false;
  victim.hp = 0;
}
let retargeted = false;
for (let i = 0; i < 30; i++) {
  stepSim(sim3, 1 / 30);
  const g = sim3.enemies.find((e) => e.type === 2 && e.state !== 3);
  if (g && g.targetId !== locked && g.targetId !== a3.id) {
    retargeted = true;
    console.log("retarget ok", { from: locked, to: g.targetId, kind: g.targetKind });
    break;
  }
  if (!g) {
    console.log("FAIL vanished instead of retarget");
    break;
  }
}
console.log({ retargeted });
