# Arena Corte — shooter 2D (3 jogadores)

Deathmatch top-down com **host autoritativo**, netcode (prediction, reconciliação, interpolação, lag compensation) e dois modos que compartilham a mesma simulação:

| Modo | Transporte | Host | Internet |
|------|------------|------|----------|
| Online (global) | `CloudTransport` → PartySocket → Durable Object | Cloudflare DO | Sim |
| Local (mesma rede) | `LanClientTransport` → Node `local-host` | Processo Node na LAN | Não (só Wi‑Fi/hotspot) |
| Local só-navegador | `WebRtcTransport` (opcional) | Peer host na aba | Sinalização: nuvem ou QR |

**Não misture** jogador remoto + host LAN na mesma partida (CGNAT). Se alguém estiver longe → todos usam online.

Layout da UI/HUD inspira-se no clima wasteland top-down de *Atomic Exile* (FOV, barra de HP, arena austera), com o design system do Bruno: `--corte` / `--giz`, Archivo + Martian Mono, `border-radius: 0`, sombras offset.

Sprites/base: Kenney.nl · paleta: Lospec · efeitos (muzzle, trail, bob, sombra): ver `informations.MD`.

---

## Stack

- **Cliente:** React + Vite + TypeScript + Canvas 2D
- **Online:** Cloudflare Workers + Durable Objects via PartyServer (Hibernation API)
- **Local:** Node (`server/local-host.ts`) serve HTTP + WebSocket na LAN
- **Deploy alvo US$ 0:** frontend Vercel + Worker Cloudflare free; local não precisa deploy

---

## Estrutura

```
/shared          protocol.ts, sim.ts, laghistory.ts, constants.ts, cosmetics.ts
/server
  party/room.ts  Durable Object (tick 30 Hz)
  local-host.ts  host LAN
  wrangler.toml
/client
  src/net/       Transport + modeSelector + prediction/interp/reconcile
  src/game/      loop, render, input, world (mapa), character (boneco),
                 capes (pano), shield (escudo), powers_fx
  src/ui/        lobby + HUD + Wardrobe (guarda-roupa)
```

---

## Visual (tudo desenhado por código)

- **Mapa** (`client/src/game/world.ts`): ruas com faixas e zebras, meio-fio, calçadas, terrenos, praças, pisos internos, paredes, carros, caixas, barris e postes. É pintado em blocos de 256 px com cache LRU (≈30 MB no Full, ≈10 MB no Leve). Por frame só copia os blocos visíveis. Bloco novo tem orçamento de ~6 ms por frame (renascer longe não trava): o que falta aparece por alguns frames como uma prévia borrada do mapa.
- **Proporção**: boneco com ~76 px de altura (`CHAR_SCALE` 0.95), carros de 4×2 tiles estacionados numa faixa, casas de 8–11 tiles. A câmera aproxima um pouco (zoom base 1.12, 1.25 no celular) pra compensar o boneco menor.
- **Boneco** (`character.ts`): 8 direções, idle/caminhada, com camadas de pele, cabelo, roupa, armadura, calçado e capacete. O boneco antigo (sprite) continua como corpo **"Rascunho"**, com as capas, as botas e o escudo antigos.
- **Capas** (`capes.ts`): física de pano (verlet, 7 pontos) em todas as capas, cosméticas e de habilidade.
  - O desenho é de tecido: dobras que ondulam com o vento, brilho de seda, gola com forro e barras bordadas (arminho na Real, pedras na Dourada e na Esmeralda).
  - A **Sombria** é a capa das trevas: forro carmesim, símbolo rubro nas costas e uma barra que se desfaz em sombra. No visual Novo de poderes ela solta fumaça das trevas, deixa uma aura com garras de sombra no chão e explode em sombra quando o dono lança um poder.
  - As outras capas também soltam efeitos próprios: brilhos dourados, faíscas verdes, rastro de arco-íris e poeira na esfarrapada.
  - A **Capa de Recuo** (poder) ganhou costuras de energia que acendem no dash e clones-silhueta pelo caminho. Em quem veste a Sombria, ela vira a versão das trevas: preta com costuras rubras e fumaça escura.
  - As capas "Rascunho" continuam com o desenho antigo.
- **Escudo Estelar** (`shield.ts`): inspirado no escudo do Capitão América. Fica nas costas quando equipado e é erguido na frente quando ativo.
- **Armas** (`guns.ts`): as 7 armas desenhadas em código (pistola, M4, M16, AK, escopeta, SMG e sniper). Os sprites antigos continuam como estilo **"Rascunho"**. Só o desenho muda: dano, cadência, pente e alcance são os mesmos.
- **Poderes** (`fx2.ts` + `fx2_core.ts`, Gigante em `giant2.ts`): visual novo dos 12 poderes, com partículas com altura e gravidade, brilho aditivo com sprites em cache, anéis de choque e marcas no chão:
  - rajada d'água com espuma e poças;
  - golem de pedra com veias de magma;
  - chamas nos calcanhares (Botas);
  - rastro rosa (Capa);
  - barreira hexagonal (Escudo Estelar);
  - fissura de magma com buraco de lava (Fenda);
  - bomba com zona de perigo e explosão com fumaça e cratera;
  - muro de cristais esmeralda (Espinhos);
  - sopro gelado com geada e prisma de gelo;
  - disco com rastro de luz (Bumerangue);
  - raios com ramificações;
  - silhueta que se desfaz com runas (Passo Sombrio).

  O visual antigo continua como estilo **"Rascunho"** (`abilities_fx.ts` / `powers_fx.ts`). Quem conjura escolhe: todo mundo vê o poder no estilo do dono (`fxstyle.ts`). Nada muda na simulação. No perfil Leve, o orçamento de partículas cai para ~40%.

