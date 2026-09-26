/**
 * Smoke: visual (cosméticos) no HELLO / LOOK / LOBBY e validação.
 * Run: npx tsx scripts/test-cosmetics.mjs
 */
import {
  decodeHello,
  decodeHelloLook,
  decodeLobby,
  decodeLookMsg,
  encodeHello,
  encodeLobby,
  encodeLookMsg,
} from "../shared/protocol.ts";
import {
  DEFAULT_LOOK,
  LOOK_KEYS,
  LOOK_SIZES,
  PRESETS,
  autoLookFor,
  decodeLook,
  encodeLook,
  sanitizeLook,
} from "../shared/cosmetics.ts";

let failed = 0;
function check(name, cond) {
  if (!cond) {
    failed++;
    console.error("FAIL:", name);
  } else {
    console.log("ok:", name);
  }
}

const vader = PRESETS.find((p) => p.name === "Lorde Sombrio").look;

// HELLO antigo (sem visual) continua válido
const oldHello = encodeHello("ana");
check("hello antigo: nome", decodeHello(oldHello) === "ana");
check("hello antigo: sem visual", decodeHelloLook(oldHello) === null);

// HELLO novo
const hello = encodeHello("bruno", encodeLook(vader));
check("hello novo: nome", decodeHello(hello) === "bruno");
const back = decodeLook(decodeHelloLook(hello));
check("hello novo: visual ida e volta", back && LOOK_KEYS.every((k) => back[k] === vader[k]));

// LOOK
const lk = decodeLookMsg(encodeLookMsg(encodeLook(vader)));
check("LOOK ida e volta", lk && lk.length === LOOK_KEYS.length && decodeLook(lk).helmet === vader.helmet);

// validação: índices fora do catálogo viram padrão
const bad = decodeLook([9, 99, 99, 99, 99, 99, 99, 99, 250]);
check("sanitize fora do catálogo", LOOK_KEYS.every((k) => bad[k] >= 0 && bad[k] < LOOK_SIZES[k]));
check("sanitize null", sanitizeLook(null).outfit === DEFAULT_LOOK.outfit);
check("decode curto = null", decodeLook([1, 2]) === null);

// LOBBY leva o visual (JSON)
const lobby = decodeLobby(
  encodeLobby({ players: [{ id: 0, name: "a", ready: true, ping: 0, look: encodeLook(vader) }], hostId: 0, canStart: false }),
);
check("lobby com visual", decodeLook(lobby.players[0].look).cape === vader.cape);

// bots: visual automático sempre válido e variado
const seen = new Set();
for (let id = 0; id < 12; id++) {
  const l = autoLookFor(id);
  check(`auto ${id} válido`, LOOK_KEYS.every((k) => l[k] >= 0 && l[k] < LOOK_SIZES[k]) && l.body === 0);
  seen.add(encodeLook(l).join("."));
}
check("bots variados", seen.size >= 6);

// presets válidos
for (const p of PRESETS) {
  check(`preset ${p.name}`, LOOK_KEYS.every((k) => p.look[k] >= 0 && p.look[k] < LOOK_SIZES[k]));
}

if (failed) {
  console.error(`${failed} falha(s)`);
  process.exit(1);
}
console.log("OK — cosméticos");
