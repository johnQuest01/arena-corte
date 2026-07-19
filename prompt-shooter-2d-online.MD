# Prompt de produção — Shooter 2D, 3 jogadores — online (global) e local (mesma sala)

> Cole isto no Cursor (Grok agora, Opus depois — funciona igual). É uma spec de produção com critérios de aceite binários. Não peça confirmação a cada passo: implemente o conjunto e no fim rode a checklist.

---

## 1. Contexto e objetivo

Construa um **shooter 2D top-down** (arena deathmatch) para **exatamente 3 jogadores**, com o menor ping possível e custo de infra alvo **US$ 0** (plano gratuito).

O jogo suporta **dois modos**, escolhidos no lobby:
- **Online (global):** os 3 jogadores em qualquer lugar do mundo.
- **Local / offline (mesma sala):** os 3 no mesmo cômodo, lado a lado, na mesma rede — **sem depender da internet**.

Ver seção 6 para a lógica que faz os dois conviverem sem duplicar código.

Verdade de engenharia que rege todo o projeto: **não dá para vencer a velocidade da luz.** Entre jogadores em continentes diferentes existe um piso físico de latência (~180-280ms ida e volta em rotas intercontinentais) que nenhum código remove. O objetivo do netcode abaixo é **esconder toda a latência que é escondível** e tornar o jogo responsivo *apesar* do piso — não fingir que o piso não existe. (No modo local, esse piso praticamente não existe: mesma sala = ~1-5ms.)

---

## 2. Stack (exato — não substitua)

**Servidor (autoritativo) — modo online:**
- Cloudflare Workers + **Durable Objects** via **PartyServer** (`partyserver`), TypeScript.
- Uma sala de jogo = **um Durable Object**. O Worker faz o upgrade do WebSocket e roteia para o DO da sala.
- **WebSocket Hibernation API** obrigatória (sem ela, o DO cobra por duração ociosa e sai do grátis).

**Servidor (autoritativo) — modo local:**
- Um processo **Node** local (`local-host.ts`) que **reusa o mesmo código de simulação** (`sim.ts`/`protocol.ts`) para hospedar partidas na rede local, servindo página + WebSocket na LAN.
- (Opcional) **WebRTC** no navegador para o caso só-celular. Ver seção 6.

**Cliente:**
- React + Vite + TypeScript.
- Render do jogo em **HTML5 Canvas 2D** (loop próprio via `requestAnimationFrame`), separado da UI React.
- Conexão via **PartySocket** (`partysocket`) no online — reconexão, buffering e resiliência de fábrica.

**Deploy:**
- Frontend no Vercel (grátis). Servidor online no Cloudflare (grátis). Modo local não precisa de deploy — roda na máquina do host.

---

## 3. Arquitetura de rede

- Modelo **client-server autoritativo**. O host é a única fonte da verdade do estado do jogo. Cliente nunca decide dano, morte ou colisão — só **prevê** e **envia inputs**.
- **Tick do servidor: 30 Hz** (a cada ~33ms o host avança a simulação e emite um snapshot).
- **Snapshot** = estado serializado compacto (binário via `ArrayBuffer`/`DataView`, não JSON) contendo, por jogador: id, posição (x,y), ângulo, velocidade, hp, e o `lastProcessedInputSeq` daquele cliente. Inclui também projéteis ativos e eventos (tiro, hit, morte, respawn) do tick.
- **Input do cliente → host:** comandos com número de sequência (`seq`) crescente, enviados a cada frame do cliente (60 Hz), agregados se necessário. Formato binário.
- **Transporte abstraído:** toda a comunicação passa por uma interface `Transport` (seção 6). O modelo autoritativo acima vale **em qualquer modo** — só muda *quem/onde* é o host e *como* os bytes trafegam.

---

## 4. Netcode — o coração (é isto que faz o ping "sumir")

