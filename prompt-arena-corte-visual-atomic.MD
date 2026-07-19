# Prompt — Arena Corte: upgrade visual estilo "Atomic Exile" + correções de tiro e feel

> Cole no Cursor (Grok/Opus). Repositório: `johnQuest01/arena-corte`. Spec de produção com critérios binários — implemente o conjunto e rode a checklist no fim. NÃO altere o netcode, os transportes nem o protocolo além do especificado na seção 2.

## 0. Direção de arte (leia antes de tudo)

Referência: **Atomic Exile** (Steam) — shooter **top-down** com pixel art em **perspectiva 3/4**: a câmera segue de cima, mas os personagens são desenhados mostrando o corpo inteiro (cabeça, tronco, pernas), como Zelda/Fallout clássico. NÃO é vista de perfil/plataforma.

Consequência arquitetural: esta é uma mudança de **render apenas**. `shared/sim.ts`, transportes, prediction, interpolation e lag compensation ficam INTACTOS — exceto o fix cirúrgico da seção 2. Nenhuma mudança aumenta tráfego de rede: animação é 100% deduzida no cliente a partir do estado já sincronizado (posição, ângulo, velocidade, weapon, eventos de fire).

## 1. Personagens em 3/4 com 8 direções (substitui o top-down puro do Kenney)

- Substituir os sprites `top-down shooter` do Kenney por personagens **3/4 de corpo inteiro** com **8 direções** (S, SO, O, NO, N, NE, E, SE).
- Fonte de assets (ordem de preferência):
  1. **Desenho procedural por código** (já existe um fallback procedural em `render.ts` — evoluir ele para 3/4): cabeça, tronco, braços, pernas como retângulos/elipses da paleta `LOADOUTS` do `gear.ts`, desenhados por direção. Vantagem: zero dependência de asset, cores por jogador já funcionam.
  2. OU um pack CC0 de personagens 3/4 8-direções do itch.io/OpenGameArt (conferir licença CC0/CC-BY; registrar em `CHARS_LICENSE.txt`).
  - NÃO usar geração de imagem por IA para o sprite sheet (inconsistente entre frames).
- **Seleção de direção**: a direção do sprite vem do **ângulo da mira** (`p.angle`) quantizado em 8 setores de 45°: `dir = Math.round(angle / (Math.PI/4)) & 7`. O corpo aponta pra onde mira; as pernas podem usar a direção do MOVIMENTO se |mira − movimento| > 90° (strafe: pernas pra um lado, tronco pro outro) — implementar como camadas separadas (pernas / tronco+braços+arma).
- **Animação de corrida**: ciclo de pernas de 4–6 frames dirigido pela velocidade (`speed > 25`), com taxa de frames proporcional à velocidade (sprint anima mais rápido). Parado = frame idle com respiração sutil (escala Y ±1%).
- Manter o "bob" e o lean existentes, mas reduzir o skew (o 3/4 já dá leitura de corpo; skew forte distorce pixel art).

## 2. FIX crítico: origem da bala no cano (shared — único toque no sim)

Bug atual: a bala nasce em `(p.x, p.y)` (centro do corpo), mas o cano visível fica deslocado (comprimento da arma + offset lateral da mão). 

- Em `shared/gear.ts`, adicionar em `WeaponDef`: `muzzleForward: number` (px à frente ao longo da mira; ≈ length + 6) e `muzzleSide: number` (px perpendicular; ≈ 5, lado da mão).
- Em `shared/sim.ts`, calcular a origem no disparo:
  ```ts
  const ox = p.x + Math.cos(p.angle) * wpn.muzzleForward - Math.sin(p.angle) * wpn.muzzleSide;
  const oy = p.y + Math.sin(p.angle) * wpn.muzzleForward + Math.cos(p.angle) * wpn.muzzleSide;
  opts?.spawnBullet?.(p.angle, ox, oy, p.weapon);
  ```
- O mesmo cálculo vale para o host (server/party/sim.ts re-exporta o shared) e para a prediction do cliente — é determinístico, então NÃO quebra reconciliação nem lag compensation (o rewind do laghistory continua usando posições de players; só a origem do raio muda, igual nos dois lados).
- O render desenha muzzle flash e o primeiro ponto do rastro da bala EXATAMENTE em `(ox, oy)` usando os mesmos campos — uma única fonte de verdade (função `muzzlePoint(p, wpn)` no shared, importada pelo render).
- Throwables: aplicar o mesmo offset de origem.

## 3. Arma sempre visível (camada própria por cima do personagem)

