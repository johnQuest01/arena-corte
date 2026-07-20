# Prompt — Poder 5 (Leva 2): Bomba Devastadora

> Repositório `johnQuest01/arena-corte`. O MAIS SIMPLES da leva 2 — reusa o sistema de explosão que JÁ existe (`detonate()` na linha 659, `THROWS` com raio, evento `explode`). É essencialmente uma explosão com raio ENORME e dano massivo, disparada como habilidade. Autoritativo; visual client-side (turbinar o FX de explosão existente).

## Design
**Bomba Devastadora**: o jogador solta uma bomba que detona (após um fuse curto OU na hora) causando uma explosão GIGANTE que elimina quase tudo num raio grande — players, zumbis, Gigantes, props destrutíveis. Cooldown muito longo (~30 s — é o poder mais forte). O próprio conjurador toma dano se ficar no raio (ou não — decidir; começar SEM dano ao dono pra não ser suicida).

## A. Efeito (autoritativo — shared)
### A.1 Nova AbilityDef (shared/abilities.ts)
```ts
export const DEVASTATOR_BOMB: AbilityDef = {
  id: 6, name: "Bomba Devastadora",
  cooldownMs: 30000,
  castMs: 0,
  range: 0, coneRad: 0,
  apply(caster, _targets, now, ctx) {
    // solta uma bomba na posição do caster (ou à frente). Detona após fuse curto.
    ctx.spawnBomb?.(caster.x, caster.y, caster.id);
    ctx.didCast = true;
  },
};
```
Adicionar ao array `ABILITIES` (id 6). Adicionar `spawnBomb?: (x, y, ownerId) => void` ao `AbilityCtx`.

### A.2 A bomba (reusar o sistema de throwable/detonate — shared/sim.ts)
- Opção mais simples: criar um `ThrowableState` especial (ou uma bomba dedicada) que detona após ~1200 ms na posição, chamando uma versão turbinada de `detonate()`:
  - **Raio ENORME**: ex.: `radius: 260` (vs granada 70) — cobre boa parte da tela.
  - **Dano massivo**: instakill em players no raio (`hp = 0`) e `damageEnemy(..., 99999, ...)` em zumbis/Gigantes no raio (reusar o padrão da linha 1281).
  - **Props**: se props destrutíveis existem, destruí-los no raio (senão, ignorar).
  - **Falloff opcional**: dano total no centro, decrescente na borda — mas pra "detona quase tudo", começar com dano letal em todo o raio.
  - Creditar kills ao `ownerId` (reusar fluxo de `death`).
- **Dono**: por padrão, o conjurador NÃO toma dano (senão vira suicídio). Se quiser risco, incluir o dono no raio — decidir em playtest; começar imune.
- Reusar/estender o evento `explode` existente com um flag de "big" (ex.: `b = 1` pra explosão grande) pro cliente desenhar o FX massivo. Sem campo novo.

### A.3 Snapshot
- A bomba enquanto voa/conta o fuse = 1 throwable (já sincronizado pelo sistema de throwables). Detonação = evento. Nada novo contínuo.

## B. Visual (client-side — turbinar o FX de explosão existente)
- **A bomba**: desenhar um objeto de bomba (círculo escuro com pavio/luz piscando mais rápido conforme o fuse acaba) na posição, reusando o render de throwables.
- **A explosão massiva** (ao receber `explode` com flag big):
  - Flash branco forte na tela (breve), bola de fogo grande que expande (múltiplas camadas: núcleo branco → laranja → fumaça preta), reusando/escalando o FX de explosão da granada.
  - Onda de choque: anel que expande rápido pelo chão (como o da água/gigante, mas grande).
  - `feel.shake` FORTE (ex.: 8-10) com decaimento; leve "flash cegante" curto (reusar o de flashbang, mais suave).
  - Detritos voando (partículas), cratera/decal de queimado persistente no chão no raio.
  - Som `big_explosion` (sfx CC0; fallback: o `explosion` existente com volume/pitch maior).
- **Corpos**: quem morre pela bomba usa o gore de explosão (despedaçar — reusar a causa "explosão" que o gore já trata).

## C. Como obter
- **Treino (mode 0)**: trocável via `input.ability` (id 6).
- **Survival (mode 1)**: `AbilityDrop` com `abilityId = 6` (reusar). Raro (é forte) — spawn menos frequente que os outros.

## Regras
- `muzzlePoint`/câmera/netcode INTOCADOS. Reusa `detonate`/explosão/gore existentes.
- Reusa evento `explode` (flag big); reusa AbilityDrop.
- Determinístico (host aplica dano; cliente não mata localmente).

## Critérios de aceite binários
1. [ ] Ativar solta uma bomba que detona após ~1.2 s numa explosão de raio grande (~260).
2. [ ] A explosão elimina players, zumbis e Gigantes no raio; props destrutíveis (se houver) são destruídos.
3. [ ] Por padrão o conjurador não toma dano (não é suicídio) — a menos que o playtest decida incluir.
4. [ ] FX massivo: flash, bola de fogo em camadas, onda de choque, tremor forte, detritos, cratera persistente; corpos despedaçam (gore de explosão).
5. [ ] Cooldown ~30 s (radial no HUD); pavio pisca acelerando antes de detonar.
6. [ ] Autoritativo: cliente não detona/mata localmente; dano vem do host e bate nos 3 clientes.
7. [ ] Com 150 ms de latência: sem rubber-banding; a explosão resolve igual nos 3 clientes.
8. [ ] No treino trocável/testável; no survival aparece como drop RARO.
9. [ ] `git diff`: efeito em shared (abilities/sim — reusa explode), FX em cliente; `muzzlePoint`/câmera/netcode inalterados.
10. [ ] FPS ≥ 60 durante a explosão massiva.
```