Implemente as quatro camadas. Rollback é a quinta, opcional-avançada. Todo o netcode desta seção é **agnóstico de transporte**: funciona idêntico no online (nuvem) e no local (LAN/WebRTC). Só o `Transport` (seção 6) muda.

### 4.1 Client-side prediction (previsão local)
- Ao gerar um input, o cliente aplica **imediatamente** o efeito no **próprio** player (movimento), sem esperar o host.
- Guarde um histórico dos inputs enviados (com `seq`).
- Ao chegar um snapshot: pegue a posição autoritativa do próprio player + o `lastProcessedInputSeq`, descarte os inputs já processados, e **re-aplique** (replay) os inputs pendentes a partir do estado autoritativo. Isso é **reconciliação**. Se o resultado divergir do previsto, corrija suavemente (ver 4.4 smoothing), sem teleporte brusco.

### 4.2 Entity interpolation (jogadores remotos)
- Os **outros** jogadores nunca são previstos; são **interpolados**.
- Mantenha um buffer dos 2+ últimos snapshots e renderize os players remotos num tempo **atrasado em ~100ms** (interpolation delay) em relação ao mais recente, interpolando posição/ângulo entre snapshots. Isso troca 100ms de "atraso visual" por movimento perfeitamente suave (sem teleporte/jitter).

### 4.3 Lag compensation (validação de tiro justa)
- Ao processar um tiro, o host **rebobina** o estado dos alvos para o instante que o atirador realmente via (timestamp do input menos a interpolation delay do atirador) e valida o hit contra as posições daquele momento.
- Assim, "eu mirei e acertei o que estava na minha tela" vira acerto válido, mesmo com ping alto. Guarde um ring buffer com ~1s de histórico de posições no host para o rewind.

### 4.4 Smoothing de correção
- Correções de reconciliação e de interpolação nunca aplicam salto instantâneo: interpole o erro ao longo de ~100-150ms (error smoothing) para o olho não perceber o ajuste.

### 4.5 Rollback netcode (camada avançada — implemente atrás de flag `USE_ROLLBACK`)
- Simulação **determinística** e com passo fixo (fixed timestep, matemática inteira/fixed-point para reprodutibilidade).
- Cada cliente prevê os inputs remotos (assume "repetir último input") e simula à frente. Ao chegar o input real, faz **rollback** ao frame correspondente e **re-simula** até o presente.
- É o que torna jogo entre continentes o mais responsivo possível. Só ative depois que 4.1-4.4 estiverem sólidas; é mais complexo e exige que toda a lógica de jogo seja determinística.

---

## 5. Seleção de região e latência (modo online)

- Ao criar a sala online, mensure o RTT dos 3 jogadores para 2-3 regiões candidatas (ping via um endpoint leve por região) e **fixe o Durable Object na região que minimiza o PIOR ping do grupo** (não a média — o objetivo é ninguém ficar horrível). Use location hints do DO.
- Exiba na HUD, para cada jogador, seu ping atual ao host (verde < 60ms, amarelo 60-120ms, vermelho > 120ms). Transparência: o jogador entende se está longe.
- Reconexão: se um jogador cair, o PartySocket reconecta e o host faz resync completo do estado.

---

## 6. Modos de jogo — online (global), local (mesma rede) e offline

**Princípio central: abstraia o transporte.** A simulação (seção 4) e a lógica de jogo NÃO sabem como os bytes viajam. Defina uma interface única:

```ts
interface Transport {
  isHost: boolean;
  send(data: ArrayBuffer): void;
  onMessage(cb: (data: ArrayBuffer, fromId: string) => void): void;
  onPeerJoin(cb: (id: string) => void): void;
  onPeerLeave(cb: (id: string) => void): void;
  close(): void;
}
```

Trocar de modo = trocar a implementação do `Transport`. O netcode, o render e o gameplay não mudam **nada**. Em qualquer modo, o **host** roda a simulação autoritativa (seção 3) e os outros são clientes.

