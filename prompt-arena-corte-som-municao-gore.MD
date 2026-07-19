# Prompt — Arena Corte: som, munição, gore e juice ("fase carne")

> Cole no Cursor (Grok/Opus). Repositório `johnQuest01/arena-corte`. Spec com critérios binários. Implementar nesta ordem: A (som) → B (munição) → C (drops) → D (gore) → E (juice). Commitar ao fim de cada bloco.

## Regra de rede (vale para tudo abaixo)
- Autoritativo/sincronizado: munição, reload, drops de munição. Custo alvo: ≤ 4 bytes/jogador no snapshot + eventos de spawn/pickup.
- Client-side puro (ZERO protocolo): todo áudio, gore, partículas, decals, câmera. Gore é disparado pelos eventos que já trafegam (adicionar apenas `weaponId` ao evento de morte/hit existente).

## A. Áudio

### A.1 Assets (baixar via curl — CC0)
- Kenney "Shooter sounds" / "Impact sounds" / "Interface sounds" (kenney.nl/assets — zips diretos, CC0). Baixar, extrair para `client/public/assets/sfx/`, registrar em `SFX_LICENSE.txt`.
- Mapear por arma (escolher os samples mais graves/secos para AK e sniper, mais estalados para pistola/SMG): `pistol.ogg, m4a1.ogg, m16.ogg, ak47.ogg, shotgun.ogg, smg.ogg, sniper.ogg, reload.ogg, empty_click.ogg, pickup.ogg, explosion.ogg, hit_flesh.ogg, door.ogg, footstep_{1..3}.ogg`.
- Se algum som específico faltar no pack, gerar fallback com zzfx APENAS para UI/pickup/click — nunca para disparo de arma.

### A.2 Sistema (client/src/game/audio.ts)
- Web Audio API com pool de buffers pré-carregados (AudioContext único, decodeAudioData no preload; desbloquear no primeiro clique/toque).
- `playSfx(name, x?, y?)`: volume por distância ao próprio player (linear, raio audível ~700 px, mínimo 0.05) + pan estéreo leve pela posição X relativa; pitch aleatório ±6% para repetição não enjoar.
- Ganchos: disparo (evento fire local + remoto), reload início/fim, click de pente vazio, pickup, explosão, hit em jogador, porta, passos (a cada ciclo de perna quando speed > 25, alternando samples).
- Volume master + mute no HUD (persistir em memória; sem localStorage — usar estado React).

## B. Munição e reload (autoritativo)

### B.1 gear.ts — novos campos por arma
| arma | pente (magSize) | reserva máx (reserveMax) | reloadMs |
|---|---|---|---|
| Pistola | 12 | 60 | 900 |
| M4A1 | 30 | 90 | 1600 |
| M16 | 30 | 90 | 1700 |
| AK-47 | 35 | 120 | 1800 |
| Shotgun | 6 | 30 | 2200 |
| SMG | 40 | 160 | 1400 |
| Sniper | 5 | 25 | 2400 |

### B.2 Sim (shared — determinístico, host e prediction idênticos)
- Estado por jogador: `mag: number`, `reserve: number`, `reloadingUntil: number` (0 = não recarregando). Spawn/respawn: pente cheio + reserva cheia da arma inicial.
- Disparo só se `mag > 0` e não recarregando; cada tiro decrementa `mag` (shotgun: 1 do pente por disparo, não por pellet).
- `mag == 0` + fire → dispara evento client-side de `empty_click` (sem gastar nada) e inicia auto-reload se `reserve > 0`.
- Input: 1 bit `reload` (tecla R / botão). Reload: trava o disparo por `reloadMs`, ao fim move `min(magSize - mag, reserve)` da reserva pro pente. Trocar de arma cancela reload.
- Snapshot: `mag` (1 byte) + `reserve` (1 byte) por jogador. Evento `reloadStart` para o som/animação nos remotos.
- HUD: `30 / 90` grande perto da arma selecionada; barra de progresso de reload; número vermelho quando `mag == 0`.

## C. Drops de munição no chão (autoritativo)

- Entidade `AmmoDrop { id, x, y, amount }` no host. A cada 12–18 s (aleatório), spawnar 1 drop em tile livre (não sólido, fora de zona interna 50% das vezes), máx 5 simultâneos; despawn após 30 s.
- `amount`: 20–40 balas, somadas à RESERVA da arma atual ao pegar (cap em reserveMax; se cheio, não consome o drop).
- Pickup: colisão círculo do player com o drop (raio 16 px), resolvida no host; eventos `dropSpawn`/`dropTaken` no snapshot (posição + id — poucos bytes, só quando acontecem).
- Render: caixinha de munição (silhueta clara, cor de destaque da paleta) com flutuação senoidal leve + sombra; some com pop de partículas ao ser pega; som `pickup`.

