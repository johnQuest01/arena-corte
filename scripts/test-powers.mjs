/**
 * Smoke: poderes novos — Escudo Bumerangue (9), Raio em Cadeia (10), Passo Sombrio (11).
 * Run: npx tsx scripts/test-powers.mjs
 */
import { createSim, addPlayer, queueInput, stepSim, startMatch, toSnapshot } from "../shared/sim.ts";
import { hitsSolid, isSolidTile, SOLID, TILE, MAP_W, MAP_H } from "../shared/map.ts";
import { PLAYER_R } from "../shared/constants.ts";
import {
  BLINK_MIN,
  BLINK_RANGE,
  CHAIN_SEGMENT_BASE,
  SHIELD_THROW_DMG,
  SHIELD_THROW_KIND,
  SHIELD_THROW_SPEED,
  TOTEM_RADIUS,
  performBlink,
} from "../shared/abilities.ts";
import { PredictionBuffer } from "../client/src/net/prediction.ts";
import { createSmooth, reconcile } from "../client/src/net/reconciliation.ts";

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

/**
 * Parede com a face de baixo livre: `run` tiles sólidos na linha ty e área
 * aberta (w x h tiles) logo abaixo. Devolve a linha do pé encostado nela.
 */
function wallWithOpenSouth(run, w, h) {
  for (let ty = 0; ty < MAP_H - h - 2; ty++) {
    for (let tx = 1; tx + Math.max(run, w) < MAP_W - 1; tx++) {
      let ok = true;
      for (let k = 0; k < run && ok; k++) if (!isSolidTile(SOLID[ty][tx + k])) ok = false;
      for (let dy = 1; dy <= h && ok; dy++) {
        for (let k = 0; k < w && ok; k++) if (isSolidTile(SOLID[ty + dy][tx + k])) ok = false;
      }
      if (!ok) continue;
      const footY = (ty + 1) * TILE + PLAYER_R;
      // portas fechadas também contam
      let free = true;
      for (let x = tx * TILE + PLAYER_R; x <= (tx + w) * TILE - PLAYER_R && free; x += 8) {
        if (hitsSolid(x, footY, PLAYER_R, 0)) free = false;
      }
      if (free) return { x0: tx * TILE, x1: (tx + Math.min(run, w)) * TILE, footY, ty };
    }
  }
  throw new Error("sem parede com área aberta embaixo");
}

// ---------- Raio acerta quem está encostado na face de baixo de uma parede ----------
{
  const wall = wallWithOpenSouth(3, 12, 9);
  const tx = wall.x0 + TILE * 1.5;
  for (const [label, dx, dy] of [
    ["de baixo", 0, 200],
    ["na diagonal", -150, 150],
    ["rente à parede", -180, 0],
  ]) {
    const { sim } = setup(2);
    const [a, b] = sim.players;
    b.x = tx;
    b.y = wall.footY;
    a.x = tx + dx;
    a.y = wall.footY + dy;
    if (hitsSolid(a.x, a.y, PLAYER_R, 0)) {
      check(`raio encostado (${label}) — posição livre`, false, { x: a.x, y: a.y });
      continue;
    }
    // mira no tronco do alvo, como o cursor
    const aim = Math.atan2(b.y - 34 - a.y, b.x - a.x);
    input(sim, a.id, { cast: true, ability: 10, aim });
    stepSim(sim);
    check(`raio acerta alvo encostado na parede (${label})`, b.hp < 100, { hp: b.hp });
  }
}

// ---------- Escudo Estelar de frente bloqueia o raio ----------
{
  const { sim } = setup(2);
  const [a, b] = sim.players;
  b.ability = 4;
  input(sim, b.id, { cast: true, ability: 4, aim: Math.PI });
  stepSim(sim);
  input(sim, a.id, { cast: true, ability: 10, aim: 0 });
  input(sim, b.id, { aim: Math.PI, ability: 4 });
  stepSim(sim);
  const blocked = sim.events.some((e) => e.kind === "hit" && e.b === 253 && e.weaponId === 106);
  check("escudo erguido bloqueia o raio (sem dano/stun)", blocked && b.hp === 100 && !(b.stunnedUntil > sim.serverTime), {
    hp: b.hp,
  });
}

