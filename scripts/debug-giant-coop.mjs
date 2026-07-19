import { writeFileSync } from "fs";
import { createSim, addPlayer, queueInput, stepSim, startMatch } from "../shared/sim.ts";

const lines = [];
const log = (...a) =>
  lines.push(a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" "));

const sim = createSim();
sim.mode = 1;
const human = addPlayer(sim, "human");
const bot1 = addPlayer(sim, "bot1");
startMatch(sim);
human.x = 400;
human.y = 400;
human.angle = 0;
human.ability = 1;
bot1.x = 480;
bot1.y = 400;

// zombie perto na mira
sim.enemies.push({
  id: 50,
  type: 0,
  x: 520,
  y: 400,
  vx: 0,
  vy: 0,
  hp: 65,
  state: 1,
  targetId: human.id,
  targetKind: 0,
  ownerId: -1,
  expiresAt: 0,
  timer: 0,
  retargetAt: 1e12,
  chargeX: 0,
  chargeY: 0,
  slideX: 0,
  slideY: 0,
  slideUntil: 0,
  stuck: 0,
  lastX: 520,
  lastY: 400,
});

queueInput(sim, human.id, {
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
stepSim(sim, 1 / 30);
const g = sim.enemies.find((e) => e.type === 2);
log("coop spawn target", {
  targetId: g?.targetId,
  targetKind: g?.targetKind,
  // kind 1 = enemy, kind 0 = player — se for 0 bot, errado pra coop
});

// matar zumbi imediatamente → gigante deve expirar
const z = sim.enemies.find((e) => e.id === 50);
if (z) {
  z.hp = 0;
  z.state = 3;
  z.alive = false;
}
for (let i = 0; i < 5; i++) stepSim(sim, 1 / 30);
log("after zombie dead", {
  giants: sim.enemies.filter((e) => e.type === 2).length,
  botAlive: bot1.alive,
  events: sim.events.filter((e) => String(e.kind).startsWith("giant")).map((e) => e.kind),
});

// PvP sem bots vivos perto — alvo longe, deve durar ~8s
const sim2 = createSim();
sim2.mode = 0;
const h = addPlayer(sim2, "h");
const b = addPlayer(sim2, "b");
startMatch(sim2);
h.x = 200;
h.y = 200;
h.angle = 0;
h.ability = 1;
b.x = 900;
b.y = 900;
// bot fica parado (sem drive)
queueInput(sim2, h.id, {
  seq: 1,
  dx: 0,
  dy: 0,
  aim: Math.atan2(700, 700),
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
let g2 = sim2.enemies.find((e) => e.type === 2);
log("far spawn life", g2?.expiresAt - sim2.serverTime);
let expiredAt = null;
for (let i = 0; i < 400; i++) {
  stepSim(sim2, 1 / 30);
  if (sim2.events.some((e) => e.kind === "giantExpire")) {
    expiredAt = sim2.serverTime;
    break;
  }
  g2 = sim2.enemies.find((e) => e.type === 2);
  if (!g2 && !expiredAt) {
    expiredAt = sim2.serverTime;
    break;
  }
}
log("far result", {
  expiredAt: expiredAt && Math.round(expiredAt),
  duration: expiredAt && Math.round(expiredAt - 33),
  botAlive: b.alive,
  hit: sim2.events.some((e) => e.kind === "giantHit"),
});

writeFileSync("scripts/giant-coop-debug.txt", lines.join("\n"));
console.log(lines.join("\n"));
