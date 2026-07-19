# Arena Corte — Pipeline de assets (geração por IA + integração)

Duas partes: a **Parte 1** é o SEU roteiro para a sessão no Retro Diffusion / PixelLab.
A **Parte 2** você cola no Cursor DEPOIS que os PNGs estiverem em `client/public/assets/art/`.

---

# PARTE 1 — Roteiro da sessão de geração (você, na interface web)

## Regras da sessão (não pule)

1. **Piloto primeiro.** Gere APENAS: 1 personagem + 1 arma + 1 tile de chão. Rode a Parte 2 no Cursor com só isso. Olhe no jogo. Aprovou escala + estilo? Só então gere o resto, na MESMA sessão/estilo.
2. **Paleta travada.** Em toda geração, restrinja à paleta **Resurrect 64** (Retro Diffusion tem controle de paleta; no PixelLab, inclua no prompt). É o que faz tudo combinar.
3. **Fundo transparente** em tudo que não for tile de chão. Confira antes de baixar.
4. **Mesma escala.** Personagem ocupa ~24 px de altura num canvas 32×32. Armas ~28–40 px de comprimento. Se um asset sair gigante/minúsculo, regenere — não "conserte" esticando (borra o pixel).
5. **Estilo base do prompt** (copie e adapte o [ITEM]):
   > pixel art, top-down shooter game asset, [ITEM], side view, post-apocalyptic desert style, Resurrect 64 palette, clean pixels, no anti-aliasing, transparent background, 32x32

## Lista de compras (nomes de arquivo EXATOS)

### Personagens (PixelLab — usar o gerador de animação; vista de PERFIL, olhando para a DIREITA)
Para cada um dos 3 (variar roupa/cabelo; manter silhueta e altura):
- `char{N}_idle.png` — sprite sheet horizontal, 2–4 frames, 32×32 por frame (respiração parada)
- `char{N}_walk.png` — sprite sheet horizontal, 4–8 frames, 32×32 por frame (ciclo de corrida)
- (opcional) `char{N}_death.png` — 3–5 frames caindo
- Sugestões de tema: N=0 jaqueta azul/`--giz`; N=1 colete amarelo deserto; N=2 camisa vermelha rasgada. SEM arma na mão (a arma é camada separada do jogo).

### Armas (Retro Diffusion; vista LATERAL, cano para a DIREITA, PNG individual, canvas 48×16)
- `gun_pistol.png`, `gun_m4a1.png`, `gun_m16.png`, `gun_ak47.png`, `gun_shotgun.png`, `gun_smg.png`, `gun_sniper.png`
- Silhuetas bem distintas (é assim que se identifica de longe).

### Throwables e itens (16×16, vista de cima levemente 3/4)
- `throw_grenade.png`, `throw_flash.png`, `throw_smoke.png`, `throw_molotov.png`
- `item_ammo.png` (caixa de munição)

### Tileset (Retro Diffusion RD Tile para os sem-emenda; 32×32 por tile)
- `tile_sand_a.png`, `tile_sand_b.png`, `tile_sand_c.png` (variações de areia, SEM emenda)
- `tile_floor_wood.png`, `tile_floor_concrete.png` (piso interno)
- `tile_wall.png` (parede tijolo/metal enferrujado), `tile_roof.png` (telhado zinco/madeira)
- Props (fundo transparente): `prop_crate.png` (32×32), `prop_barrel.png` (32×32), `prop_car.png` (96×48, carcaça enferrujada)
- `door.png` (32×8, porta de metal vista de cima)

### Onde salvar
Tudo em `client/public/assets/art/`. Crie também `client/public/assets/art/manifest.json` copiando o modelo da Parte 2 e preenchendo `frames` e `fps` do que você gerou (o resto o Cursor deduz).

### Licença
Anote em `client/public/assets/ART_LICENSE.txt`: ferramenta usada, data, e que os termos da ferramenta permitem uso comercial (confira nos termos do plano que você assinar).

---

# PARTE 2 — Prompt de integração (cole no Cursor)

> Repositório `johnQuest01/arena-corte`. Os assets estão em `client/public/assets/art/` com um `manifest.json`. Integrar SEM alterar shared/, protocolo, sim ou netcode. O visual muda; o jogo, não.

## Manifest (fonte de verdade)