### 6.1 `CloudTransport` — online, alcance global
PartySocket → Durable Object (seções 2–5). Precisa de internet. O "host" autoritativo é o próprio Durable Object na nuvem.

### 6.2 Local, mesma rede — funciona OFFLINE (lado a lado, mesmo cômodo)
Na mesma rede **não existe CGNAT no caminho**, então dá pra hospedar direto entre os aparelhos, sem nuvem e sem internet. Duas variantes, conforme o hardware disponível na sala:

**6.2a — `LanHostTransport` (host num computador — recomendado quando há um notebook/PC):**
- Um comando `npm run host` sobe um processo local em **Node** que **reusa o mesmo `sim.ts` e `protocol.ts`** do servidor, escutando na LAN.
- Esse processo serve **duas coisas** na rede local, na mesma porta: (1) a página do jogo em **HTTP** e (2) o **WebSocket** do jogo (ex.: `http://192.168.0.10:8787`).
- Os outros 2 jogadores abrem **essa URL local** no navegador — o host mostra a URL + um **QR code** que abre ela. Todos jogam.
- **100% offline** — só precisa de rede local (roteador WiFi ou hotspot de um celular). Latência de mesma sala: ~1-5ms. Melhor experiência possível.
- **Por que servir a página localmente:** se a página viesse do Vercel (HTTPS), o navegador **bloquearia** a conexão `ws://` local por *mixed content*. Servindo a página em HTTP a partir do próprio host, tudo é HTTP e não há bloqueio.
- **Por que um processo e não só o navegador:** uma aba de navegador **não consegue** abrir uma porta pra outros conectarem. Por isso o host aqui é Node (trivial num PC).

**6.2b — `WebRtcTransport` (só navegadores — quando todos estão no celular, sem PC):**
- Todos no navegador; um deles é o **peer host** e roda a simulação autoritativa na própria aba.
- Dados por **WebRTC data channels** (`RTCDataChannel` em modo unreliable/unordered, equivalente a UDP) — baixa latência, tráfego **direto entre os aparelhos na LAN**.
- **Sinalização** (troca inicial de SDP/ICE):
  - Se a rede local tiver internet: use o Durable Object só como **sinalizador** (apresenta os pares); os dados fluem direto na LAN.
  - **Totalmente offline:** sinalização por **QR code / código manual** — o host gera um QR com a oferta, o outro escaneia e devolve a resposta por QR. No mesmo cômodo, escanear QR é instantâneo.
- **Requisito pra offline puro:** como não há internet pra carregar a página, o jogo precisa estar **cacheado como PWA** (visitado uma vez com internet, o service worker guarda os assets) OU ser carregado de um host local (6.2a). Documente isso no README.

### 6.3 Escolha no lobby
Tela inicial com dois caminhos:
- **Jogar online** → criar/entrar por código (usa `CloudTransport`).
- **Jogar local (mesma rede)** → "Hospedar nesta máquina" (6.2a, se rodando como processo host) ou "Entrar num host local" (escaneia o QR ou digita `IP:porta`). Só-navegador cai no 6.2b.
- Detecte o contexto: rodando como processo host → oferece 6.2a; navegador puro → 6.2b.

### 6.4 Regra honesta: NÃO misture local + remoto na mesma partida
Um jogador remoto **não alcança** um host local atrás do CGNAT — é exatamente o problema que a nuvem resolve. Portanto:
- **Todos no mesmo cômodo e quer offline** → transporte local (6.2a/6.2b).
- **Qualquer jogador remoto na partida** → todos usam `CloudTransport`. Os que estão juntos na sala continuam com ping baixo, porque o Durable Object fica numa região próxima do grupo.

Ou seja, "online ou offline juntos" é uma **escolha de modo** no lobby — não uma mistura. Cada modo usa o transporte certo, com o **mesmo netcode e o mesmo gameplay** por baixo.

### 6.5 Seleção automática de modo (o sistema recomenda) — com override manual

