# Prompt — Arena Corte: tela de loading (preload de assets)

> Repositório `johnQuest01/arena-corte` commit b640bac. As funções de carregamento JÁ EXISTEM (`preloadArt()` em art.ts, `preloadSfx()` em audio.ts). O que falta: (1) uma TELA de loading visual com progresso, e (2) ESPERAR o preload terminar antes de liberar o jogo — para eliminar engasgos de "primeira vez" (tiro mudo no 1º disparo, sprite/tile que aparece atrasado). É polish de primeira impressão, 100% cliente. NÃO toca sim/rede.

## Objetivo
Ao abrir o jogo: mostrar uma tela "Carregando... X%" enquanto `preloadArt()` + `preloadSfx()` rodam; só liberar o menu/jogo quando tudo estiver pronto. Assim, quando o jogador entra, todos os sprites, tiles e sons já estão carregados e decodificados — sem hitch de estreia.

## A. Reportar progresso do preload (art.ts + audio.ts)
As funções hoje retornam `Promise<void>` sem progresso. Adicionar um callback opcional de progresso:
- `preloadArt(onProgress?: (loaded: number, total: number) => void)`: contar o total de itens do manifest (chars×3 anims + guns + throws + items + tiles + props + door) ANTES do loop, e chamar `onProgress(++loaded, total)` a cada `loadImage`/`loadAnim` concluído.
- `preloadSfx(onProgress?)`: já usa `Promise.all` sobre a lista de sons — trocar por contagem incremental (ou reportar por som decodificado) chamando `onProgress`.
- Combinar os dois progressos numa fração 0..1 no App (ex.: art conta 70%, sfx 30%, ou somar os totais).
- Manter o comportamento tolerante a asset faltando que já existe (asset ausente não trava — só conta como "processado").

## B. Tela de loading (App.tsx + componente novo LoadingScreen.tsx)
1. Estado no App: `const [loadProgress, setLoadProgress] = useState(0); const [assetsReady, setAssetsReady] = useState(false);`
2. No `useEffect` de init (antes de liberar menu/partida):
```ts
useEffect(() => {
  let alive = true;
  (async () => {
    let a = 0, s = 0;
    await Promise.all([
      preloadArt((l, t) => { if (alive) { a = t ? l / t : 1; setLoadProgress(0.7 * a + 0.3 * s); } }),
      preloadSfx((l, t) => { if (alive) { s = t ? l / t : 1; setLoadProgress(0.7 * a + 0.3 * s); } }),
    ]);
    if (alive) { setLoadProgress(1); setAssetsReady(true); }
  })();
  return () => { alive = false; };
}, []);
```
3. Renderizar `LoadingScreen` enquanto `!assetsReady`; só mostrar o menu/jogo quando `assetsReady`.
4. **LoadingScreen** (novo componente, estilo coeso com o HUD — paleta Resurrect 64, fonte Martian Mono):
   - Título/logo "ARENA CORTE" (texto estilizado; se não houver logo, tipografia forte).
   - **Barra de progresso** preenchendo 0→100% (largura = `loadProgress*100`%), com número "%" e um texto rotativo opcional ("Carregando arsenal...", "Preparando a cidade...", "Acordando os zumbis...").
   - Fundo escuro apocalíptico (cor da paleta), talvez uma silhueta simples. Sem travar (a barra deve andar de verdade conforme o progresso real).
5. O áudio precisa de gesto do usuário pra desbloquear (AudioContext): incluir um botão "ENTRAR"/"JOGAR" que aparece quando `assetsReady` — o clique desbloqueia o áudio E entra no menu. (Assim o preload roda durante a tela, e o clique final libera som + jogo.)

## C. Detalhes
- Se o preload for MUITO rápido (assets em cache), garantir um tempo mínimo de exibição da tela (~400 ms) pra não "piscar" — opcional, evita flash.
- Erros de asset individual não bloqueiam (já é tolerante); se o manifest inteiro falhar, seguir pro jogo mesmo assim (fallback procedural já existe).
- A tela é só na abertura do app; não reaparece entre partidas (a menos que você queira um mini-loading ao trocar de mapa — não fazer agora).

## Regras
- 100% cliente (App.tsx, novo LoadingScreen.tsx, callbacks em art.ts/audio.ts). Não toca sim/protocolo/rede/muzzlePoint.
- A barra reflete progresso REAL do preload (não é falsa/temporizada).

## Critérios de aceite binários
1. [ ] Ao abrir o jogo, aparece uma tela de loading com barra que enche de 0 a 100% conforme os assets carregam de verdade.
2. [ ] O menu/jogo só fica acessível após o preload terminar (assetsReady); um botão "ENTRAR" libera a entrada.
3. [ ] O clique no botão desbloqueia o áudio (AudioContext) — sons funcionam desde o primeiro disparo, sem tiro mudo na estreia.
4. [ ] Não há mais hitch de "primeira vez": sprites, tiles e sons aparecem/tocam sem atraso na primeira ocorrência em partida.
5. [ ] Asset faltando não trava o loading (tolerância existente mantida); manifest ausente → segue pro jogo com fallback procedural.
6. [ ] A tela é estilizada na paleta/fonte do jogo (não um "loading" genérico feio).
7. [ ] `git diff` restrito ao cliente (App.tsx, LoadingScreen.tsx, callbacks de progresso em art.ts/audio.ts); zero mudança em sim/rede.
```