// ---------- Escudo Bumerangue: 1 acerto por alvo (ida e volta) ----------
{
  const { sim } = setup(2);
  const [a, b] = sim.players;
  input(sim, a.id, { cast: true, ability: 9, aim: 0 });
  for (let i = 0; i < 150 && (i < 2 || sim.shieldThrows.length); i++) {
    input(sim, b.id, { aim: Math.PI });
    stepSim(sim);
  }
  check("bumerangue fere o alvo uma vez só", b.hp === 100 - SHIELD_THROW_DMG, { hp: b.hp });
}

// ---------- Escudo Bumerangue rente à parede que o dono encosta ----------
{
  const wall = wallWithOpenSouth(12, 12, 3);
  for (const deg of [0, 5]) {
    const { sim } = setup(2);
    const [a, far] = sim.players;
    far.y += 900;
    a.x = wall.x0 + PLAYER_R + 4;
    a.y = wall.footY;
    const x0 = a.x;
    input(sim, a.id, { cast: true, ability: 9, aim: (-deg * Math.PI) / 180 });
    let maxD = 0;
    for (let i = 0; i < 12; i++) {
      stepSim(sim);
      for (const t of sim.shieldThrows) maxD = Math.max(maxD, t.x - x0);
    }
    check(`disco voa rente à parede (${deg}°)`, maxD > 200, { maxD });
  }
}

// ---------- Passo Sombrio encostado na parede ----------
{
  const wall = wallWithOpenSouth(12, 12, 3);
  const start = () => ({ x: wall.x0 + PLAYER_R + 4, y: wall.footY, vx: 0, vy: 0, angle: 0, abilityCdUntil: 0 });
  const p = start();
  const r = performBlink(p, 1000, 0, 0, hitsSolid);
  check("teleporte rente à parede (0°)", r && p.x - r.fromX > BLINK_RANGE - 8 && !hitsSolid(p.x, p.y, PLAYER_R - 0.5, 0), {
    moved: r && p.x - r.fromX,
  });
  const q = start();
  const r2 = performBlink(q, 1000, (-8 * Math.PI) / 180, 0, hitsSolid);
  check("teleporte 8° pra dentro da parede desliza", r2 && q.x - r2.fromX > 200 && Math.abs(q.y - r2.fromY) < 1, {
    moved: r2 && q.x - r2.fromX,
  });
  const u = start();
  const r3 = performBlink(u, 1000, -Math.PI / 2, 0, hitsSolid);
  check("teleporte de frente pra parede não gasta CD", r3 === null && u.abilityCdUntil === 0);
  void BLINK_MIN;
}

// ---------- Disco voltando por dentro da parede não fere quem está atrás ----------
{
  // parede de 1 tile com área aberta dos dois lados
  let spot = null;
  for (let ty = 5; ty < MAP_H - 10 && !spot; ty++) {
    for (let tx = 2; tx < MAP_W - 8 && !spot; tx++) {
      let ok = true;
      for (let k = 0; k < 2 && ok; k++) {
        if (!isSolidTile(SOLID[ty][tx + k])) ok = false;
        for (let dy = 1; dy <= 2 && ok; dy++) if (isSolidTile(SOLID[ty - dy][tx + k])) ok = false;
        for (let dy = 1; dy <= 6 && ok; dy++) if (isSolidTile(SOLID[ty + dy][tx + k])) ok = false;
      }
      const x = (tx + 1) * TILE;
      if (ok && !hitsSolid(x, (ty + 1) * TILE + PLAYER_R, PLAYER_R, 0) && !hitsSolid(x, ty * TILE - 40, 10, 0)) {
        spot = { x, ty };
      }
    }
  }
  if (!spot) {
    check("parede fina achada pro teste do disco fantasma", false);
  } else {
    const { sim } = setup(2);
    const [a, b] = sim.players;
    b.x = spot.x;
    b.y = (spot.ty + 1) * TILE + PLAYER_R;
    a.x = spot.x;
    a.y = b.y + 170;
    sim.shieldThrows.push({
      id: 99,
      owner: a.id,
      x: spot.x,
      y: spot.ty * TILE - 40,
      vx: 0,
      vy: SHIELD_THROW_SPEED,
      age: 1000,
      bounces: 3,
      returning: true,
      ghost: false,
      hit: new Set(),
    });
    let wentGhost = false;
    for (let i = 0; i < 30 && sim.shieldThrows.length; i++) {
      stepSim(sim);
      if (sim.shieldThrows.some((t) => t.ghost)) wentGhost = true;
    }
    check("disco voltando atravessa a parede sem ferir quem está atrás", wentGhost && b.hp === 100, { hp: b.hp, wentGhost });
    check("disco fantasma ainda volta pra mão", sim.shieldThrows.length === 0);
  }
}

