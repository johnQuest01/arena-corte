Os desenhos-base (sprites) Kenney.nl 
→ Pack usado: Top-down Shooter (CC0) — personagens em `client/public/assets/chars/`
→ Fonte: https://kenney.nl/assets/top-down-shooter

A paleta (as cores). O Lospec
→ Referência: Resurrect 64 — tons no canvas (`LOSPEC` em render.ts)
→ https://lospec.com/palette-list/resurrect-64

Cada efeito que você citou, de onde vem:

Fogo do tiro (muzzle flash): um clarão (gradiente radial + fagulhas) na ponta da arma por ~50ms, some rápido. Código.
Bala com velocidade: a bala é posição + vetor velocidade, anda v × dt por frame, desenhada como um risco (linha da posição anterior à atual) com rastro que some — é o risco que dá a sensação de velocidade. Código + a matemática de vetor do começo da nossa conversa.
Boneco correndo: aí sim precisa de sprite — um ciclo de frames de um sprite sheet (Kenney). No top-down dá pra economizar: um sprite que gira pra direção do movimento + um "balanço" leve já convence.
Carro virando com aquele "meio 3D olhado de cima": é ilusão montada por código — sombra deslocada (finge altura do chão), inclinação/skew lateral proporcional a quão forte ele vira, e drift (a velocidade não acompanha 100% a direção, então desliza de lado e deixa marca de pneu). Junta os três e o olho lê como peso/3D. Tudo transform de canvas.