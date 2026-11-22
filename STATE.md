# STATE — sightdeck

## Perf de boot/render (2026-11-19, fases 1-3)

- **Fase 1** (`bc1431a`): 42 comandos viraram `#[tauri::command(async)]` (saem da
  thread do IPC; `pty_*` fica sync pela ordem open→write) e o stream não
  re-renderiza markdown por frame (delta cru + `flushStream` no fim de turno).
- **Fase 2** (`da65526`): histórico em fatias de 25 com `renderToken` (offscreen
  segue síncrono por causa do `loadEarlier`), `scrollBottom` coalescido no rAF,
  `write_stdin` escreve fora do lock global e `stop_session`/`kill_all` matam
  fora do mutex.
- **Fase 3**: `session_model` com `contained_in` + stream de linhas (era
  `read_to_string` de até 26 MB); `hooks_tail` lê só o fim do log; `git_file_diff`
  capa em 256 KB; `list_sessions` abre cada arquivo uma vez (`read_head_meta`).
- **Medido**: 749 `.jsonl` / 548 MB de histórico; varredura completa leva ~880 ms
  de I/O (cache quente). `usage_stats` ficou sem teto por decisão — é async desde
  a fase 1 e roda só ao abrir a view de uso.

## Onde estamos (2026-11-18, modal fechável + ⚙ direto)

- **⚙ abre direto o modal** `#settings` na aba Geral; o popover foi REMOVIDO
  (ações de manutenção — verificar atualização, atualizar extensões/pi — foram
  para a aba **Sobre**).
- **Modal de verdade**: `.overlay.modal` ganhou scrim (`rgba(0,0,0,.55)`),
  caixa centralizada `.modal-box` (`min(920px,92vw)`, `max-height:86vh`,
  borda/raio/sombra). Fecha por: botão × (`settingsback`), clique no scrim
  (`mousedown` fora da caixa) e **Esc** (handler no keydown global).
- Handlers órfãos removidos (`settingsopen`, `pkgbtn`, `themebtn`, `debugbtn`,
  `aboutbtn`, click-outside do popover) — quebravam o boot com null.
  `openPkgs()` removida; `switchSettingsTab('pkgs')` garante a 1ª linha de env
  do MCP.
- Teste de integridade atualizado (sem `aboutbtn`/`#about`; agora `settings`,
  `settings-tabs`, `pane-*`, `checkupdate`, `updExt`, `updPi`, `updOut`).
- Verificado: `test:ui` **145/145**, `build:ui` ✓ (396 ms), `node --check` OK,
  reload do dev sem erros.

## Onde estamos (2026-11-18, modal único de configurações com abas)

- **Modal único**: o ⚙ abre o popover (menu) e cada item abre `#settings` na aba
  correspondente. Abas: **Geral** (toggles + idioma + hooks), **Tema**
  (presets), **Pacotes** (instalados/catálogo/MCP/hooks), **Debug**
  (missões/avisos/diagnóstico) e **Sobre**. Os overlays antigos
  (`#theme`, `#pkgs`, `#debug`, `#about`) foram removidos; `#provpick` segue
  como overlay próprio (login).
- `switchSettingsTab(name)` alterna panes e só carrega o que a aba precisa
  (`switchPkgPane('installed')`, `loadMissions/renderHealthList/renderDiag`,
  `openAbout`). Abas usam classe própria `.settings-tab` para não colidir com o
  seletor global `.pkg-tab` do `switchPkgPane`.
- **Lista de modelos**: `.model-row` virou flex com `align-items:center`;
  `.model-name` flex:1 com ellipsis; `.model-ctx` com `min-width:4em` e
  alinhado à direita (coluna de contexto deixou de ficar fora de ordem);
  estrela de favorito em 16px.
- **Lição (regra global)**: reestruturar HTML por faixa de linhas com
  `awk`/`sed -i N,M` engoliu o `<aside id="sidebar">` e duplicou IDs. Registrado
  em `~/.pi/agent/AGENTS.md` §5: usar `edit` por conteúdo e validar com o parser.
- Verificado: `test:ui` **145/145**, `build:ui` ✓ (376 ms), reload do dev sem
  erros, zero handlers órfãos e zero IDs duplicados.

## Onde estamos (2026-11-18, ajustes do teste de runtime)

Feedback do usuário na janela dev -> corrigido:

- **Duplicação de placeholders** (2x "nenhum subagent", sidebar presa em
  "carregando…"): `.empty` estáticos nos containers `#sessions/#subs/#plans/
  #git/#missions` ficavam ao lado do componente montado. Removidos; o
  componente é a única fonte.
- **Lista de modelos sem scroll/grupos**: `ModelPop` não envolvia as linhas em
  `.model-list` (max-height/overflow). Corrigido -> grupos de provider visíveis
  e lista rolável.
- **Cores da aba não mudavam com o tema**: `#7c869c`, `#394055`, `#4f5f80`,
  `#6f7a92` hardcoded -> `--ink-5`/`--dot-off`.
- **Presets fracos**: cada preset só cobria 16/46 chaves. Expandidos para a
  paleta completa (bg-0..4, ink-0..6, bordas, controles, hovers, chips, estados).
- **Configurações**: popover virou MENU; modal grande `#settings` (novo overlay)
  concentra os toggles + idioma (componente Settings continua em
  `#settings-general`). Handlers `settingsopen`/`settingsback`.
- **ctx popover**: só dados da sessão (agregado de abas removido — `sessAggSnapshot`
  e `sessShort` deletados), **% de cache hit do input** e **média de tokens por
  mensagem**. i18n pt/en novos.
- **Favoritar modelos**: estrela na linha, persistida em `localStorage['model-favs']`,
  favoritos ordenados no topo do grupo (função `loadModelFavs`/`saveModelFavs`).
- **Terminal**: sintoma "não digitava" não reproduziu depois do reload; nenhum
  erro de PTY no log (a única feature no Cargo.toml é `e2e`).
- **Pendências deste feedback**: transformar Sobre em mini modal; avaliar o
  restante da UI com o usuário.
- Verificado: `test:ui` **145/145**, `build:ui` ✓ (362 ms), HMR recarregado.

## Onde estamos (2026-11-18, Fase 7c CONCLUÍDA: legado removido)

- **Branch**: `sprint/svelte-migration`. Sem release/versão — sprint para teste.
- **Removido nesta etapa**: corpos legados de `renderTabs`, `renderPlans`,
  `renderMissions`, `paintSubs`, `renderGit`, `renderAttachments`, `setTyping`,
  `renderPalette`, `renderCmdk`, `renderCtxPop`, `renderModelList`,
  `fillLevels`, `openForkPop`, `loadSessions`, `runSearch`; helpers órfãos
  (`liveRunBox`, `diskRunBox`, `rowTiming`, `tickSubsTimes`, `subsClock`,
  `ensureSubsClock`, `applySubsWarning`, `gitCheck`, `appendAgg`,
  `appendCtxBlock`, `renderLimitSelect`, `saveLimit`, `showThemeNote`);
  handlers/DOM legados de Settings e Tema; e os 6 wrappers `*-legacy` do HTML.
- **Contratos preservados fora dos componentes**: `#thinkbtn`, `#modelname`,
  `#modelctx`, `#gitcnt`, `#searchmeta`, `#typing`/`#attachrow` (classe hidden),
  `#palette`/`#cmdkbar`/`#palettefoot`.
- **Bugs reais achados e corrigidos nesta fase**: (1) early-path do `renderCmdk`
  pulava o `remove('hidden')` do overlay (Ctrl+K não abria); (2) `fillLevels`
  não podia virar só sync — ele mantém o chip `#thinkbtn`, que vive fora do pop.
- **Números**: `main.js` **5524** (de 6136 → −612), `i18n.js` **799** (de 801),
  `index.html` **314** (de 359 → −45). `oxlint main.js`: 0 funções não usadas,
  só warnings de estilo pré-existentes.
- **Verificado**: `test:ui` **146/146**, `build:ui` ✓ (540 ms); teste de
  integridade agora exige que os wrappers legacy **não existam**.

## Onde estamos (2026-11-18, Fase 7c EM CURSO: remoção do legado)

- **Branch**: `sprint/svelte-migration` (a `main` local tem os mesmos 5 commits;
  nada foi para `origin`). **Sem release, sem bump de versão** — sprint separada.
- **Decisão do usuário**: objetivo é migrar, então os fallbacks legados serão
  REMOVIDOS (não mantidos). `main.js` deve encolher de verdade.
- **Removido até aqui** (146/146 e build ✓ após cada lote):
  `renderTabs`, `renderPlans`, `renderMissions`, `paintSubs` + `liveRunBox`,
  `diskRunBox`, `rowTiming`, `tickSubsTimes`, `subsClock`, `ensureSubsClock`,
  `applySubsWarning`, `renderGit` (corpo) + `gitCheck`, `renderAttachments`,
  `setTyping`, `renderPalette` e `renderCmdk` (corpos).