`client/public/assets/art/manifest.json`:
```json
{
  "frameSize": 32,
  "chars": [
    { "id": 0, "idle": { "file": "char0_idle.png", "frames": 2, "fps": 3 },
      "walk": { "file": "char0_walk.png", "frames": 6, "fps": 10 },
      "death": { "file": "char0_death.png", "frames": 4, "fps": 12 } }
  ],
  "guns": { "0": "gun_pistol.png", "1": "gun_m4a1.png", "2": "gun_m16.png", "3": "gun_ak47.png", "4": "gun_shotgun.png", "5": "gun_smg.png", "6": "gun_sniper.png" },
  "throws": { "1": "throw_grenade.png", "2": "throw_flash.png", "3": "throw_smoke.png", "4": "throw_molotov.png" },
  "items": { "ammo": "item_ammo.png" },
  "tiles": { "sand": ["tile_sand_a.png", "tile_sand_b.png", "tile_sand_c.png"], "floorWood": "tile_floor_wood.png", "floorConcrete": "tile_floor_concrete.png", "wall": "tile_wall.png", "roof": "tile_roof.png" },
  "props": { "crate": "prop_crate.png", "barrel": "prop_barrel.png", "car": "prop_car.png" },
  "door": "door.png"
}
```
- Entradas ausentes no manifest OU arquivos que falharem no load ⇒ **fallback automático para o desenho procedural atual** (nunca quebrar o jogo por asset faltando). O piloto terá só 1 char + 1 arma + 1 tile: o resto DEVE continuar procedural.

## Integração

1. **Loader** (`client/src/game/art.ts`): carrega manifest + imagens no preload (com o preload existente); `imageSmoothingEnabled = false` no contexto (pixel art nítida); expor `getCharAnim(id, state)`, `getGunImg(weaponId)`, `getTileImg(...)` etc.
2. **Personagens** (substitui o corpo procedural em `drawPersonSide`, mantendo TODA a lógica): sheets são horizontais, frames de `frameSize`; estados: `walk` se speed > 25, senão `idle`; `death` uma vez ao morrer (depois vira o decal de cadáver atual). Frame = `floor(tMs/1000 * fps) % frames`. Sprites olham para a DIREITA ⇒ manter o flip `scale(-1,1)` quando `cos(angle) < 0`. Manter: sombra, bob, kick, contorno do próprio player, ordem arma atrás/na frente conforme mira.
3. **Armas**: desenhar o PNG no lugar da silhueta procedural em `drawWeaponLayer`, MESMO pivô e MESMO comprimento visual atual (escalar o PNG para o `length` da arma em `gear.ts` — a origem da bala `muzzlePoint` NÃO muda; se o PNG visivelmente não casar com o muzzle, ajustar a ESCALA do desenho, nunca o shared). Manter rotação contínua, flip vertical à esquerda, gunKick e muzzle flash.
4. **Tiles**: `drawGround` usa as variações de areia (escolha por hash determinístico de (x,y) — igual para todos os clientes); pisos internos por zona; `drawSolids` usa wall/props; `drawRoofs` usa o tile de roof (fade de alpha mantido). Cache: pré-renderizar o chão estático num canvas offscreen uma vez por mapa (não redesenhar tile a tile por frame).
5. **Porta, throwables, drop de munição**: trocar o desenho pelos PNGs, mantendo animação de dobradiça, física de arremesso e flutuação do drop.
6. **Sem regressões**: gore, decals, sons, juice, HUD intocados.

## Critérios de aceite binários

1. [ ] Com apenas o piloto (1 char + 1 arma + 1 tile) no manifest, o jogo roda com esses 3 assets novos e TODO o resto procedural, sem erro no console.
2. [ ] `imageSmoothingEnabled=false`: nenhum sprite borrado (pixels nítidos em qualquer zoom).
3. [ ] Animações respeitam `frames`/`fps` do manifest; walk acelera visualmente ao sprintar (fps proporcional à velocidade, como hoje).
4. [ ] Flip esquerda/direita correto para corpo e arma; arma nunca de cabeça pra baixo em 360°.
5. [ ] Tiro continua saindo EXATAMENTE do cano visível com 150 ms de latência (muzzlePoint e shared intocados — conferir por diff).
6. [ ] Chão pré-renderizado offscreen: FPS ≥ 60 no mapa completo com 3 jogadores + decals.
7. [ ] Remover/renomear um arquivo de asset ⇒ fallback procedural silencioso daquele item (testar com 2 arquivos).
8. [ ] `git diff` restrito a `client/` (novos arquivos + render/art/loop): zero mudanças em shared/, server/, protocol.