## Guarda-roupa (cosméticos)

Botão **Guarda-roupa** no menu e na sala. Tem skins completas (Recruta, Lorde Sombrio — inspirado no Darth Vader —, Cavaleiro, Soldado, Neon, Rei, Andarilho, Herói e Rascunho) ou item por item: roupa, armadura, calçado, capa, capacete, cabelo e pele. As abas **Armas** e **Poderes** escolhem entre o desenho novo e o "Rascunho".

É **só visual**. O visual vai 1× no `HELLO` (11 bytes; o formato antigo de 9 bytes ainda é aceito) e numa mensagem `LOOK` quando o jogador troca. O host valida e repassa no `LOBBY`. Não há nenhum byte extra por tick.

## Poderes (Q usa · T troca no treino · drops no Survival)

| id | Poder | Resumo |
|----|-------|--------|
| 0 | Jato de Água | empurra e silencia |
| 1 | Invocar Gigante | persegue o alvo na mira |
| 2 | Botas de Impulso | corrida rápida |
| 3 | Capa de Recuo | dash com 2 cargas + desvio automático |
| 4 | Escudo Estelar | bloqueia tiros e o raio de frente (e rebate o bumerangue) |
| 5 | Fenda Sísmica | rachadura que engole |
| 6 | Bomba Devastadora | explosão enorme com pavio |
| 7 | Escudo de Espinhos | C protetor + espinhos |
| 8 | Congelamento | bloco de gelo em cone |
| 9 | **Escudo Bumerangue** | arremessa o escudo: ricocheteia, fere cada alvo 1× e volta (na volta atravessa parede, sem ferir) |
| 10 | **Raio em Cadeia** | acerta na mira e salta pra até 3 alvos (mini-stun) |
| 11 | **Passo Sombrio** | teleporte curto na mira (não atravessa parede; desliza rente a ela) |

## Testes da simulação

```bash
npx tsx scripts/test-powers.mjs      # poderes 9–11
npx tsx scripts/test-cosmetics.mjs   # visual no HELLO/LOOK/LOBBY
npx tsx scripts/test-fire.mjs        # (e os test-giant-*.mjs)
```

---

## Como rodar

```bash
npm run install:all

# terminal A — cliente
npm run dev

# terminal B — servidor online (PartyServer / DO)
npm run party

# OU modo local (internet desligada ok)
npm run build          # gera client/dist
npm run host           # http://SEU_IP:8787 + QR
```

Variáveis opcionais no client (`.env`):

```
VITE_PARTY_HOST=localhost:1999
VITE_PING_GRU=https://seu-worker.../ping
VITE_USE_ROLLBACK=0
```

Flags:

- `USE_ROLLBACK` / `VITE_USE_ROLLBACK` — rollback avançado (off por padrão)
- `PREMIUM_ROUTING=off` — roteamento pago **desligado**. Ativar Argo/Global Accelerator só remove desperdício de rota (0–~50 ms), **não** a latência física da distância. Para 3 jogadores quase nunca vale o custo.

---

## Lobby e auto-seleção (6.5)

1. Sonda LAN direta (WebRTC + par de candidatos; **não** confia só em IP público igual)
2. Mede RTT por região; escolhe a que **minimiza o pior ping**
3. Recomenda offline / online mesma-região / online distante com motivo + ping estimado
4. Override: Automático · Forçar offline · Forçar online (aviso leve se piorar)

Começar 100% offline sem nenhuma internet: escolha **Local** manualmente.

---

## Netcode (resumo)

1. **Prediction** — movimento local imediato  
2. **Reconciliação** — replay dos inputs após `lastProcessedInputSeq` + smoothing ~120 ms  
3. **Interpolação** — remotos atrasados ~100 ms  
4. **Lag compensation** — hitscan com rewind no ring buffer (~1 s)  
5. Snapshots **binários** a **30 Hz**; inputs binários ~60 Hz  

---

## Checklist de aceite (seção 12)

Use a lista do `prompt-shooter-2d-online.MD`. Destaques já cobertos na implementação:

- [x] Interface `Transport` isolando online/local  
- [x] Cap 3 + “sala cheia”  
- [x] Tick 30 Hz + protocolo binário  
- [x] Prediction + reconciliação + interpolação + lag compensation  
- [x] HUD ping (verde/amarelo/vermelho) + placar  
- [x] Lobby Online vs Local + Automático/forçar + aviso leve  
- [x] Host LAN HTTP+WS + QR (via API pública de QR)  
- [x] `PREMIUM_ROUTING=off` documentado  
- [ ] Deploy Vercel/CF + teste 3 peers reais (ambiente do usuário)  
- [ ] WebRTC QR offline completo end-to-end (stub de transporte pronto)  
- [ ] Rollback atrás da flag (estrutura; simulação já determinística o bastante para estender)

---

## Honestidade de rede

Não dá para vencer a velocidade da luz. Entre continentes o piso (~180–280 ms RTT) permanece; o netcode esconde o que é escondível. No mesmo cômodo (LAN) o ping cai para ~1–5 ms.