Ao criar/entrar numa sala, o sistema **mede e recomenda** o melhor modo, sem o jogador precisar entender de rede. Requer um instante de internet no lobby (só pra medir); a partida em si pode depois rodar offline.

**O sistema não adivinha — ele sonda.** Fluxo de decisão, nesta ordem de preferência:

1. **Sondar LAN direto.** Tente conectar os peers por WebRTC usando candidatos ICE locais. Se todos conectam direto com latência de rede local (< ~10ms) → **recomenda Offline (mesma rede)**. Ping ~1-5ms, e a partida roda sem internet.
   - Pista de apoio: o sinalizador compara o **IP público** dos jogadores. Mesmo IP público = forte indício de mesma rede — **mas confirme sempre com a sondagem real**, porque o CGNAT pode dar o mesmo IP público a casas diferentes (mesmo IP **não prova** mesma LAN).
2. **Mesma região online.** Meça o RTT de cada jogador às regiões candidatas. Se todos estão perto de uma mesma região (ex.: todos no Brasil, ~10-40ms pra São Paulo) → **recomenda Online, região Brasil**. Ótimo ping.
3. **Distantes.** Se os RTTs se espalham por regiões diferentes → **recomenda Online**, fixando a região que minimiza o **pior** ping, e mostra a estimativa honesta.

Sempre mostre a recomendação **com o motivo e o ping estimado**, por exemplo:
- "Vocês estão na mesma rede → jogar **offline** (ping ~2ms)."
- "Todos no Brasil → **online São Paulo** (ping ~25ms)."
- "Jogadores distantes → **online** (ping ~180ms; é a física da distância)."

**Override manual (ao criar a sala)** — o host escolhe:
- **Automático (recomendado)** — usa a decisão acima.
- **Forçar offline (mesma rede)** — vai direto pro transporte LAN (útil quando já sabem que estão juntos e querem sem internet).
- **Forçar online** — usa a nuvem mesmo estando perto (ex.: querem que a sala continue de pé se alguém sair do cômodo).

**Honestidade embutida:** se o host forçar um modo pior que o recomendado, mostre um aviso **leve e não-bloqueante** ("Vocês estão na mesma rede; offline teria ping menor") — informa, mas respeita a escolha. E deixe claro no README: a auto-detecção precisa de um instante de internet no lobby; começar 100% offline (sem nenhuma internet) exige escolher **Local** manualmente.

---

## 7. Módulo OPCIONAL: roteamento premium (pago) — DESLIGADO por padrão

> ⚠️ Leia antes de ligar. Isto **não resolve a física** — não deixa o pacote mais rápido que a velocidade da luz. Só remove o *desperdício de roteamento* acima do piso físico (caminhos tortos na internet pública). Ganho real: 0 a ~50ms dependendo de quão ruim está a rota. Para 3 jogadores, quase sempre **não vale o custo**. (Só afeta o modo online.)

- Deixe atrás de env flag `PREMIUM_ROUTING=off`.
- Documente no README: para ativar, o usuário habilita **Cloudflare Argo Smart Routing** (ou põe um servidor dedicado regional atrás de **AWS Global Accelerator**). Custo: alguns dólares/mês + tráfego. Verificar preço atual no provedor.
- Só recomende ligar **se** a HUD mostrar ping cronicamente vermelho E um traceroute indicar rota ineficiente (não só distância grande). Se a distância é o problema, dinheiro não ajuda.

---

## 8. Fluxo de sala (lobby)

- Tela inicial: o host escolhe **Automático (recomendado)** — o sistema mede e decide o melhor modo (ver 6.5) — ou força manualmente **Online** ou **Local (mesma rede)** (ver 6.3).
- **Online:** **Criar sala** (gera código curto de 6 caracteres para compartilhar) ou **Entrar com código** (conecta ao DO daquela sala).
- **Local:** **Hospedar nesta máquina** (mostra URL/QR da LAN) ou **Entrar num host local** (QR ou `IP:porta`).
- **Cap rígido de 3 jogadores.** O 4º recebe "sala cheia".
- Sala mostra os jogadores conectados e um botão **Iniciar** (habilitado com 2-3 jogadores). Host inicia.

