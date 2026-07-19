import { createSim, addPlayer, queueInput, stepSim, startMatch } from "../shared/sim.ts";

let failed = 0;
function check(name, cond) {
  if (!cond) {
    failed++;
    console.error("FAIL:", name);
  } else console.log("ok:", name);
}

function runCase(label, ox, oy, tx, ty, expectDxSign, expectDySign) {
  const sim = createSim();
  sim.mode = 0;
  const a = addPlayer(sim, "caster");
  const b = addPlayer(sim, "victim");
  startMatch(sim);
  a.x = ox;
  a.y = oy;
  a.angle = Math.atan2(ty - oy, tx - ox);
  a.ability = 1;
  b.x = tx;
  b.y = ty;
  const bx0 = b.x;
  const by0 = b.y;
  queueInput(sim, a.id, {
    seq: 1,
    dx: 0,
    dy: 0,
    aim: a.angle,
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
  let hit = false;
  for (let i = 0; i < 250; i++) {
    stepSim(sim, 1 / 30);
    if (sim.events.some((e) => e.kind === "giantHit")) {
      hit = true;
      break;
    }
  }
  const dx = b.x - bx0;
  const dy = b.y - by0;
  const okX = expectDxSign === 0 ? Math.abs(dx) < 120 : Math.sign(dx) === expectDxSign && Math.abs(dx) > 30;
  const okY = expectDySign === 0 ? Math.abs(dy) < 120 : Math.sign(dy) === expectDySign && Math.abs(dy) > 30;
  check(`${label} hit`, hit && !b.alive);
  check(`${label} fly dir dx=${Math.round(dx)} dy=${Math.round(dy)}`, okX && okY);
}

// Gigante vem da esquerda → vítima voa pra direita (+X)
runCase("from-left", 200, 400, 300, 400, 1, 0);
// Gigante vem de cima → vítima voa pra baixo (+Y)
runCase("from-top", 400, 200, 400, 300, 0, 1);

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("OK — knockback do Gigante");
