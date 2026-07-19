# Prompt (FASE 2 — guardar) — Arena Corte: água que PARECE real (sem física de fluido)

> NÃO colar agora. Este é o upgrade VISUAL do Jato de Água (habilidade da fase 2). Depende do sistema de habilidades e do `abilities_fx.ts` já existirem. Escopo: SOMENTE o visual da água — 100% client-side, partículas + truques de canvas. NÃO simula fluido (Navier-Stokes é escopo AAA, mataria FPS e rede). O efeito de gameplay (knockback + stun) continua exatamente como no prompt de habilidades; NADA aqui toca o `shared/sim.ts`, o snapshot ou o netcode.

## Princípio
"Parece água" em jogo NÃO vem de simular fluido — vem de EMPILHAR camadas baratas de ilusão. O olho, em movimento e no meio do tiroteio, compra o resultado. Implementar as 5 camadas abaixo em `client/src/game/abilities_fx.ts`, disparadas pelo evento `ability` (abilityId 0) que já existe. Todas usam o pool de partículas atual; cap global respeitado (descartar mais antigas se estourar ~500 vivas).

## Camada 1 — Partículas em 3 profundidades (dá volume)
Ao conjurar, emitir em leque na direção `angle`, saindo ~8 px ATRÁS do conjurador, TRÊS sub-jatos:
- **Fundo** (atrás): 20 gotas grandes (r 4–7), mais lentas (160–240 px/s), alpha 0.5, azul mais escuro.
- **Meio**: 25 gotas médias (r 2–4), 240–340 px/s, alpha 0.7, azul médio.
- **Frente/spray**: 20 gotas finas (r 1–2), 340–460 px/s, alpha 0.8, azul claro/branco.
- Todas: `ang = angle + (rand-0.5)*1.0`; vida 0.4–0.9 s; gravidade leve (`vy += 900*dt`); encolhem com a idade.
Desenhar na ordem fundo→meio→frente (profundidade).

## Camada 2 — Metaballs / "blob" (dá o aspecto LÍQUIDO contínuo)
Este é o truque que separa "pontinhos azuis" de "água de verdade". Em vez de desenhar cada gota isolada:
- Renderizar as gotas de água num **canvas offscreen** como círculos de alpha suave (radial gradient branco→transparente).
- Aplicar `ctx.filter = "blur(4px)"` nesse offscreen e depois um passo de **threshold de alpha** (via `globalCompositeOperation` ou reprocessando: onde o alpha borrado passa de ~0.5, pinta azul sólido; abaixo, transparente).
- Resultado: gotas próximas se FUNDEM numa massa contínua com borda orgânica; gotas isoladas viram gotinhas redondas. É o "gosmento/molhado".
- Custo: 1 offscreen + 1 blur por frame durante ~1 s do efeito. Barato. Se FPS cair em máquinas fracas, expor flag `WATER_METABALLS` (fallback: só camada 1).

## Camada 3 — Onda de choque no chão (dá a "força" do empurrão)
- Um anel semi-transparente (stroke azul-claro, alpha 0.35→0) que EXPANDE do conjurador no plano do chão, raio 0→160 px em ~350 ms, com leve espessura decrescente. Lê como a onda de pressão empurrando — sem simular onda nenhuma.
- Desenhar ANTES dos personagens (é chão).

## Camada 4 — Rastro molhado (decais que persistem)
- Onde as gotas "morrem" (fim da vida perto do chão), depositar decais de piso molhado (mancha azul-escura translúcida) no canvas de decais que já existe (o do sangue), com vida ~3 s e fade.
- No alvo atingido: splash azul no ponto de impacto + o alvo fica com leve tint molhado por ~1 s.

## Camada 5 — Distorção/refração (o toque final "isto é água")
- Aplicar uma leve distorção nos pixels ATRÁS da massa de água: amostrar a região do canvas sob a água e redesenhá-la com deslocamento senoidal pequeno (2–3 px) que varia no tempo — efeito de refração.
- Implementação barata: copiar o retângulo da área do jato para um offscreen e reprojetar com `drawImage` em faixas horizontais levemente deslocadas (fake heat-haze). Se custar caro, deixar atrás de flag `WATER_REFRACTION` (é a primeira a desligar em perf).

## Ordem de desenho por frame (durante o efeito)
1. onda de choque (chão) → 2. decais molhados → 3. personagens → 4. massa de água (camadas 1+2, offscreen com metaballs) → 5. distorção sob/sobre a água → 6. spray fino por cima.

## Áudio
- `water_whoosh` no conjuro (sfx CC0 ou ruído filtrado passa-baixa com envelope) + `splash` no impacto no alvo. Volume por distância como o resto.

## Performance (obrigatório)
- Todo o efeito dura ~1 s; nada persiste além dos decais. Pool com cap; metaballs e refração atrás de flags para degradar em máquinas fracas.
- Alvo: FPS ≥ 60 com o efeito ativo + 3 jogadores + tiroteio. Se cair, degradar nesta ordem: refração → metaballs → nº de partículas.

## Critérios de aceite binários
1. [ ] O jato tem 3 profundidades de partícula e lê como VOLUME de água saindo das costas na direção da mira.
2. [ ] Com `WATER_METABALLS` ligado, gotas próximas se fundem em massa líquida contínua (não pontinhos soltos).
3. [ ] Onda de choque no chão expande do conjurador ao usar o poder.
4. [ ] Decais de chão molhado ficam ~3 s onde a água cai; alvo atingido recebe splash + tint molhado.
5. [ ] `WATER_REFRACTION` ligado distorce sutilmente o fundo sob a água; desligar não quebra nada.
6. [ ] FPS ≥ 60 com efeito + 3 jogadores; flags degradam corretamente em ordem.
7. [ ] ZERO mudança em `shared/`, snapshot, protocolo ou netcode — diff restrito a `client/src/game/abilities_fx.ts` (+ flags). Knockback/stun continuam vindo do host, inalterados.
8. [ ] Efeito 100% cosmético e local: dois clientes podem ver a água com micro-diferenças (partícula é aleatória) sem qualquer dessincronia de gameplay.