## D. Sangue, morte e despedaçamento (client-side, por arma)

- Adicionar `weaponId` (ou `cause: weapon | explosion | fire`) aos eventos de hit e death existentes — única mudança de protocolo deste bloco (3 bits).
- Sistema de partículas em `client/src/game/gore.ts` (pool, máx ~400 partículas vivas; acima disso, descartar as mais antigas):
  - **Hit (não letal)**: 4–8 gotas de sangue na direção oposta ao tiro + flash branco de 50 ms no atingido + `hit_flesh`.
  - **Morte por pistola/SMG**: corpo cai (desenhar cadáver deitado — o sprite em pé rotacionado 90° com alpha 0.9) + poça de sangue que CRESCE por 2 s e PERSISTE como decal no chão.
  - **Morte por fuzil (M4/M16/AK)**: idem + 10–16 partículas de sangue com velocidade, que viram decals onde param.
  - **Morte por sniper**: separa 1–2 "gibs" (retângulos com as cores da roupa/pele do morto) arremessados na direção do tiro + rastro de sangue alongado.
  - **Morte por explosão (granada/molotov/bomba)**: DESPEDAÇA — 6–10 gibs (cabeça, tronco, membros como retângulos das cores do LOADOUT) com velocidades radiais, gravidade fake (desaceleram e param), cada gib deixa mini-rastro; sem cadáver inteiro. Som `explosion` + shake maior.
  - **Molotov/fogo**: partículas de chama no corpo por 1 s antes da queda.
- Decals (poças/manchas): canvas offscreen persistente por partida (desenha uma vez, nunca re-simula); limpar no início de cada partida; cap de 300 decals (acima, sobrescrever os mais antigos).
- Cadáveres e gibs ficam até o fim da partida (são decals após pararem). Respawn não remove o cadáver anterior.

## E. Juice (client-side, barato, alto impacto)

- Cápsulas ejetadas em TODO tiro (já parcialmente previsto): viram decals minúsculos onde caem.
- Poeira nos pés ao correr (2–3 partículas/passo) e derrapada ao mudar de direção brusco.
- Câmera: micro-zoom (1.00 → 1.015) por 80 ms no disparo do próprio player; shake já existente mantido; suavizar follow com lerp.
- Vinheta escura sutil nas bordas do canvas (radial, alpha 0.18) — dá profundidade imediata.
- Flash de dano na tela do PRÓPRIO player ao ser atingido (borda vermelha alpha 0.25, 120 ms) + som.
- Tiles: adicionar variação de detalhe (pedrinhas, rachaduras — 1 decal procedural aleatório a cada ~8 tiles, semente fixa por mapa para todos verem igual).
- Marcas de bala nas paredes onde balas colidem (decal escuro 2 px, persiste).

## Critérios de aceite binários

1. [ ] Cada uma das 7 armas tem som distinto; volume cai com a distância e tiros remotos soam mais baixos/pan correto.
2. [ ] Passos, porta, reload, click vazio, pickup, explosão e hit têm som; nada de som de disparo sintetizado.
3. [ ] Pente/reserva funcionam com os valores da tabela (AK: 35/120; fuzis: 30/90); R recarrega com trava de tempo; trocar de arma cancela.
4. [ ] Cliente adulterado não consegue atirar com pente vazio nem ignorar reload (validação no host).
5. [ ] HUD mostra `mag / reserva` + barra de reload; snapshot cresceu ≤ 4 bytes/jogador (verificar no encode).
6. [ ] Drops de munição aparecem aleatoriamente (12–18 s, máx 5), são pegos por colisão no host e os 3 clientes veem o mesmo drop no mesmo lugar/estado.
7. [ ] Hit não letal: sangue + flash; morte por pistola/fuzil/sniper/explosão produz efeitos DIFERENTES conforme a tabela; explosão despedaça em gibs com as cores do morto.
8. [ ] Poças, cadáveres, gibs, cápsulas e marcas de bala PERSISTEM até o fim da partida via canvas de decals (FPS estável com 200+ decals).
9. [ ] Gore/áudio/juice não adicionaram NENHUM campo ao snapshot além de: mag, reserve, eventos de drop e o weaponId/causa nos eventos de hit/morte.
10. [ ] Com 150 ms de latência injetada: reload, ammo e pickups não causam rubber-banding nem dessincronia visível entre os 3 clientes.
11. [ ] Licenças dos sons registradas em SFX_LICENSE.txt (tudo CC0).
