/**
 * fxstyle.ts — qual visual cada poder usa: "Novos" (fx2) ou "Rascunho"
 * (abilities_fx / powers_fx antigos). Quem escolhe é quem conjurou, pelo
 * `look.fx` do guarda-roupa — todo mundo vê o poder no estilo do dono.
 * Entidades sem dono no snapshot (Gigante, totem, gelo) guardam o dono
 * visto no evento de criação.
 */

let styleOf: (id: number) => number = () => 0;
/** Quem está jogando nesta tela (fallback quando o dono é desconhecido). */
let selfOf: () => number = () => -1;

export function setFxStyleProvider(fn: (id: number) => number, self: () => number) {
  styleOf = fn;
  selfOf = self;
}

/** true = efeitos antigos ("Rascunho") para poderes deste jogador. */
export function fxOld(id: number | null | undefined): boolean {
  const who = id != null && id >= 0 ? id : selfOf();
  if (who < 0) return false;
  return styleOf(who) === 1;
}

const giantOwner = new Map<number, number>();
const totemOwner = new Map<number, number>();
const frostCaster = new Map<number, number>();

function remember(map: Map<number, number>, key: number, owner: number) {
  map.set(key & 0xff, owner);
  if (map.size > 96) {
    const first = map.keys().next().value;
    if (first != null) map.delete(first);
  }
}

export function setGiantOwner(giantId: number, ownerId: number) {
  remember(giantOwner, giantId, ownerId);
}
export function giantIsOld(giantId: number): boolean {
  return fxOld(giantOwner.get(giantId & 0xff));
}

const totemAngle = new Map<number, number>();

export function setTotemOwner(totemId: number, ownerId: number, angle?: number) {
  remember(totemOwner, totemId, ownerId);
  if (angle != null) remember(totemAngle, totemId, angle);
}
export function totemOwnerOf(totemId: number): number | undefined {
  return totemOwner.get(totemId & 0xff);
}
/** Abertura do C vista por último (o snapshot do expire já não tem o totem). */
export function totemAngleOf(totemId: number): number | undefined {
  return totemAngle.get(totemId & 0xff);
}

/** Quem congelou (id do alvo, jogador ou inimigo — mesmo byte do evento). */
export function setFrostCaster(victimId: number, casterId: number) {
  remember(frostCaster, victimId, casterId);
}
export function frostIsOld(victimId: number): boolean {
  return fxOld(frostCaster.get(victimId & 0xff));
}

export function clearFxOwners() {
  giantOwner.clear();
  totemOwner.clear();
  totemAngle.clear();
  frostCaster.clear();
}