- **Bug real corrigido**: o early-path do `renderCmdk` retornava antes do
  `$('palette').classList.remove('hidden')` — o Ctrl+K não abria o overlay.
  Visibilidade movida para antes do return + asserção no teste de regressão.
- `subsError` substitui o `setEmpty($('subs'))` legado (mostrado via snapshot).
- `main.js`: **5829** linhas (era 6136 no início da 7c).
- **Falta**: `renderCtxPop` + helpers (`appendCtxBlock`/`appendAgg`/
  `renderLimitSelect`), `renderModelList`/`fillLevels`, `openForkPop`,
  `loadSessions` legado, `runSearch` legado, handlers/DOM legados do Settings e
  Tema, e os 6 wrappers `*-legacy` do `index.html`.

## Onde estamos (2026-11-18, Fase 7b aplicada — FIM DA MIGRAÇÃO)

- **Fase 7b**: guard-rail de integridade em `tests/ui.test.mjs`: (a) todo wrapper
  legacy (`settings/theme/modelpop/ctxpop/forkpop/typing-legacy`) precisa estar
  `hidden` no boot quando o mount funciona — regressão real da Fase 5d; (b) os 16
  containers Svelte precisam existir no HTML. Auditoria: 16 mounts chamados 1×,
  12 early-paths, 6 wrappers — nenhum órfão.
- **Números finais**: `ui/index.html` **359** linhas; `ui/src/main.js` **6136**
  (cresceu de 5368: builders puros + hosts + monts + fallbacks mantidos);
  **16 componentes Svelte**.
- **Decisão pendente do usuário (Fase 7c)**: os renders legados foram mantidos
  como fallback de mount. Removê-los cortaria ~700 linhas do `main.js`, mas
  elimina a rede de segurança se o mount falhar no runtime Tauri.
- Verificado: `test:ui` **146/146**, `build:ui` ✓ (383 ms).

## Onde estamos (2026-11-18, Fase 6 decidida + Fase 7a aplicada)

- **Fase 6 NÃO migrada — decisão técnica com evidência**:
  - *Stream*: `scheduleStreamRender` (`main.js:2738`) usa `requestAnimationFrame`
    e atualiza só o nó corrente (`setMarkdown(stream.node, stream.text)`), sem
    re-renderizar a lista; `insertRowByAt`/`appendCapped`/`renderMessages` são o
    núcleo de performance, com **40** referências de teste no caminho.
  - *Terminal*: as abas são renderizadas em `terminal.js:220` (`$('termtabs')`),
    dentro do módulo que já gerencia PTY/xterm — migrar a casca criaria fronteira
    artificial no ciclo de vida do xterm.
- **Fase 7a**: o render legado de `loadSessions` agora consome
  `sessionsSnapshot(visible, treeOpts())` e resolve sessão por path/key —
  dívida de duplicação eliminada (~60 linhas). `sessionTreeHost` segue sendo a
  via do componente; o legado usa as funções diretas (sem TDZ).
- Verificado: `test:ui` **144/144**, `build:ui` ✓ (404 ms), oxlint exit 0 nos
  `.svelte` (warnings de estilo em `main.js` são pré-existentes).

## Onde estamos (2026-11-18, Fase 5d Svelte aplicada: indicador de digitação)

- **Fase 5d**: indicador `#typing` em Svelte (`ui/src/composer/TypingIndicator.svelte`).
  Builder puro `typingSnapshot(on, label)` exportado (visible + label com
  fallback `status.thinking`). `setTyping()` guarda `typingOn`/`typingLabel`
  canônicos e ganhou early-path `typingPane.sync()`; exportado para teste.
- **Bug real corrigido (achado pelo teste de integração)**: o markup legado do
  `#typing` (`pensando…` no HTML) continuava no DOM ao lado do componente e
  aparecia com o painel oculto. Criado `#typing-svelte` (mount) +
  `#typing-legacy` (escondido quando o mount funciona), como no Tema/pops.
- Wiring: `#typing-svelte`/`#typing-legacy` ✓, mount `main.js:5849`, legacy
  toggle `main.js:5853`.
- Verificado: `test:ui` **144/144**, `build:ui` ✓ (396 ms), oxlint exit 0.
- Composer (textarea + barra de botões + fila) segue imperativo por decisão
  técnica: `#input` concentra autosize/draft por aba/paste de imagem/Enter, e os
  botões só disparam handlers do main — migrar seria mover 11 listeners sem
  remover lógica.

## Onde estamos (2026-11-18, Fase 5c Svelte aplicada: palette global Ctrl+K)

- **Fase 5c**: cmdk em Svelte (`ui/src/composer/CmdkList.svelte`). Builder puro
  `cmdkSnapshot(groups, index)` exportado (índice achatado entre grupos,
  RECENTES/COMANDOS/MODELOS, `sel`). `renderCmdk()` ganhou early-path
  `cmdkPane.sync()`; navegação por teclado segue no main. `openCmdk`/`closeCmdk`
  exportados para teste.
