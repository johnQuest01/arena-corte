# Prompt — Poder 4 (Leva 2): Fenda Sísmica (rachadura + buraco)

> Repositório `johnQuest01/arena-corte`. O poder mais complexo e espetacular. Mesmo framework de habilidades, mas o efeito é uma FISSURA que viaja até o alvo e o engole. Reusa: `damageEnemy(...99999...)` (instakill de enemy, já usado na linha 1281), `target.hp -= amount` (dano a player), padrão `bestInAimCone`/`nearestCandidate` (seleção de alvo do gigante). Autoritativo no sim; animação client-side. É o poder onde vale o Grok CAPRICHAR no visual da fissura.

## Design
**Fenda Sísmica**: o jogador pisa forte no chão → uma rachadura em ZIGUEZAGUE corre pelo chão na direção da mira até alcançar o PRIMEIRO alvo na linha → abre um buraco sob o alvo → o alvo CAI e é eliminado. Se no caminho o alvo mais próximo é um Gigante rival, pega o Gigante; se é um player, pega o player ("dependendo da distância" = o mais próximo na direção da mira). Cooldown longo (~22 s — poder de eliminação).

## A. Efeito (autoritativo — shared)
### A.1 Nova AbilityDef (shared/abilities.ts)
```ts
export const SEISMIC_RIFT: AbilityDef = {
  id: 5, name: "Fenda Sísmica",
  cooldownMs: 22000,
  castMs: 250,           // pequeno windup (o "pisar") antes de disparar
  range: 700,            // alcance máximo da fissura
  coneRad: 0.4,          // tolerância angular pra "mirar" no alvo
  apply(caster, _targets, now, ctx) {
    const cands = ctx.candidates ?? [];
    // alvo = o mais próximo dentro do cone da mira (player OU gigante OU zumbi), até range
    const target =
      nearestInAimCone(caster, cands, 0.4, 700); // helper: filtra por cone+range, retorna o mais PRÓXIMO
    if (!target) {
      // sem alvo: a fissura ainda corre reto até o range (só visual + dano em quem tocar a linha)
    }
    ctx.riftStrike?.(caster, target ?? null);   // novo hook no ctx (ver A.2)
    ctx.didCast = true;
  },
};
```
- Precisa de um helper `nearestInAimCone(caster, cands, cone, maxRange)` (adaptar de `bestInAimCone`/`nearestCandidate`, retornando o de menor distância dentro do cone e do alcance).
- Adicionar `riftStrike?: (caster, target|null) => void` ao `AbilityCtx` (como já existe `spawnGiant`).

### A.2 O golpe da fissura (implementar `riftStrike` no makeAbilityCtx do sim — shared/sim.ts)
- Calcular o ponto final: se há `target`, o fim da fissura é a posição do alvo; senão, `caster + dir(aim) * range`.
- **Eliminação**: ao "chegar" no alvo (ver timing em A.3):
  - Se alvo é player: `target.hp = 0` + morte creditada ao caster (reusar o fluxo de kill/`death` com uma causa nova, ex.: `causeCode` de fenda).
  - Se alvo é enemy/Gigante: `damageEnemy(sim.enemies, sim.waves, targetId, 99999, makeEnemyCtx(sim))` (instakill, como linha 1281).
  - Opcional: dano/knockback em outros alvos que estejam MUITO perto da linha da fissura (dano em quem toca o rasgo), não só o alvo final. Começar só com o alvo final pra manter claro.
- **Timing**: a fissura leva um tempo pra "correr" até o alvo (não é instantânea — ver A.3), então o dano é aplicado quando ela chega. Como o alvo pode se mover nesse meio tempo, DUAS opções:
  - (simples, recomendado) travar o alvo no disparo e aplicar o dano após `travelMs` se ele ainda estiver vivo e dentro de um raio do ponto final (senão, "escapou" — a fissura abre buraco onde ele estava e não pega). Isso dá contra-jogo (dá pra escapar correndo, como o gigante).
  - (complexo) a fissura persegue o alvo. NÃO fazer agora.

### A.3 Evento pro cliente animar
- Emitir evento novo `rift` no protocolo (próximo id livre, 22): payload = `x0,y0` (origem no caster), `x1,y1` (ponto final), `travelMs`, `casterId`, `hit` (0/1 se vai eliminar). Adicionar `rift` ao `EVENT_KIND`/`KIND_FROM`.
- O cliente usa isso pra desenhar a fissura correndo de (x0,y0) até (x1,y1) ao longo de `travelMs` e abrir o buraco no fim.
- Snapshot: nada persistente (o efeito é um evento pontual). O dano/kill já reflete no estado do alvo.

