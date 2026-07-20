# Prompt — Poder: Congelamento (bloco de gelo)

> Repositório `johnQuest01/arena-corte`. Novo poder no framework. É parente do stun da água (`stunnedUntil`), MAS com diferença crítica: o stun da água NÃO trava o movimento (o jogador ainda anda). O gelo congela TUDO — o alvo vira estátua dentro de um bloco de gelo por 5 s. Precisa de estado próprio `frozenUntil` que também bloqueia o andar. Autoritativo; visual client-side.

## Design
**Congelamento**: ao ativar, o(s) oponente(s) no alcance/cone são ENCAPSULADOS num bloco de gelo azul-claro com branco e ficam totalmente parados (não andam, não atiram, não usam nada) por ~5 s. Cooldown ~14 s. Funciona em players (PvP) e em zumbis/Gigante (survival) — congelar o Gigante por 5 s é uma janela de escape/dano.

## A. Efeito (autoritativo — shared)
### A.1 Estado (shared/sim.ts) — NOVO, separado do stun da água
```ts
frozenUntil: number;   // 0 = livre; enquanto now < frozenUntil, TOTALMENTE congelado (inclui movimento)
```
Inicializar 0. Para inimigos, o `Enemy` também precisa de `frozenUntil` (ou reusar um campo de "parado" existente).

### A.2 Travar TUDO enquanto congelado
- No `stepPlayer`: se `now < p.frozenUntil`, o jogador não anda (zerar/ignorar input de movimento — `vx=vy=0`, não aplicar MOVE), e também bloquear fire/reload/throw/cast (adicionar `frozen` à checagem `!stunned` existente → `!stunned && !frozen`).
  ```ts
  const frozen = p.frozenUntil > 0 && now < p.frozenUntil;
  // no movimento: if (frozen) { /* não mover */ } else { ...aplica input de move... }
  // nas ações: ...&& !stunned && !frozen...
  ```
- No `stepEnemy`: se o inimigo está `frozenUntil` ativo, ele NÃO se move e NÃO ataca (pular a máquina de estados, ficar parado). O Gigante idem.

### A.3 AbilityDef (shared/abilities.ts)
```ts
export const FROST_NOVA: AbilityDef = {
  id: 8, name: "Congelamento",
  cooldownMs: 14000, castMs: 0,
  range: 240,
  coneRad: 1.2,          // cone largo à frente (ou 6.28 pra 360° ao redor — decidir)
  apply(caster, targets, now, ctx) {
    for (const t of targets) {
      const ft = t as PlayerState & { frozenUntil?: number };
      ft.frozenUntil = Math.max(ft.frozenUntil ?? 0, now + 5000);
      ft.vx = 0; ft.vy = 0;   // trava imediata
    }
    // congelar também inimigos no alcance (via candidates/ctx, se o alvo for enemy) — ver nota
    ctx.didCast = true;
  },
};
```
Adicionar id 8 ao array. `targets` já vem filtrado por cone/alcance pelo framework (`selectAbilityTargets`). Para congelar ENEMIES (zumbi/Gigante) além de players, garantir que o ctx aplica `frozenUntil` nas entidades inimigas no alcance (o WATER_JET já acerta enemies no mode 1 — seguir o mesmo caminho: iterar enemies no cone e setar `frozenUntil`, e emitir `enemyHit`/evento de congelamento).

### A.4 Snapshot
- `frozenUntil` no player (poucos bytes) e no enemy — pro cliente desenhar o bloco de gelo nos remotos. Mesmo padrão de `stunnedUntil` (linha 1380).

## B. Visual (client-side — render.ts)
### B.1 Bloco de gelo sobre o alvo (quando `now < frozenUntil`)
- Desenhar por cima do personagem/inimigo congelado:
  - Um **bloco/cristal de gelo** semi-transparente envolvendo o corpo: cor azul-clara (`#a8d8f0`-ish) com bordas e reflexos BRANCOS, opacidade ~0.55 (dá pra ver o personagem congelado dentro).
  - Formato: um cristal facetado (polígono de 5-7 lados irregulares) ou um retângulo arredondado com "quinas" de gelo; brilho branco nas arestas.
  - Reflexo/brilho: 1-2 linhas brancas diagonais (highlight de gelo) que reluzem sutil.
  - Leve vapor frio (2-3 partículas brancas subindo devagar) ao redor da base.
  - O personagem DENTRO fica com tint azulado (frio) e imóvel (congelar a animação — frame parado).
- **No impacto (início)**: um "estilhaço" de cristais de gelo se formando + som `freeze`/cristal.
- **No fim (descongelar)**: o bloco racha e estilhaça em cacos (partículas de gelo caindo) + som de quebra; o personagem volta a se mover.
- HUD: cooldown radial; ícone de gelo sobre alvos congelados.

## C. Como obter
- **Treino (mode 0)**: trocável via `input.ability` (id 8).
- **Survival (mode 1)**: `AbilityDrop` com `abilityId = 8` (reusar). Ícone de cristal de gelo.

## Regras
- `muzzlePoint`/câmera/netcode INTOCADOS.
- `frozenUntil` é novo e distinto de `stunnedUntil` (este trava tudo, inclusive movimento). Reusa AbilityDrop e o padrão de cone/alcance do framework.
- Determinístico (host aplica o congelamento; cliente não congela ninguém localmente além da predição do próprio efeito visual).

## Critérios de aceite binários
1. [ ] Ativar congela oponentes no cone/alcance: eles ficam TOTALMENTE parados (não andam, não atiram, não usam nada) por ~5 s.
2. [ ] Funciona em players (PvP) e em zumbis/Gigante (survival); Gigante congelado para de perseguir por 5 s.
3. [ ] O alvo aparece dentro de um BLOCO DE GELO azul-claro com bordas/reflexos brancos, semi-transparente (dá pra ver o corpo congelado dentro), com vapor frio.
4. [ ] Início: cristais se formam + som; fim: o bloco racha e estilhaça em cacos + som; o alvo volta a se mover.
5. [ ] Cooldown ~14 s (radial no HUD).
6. [ ] Autoritativo: cliente não congela localmente; o congelamento (e o fim) batem nos 3 clientes.
7. [ ] Com 150 ms de latência: sem rubber-banding; congelar/descongelar resolve igual nos 3 clientes.
8. [ ] No treino trocável/testável; no survival aparece como drop.
9. [ ] `git diff`: `frozenUntil` + trava em shared (sim/abilities/enemies/protocol), bloco de gelo em cliente; `muzzlePoint`/câmera/netcode inalterados.
10. [ ] FPS ≥ 60 com vários congelados na tela.
```