- **Bug real corrigido (introduzido na 5b)**: `renderCmdk` fazia
  `clear($('palettelist'))` — o mesmo nó do componente Palette, e `clear()`
  remove nós (shared.js:32), destruindo o Svelte. Criado container próprio
  `#cmdklist` no `index.html`; cmdk e palette agora alternam visibilidade.
  Teste de regressão em `tests/ui.test.mjs` ("abrir o cmdk não destrói o
  componente da palette").
- Wiring: `#cmdklist` ✓, mount `main.js:5827`, early-path `main.js:4621`;
  única escrita legada em `#palettelist` é `main.js:4484` (só sem mount).
- Verificado: `test:ui` **141/141**, `build:ui` ✓ (415 ms), oxlint exit 0.
- Commits desta série: `fc7b925` (Fases 0-4 + 5a) + lote 5b/5c.

## Onde estamos (2026-11-18, Fase 5b Svelte aplicada: palette de comandos)

- **Fase 5b**: lista da palette `/` em Svelte (`ui/src/composer/Palette.svelte`).
  Builder puro `paletteSnapshot(items, index)` exportado (linha `/nome`,
  descrição, origem, `sel`). `renderPalette()` faz `hidden` + early-path
  `palettePane.sync()`; navegação por teclado segue no main (muta
  `palette.index` e re-renderiza → sync). Ação via host: `pick(idx)`.
- Wiring: `#palettelist` ✓, mount `main.js:5787`, early-path `main.js:4476`.
- Verificado: `test:ui` **138/138**, `build:ui` ✓ (396 ms), oxlint exit 0.
- Commit anterior desta série: `fc7b925` (Fases 0-4 + 5a). 5b ainda não commitada.

## Onde estamos (2026-11-18, Fase 5a Svelte aplicada: anexos do composer)

- **Fase 5a**: linha de anexos `#attachrow` em Svelte
  (`ui/src/composer/Attachments.svelte`, montado por `composer/mount.js`).
  Builder puro `attachmentsSnapshot(images)` exportado (idx/src/alt/rótulo).
  `renderAttachments()` mantém o `hidden` do container e ganhou early-path
  `attachmentsPane.sync()`; legado preservado. Ação via host: `remove(idx)`.
- Wiring: `#attachrow` ✓, mount `main.js:5757`, early-path `main.js:5297`.
- Verificado: `test:ui` **136/136**, `build:ui` ✓ (438 ms), oxlint exit 0.
  NÃO commitar sem pedido.

## Onde estamos (2026-11-18, Fase 4 FECHADA: Plano, Missões, Git, Subagents)

- **Fase 4e (Arquivos/diff) NÃO migrada — decisão técnica registrada**: o
  overlay `#detail` é host compartilhado por 3 fluxos (`openDiffs`,
  `openWorktreeDiff` async com loading/erro, `openMission`) e o núcleo é o
  diff imperativo (Prism em `renderPatch` + `node.diffArgs` consumido por
  `refreshDiffs`). Migrar só a casca adicionaria sincronização sem remover o
  código imperativo → ficou como está (main.js:1455-1532).
- **Fase 4 completa** (4 peças Svelte): Plano, Missões, Git, Subagents.
- Verificado: `test:ui` **134/134**, `build:ui` ✓ (380 ms), oxlint exit 0.

## Onde estamos (2026-11-18, Fase 4d Svelte aplicada: painel Subagents)

- **Fase 4d**: painel `#subs` em Svelte (`ui/src/panels/SubsPane.svelte`).
  Builder puro `subsSnapshot(live, disk, {now})` exportado (vazio/aviso de
  extensão, runs ao vivo com children model/thinking/tempo, histórico de disco
  deduplicado por `sameSub`, `CHILD_STATE`). `paintSubs()` ganhou early-path;
  `applySubsWarning()` não injeta DOM quando o painel é Svelte (banner vem do
  snapshot). Relógio de 1 s agora é `$effect` do componente: reavalia `now` e o
  `{#each}` com key preserva nós/scroll (não repinta a lista).
- Ajuste de teste pré-existente (`tests/ui.test.mjs`, relógio ao vivo): virou
  async com `await tick()` — o flush do Svelte é microtask e o early-path não
  pinta no DOM de forma síncrona.
- Wiring: `#subs` ✓, mount `main.js:5889`, early-path `main.js:2332`.
- Verificado: `test:ui` **134/134**, `build:ui` ✓ (380 ms), oxlint exit 0.
  NÃO commitar sem pedido.

## Onde estamos (2026-11-18, Fase 4c Svelte aplicada: painel Git)

- **Fase 4c**: painel `#git` em Svelte (`ui/src/panels/GitPane.svelte`).
  Builder puro `gitSnapshot(data, ui)` exportado (erro/sem repo/sem sessão,
  head branch/ahead/behind/arquivos/totais, linhas com seleção e titleAttr,
  nota, composer com msg/amend/lease e labels i18n). `renderGit()` ganhou
  early-path `gitPane.sync()`; legado preservado.
  Estado canônico segue no main (`gitSel`/`gitMsg`/`gitAmend`/`gitLease`); o
  componente só espelha. Foco/caret do textarea agora é nativo do Svelte
  (não recria o nó), então o workaround antigo de re-focar sumiu do caminho novo.
- Wiring: `#git` ✓, mount `main.js:5824`, early-path `main.js:1905`;
  `startGitPoll()` em `5940` (depois do mount).
- Verificado: `test:ui` **131/131**, `build:ui` ✓ (390 ms), oxlint exit 0.
  NÃO commitar sem pedido.

## Onde estamos (2026-11-18, Fase 4b Svelte aplicada: painel Missões)

- **Fase 4b**: painel `#missions` (Debug) em Svelte
  (`ui/src/panels/MissionsPane.svelte`, montado por `panels/mount.js`).
  Builder puro `missionsSnapshot(list, err)` exportado (vazio/erro, título,
  status, runs, head com contagem). `renderMissions()` ganhou early-path
  `missionsPane.sync()`; legado preservado. Ação via host: `open(id)` → `openMission`.
- Wiring: `#missions` ✓, mount `main.js:5723`, early-path `main.js:1665`;
  nenhuma chamada top-level de `renderMissions` (só via `loadMissions`).
- Verificado: `test:ui` **128/128**, `build:ui` ✓ (340 ms), oxlint exit 0.
  NÃO commitar sem pedido.

## Onde estamos (2026-11-18, Fase 4a Svelte aplicada: painel Plano)

- **Fase 4a**: painel `#plans` em Svelte (`ui/src/panels/PlansPane.svelte` +
  `panels/mount.js`). Builder puro `plansSnapshot(data, err)` exportado (vazio/
  erro/sem repo, nome/fonte/próximo item, `done/total`, barra `pct`).
  `renderPlans()` ganhou early-path `plansPane.sync()`; legado preservado.
  Ação via host: `open(file)` → `open_file`.
- Wiring: `#plans` ✓, mount `main.js:5689`, early-path `main.js:2011`;
  `loadPlans` só roda por clique na aba (sempre após o mount).
- Verificado: `test:ui` **126/126**, `build:ui` ✓ (393 ms), oxlint exit 0.
  NÃO commitar sem pedido.

## Onde estamos (2026-11-18, Fase 3 FECHADA: abas + árvore + busca em Svelte)

- **Fase 3c**: resultados da busca em Svelte (`ui/src/sidebar/SearchResults.svelte`
  + `search-mount.js`). Builder puro `searchSnapshot(items, {total, offset})`
  exportado (linha, snippet, badge de tools, erro, paginação, vazio).
  `runSearch` acumula em `searchItems`/`searchTotal` e ganhou early-path
  `searchResults.sync()`; legado preservado. Chave i18n nova `search.none`
  (substitui o `'nada encontrado'` hardcoded) pt/en.
- **Fase 3 completa**: abas (3a) + árvore de sessões (3b) + busca (3c).
- Verificado: `test:ui` **123/123**, `build:ui` ✓ (340 ms), oxlint exit 0.
  Wiring: `#searchresults` ✓, mount `main.js:5645`, early-path `main.js:640`.
  NÃO commitar sem pedido.

## Onde estamos (2026-11-18, Fase 3b Svelte aplicada: árvore de sessões)

- **Fase 3b**: `#sessions` em Svelte (`ui/src/sidebar/SessionTree.svelte` +
  `mount.js`). Builder puro `sessionsSnapshot(groups, opts)` exportado (caret,
  nome, contagem, oculto, paginação `SESS_PAGE`, labels i18n). `loadSessions`
  mantém fetch/cache de títulos/init de colapsados e ganhou early-path
  `sessionTree.sync()` **antes** do render legado (que segue intacto como fallback).
  Ações via host: `toggleProject`/`hideProject`/`newSession`/`open`/`askDelete`/`loadMore`.
- **Dívida consciente**: o render legado de `loadSessions` ainda não consome
  `sessionsSnapshot` (duplicação temporária até a Fase 7 remover o fallback).
- Ordem segura: mount em `main.js:5596`, boot `loadSessions()` em `5713` —
  o early-path Svelte sempre vence.
- Verificado: `test:ui` **120/120**, `build:ui` ✓ (316 ms), oxlint exit 0.
  NÃO commitar sem pedido.

## Onde estamos (2026-11-18, Fase 3a Svelte aplicada: barra de abas)

- **Fase 3a**: barra `#tabs` em Svelte (`ui/src/tabs/TabBar.svelte` + `mount.js`).
  Builder puro `tabsSnapshot(list, active)` exportado; `renderTabs()` virou
  `saveTabs()` + early-path `tabBar.sync()` + legado sobre o snapshot.
  Sem wrapper legado: `#tabs` é preenchido só por JS, e o mount roda antes do
  boot (IIFE no fim do arquivo), então não há duplicação.
- A11y: tab com `role=button`/`tabindex`/Enter/Espaço.
- Verificado: `test:ui` **117/117**, `build:ui` ✓ (307 ms), oxlint exit 0.
  NÃO commitar sem pedido.

## Onde estamos (2026-11-18, Fase 2 Svelte aplicada: pops do composer)

- **Fase 2**: 3 pops do composer em Svelte (`ui/src/composer/`: `ModelPop` +
  `CtxPop` + `ForkPop` + `mount.js`, contrato `mount(host)` do piloto).
  Builders puros exportados (`modelListSnapshot`, `levelsSnapshot`,
  `ctxSnapshot`, `sessAggSnapshot`, `limitSnapshot`, `forkSnapshot`);
  renders legados refatorados sobre os builders (saída idêntica) com
  early-path Svelte; overlays legados viraram fallback (`#*-legacy`).
- i18n: 1 par novo (`fork.header` pt/en); resto reutiliza chaves existentes.
- A11y: rows clicáveis com `role=button` + `tabindex` + Enter/Espaço.
- Verificado neste turno: `test:ui` **113/113**, zero warnings Svelte,
  `build:ui` ✓ (549 ms). NÃO commitar sem pedido.
- **Armadilhas descobertas na Fase 2** (valem para toda migração Svelte):
  - Svelte 5 **delega** `click`/`change`/`input` na raiz do componente: em teste
    jsdom, `dispatchEvent(new Event('change'))` sem `{ bubbles: true }` não chega
    ao handler (teste do CtxPop falhou assim; corrigido no teste, não no componente).
  - pi-lens/oxlint analisa só o `<script>` de arquivos `.svelte` e reporta falso
    "unused" para estado consumido no template. Suprimir na linha com
    `// pi-lens-ignore: lint/correctness/noUnusedVariables — <motivo>`.
  - `lang;` solto para registrar dependência reativa gera
    `no-unused-expressions`; a forma limpa é `void lang;` (provado com oxlint).
  - Pops/Theme **não** precisam de `lang` local: `setLang` só é chamado pelo
    Settings, e abrir o Settings fecha esses overlays (estado morto removido).

## Onde estamos (2026-11-18, Fase 0+1 Svelte aplicada: Tema com presets)

- **Fase 0**: warning `state_referenced_locally` de `Settings.svelte:9` eliminado
  (snapshot intencional + `svelte-ignore`); comentário TODO órfão removido.
  `test:ui` sem warnings Svelte.
- **Fase 1**: diálogo de Tema em Svelte (`ui/src/settings/theme/Theme.svelte` +
  `mount.js`, contrato `mount(host)` do piloto) com galeria de **6 presets**
  (`ui/src/themes/presets.js`: Sightdeck Dark, One Dark, Darcula, Dracula,
  Gruvbox Dark, Nord — 16 chaves ⊆ `THEME_KEYS`, motor `applyTheme` intacto).
  Overlay legado virou fallback (`#theme-legacy`, esconde quando o mount funciona).
- i18n: 5 chaves `theme.*` novas em pt+en (`presets`, `custom`, `use_preset`,
  `active`, `exported`); handler legado `themeexport` usa `t()` agora.
- Verificado neste turno: `test:ui` **104/104**, `build:ui` ✓ (710 ms).
  NÃO commitar sem pedido (lote i18n 2 em curso no mesmo arquivo).

## Onde estamos (2026-11-18, v0.2.5 publicada)

- **v0.2.5 publicada** (11 assets: 5 instaladores + 5 `.sig` + `latest.json`). Run `44321035468`
  verde em todos os jobs (`test`, `test (windows)`, `clippy`, builds, `publish`).
- **Primeira release com auto-update assinado.** `latest.json` lista `linux-x86_64-{appimage,deb,rpm}`
  e `windows-x86_64-{nsis,msi}`.
- **Atenção**: quem está na 0.2.4 **não** recebe 0.2.5 automaticamente (o updater entrou nesta
  versão). O primeiro ciclo automático é **0.2.5 → 0.2.6**.
- **Par de chaves rotacionado** para `~/.tauri/sightdeck-v2.key` (senha no Bitwarden): a chave
  anterior tinha senha perdida e nunca assinou release publicada. `tauri.conf.json` foi atualizado
  para o `pubkey` novo; `.pi-lens.json` não foi necessário (LSP resolveu com `ui/vite.config.js`).
- Armadilhas de assinatura documentadas em `docs/RELEASE.md` (senha obrigatória para chave cifrada,
  verificação do aviso de pubkey divergente antes de publicar).

## Onde estamos (2026-11-18, updater)

- Updater Tauri em implementação: Rust pronto (`Cargo.toml`, `main.rs` 2 builders, `tauri.conf.json` pubkey/endpoints/`createUpdaterArtifacts`, capabilities `updater`+`process`). Falta: deps JS, UI via plugin, CI (`latest.json` + tar/zip). NÃO commitar/taggear sem pedido.

## Onde estamos (2026-11-18, i18n)

- Lote 1 i18n aplicado (25 trocas em `main.js` para `t()`, pt idêntico); lote 2 em curso: ~120 chaves novas pt+en em `i18n.js` + swaps (sidebar, ctx popover, APP_COMMANDS, git hints). NÃO commitar sem pedido. `vitest` 100/100, `build:ui` ok.

## Onde estamos (2026-11-18)

- **v0.2.4 publicada** (5 assets: deb/AppImage/rpm/exe/msi). Release: run `44215135306`
  (`test`, `clippy`, `test (windows)`, builds Linux/Windows, `publish` todos verdes), draft →
  `gh release edit v0.2.4 --draft=false --latest`; `releases/latest` = `v0.2.4`. Conteúdo:
  path relativo em `open_file`/`revert_hunk`, `<select>` legível, run novo no painel durante o
  turno e dispensar aviso de extensão. `cargo test` 95, vitest 97, `build:ui` ok.
- Review de memória/custo feito junto: o poll de 2 s do painel passou a rodar **só com a aba
  Subagents à vista** — `list_children` faz `read_title` (até 200 linhas) + `child_state` (últimos
  64 KB) por child run, medido ~8 ms/child num child session de 13,8 MB, e não tem teto de runs.

## Onde estamos (2026-11-17)

- **v0.2.3 publicada** (5 assets: deb/AppImage/rpm/exe/msi). Release: run `44198214263`
  (`test`, `clippy`, `test (windows)`, builds Linux/Windows, `publish`), draft →
  `gh release edit v0.2.3 --draft=false --latest`. Inclui o PR #4 (dedupe do reattach,
  slim de mensagens grandes), i18n pt/en, stats ao vivo e o setup E2E (`--features e2e`).
  `npm run build` release OK (deb 3.3 MiB); vitest 96, cargo 94, clippy verde.

