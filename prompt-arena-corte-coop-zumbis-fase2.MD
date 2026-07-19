# Prompt (FASE 2 — guardar) — Arena Corte: modo co-op survival (zumbis + Brutamontes)

> NÃO colar agora. Fase 2 — depois que o shooter-base (boneco, 7 armas, munição, morte, mapa/portas) estiver fechado e jogável. Isto adiciona um MODO de jogo cooperativo PvE, não substitui o PvP. Reusa 100% o modelo autoritativo e os transportes existentes: os inimigos são entidades que o HOST simula e sincroniza no snapshot, igual aos players. Nada de novo em netcode.

## 0. Conceito
Modo **Survival Co-op**: os 3 jogadores (e bots, se quiser preencher) enfrentam ONDAS de inimigos crescentes, JUNTOS. Vence quem sobreviver mais ondas / cai quando todos morrem. É PvE — regras OPOSTAS ao PvP competitivo, por isso é um MODO selecionável no lobby, não uma mistura.

## 1. Regra co-op (o "trabalhar juntos" nasce daqui)
- **Sem friendly fire**: balas de players não causam dano a outros players neste modo (flag de modo `COOP`).
- **Inimigo comum**: zumbis miram em QUALQUER player vivo (o mais próximo/acessível).
- **Objetivo compartilhado**: sobreviver às ondas. Fim de partida quando todos os players estão mortos (ou down, se implementar revive).
- **(Opcional) Revive**: player morto vira "caído" por 10 s; um aliado que fica ~2 s ao lado o revive com HP parcial. Timer autoritativo (molde de `reloadingUntil`).
- **(Opcional) Munição compartilhada / drops de zumbi**: zumbi morto às vezes dropa munição (reusa o `AmmoDrop`/`WeaponDrop` existente).

## 2. Inimigos como entidades autoritativas (shared/enemies.ts)
- Nova entidade `Enemy { id, type, x, y, vx, vy, hp, state, target, timer }`. O HOST roda a IA de todos; posições/estado vão no snapshot (por inimigo: id, type 2b, x f32, y f32, hp 1B, state 2b ≈ ~11 bytes). Eventos: `enemySpawn`, `enemyHit`, `enemyDeath` (com type, pra gore/som).
- **Custo é de servidor** (CPU da IA + banda por inimigo): começar com POUCOS. Ver seção 5 (escala).
- Colisão dos inimigos com tiles sólidos/portas: lê `shared/map.ts` (mesma fonte; determinístico host+prediction). Players NÃO preveem a IA dos inimigos — posição de inimigo vem sempre do host; o cliente só interpola (como faz com players remotos).

## 3. IA = máquina de estados (simples de propósito)
Cada inimigo roda um `switch(state)` no `stepEnemy` do host:
- `IDLE`: parado/vagando devagar; se um player entra no `aggroRange` → `CHASE`.
- `CHASE`: move na direção do player-alvo (o mais próximo alcançável); reavalia alvo a cada ~0.5 s.
- `ATTACK`: ao encostar (dist < `attackRange`), hesita `windupMs` (telegrafa o golpe), aplica dano ao player e entra em `cooldownMs`, depois volta a `CHASE`.
- `DYING`: hp ≤ 0 → emite `enemyDeath` (dispara gore por type no cliente) e remove.
- **Separação**: inimigos não empilham — pequeno empurrão entre inimigos próximos (evita "trem" de zumbis num pixel só). Barato (grid espacial que já existe pra colisão).

## 4. Tipos de inimigo

### 4.1 Zumbi comum (`type 0`)
- hp baixo (~40), lento (~70 px/s), dano de contato médio, aggroRange 260, attackRange 22, windup 300 ms. É a massa das ondas.
- Sprite: gerar no PixelLab (perfil, 4-8 frames de walk, mesma paleta) OU procedural (silhueta esverdeada/podre); gore de morte reusa o sistema por causa (`enemyDeath` carrega o type).