---

## 9. Gameplay (mínimo jogável)

- Arena retangular com paredes/obstáculos. Câmera fixa mostrando a arena inteira (sem scroll, pra simplificar o netcode).
- Movimento top-down 8 direções (WASD) + mira pelo mouse (ângulo). Twin-stick no toque para mobile.
- Tiro: clique/toque dispara projétil na direção da mira, com cooldown. Projéteis são autoritativos no host.
- Colisão e dano **no host**. HP por jogador; ao zerar, morte + respawn após 3s em spawn aleatório.
- Placar de abates (kills) no topo. Partida por tempo (ex.: 5 min) ou por meta de kills; ao fim, tela de resultado e opção de revanche na mesma sala.

---

## 10. Design system (HUD, menus, telas)

Use o sistema visual do Bruno (consistência com os outros produtos):

- **Cores:** `--corte: #1F4A3D` (verde escuro, primária/estrutural), `--giz: #2F5FD0` (azul, destaque/ação). Derive tons de apoio a partir dessas duas; fundo neutro escuro para a arena.
- **Tipografia:** títulos e HUD em **Archivo**; números, código da sala, ping e placar em **Martian Mono** (monoespaçada).
- **Formas:** `border-radius: 0` em tudo (zero cantos arredondados).
- **Sombras:** offset shadows (sombra sólida deslocada, sem blur), no estilo neobrutalista.
- Sentence case nos textos. Sem emoji na UI.

Aplica-se só à camada de UI/HUD (React/DOM). O canvas do jogo segue estética própria coerente com a paleta.

---

## 11. Estrutura de arquivos (referência)

```
/server
  party/room.ts         // Durable Object da sala (PartyServer) — tick, estado, hibernation
  party/protocol.ts     // encode/decode binário de inputs e snapshots (COMPARTILHADO)
  party/sim.ts          // simulação autoritativa determinística (COMPARTILHADA)
  party/laghistory.ts   // ring buffer p/ lag compensation
  local-host.ts         // modo local 6.2a: processo Node que serve página HTTP + WS na LAN, reusa sim.ts/protocol.ts
  wrangler.toml
/client
  src/net/transport.ts        // interface Transport (contrato único)
  src/net/cloudTransport.ts   // 6.1 — PartySocket → Durable Object
  src/net/lanTransport.ts     // 6.2a — WebSocket a um host local na LAN
  src/net/webrtcTransport.ts  // 6.2b — RTCDataChannel + sinalização (nuvem ou QR)
  src/net/interpolation.ts
  src/net/prediction.ts
  src/net/reconciliation.ts
  src/game/loop.ts      // requestAnimationFrame, render canvas
  src/game/sim.ts       // simulação-espelho p/ prediction (MESMA lógica de party/sim.ts)
  src/ui/               // React: lobby (escolha de modo + QR), HUD, telas (design system)
  src/main.tsx
```

Regra crítica: a lógica de simulação do cliente (`client/src/game/sim.ts`) e do host (`server/party/sim.ts` / `server/local-host.ts`) deve produzir **resultados idênticos** para os mesmos inputs (compartilhe o módulo). Sem isso, prediction e rollback quebram.

---

## 12. Critérios de aceite binários (pass/fail — teste cada um)