## Onde estamos (2026-11-16)

- Commit `c72194e` (thinking por aba, notificação, copiar-path/abrir, Missões); lote B mergeado sem commit (yaml pinado, custo/tokens, Diagnóstico); task-4 reimplementada no pai (allowlist 43 nomes confirmados via runtime `pi auth login __deck_list__`, 3 testes, CSP mínima cobrindo script/style inline, `data:`, 2 hosts fetch e IPC); cargo test a seguir.
- Lote C mergeado (abas persistentes, busca global `search_sessions`, Cmd-K + `/model` com args + recentes) + cap anti-jank `q.slice(0,120)` nas palettes; `cargo test` 23/23.
- Lote D mergeado (auditorias security+Rust): `list_children` com `contained_in` + teste, `drop_child` anti-órfão em `start_session`/stdio, links só `http(s)` com `rel` + abertura via backend; `cargo test` 24/24.
- Revert de hunk na aba Arquivos (`revert_hunk(cwd,file,hunk)`, match exato ocorrência única, recusa truncado/só-adições/só-remoções/fora-do-cwd, 7 testes); residuais do review (teste positivo `list_children_in`, `drop_child` no lock envenenado); `cargo test` 32/32.
- Estacionados a pedido do usuário (sem código): painel/runner de schedules (spec real minerada do `pi-subagents@0.88.1`; runner reverteria o não-daemon) e gate SkillSpector no `pi install`.
- v0.1.16 publicada (`draft=false`, 7 assets, CI verde após fixes do clippy).
- Fork-por-mensagem em investigação: `get_fork_messages` retorna só USER messages (`{entryId,text}`); `fork(entryId)` rebinda a sessão (`rpc-mode.js:503-509`); mapear botão na resposta do modelo exige decidir se o ponto é a user msg anterior (refazer) ou posterior (incluir resposta).

