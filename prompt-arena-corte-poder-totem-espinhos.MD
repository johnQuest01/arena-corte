# Prompt — Poder: Totem de Espinhos (escudo verde posicionável)

> Repositório `johnQuest01/arena-corte`. Novo poder no framework de habilidades. Cria uma entidade ESTÁTICA (armadilha) que dá dano por contato. A parte trabalhosa é fazer a IA/Gigante EVITAREM — mas a navegação de inimigo já é sofisticada (`hitsSolid`, `resolveWalls`, `moveAndSlide`, `clearPath` em enemies.ts); é registrar o totem como obstáculo dinâmico. Autoritativo no sim; mira/visual client-side.

## Design
**Totem de Espinhos**: o jogador SEGURA o poder → sai uma luz do anel da mão do personagem até um ponto que ele MIRA/ARRASTA (perto ou longe, ele escolhe onde) → SOLTA → um **escudo grande verde neon com espinhos** fica PARADO naquele local por ~10 s. Inimigos que ENCOSTAM tomam dano contínuo; **Gigante que encosta morre**. A IA/Gigante EVITAM o totem quando o veem (contornam como obstáculo) — MAS se o totem for plantado de repente bem na frente deles durante a perseguição, não dá tempo de desviar e eles tomam dano. Cooldown ~18 s.

## A. Mira e posicionamento (client-side + confirmação autoritativa)
- Enquanto o poder está SENDO CONJURADO (segurar o botão/tecla), entrar em **modo de mira do totem**:
  - Desenhar uma **luz/linha do anel** partindo da mão do personagem até o ponto-alvo (um marcador no chão — círculo verde neon pulsante).
  - O ponto-alvo segue a MIRA (mouse/twin-stick), com **alcance máximo** (ex.: 260 px do jogador) — arrasta pra perto ou pra longe dentro do alcance. Clampar em parede (não plantar dentro de sólido).
  - **Soltar** confirma: envia a posição escolhida como parte do cast. (No input, o cast do totem precisa carregar o ponto-alvo x,y — adicionar ao payload de cast do totem, OU o sim usa `caster + dir(aim) * distânciaAtual`. Simplificar: o sim planta em `caster + dir(aim) * min(distMirada, 260)`.)
- Mobile: usar a direção/alcance do twin-stick de mira; o "arrastar" é a distância do stick.

## B. Efeito (autoritativo — shared)
### B.1 Entidade Totem (nova, em shared — pode reusar a estrutura de entidades)
```ts
interface SpikeTotem { id, x, y, ownerId, expiresAt, radius, tickDamage }
```
- Lista `spikeTotems` no GameSim. Constantes: `TOTEM_MS = 10000`, `TOTEM_RADIUS = 42` (grande), `TOTEM_TICK_DMG` (dano por segundo de contato).
### B.2 AbilityDef (shared/abilities.ts)
```ts
export const SPIKE_TOTEM: AbilityDef = {
  id: 7, name: "Totem de Espinhos",
  cooldownMs: 18000, castMs: 0, range: 260, coneRad: 0,
  apply(caster, _t, now, ctx) {
    const dx = Math.cos(caster.angle), dy = Math.sin(caster.angle);
    const dist = Math.min(ctx.totemDist ?? 260, 260);      // distância mirada, clampada
    let tx = caster.x + dx * dist, ty = caster.y + dy * dist;
    // clamp em parede aqui (hitsSolid) — recuar até posição livre
    ctx.spawnTotem?.(tx, ty, caster.id);
    ctx.didCast = true;
  },
};
```
Adicionar id 7 ao array; `spawnTotem?` e `totemDist?` ao AbilityCtx.
### B.3 Dano por contato (no step do sim, cada tick)
- Para cada totem vivo, para cada inimigo (zumbi/Brutamontes/Gigante) cuja distância ao totem < `radius + enemyRadius`:
  - Aplicar dano: `damageEnemy(..., TOTEM_TICK_DMG * dt, ...)`. Para **Gigante**, dano alto o suficiente pra matar rápido no contato (ou instakill se encostar — decidir; "gigante morre" → dano muito alto/instakill ao tocar).
  - Empurrão leve pra fora (knockback pequeno) pra não "grudar" no totem.
- Players inimigos (PvP) tocando o totem: também tomam dano (é armadilha pra todos os oponentes; o dono não).
- Emitir evento `totemHit` (faísca/dano visual) e `totemSpawn`/`totemExpire`.
- Snapshot: lista curta de totems (id, x, y — poucos bytes cada; some em 10 s).

## C. A IA/Gigante/BOTS EVITAREM (o coração — reusa a navegação existente)
A navegação já contorna sólidos via `hitsSolid`/`resolveWalls`/`clearPath`. IMPORTANTE: são DOIS sistemas de navegação, e o totem precisa entrar nos DOIS:
- **Inimigos** (zumbi/Brutamontes/Gigante): `shared/enemies.ts` (`canStepEnemy`, `clearPath`, `resolveWalls`, `chaseGiant`).
- **Bots** (jogadores controlados por IA): `client/src/net/botAi.ts` (`steerAlways`, `canStep`, `freeNormal`, `hasLineOfSight` — já têm `awayWall` no score).