- A arma NUNCA fica "escondida" dentro do sprite do personagem: desenhá-la como **camada separada** por cima do tronco, usando o desenho procedural já existente em `drawWeapon()` (manter as silhuetas distintas por arma).
- A arma rotaciona pelo ângulo REAL da mira (contínuo), mesmo que o corpo esteja quantizado em 8 direções — braços + arma seguem a mira, corpo segue o setor. Isso dá a leitura "corpo 3/4 + mira precisa" do gênero.
- Escala mínima legível: cada arma identificável à distância (silhueta + cor de `WEAPONS`), ~14–30 px.
- Quando a mira aponta pra esquerda (90°–270°), espelhar verticalmente a arma (evita cano "de cabeça pra baixo").

## 4. Recoil e game feel do tiro

Ao disparar (evento `fire` local por prediction; para remotos, pelo evento do snapshot):
- **Recuo da arma**: a camada da arma recua 3–4 px contra a direção da mira e volta com easing em ~90 ms.
- **Coice do corpo**: o sprite do tronco desloca 1–2 px pra trás por ~60 ms.
- **Screen shake**: APENAS para o próprio jogador, 2–3 px de amplitude, decaimento exponencial em ~120 ms; intensidade proporcional ao dano da arma (pistola menor, AK maior). Nunca aplicar shake por tiros de outros jogadores (enjoa).
- **Muzzle flash** já existe — mover para `(ox, oy)` da seção 2 e adicionar 2–3 fagulhas (linhas curtas com vida ~80 ms).
- **Casquinha ejetada** (opcional barato): retângulo 2×1 px ejetado perpendicular, gravidade fake, some em 400 ms.
- Tudo client-side; nada disso entra no protocolo.

## 5. Mais armas (data-driven em gear.ts)

Adicionar mantendo o formato atual (`WeaponDef` + entradas):
- **Shotgun** (id 4): 6 pellets por disparo com spread 0.22, dano 9/pellet, curta distância (bulletSpeed 420, vida da bala menor), cooldown 700 ms. Pellets: no host, spawnar N balas com ângulos espalhados; prediction mostra o leque.
- **SMG** (id 5): dano 12, cooldown 60 ms, spread 0.07, bulletSpeed 540.
- **Sniper** (id 6): dano 70, cooldown 1100 ms, spread 0.004, bulletSpeed 900, rastro mais longo e fino.
- Atualizar o clamp de `weapon` no sim (hoje `0..3`) para `0..WEAPONS.length-1`, o HUD de seleção e o ciclo de troca. `muzzleForward/muzzleSide` para todas.
- Balancear depois em playtest; valores acima são ponto de partida.

## 6. Mapa, interiores e portas (estilo Atomic Exile)

Referência de atmosfera: deserto pós-apocalíptico do Atomic Exile — areia, ruínas, prédios de tijolo/metal enferrujado, props de destroços. IMITAR as convenções do gênero com arte própria (procedural ou CC0); NÃO copiar sprites, tiles ou nomes do jogo original.

### 6.1 Tilemap em camadas
- Substituir a arena retangular por um **tilemap** em grade (tile 32 px), definido em `shared/map.ts` como dado (matriz de ids), com camadas desenhadas nesta ordem:
  1. **Chão** (areia, terra, piso interno de madeira/concreto) — sem colisão.
  2. **Paredes e props** (paredes de prédio, caixas, carros abandonados, barris) — com colisão de corpo E de bala (usar o `circleRect` existente; balas colidem com tiles sólidos e morrem com impacto visual de poeira/faísca).
  3. **Jogadores, balas, throwables** (camada atual).
  4. **Telhados** — por cima de tudo (ver 6.2).
- Paleta: tons de areia/ferrugem/oliva coerentes com a Resurrect 64 já usada. Tiles desenhados proceduralmente (retângulos + ruído de 2–3 tons por tile) OU pack CC0 (registrar licença).
- Mapa de teste: uma arena deserto com 3–4 prédios (tamanhos diferentes, 1–2 portas cada), carcaça de carro, caixas espalhadas como cobertura, e os SPAWNS atuais reposicionados fora dos prédios.
- A colisão do sim passa a ler os tiles sólidos de `shared/map.ts` (host e prediction usam a MESMA fonte — determinístico).

### 6.2 Interiores revelados (telhado com fade)
- Cada prédio declara em `shared/map.ts` sua **zona interna** (retângulo em tiles) e o conjunto de tiles de telhado.
- **Client-side puro**: quando o próprio player está dentro da zona interna de um prédio, o telhado DAQUELE prédio faz fade de alpha 1 → 0.15 em ~200 ms (easing); ao sair, volta. Cada cliente revela apenas os prédios onde SEU player está.
- Jogadores/balas dentro de um prédio cujo telhado está opaco para mim ficam ocultos por baixo do telhado (consequência natural da ordem de camadas — não esconder por lógica extra).
- Zero sincronização de rede para telhado.

