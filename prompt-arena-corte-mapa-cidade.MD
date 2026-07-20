# Prompt — Arena Corte: mapa maior estilo cidade + popular + recarga visual

> Repositório `johnQuest01/arena-corte` commit 2f39909. IMPORTANTE: a arquitetura de mundo grande com câmera seguindo o jogador JÁ EXISTE e funciona (`computeCamera` centraliza no player com clamp; culling de entidades já implementado; mundo atual 2560×1792 já é 4× a viewport 960×640). NÃO reescrever câmera/scrolling/culling. Isto é: (A) ampliar o mapa e dar-lhe cara de cidade pós-apocalíptica, (B) popular, (C) animação de recarga. Blocos independentes; commitar cada um.

## A. Mapa maior estilo cidade (shared/map.ts + constants.ts + render tiles)

### A.1 Ampliar dimensões
- Em `shared/map.ts`: aumentar `MAP_W`/`MAP_H` (ex.: de 80×56 para **160×120** — cidade ~4× maior; ajustar conforme performance). Em `shared/constants.ts`, `ARENA_W`/`ARENA_H` DEVEM continuar batendo (`MAP_W*TILE` × `MAP_H*TILE`) — atualizar os dois números juntos (o comentário da linha 13 já avisa disso).
- Culling e câmera já lidam com mapa maior (não mexer). Verificar `MAP_SPAWNS` e re-espalhar os spawns pelo novo tamanho.

### A.2 Novos tipos de tile de chão (em `T`)
Adicionar ao objeto `T`: `ROAD` (asfalto escuro), `ROAD_LINE` (faixa amarela/branca desbotada), `SIDEWALK` (calçada cinza), `GRASS` (mato verde-seco), `GRASS_TALL` (mato alto — decorativo). Registrar cor de cada um no mapa de cores do render (`LOSPEC`/`sand` etc. em render.ts ~42) na paleta Resurrect 64 (tons apocalípticos: asfalto rachado, calçada suja, mato ressecado).

### A.3 Layout urbano (gerar com fillRect, como já é feito)
Desenhar no GROUND uma malha de cidade:
- **Ruas**: faixas de `ROAD` horizontais e verticais formando quarteirões (ex.: ruas de 3-4 tiles de largura a cada ~20 tiles). `ROAD_LINE` no centro das ruas (faixa central).
- **Calçadas**: borda de `SIDEWALK` (1-2 tiles) ladeando cada rua.
- **Quarteirões**: dentro de cada bloco, mix de `CONCRETE` (pátios), `GRASS`/`GRASS_TALL` (terrenos baldios, praças tomadas pelo mato) e os prédios existentes (BUILDINGS).
- **Prédios**: reusar `BUILDINGS`/`SOLID`/telhados que já existem — espalhar VÁRIOS pela cidade (hoje há poucos; adicionar mais nos quarteirões, cada um com colisão e telhado que some ao entrar, como já funciona). Adicionar props apocalípticos (carros abandonados nas ruas — SOLID, barris, entulho) reusando o sistema de props.
- Manter algumas áreas abertas (praças, cruzamentos largos) pra combate ter espaço.

### A.4 Render dos tiles novos
Em `render.ts` (drawGround/drawSolids): desenhar os novos tiles. Ruas com leve variação/rachadura (decal procedural determinístico por (x,y), como a areia já faz); calçada com linhas de junta; mato com tufos (2-3 tons). Faixa de rua desbotada. Manter o chão pré-renderizado em canvas offscreen (perf) — se já existe, incluir os novos tiles nele.

## B. Popular a cidade (shared/sim.ts + enemies + botAi)
- **Bots**: subir para **6 bots** (já existe `botAi.ts` com bots que jogam). Espalhar os spawns pela cidade; garantir que a IA de bot navega no mapa maior (pathfinding respeita SOLID — se hoje é navegação simples, pode precisar de waypoints; começar com o que existe e verificar se travam em prédios).
- **Zumbis/chefes na tela**: no modo Survival, os 7 zumbis (cap) + Brutamontes já existem — espalhar spawns pela cidade (bordas/becos, fora da visão). O Gigante invocável já funciona. Verificar que inimigos navegam ruas/contornam prédios (colisão SOLID já é lida pela IA).
- **Densidade**: com mapa 4× maior, os inimigos ficam mais espalhados — considerar spawnar perto dos players (não em cantos vazios do mapa) pra a ação não sumir. Ajustar o WaveManager pra spawnar num raio ao redor do grupo de players.
- **Perf**: culling já evita desenhar fora da tela. Confirmar FPS com mapa grande + 6 bots + 7 zumbis + gigante.

## C. Animação de recarga (client-side — cartucho saindo/entrando)
O reload já é autoritativo (barra de progresso existe). Adicionar o VISUAL:
- Durante o reload (estado do player, `reloadingUntil`/`reloadStart`), no `drawWeaponLayer` ou numa camada extra:
  - **Pente/carregador caindo**: um retângulo pequeno (cor do pente) que se desprende da arma e cai com gravidade fake no início do reload (~primeiros 200 ms), some ao tocar o chão (vira decal minúsculo).
  - **Pente novo entrando**: no fim do reload (~últimos 250 ms), um novo retângulo sobe/encaixa na arma.
  - **Movimento da arma**: leve inclinação/abaixada da arma durante o reload (o personagem "mexe" pra recarregar) — rotação sutil da camada da arma.
  - Som `reload` já existe (tocar no início, já pode estar tocando).
- Tudo client-side, derivado do estado de reload já sincronizado; ZERO mudança de protocolo.

## Regras
- Câmera, scrolling e culling INTOCADOS (já funcionam).
- `muzzlePoint`/origem da bala e o netcode INTOCADOS.
- Só o mapa maior (A) toca `shared/` (map.ts/constants.ts — dados de mapa, determinístico host+cliente). B ajusta spawns (shared). C é 100% cliente.

## Critérios de aceite binários
1. [ ] Mapa é visivelmente maior (cidade); a câmera segue o jogador rolando o mundo suavemente (já funcionava — confirmar sem regressão).
2. [ ] Há ruas com faixa central, calçadas ladeando, quarteirões com mato/concreto e vários prédios com colisão + telhado que some ao entrar.
3. [ ] Carros abandonados/entulho nas ruas têm colisão; áreas abertas existem pra combate.
4. [ ] Tiles novos (asfalto, calçada, mato) renderizam na paleta apocalíptica, com o chão pré-renderizado (FPS estável).
5. [ ] 6 bots inteligentes jogam e navegam a cidade sem travar em prédios; zumbis/Brutamontes/Gigante idem.
6. [ ] Inimigos spawnam num raio ao redor dos players (a ação não some no mapa grande).
7. [ ] Animação de recarga: pente cai no início, novo entra no fim, arma se mexe; sincronizado com a barra de reload.
8. [ ] `git diff`: mapa em shared (map.ts/constants.ts), spawns em shared/sim, recarga em cliente. `muzzlePoint`/câmera/netcode inalterados.
9. [ ] FPS ≥ 60 no mapa grande com 6 bots + 7 zumbis + Gigante + combate.
10. [ ] Nenhuma regressão: partida ainda começa, termina e mostra placar; kill feed/dano (se já implementados) seguem funcionando.