Fazer o totem entrar em AMBOS:
- **Registrar o totem como obstáculo dinâmico**: criar um helper compartilhado `blockedByTotem(x, y, r, totems)` que retorna true se (x,y) está dentro de `radius + margem` de algum totem ativo. Incluir essa checagem NOS MESMOS pontos onde cada navegação já usa `hitsSolid`/parede:
  - Em `enemies.ts`: em `canStepEnemy`, `clearPath`, e no score de posições candidatas — tratar "perto de totem" como bloqueado/penalizado (como `awayWall`).
  - Em `botAi.ts`: em `canStep`, `steerAlways` (adicionar um termo `awayTotem` ao score, como o `awayWall` existente), e `hasLineOfSight`.
  - Passar a lista de totens ativos para essas funções (os totens estão no GameSim; o botAi já recebe estado do sim).
- Assim, tanto **inimigos quanto bots** desviam do totem como desviam de parede — CONTORNAM quando têm espaço.
- **O "pega de surpresa" emerge naturalmente**: como a nav recalcula a direção a cada tick, se o totem aparece MUITO perto — plantado bem na frente de um inimigo/bot que está ANDANDO ou CORRENDO na direção dele — ele já entra em contato (dentro do raio de dano) ANTES de conseguir recalcular e contornar, e toma dano. NÃO precisa de código especial: é consequência de plantar dentro/na borda da trajetória atual em movimento. Vale para gigante, zumbi E bot.
- **Margem de evitação > raio de dano**: a "aura de evitar" (raio que a nav evita) deve ser um pouco MAIOR que o raio de dano — assim eles mantêm distância de segurança quando têm tempo/espaço, mas o dano só ocorre no contato real. Ajustar as duas margens pra o comportamento ficar "esperto quando vê com antecedência, mas pegável quando surpreendido em movimento".
- Gigante usa a mesma lógica (`resolveWalls`/`canStepEnemy` em `chaseGiant`).

## D. Visual (client-side)
- **Totem**: um escudo/estrutura VERDE NEON com espinhos ao redor, brilhando/pulsando, sombra no chão. Espinhos podem "vibrar" sutil. Aura verde translúcida marcando o raio de dano.
- **Contato**: faísca verde + o inimigo pisca ao tomar dano (evento `totemHit`).
- **Mira (durante o cast)**: linha/feixe verde da mão ao marcador; marcador é um círculo verde neon no chão mostrando onde vai plantar (some ao confirmar).
- **Spawn/expire**: surgir com um "flash" verde; ao expirar, esfarelar (partículas). Som de energia ao plantar + zumbido leve enquanto ativo + faísca no contato.
- HUD: cooldown radial.

## E. Como obter
- **Treino (mode 0)**: trocável via `input.ability` (id 7).
- **Survival (mode 1)**: `AbilityDrop` com `abilityId = 7` (reusar). Ícone de totem verde.

## Regras
- `muzzlePoint`/câmera/netcode INTOCADOS.
- Novo: entidade totem + `blockedByTotem` na navegação da IA. Reusa AbilityDrop, `damageEnemy`, e a nav de inimigo existente.
- Determinístico: dano e posição no host; a IA evita de forma determinística (mesma nav dos 3 clientes se rodada no host — o host é autoritativo sobre inimigos).

## Critérios de aceite binários
1. [ ] Segurar o poder mostra uma luz/feixe verde da mão do personagem até um marcador que segue a mira; arrastar aproxima/afasta o ponto (até ~260 px); soltar planta o totem lá (clampado fora de paredes).
2. [ ] O totem fica parado ~10 s como escudo verde neon com espinhos, com aura marcando o raio.
3. [ ] Inimigos que encostam tomam dano; o Gigante que encosta morre (dano altíssimo/instakill no contato).
4. [ ] A IA (zumbis/Gigante) E os BOTS EVITAM/contornam o totem quando têm espaço/antecedência (tratado como obstáculo nas DUAS navegações: enemies.ts e botAi.ts).
5. [ ] Se o totem é plantado de repente na frente de um inimigo OU bot que está ANDANDO/CORRENDO na direção dele, ele é pego e toma dano (a surpresa em movimento funciona para todos: zumbi, Gigante e bot).
6. [ ] Autoritativo: cliente não planta/causa dano localmente; posição, dano e a evitação (rodada no host) batem nos 3 clientes.
7. [ ] Com 150 ms de latência: sem rubber-banding; efeitos resolvem igual nos 3 clientes.
8. [ ] No treino trocável/testável; no survival aparece como drop.
9. [ ] `git diff`: entidade/dano/nav em shared (abilities/sim/enemies/protocol), mira/visual em cliente; `muzzlePoint`/câmera/netcode inalterados.
10. [ ] FPS ≥ 60 com totens ativos + inimigos desviando.
```
