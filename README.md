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
/shared          protocol.ts, sim.ts, laghistory.ts, constants.ts
/server
  party/room.ts  Durable Object (tick 30 Hz)
  local-host.ts  host LAN
  wrangler.toml
/client
  src/net/       Transport + modeSelector + prediction/interp/reconcile
  src/game/      loop, render, input
  src/ui/        lobby + HUD
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
