/**
 * hitsSolid (grade de tiles) == versão antiga (varre retângulos fundidos).
 * Run: npx tsx scripts/test-hits-solid.mjs
 */
import { hitsSolid, solidRects, circleRect, DOOR_DEFS } from "../shared/map.ts";

function reference(x, y, r, bits) {
  for (const o of solidRects(bits)) if (circleRect(x, y, r, o)) return true;
  return false;
}

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
let diff = 0;
const N = 60000;
for (let i = 0; i < N; i++) {
  const x = -40 + rnd() * 5200;
  const y = -40 + rnd() * 3920;
  const r = [1, 2, 3, 14, 15, 17, 24, 40][i % 8];
  const bits = Math.floor(rnd() * 65536) & ((1 << DOOR_DEFS.length) - 1);
  if (hitsSolid(x, y, r, bits) !== reference(x, y, r, bits)) {
    diff++;
    if (diff < 5) console.error("diff", { x, y, r, bits });
  }
}
const t0 = performance.now();
for (let i = 0; i < 200000; i++) hitsSolid((i * 37) % 5120, (i * 53) % 3840, 3, 0);
const fast = performance.now() - t0;
const t1 = performance.now();
for (let i = 0; i < 200000; i++) reference((i * 37) % 5120, (i * 53) % 3840, 3, 0);
const slow = performance.now() - t1;
console.log(`200k chamadas: novo ${fast.toFixed(1)} ms · antigo ${slow.toFixed(1)} ms`);
if (diff) {
  console.error(`FAIL: ${diff}/${N} divergências`);
  process.exit(1);
}
console.log(`OK — hitsSolid idêntico em ${N} amostras`);
