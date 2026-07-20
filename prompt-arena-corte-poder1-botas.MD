# Prompt — Poder 1/3 (Leva buffs): Botas de Impulso

> Repositório `johnQuest01/arena-corte`. Novo poder no framework de habilidades que JÁ existe (`shared/abilities.ts` — `AbilityDef`, array `ABILITIES`; `p.ability`/`p.abilityCdUntil`/`stunnedUntil` no sim; troca via `input.ability`; drops no mapa via `WeaponDrop`/pickup). Este é o mais simples da leva — usar de modelo pros próximos. Efeito + visual no boneco no MESMO pacote. Autoritativo (buff no sim); visual client-side.

## Design
**Botas de Impulso**: ao ativar, o jogador corre MUITO mais rápido por ~4 s. Cooldown ~12 s. As botas ficam VISÍVEIS no personagem quando o poder está equipado, e soltam rastro/poeira enquanto o boost está ativo.

## A. Efeito (autoritativo — shared)
### A.1 Estado no player (shared/sim.ts, junto de stunnedUntil/abilityCdUntil)
```ts
speedBoostUntil: number;  // 0 = sem boost; enquanto now < speedBoostUntil, velocidade aumentada
```
Inicializar em 0 no spawn/reset.

### A.2 Nova AbilityDef (shared/abilities.ts)
```ts
export const SPRINT_BOOTS: AbilityDef = {
  id: 2, name: "Botas de Impulso",
  cooldownMs: 12000,
  castMs: 0,
  range: 0, coneRad: 0,
  apply(caster, _targets, now, ctx) {
    const p = caster as PlayerState & { speedBoostUntil?: number };
    p.speedBoostUntil = now + 4000;   // 4 s de boost
    ctx.didCast = true;
  },
};
```
Adicionar ao array: `export const ABILITIES = [WATER_JET, SUMMON_GIANT, SPRINT_BOOTS];`

### A.3 Aplicar o boost no movimento (shared/sim.ts, onde a velocidade/MOVE_SPEED do player é calculada)
- Onde hoje o passo usa a velocidade base (MOVE_SPEED/MOVE_ACCEL), multiplicar por um fator quando `now < p.speedBoostUntil`:
```ts
const boosted = p.speedBoostUntil && now < p.speedBoostUntil;
const speedMul = boosted ? 1.8 : 1;   // 80% mais rápido
```
Aplicar `speedMul` à velocidade máxima do player (e opcionalmente à aceleração). Determinístico → host e prediction batem.
- Snapshot: adicionar `speedBoostUntil` ao estado do player no protocolo (mesmo padrão de `stunnedUntil`; ~poucos bytes). Necessário pro cliente saber quando desenhar o rastro nos remotos.

## B. Visual no boneco (client-side — render.ts, drawPersonSide)
### B.1 Botas visíveis (quando a habilidade equipada é a 2)
- Se `p.ability === 2`, desenhar as botas: dois retângulos/formas mais destacados nos PÉS do personagem (cor contrastante — ex.: laranja/energia da paleta), por cima do desenho dos pés atuais. Aparecem SEMPRE que equipadas (mesmo sem boost ativo), pra o jogador saber que tem o item.
- Manter o flip esquerda/direita e a animação de passo existentes (as botas acompanham os pés).

### B.2 Rastro de velocidade (quando boost ATIVO)
- Quando `now < p.speedBoostUntil` (próprio e remotos): emitir partículas de rastro atrás do jogador (pool do FxPool/gore): linhas/traços curtos na direção oposta ao movimento, cor de energia, fade rápido. Densidade proporcional à velocidade.
- Leve "motion streak" no boneco (2-3 cópias fantasma semi-transparentes atrás) — opcional, dá sensação de corrida.
- Som `boost`/whoosh no início (sfx CC0; fallback: reusar um som existente suave). HUD: cooldown radial da habilidade.

## C. Como obter (dois modos)
- **Treino (mode 0)**: já dá pra trocar de habilidade via `input.ability` (como arma). Garantir que a UI/tecla de trocar habilidade inclui a id 2. (Se hoje só troca arma, adicionar ciclo de habilidade — tecla dedicada, ex.: teclas numéricas ou Q pra ciclar habilidade.)
- **Survival (mode 1)**: as botas viram um **AbilityDrop** que aparece no mapa. Clonar o sistema `WeaponDrop` para `AbilityDrop { id, x, y, abilityId }`: spawn periódico em tile livre, pickup por colisão (raio ~16 px) que seta `p.ability = abilityId`, eventos `abilityDropSpawn`/`abilityDropTaken`. Render: ícone da bota flutuando com brilho (como os drops atuais). Só no mode 1.

## Regras
- `muzzlePoint`/origem da bala, câmera e netcode existentes INTOCADOS.
- Só `speedBoostUntil` novo no snapshot; AbilityDrop reusa o padrão de WeaponDrop.
- Determinístico no sim (host + prediction).

## Critérios de aceite binários
1. [ ] Com a habilidade Botas equipada, ativar dá ~4 s de corrida ~80% mais rápida; cooldown ~12 s (radial no HUD).
2. [ ] As botas aparecem nos pés do personagem quando equipadas (visíveis sempre, não só no boost).
3. [ ] Durante o boost, sai rastro de partículas atrás do jogador (próprio e remotos); som no início.
4. [ ] No treino, dá pra trocar pra essa habilidade e testar na hora (como troca de arma).
5. [ ] No survival, a bota aparece como drop no mapa, é pega por colisão e passa a ficar equipada.
6. [ ] Autoritativo: cliente adulterado não fica veloz sem o buff; boost e velocidade batem nos 3 clientes.
7. [ ] Com 150 ms de latência: o boost do próprio jogador responde por predição; nos remotos vem do snapshot sem rubber-banding.
8. [ ] `git diff`: buff/estado em shared (sim/abilities/protocol — só `speedBoostUntil` + AbilityDrop), visual em cliente. `muzzlePoint`/câmera/netcode inalterados.
9. [ ] FPS ≥ 60 com rastro ativo.