// ---------- Disco rente ao lado de cima da parede não acerta quem está embaixo dela ----------
{
  let spot = null;
  for (let ty = 3; ty < MAP_H - 3 && !spot; ty++) {
    for (let tx = 2; tx < MAP_W - 7 && !spot; tx++) {
      let ok = true;
      for (let k = 0; k < 5 && ok; k++) {
        const t = SOLID[ty][tx + k];
        if (!isSolidTile(t) || t >= 20) ok = false; // parede de verdade (não caixa/carro)
        for (const dy of [-2, -1, 1, 2]) if (ok && isSolidTile(SOLID[ty + dy][tx + k])) ok = false;
      }
      if (!ok) continue;
      const northY = ty * TILE - PLAYER_R;
      const southY = (ty + 1) * TILE + PLAYER_R;
      const x0 = tx * TILE + 16;
      if (hitsSolid(x0, northY, PLAYER_R, 0) || hitsSolid(x0 + 100, southY, PLAYER_R, 0)) continue;
      spot = { x0, northY, southY };
    }
  }
  if (!spot) {
    check("parede comprida achada pro teste do disco rente", false);
  } else {
    const { sim } = setup(2);
    const [a, b] = sim.players;
    a.x = spot.x0;
    a.y = spot.northY;
    b.x = spot.x0 + 100;
    b.y = spot.southY;
    input(sim, a.id, { cast: true, ability: 9, aim: 0 });
    let maxD = 0;
    for (let i = 0; i < 10; i++) {
      input(sim, b.id, { aim: Math.PI });
      stepSim(sim);
      for (const t of sim.shieldThrows) maxD = Math.max(maxD, t.x - a.x);
    }
    check("disco passa rente e não acerta através da parede", maxD > 150 && b.hp === 100, { maxD, hp: b.hp });
  }
}

// ---------- Dono protegido pelo totem: raio não dá stun ----------
{
  const { sim } = setup(2);
  const [a, b] = sim.players;
  // totem no pé do dono (d < 34 = protegido), boca do C virada pro atacante
  sim.spikeTotems = [
    { id: 1, x: b.x, y: b.y, ownerId: b.id, expiresAt: sim.serverTime + 60000, radius: TOTEM_RADIUS, angle: Math.PI, lastHitAt: new Map() },
  ];
  input(sim, a.id, { cast: true, ability: 10, aim: Math.atan2(-34, b.x - a.x) });
  stepSim(sim);
  const blockedAtFeet = sim.events.some((e) => e.kind === "hit" && e.b === 253 && e.weaponId === 106 && Math.abs(e.y - b.y) < 1);
  const bled = sim.events.some((e) => e.kind === "hit" && e.b === b.id);
  check("totem segura o raio: sem dano, stun nem sangue", blockedAtFeet && b.hp === 100 && !(b.stunnedUntil > sim.serverTime) && !bled, {
    blockedAtFeet,
    hp: b.hp,
    bled,
  });
}

// ---------- Replay não teleporta quem está cego de flash ----------
{
  const { sim } = setup(2);
  const [a] = sim.players;
  const auth = toSnapshot(sim).players.find((p) => p.id === a.id);
  const buf = new PredictionBuffer();
  buf.reset(auth);
  buf.serverTime = sim.serverTime;
  const inp = {
    seq: auth.lastProcessedInputSeq + 1,
    dx: 0,
    dy: 0,
    aim: 0,
    fire: false,
    sprint: false,
    use: false,
    reload: false,
    cast: true,
    weapon: auth.weapon,
    throw: 0,
    ability: 11,
    clientTime: 0,
  };
  buf.record(inp);
  buf.flashUntil = sim.serverTime + 2800;
  const flashed = reconcile(auth, buf, createSmooth(auth));
  check("replay: cego de flash não teleporta", Math.abs(flashed.x - auth.x) < 5, { dx: flashed.x - auth.x });
  buf.flashUntil = 0;
  buf.record(inp);
  const clear = reconcile(auth, buf, createSmooth(auth));
  check("replay: sem flash teleporta", clear.x - auth.x > BLINK_RANGE - 20, { dx: clear.x - auth.x });
}

if (failed) {
  console.error(`${failed} falha(s)`);
  process.exit(1);
}
console.log("OK — poderes novos");