1. [ ] 3 jogadores em redes/dispositivos diferentes entram na mesma sala **online** pelo código e jogam juntos.
2. [ ] Infra online roda 100% no plano gratuito (Cloudflare DO com Hibernation API + Vercel); sem cobrança.
3. [ ] Host é autoritativo: cliente adulterado não consegue causar dano/morte inválidos.
4. [ ] Tick do host a 30 Hz; snapshots binários (não JSON).
5. [ ] O próprio player responde ao input **sem esperar** o host (prediction ativa).
6. [ ] Reconciliação funciona: com 150ms de latência injetada, o próprio player não teleporta nem "borracha" de forma visível.
7. [ ] Jogadores remotos se movem **suaves** (interpolados), sem jitter, com ~100ms de interpolation delay.
8. [ ] Lag compensation ativa: com 150ms de ping, mirar no alvo visível na tela resulta em hit válido.
9. [ ] HUD mostra o ping de cada jogador com código de cor (verde/amarelo/vermelho).
10. [ ] A sala online é fixada na região que minimiza o **pior** ping do grupo (verificável trocando a localização simulada dos jogadores).
11. [ ] Cap de 3 jogadores é rígido; 4º recebe "sala cheia".
12. [ ] Morte, respawn (3s) e placar de kills funcionam e são consistentes entre os 3 clientes.
13. [ ] Reconexão: derrubar a conexão de um jogador e ele volta com estado ressincronizado.
14. [ ] Flag `USE_ROLLBACK` liga/desliga o rollback; com ela ligada e simulação determinística, partida se mantém consistente entre clientes.
15. [ ] Flag `PREMIUM_ROUTING=off` por padrão; README documenta honestamente que roteamento pago remove desperdício de rota, **não** a latência física, e não é necessário para 3 jogadores.
16. [ ] Interface `Transport` isola online/local: trocar de modo **não altera** netcode, render nem gameplay (mesmo `sim.ts`).
17. [ ] Modo local com host em PC (6.2a): os 3 jogam na mesma rede **com a internet desligada** (teste desligando a internet de verdade).
18. [ ] O host local serve a página em HTTP na LAN e mostra `IP:porta` + QR de entrada; **sem erro de mixed content**.
19. [ ] Modo local só-navegadores (6.2b): 2+ aparelhos conectam via WebRTC na LAN, com sinalização por QR quando offline.
20. [ ] Lobby oferece a escolha **Online** vs **Local (mesma rede)** com fluxo de hospedar/entrar em cada um.
21. [ ] Ping do modo local (mesma sala) é dramaticamente menor que o online, visível na HUD.
22. [ ] README documenta que local + remoto na mesma partida usa a nuvem (não host local), por causa do CGNAT.
23. [ ] No modo **Automático**, o sistema mede e recomenda um dos três: offline (mesma rede) / online mesma-região / online distante — mostrando o **motivo** e o **ping estimado**.
24. [ ] A recomendação de **offline** só dispara após **confirmar** conexão LAN direta real (não apenas por IP público igual).
25. [ ] Host pode sobrescrever a recomendação: **Automático** / **Forçar offline** / **Forçar online**.
26. [ ] Ao forçar um modo pior que o recomendado, aparece um aviso **leve e não-bloqueante** (informativo, respeita a escolha).

---

## 13. Ordem de implementação sugerida

1. Sala + lobby por código + cap de 3 (sem gameplay ainda).
2. Loop autoritativo 30 Hz + protocolo binário + movimento (sem prediction).
3. Prediction + reconciliação do próprio player.
4. Interpolation dos remotos.
5. Tiro autoritativo + colisão + dano + lag compensation.
6. HUD (ping, placar) com o design system.
7. Seleção de região por pior-ping (online).
8. Morte/respawn/fim de partida/revanche.
9. **Abstrair o `Transport`** e migrar o online pra usar a interface (refactor sem mudar comportamento).
10. **Modo local 6.2a:** processo Node servindo página + WS na LAN; entrar por `IP`/QR; testar offline (internet desligada).
11. **Escolha de modo no lobby** (Automático / Online / Local).
12. **Auto-seleção de modo** (6.5): sondar LAN → medir região → recomendar com motivo e ping estimado; com override manual.
13. (Opcional) **Modo local 6.2b** via WebRTC + sinalização por QR.
14. (Opcional) Rollback atrás de flag.
15. Rodar a checklist da seção 12.
