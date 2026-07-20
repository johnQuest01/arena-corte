# Patch — Arena Corte: arma/mãos flutuando fora do corpo

> Bug: o fuzil e as mãos aparecem flutuando à frente do personagem, desconectados do corpo. Causa: `GUN_HAND = 18` (shared/gear.ts) empurra a arma pra frente na direção da mira — valor grande demais pro tamanho atual do personagem (`CHAR = 5.0`), então a arma "descola". PEGADINHA: `GUN_HAND` é usado TAMBÉM em `muzzlePoint()` (origem AUTORITATIVA da bala). Reduzir `GUN_HAND` direto moveria a origem da bala e reintroduziria o bug do tiro torto. Solução: separar o offset VISUAL do offset de hitscan.

## Passo 1 — criar constante visual separada (shared/gear.ts)
Perto de `GUN_HAND`:
```ts
export const GUN_HAND = 18;          // NÃO alterar — usado por muzzlePoint (origem da bala, autoritativo)
export const GUN_HAND_VISUAL = 6;    // offset SÓ do desenho da arma (aproxima do corpo). Ajustar este.
```
(6 é ponto de partida — a arma nasce mais perto do ombro/mão. Se ainda longe, diminuir; se sobrepondo o tronco, aumentar.)

## Passo 2 — usar o offset visual no render (client/src/game/render.ts, drawWeaponLayer ~397-405)
Trocar:
```ts
const HAND = GUN_HAND;
```
por:
```ts
const HAND = GUN_HAND_VISUAL;   // desenho perto do corpo (hitscan continua com GUN_HAND)
```
E garantir o import na linha 5:
```ts
import { LOADOUTS, MAX_STAMINA, GUN_HAND, GUN_HAND_VISUAL, GUN_VISUAL_SCALE, gunBarrelLocal, muzzlePoint, weaponOf } from "../../../shared/gear";
```

## Passo 3 — reconciliar o muzzle flash e a origem visual da bala
O `muzzlePoint()` (origem REAL da bala, autoritativa) continua usando `GUN_HAND` — NÃO mexer. Mas o muzzle flash e o início do rastro da bala são desenhados no espaço local da arma (que agora usa `GUN_HAND_VISUAL`). Como a arma foi puxada pra trás em `(GUN_HAND - GUN_HAND_VISUAL)` px, o cano DESENHADO também recuou. Para o flash/rastro continuarem saindo da ponta do cano DESENHADO (coerência visual), eles já usam `barrel = gunBarrelLocal(w)` no espaço local — que não muda. Verificar: se o flash visual descolar da ponta do cano após o passo 2, ajustar `GUN_HAND_VISUAL` (não o barrel) até o cano desenhado, o flash e o rastro coincidirem visualmente.
- IMPORTANTE: a bala continua NASCENDO em `muzzlePoint` (hitscan). O objetivo é só o VISUAL casar. Uma pequena diferença entre origem visual e hitscan é aceitável e imperceptível; o que NÃO pode é a arma flutuar longe do corpo.

## Passo 4 — conferir as mãos
`drawGripHands(ctx, visualLen)` desenha as mãos no espaço local da arma (relativas a ela). Com a arma reposicionada pelo passo 2, as mãos acompanham automaticamente e voltam a encostar no corpo. Se a mão traseira ainda não tocar o tronco, ajustar levemente a posição da mão traseira dentro de `drawGripHands` (o `ellipse` da mão de trás), NÃO o GUN_HAND.

## Critérios de aceite binários
1. [ ] A arma nasce junto ao corpo do personagem (no ombro/mão), sem flutuar à frente.
2. [ ] As duas mãos aparecem SEGURANDO a arma, conectadas ao corpo (não flutuando isoladas).
3. [ ] Em todas as direções de mira (360°) e com flip à esquerda, a arma permanece colada ao corpo.
4. [ ] O muzzle flash e o rastro da bala saem da ponta do cano DESENHADO (coerência visual).
5. [ ] `muzzlePoint`/`GUN_HAND` INALTERADOS: com 150 ms de latência, o tiro continua saindo do cano e o hit no servidor não regride (conferir por diff que gear.ts só GANHOU `GUN_HAND_VISUAL`, sem alterar `GUN_HAND` nem `muzzlePoint`).
6. [ ] `git diff` restrito a: `shared/gear.ts` (nova const) e `client/src/game/render.ts` (uso da nova const + import). Zero mudança em sim/protocolo/rede.
