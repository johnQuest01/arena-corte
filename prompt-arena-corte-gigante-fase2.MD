# Prompt (FASE 2 — guardar) — Arena Corte: habilidade "Invocar Gigante"

> NÃO colar agora. Fase 2. Depende de DOIS sistemas já specados: o **framework de habilidades** (prompt do Jato de Água — AbilityDef, cooldown, evento `ability`) e a **IA de perseguição** dos monstros (prompt co-op zumbis — máquina de estados, `vx/vy`, colisão de map.ts). O Gigante é o casamento dos dois: uma habilidade que CRIA uma entidade que persegue. Autoritativo no host; visual client-side. Zero física de fluido, zero mudança de netcode além da entidade.

## 0. Design (fechado com o usuário)
Aperta o botão → nasce um **Gigante** (um pouco maior que os players) ao lado do conjurador → ele **trava** num alvo → **persegue** esse alvo → se alcança, dá um golpe que **mata + arremessa o corpo longe** e o Gigante some → se NÃO alcança em **8 s**, some mesmo assim (o alvo escapou). O Gigante NUNCA ataca quem o invocou.

Regras de alvo e velocidade (decididas):
- **Alvo travado na invocação**: se há um inimigo **na mira** do conjurador (dentro de um cone/linha à frente), trava NELE; senão, trava no **inimigo mais próximo**. Trava em UM só e persegue até o fim (não troca de alvo dinamicamente).
  - "Inimigo" = depende do modo: no **PvP**, outros players; no **co-op**, zumbis/Brutamontes **e também bots/players** (FFA no survival). Nunca o conjurador.
  - Se o alvo travado morrer por outra causa antes do Gigante chegar: Gigante some (simples) — NÃO re-mira.
- **Rápido, mas alcançável**: velocidade do Gigante **acima da do player** (ex.: player ~200 px/s → Gigante ~250 px/s), MAS com aceleração/inércia (não vira na hora). Resultado: correndo em linha reta o player ganha distância no curto prazo, mas o Gigante encosta se o player hesitar, bater em parede ou ziguezaguear. Dá pra escapar nos 8 s largando tudo e correndo — não dá pra escapar parado atirando.

## 1. É uma habilidade (AbilityDef) que spawna entidade
No `abilities.ts`, `SUMMON_GIANT`:
```ts
const SUMMON_GIANT: AbilityDef = {
  id: 1, name: "Invocar Gigante",
  cooldownMs: 25000,     // poder forte -> cooldown longo
  castMs: 0,
  range: 99999,          // o alvo pode estar longe; mira/próximo decide
  coneRad: 0.35,         // cone da "mira" pra escolher alvo preferencial
  apply(caster, targets, now, ctx) {
    // targets = inimigos vivos (filtrados por modo). Escolher alvo:
    const inCone = targets.filter(t => angleTo(caster, t) <= 0.35 && inFront(caster, t));
    const target = (inCone.length ? nearest(caster, inCone) : nearest(caster, targets));
    if (!target) return; // sem inimigo -> não invoca (ou invoca e vaga; preferir não gastar cooldown)
    ctx.spawnEntity({
      type: "giant", x: caster.x + Math.cos(caster.angle)*24, y: caster.y + Math.sin(caster.angle)*24,
      ownerId: caster.id, targetId: target.id, expiresAt: now + 8000,
    });
  },
};
```
- Precisa expor `ctx.spawnEntity` no AbilityCtx (o mesmo pool de entidades dos monstros). O Gigante é uma `Enemy`-like com `type:"giant"`, `ownerId`, `targetId`, `expiresAt`.

## 2. O Gigante como entidade autoritativa (reusa a IA dos monstros)
No `stepEnemy` (host), tratar `type:"giant"`:
- **Estado CHASE**: mover em direção ao player/entidade `targetId` com velocidade ~250 e aceleração limitada (inércia — lerp da velocidade rumo ao vetor-alvo, não teleporte de direção). Colisão com tiles sólidos/portas de `map.ts` (contorna parede como os zumbis).
- **Alcance/golpe**: se `dist(giant, target) < hitRange` (~28 px + tamanho do gigante):
  - Telegrafa MUITO curto (~150 ms, `WINDUP`) — o gigante levanta o braço (visual) — e então:
  - Aplica **morte** ao alvo (hp = 0 / evento de kill atribuído ao `ownerId`) **+ knockback FORTE**: impulso grande em `target.vx/vy` na direção giant→target (reusa o motor de impulso da água/Brutamontes) — o "arremessa longe".
  - Emite `enemyDeath`/kill do alvo e **remove o Gigante** (cumpriu a função).
