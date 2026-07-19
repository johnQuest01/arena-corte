import { writeFileSync } from "fs";
import { createSim, addPlayer, queueInput, stepSim, startMatch, doorBitsOf } from "../shared/sim.ts";
import { botInput } from "../client/src/net/botAi.ts";

const lines = [];
const log = (...a) =>
  lines.push(a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" "));

const sim = createSim();
sim.mode = 0;
const human = addPlayer(sim, "human");
const bot1 = addPlayer(sim, "bot1");
const bot2 = addPlayer(sim, "bot2");
startMatch(sim);
human.x = 400;
human.y = 400;
human.angle = 0;
human.ability = 1;
bot1.x = 480;
bot1.y = 400;
bot2.x = 400;
bot2.y = 500;

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
let g = sim.enemies.find((e) => e.type === 2);
log("spawn", {
  g: g && {
    id: g.id,
    targetId: g.targetId,
    targetKind: g.targetKind,
    expiresAt: g.expiresAt,
    serverTime: sim.serverTime,
    lifeLeft: g.expiresAt - sim.serverTime,
    x: g.x,
    y: g.y,
  },
  bots: [
    { id: bot1.id, x: bot1.x, y: bot1.y, alive: bot1.alive },
    { id: bot2.id, x: bot2.x, y: bot2.y, alive: bot2.alive },
  ],
});

const events = [];
for (let i = 0; i < 300; i++) {
  for (const p of [bot1, bot2]) {
    if (!p.alive) continue;
    const input = botInput(p, human, doorBitsOf(sim), sim.tick * 10 + p.id, sim.serverTime, undefined);
    queueInput(sim, p.id, input);
  }
  stepSim(sim, 1 / 30);
  for (const e of sim.events) {
    if (String(e.kind).startsWith("giant") || e.kind === "death") {
      events.push({ t: Math.round(sim.serverTime), kind: e.kind, a: e.a, b: e.b });
    }
  }
  g = sim.enemies.find((e) => e.type === 2);
  if (!g) {
    log("gone at", Math.round(sim.serverTime), "frame", i);
    break;
  }
  if (i % 30 === 0) {
    log("t", Math.round(sim.serverTime), {
      gx: Math.round(g.x),
      gy: Math.round(g.y),
      state: g.state,
      life: Math.round(g.expiresAt - sim.serverTime),
      b1: { x: Math.round(bot1.x), y: Math.round(bot1.y), alive: bot1.alive },
    });
  }
}
log("end", {
  serverTime: Math.round(sim.serverTime),
  bot1: { alive: bot1.alive, hp: bot1.hp },
  bot2: { alive: bot2.alive, hp: bot2.hp },
  humanKills: human.kills,
  events,
});
writeFileSync("scripts/giant-bot-debug.txt", lines.join("\n"));
console.log(lines.join("\n"));