### 6.3 Portas (estado autoritativo — única mudança de protocolo)
- Nova entidade em `shared/`: `DoorState { id, x, y, orient (h|v), open: boolean }`, declaradas no mapa.
- **Autoritativo no host**: porta fechada bloqueia corpo E bala; aberta não bloqueia. A colisão da porta entra no sim compartilhado (prediction idêntica).
- Interação: input `use` (tecla E / botão de toque) abre/troca o estado da porta mais próxima num raio de 28 px. Adicionar 1 bit `use` ao input no protocol.ts. Auto-fechar após 4 s sem ninguém no raio (timer no host).
- **Snapshot**: bitfield com o estado `open` de todas as portas (1 bit por porta; mapa de teste tem < 16 portas → 2 bytes). Eventos `doorOpen`/`doorClose` para tocar animação/som no momento certo.
- **Render**: a porta gira na dobradiça (0° fechada → 90° aberta) em ~150 ms com easing; desenhada na camada de paredes.
- **Lag compensation**: o rewind de hit deve considerar o estado da porta NO TICK do disparo (guardar o bitfield de portas no laghistory junto com as posições) — sem isso, tiro-através-de-porta diverge entre clientes.

### 6.4 (Opcional, flag `USE_VISION`) Linha de visão
- Polígono de visibilidade por raycasting a partir do próprio player contra tiles sólidos + portas fechadas; fora do polígono, máscara escura (alpha 0.55). Client-side puro. Implementar por último; não bloqueia os itens acima.

## 7. O que NÃO fazer

- Não mudar protocolo binário além de aceitar ids de arma novos (verificar bits reservados para `weapon` no protocol.ts; se o campo atual comporta 0–7, nada muda).
- Não adicionar estado de animação ao snapshot — animação é derivada no cliente.
- Não trocar a arquitetura de transportes/netcode.
- Não usar assets com licença desconhecida.

## 8. Critérios de aceite binários

1. [ ] Personagens renderizam em 3/4 com corpo inteiro visível (cabeça/tronco/pernas), em 8 direções conforme a mira.
2. [ ] Ciclo de corrida anima conforme a velocidade; parado tem idle sutil.
3. [ ] Com 150 ms de latência simulada, o tiro sai EXATAMENTE do cano visível da arma (muzzle flash, rastro e trajetória colineares), no próprio player e nos remotos.
4. [ ] O hit do servidor confere com a trajetória visual (testar mirando de raspão em obstáculo: se o cano passa, a bala passa).
5. [ ] A arma é visível e identificável em todos os personagens, rotacionando pela mira contínua, com espelhamento correto à esquerda.
6. [ ] Ao atirar: recuo da arma + coice do corpo + screen shake só no atirador local, com decaimento suave.
7. [ ] 7 armas selecionáveis funcionando (4 atuais + shotgun multi-pellet + SMG + sniper), com stats distintos perceptíveis.
8. [ ] Shotgun: os pellets do host e o leque da prediction têm a mesma origem e envelope de spread.
9. [ ] Nenhum campo novo no snapshot/protocolo (diff do protocol.ts limitado ao range de weapon, se necessário).
10. [ ] Jogo roda idêntico em online (cloud), LAN e offline — sem regressão de reconexão/prediction (rodar os testes manuais do prompt original: 150 ms injetados, sem rubber-banding visível).
11. [ ] Licenças de qualquer asset novo registradas em CHARS_LICENSE.txt (ou zero assets novos se procedural).
12. [ ] Mapa tilemap com 3–4 prédios, props e cobertura substitui a arena; balas e corpos colidem com tiles sólidos em host E prediction (sem rubber-banding com 150 ms injetados ao encostar em parede).
13. [ ] Entrar num prédio faz o telhado DELE (e só dele) sumir com fade em ~200 ms no meu cliente; para os outros clientes o telhado continua conforme a posição DELES.
14. [ ] Jogador dentro de prédio fica invisível para quem está fora (coberto pelo telhado) e visível para quem está dentro.
15. [ ] Porta fechada bloqueia corpo e bala; aberta não. Tecla E abre/fecha; auto-fecha em 4 s.
16. [ ] Estado das portas sincronizado por bitfield no snapshot: os 3 clientes veem a mesma porta no mesmo estado, com animação de dobradiça disparada pelos eventos.
17. [ ] Com 150 ms de ping, atirar no instante em que uma porta fecha resolve IGUAL nos 3 clientes (rewind da porta no laghistory) — sem "tiro fantasma" através de porta fechada.
18. [ ] Flag `USE_VISION` desligada por padrão; ligada, a máscara de visão respeita paredes e portas fechadas, 100% client-side.