# Prompt — Poder 2/3 (Leva buffs): Capa de Recuo

> Repositório `johnQuest01/arena-corte`. Mesmo esqueleto do Poder 1 (Botas): nova `AbilityDef`, estado no player, drop no survival, visual no boneco. Diferença desta: usa **sistema de CARGAS** (2 usos antes de recarregar) em vez de cooldown simples. Autoritativo no sim; visual client-side.

## Design
**Capa de Recuo**: ao ativar, o jogador é arremessado rapidamente para LONGE (na direção oposta à mira, ou para trás), escapando do perigo. Tem **2 cargas**; cada uso gasta 1; cada carga recarrega sozinha em ~8 s. A capa fica VISÍVEL nas costas do personagem quando equipada, e esvoaça/estica no momento do recuo.

## A. Efeito (autoritativo — shared)
### A.1 Estado no player (shared/sim.ts)
- Usar **cargas** em vez de só `abilityCdUntil`. Adicionar:
```ts
dashCharges: number;      // começa em 2 (max)
dashRechargeAt: number;   // quando a próxima carga volta (se < max)
```
Constantes: `DASH_MAX_CHARGES = 2`, `DASH_RECHARGE_MS = 8000`.
- No `stepPlayer` (host): se `dashCharges < DASH_MAX_CHARGES` e `now >= dashRechargeAt`, `dashCharges++` e, se ainda faltar carga, `dashRechargeAt = now + DASH_RECHARGE_MS`.

### A.2 Nova AbilityDef (shared/abilities.ts)
```ts
export const RECOIL_CAPE: AbilityDef = {
  id: 3, name: "Capa de Recuo",
  cooldownMs: 0,          // controlado por cargas, não por CD simples
  castMs: 0,
  range: 0, coneRad: 0,
  apply(caster, _targets, now, ctx) {
    const p = caster as PlayerState & { dashCharges?: number; dashRechargeAt?: number; dashUntil?: number };
    if ((p.dashCharges ?? 0) <= 0) return;      // sem carga -> não faz nada
    // impulso forte para LONGE: oposto da mira (fuga)
    const dirX = -Math.cos(caster.angle);
    const dirY = -Math.sin(caster.angle);
    p.vx = dirX * 4200;   // arremesso rápido
    p.vy = dirY * 4200;
    p.dashUntil = now + 220;                     // janela de "dash" (i-frames opcionais)
    p.dashCharges = (p.dashCharges ?? 0) - 1;
    if (p.dashCharges === DASH_MAX_CHARGES - 1) p.dashRechargeAt = now + DASH_RECHARGE_MS; // inicia recarga
    ctx.didCast = true;
  },
};
```
Adicionar ao array `ABILITIES` (id 3). O `tryCastAbility` do sim hoje trava por `abilityCdUntil`; garantir que esta habilidade IGNORA o CD e usa cargas (checar cargas dentro do apply; não setar `abilityCdUntil`).

### A.3 Direção do recuo
- Padrão: oposto da mira (você olha pro perigo e recua pra trás dele). Alternativa (decidir em playtest): oposto da direção de MOVIMENTO, ou sempre "para trás" do personagem. Começar com oposto da mira.
- **i-frames opcionais**: durante `dashUntil`, o jogador pode ser brevemente invulnerável (evita levar dano no meio do dash). Começar SEM i-frames (só o reposicionamento); ligar se o playtest pedir.

### A.4 Snapshot
- Adicionar `dashCharges` (1 byte) ao estado do player (pro HUD mostrar as cargas). `dashUntil` opcional se for usar i-frames/visual nos remotos.

## B. Visual no boneco (client-side — render.ts)
### B.1 Capa visível (quando `p.ability === 3`)
- Desenhar uma CAPA atrás do personagem (antes do corpo na ordem de desenho, pra ficar por trás): um trapézio/pano preso nos ombros, caindo até ~meio corpo, cor contrastante (ex.: vermelho escuro / roxo da paleta). Aparece sempre que equipada.
- **Movimento da capa**: leve balanço (seno) enquanto anda; oscila na direção oposta ao movimento (a capa "arrasta" atrás). Flip esquerda/direita como o resto.

### B.2 Efeito do recuo (quando dash ativo, `now < dashUntil`)
- A capa ESTICA na direção oposta ao movimento (alongada), e sai um rastro de partículas/motion streak no trajeto do dash (2-4 cópias fantasma do boneco, fade rápido).
- Som `whoosh`/cape no uso. HUD: mostrar as **2 cargas** (ex.: dois pips que esvaziam e recarregam) perto do HUD de habilidade.

## C. Como obter
- **Treino (mode 0)**: trocável via `input.ability` (id 3), como as botas.
- **Survival (mode 1)**: `AbilityDrop` com `abilityId = 3` (reusar o AbilityDrop criado no Poder 1). Ícone de capa flutuando.

## Regras
- `muzzlePoint`/câmera/netcode INTOCADOS.
- Sistema de cargas é novo no player (`dashCharges`/`dashRechargeAt`); reusa AbilityDrop do Poder 1.
- Determinístico (host + prediction) — o dash é impulso em vx/vy, mesmo motor do knockback da água.

## Critérios de aceite binários
1. [ ] Ativar arremessa o jogador rapidamente para longe (oposto da mira); gasta 1 de 2 cargas.
2. [ ] Cada carga recarrega sozinha em ~8 s; sem carga, ativar não faz nada; HUD mostra as 2 cargas enchendo/esvaziando.
3. [ ] A capa aparece nas costas quando equipada, balança ao andar, e estica com rastro no momento do recuo.
4. [ ] No treino, trocável e testável na hora; no survival, aparece como drop e é pega por colisão.
5. [ ] Autoritativo: cliente não recua sem carga; posição/cargas batem nos 3 clientes.
6. [ ] Com 150 ms de latência: o recuo do próprio jogador responde por predição; remotos vêm do snapshot sem rubber-banding.
7. [ ] `git diff`: cargas/estado em shared, visual em cliente; `muzzlePoint`/câmera/netcode inalterados.
8. [ ] FPS ≥ 60.