- **Expira**: se `now >= expiresAt` sem ter acertado → remover o Gigante (o alvo escapou). Emitir evento `giantExpire` pra fade-out visual.
- **Owner-safe**: o Gigante ignora colisão de golpe com o `ownerId` e com aliados do owner (no co-op, só acerta o `targetId`; ele não debanda pra matar outros).

## 3. Visual — client-side
- **Sprite do Gigante**: maior que o player (~1.6–2×). Gerar no PixelLab (humanoide grande, mesma paleta, walk 4–8 frames) OU procedural (silhueta grande e escura com contorno). Sombra grande.
- **Invocação**: ao nascer, efeito de surgimento (poeira/energia — partículas do pool; NÃO precisa ser água). Som grave de invocação.
- **Perseguição**: passos que dão micro-tremor de tela SÓ quando perto do próprio player; rugido/pisada audível por distância; se estiver fora da tela, um indicador na borda apontando pra ele (tensão pra quem é o alvo).
- **Golpe**: no impacto, flash + partículas de impacto + tremor maior; o corpo do alvo voa (o knockback já é autoritativo; o cliente só desenha o corpo sendo arremessado + decal).
- **Marca no alvo travado**: um indicador sutil sobre a cabeça do alvo ("você é o alvo") enquanto o Gigante existe — pra ele saber que tem que correr. (Se preferir mais cruel, mostrar só pro alvo; decidir em playtest.)
- **Expiração**: fade-out + som de dissipar.

## 4. Rede — invariáveis
- Gigante é autoritativo: host spawna, move, decide o golpe. Cliente NÃO prevê a entidade (interpola posição do snapshot, como faz com monstros/players remotos). O conjurador pode ver o efeito de invocação na hora por predição, mas a entidade em si vem do host.
- Snapshot: +1 entidade enquanto vive (~11 bytes: id, type, x, y, state). Sai em ≤ 8 s. Eventos `giantSpawn`/`giantHit`/`giantExpire`.
- Cooldown/estado da habilidade: `abilityCdUntil` (já existe no framework). Nada de novo no netcode.
- Modo-aware: alvo = players (PvP) ou monstros+bots/players (co-op); nunca o owner.

## 5. Critérios de aceite binários
1. [ ] Botão de habilidade (com Gigante equipado) invoca um Gigante ao lado do conjurador, respeitando cooldown de 25 s (radial no HUD).
2. [ ] O Gigante trava no inimigo NA MIRA se houver um no cone; senão no mais próximo; e persegue ESSE alvo até o fim (não troca de alvo).
3. [ ] O Gigante é mais rápido que o player mas com inércia: parado atirando você morre; correndo e ziguezagueando dá pra sobreviver os 8 s.
4. [ ] Ao alcançar, telegrafa breve e então MATA + arremessa o corpo longe (knockback forte); o Gigante some após o golpe.
5. [ ] Se não alcança em 8 s, o Gigante some (fade); o alvo sobreviveu.
6. [ ] O Gigante NUNCA atinge quem o invocou nem aliados dele (owner-safe); a kill é creditada ao conjurador.
7. [ ] Autoritativo: os 3 clientes veem o Gigante na mesma posição/estado (interpolado); cliente adulterado não spawna nem move o Gigante localmente.
8. [ ] Contorna paredes/portas (colisão de map.ts) rumo ao alvo.
9. [ ] Com 150 ms de latência: posição do Gigante vem do host sem rubber-banding; o golpe/knockback resolve igual nos 3 clientes.
10. [ ] Snapshot cresce só pela entidade do Gigante enquanto vive; `muzzlePoint`, munição, portas, água e demais sistemas inalterados.
11. [ ] Funciona nos dois modos: PvP (alvo = players) e co-op (alvo = monstros + bots/players), nunca o conjurador.