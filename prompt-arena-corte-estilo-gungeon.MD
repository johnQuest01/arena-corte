# Prompt-delta — Arena Corte: personagem estilo "Gungeon" (corpo em pé, de lado)

> Cole no Cursor. Altera SOMENTE `client/src/game/render.ts` (funções `drawPerson34` e `drawWeaponLayer`). Nenhuma mudança em shared/, protocolo, sim ou netcode — a origem da bala (muzzlePoint) e o hit continuam exatamente como estão.

## Objetivo visual (referência: Enter the Gungeon / Nuclear Throne)

Câmera continua top-down, MAS o personagem é desenhado **em pé na tela**: cabeça pra cima, pés pra baixo, corpo visto de perfil/frente — NUNCA rotacionado deitado no chão. A direção é comunicada por **espelhamento** (esquerda/direita) e pela **arma**, que gira ao redor do personagem mostrando a **silhueta lateral** de cada arma.

## Mudanças em `drawPerson34` (renomear para `drawPersonSide`)

1. **REMOVER toda rotação do corpo**: eliminar `ctx.rotate(dirAngle(legDir)...)` e `ctx.rotate(dirAngle(bodyDir)...)`. Pernas e tronco são desenhados sempre no eixo vertical da tela.
2. **Flip horizontal pela mira**: se `cos(p.angle) < 0` (mirando pra esquerda), aplicar `ctx.scale(-1, 1)` no grupo do corpo. Só dois lados — sem 8 direções.
3. **Anatomia em pé (perfil ~22 px de altura, paleta LOADOUTS)**, de baixo pra cima:
   - Pés/sapatos: 2 retângulos na base; ao correr, alternam com `legSwing` (uma perna à frente, outra atrás — deslocamento em X, não rotação).
   - Pernas/calça: 2 retângulos verticais que acompanham o swing.
   - Tronco/camisa: retângulo vertical com leve inclinação (skew X de ~0.06 na direção da mira dá dinâmica).
   - Braços: 2 retângulos curtos da cor da camisa apontando na direção da arma (do ombro até perto da coronha) — vendem o "segurando a arma".
   - Cabeça: círculo de pele ACIMA do tronco + cabelo (arco) — cabeça sempre no topo.
   - Mirando para cima (`sin(p.angle) < -0.3`): desenhar a arma ATRÁS do corpo (antes do tronco na ordem de desenho); mirando para baixo/lados: arma na frente. Isso replica a sobreposição correta do gênero.
4. **Manter** como estão: sombra elíptica no chão, bob de corrida, idle breathing (escala Y), bodyKick/kick do feel, alpha de morto, contorno azul do próprio player.
5. `legSwing` continua vindo da velocidade; parado, pés juntos.

## Mudanças em `drawWeaponLayer`

1. A arma continua girando pela mira contínua (`p.angle`) ao redor do personagem — isso NÃO muda (a origem visual precisa continuar casando com `muzzlePoint` do shared).
2. **Silhueta lateral** de cada arma (vista de lado, como em Gungeon): pistola com cabo pra baixo e guarda; fuzis com coronha, pente pra baixo, cano; sniper longa com luneta em cima; shotgun com bomba sob o cano; SMG curta com pente. Reaproveitar cores de `WEAPONS`, escala 14–30 px.
3. **Flip vertical quando mira pra esquerda**: se `cos(p.angle) < 0`, aplicar `ctx.scale(1, -1)` APÓS o rotate — senão a arma fica de cabeça pra baixo (cabo pra cima). Este é o detalhe clássico do gênero; teste girando a mira 360°.
4. Pivô da arma: próximo à "mão" (offset ~6 px à frente do centro do corpo), não no centro do personagem.
5. gunKick/recoil e muzzle flash continuam como estão.

## Critérios de aceite binários

1. [ ] O personagem aparece SEMPRE em pé na tela (cabeça no topo), nunca rotacionado deitado, em qualquer direção de mira.
2. [ ] Mirando à esquerda o corpo espelha; mirando 360° a arma nunca fica de cabeça pra baixo (flip vertical correto).
3. [ ] Cada uma das 7 armas é identificável pela silhueta lateral a um metro da tela.
4. [ ] Mirando para cima a arma desenha atrás do corpo; para baixo/lados, na frente.
5. [ ] Corrida: pernas alternam, bob ativo; parado: idle breathing.
6. [ ] O tiro continua saindo EXATAMENTE do cano visível (muzzlePoint inalterado) com 150 ms de latência injetada — em si e nos remotos.
7. [ ] `git diff` limitado a `client/src/game/render.ts` (e imports): zero mudanças em shared/, protocol, sim, net.