- v0.1.18 (local; commits `c687c17` + merge `40a6513` + `ad6936d`): UI deixa de ser single-file — `ui/index.html` 4824→249 linhas, CSS/JS em `ui/src/{styles.css,main.js,rpc.js,shared.js,markdown.js,tool-cards.js}`, build Vite (`frontendDist: ../ui/dist`, `beforeBuildCommand`). **`cargo build --release` NÃO embute a UI** (`tauri-build` marca `cfg(dev)`): só `npm run build`/`tauri build` gera binário correto. Fix: `list_children_in` checa existência do diretório antes de `contained_in` (sessão sem children mostrava `os error 2`). PR #1 mergeado (fnm + login com binário resolvido) + patch de Windows (`quote_bin`; `cmd.exe` não trata single quote). `cargo test` 35/35; `clippy` não instalado nesta toolchain.
- Em andamento: painel **Git read-only** (item 1 do scout contra `Relrin/pi-deck`): `git status --porcelain=v2 --branch -uall --renames` + `git diff HEAD --numstat`, aba nova no painel direito.
- Fechado o dia com: aba Git read-only **e** escrita (stage por intenção, commit/amend, discard, stash, pull `--ff-only`, push/`force-with-lease`), painel direito em split fixo (Subagents topo / Git rodapé) com grip, terminal embutido (PTY `portable-pty` + xterm, `TERM=xterm-256color` forçado), highlight no diff (Prism por `tokenize`, DOM puro), registry de tool cards, aba Plano (`plans_list` read-only), split/unified do diff, zoom, Esc, thinking por aba, vigia de turno fantasma e retry de envio. Testes: `cargo test` **81**, `npm run test:ui` **20** (vitest+jsdom, adotado do PR #2).
- **PR #2 fechado** (21:14Z) após portar por mão: `rpc.rs` (slot de filho morto), zoom, Esc, harness vitest, vigia e retry. Bloqueios registrados no comentário: `package-lock.json` do branch é JSON inválido (position 99790) e 8 commits atrás com `main.js` reescrito dos dois lados.
- Release **0.1.18 congelada por decisão do usuário** até fechar a fila: falta `#6 temas` (etapa A: 33 hex → tokens com prova de equivalência; etapa B: loader JSON leniente) e a finalização do CHANGELOG.
- `#6` etapa A entregue (`2396b95`): 33 tokens novos, 117 substituições, prova de equivalência com controles negativos; `styles.css` caiu de 131 para 43 linhas com hex e não sobrou valor com ≥2 ocorrências nas regras. Etapa B (loader de tema) em andamento.
- **Renomeado para `sightdeck`** (repo GitHub, `productName`, binário, `.deb`, identifier `dev.matheus.sightdeck`) na 0.2.0 (`fd51692`); `PI_DECK_PI_BIN` continua aceito como fallback de `SIGHTDECK_PI_BIN`. Pasta local segue `~/Projects/pi-deck` de propósito (mudar muda o agrupamento de sessões do pi).
- **v0.2.1 publicada** (5 assets: deb/AppImage/rpm/exe/msi). Dois bugs de CI encontrados e corrigidos: `publish` dava **403** porque o `contents: write` global virou `read` (agora a permissão é por job) e `test (windows)` **trava sem log** (agora `timeout-minutes` + `--skip pty`; todos os jobs têm limite de tempo e há `concurrency` cancelando runs duplicados do mesmo ref).
- `docs/RELEASE.md` criado com o fluxo de release e a gestão das chaves de assinatura (minisign + Bitwarden + cópia offline); `npm run tauri signer` engole o `-w` — usar `npx tauri signer generate -w …`.
- Pendente: adotar `tauri-plugin-updater` (chave já gerada em `~/.tauri/sightdeck.key`; no Linux o updater do Tauri só cobre AppImage), TODO de projeto por extensão (pesquisa: `pi-todo` grava `.pi/todo.json`, mas é main-agent-only) e parar subagente por run (existe `subagent({action:"stop"})` + `/subagents-stop`, falta caminho RPC).
- Terminal embutido: surgery em 3 bugs reais (envelope `{event,payload}` do Tauri, cwd caindo em `/` antes da sessão, e `TERM` herdado — `otter-term` sem terminfo fazia o zle repintar `ls` como `lsls`). Suporte real hoje: **Linux + shell POSIX**; **macOS removido** do CI/README (sem VM para validar) e Windows só compila, sem validação de runtime.

## Onde estamos (2026-11-15)

- **v0.1.14 publicada** (thinking por modelo com slider — `set_model` recarrega níveis, `xhigh`/`max`
  aparecem; painel Subagents fundindo ao vivo + histórico, sem snapshot apagar o disco). Release:
  run `43783065302` (4 builds + `test`), 7 assets, publicada com
  `gh release edit v0.1.14 --draft=false --latest`.
- **v0.1.13** (compactação manual `⤓` + limite de contexto por projeto em
  `.pi/settings.json`; fila de mensagens com `queue_update` → "entregue"/"cancelada" e linhas que
  sobrevivem à troca de aba). Release: run `43757153070` (4 builds + `test`), 7 assets, publicada com
  `gh release edit v0.1.13 --draft=false --latest`.
- **v0.1.12** (aba **Arquivos** com diffs no painel, botão de copiar nas respostas, paste sem
  travar 1 s, e o fix de estado vazando entre sessões — histórico/paginação/painel de subagents).
  Release: run `43742893989` (4 builds + `test`), 7 assets, publicada com
  `gh release edit v0.1.12 --draft=false --latest`.
- **v0.1.11** (aba não mata outra sessão, título da sessão na aba, lista por projeto paginada).
- **v0.1.10** (fila de mensagens durante o run, abas com estado/projeto, rascunho por aba).
- **v0.1.8 publicada como histórico** (não-latest; `gh release edit v0.1.8 --draft=false --latest=false`, 2026-11-15).
  O `Latest` do GitHub segue a publicação mais recente, não a maior versão: publicar versão antiga sem
  `--latest=false` rouba o marcador da atual.
- 0.1.9 e anteriores ficam como histórico.
- Workflow builda em 4 runners e publica **uma vez** (`publish` job), com job `test`
  (`cargo test`) de que o `build` depende.
- App local em 0.1.10: `.deb` gerado em `src-tauri/target/release/bundle/deb/sightdeck_0.1.10_amd64.deb`
  (instalar com `sudo dpkg -i`); a sessão em uso roda o binário de `target/debug`.
App desktop (Tauri 2 + Rust) para sessões do `pi`, com subagents **por sessão** e workflows/schedules por projeto.
Status: **M0 concluído e provado** · **M1 scaffold compila e abre janela**.

## Decisões travadas

- **Imagem vem do clipboard do sistema, não do webview**: a WebKitGTK não entrega `image/*` no
  evento `paste`, então `Ctrl+V` chama o comando Rust `paste_image` (`wl-paste`/`xclip`, `pngpaste`,
  PowerShell), valida magic bytes e manda base64 no campo `images` do prompt RPC. O handler de `paste`
  no JS continua como caminho alternativo, sem `preventDefault` (texto cola normal).
- **Arquivo como contexto = `@caminho` no texto**: o RPC só tem `TextContent` e `ImageContent`, não
  existe campo de arquivo. O botão `@` insere o caminho e o agente lê com as próprias tools — inlinar
  o conteúdo duplicaria o arquivo no histórico e no contexto.
- **Enter envia, `Ctrl+Enter` quebra linha**: atalho invertido do padrão de terminal. `Shift+Enter`
  quebra nativamente. `send()` ignora input vazio, então Enter acidental é no-op.

- **Comandos do pi não vêm no `get_commands`**: ele lista só `extension`/`prompt`/`skill` (110 itens
  nesta máquina). Os comandos de TUI (`/compact`, `/model`, `/new`, `/name`, `/session`, `/copy`,
  `/export`, `/abort`, `/login`) são fornecidos pelo **app**, roteados para RPC (`compact`,
  `cycle_thinking_level`, `set_session_name`, `get_session_stats`, `export_html`, `abort`,
  `get_last_assistant_text`) ou CLI (`pi auth login <provider>`), nunca enviados ao modelo.

- **Sessão abre só leitura** (histórico do disco, sem processo). O `pi --mode rpc` sobe no primeiro envio
  ou troca de modelo; teto de 3 processos vivos (LRU, decidido 2026-11-15) e `kill_all` ao fechar a janela.
  **O LRU nunca mata aba com turno rodando nem a aba atual**: escolhe a primeira vítima ociosa e, se todas
  estiverem ocupadas, deixa o teto ser excedido em vez de perder trabalho.
- **Histórico paginado**: Rust devolve as últimas N mensagens com orçamento de 1 MB / 64 KB por linha e
  record `__deck_meta` (`consumed`/`hasMore`). O botão "carregar anteriores" usa `skip=consumed`.
- **Release**: ícones completos (`icon.ico`/`icon.icns`) + `.github/workflows/release.yml` (matriz
  ubuntu→deb,rpm,AppImage · windows→msi,nsis · macos→dmg), release em rascunho, binários sem assinatura.

- **Sessão contida**: `read_session_messages` e `delete_session` canonicalizam o path recebido do
  webview e exigem prefixo `~/.pi/agent/sessions` (`..` e symlink resolvidos antes de comparar) —
  antes aceitavam qualquer arquivo, então um `invoke` injetado lia ou movia qualquer coisa.

- **Excluir sessão = mover para lixeira**, nunca `rm`: `<projeto>/.sightdeck-trash/<stem>/` recebe o `.jsonl`
  e o diretório de children. **Ocultar projeto** é só UI (`localStorage`), não toca em disco.

- **Pacotes: CLI é o único escritor.** Catálogo = `registry.npmjs.org` com `keywords:pi-package` (fetch no
  webview, cache 1h, filtra keyword exata); instalar/remover = `pi install|remove`; MCP = `pi mcp add|remove`.
  Toda escrita passa por confirmação mostrando o comando literal.
- **MCP form**: preset só com pacotes npm verificados (`server-filesystem` 2.3.0, `server-memory` 2.1.1,
  `server-sequential-thinking` 2.1.1 — `git`/`fetch`/`time` não existem no npm); target auto-detecta
  `https://` → `--url`; argv respeita aspas; env em linhas K/V; após add, o estado (`connected`/`error`)
  vem do próprio `pi mcp list --json` = o "teste".

- **Diff de arquivo editado vem do próprio histórico, não do disco**: o `toolResult` da tool `edit` já traz
  `details.patch` (unified diff) e o `toolCall` traz `arguments.path`; `session_edits` (Rust) lê o `.jsonl`
  da sessão + `<stem>/<childId>/run-N/session.jsonl`, casa `toolCallId` com o resultado e devolve
  `{file,tool,at,src,patch}`. `write` não tem patch: vira diff só de adições (400 linhas). Não se lê o
  arquivo real — o objetivo é ver o que o agente fez, inclusive fora do repo.

- **Não seguir com o papel de launcher/daemon por ora (decidido 2026-11-14).** Motivos: `schedule.run-due`
  é tool action interna (não é contrato público de RPC), exigiria uma sessão `pi` runner por projeto vigiado,
  e uma extensão-ponte de manutenção contínua contra um pacote de 101k linhas. Reversível: o painel read-only
  de missions/schedules é a primeira peça caso a necessidade apareça.

- **Não reescrever o pi-subagents.** 348 arquivos, 101.476 linhas de JS, 61.958 só em `workflows`+`runs`,
  13 agentes builtin. Reescrever = refazer a parte com mais casos de borda e perder manutenção da comunidade.
- **Não embutir o pi-subagents.** É extensão TS que roda dentro do processo do `pi` (usa `ctx.ui`/hooks).
  Só um host Node (como o pi-web, que depende de `pi-coding-agent` + `pi-tui`) consegue hospedar; Rust/Tauri não.

- **Compactação: manual + limite escolhido; nada automático por extensão.** `⤓` na barra do composer
  manda o RPC `compact` (mesmo caminho do `/compact`). O limite (`70–95%` ou "padrão do pi", no popover
  de contexto) grava `compaction.modelOverrides[<provider>/<id>].reserveTokens` em
  `<cwd>/.pi/settings.json` — por projeto e por modelo, sem default imposto: "padrão do pi" remove a
  chave e poda o objeto. Vale ao reiniciar o child (`settings` são lidos no create; `/reload` não
  recarrega settings). **Não** virou extensão `session_before_compact`: medido nas sessões reais,
  `keepRecentTokens=20000` já mantém ~48 mensagens/3 turnos (mediana) e houve 4 compactações em 314
  sessões — o ganho de uma política própria não paga o risco (resumo de extensão não herda
  `<read-files>`/`<modified-files>` e erro do hook não tem retry interno).
- **O papel do sightdeck é ser o launcher/supervisor.** `docs/missions.md:160`: "`schedule.run-due` lets an
  external launcher start due project work without making `pi-subagents` a daemon". O app lê
  `.pi/subagents/schedules/<id>/` + `~/.pi/agent/missions/projects/<hash>/`, calcula o que venceu e chama
  `schedule.run-due`. Isso exige uma sessão `pi` viva (o comando é tool action) — ou seja, uma sessão
  "runner" por projeto mantida pelo app.
- Ponte determinística: extensão fina `sightdeck-bridge` expondo `/deck:schedule-*` e `/deck:mission-*`,
  chamada pelo app via `prompt` (comando de extensão executa sem passar pelo LLM).

- Stack: **Tauri 2** (Rust). Não usa Electron nem embrulha o `pi-web` (Next.js) — sem servidor embutido.
- **1 processo `pi --mode rpc` por sessão** (mesmo padrão do `pi-desktop`).
- Subagents são **por sessão**, nunca globais (pedido do usuário).
- Painel ao vivo vem do **widget**; disco (`<stem>/<childId>/run-N/session.jsonl`) só para histórico de sessão fechada.
- Sessão "sem pasta" = `cwd = $HOME` → grupo `--home-<user>--`. Nada de conceito novo.

## Contrato verificado (não re-verificar)

- `pi --mode rpc` (`--session <path>` p/ abrir, `--session-id <id>` p/ criar). Prompt:
  `{"id":"x","type":"prompt","message":"..."}`.
- Subagent ao vivo chega como `extension_ui_request` `method=setWidget`, payload
  `"PI_SUBAGENT_ASYNC_JSON:"+JSON` → `{version:1, runs:[{id,label,state,startedAt,children:[{agent,model,thinking}]}], caps, omitted}`.
  Também chega `setStatus`. `custom()` é **stub** em RPC (tela cheia do `/subagents-fleet` não existe aqui).
- Sidebar: `~/.pi/agent/sessions/--<proj>--/<stem>.jsonl` + dir irmão `<stem>/` com os children da sessão.
  Caminho real do projeto = campo `cwd` da 1ª linha do `.jsonl` (nome do dir troca `/` por `-`, é ambíguo).
- Workflows/schedules já existem no pi-subagents: `.pi/workflows/*.js`,
  `subagent({action:"schedule.create", options:{at|every|catchUp}})`, missions em `~/.pi/agent/missions/projects/<hash>/`.

## Como rodar

```bash
export PATH="$HOME/.cargo/bin:$PATH"   # cargo/rustc 1.99.1 fora do PATH
cd ~/Projects/sightdeck/src-tauri && cargo run
```

## Estado atual

- M0 provado · M1 funcionando · sessão abre, transcript carrega, modelos/thinking chegam.
- **RPC do pi 1.5.2 = 33 comandos** (`docs/rpc-commands.md`): tem `set_model`, `get_available_models`,
  `set_thinking_level`, `get_available_thinking_levels`, `get_session_stats`, `set_auto_compaction`,
  `compact`, `set_session_name`, `get_commands`. **Não tem** `reload`, nem MCP, nem config → recarregar = reiniciar processo.
- Boot escreve 4 comandos: `get_messages`, `get_state`, `get_available_models`, `get_available_thinking_levels`.
- Formas reais: `get_state.model = {id, provider, contextWindow, ...}`; `get_available_models.data.models[]`
  (mesmo objeto, ~36 modelos); `get_available_thinking_levels.data.levels[]`; `get_session_stats.data.tokens{...}`;
  `set_auto_compaction {enabled}`.
- Debug: `PWUI_DEBUG=1` loga cada linha RPC no stderr; `PWUI_AUTONEW=1` abre sessão nova sozinha;
  comando `debug_note` devolve eco do frontend (`[ui] models=36 selected=...`).
- Prova de UI sem Tauri: harness Playwright em `/tmp/harness` (`build.cjs` + `test.cjs`), 0 erros, 19 tool cards.

## Gotchas já pagos

- **Path relativo do webview é do projeto, não do processo**: a aba Plano manda
  `docs/spec/x.md` e `Path::canonicalize` resolve contra o cwd **do processo** (a pasta do app).
  `open_file`/`revert_hunk` davam `docs/spec/x.md: Arquivo ou diretório inexistente (os error 2)`.
  Sempre `cwd.join(path)` antes de validar; `join` com path absoluto substitui a base, então não
  abre buraco no confinamento (testes cobrem `../`).
- **`<select>` no WebKitGTK ignora background/color da classe**: com `appearance:menulist` o UA pinta
  campo branco + seta nativa e o texto claro do tema fica ilegível. Precisa de `appearance:none` +
  chevron próprio (gradiente usando `var(--dim)`; `var()` não vale dentro de `url()`).
- **Snapshot ao vivo de subagent só existe para job async**: `PI_SUBAGENT_ASYNC_JSON` é emitido
  apenas pelo `async-job-tracker` (`renderWidget` só tem chamador lá, e só no modo rpc), então run
  em primeiro plano não manda nada. O painel depende de reler `list_children` durante o turno;
  repintar a cada poll custa o scroll, daí a chave `id|estado` (sem `mtime`, que muda a cada escrita).

- **`stream` não caducava no `agent_settled`**: o objeto global do stream continuava com a resposta
  completa depois do fim do turno; trocar de aba chamava `stashDraft`, que regravava esse texto em
  `t.streamText`, e ao voltar o `reattachStream` reanexava a resposta **por cima** do histórico do
  disco (a mesma mensagem duas vezes). Só acontecia quando nenhum `message_start`/`tool_execution_start`
  limpava `stream` — daí o "não ocorre em todas". Hoje `agent_settled` zera `stream` e `reattachStream`
  descarta `t.streamText` quando o log já termina com ele (`logHasText`, cauda de 120 chars porque
  `t.streamText` é cortado em `STREAM_CAP`).

- **Aba criada com `+ Nova` nasce com `childrenDir = null`**, e o único lugar que descobre o diretório
  dos children é o `get_state` (`sessionFile` sem `.jsonl`). Sem derivar daí, o painel de subagents fica
  vazio para sempre mesmo com `run-0/session.jsonl` no disco — e `start()` não pode só olhar
  `current.childrenDir` porque o `.jsonl` nem existe antes da 1ª mensagem.
- **Guarda de geração capturada no início da função não protege leitura que começa no fim de outro
  fluxo**: `switchTab` chama `loadChildren` **depois** do await do histórico, então a leitura nasce com o
  `viewSeq` novo e passa no guard. Comparar também a identidade do alvo (`current.childrenDir === dir`)
  é o que fecha o vazamento "ir numa sessão com subagents e voltar mostra os da outra".
- **Leitura assíncrona de sessão velha pinta na sessão nova**: `loadHistoryFromDisk`/`loadEarlier`/
  `loadChildren`/`openChild` resolviam depois da troca e escreviam no `#log`/`#subs`; o resultado era
  transcript + barra "carregar anteriores (253 de 508)" na sessão recém-aberta. `viewSeq` incrementa em
  `start`/`openSession`/`switchTab` e toda leitura descarta o resultado se a geração mudou. Esconder a
  barra no início do `start()` (fix 88d117e) não bastava: era só síncrono.
- **`wl-paste --type X` custa ~1 s quando o tipo não está no clipboard** (1006 ms medido, 2026-11-15).
  Chamar `paste_image` a cada `Ctrl+V` travava o composer. `--list-types` responde em ~2 ms; só leia os
  bytes depois de ver `image/*`. `xclip` não está instalado nesta máquina (o fallback morre em 1 ms).
- **Overlay de estado vazio é opaca e por cima do `#log`** (`background:var(--bg)`, `z-index:5`).
  `start()` (usado por `+`, `+ Nova` e `+ Pasta`) não a escondia, então a sessão nova parecia não
  abrir. `openSession()` já escondia; hoje `renderMessages()` também esconde quando pinta no painel
  principal, senão a overlay sobrevivia à primeira resposta.
- **`cargo build` re-embute o frontend sozinho** (provado 2026-11-15): alterar `ui/index.html` e
  rodar `cargo build` já recompila o crate e o binário muda de hash
  (8dbb92a2 → d595117e com um comentário a mais na página; revertido, voltou). Não precisa de
  `touch src/main.rs`, e o diretório `target/debug/build/sightdeck-*/out/tauri-codegen-assets/`
  **não** contém o `ui/index.html` (os `.html` de lá têm 21–35 KB, a página tem 120 KB).
  Para provar embed: `sha256sum target/debug/sightdeck` antes/depois. `strings` não serve (comprimido).
  **Correção da correção 2026-11-16**: o re-embed FUNCIONA (`rerun-if-changed` no dist dir —
  `tauri-build-2.7.4/src/codegen/context.rs:92-99`); o alarme foi falso, causado por verificação errada:
  os assets em `tauri-codegen-assets/*.html` são **brotli** (`tauri-codegen-2.7.4`, feature `compression`),
  então `grep` cru/`strings` acham zero marcadores mesmo com o frontend atual embutido. Método certo:
  `node -e "zlib.brotliDecompressSync(...)"` no asset + checar marcador (ex.: `tabs-v1`, `forkpop`),
  e para o binário, `python3` procurando os bytes brotli verbatim (`probe found: 1` = embutido).
  Verificado: asset de 56060 bytes com `tabs-v1/forkpop/renderSessAggregate` presente verbatim no
  `target/debug/sightdeck` (`sha b836c874…`). A causa do bug visível ao usuário era o binário rodando
  (build 21:41, anterior ao fix) — basta reiniciar o app com o binário rebuildado.
- **Indicador de turno é estado da aba**: `setTyping` era global, então o "enviado…/pensando…"
  da aba anterior continuava na aba nova vazia. Agora `setTurn(sessionId, working, phase)` grava
  `t.working`/`t.phase` na aba, linhas de abas em segundo plano alimentam esse estado e
  `switchTab`/`start`/`openSession` reaplicam com `applyTurnUi()`.
- **Composer e rascunho são da aba**: `stashDraft()` guarda texto + `pendingImages` na aba ao sair e
  `restoreDraft(t)` devolve ao entrar (aba nova = campo vazio). Aba mostra dot (verde pulsando =
  `t.working`/running, cinza = conectado, sem dot = somente leitura) e o nome do projeto
  (`cwd` sem o último segmento, mesma convenção da sidebar); tooltip traz cwd, stem e estado.
- **Rótulo da aba = título da sessão, não a data do id**: `t.label` vem do `title` de `list_sessions`
  (`session_info.name` ou 1ª mensagem do usuário, `read_title` no Rust). Sessão nova sem título usa a
  própria 1ª mensagem em `send()`; `/name` atualiza na hora; sem nada, cai no `prettyId(key)`.
- **Lista por projeto é paginada**: `SESS_PAGE = 8` linhas + botão `carregar mais (N)`, estado em
  `expandedProjects` (`localStorage: expanded-projects`). Pasta com histórico longo não estica mais a sidebar.
- **Estado de processo e estado de UI divergiam**: `start()` matava o processo anterior sem `stopLive`,
  `ensureRpc()` evictava por FIFO sem olhar `working` e empurrava chave duplicada no `liveOrder`, e o
  handler de `rpc-exit` não zerava `t.connected`. Resultado: sessão viva morta ao mandar em outra aba
  ("mando em A, mando em B, A morre") e os erros `sessao '...' nao iniciada` em `get_messages`/`get_state`.
  Hoje: vítima só ociosa, dedupe do `liveOrder`, `rpc-exit` limpa aba/fila/contador e narra no transcript,
  e `switchTab` faz `ensureRpc()` antes de qualquer comando.
- **Modificador de classe CSS precisa ser prefixado**: o dot da aba nasceu com classe `run` e herdou
  `.run { padding:8px 10px }` (card de subagent, linha ~309); com `box-sizing:border-box` o
  `width:6px` clampa no padding e o dot virou círculo de ~20×16. Dot usa `.tab-dot.busy`/`.live`.
- **Mensagem durante o run entra na fila**: `send_prompt` sempre manda `"streamingBehavior":"steer"`.
  O pi só exige o campo enquanto streama (`dist/core/agent-session.js:1751`) e enfileira; parado ele
  é ignorado. `disposition:"queued"` marca a linha com "· na fila". `/abort` manda `clear_queue`
  antes do `abort`, senão o pi **continua** a fila (docs/rpc-commands.md §clear_queue).
- **Níveis de thinking são por modelo e o app não os recarregava**: `renderModelList` mandava só
  `set_model`, sem `case 'set_model'` no `handleResponse` — a lista ficava sendo a do modelo anterior
  e `xhigh`/`max` nunca apareciam. Hoje o sucesso do `set_model` pede `get_available_thinking_levels`
  + `get_state`. O controle saiu das barrinhas fixas do composer (altura `5+i*4px` não escalava):
  chip com o nível atual abre o seletor, cujo rodapé tem um slider (`min=0 max=N-1`) que se adapta
  à quantidade de níveis; modelo sem reasoning devolve só `["off"]` e esconde o slider.
- **Painel Subagents tinha dois pintores que se apagavam**: `renderSubs` (snapshot do widget, só runs
  ativos) e `renderChildren` (histórico do disco) faziam `clear(host)` sem merge — cada update do
  widget limpava o histórico ("aparece e depois fica só esse"). Hoje cada fonte atualiza só o seu
  estado (`lastSnap`/`lastDiskList`) e `paintSubs` desenha as duas metades; dedupe só por id exato
  (formato de `run.id` do widget não é verificado, produtor é a extensão externa pi-subagents) e
  reset dos dois estados em `start`/`openSession`/`switchTab`/`closeTab`.
- **`pi` não grava `.jsonl` no start**, só na primeira mensagem. Logo `list_sessions` (que monta
  grupos a partir de `.jsonl`) não vê sessão nova — a sidebar precisa injetar grupo para o `cwd` das
  abas vivas.
- `generate_context!` exige `src-tauri/icons/icon.png` **RGBA** (PNG RGB falha).
- Comando `#[tauri::command]` no `main.rs` colide com `generate_handler!` (E0255) → manter em módulos.
- `window.__TAURI__.event.listen` precisa de guarda: sem ela o script morria antes de `loadSessions()`.
- `agent_settled` não existe no arquivo de sessão do child; estado vem de `stopReason` da última mensagem do assistant.
- Crate `capture/` é a sonda de protocolo do M0; log cru em `/tmp/m0-rpc.jsonl`.
- **App GUI não herda o PATH do shell**: o PATH do `systemd --user` não tem `~/.pi/agent/bin`
  nem `~/.local/bin`, então `Command::new("pi")` morria com `os error 2` (só no launcher; no
  terminal funcionava). Resolver por caminho: `SIGHTDECK_PI_BIN` → `~/.pi/agent/bin/pi` →
  `~/.local/bin/pi` → `PATH`. Vale para qualquer Tauri que invoque CLI instalado no `$HOME`.
- **RSS somado mente** em app multi-processo: o WebKit mapeia as mesmas libs em 3 processos e o
  monitor soma tudo. Medir PSS (`/proc/<pid>/smaps_rollup`): no sightdeck deu ~523 MB de RSS contra
  ~257 MB de PSS. Para VRAM, medir delta de `mem_info_vram_used` — kernels sem `drm-total-vram0`
  no `fdinfo` não dão VRAM por processo.

## Próximo

1. Print de vitrine para o README (pendente por decisão do usuário).
2. Persistir abas entre reinícios e preservar o stream ao trocar de aba: o indicador de turno já é
   por aba, mas o texto em stream do turno que continua rodando em segundo plano ainda se perde
   (recuperado por `get_messages` ao voltar).
3. Pinar as actions por SHA (`unpinned-uses` ×6, `artipacked` ×1 nos advisories).
4. Se um dia ativar o updater assinado do Tauri: reintroduzir `*.app.tar.gz` + chave
   (hoje saem **5** assets porque o macOS saiu do CI; com updater, 7).
5. `open_terminal_login` interpola `provider` em `sh -c` (`sessions.rs`) — fechar o sink com
   whitelist. Aberto de propósito: entrada é digitada pelo próprio usuário (self-inflicted).
6. **Acentuação no composer (quase fechado)**: fatos verificados 2026-11-15 — layout do compositor é
   `us` + variante `intl` em runtime (`hyprctl getoption input:kb_layout`/`kb_variant`), fcitx5 é o IM
   (`~/.config/fcitx5/profile` → `DefaultIM=keyboard-us-intl`), o processo do sightdeck carrega
   `im-fcitx5.so` (`/proc/<pid>/maps`), e `wry` desliga o preedit em toda webview
   (`webkit2gtk/mod.rs:429`, workaround do tauri#5986). **Confirmado pelo usuário**: `'` + `a` → `á`
   com `GTK_IM_MODULE=gtk-im-context-simple` (`gtk-im-context-simple` é builtin na libgtk-3 3.24.52).
   Falta só confirmar na janela com o env normal (`fcitx`): se falhar lá, aplicar o IM simples no
   `main.rs` antes do GTK subir.
7. **E2E da janela Tauri**: `npm run build:e2e && npm run test:e2e` (WebdriverIO + `@wdio/tauri-service`
   provider `embedded`, 4/4; validado 2026-11-17). Os crates `tauri-plugin-wdio*` são opcionais e só
   entram com `--features e2e` — produção não registra os plugins. Falta rodar no CI (exige sessão
   gráfica/Xvfb e build do Tauri com a feature).

## Arch/CachyOS: PKGBUILD local (2026-11-21)

- `PKGBUILD` novo compila o checkout (`makepkg -si`), sem release publicada. `options=(!lto)` é
  **obrigatório** no CachyOS: o `/etc/makepkg.conf` exporta `-flto=auto` em CFLAGS/LDFLAGS e o C
  do crate `ring` vira bitcode que o `rust-lld` não lê → 21 `undefined symbol:
  ring_core_0_17_14__*` no link. `RUSTFLAGS` de `/etc/makepkg.conf.d/rust.conf` (opt-level=3,
  target-cpu=native) pode ficar. `.gitignore` ganhou `/pkg/`, `/src/`, `/sightdeck-*.pkg.tar.zst`
  (ancorados: `src/` sem barra engoliria `ui/src/` e `src-tauri/src/`). README tem a seção de Arch.
- **Duas instalações convivem**: `~/.local/bin/sightdeck` (10:35 de 19 nov) vem antes de
  `/usr/bin/sightdeck` (pacote `sightdeck 0.2.6.r171.gd1dc709-1`, 21 nov) no PATH — o app que roda é
  o binário antigo. Para testar o pacote: fechar o app e remover/renomear `~/.local/bin/sightdeck`.
- **Instalação fantasma (21 nov 11:47)**: `pacman -U` reinstallou, mas o app continuou com
  `exe=/home/matheusdutra/.local/bin/sightdeck` (pid com pai `systemd --user`, unidade transiente
  `app-sightdeck@<hash>.service` = `[systemd-run] /home/matheusdutra/.local/bin/sightdeck`, no
  journal com `Started [systemd-run] ...`). Motivo: `~/.local/share/applications/sightdeck.desktop`
  (10:42) tinha `Exec=/home/matheusdutra/.local/bin/sightdeck` **absoluto** e .desktop do usuário
  tem precedência sobre `/usr/share/applications/` no lançador. Evidência que confunde: o PATH
  *do processo* é `/usr/local/sbin:/usr/local/bin:/usr/bin:...` (sem `~/.local/bin`) — quem resolveu
  o caminho foi o Exec, não o PATH. Correção: `.desktop` do pacote agora usa
  `Exec=/usr/bin/sightdeck` (PKGBUILD com comentário), e os arquivos antigos foram renomeados para
  `~/.local/bin/sightdeck.old-19nov` e `~/.local/share/applications/sightdeck.desktop.bak-19nov`.
  Regra: depois de `pacman -U`, conferir `readlink -f /proc/<pid do app>/exe` — versão do pacote
  não prova qual binário está rodando.

## each_key_duplicate (RESOLVIDO 2026-11-21)

- Erro do Svelte 5 (`https://svelte.dev/e/each_key_duplicate`) no boot; em produção a mensagem é
  só a URL, sem chave/índice. `window.onerror` (ui/src/main.js:378) só mostra na barra `#fatal` —
  o stack vem do `npm run dev` (`[vite] (client) [Unhandled error]`, frames `src/...svelte`).
- **Causa**: `modelListSnapshot` (ui/src/main.js) empurrava **uma linha de favorito por provider**,
  com chave `f.id`. O id `deepseek-v4.1-flash` existe em `opencode` **e** `opencode-go` e está em
  `model-favs` → duas linhas com o mesmo `id` → `{#each snap.list.favs as f (f.id)}`
  (ui/src/composer/ModelPop.svelte:54) estourava ao montar o pop no boot.
- **Correção**: `favSeen` (Set por `m.id`) antes do `favRows.push` — dedupe pela MESMA expressão
  usada como chave. Regressão em `tests/ui.test.mjs` ("mesmo id favoritado em dois providers vira
  uma linha só").
- **Descartados antes** (scripts node sobre `~/.pi/agent` + sqlite do localStorage): MissionsPane
  `m.key` (228 missões, 0 sem id, 0 ids repetidos); SessionTree grupo `g.path` (19 dirs → 15 grupos,
  0 path repetido); TabBar `t.key` (3 abas, chaves distintas); FilesPane `r.path` (132 paths, 4
  markdown → 5 linhas); PlansPane `r.file` (`canonicalize`, src-tauri/src/plans.rs:78-88); SubsPane
  histórico `c.id` (336 children com `run-*`, nenhum com mais de um run); Theme (6 presets).
- Reprodução: clone do localStorage de produção
  (`~/.local/share/dev.matheus.sightdeck/localstorage/tauri_localhost_0.localstorage`) para o origin
  de dev `http_localhost_1420.localstorage` + `PWUI_DEBUG=1 npm run dev`.

## Busca de sessões: painel não escondia, resposta velha, snippet errado (RESOLVIDO 2026-11-21)

- **Sintoma** (print do usuário): campo "buscar nas sessões…" vazio, mas a lista de resultados,
  os filtros (`tool`, `erros`) e a meta continuavam na tela; apagar o termo não limpava nada; a
  linha do resultado parecia não ter o termo buscado.
- **Causa 1 (CSS)**: ui/src/styles.css só tinha regras por elemento (`.health-chip.hidden`,
  `.model-pop.hidden`, …) — o `classList.toggle('hidden', !on)` de `scheduleSearch()` em
  `#searchresults`, `#searchmeta` e `.side-filters` era **inerte**. Correção: `.hidden {
  display:none; }` no fim de ui/src/styles.css (linha 810, depois de `.side-filters` de propósito:
  mesma especificidade, vence por ordem). Regra: ao usar `toggle('hidden')`, o elemento precisa de
  regra genérica ou a classe não faz nada.
- **Causa 2 (corrida)**: `runSearch()` não tinha sequência — resposta de um filtro antigo
  repintava a lista depois de digitar/apagar (a varredura leva segundos). Correção: `searchSeq`
  (ui/src/main.js:557; `++` no desligamento em 607 e no início de `runSearch()` em 621; `if (seq
  !== searchSeq) return;` em 629; erro só se `seq === searchSeq` em 641) + limpeza de
  `searchItems/searchTotal/searchOffset` e `loadSessions()` quando desliga.
- **Causa 3 (precisão)**: o snippet pegava os 240 primeiros chars da mensagem. Correção:
  `snippet_around(flat, q, max)` em src-tauri/src/sessions.rs (janela 8 palavras antes do match,
  '…' quando corta) usado por `search_sessions_capped`; teste `snippet_around_mostra_o_termo_buscado`.
- **Teto de leitura**: `SEARCH_TOTAL_BYTES` (96 MB) removido — ele truncava a varredura em 96 MB de
  624 MB e devolvia 56 de 75 resultados para "limita". Ficaram `SEARCH_FILE_BYTES` (32 MB por
  arquivo) e `SEARCH_BUDGET_MS = 5000` (era 2500, que parava em 121 de 145 arquivos). Medido com o
  corpus real: 145/145 arquivos, 75 resultados, `truncated:false`, 2,44 s com cache quente.
- **Verificação**: `cargo test` 108 ok; `npx vitest run tests/ui.test.mjs` 160 ok; `npm run
  build:ui` ok com `.hidden{display:none}` standalone no bundle (pos. 40107, depois de
  `.side-filters{` em 9193); pacote refeito com `makepkg --noconfirm -f` (freshness provada por
  `strip` do binário = hash do binário empacotado).

## Pacote abria "Could not connect to localhost" (RESOLVIDO 2026-11-22)

- **Sintoma**: o app instalado pelo pacote mostrava a tela de erro do WebKit "Could not connect to
  localhost: Connection refused" no boot.
- **Causa**: o `build()` do PKGBUILD chamava `cargo build --release` direto. O `tauri build` passa
  `--features tauri/custom-protocol`; sem ela `tauri::is_dev()` é `true`
  (`tauri-2.12.5/src/lib.rs:318-320`) e o `generate_context!` usa a `devUrl` do
  `tauri.conf.json` (`http://localhost:1420`) em vez de embutir o `ui/dist`
  (`tauri-macros-2.7.4/src/context.rs:155`).
- **Evidência**: `/usr/bin/sightdeck` (pacote 0.2.6.r171) tinha `http://localhost:1420` e **zero**
  ocorrências dos nomes de `ui/dist/assets/*`; o binário novo (`--features tauri/custom-protocol`)
  tem os três nomes embutidos. `devUrl` continua no binário nos dois casos (config é embutida),
  então o teste válido é procurar os nomes do `dist`, não a URL.
- **Correção**: `cargo build --release --locked --features tauri/custom-protocol` no `build()` do
  PKGBUILD. Pacote `sightdeck 0.2.7.r177.g6ba3104-1` gerado; falta `pacman -U` (exige senha).

