# Prompt — Arena Corte: Kill Feed + Feedback de Dano (ambos client-side)

> Repositório `johnQuest01/arena-corte` commit 2f39909. NADA aqui toca o protocolo, o sim ou a rede — os eventos JÁ existem e JÁ viajam. É puro cliente: consumir `death` e `hit` no `loop.ts` e desenhar no HUD/canvas. Implementar A (kill feed) e B (dano direcional). Reusar: `loop.ts` (já processa `e.kind === "death"`/`"hit"`), `this.feel` (efeitos de tela), `Hud.tsx` (overlay React), nomes de jogador `P{id+1}` já usados no scoreboard.

## Dados já disponíveis (NÃO recriar)
- Evento **death**: `{ kind:"death", a: killerId, b: victimId, x, y, weaponId: causeCode }` (sim.ts ~648). `weaponId` = arma/causa (há códigos especiais: 100 = ?, ver sim.ts 568; 0..6 = armas de `gear.ts`; explosão/gigante têm seus códigos).
- Evento **hit**: `{ kind:"hit", a: attackerId, b: targetId, x, y }` (sim.ts ~671). `b === 255`/`254` = hit em parede/ambiente (ignorar pra dano de player). Quando `b === this.selfId`, EU tomei dano; `a` é quem atirou; `x,y` é a posição do impacto (perto de mim).
- `this.selfId`, lista de players com `.x/.y` (pra achar a posição do atacante), `this.feel` (shake, e dá pra adicionar campos de overlay).

## A. Kill Feed (canto superior direito)
Objetivo: mostrar as últimas mortes, tipo "P1 🔫 P3", sumindo após alguns segundos.

1. **Coletar**: em `loop.ts`, no processamento de eventos, no `if (e.kind === "death")` (já existe um bloco), empurrar uma entrada num buffer `killFeed: { killerId, victimId, cause, at }[]` (manter no estado do loop/cliente). Cap ~5 entradas; descartar as mais antigas; cada entrada expira em ~5 s.
   - Traduzir `weaponId`/causa para um rótulo/ícone: arma (nome curto de `gear.ts`), explosão ("💥"/"granada"), gigante ("punho"/"gigante"), etc. Se `killerId === victimId` ou causa de auto-dano → "P3 se explodiu" / "P3 morreu".
   - `killerId` pode ser inválido (morte ambiental) → "P3 morreu".
2. **Render**: no `Hud.tsx`, um overlay no canto superior direito listando as entradas vivas (fade out ao expirar). Formato: `P{killer+1}  [arma]  P{victim+1}`. Cor: nome do próprio player (selfId) destacado (azul `--giz`); vítima em vermelho suave. Sentence case, fonte pequena (Martian Mono combina com o HUD atual).
3. Quando EU sou o killer, dar um leve realce (ex.: "VOCÊ eliminou P3") — reforço positivo.

## B. Feedback de dano (quando EU levo tiro)
Objetivo: o jogador entende que tomou dano e DE ONDE veio.

1. **Vinheta de dano**: em `loop.ts`, no `if (e.kind === "hit" && e.b === this.selfId)`, disparar `this.feel.hurt = Math.max(this.feel.hurt ?? 0, 1)` (novo campo, decai ~250 ms). No render, desenhar uma borda vermelha translúcida (alpha proporcional a `feel.hurt`) nas bordas do canvas — o "tomei dano" universal de FPS.
2. **Indicador direcional**: calcular a direção de onde veio o tiro e desenhar um arco/seta vermelha nessa borda por ~800 ms.
   - Direção = ângulo de `(attackerPos - myPos)`. Achar o atacante: player com `id === e.a` (usar `.x/.y` dele); se não achar (inimigo/gigante), usar o `x,y` do próprio evento como origem aproximada.
   - Desenhar o indicador na direção correspondente da borda da tela (converter ângulo → posição na moldura). Vários hits de direções diferentes = vários arcos.
   - Guardar num buffer `dmgArrows: { angle, at }[]` no cliente; expira ~800 ms.
3. **Número de dano flutuante (opcional)**: no ponto `x,y` do hit, subir um número pequeno com o dano (se o valor estiver disponível; se o evento não carrega o valor, mostrar só um tick de acerto — NÃO adicionar campo ao protocolo só pra isso). Fade + subida ~600 ms. Pode reusar o FxPool.
4. **Hitmarker (quando EU acerto alguém)**: no `if (e.kind === "hit")` com `e.a === this.selfId` e `e.b` sendo outro player/inimigo, desenhar um "X" curto no centro/na mira + tick de som sutil — confirma que o tiro acertou. (Reforço que todo shooter tem.)

## Regras
- ZERO mudança em `shared/`, protocolo ou netcode — só `client/src/game/loop.ts`, `render.ts`, `client/src/ui/Hud.tsx` e talvez um helper novo (`client/src/game/feedback.ts`). Confirmar por `git diff`.
- Buffers (killFeed, dmgArrows) vivem no cliente, expiram por tempo; nada sincronizado.
- Traduções de `weaponId`/causa: centralizar num mapa no cliente (reusar nomes de `gear.ts`).

## Critérios de aceite binários
1. [ ] Ao ocorrer uma morte, aparece uma linha no kill feed (canto sup. direito) "P{killer} [arma/causa] P{victim}", que some após ~5 s; máx ~5 linhas.
2. [ ] Morte por explosão/gigante/ambiente mostra a causa correta; auto-dano/ambiente vira "P{n} morreu".
3. [ ] Quando EU elimino alguém, o feed dá realce ("Você eliminou P{n}").
4. [ ] Ao levar tiro, borda vermelha pisca (vinheta de dano) proporcional ao hit.
5. [ ] Um indicador direcional vermelho aponta a direção de onde veio o dano (~800 ms); direções diferentes geram indicadores diferentes.
6. [ ] Quando EU acerto um alvo, aparece hitmarker (X + tick) confirmando o acerto.
7. [ ] `git diff` restrito ao cliente (loop/render/Hud/feedback); zero mudança em shared/protocolo/rede.
8. [ ] Funciona nos 3 clientes e com bots; FPS ≥ 60; nada quebra se um id de killer/attacker for inválido.
