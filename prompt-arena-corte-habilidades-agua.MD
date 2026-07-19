# Prompt — Arena Corte: sistema de habilidades (framework) + "Jato de Água"

> Fase 2. Repositório `johnQuest01/arena-corte`. O objetivo NÃO é um poder isolado, é um **framework de habilidades** onde cada poder novo é uma receita curta. Jato de Água é a primeira. Encaixar no `shared/sim.ts` (já tem `vx/vy`, `reloadingUntil` como molde de timer, input com flags livres). Só a lógica de gameplay é autoritativa; a partícula é client-side.

## 1. Conceito: uma habilidade é uma RECEITA de 3 partes

Toda habilidade = **(A) efeito no sim** (autoritativo: dano, impulso, timer) + **(B) evento visual** (client-side: partículas) + **(C) custo/cooldown** (autoritativo). O framework roda A e C no `shared/sim.ts`; emite um `TickEvent` que dispara B em cada cliente.

### shared/abilities.ts (novo)
```ts
export interface AbilityDef {
  id: number;
  name: string;
  cooldownMs: number;
  castMs: number;          // trava de ação durante o conjuro (0 = instantâneo)
  range: number;           // alcance do efeito
  coneRad: number;         // meia-abertura do cone (0 = single target / linha)
  apply: (caster: PlayerState, targets: PlayerState[], now: number, ctx: AbilityCtx) => void;
}
export interface AbilityCtx {
  emit: (ev: { kind: "ability"; abilityId: number; x: number; y: number; angle: number; casterId: number }) => void;
}
```

### Estado no PlayerState (shared/sim.ts)
Adicionar:
- `abilityCdUntil: number` (cooldown; 0 = pronto) — molde igual `reloadingUntil`.
- `stunnedUntil: number` (0 = livre; enquanto `now < stunnedUntil`, disparo E conjuro bloqueados).
- `ability: number` (id da habilidade equipada; começa em 0 = Jato de Água).

### Input (shared/protocol.ts)
- Adicionar 1 bit `cast` nas flags (há bits livres; usar bit 16). Tecla **Q** / botão de habilidade.

### Loop do sim (stepPlayer, onde já trata fire/reload)
- No topo: se `now < p.stunnedUntil` → ignorar `fire`, `reload` e `cast` (mas o movimento continua — stun de tiro, não de pés; decidir por design; começar bloqueando SÓ fire e cast, deixar mover).
- Se `input.cast` e `now >= p.abilityCdUntil` e não stunnado e não em `castMs` de outra ação:
  1. `const ab = abilityOf(p.ability)`.
  2. Selecionar `targets`: todos os outros players vivos dentro de `ab.range` cujo ângulo relativo a `p.angle` ≤ `ab.coneRad` (para linha/single, coneRad pequeno).
  3. `ab.apply(p, targets, now, ctx)` — aplica efeito.
  4. `p.abilityCdUntil = now + ab.cooldownMs`.
  5. `ctx.emit({ kind:"ability", abilityId: p.ability, x:p.x, y:p.y, angle:p.angle, casterId:p.id })`.
- Registrar novo `EventKind` `"ability"` no protocolo (próximo id livre) com payload: abilityId(1B), x(f32), y(f32), angle(f32), casterId(1B).

## 2. Receita: Jato de Água (id 0)

