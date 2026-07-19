/**
 * Reproduz Gigante que anda e some sem hit.
 * Run: npx tsx scripts/debug-giant-vanish.mjs
 */
import { createSim, addPlayer, queueInput, stepSim, startMatch } from "../shared/sim.ts";
import { GIANT_LIFE_MS } from "../shared/enemies.ts";

const sim = createSim(0);
addPlayer(sim, "A");
addPlayer(sim, "B");
startMatch(sim);
const a = sim.players[0];
const b = sim.players[1];
a.x = 200;
a.y = 300;
a.angle = 0;
a.ability = 1;
b.x = 520;
b.y = 300;

queueInput(sim, a.id, {
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
console.log("spawn", {
  id: g?.id,
  targetId: g?.targetId,
  targetKind: g?.targetKind,
  expiresAt: g?.expiresAt,
  serverTime: sim.serverTime,
  lifeLeft: g ? g.expiresAt - sim.serverTime : null,
  GIANT_LIFE_MS,
});

const log = [];
for (let i = 0; i < 300; i++) {
  // alvo foge um pouco
  b.x += 2;
  stepSim(sim, 1 / 30);
  g = sim.enemies.find((e) => e.type === 2 && e.state !== 3);
  const expire = sim.events.filter((e) => e.kind === "giantExpire");
  const hit = sim.events.filter((e) => e.kind === "giantHit");
  if (expire.length || hit.length || !g) {
    log.push({
      tick: i,
      t: Math.round(sim.serverTime),
      gone: !g,
      expire: expire.map((e) => ({ a: e.a, weaponId: e.weaponId })),
      hit: hit.length,
      giant: g
        ? {
            x: Math.round(g.x),
            y: Math.round(g.y),
            state: g.state,
            miss: g.missTargetMs,
            dist: Math.round(Math.hypot(b.x - g.x, b.y - g.y)),
          }
        : null,
      bAlive: b.alive,
    });
    if (!g) break;
  }
}

console.log("events", log.slice(0, 20));
console.log("last", log[log.length - 1]);
console.log("totalTicks", log.length ? log[log.length - 1].tick : "still alive 300");