### A.4 Colisão com paredes (opcional)
- A fissura idealmente para em parede sólida (não atravessa prédio). Checar `hitsSolid` ao longo da linha e encurtar o ponto final se bater em SOLID. Começar simples: se ficar estranho atravessando prédio, adicionar o clamp.

## B. Animação (client-side — o capricho, em abilities_fx.ts + render.ts)
Ao receber o evento `rift`:
### B.1 A fissura em ziguezague
- Gerar uma POLYLINE em ziguezague de (x0,y0) a (x1,y1): dividir a reta em ~8-14 segmentos, deslocando cada vértice perpendicularmente por um valor aleatório (±8-16 px) — o "raio" da rachadura. Semente fixa por evento (pra ficar consistente no frame).
- **Animar o avanço**: revelar a polyline progressivamente ao longo de `travelMs` (a rachadura "corre" do caster até o alvo). Desenhar como uma linha ESCURA grossa (fenda) com borda mais clara (terra levantada) e um brilho interno (laranja/vermelho — magma/profundidade) pulsando.
- Poeira e detritos saltando ao longo da fissura conforme ela avança (partículas do FxPool). Tremor de tela (`feel.shake`) crescente durante o avanço, forte quando chega.

### B.2 O buraco no fim
- No ponto final, abrir um BURACO: elipse preta que cresce rapidamente (com borda de terra), com o alvo CAINDO dentro (se `hit`): desenhar o sprite do alvo encolhendo/afundando e girando pra dentro do buraco, fade pra preto.
- Após ~1 s, o buraco encolhe e some (ou vira um decal escuro persistente no chão — rachadura permanente, dá história ao mapa). `feel.shake` forte no momento da abertura.
- Som: `earth_crack` no avanço (rumble) + `earth_slam`/`collapse` na abertura do buraco (sfx CC0; fallback: `explosion`).

### B.3 O "pisar" inicial
- No windup (`castMs` 250 ms), o conjurador agacha/levanta o pé e bate no chão (animação curta) + onda de choque circular pequena nos pés + `feel.shake` leve — telegrafa o poder.

## C. Como obter
- **Treino (mode 0)**: trocável via `input.ability` (id 5).
- **Survival (mode 1)**: `AbilityDrop` com `abilityId = 5` (reusar). Ícone de fenda/terra.

## Regras
- `muzzlePoint`/câmera/netcode INTOCADOS. Dano/kill reusa `damageEnemy`/fluxo de morte existente.
- Novo evento `rift` no protocolo (pontual, não é estado sincronizado contínuo).
- Determinístico onde importa (seleção de alvo e dano no host; a fissura visual é client-side e pode variar levemente entre clientes sem afetar gameplay).

## Critérios de aceite binários
1. [ ] Ativar dispara (após um "pisão" curto) uma rachadura em ziguezague que corre pelo chão na direção da mira.
2. [ ] A rachadura alcança o alvo mais próximo na linha (player OU Gigante OU zumbi, o mais próximo dentro do cone/alcance) e o ELIMINA abrindo um buraco que o engole.
3. [ ] "Dependendo da distância": se um Gigante está mais perto na linha que um player, pega o Gigante; e vice-versa.
4. [ ] Dá contra-jogo: o alvo que corre pra fora antes da fissura chegar escapa (o buraco abre vazio).
5. [ ] Visual caprichado: fissura em ziguezague com brilho interno, poeira, tremor crescente; buraco cresce e o alvo cai girando; rachadura pode virar decal permanente.
6. [ ] Cooldown ~22 s (radial no HUD); pisão inicial telegrafa o poder.
7. [ ] Autoritativo: cliente não elimina ninguém localmente; a morte/kill vem do host e bate nos 3 clientes.
8. [ ] Com 150 ms de latência: sem rubber-banding; a eliminação resolve igual nos 3 clientes.
9. [ ] No treino trocável/testável; no survival aparece como drop.
10. [ ] `git diff`: efeito/evento em shared (abilities/sim/protocol — novo evento `rift`), animação em cliente; `muzzlePoint`/câmera/netcode inalterados.
11. [ ] FPS ≥ 60 com a fissura + buraco + tremor.
