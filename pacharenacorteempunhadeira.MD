# Patch — Arena Corte: corrigir empunhadura da arma (mão na coronha, não no cano)

> Bug: PNGs de fuzil (M4A1, M16, AK, sniper) aparecem segurados pelo cano/meio, como revólver. Causa: em `drawWeaponLayer` (client/src/game/render.ts) o PNG é ancorado por fração fixa (`-dw*0.12`) e escalado por multiplicador mágico (`tip*2.25`), ignorando o `length` real de cada arma no `gear.ts`. Altera SOMENTE `render.ts` + adiciona 1 campo opcional em `gear.ts`. NÃO tocar `muzzlePoint`/sim/protocolo.

## 1. Adicionar campo de empunhadura no gear.ts

Em cada `WeaponDef`, adicionar `gripInset` = distância (px de mundo) da COTA TRASEIRA do PNG até o ponto onde a mão traseira segura (a coronha/punho). Valores iniciais:

| arma | gripInset |
|---|---|
| Pistola (0) | 2 |
| M4A1 (1) | 5 |
| M16 (2) | 5 |
| AK-47 (3) | 5 |
| Shotgun (4) | 5 |
| SMG (5) | 4 |
| Sniper (6) | 6 |

(Se o PNG tiver muita margem transparente à esquerda, aumentar; à direita, o cano deve terminar perto do `muzzleForward`.)

## 2. Reescrever o bloco de desenho do PNG em `drawWeaponLayer`

Trocar a lógica atual (que usa `targetLen = tip*2.25` e `-dw*0.12`) por: escalar o PNG para que seu **comprimento visual = `w.length` do gear.ts**, e ancorar a **coronha na mão traseira** (origem local x=0 é a mão traseira; o cano cresce para +X).

```ts
const gunImg = getGunImg(weaponId);
if (gunImg) {
  // comprimento visual = length real da arma (não multiplicador mágico)
  const visualLen = w.length;                 // ex.: M4=52, pistola=28
  const scale = visualLen / Math.max(1, gunImg.naturalWidth);
  const dw = gunImg.naturalWidth * scale;
  const dh = gunImg.naturalHeight * scale;

  // origem local (0,0) = mão traseira. A coronha do PNG fica gripInset atrás da mão.
  const backX = -(w.gripInset ?? 4);          // início do PNG (coronha) à esquerda da mão
  ctx.drawImage(gunImg, backX, -dh / 2, dw, dh);

  drawGripHands(ctx, visualLen);              // passar o comprimento REAL, não 'tip'
  if (muzzleFlash) {
    const mx = visualLen - (w.gripInset ?? 4); // ponta do cano ~ fim do PNG
    const g = ctx.createRadialGradient(mx, 0, 0, mx, 0, 28);
    g.addColorStop(0, "rgba(255,230,120,0.95)");
    g.addColorStop(0.4, "rgba(255,140,40,0.55)");
    g.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx, 0, 28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return;
}
```

## 3. Ajustar `drawGripHands` para o comprimento real

A mão dianteira usa `Math.max(18, tip*0.42)`. Trocar o parâmetro para o comprimento visual e recolocar as mãos como fração do PNG:

```ts
function drawGripHands(ctx: CanvasRenderingContext2D, gunLen: number, skin = "#d4a574") {
  ctx.fillStyle = skin;
  // mão traseira (punho/coronha) — logo à frente da origem
  ctx.beginPath(); ctx.ellipse(3, 3, 5, 4, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(3, 4, 4, 2.5, 0.15, 0, Math.PI * 2); ctx.fill();
  // mão dianteira (guarda-mão) — ~55% do comprimento da arma
  const fx = gunLen * 0.55;
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.ellipse(fx, 4, 5.5, 4.2, -0.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(fx, 5, 4.5, 2.8, -0.1, 0, Math.PI * 2); ctx.fill();
}
```

## 4. IMPORTANTE — separar VISUAL de HITSCAN

`w.length` é o comprimento VISUAL do desenho. `muzzleForward` (origem da bala no shared) NÃO muda. Se, após o patch, a ponta visual do cano não coincidir com o muzzle flash/origem da bala, ajustar APENAS `w.length` e `gripInset` (visual) até casar — NUNCA mexer em `muzzleForward`/`muzzleSide` (isso quebraria o hit no servidor). O objetivo é o cano DESENHADO terminar onde a bala JÁ nasce.

## Critérios de aceite binários
1. [ ] M4A1, M16, AK-47, shotgun, SMG e sniper aparecem seguradas pela CORONHA (mão traseira no punho, mão dianteira no guarda-mão), nunca pelo cano.
2. [ ] O comprimento de cada arma na tela corresponde ao `length` do gear.ts (sniper visivelmente mais longa que a pistola).
3. [ ] A ponta do cano desenhada coincide com o muzzle flash e com a origem da bala (colinear) — com 150 ms de latência, tiro sai do cano visível.
4. [ ] `muzzleForward`/`muzzleSide` e o `muzzlePoint` do shared INALTERADOS (conferir por diff).
5. [ ] Flip à esquerda mantém as mãos corretas (arma não fica de cabeça pra baixo).
6. [ ] `git diff` restrito a `client/src/game/render.ts` e ao campo `gripInset` em `shared/gear.ts`.