### 4.2 Brutamontes (`type 1`) — o monstro grande, gordo e RÁPIDO
O "corre atrás de mim/dos bots pra matar":
- **Grande e gordo**: sprite ~2–2.5× o tamanho de um player; hitbox maior; sombra grande.
- **Corre** (não é lento como o zumbi): velocidade ALTA em rajada — alterna `CHASE` normal com **investida** (`CHARGE`): quando alinhado com um player dentro de ~300 px, telegrafa por ~500 ms (agacha/ruge, som grave) e dispara numa reta rápida (~320 px/s) por ~1 s; se acerta um player, dano alto + knockback; se bate numa parede, fica **atordoado** ~1.5 s (janela pra revidar — mecânica clássica de "brute").
- hp alto (~350) → exige os players FOCAREM juntos (reforça o co-op). Perseguição implacável do player mais próximo entre investidas.
- Aparece a partir de uma onda mais alta (mini-boss) ou 1 por onda a cada N ondas.
- Estado extra na máquina: `CHASE ⇄ CHARGE(windup→dash→stun)`. Autoritativo; o dash é impulso em `vx/vy` (mesmo motor do knockback da água).
- Feedback: tremor de tela leve nos passos do Brutamontes (só quando perto do próprio player), rugido audível por distância, indicador na direção dele se estiver fora da tela.

## 5. Ondas (spawner autoritativo) — TETO FIXO DE 7 ZUMBIS
- **Máximo 7 zumbis vivos ao mesmo tempo, SEMPRE** (hard cap). O `WaveManager` nunca deixa passar de 7 no mapa — se a onda pediria mais, os extras só spawnam conforme os vivos morrem (fila), mantendo o teto.
- Ondas: onda N define quantos zumbis no TOTAL matar (ex.: onda 1 = 7, onda 2 = 10, onda 3 = 14...), mas sempre no máximo 7 na tela; o resto entra à medida que os da tela caem. Brutamontes a partir da onda 4 conta à parte (1 Brutamontes + até 7 zumbis).
- Spawns em bordas do mapa / fora da visão dos players (nunca em cima deles). HUD: número da onda, inimigos restantes na onda, players vivos.
- **Perf: com teto de 7, NÃO precisa de flow field nem IA escalonada.** Cada zumbi pode rodar A* simples até o player e IA a 30 Hz — 7 entidades é carga trivial de CPU e de banda (~77 bytes no snapshot). Manter só o grid espacial de separação (que já existe) pra eles não empilharem. Isto roda folgado inclusive no Durable Object online (não empurra pra fora do grátis).

## 6. Rede — invariáveis
- Inimigos são autoritativos: cliente adulterado não move nem mata inimigo localmente; tudo vem do host.
- Snapshot cresce com o nº de inimigos vivos (~11 bytes cada) — controlar pelo teto de spawn.
- Gore/som/tremor dos inimigos = client-side, disparado por eventos (`enemyHit`/`enemyDeath` com type). Zero física de fluido; zero estado cosmético na rede.
- Modo `COOP` é selecionado no lobby (junto de Online/Local); PvP e co-op NUNCA na mesma partida.

## 7. Critérios de aceite binários
1. [ ] Modo Co-op selecionável no lobby; nele, friendly fire está OFF e o objetivo é sobreviver a ondas.
2. [ ] Zumbis perseguem o player mais próximo, contornam paredes/portas (colisão de map.ts) e atacam ao encostar com telegrafo de windup.
3. [ ] Inimigos são autoritativos: os 3 clientes veem cada inimigo na MESMA posição/estado (interpolados, sem prever IA localmente).
4. [ ] Brutamontes é ~2× o player, corre em investidas telegrafadas, causa dano alto + knockback, e fica atordoado ao bater na parede.
5. [ ] Focar fogo no Brutamontes (hp alto) é necessário — um player sozinho não o derruba fácil (incentivo ao co-op).
6. [ ] WaveManager cria ondas crescentes; Brutamontes entra a partir da onda definida; HUD mostra onda/inimigos/players vivos.
7. [ ] Gore e som de morte diferem por tipo de inimigo (via `enemyDeath` com type); tremor/rugido do Brutamontes são client-side por distância.
8. [ ] Com 150 ms de latência: posições dos inimigos vêm do host sem rubber-banding; hits validados no servidor.
9. [ ] Nunca há mais de 7 zumbis vivos ao mesmo tempo (hard cap); extras entram por fila conforme os vivos morrem. FPS ≥ 60 com 7 zumbis (+ Brutamontes) + 3 players; snapshot de zumbi ~77 bytes.
10. [ ] `muzzlePoint`, munição, portas, transportes e netcode existentes inalterados; PvP intacto como modo separado.
11. [ ] (Se implementado) Revive: player caído é revivido por aliado próximo em ~2 s, com timer autoritativo.