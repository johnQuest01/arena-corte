# Prompt — Arena Corte: deixar o Gigante TEMÍVEL (juice)

> Repositório `johnQuest01/arena-corte`, commit d080332 (o Gigante JÁ existe: `SUMMON_GIANT` em shared/abilities.ts, `EnemyType 2` em shared/enemies.ts, `drawEnemy` em render.ts, `giantTargets` no render, `feel.shake` já em uso). NÃO reescrever o que existe — ADICIONAR camadas de juice. Medo vem 80% de comportamento/juice, 20% de sprite. Regra: presença/aura/telegrafo/som são client-side; só ajustes de balance tocam o shared. Zero mudança de netcode.

## Contexto do código atual (reusar, não recriar)
- `feel.shake = Math.max(feel.shake, X)` já é o sistema de screen shake (loop.ts já treme com passos do gigante ~linha 500-512). USAR o mesmo.
- `drawEnemy()` (render.ts ~597) desenha inimigos com `def.visualScale`, `bob`, estados (1 chase, 2/4 windup, 5 dash, 6 stun). O Gigante é `type 2`.
- `giantTargets: Map<giantId, {kind,id}>` já marca o alvo travado.
- `playSfx(name, x, y, listener)` toca som posicional por distância (audio.ts). Sons ficam em `client/public/assets/sfx/*.ogg`.
- `FxPool` / pool de partículas já existe (gore.ts, abilities_fx.ts).

## A. Presença física (o que MAIS assusta — client-side)
1. **Pisada com peso**: no `drawEnemy` do gigante, sincronizar o `bob` com um "impacto" — quando o pé desce (fase baixa do bob), disparar:
   - `feel.shake = Math.max(feel.shake, 2.2 * (1 - dist/560))` (só quando perto do próprio player; escalar por distância como já é feito).
   - Um anel de poeira no chão (2-3 partículas do FxPool) no ponto do pé.
   - Som `giant_step` posicional (ver seção D).
   - Cadência: a cada ciclo de passo (detectar cruzamento da fase baixa do bob, ~2x por segundo em CHASE).
2. **Sombra grande**: desenhar elipse de sombra proporcional ao `visualScale` do gigante (maior e mais escura que a dos players/zumbis), levemente à frente na direção do movimento.
3. **Massa ao virar**: o gigante já tem inércia no sim; no visual, inclinar levemente o sprite (skew ~0.08) na direção da mudança de rumo pra "vender" o peso.

## B. Aura e antecipação (client-side)
4. **Contorno/brilho de aggro**: durante CHASE, um leve halo vermelho pulsante ao redor do gigante (aumenta a frequência do pulso conforme ele se aproxima do próprio player). Reforça "ameaça ativa".
5. **Poeira/fumaça constante dos pés**: emissão contínua leve (1 part./passo) além da poeira de impacto — deixa rastro de "coisa pesada".
6. **Indicador de borda melhorado**: já há marca de alvo (`giantTargets`); adicionar, para o player que É o alvo, uma **seta na borda da tela** apontando pro gigante quando ele está fora de vista, pulsando MAIS RÁPIDO quanto menor a distância (o alvo sente ele chegando). Cor de perigo (vermelho).
7. **Marca no alvo**: intensificar a marca existente sobre a cabeça do alvo travado — pulso vermelho + texto/ícone "ALVO" só pra quem é o alvo (usar `giantTargets`).

## C. Telegrafo do golpe (o momento de pânico — client-side, lê estado do sim)
8. Quando o gigante entra em WINDUP de ataque (estado 2/4) perto do alvo:
   - Flash/contorno **vermelho forte** no gigante por ~150 ms (o "ele VAI bater").
   - Braço/parte superior levantando visível (se sprite procedural, animar; se sprite pronto, usar frame de attack).
   - `feel.shake` pequeno crescente durante o windup (antecipação).
   - Som `giant_roar_short` no início do windup.
9. No IMPACTO do golpe (o kill + knockback já são autoritativos — NÃO mexer): no cliente, `feel.shake = Math.max(feel.shake, 6)`, burst de partículas de impacto, e desenhar o corpo do alvo sendo arremessado (o knockback em vx/vy já existe; só garantir o FX de impacto + som `giant_hit`).

## D. Som (metade do medo — precisa de assets novos CC0)
Faltam sons de gigante na pasta `sfx/`. Baixar 3 sons CC0 (Kenney/Sonniss/freesound CC0) e registrar em SFX_LICENSE.txt:
- `giant_step.ogg` — pisada grave/baque (tocar por passo, seção A).
- `giant_roar.ogg` — rugido longo na INVOCAÇÃO (evento de spawn do gigante) + `giant_roar_short.ogg` no windup do golpe.
- `giant_hit.ogg` — impacto pesado no golpe que mata.
- Todos via `playSfx(name, gx, gy, listener)` (posicional; mais alto quanto mais perto). Fallback: se algum faltar, usar `explosion`/`hit_flesh` existentes (não quebrar).

## E. Sprite (a MENOR camada — só depois do juice)
10. O sprite atual do gigante pode continuar; só DEPOIS de A-D avaliar. Se trocar: humanoide massivo, postura curvada/ameaçadora, silhueta escura contrastando com a arena, com frames de walk e de attack (windup). Fonte: Aseprite (desenho manual — recomendado pra poucos inimigos) ou pack CC0. Integrar via manifest (art.ts) com fallback procedural. NÃO bloquear o juice esperando o sprite.

## Balance (único toque possível no shared — só se necessário)
11. Se, com o juice, o gigante ficar fácil/difícil demais de escapar, ajustar APENAS `speed`/`radius`/`attackRange` do `EnemyDef` do type 2 em shared/enemies.ts. NÃO alterar a lógica de perseguição, o knockback, nem `muzzlePoint`.

## Critérios de aceite binários
1. [ ] Passos do gigante tremem a tela (escalado por distância) + poeira no pé + som `giant_step`, em cadência de caminhada.
2. [ ] Sombra do gigante é visivelmente maior/mais escura que a dos demais; sprite inclina com o peso ao virar.
3. [ ] Halo de aggro vermelho pulsa mais rápido conforme ele se aproxima do próprio player.
4. [ ] Quem é o alvo vê seta de borda (fora de vista) pulsando mais rápido perto + marca "ALVO" intensificada.
5. [ ] No windup do golpe: flash vermelho + shake crescente + rugido curto; o alvo "sente" o golpe chegando.
6. [ ] No impacto: shake forte + partículas + corpo arremessado (knockback autoritativo inalterado) + som de impacto.
7. [ ] Invocação toca rugido longo; todos os sons são posicionais (mais altos perto) e CC0 registrados em SFX_LICENSE.txt.
8. [ ] Todo o juice é client-side: `git diff` sem mudanças em netcode/protocolo; no shared, no máximo ajuste de números do EnemyDef type 2.
9. [ ] FPS ≥ 60 com o gigante + partículas + tremor ativos; o gigante continua autoritativo e idêntico nos 3 clientes.
10. [ ] Sprite do gigante inalterado OU trocado via manifest com fallback — sem quebrar se o asset faltar.