```ts
const WATER_JET: AbilityDef = {
  id: 0, name: "Jato de Água",
  cooldownMs: 6000,
  castMs: 0,
  range: 160,           // px
  coneRad: 0.5,         // ~28° de meia-abertura (leque à frente)
  apply(caster, targets, now, ctx) {
    for (const t of targets) {
      // knockback: impulso na direção caster->target, mais forte perto
      const dx = t.x - caster.x, dy = t.y - caster.y;
      const dist = Math.hypot(dx, dy) || 1;
      const falloff = 1 - dist / 160;                 // 1 perto, 0 na borda
      const push = 520 * Math.max(0.2, falloff);
      t.vx += (dx / dist) * push;
      t.vy += (dy / dist) * push;
      // silence/stun de tiro por 1.2s (não trava os pés)
      t.stunnedUntil = Math.max(t.stunnedUntil, now + 1200);
    }
  },
};
```
- Determinístico → host e prediction batem. O `vx/vy` já é integrado pelo movimento existente (o empurrão "arrasta" o alvo por alguns frames com a fricção atual).
- **Não prever localmente o efeito nos OUTROS** (só o host aplica knockback/stun a terceiros); a prediction do próprio conjurador pode animar a partícula na hora, mas o resultado nos alvos vem do snapshot.

## 3. Parte visual — client-side (client/src/game/abilities_fx.ts)

Ao receber o evento `ability` com `abilityId === 0`:
- **Jato de partículas de água** saindo de `(x,y)` na direção `angle`, em leque (reusar o pool de `gore.ts`/smoke):
  - 50–60 partículas, cor azul-clara (2–3 tons), alpha inicial ~0.8.
  - `ang = angle + (rand-0.5)*1.0`; velocidade 200–360 px/s; vida 0.4–0.8 s.
  - Gravidade leve (vy += g*dt) + encolhimento; ao "cair" (fim da vida) gera mini-respingo (2 partículas menores).
  - Origem levemente ATRÁS do conjurador (`x - cos(angle)*8`) pra "sair das costas/mãos".
- **Feedback no conjurador**: leve recuo/agacho (reusar FeelState), som `water_whoosh` (adicionar 1 sfx CC0 ou sintetizar com filtro de ruído).
- **Feedback no alvo atingido**: splash azul no impacto + o flash de stun (ícone pequeno de "silenciado" sobre a cabeça enquanto `stunnedUntil` ativo).
- HUD: ícone da habilidade + cooldown radial (escurece e preenche em 6 s) perto do HUD de arma.

## 4. Por que isto é um FRAMEWORK (não um poder solto)
- Habilidade nº 2 (ex.: "Dash", "Escudo", "Granada de gelo") = nova entrada `AbilityDef` + um case visual em `abilities_fx.ts`. Zero mudança no loop, no protocolo (o evento `ability` é genérico) ou no netcode.
- Ex. de próximas receitas (só pra validar o formato — NÃO implementar agora): Dash (impulso no PRÓPRIO caster + i-frames curtos), Escudo (timer `shieldUntil` que absorve dano), Gelo (stun de pés = `rootedUntil`).

## Critérios de aceite binários
1. [ ] Tecla Q usa a habilidade equipada se fora de cooldown e não stunnado; HUD mostra cooldown radial de 6 s.
2. [ ] Jato de Água empurra (knockback) os players no cone à frente, mais forte de perto, IGUAL nos 3 clientes (autoritativo).
3. [ ] Alvos atingidos ficam impedidos de ATIRAR por 1.2 s (podem andar); indicador de silêncio sobre a cabeça.
4. [ ] Partículas de água saem em leque das costas do conjurador na direção da mira, com respingo ao cair — 100% partícula, sem sprite.
5. [ ] Cliente adulterado não conjura em cooldown nem aplica knockback/stun em terceiros (validado no host).
6. [ ] Com 150 ms de latência: o empurrão nos alvos vem do snapshot sem rubber-banding; a partícula do próprio conjurador aparece imediata por predição.
7. [ ] Adicionar uma 2ª habilidade dummy (ex.: só partícula, sem efeito) exige apenas nova AbilityDef + case visual — provar que o framework é genérico (deixar a 2ª comentada/flagged).
8. [ ] Snapshot cresceu só por `abilityCdUntil`/`stunnedUntil`/`ability` (poucos bytes); evento `ability` genérico no protocolo.
9. [ ] `muzzlePoint`, origem da bala e sistemas existentes (munição, portas, gore) inalterados.