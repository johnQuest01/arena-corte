/**
 * Smoke: hold-fire com Gigante equipado ainda gasta munição e gera shot.
 * Run: npx tsx scripts/test-fire.mjs
 */
import { createSim, addPlayer, queueInput, stepSim, startMatch } from "../shared/sim.ts";
import { encodeInput, decodeInput } from "../shared/protocol.ts";

let failed = 0;
function check(name, cond) {
  if (!cond) {
    failed++;
    console.error("FAIL:", name);
  } else {
    console.log("ok:", name);
  }
}

const sim = createSim(0);
addPlayer(sim, "A");
addPlayer(sim, "B");
startMatch(sim);
const shooter = sim.players[0];
shooter.x = 200;
shooter.y = 200;
sim.players[1].x = 400;
sim.players[1].y = 200;

const probe = decodeInput(
  encodeInput({
    seq: 1,
    dx: 0,
    dy: 0,
    aim: 0,
    fire: true,
    sprint: false,
    use: false,
    reload: false,
    cast: false,
    weapon: 0,
    throw: 0,
    ability: 1,
    clientTime: 0,
  }),
);
check("wire fire", !!probe?.fire);
check("wire weapon", probe?.weapon === 0);
check("wire ability", probe?.ability === 1);

let shots = 0;
for (let i = 0; i < 40; i++) {
  const input = {
    seq: i + 1,
    dx: 0,
    dy: 0,
    aim: 0,
    fire: true,
    sprint: false,
    use: false,
    reload: false,
    cast: false,
    weapon: 0,
    throw: 0,
    ability: 1,
    clientTime: i * 50,
  };
  const round = decodeInput(encodeInput(input));
  queueInput(sim, shooter.id, round);
  queueInput(sim, sim.players[1].id, {
    ...input,
    seq: i + 1,
    fire: false,
    aim: Math.PI,
    ability: 0,
  });
  stepSim(sim, 1 / 20, null);
  shots += sim.events.filter((e) => e.kind === "shot" && e.a === shooter.id).length;
}

check("shots fired", shots >= 5);
check("mag decreased", shooter.mag < 12);
check("ability kept", shooter.ability === 1);
check("not stunned", (shooter.stunnedUntil ?? 0) <= sim.serverTime);

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("OK — fire pipeline", { shots, mag: shooter.mag, ability: shooter.ability });
