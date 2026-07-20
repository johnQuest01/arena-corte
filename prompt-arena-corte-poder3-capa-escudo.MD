# Prompt — Poder 3/3 (Leva buffs): Capa-Escudo

> Repositório `johnQuest01/arena-corte`. Mesmo esqueleto dos Poderes 1 e 2. Este introduz **bloqueio de projétil** (a bala que atinge a frente do jogador com escudo ativo é anulada) — a única parte que toca a lógica de dano de bala no sim. Autoritativo; visual client-side.

## Design
**Capa-Escudo**: ao ativar, a capa se ABRE na frente do jogador e bloqueia projéteis por ~3 s (só de FRENTE — pelas costas ainda acerta). Cooldown ~14 s. Enquanto ativa, o jogador pode andar mas fica mais lento. A capa é visível e visivelmente se abre como um escudo de pano.

## A. Efeito (autoritativo — shared)
### A.1 Estado no player (shared/sim.ts)
```ts
shieldUntil: number;   // 0 = sem escudo; enquanto now < shieldUntil, bloqueia projétil frontal
```
Constante: `SHIELD_MS = 3000`. Inicializar 0.

### A.2 Nova AbilityDef (shared/abilities.ts)
```ts
export const SHIELD_CAPE: AbilityDef = {
  id: 4, name: "Capa-Escudo",
  cooldownMs: 14000,
  castMs: 0,
  range: 0, coneRad: 0,
  apply(caster, _targets, now, ctx) {
    const p = caster as PlayerState & { shieldUntil?: number };
    p.shieldUntil = now + 3000;
    ctx.didCast = true;
  },
};
```
Adicionar ao array `ABILITIES` (id 4).

### A.3 Bloqueio de projétil (na resolução de hit de bala em player — shared/sim.ts, onde a bala acerta o player, ~onde emite `kind:"hit"` com dano)
- Antes de aplicar o dano da bala ao player `p`:
```ts
if (p.shieldUntil && now < p.shieldUntil) {
  // ângulo da bala em relação à FRENTE do jogador (p.angle = pra onde ele olha/mira)
  const incoming = Math.atan2(p.y - bulletY, p.x - bulletX); // direção de onde a bala veio
  const facing = p.angle;
  let diff = Math.atan2(Math.sin(incoming - facing), Math.cos(incoming - facing));
  if (Math.abs(diff) < Math.PI * 0.6) {   // ~108° de cobertura frontal
    // BLOQUEADO: destruir a bala, sem dano; emitir evento de bloqueio pro FX
    sim.events.push({ kind: "hit", a: bulletOwner, b: 253, x: bulletX, y: bulletY }); // 253 = bloqueio (novo código sentinela)
    // remover a bala / marcar consumida
    continue; // ou o equivalente no loop de balas
  }
}
```
- Usar um código sentinela novo em `b` (ex.: 253) pra o cliente desenhar faísca de bloqueio em vez de sangue. NÃO adiciona campo — reusa o evento `hit` existente com valor sentinela (como já há 255/254 pra parede/ambiente).
- Só projétil frontal é bloqueado; pelas costas/lados (fora do cone) o dano é normal. Explosão/gigante NÃO são bloqueados (só bala) — decidir; começar bloqueando só bala.

### A.4 Lentidão enquanto ativo + snapshot
- Enquanto `now < p.shieldUntil`, aplicar `speedMul ~0.6` ao movimento (trade-off: protegido mas lento). Reusar o padrão de `speedMul` do Poder 1 (botas), invertido.
- Snapshot: `shieldUntil` (poucos bytes) pro cliente desenhar o escudo aberto nos remotos.

## B. Visual no boneco (client-side — render.ts)
### B.1 Capa visível (quando `p.ability === 4`)
- Capa nas costas quando equipada (como no Poder 2, mas cor/estilo próprio — ex.: cinza-metálico/azul). Balança ao andar.
### B.2 Escudo aberto (quando `now < p.shieldUntil`)
- A capa se MOVE para a FRENTE do jogador e se ABRE como um leque/escudo de pano cobrindo o arco frontal (~108°), semi-rígida. Desenhar por cima, na frente do corpo, girando conforme `p.angle` (acompanha pra onde ele olha).
- Brilho/borda de "ativo" no escudo; leve tremor ao bloquear.
- **Faísca de bloqueio**: ao receber o evento `hit` com `b === 253`, desenhar faísca metálica no ponto de impacto (partícula, som `block`/clang) em vez de sangue.
- HUD: cooldown radial; indicador de escudo ativo (contorno no player).

## C. Como obter
- **Treino (mode 0)**: trocável via `input.ability` (id 4).
- **Survival (mode 1)**: `AbilityDrop` com `abilityId = 4` (reusar do Poder 1). Ícone de capa/escudo.

## Regras
- `muzzlePoint`/câmera/netcode INTOCADOS. A única mudança sensível é o bloqueio de bala no sim (determinístico; host valida — cliente não decide bloqueio localmente além da predição).
- Reusa AbilityDrop e o padrão de speedMul dos poderes anteriores.

## Critérios de aceite binários
1. [ ] Ativar abre o escudo por ~3 s; balas que atingem o ARCO FRONTAL (~108°) são anuladas (sem dano); pelas costas/lados acertam normal.
2. [ ] Balas bloqueadas produzem faísca metálica + som (não sangue); a bala é destruída.
3. [ ] Enquanto o escudo está ativo, o jogador anda mais devagar (~60%); cooldown ~14 s (radial no HUD).
4. [ ] A capa aparece nas costas equipada e se move pra frente ABRINDO como escudo quando ativa, girando com a mira.
5. [ ] No treino, trocável/testável; no survival, aparece como drop e é pega.
6. [ ] Autoritativo: cliente não bloqueia sem escudo ativo; bloqueio/dano batem nos 3 clientes.
7. [ ] Com 150 ms de latência: sem rubber-banding; o bloqueio resolve igual nos 3 clientes (host decide).
8. [ ] `git diff`: escudo/estado + bloqueio em shared, visual em cliente; `muzzlePoint`/câmera/netcode inalterados.
9. [ ] FPS ≥ 60.
