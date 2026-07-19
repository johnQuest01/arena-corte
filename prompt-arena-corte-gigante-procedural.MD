# Prompt — Arena Corte: gigante procedural TEMÍVEL (sem sprite, só código)

> Repositório `johnQuest01/arena-corte` commit d080332. Editar SOMENTE o bloco `if (en.type === 2)` dentro de `drawEnemy()` em `client/src/game/render.ts` (~linha 613-676). O gigante é desenhado por código (silhueta escura). Hoje lê como "boneco redondo simpático"; o objetivo é torná-lo MONSTRUOSO reusando a linguagem visual que JÁ funciona no Brutamontes (type 1, logo abaixo no mesmo arquivo): ombros retos e largos, olhos vermelhos com `shadowBlur`, formas angulares. Grátis, client-side, zero mudança de sim/rede. Mantém: sombra, halo de windup, uso de `scale`/`bob`/estados, olhos que reagem ao windup.

## Problemas atuais a corrigir
1. Torso é uma ELIPSE ovalada → parece fofo. Trocar por forma com OMBROS LARGOS e RETOS (trapézio/retângulo com topo largo), corpo afunilando pra cintura — silhueta de "brutamontes", não de "ovo".
2. Cabeça é um CÍRCULO limpo com olhos âmbar → parece amigável. Encaixar a cabeça baixa entre ombros altos (postura corcunda/ameaçadora), menor que os ombros, e olhos VERMELHOS brilhantes (não âmbar/verde).
3. Braços são linhas finas → dar volume e comprimento (braços longos e pesados que quase alcançam o chão, com "mãos"/garras).

## Mudanças (reescrever o bloco type 2)

Manter no topo: sombra (elipse escura), e o halo de windup (já existe). Ajustes:

### Sombra: maior e mais densa
```ts
ctx.fillStyle = "rgba(6,4,8,0.55)";
ctx.beginPath();
ctx.ellipse(0, 22 * s, 26 * s, 9 * s, 0, 0, Math.PI * 2);
ctx.fill();
```

### Pernas: mais grossas e curtas (peso)
```ts
ctx.fillStyle = "#0f0b10";
ctx.fillRect(-11 * s, 6 * s, 9 * s, 15 * s);
ctx.fillRect(2 * s, 6 * s, 9 * s, 15 * s);
```

### Braços LONGOS por trás do torso (desenhar ANTES do torso pra ficarem atrás)
```ts
ctx.strokeStyle = "#181016";
ctx.lineWidth = 7 * s;
ctx.lineCap = "round";
const armUp = windup ? -30 * s : 14 * s;   // no windup, braço direito ergue alto
// braço direito (o que ataca)
ctx.beginPath();
ctx.moveTo(15 * s, -10 * s);
ctx.lineTo(24 * s, armUp);
ctx.stroke();
// braço esquerdo pendendo longo (quase no chão) — postura de fera
ctx.beginPath();
ctx.moveTo(-15 * s, -10 * s);
ctx.lineTo(-20 * s, 16 * s);
ctx.stroke();
// garras/mãos nas pontas
ctx.fillStyle = "#0f0b10";
ctx.beginPath(); ctx.arc(24 * s, armUp, 4.5 * s, 0, Math.PI * 2); ctx.fill();
ctx.beginPath(); ctx.arc(-20 * s, 16 * s, 4.5 * s, 0, Math.PI * 2); ctx.fill();
```

### Torso com OMBROS LARGOS (forma angular, não elipse)
```ts
const bodyCol = windup ? "#3a1e18" : chase ? "#241820" : "#181016";
ctx.fillStyle = bodyCol;
ctx.beginPath();
// ombros largos no topo, afunila até a cintura (trapézio arredondado)
ctx.moveTo(-18 * s, -14 * s);   // ombro esq
ctx.lineTo(18 * s, -14 * s);    // ombro dir
ctx.lineTo(12 * s, 8 * s);      // cintura dir
ctx.lineTo(-12 * s, 8 * s);     // cintura esq
ctx.closePath();
ctx.fill();
// leve "peito"/volume
ctx.beginPath();
ctx.ellipse(0, -6 * s, 15 * s, 12 * s, 0, 0, Math.PI * 2);
ctx.fill();
// contorno de ameaça (mais fino e escuro que o dourado atual)
ctx.strokeStyle = chase || windup ? "#a03828" : "#5a3a30";
ctx.lineWidth = 1.5;
ctx.stroke();
```

### Espinhos/crista nos ombros (reusa ideia dos chifres do Brutamontes)
```ts
ctx.fillStyle = "#0f0b10";
ctx.beginPath(); ctx.moveTo(-18*s,-14*s); ctx.lineTo(-24*s,-26*s); ctx.lineTo(-10*s,-16*s); ctx.closePath(); ctx.fill();
ctx.beginPath(); ctx.moveTo(18*s,-14*s);  ctx.lineTo(24*s,-26*s);  ctx.lineTo(10*s,-16*s);  ctx.closePath(); ctx.fill();
```

### Cabeça baixa entre os ombros + olhos VERMELHOS com brilho
```ts
ctx.fillStyle = "#0d0a10";
ctx.beginPath();
ctx.arc(0, -20 * s, 9 * s, 0, Math.PI * 2);   // menor e mais baixa (corcunda)
ctx.fill();
// olhos vermelhos brilhantes (como o Brutamontes)
const eye = windup ? "#ff3a3a" : chase ? "#e02020" : "#a01818";
ctx.fillStyle = eye;
ctx.shadowColor = eye;
ctx.shadowBlur = windup ? 14 : chase ? 8 : 4;
ctx.beginPath();
ctx.arc(-3.5 * s, -21 * s, 2.4 * s, 0, Math.PI * 2);
ctx.arc(3.5 * s, -21 * s, 2.4 * s, 0, Math.PI * 2);
ctx.fill();
ctx.shadowBlur = 0;
```

### Halo de windup: trocar pra vermelho (perigo, não âmbar)
```ts
if (windup) {
  const pulse = 0.4 + Math.sin(tMs * 0.05) * 0.22;
  ctx.fillStyle = `rgba(200,40,30,${pulse})`;
  ctx.beginPath();
  ctx.arc(0, -6 * s, 30 * s, 0, Math.PI * 2);
  ctx.fill();
}
```
(desenhar o halo ANTES do corpo, como já é feito)

## Extra (opcional, barato)
- **Respiração**: leve escala vertical do torso (±2%) sincronizada com um seno lento — dá "vida".
- **Brilho de aggro contínuo**: em `chase`, um halo vermelho MUITO sutil (alpha ~0.08) constante ao redor, além do de windup.

## Critérios de aceite binários
1. [ ] O gigante tem OMBROS largos e retos + cabeça baixa entre eles (silhueta monstruosa/corcunda), não mais um oval com cabeça redonda.
2. [ ] Braços longos e grossos (um pende quase até o chão; o outro ergue no windup) com garras nas pontas.
3. [ ] Olhos VERMELHOS com brilho (shadowBlur), intensificando no chase e no windup — nada de âmbar/verde.
4. [ ] Espinhos/crista nos ombros; contorno avermelhado de ameaça (não dourado).
5. [ ] Halo de windup é vermelho (perigo); em chase há leve aura vermelha contínua.
6. [ ] Escala com `def.visualScale`, `bob`, estados e a marca de alvo continuam funcionando; FPS ≥ 60.
7. [ ] `git diff` restrito ao bloco `type === 2` de `drawEnemy` em render.ts; zero mudança em sim/rede/outros inimigos.
