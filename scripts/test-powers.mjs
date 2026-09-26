/**
 * Smoke: poderes novos — Escudo Bumerangue (9), Raio em Cadeia (10), Passo Sombrio (11).
 * Run: npx tsx scripts/test-powers.mjs
 */
import { createSim, addPlayer, queueInput, stepSim, startMatch, toSnapshot } from "../shared/sim.ts";
import { hitsSolid, SOLID, TILE, MAP_W } from "../shared/map.ts";
import {
  BLINK_RANGE,
  CHAIN_SEGMENT_BASE,
  SHIELD_THROW_KIND,
  performBlink,
} from "../shared/abilities.ts";

let failed = 0;
function check(name, cond, extra) {
  if (!cond) {
    failed++;
    console.error("FAIL:", name, extra ?? "");
  } else {
    console.log("ok:", name);
  }
}

/** Acha uma faixa horizontal livre de ~24 tiles (y fixo). */
function openRow() {
  for (let ty = 2; ty < 118; ty++) {
    for (let tx = 2; tx < MAP_W - 30; tx++) {
      let free = true;
      for (let k = 0; k < 24 && free; k++) {
        for (let dy = -2; dy <= 2 && free; dy++) {
          if ((SOLID[ty + dy]?.[tx + k] ?? 10) >= 10) free = false;
        }
      }
      if (free) return { x: tx * TILE, y: ty * TILE + 16 };
    }
  }
  throw new Error("sem faixa livre");
}

let seq = 1;
function input(sim, id, over) {
  queueInput(sim, id, {
    seq: seq++,
    dx: 0,
    dy: 0,
    aim: 0,
    fire: false,
    sprint: false,
    use: false,
    reload: false,
    cast: false,
    weapon: 0,
    throw: 0,
    ability: 0,
    clientTime: 0,
    ...over,
  });
}

function setup(n) {
  const sim = createSim();
  for (let i = 0; i < n; i++) addPlayer(sim, `p${i}`);
  startMatch(sim);
  const row = openRow();
  sim.players.forEach((p, i) => {
    p.x = row.x + 40 + i * 200;
    p.y = row.y;
    p.vx = 0;
    p.vy = 0;
    p.angle = 0;
  });
  return { sim, row };
}

// ---------- Escudo Bumerangue ----------
{
  const { sim } = setup(2);
  const [a, b] = sim.players;
  input(sim, a.id, { cast: true, ability: 9, aim: 0 });
  let sawThrow = false;
  let hit = false;
  let back = false;
  for (let i = 0; i < 150; i++) {
    input(sim, b.id, { aim: Math.PI });
    stepSim(sim);
    const snap = toSnapshot(sim);
    if (snap.throwables.some((t) => t.kind === SHIELD_THROW_KIND && t.owner === a.id)) sawThrow = true;
    for (const e of sim.events) {
      if (e.kind === "hit" && e.a === a.id && e.b === b.id && e.weaponId === 105) hit = true;
      if (e.kind === "ability" && e.b === 9 && e.weaponId === 9001) back = true;
    }
    if (back) break;
  }
  check("escudo no snapshot (kind 7)", sawThrow);
  check("escudo acerta o alvo (causa 105)", hit && b.hp < 100, { hp: b.hp });
  check("escudo volta pro dono", back);
  check("escudo some depois de voltar", sim.shieldThrows.length === 0);
  check("CD do escudo aplicado", a.abilityCdUntil > sim.serverTime);
}

// ---------- Escudo Estelar erguido rebate o arremesso ----------
{
  const { sim } = setup(2);
  const [a, b] = sim.players;
  b.ability = 4;
  input(sim, b.id, { cast: true, ability: 4, aim: Math.PI });
  stepSim(sim);
  input(sim, a.id, { cast: true, ability: 9, aim: 0 });
  let blocked = false;
  for (let i = 0; i < 40; i++) {
    input(sim, b.id, { aim: Math.PI, ability: 4 });
    stepSim(sim);
    for (const e of sim.events) if (e.kind === "hit" && e.b === 253 && e.weaponId === 9) blocked = true;
  }
  check("escudo erguido rebate o bumerangue", blocked && b.hp === 100, { hp: b.hp });
}

// ---------- Raio em Cadeia ----------
{
  const { sim } = setup(3);
  const [a, b, c] = sim.players;
  // c perto de b (salto)
  c.x = b.x + 120;
  c.y = b.y;
  input(sim, a.id, { cast: true, ability: 10, aim: 0 });
  stepSim(sim);
  const segs = sim.events.filter((e) => e.kind === "ability" && e.b === 10 && (e.weaponId ?? 0) >= CHAIN_SEGMENT_BASE);
  check("raio gera 2 segmentos (alvo + salto)", segs.length === 2, { n: segs.length });
  check("raio fere o 1º e o 2º", b.hp < 100 && c.hp < 100 && b.hp < c.hp, { b: b.hp, c: c.hp });
  check("raio dá mini-stun", b.stunnedUntil > sim.serverTime);
  check("segmento tem destino (x2/y2)", segs[0] && Math.abs((segs[0].x2 ?? 0) - b.x) < 2);
}

// ---------- Raio sem alvo: segmento "no vazio" ----------
{
  const { sim } = setup(2);
  const [a] = sim.players;
  input(sim, a.id, { cast: true, ability: 10, aim: Math.PI }); // mira pro lado oposto
  stepSim(sim);
  const segs = sim.events.filter((e) => e.kind === "ability" && e.b === 10 && (e.weaponId ?? 0) >= CHAIN_SEGMENT_BASE);
  check("raio sem alvo ainda desenha 1 segmento", segs.length === 1);
}

// ---------- Passo Sombrio ----------
{
  // PvP precisa de 2 na sala pra iniciar; o 2º fica longe da linha
  const { sim } = setup(2);
  const [a, far] = sim.players;
  far.y += 400;
  const x0 = a.x;
  input(sim, a.id, { cast: true, ability: 11, aim: 0 });
  stepSim(sim);
  const moved = a.x - x0;
  check("teleporte anda ~o alcance", moved > BLINK_RANGE - 20 && moved <= BLINK_RANGE + 1, { moved });
  check("teleporte gera evento com origem/destino", sim.events.some((e) => e.kind === "ability" && e.b === 11 && Math.abs((e.x2 ?? 0) - a.x) < 1));
  const x1 = a.x;
  input(sim, a.id, { cast: true, ability: 11, aim: 0 });
  stepSim(sim);
  check("teleporte respeita CD", Math.abs(a.x - x1) < 5);
}

// ---------- Passo Sombrio não atravessa parede ----------
{
  // player colado numa parede (borda do mapa, x=0 é muro)
  const p = { x: 60, y: 900, vx: 0, vy: 0, angle: Math.PI, abilityCdUntil: 0 };
  const r = performBlink(p, 1000, Math.PI, 0, hitsSolid);
  check("sem espaço = não teleporta (não gasta CD)", r === null && p.abilityCdUntil === 0);
  const q = { x: 400, y: 900, vx: 0, vy: 0, angle: Math.PI, abilityCdUntil: 0 };
  const r2 = performBlink(q, 1000, Math.PI, 0, hitsSolid);
  check("para antes do muro", r2 && q.x > 32 && !hitsSolid(q.x, q.y, 14, 0), { x: q.x });
}

if (failed) {
  console.error(`${failed} falha(s)`);
  process.exit(1);
}
console.log("OK — poderes novos");
