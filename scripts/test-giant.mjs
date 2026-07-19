/**
 * Smoke test: Invocar Gigante (PvP hit + expire + coop).
 * Run: npx tsx scripts/test-giant.mjs
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

function castGiant(sim, playerId, seq, aim = 0) {
  queueInput(sim, playerId, {
    seq,
    dx: 0,
    dy: 0,
    aim,
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
}

const enc = encodeInput({
  seq: 1,
  dx: 0,
  dy: 0,
  aim: 0,
  fire: false,
  sprint: false,
  use: false,
  reload: false,
  cast: false,
  weapon: 3,
  throw: 0,
  ability: 1,
  clientTime: 1,
});
const dec = decodeInput(enc);
check("ability pad roundtrip", dec?.ability === 1);
check("weapon intact", dec?.weapon === 3);

// --- hit ---
const sim = createSim();
sim.mode = 0;
const a = addPlayer(sim, "caster");
const b = addPlayer(sim, "victim");
startMatch(sim);
a.x = 200;
a.y = 200;
a.angle = 0;
a.ability = 1;
b.x = 260;
b.y = 200;

castGiant(sim, a.id, 1, 0);
stepSim(sim, 1 / 30);
const giants = sim.enemies.filter((e) => e.type === 2);
check("spawned giant", giants.length === 1);
check("locked victim", giants[0]?.targetId === b.id);
check("owner", giants[0]?.ownerId === a.id);
check("cd spent", a.abilityCdUntil > sim.serverTime);

let hit = false;
for (let i = 0; i < 400; i++) {
  stepSim(sim, 1 / 30);
  if (sim.events.some((e) => e.kind === "giantHit")) {
    hit = true;
    break;
  }
}
check("giantHit", hit);
check("victim dead", !b.alive);
check("kill credited", a.kills >= 1);
check("giant removed after hit", sim.enemies.every((e) => e.type !== 2));

// --- no target ---
const sim0 = createSim();
sim0.mode = 0;
sim0.phase = 1;
const solo = addPlayer(sim0, "solo");
solo.ability = 1;
solo.abilityCdUntil = 0;
castGiant(sim0, solo.id, 1, 0);
stepSim(sim0, 1 / 30);
check("no spawn alone", sim0.enemies.filter((e) => e.type === 2).length === 0);
check("no cd without target", solo.abilityCdUntil === 0);

// --- expire ---
const sim2 = createSim();
sim2.mode = 0;
const c = addPlayer(sim2, "c");
const d = addPlayer(sim2, "d");
startMatch(sim2);
c.x = 200;
c.y = 200;
c.angle = 0;
c.ability = 1;
d.x = 900;
d.y = 900;
castGiant(sim2, c.id, 1, 0);
stepSim(sim2, 1 / 30);
const gExp = sim2.enemies.find((e) => e.type === 2);
check("spawned for expire", !!gExp);
if (gExp) gExp.expiresAt = sim2.serverTime + 400;
let sawExpire = false;
for (let i = 0; i < 40; i++) {
  stepSim(sim2, 1 / 30);
  if (sim2.events.some((e) => e.kind === "giantExpire")) sawExpire = true;
}
check("giantExpire", sawExpire);
check("escaped alive", d.alive);
check("giant gone after expire", sim2.enemies.every((e) => e.type !== 2));

// --- coop: zumbi na mira ---
const sim3 = createSim();
sim3.mode = 1;
const p = addPlayer(sim3, "p");
startMatch(sim3);
p.x = 400;
p.y = 400;
p.angle = 0;
p.ability = 1;
sim3.enemies.push({
  id: 99,
  type: 0,
  x: 460,
  y: 400,
  vx: 0,
  vy: 0,
  hp: 65,
  state: 1,
  targetId: p.id,
  targetKind: 0,
  ownerId: -1,
  expiresAt: 0,
  missTargetMs: 0,
  timer: 0,
  retargetAt: 1e12,
  chargeX: 0,
  chargeY: 0,
  slideX: 0,
  slideY: 0,
  slideUntil: 0,
  stuck: 0,
  lastX: 460,
  lastY: 400,
});
castGiant(sim3, p.id, 1, 0);
stepSim(sim3, 1 / 30);
const g3 = sim3.enemies.find((e) => e.type === 2);
check("coop locks zombie", g3?.targetKind === 1 && g3?.targetId === 99);
check("owner not target", g3?.ownerId === p.id && g3?.targetId !== p.id);

// --- coop: bot na mira (mesmo com zumbi perto atrás) ---
const sim3b = createSim();
sim3b.mode = 1;
const p2 = addPlayer(sim3b, "p2");
const botAlly = addPlayer(sim3b, "bot");
startMatch(sim3b);
p2.x = 400;
p2.y = 400;
p2.angle = 0;
p2.ability = 1;
botAlly.x = 520;
botAlly.y = 400;
sim3b.enemies.push({
  id: 88,
  type: 0,
  x: 360,
  y: 400,
  vx: 0,
  vy: 0,
  hp: 65,
  state: 1,
  targetId: p2.id,
  targetKind: 0,
  ownerId: -1,
  expiresAt: 0,
  missTargetMs: 0,
  timer: 0,
  retargetAt: 1e12,
  chargeX: 0,
  chargeY: 0,
  slideX: 0,
  slideY: 0,
  slideUntil: 0,
  stuck: 0,
  lastX: 360,
  lastY: 400,
});
castGiant(sim3b, p2.id, 1, 0);
stepSim(sim3b, 1 / 30);
const g3b = sim3b.enemies.find((e) => e.type === 2);
check("coop can hunt bot", g3b?.targetKind === 0 && g3b?.targetId === botAlly.id);

// --- coop: mira no bot com CHEFE também no cone → deve ir no bot ---
const sim3c = createSim();
sim3c.mode = 1;
const p3 = addPlayer(sim3c, "p3");
const bot2 = addPlayer(sim3c, "bot2");
startMatch(sim3c);
p3.x = 400;
p3.y = 400;
p3.angle = 0;
p3.ability = 1;
bot2.x = 480;
bot2.y = 410; // ligeiramente fora do centro
sim3c.enemies.push({
  id: 77,
  type: 1, // brutamontes
  x: 700,
  y: 400, // bem alinhado na mira, mais longe
  vx: 0,
  vy: 0,
  hp: 2200,
  state: 1,
  targetId: p3.id,
  targetKind: 0,
  ownerId: -1,
  expiresAt: 0,
  missTargetMs: 0,
  timer: 0,
  retargetAt: 1e12,
  chargeX: 0,
  chargeY: 0,
  slideX: 0,
  slideY: 0,
  slideUntil: 0,
  stuck: 0,
  lastX: 700,
  lastY: 400,
});
castGiant(sim3c, p3.id, 1, 0);
stepSim(sim3c, 1 / 30);
const g3c = sim3c.enemies.find((e) => e.type === 2);
check("coop prefer bot over boss in cone", g3c?.targetKind === 0 && g3c?.targetId === bot2.id);

// --- alvo morre → Gigante RETARGETA outro vivo (não some do nada) ---
const sim4 = createSim();
sim4.mode = 0;
const e1 = addPlayer(sim4, "e1");
const e2 = addPlayer(sim4, "e2");
const e3 = addPlayer(sim4, "e3");
startMatch(sim4);
e1.x = 200;
e1.y = 200;
e1.angle = 0;
e1.ability = 1;
e2.x = 300;
e2.y = 200;
e3.x = 780; // longe — tempo pra observar retarget sem hit imediato
e3.y = 200;
castGiant(sim4, e1.id, 1, 0);
stepSim(sim4, 1 / 30);
const g4 = sim4.enemies.find((en) => en.type === 2);
const locked = g4?.targetId;
check("locked someone", locked === e2.id || locked === e3.id);
const victim = sim4.players.find((pl) => pl.id === locked);
if (victim) {
  victim.alive = false;
  victim.hp = 0;
}
let retargeted = false;
let silentExpire = false;
for (let i = 0; i < 25; i++) {
  stepSim(sim4, 1 / 30);
  const g = sim4.enemies.find((en) => en.type === 2 && en.state !== 3);
  if (g && g.targetId !== locked) retargeted = true;
  if (sim4.events.some((ev) => ev.kind === "giantExpire")) silentExpire = true;
}
check("retarget when target dies", retargeted);
check("no silent expire on retarget", !silentExpire);

// --- prefer mira (cone) over nearer behind ---
const sim5 = createSim();
sim5.mode = 0;
const f1 = addPlayer(sim5, "f1");
const nearBehind = addPlayer(sim5, "near");
const farFront = addPlayer(sim5, "far");
startMatch(sim5);
f1.x = 400;
f1.y = 400;
f1.angle = 0;
f1.ability = 1;
nearBehind.x = 370;
nearBehind.y = 400; // atrás (mais perto)
farFront.x = 560;
farFront.y = 405; // na mira
castGiant(sim5, f1.id, 1, 0);
stepSim(sim5, 1 / 30);
const g5 = sim5.enemies.find((en) => en.type === 2);
check("prefer aim over nearest behind", g5?.targetId === farFront.id);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("OK — todos os asserts do Gigante passaram");
