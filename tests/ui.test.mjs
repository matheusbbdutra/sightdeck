// @vitest-environment jsdom
/* Testes de UI (vitest + jsdom).
 *
 * `ui/src/main.js` é um módulo de efeitos colaterais: no topo liga handlers nos
 * elementos do `index.html` e o bootstrap fala com o Tauri. Para testar as funções
 * puras do transcript o teste carrega o HTML real e um `__TAURI__` falso antes do
 * import. `terminal.js` (xterm exige canvas/ResizeObserver) e `highlight.js`
 * (Prism) não têm relação com a fila de mensagens e ficam fora.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { THEME_KEYS, applyTheme, resetTheme, validateTheme } from '../ui/src/theme.js';
import { PRESETS, presetById } from '../ui/src/themes/presets.js';
import { t, getLang, getLangPref, setLang, detectLang, applyStaticI18n, STRINGS } from '../ui/src/i18n.js';
import { mount, unmount, tick } from 'svelte';
import { buildTree, visibleRows } from '../ui/src/filetree.js';
import ModelPop from '../ui/src/composer/ModelPop.svelte';
import ForkPop from '../ui/src/composer/ForkPop.svelte';
import CtxPop from '../ui/src/composer/CtxPop.svelte';
import TabBar from '../ui/src/tabs/TabBar.svelte';
import SessionTree from '../ui/src/sidebar/SessionTree.svelte';
import SearchResults from '../ui/src/sidebar/SearchResults.svelte';
import PlansPane from '../ui/src/panels/PlansPane.svelte';
import MissionsPane from '../ui/src/panels/MissionsPane.svelte';
import GitPane from '../ui/src/panels/GitPane.svelte';
import SubsPane from '../ui/src/panels/SubsPane.svelte';
import Attachments from '../ui/src/composer/Attachments.svelte';
import Palette from '../ui/src/composer/Palette.svelte';
import CmdkList from '../ui/src/composer/CmdkList.svelte';
import TypingIndicator from '../ui/src/composer/TypingIndicator.svelte';

vi.mock('../ui/src/terminal.js', () => ({ initTerminal: () => {}, reconcileTerminal: () => {} }));
vi.mock('../ui/src/highlight.js', () => ({ appendHighlighted: () => {}, langFor: () => null }));

let insertRowByAt;
let shouldRestoreLocalRow;
let appendCapped;
let logHasText;
let setZoom;
let shouldProbeTurn;
let shouldAbortOnEsc;
let clampWidth;
let clampColumns;
let syncStopButton;
let classifyHealthLine;
let noteHealth;
let healthChipState;
let renderHealthList;
let muteHealth;
let unmuteHealth;
let dropQueuedRows;
let normalizeRowText;
let answerAlreadyRendered;
let isLiveRun;
let elapsedFor;
let reattachPlan;
let renderSubs;
let renderedAnswerNode;
let estimateMessageTokens;
let liveTurnTokens;
let liveStatsView;
let msgSpeed;
let modelListSnapshot;
let levelsSnapshot;
let ctxSnapshot;
let ctxComposition;
let limitSnapshot;
let renderToolImages;
let forkSnapshot;
let tabsSnapshot;
let sessionsSnapshot;
let searchSnapshot;
let plansSnapshot;
let missionsSnapshot;
let gitSnapshot;
let subsSnapshot;
let attachmentsSnapshot;
let paletteSnapshot;
let cmdkSnapshot;
let openCmdk;
let closeCmdk;
let typingSnapshot;
let setTyping;
let invokeImpl = async () => { throw new Error('sem Tauri no teste'); };

function row(at, text) {
  const node = document.createElement('div');
  node.className = 'row user';
  node.dataset.text = text;
  if (at !== undefined) node.dataset.at = String(at);
  node.textContent = text;
  return node;
}

function texts(log) {
  return Array.from(log.children).map(n => n.dataset.text);
}

beforeAll(async () => {
  // O ambiente jsdom não dá `import.meta.url` de arquivo: resolve pelo cwd (raiz do repo).
  const html = readFileSync(resolve(process.cwd(), 'ui/index.html'), 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  localStorage.setItem('lang', 'pt');
  vi.stubGlobal('__TAURI__', {
    // `inv` do main.js captura a função no import; o dispatcher mutável deixa
    // cada teste responder/contar chamadas sem recarregar o módulo.
    core: { invoke: (...args) => invokeImpl(...args) },
    event: { listen: async () => () => {} },
  });
  ({ insertRowByAt, shouldRestoreLocalRow, appendCapped, logHasText, setZoom, shouldProbeTurn, shouldAbortOnEsc,
     clampWidth, clampColumns, syncStopButton, classifyHealthLine, noteHealth,
     healthChipState, renderHealthList, muteHealth, unmuteHealth, dropQueuedRows, normalizeRowText, answerAlreadyRendered, isLiveRun, elapsedFor,
     renderSubs, renderedAnswerNode, reattachPlan, estimateMessageTokens, liveTurnTokens,
     liveStatsView, msgSpeed, modelListSnapshot, levelsSnapshot, ctxSnapshot,
     limitSnapshot, renderToolImages, forkSnapshot, tabsSnapshot, sessionsSnapshot, searchSnapshot, plansSnapshot, missionsSnapshot, gitSnapshot, subsSnapshot, attachmentsSnapshot, paletteSnapshot, cmdkSnapshot, openCmdk, closeCmdk, typingSnapshot, setTyping, ctxComposition } = await import('../ui/src/main.js'));
});

describe('appendCapped', () => {
  it('acumula o delta no parcial da aba', () => {
    expect(appendCapped('pensando', ' mais', 1000)).toBe('pensando mais');
    expect(appendCapped('', 'a', 10)).toBe('a');
    expect(appendCapped(undefined, 'b', 10)).toBe('b');
  });

  it('respeita o cap mantendo os últimos caracteres', () => {
    expect(appendCapped('abc', 'def', 4)).toBe('cdef');
    expect(appendCapped('12345', '', 3)).toBe('345');
    expect(appendCapped('123', '', 3)).toBe('123');
  });

  it('não corta emoji ao meio quando o cap cai no par substituto', () => {
    // O corte por unidade UTF-16 deixaria só a metade baixa do par.
    expect(appendCapped('🙂', 'x', 2)).toBe('x');
    const out = appendCapped('a🙂b', '🙂', 2);
    expect(out).toBe('🙂');
    expect(/^[\udc00-\udfff]/.test(out)).toBe(false);
    expect(/[\ud800-\udbff]$/.test(out)).toBe(false);
  });

  it('mantém acento intacto no limite', () => {
    expect(appendCapped('', 'ção', 2)).toBe('ão');
  });
});

describe('logHasText', () => {
  it('reconhece o texto já pintado pelo histórico e ignora o resto', () => {
    const log = document.getElementById('log');
    log.innerHTML = '';
    const body = document.createElement('div');
    body.className = 'md-body';
    const full = 'SIM — validada antes do fan-out:\n\n· subagent({action:list}) — único agente executável';
    body._md = full;
    log.appendChild(body);
    expect(logHasText(full)).toBe(true);
    // Parcial cortado pelo cap é um sufixo do texto completo: continua reconhecido.
    expect(logHasText('x'.repeat(200) + '\n' + full.slice(-80))).toBe(false);
    expect(logHasText(full.slice(-40))).toBe(true);
    expect(logHasText('outra resposta')).toBe(false);
    expect(logHasText('')).toBe(false);
    log.innerHTML = '';
  });

  it('ignora texto de turno anterior e normaliza espaços', () => {
    const log = document.getElementById('log');
    log.innerHTML = '';
    const oldUser = document.createElement('div');
    oldUser.className = 'row user';
    const old = document.createElement('div');
    old.className = 'md-body';
    old._md = 'Feito.';
    const curUser = document.createElement('div');
    curUser.className = 'row user';
    log.append(oldUser, old, curUser);
    // Resposta do turno anterior não pode zerar o parcial do turno atual.
    expect(logHasText('Feito.')).toBe(false);
    const cur = document.createElement('div');
    cur.className = 'md-body';
    cur._md = 'Feito.';
    log.appendChild(cur);
    expect(logHasText('  Feito.  \n')).toBe(true);
    log.innerHTML = '';
  });
});

describe('i18n (pt/en)', () => {
  // O `beforeAll` global fixa 'lang' em pt; captura aqui (roda depois dele) e restaura.
  let saved = null;
  let savedHtmlLang = '';
  beforeAll(() => {
    saved = localStorage.getItem('lang');
    savedHtmlLang = document.documentElement.lang;
  });

  afterEach(() => {
    if (saved === null) localStorage.removeItem('lang');
    else localStorage.setItem('lang', saved);
    document.documentElement.lang = savedHtmlLang;
  });

  // Override só na instância: `delete` volta ao getter do Navigator.prototype.
  const withNavigatorLang = (value, fn) => {
    Object.defineProperty(window.navigator, 'language', { value, configurable: true });
    try { return fn(); } finally { delete window.navigator.language; }
  };

  it('detecta pt-* como pt e o resto como en', () => {
    withNavigatorLang('pt-BR', () => expect(detectLang()).toBe('pt'));
    withNavigatorLang('en-GB', () => expect(detectLang()).toBe('en'));
    withNavigatorLang('fr-FR', () => expect(detectLang()).toBe('en'));
  });

  it('preferência salva manda; auto usa o navigator e valor inválido cai em auto', () => {
    localStorage.setItem('lang', 'pt');
    expect(getLang()).toBe('pt');
    expect(getLangPref()).toBe('pt');
    localStorage.setItem('lang', 'auto');
    withNavigatorLang('pt-BR', () => expect(getLang()).toBe('pt'));
    expect(getLangPref()).toBe('auto');
    localStorage.setItem('lang', 'de');
    expect(getLangPref()).toBe('auto');
  });

  it('setLang persiste, aplica o <html lang> e devolve o idioma efetivo', () => {
    expect(setLang('en')).toBe('en');
    expect(localStorage.getItem('lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(setLang('pt')).toBe('pt');
    expect(document.documentElement.lang).toBe('pt-BR');
    withNavigatorLang('en-GB', () => expect(setLang('xx')).toBe('en'));
    expect(localStorage.getItem('lang')).toBe('auto');
  });

  it('traduz nos dois idiomas e devolve a própria chave quando ela não existe', () => {
    setLang('pt');
    expect(t('composer.send')).toBe('Enviar (Enter)');
    setLang('en');
    expect(t('composer.send')).toBe('Send (Enter)');
    expect(t('chave.inexistente')).toBe('chave.inexistente');
  });

  it('applyStaticI18n aplica placeholder e não sobrescreve estado vivo', () => {
    setLang('en');
    // `status` e `#send.title` pertencem ao runtime (setStatus/syncStopButton).
    document.getElementById('status').textContent = 'conectado · s1';
    document.getElementById('send').title = 'Enfileirar mensagem (turno rodando)';
    applyStaticI18n();
    expect(document.getElementById('input').placeholder).toBe(t('composer.placeholder'));
    expect(document.getElementById('status').textContent).toBe('conectado · s1');
    expect(document.getElementById('send').title).toBe('Enfileirar mensagem (turno rodando)');
  });

  it('getLang ignora valor inválido salvo e cai na detecção', () => {
    localStorage.setItem('lang', 'de');
    withNavigatorLang('en-GB', () => expect(getLang()).toBe('en'));
  });

  it('pt e en têm exatamente as mesmas chaves', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.pt).sort());
  });

  it('o seletor de idioma declara auto/pt/en', () => {
    const sel = document.getElementById('langsel');
    expect(Array.from(sel.options).map(o => o.value)).toEqual(['auto', 'pt', 'en']);
  });
});

describe('classifyHealthLine', () => {
  it('reconhece o aviso real de LSP inativo', () => {
    expect(classifyHealthLine('extensão LSP inactive')).toEqual({ kind: 'lsp', id: 'extensão LSP inactive' });
  });

  it('reconhece o aviso real de MCP precisando de atenção', () => {
    const line = 'extensão MCP servers need attention: browseros-neo: failed: fetch failed Run /mcp to fix';
    expect(classifyHealthLine(line)).toEqual({ kind: 'mcp', id: line });
  });

  it('devolve null para linha normal do protocolo e para entrada vazia', () => {
    expect(classifyHealthLine('{"type":"agent_settled"}')).toBe(null);
    expect(classifyHealthLine('turno pronto')).toBe(null);
    expect(classifyHealthLine('')).toBe(null);
    expect(classifyHealthLine(null)).toBe(null);
  });

  it('casa com ANSI e prefixo de data/hora, que não entram no id', () => {
    expect(classifyHealthLine('\u001b[33m2026-01-02T10:00:00Z extensão LSP inactive\u001b[0m'))
      .toEqual({ kind: 'lsp', id: 'extensão LSP inactive' });
    expect(classifyHealthLine('[12:00:01] extensão MCP servers need attention: x'))
      .toEqual({ kind: 'mcp', id: 'extensão MCP servers need attention: x' });
  });

  it('id deduplica a mesma mensagem com espaçamento diferente', () => {
    const a = classifyHealthLine('extensão LSP inactive');
    const b = classifyHealthLine('  extensão   LSP  inactive  ');
    expect(b.id).toBe(a.id);
    expect(b.kind).toBe('lsp');
  });

  it('lê o aviso que chega como notify de extensão no JSON', () => {
    const line = JSON.stringify({ type: 'extension_ui_request', id: 'e1', method: 'notify', message: 'LSP inactive' });
    expect(classifyHealthLine(line)).toEqual({ kind: 'lsp', id: 'LSP inactive' });
    const mcp = JSON.stringify({ type: 'extension_ui_request', method: 'notify', message: 'MCP servers need attention: browseros-neo: failed: fetch failed' });
    expect(classifyHealthLine(mcp).kind).toBe('mcp');
  });

  it('não casa texto de aviso dentro de registro que não é notify de extensão', () => {
    const tool = JSON.stringify({ type: 'tool_execution_end', result: { output: 'MCP servers need attention: x failed' } });
    expect(classifyHealthLine(tool)).toBe(null);
    const delta = JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'LSP inactive' } });
    expect(classifyHealthLine(delta)).toBe(null);
  });
});

describe('noteHealth / healthChipState', () => {
  const add = (map, ...lines) => lines.forEach(l => noteHealth(map, l));

  it('mapa vazio (ou sem mapa) devolve chip sem avisos', () => {
    expect(healthChipState(new Map())).toEqual({ count: 0, kinds: [], title: '' });
    expect(healthChipState(undefined)).toEqual({ count: 0, kinds: [], title: '' });
  });

  it('um aviso: conta 1, guarda o tipo e lista a mensagem no title', () => {
    const map = new Map();
    add(map, 'extensão LSP inactive');
    const st = healthChipState(map);
    expect(st.count).toBe(1);
    expect(st.kinds).toEqual(['lsp']);
    expect(st.title).toMatch(/1 aviso\(s\)/);
    expect(st.title).toMatch(/lsp: extensão LSP inactive/);
  });

  it('três avisos (tipos misturados): kinds na ordem de chegada e 3 linhas no title', () => {
    const map = new Map();
    add(map,
      'extensão LSP inactive',
      'extensão MCP servers need attention: browseros-neo: failed: fetch failed',
      'extensão LSP inactive (2)');
    const st = healthChipState(map);
    expect(st.count).toBe(3);
    expect(st.kinds).toEqual(['lsp', 'mcp']);
    expect(st.title.split('\n').length).toBe(4); // cabeçalho + 3 mensagens
    expect(st.title).not.toMatch(/…/);
  });

  it('acima de 3 mensagens resume o resto com … e a contagem', () => {
    const map = new Map();
    add(map,
      'extensão LSP inactive',
      'extensão MCP servers need attention: a',
      'extensão MCP servers need attention: b',
      'extensão MCP servers need attention: c',
      'extensão MCP servers need attention: d');
    const st = healthChipState(map);
    expect(st.count).toBe(5);
    expect(st.title.split('\n').length).toBe(5); // cabeçalho + 3 + resumo
    expect(st.title).toMatch(/… \+2 aviso\(s\)/);
  });

  it('deduplica mensagem repetida com espaços diferentes', () => {
    const map = new Map();
    add(map, 'extensão LSP inactive', '  extensão   LSP  inactive ');
    expect(map.size).toBe(1);
    expect(healthChipState(map).count).toBe(1);
  });

  it('limita a 20 avisos por sessão descartando o mais antigo', () => {
    const map = new Map();
    for (let i = 0; i < 25; i++) noteHealth(map, 'extensão LSP inactive #' + i);
    expect(map.size).toBe(20);
    expect(map.has('extensão LSP inactive #0')).toBe(false);
    expect(map.has('extensão LSP inactive #24')).toBe(true);
    expect(healthChipState(map).count).toBe(20);
  });

  it('ignora linha não reconhecida sem criar entrada', () => {
    const map = new Map();
    expect(noteHealth(map, 'turno pronto')).toBe(null);
    expect(map.size).toBe(0);
  });

  it('aviso dispensado não conta nem entra no mapa, e volta ao restaurar', () => {
    const map = new Map();
    muteHealth('extensão LSP inactive');
    expect(noteHealth(map, 'extensão LSP inactive')).toBe(null);
    expect(map.size).toBe(0);
    unmuteHealth();
    expect(noteHealth(map, 'extensão LSP inactive')).toBe('lsp');
    expect(map.size).toBe(1);
  });
});

describe('insertRowByAt', () => {
  it('insere no meio, antes da primeira row mais nova', () => {
    const log = document.createElement('div');
    log.append(row(100, 'a'), row(200, 'b'), row(300, 'c'));
    const local = row(250, 'local');
    insertRowByAt(log, local, 250);
    expect(texts(log)).toEqual(['a', 'b', 'local', 'c']);
  });

  it('insere no fim quando todas as rows são mais antigas', () => {
    const log = document.createElement('div');
    log.append(row(100, 'a'), row(200, 'b'));
    const local = row(900, 'local');
    insertRowByAt(log, local, 900);
    expect(texts(log)).toEqual(['a', 'b', 'local']);
  });

  it('insere no início quando todas as rows são mais novas', () => {
    const log = document.createElement('div');
    log.append(row(100, 'a'), row(200, 'b'));
    const local = row(50, 'local');
    insertRowByAt(log, local, 50);
    expect(texts(log)).toEqual(['local', 'a', 'b']);
  });

  it('ignora rows sem âncora cronológica e cai no fim quando `at` é desconhecido', () => {
    const log = document.createElement('div');
    log.append(row(undefined, 'sem-at'), row(100, 'a'));
    const local = row(undefined, 'local');
    insertRowByAt(log, local, undefined);
    expect(texts(log)).toEqual(['sem-at', 'a', 'local']);
  });
});

describe('setZoom', () => {
  it('clampa no mínimo 0.6 e persiste o valor aplicado', () => {
    expect(setZoom(0.2)).toBe(0.6);
    expect(localStorage.getItem('zoom')).toBe('0.6');
  });

  it('clampa no máximo 2.0 e persiste o valor aplicado', () => {
    expect(setZoom(5)).toBe(2);
    expect(localStorage.getItem('zoom')).toBe('2');
  });

  it('arredonda o passo de 0.1 (0.6 + 0.1 = 0.7) e persiste', () => {
    expect(setZoom(0.6 + 0.1)).toBe(0.7);
    expect(localStorage.getItem('zoom')).toBe('0.7');
  });

  it('reset volta a 1.0', () => {
    setZoom(1.7);
    expect(setZoom(1)).toBe(1);
    expect(localStorage.getItem('zoom')).toBe('1');
  });
});

describe('clampWidth', () => {
  it('sobe para o mínimo', () => {
    expect(clampWidth(100, 180, 520)).toBe(180);
  });

  it('desce para o máximo', () => {
    expect(clampWidth(900, 180, 520)).toBe(520);
  });

  it('mantém valor dentro da faixa e trata lixo como mínimo', () => {
    expect(clampWidth(300, 180, 520)).toBe(300);
    expect(clampWidth('310', 180, 520)).toBe(310);
    expect(clampWidth(NaN, 180, 520)).toBe(180);
    expect(clampWidth(undefined, 240, 720)).toBe(240);
  });
});

describe('clampColumns', () => {
  it('não mexe quando o centro cabe', () => {
    expect(clampColumns(300, 340, 1400)).toEqual({ aside: 300, panel: 340 });
  });

  it('reduz as colunas para preservar 320px de centro', () => {
    const fit = clampColumns(520, 720, 1000);
    expect(fit.aside + fit.panel).toBeLessThanOrEqual(1000 - 320);
    expect(fit.aside).toBeGreaterThanOrEqual(180);
    expect(fit.panel).toBeGreaterThanOrEqual(240);
  });

  it('reduz mais a coluna que estourou (a outra fica no piso)', () => {
    const fit = clampColumns(180, 720, 1000);
    expect(fit.aside).toBe(180);
    expect(fit.panel).toBe(1000 - 320 - 180);
  });

  it('não desce abaixo dos pisos quando nem os pisos cabem', () => {
    expect(clampColumns(520, 720, 640)).toEqual({ aside: 180, panel: 240 });
  });
});

describe('grip do composer: Ctrl+wheel', () => {
  const card = () => document.querySelector('.composer-card');
  const wheel = (init) => new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  const varPx = () => parseFloat(document.body.style.getPropertyValue('--composer-w'));

  it('sem Ctrl não intercepta nem persiste', () => {
    const ev = wheel({ deltaY: -1 });
    card().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(Number.isNaN(varPx())).toBe(true);
    expect(localStorage.getItem('composer-w')).toBe(null);
  });

  it('com Ctrl alarga 40px por passo e persiste', () => {
    card().dispatchEvent(wheel({ ctrlKey: true, deltaY: -1 }));
    expect(varPx()).toBe(860);
    expect(localStorage.getItem('composer-w')).toBe('860');
    const ev = wheel({ ctrlKey: true, deltaY: -1 });
    card().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(varPx()).toBe(900);
  });

  it('com Ctrl encolhe 40px por passo até o piso de 520', () => {
    for (let i = 0; i < 40; i++) card().dispatchEvent(wheel({ ctrlKey: true, deltaY: 1 }));
    expect(varPx()).toBe(520);
    expect(localStorage.getItem('composer-w')).toBe('520');
  });

  it('com Ctrl alarga até o teto de 1600', () => {
    for (let i = 0; i < 40; i++) card().dispatchEvent(wheel({ ctrlKey: true, deltaY: -1 }));
    expect(varPx()).toBe(1600);
    expect(localStorage.getItem('composer-w')).toBe('1600');
  });
});

describe('colunas laterais: Ctrl + arrastar', () => {
  const gripAside = () => document.getElementById('colgripaside');
  const pointer = (type, init) => gripAside().dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  const varPx = (name) => parseFloat(document.body.style.getPropertyValue(name));

  it('sem Ctrl o grip não captura e não mexe na largura', () => {
    pointer('pointerdown', { clientX: 100 });
    pointer('pointermove', { clientX: 200 });
    expect(Number.isNaN(varPx('--w-aside'))).toBe(true);
    expect(localStorage.getItem('w-aside')).toBe(null);
  });

  it('com Ctrl arrasta em px, preserva o centro e só persiste ao soltar', () => {
    pointer('pointerdown', { clientX: 100, ctrlKey: true });
    pointer('pointermove', { clientX: 200, ctrlKey: true });
    // 320 (partida sem layout medido) + 100 pedidos; o clamp devolve o que cabe
    // na janela de 1024px com 320px de centro: 380 + 323.
    expect(varPx('--w-aside')).toBe(380);
    expect(varPx('--w-panel')).toBe(323);
    expect(localStorage.getItem('w-aside')).toBe(null);
    pointer('pointerup', { clientX: 200, ctrlKey: true });
    expect(localStorage.getItem('w-aside')).toBe('380');
    expect(localStorage.getItem('w-panel')).toBe('323');
  });

  it('com zoom 2.0 o resize reaplica os pisos (sem largura fixa estourando)', () => {
    setZoom(2);
    window.dispatchEvent(new Event('resize'));
    // 1024/2 = 512px úteis: nem os pisos cabem com 320px de centro, então as
    // colunas ficam no piso e o `minmax(220px,…)` do CSS continua mandando.
    expect(varPx('--w-aside')).toBe(180);
    expect(varPx('--w-panel')).toBe(240);
    setZoom(1);
    window.dispatchEvent(new Event('resize'));
    expect(varPx('--w-aside')).toBe(380);
  });
});

describe('syncStopButton', () => {
  const stop = () => document.getElementById('stopbtn');
  const send = () => document.getElementById('send');

  it('turno rodando mostra o parar e mantém o envio clicável (fila)', () => {
    syncStopButton(true);
    expect(stop().classList.contains('hidden')).toBe(false);
    expect(send().disabled).toBe(false);
    expect(send().title).toBe('Enfileirar mensagem (turno rodando)');
  });

  it('turno parado esconde o parar e volta o título de envio', () => {
    syncStopButton(false);
    expect(stop().classList.contains('hidden')).toBe(true);
    expect(send().disabled).toBe(false);
    expect(send().title).toBe('Enviar (Enter)');
  });
});

describe('shouldProbeTurn', () => {  const base = { silenceMs: 45000, probeIntervalMs: 30000 };

  it('não sonda antes do silêncio', () => {
    // 44s de silêncio: ainda dentro da janela, o turno pode estar só demorando.
    expect(shouldProbeTurn({ ...base, working: true, lastEventAt: 1000, now: 45000 })).toBe(false);
  });

  it('sonda depois do silêncio', () => {
    expect(shouldProbeTurn({ ...base, working: true, lastEventAt: 1000, now: 46001 })).toBe(true);
  });

  it('não sonda de novo antes do intervalo mínimo entre sondas', () => {
    const silenceOver = { ...base, working: true, lastEventAt: 0, now: 60000 };
    expect(shouldProbeTurn({ ...silenceOver, lastProbeAt: 40000 })).toBe(false);
    expect(shouldProbeTurn({ ...silenceOver, lastProbeAt: 30000 })).toBe(true);
  });

  it('não sonda aba que não está trabalhando', () => {
    expect(shouldProbeTurn({ ...base, working: false, lastEventAt: 0, now: 600000 })).toBe(false);
  });

  it('aba sem evento registrado conta como silenciosa desde sempre', () => {
    expect(shouldProbeTurn({ ...base, working: true, lastEventAt: undefined, now: 46000 })).toBe(true);
  });
});

describe('shouldRestoreLocalRow', () => {
  it('não reinsere linha cujo texto já está no transcript', () => {
    const seen = new Set(['oi']);
    expect(shouldRestoreLocalRow({ text: 'oi', state: 'delivered' }, seen)).toBe(false);
  });

  it('não reinsere linha cancelada cujo texto já está no transcript', () => {
    const seen = new Set(['prompt da run 1']);
    expect(shouldRestoreLocalRow({ text: 'prompt da run 1', state: 'cancelled' }, seen)).toBe(false);
  });

  it('reinsere linha que o disco ainda não tem', () => {
    const seen = new Set(['outra mensagem']);
    expect(shouldRestoreLocalRow({ text: 'prompt novo', state: 'pending' }, seen)).toBe(true);
    expect(shouldRestoreLocalRow({ text: 'fila morreu', state: 'cancelled' }, seen)).toBe(true);
  });
});

describe('dropQueuedRows (desfazer fila / abort)', () => {
  it('tira as rows em fila do DOM e da lista, preservando o resto', () => {
    let removed = 0;
    const node = () => ({ remove: () => { removed++; } });
    const t = { localRows: [
      { text: 'a', state: 'queued', row: node() },
      { text: 'b', state: 'delivered', row: node() },
      { text: 'c', state: 'queued', row: node() },
      { text: 'd', state: 'pending', row: node() },
      { text: 'e', state: 'cancelled', row: node() },
    ] };
    expect(dropQueuedRows(t)).toBe(3);
    expect(removed).toBe(3);
    expect(t.localRows.map(e => e.text)).toEqual(['b', 'd']);
  });

  it('sem localRows não explode', () => {
    expect(dropQueuedRows(null)).toBe(0);
    expect(dropQueuedRows({})).toBe(0);
  });
});

describe('tema por JSON', () => {
  afterEach(() => {
    resetTheme();
    localStorage.removeItem('theme');
  });

  it('THEME_KEYS tem os 46 tokens do :root, sem --mono', () => {
    expect(THEME_KEYS.length).toBe(46);
    expect(new Set(THEME_KEYS).size).toBe(46);
    expect(THEME_KEYS).not.toContain('mono');
  });

  it('aceita chave conhecida com cor válida (com ou sem prefixo --)', () => {
    expect(validateTheme({ bg: '#0f1115' })).toEqual({ ok: { bg: '#0f1115' }, ignored: [] });
    expect(validateTheme({ '--accent': 'rgb(122 162 247)' }).ok).toEqual({ accent: 'rgb(122 162 247)' });
    expect(validateTheme({ 'ink-0': 'hsla(0,0%,100%,.9)' }).ok).toEqual({ 'ink-0': 'hsla(0,0%,100%,.9)' });
    expect(validateTheme({ ok: '#7ee78780' }).ok).toEqual({ ok: '#7ee78780' });
  });

  it('ignora chave desconhecida', () => {
    const res = validateTheme({ 'mono': 'Comic Sans', 'bg-9': '#fff', bg: '#fff' });
    expect(res.ok).toEqual({ bg: '#fff' });
    expect(res.ignored).toEqual(['mono', 'bg-9']);
  });

  it('ignora valor que não é cor', () => {
    const res = validateTheme({ bg: 'url(http://x/a.png)', panel: 123, card: '', fg: 'expression(alert(1))' });
    expect(res.ok).toEqual({});
    expect(res.ignored).toEqual(['bg', 'panel', 'card', 'fg']);
  });

  it('string JSON inválida não lança e devolve error', () => {
    expect(() => validateTheme('{ nope')).not.toThrow();
    const res = validateTheme('{ nope');
    expect(res.ok).toEqual({});
    expect(res.ignored).toEqual([]);
    expect(res.error).toMatch(/JSON inválido/);
    expect(validateTheme('').error).toBe('JSON vazio');
    expect(validateTheme('[1,2]').error).toMatch(/objeto/);
  });

  it('applyTheme chama setProperty só para chaves conhecidas e persiste', () => {
    const spy = vi.spyOn(document.documentElement.style, 'setProperty');
    const res = applyTheme({ bg: '#101010', accent: 'hsl(210 80% 70%)', nope: '#fff', panel: 42 });
    expect(spy.mock.calls.map(c => c[0])).toEqual(['--bg', '--accent']);
    spy.mockRestore();
    expect(res.ignored).toEqual(['nope', 'panel']);
    expect(JSON.parse(localStorage.getItem('theme'))).toEqual({ bg: '#101010', accent: 'hsl(210 80% 70%)' });
    resetTheme();
    expect(localStorage.getItem('theme')).toBe(null);
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
  });
});

describe('presets de tema', () => {
  it('traz 6 presets com ids únicos, incluindo o default vazio', () => {
    expect(PRESETS.length).toBe(6);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(6);
    expect(presetById('sightdeck').tokens).toEqual({});
  });

  it('só usa chaves de THEME_KEYS', () => {
    const known = new Set(THEME_KEYS);
    for (const p of PRESETS) {
      for (const k of Object.keys(p.tokens)) expect(known.has(k)).toBe(true);
    }
  });

  it('todos os valores passam no validateTheme', () => {
    for (const p of PRESETS) {
      const res = validateTheme(p.tokens);
      expect(res.error).toBeUndefined();
      expect(res.ignored).toEqual([]);
      expect(Object.keys(res.ok).length).toBe(Object.keys(p.tokens).length);
    }
  });

  it('preset desconhecido devolve null', () => {
    expect(presetById('inexistente')).toBe(null);
  });
});

describe('snapshots dos pops (Fase 2)', () => {
  const provs = () => new Map([
    ['acme', [
      { id: 'b', name: 'Bravo', contextWindow: 200000, provider: 'acme' },
      { id: 'a', name: 'Alpha', contextWindow: 100000, provider: 'acme' },
    ]],
    ['zed', [{ id: 'z', contextWindow: null, provider: 'zed' }]],
  ]);

  it('modelListSnapshot agrupa por provider, ordena, filtra e marca o atual', () => {
    const snap = modelListSnapshot(provs(), 'a', '');
    expect(snap.empty).toBe(false);
    expect(snap.groups.map(g => g.provider)).toEqual(['acme', 'zed']);
    expect(snap.groups[0].rows.map(r => r.id)).toEqual(['a', 'b']);
    expect(snap.groups[0].rows[0]).toMatchObject({ name: 'Alpha', ctx: '100k', current: true });
    expect(snap.groups[1].rows[0]).toMatchObject({ name: 'z', ctx: '', current: false });
    expect(modelListSnapshot(provs(), '', 'br').groups[0].rows.map(r => r.id)).toEqual(['b']);
    expect(modelListSnapshot(provs(), '', 'nada').empty).toBe(true);
  });

  it('modelListSnapshot separa favoritos em seção própria (provider/modelo)', () => {
    const snap = modelListSnapshot(provs(), 'a', '', new Set(['b']));
    expect(snap.favs.length).toBe(1);
    expect(snap.favs[0]).toMatchObject({ id: 'b', label: 'acme/Bravo', current: false, fav: true });
    // o favorito sai da lista principal
    expect(snap.groups[0].rows.map(r => r.id)).toEqual(['a']);
    expect(snap.groups[0].rows[0].fav).toBe(false);
  });

  it('modelListSnapshot: favorito marcado como atual e busca filtra ambos', () => {
    const cur = modelListSnapshot(provs(), 'b', '', new Set(['b']));
    expect(cur.favs[0].current).toBe(true);
    const filtrado = modelListSnapshot(provs(), '', 'bra', new Set(['b']));
    expect(filtrado.favs.map(f => f.id)).toEqual(['b']);
    expect(filtrado.groups.length).toBe(0);
  });

  it('modelListSnapshot: mesmo id em dois providers gera chaves únicas (provider/id)', () => {
    // Regressão 2026-11-24: o id sozinho colidia entre opencode e opencode-go e o
    // clique caía sempre no primeiro provider (Zen, gastando crédito em vez do plano).
    const dois = new Map([
      ['acme', [{ id: 'x', provider: 'acme', contextWindow: 1000 }]],
      ['zed', [{ id: 'x', provider: 'zed', contextWindow: 1000 }]],
    ]);
    const snap = modelListSnapshot(dois, '', '', new Set(['x']));
    expect(snap.favs.map(f => f.key)).toEqual(['acme/x', 'zed/x']);
    expect(new Set(snap.favs.map(f => f.key)).size).toBe(2);
    expect(snap.favs.map(f => f.label)).toEqual(['acme/x', 'zed/x']);
    expect(snap.groups.length).toBe(0);
    // `current` com objeto marca só o provider certo.
    const cur = modelListSnapshot(new Map([
      ['acme', [{ id: 'x', provider: 'acme', contextWindow: 1000 }]],
      ['zed', [{ id: 'x', provider: 'zed', contextWindow: 1000 }]],
    ]), { provider: 'zed', id: 'x' }, '', new Set());
    expect(cur.groups.flatMap(g => g.rows.map(r => [r.key, r.current])))
      .toEqual([['acme/x', false], ['zed/x', true]]);
  });

  it('levelsSnapshot: vazio, único (sem slider) e múltiplo', () => {
    expect(levelsSnapshot([], 'x')).toEqual({ levels: [], at: 0, name: '', showSlider: false });
    expect(levelsSnapshot(['off'], 'off')).toMatchObject({ at: 0, name: 'off', showSlider: false });
    expect(levelsSnapshot(['off', 'low', 'high'], 'low')).toMatchObject({ at: 1, name: 'low', showSlider: true });
    expect(levelsSnapshot(['off', 'low'], 'ghost')).toMatchObject({ at: 0, name: 'off' });
  });

  it('limitSnapshot: default, match de preset e custom', () => {
    const d = limitSnapshot(200000, null, true);
    expect(d.value).toBe('');
    expect(d.options[0]).toEqual({ value: '', label: 'padrão do pi' });
    expect(d.disabled).toBe(false);
    expect(limitSnapshot(200000, 40000, true).value).toBe('80');
    const c = limitSnapshot(200000, 12345, true);
    expect(c.value).toBe('custom');
    expect(c.options[c.options.length - 1].value).toBe('custom');
    expect(limitSnapshot(200000, null, false).disabled).toBe(true);
    expect(limitSnapshot(0, null, true).disabled).toBe(true);
  });


  it('forkSnapshot normaliza, trunca e rotula', () => {
    expect(forkSnapshot([])).toEqual([]);
    expect(forkSnapshot([{ noid: 1 }, null])).toEqual([]);
    const snap = forkSnapshot([{ entryId: 'abcdef123456', text: '  olá   mundo  ' }]);
    expect(snap[0]).toMatchObject({ entryId: 'abcdef123456', label: 'olá mundo', short: 'abcdef12' });
    expect(snap[0].title).toMatch(/olá   mundo[\s\S]*fork/);
  });

  it('ctxSnapshot vazio devolve só o vazio (sem agregado de abas)', () => {
    const e = ctxSnapshot({ stats: {}, billed: 0, ctxDelta: 0 }, {});
    expect(e.empty).toBe(true);
    expect(e.blocks).toEqual([]);
  });

  it('ctxSnapshot cheio ordena blocos e alerta aos 90%', () => {
    const view = {
      stats: {
        tokens: { total: 190000, input: 100000, output: 90000, cacheRead: 10, cacheWrite: 20 },
        contextUsage: { tokens: 190000, contextWindow: 200000, percent: 95 },
        cost: 1.5, totalMessages: 7,
      },
      billed: 100, ctxDelta: 5000,
    };
    // Duas respostas com duração: 1.000 tokens de output em 20 s → 50 tok/s.
    const messages = [
      { role: 'assistant', usage: { output: 600 }, durationMs: 10000 },
      { role: 'assistant', usage: { output: 400 }, durationMs: 10000 },
    ];
    const snap = ctxSnapshot(view, { autoOn: true, tabs: [], curKey: null, reserve: null, win: 200000, canEdit: true, messages });
    expect(snap.empty).toBe(false);
    // window, alert, auto, limit, cache, cache_hit, io, avg, live, cost, messages
    expect(snap.blocks.map(b => b.t)).toEqual(['row', 'alert', 'row', 'limit', 'row', 'row', 'row', 'row', 'row', 'row', 'row']);
    expect(snap.blocks[1]).toMatchObject({ kind: 'danger' });
    expect(snap.blocks[2].v).toBe('ligada');
    expect(snap.blocks[5].k).toBe('Cache hit do input');
    expect(snap.blocks[7]).toMatchObject({ k: 'Velocidade média', v: '50 tok/s' });
  });

  it('ctxSnapshot sem duração nas respostas não mostra a velocidade', () => {
    const view = {
      stats: {
        tokens: { total: 190000, input: 100000, output: 90000, cacheRead: 10, cacheWrite: 20 },
        contextUsage: { tokens: 190000, contextWindow: 200000, percent: 95 },
        cost: 1.5, totalMessages: 7,
      },
      billed: 0, ctxDelta: 0,
    };
    const snap = ctxSnapshot(view, { autoOn: true, tabs: [], curKey: null, reserve: null, win: 200000, canEdit: true, messages: [] });
    expect(snap.blocks.some(b => b.k === 'Velocidade média')).toBe(false);
  });
});

describe('pops svelte montam e sincronizam (Fase 2)', () => {
  it('ModelPop monta, aplica, filtra e reabre', async () => {
    const applied = [];
    const host = {
      t: (k) => k,
      getLangPref: () => 'pt',
      snapshot: (filter) => ({
        list: modelListSnapshot(new Map([['acme', [{ id: 'a', name: 'A', contextWindow: 1000, provider: 'acme' }]]]), '', filter),
        levels: levelsSnapshot([], null),
      }),
      apply: async (key) => { applied.push(key); },
      previewLevel: () => '',
      setLevel: async () => {},
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(ModelPop, { target, props: { host } });
    expect(target.querySelectorAll('.model-row').length).toBe(1);
    target.querySelector('.model-row').click();
    expect(applied).toEqual(['acme/a']);
    inst.sync('zzz');
    await tick();
    expect(target.querySelectorAll('.model-row').length).toBe(0);
    expect(target.querySelector('.model-empty')).not.toBe(null);
    await inst.open();
    expect(target.querySelectorAll('.model-row').length).toBe(1);
    unmount(inst);
    target.remove();
  });

  it('ForkPop monta, sincroniza e forka', async () => {
    const done = [];
    const host = {
      t: (k) => k,
      getLangPref: () => 'pt',
      snapshot: (m) => forkSnapshot(m),
      doFork: (id) => { done.push(id); },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(ForkPop, { target, props: { host } });
    expect(target.querySelector('.model-empty')).not.toBe(null);
    inst.sync([{ entryId: 'abc123', text: 'hello' }]);
    await tick();
    expect(target.querySelectorAll('.model-row').length).toBe(1);
    target.querySelector('.model-row').click();
    expect(done).toEqual(['abc123']);
    unmount(inst);
    target.remove();
  });
  it('CtxPop monta blocos, salva limite e sincroniza', async () => {
    const saved = [];
    let state = {
      empty: false,
      blocks: [
        { t: 'row', k: 'Context window', v: '10% usado · 1k / 10k tokens' },
        { t: 'alert', kind: 'warn', text: 'Contexto em 75%' },
        {
          t: 'limit',
          win: 10000,
          limit: {
            options: [{ value: '', label: 'padrão do pi' }, { value: '80', label: '80% · reserva 2k' }],
            value: '',
            disabled: false,
            title: 'limite',
          },
        },
      ],
    };
    const host = {
      t: (k) => k,
      getLangPref: () => 'pt',
      snapshot: () => state,
      saveLimit: async (value) => { saved.push(value); return state; },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(CtxPop, { target, props: { host } });
    expect(target.querySelectorAll('.ctx-row').length).toBe(2);
    expect(target.querySelector('.ctx-alert.warn')).not.toBe(null);
    const sel = target.querySelector('.ctx-sel');
    expect(sel.options.length).toBe(2);
    expect(sel.disabled).toBe(false);
    sel.value = '80';
    // Svelte 5 delega `change` na raiz do componente: sem bubbles o handler não roda.
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(saved).toEqual(['80']);
    state = { empty: true, blocks: [] };
    inst.sync();
    await tick();
    expect(target.querySelectorAll('.ctx-row').length).toBe(0);
    expect(target.querySelector('.model-empty')).not.toBe(null);
    unmount(inst);
    target.remove();
  });
});

describe('barra de abas (Fase 3)', () => {
  const list = () => [
    { key: '2026-11-18T10-41-00-000Z_sessao-a', cwd: '/home/user/proj', label: 'A', working: true, connected: true },
    { key: '2026-11-18T10-42-00-000Z', cwd: '/tmp/x', label: '', connected: true },
    { key: '2026-11-18T10-43-00-000Z', cwd: '', working: false, connected: false },
  ];

  it('tabsSnapshot monta estado, projeto e título por aba', () => {
    const snap = tabsSnapshot(list(), { key: '2026-11-18T10-41-00-000Z_sessao-a' });
    expect(snap.length).toBe(3);
    expect(snap[0]).toMatchObject({ active: true, dot: ' busy', project: 'proj', title: 'A' });
    expect(snap[0].titleAttr).toContain('/home/user/proj');
    expect(snap[1]).toMatchObject({ active: false, dot: ' live', project: 'x' });
    expect(snap[1].title).toBe('18/11 10:42');
    expect(snap[2]).toMatchObject({ active: false, dot: '', project: '', title: '18/11 10:43' });
  });

  it('tabsSnapshot aguenta lista vazia e activeTab nulo', () => {
    expect(tabsSnapshot([], null)).toEqual([]);
    expect(tabsSnapshot(null, null)).toEqual([]);
    expect(tabsSnapshot(list(), null).every(t => t.active === false)).toBe(true);
  });

  it('TabBar monta, troca de aba e fecha', async () => {
    const calls = [];
    const host = {
      snapshot: () => tabsSnapshot(list(), { key: '2026-11-18T10-41-00-000Z_sessao-a' }),
      switchTab: (k) => { calls.push(['switch', k]); },
      closeTab: (k) => { calls.push(['close', k]); },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(TabBar, { target, props: { host } });
    const nodes = target.querySelectorAll('.tab');
    expect(nodes.length).toBe(3);
    expect(nodes[0].classList.contains('active')).toBe(true);
    nodes[1].click();
    expect(calls).toEqual([['switch', '2026-11-18T10-42-00-000Z']]);
    target.querySelectorAll('.tab-close')[2].click();
    expect(calls[1]).toEqual(['close', '2026-11-18T10-43-00-000Z']);
    unmount(inst);
    target.remove();
  });
});

describe('árvore de sessões (Fase 3b)', () => {
  const groups = () => [
    { path: '/home/user/proj', name: 'proj', sessions: [
      { id: 's1', title: 'Sessão 1', children: 2, file: '/x/s1.jsonl' },
      { id: 's2', title: '', children: 0, file: '/x/s2.jsonl' },
    ] },
    { path: '/home/user', name: 'user', sessions: [] },
  ];
  const opts = (o) => ({ collapsed: new Set(), expanded: new Set(), hidden: new Set(), homeDir: '/home/user', ...o });

  it('sessionsSnapshot monta caret, nome, contagem e linhas', () => {
    const snap = sessionsSnapshot(groups(), opts());
    expect(snap.groups[0]).toMatchObject({ path: '/home/user/proj', caret: '▾', name: 'proj', count: 2, hiddenCount: 0 });
    expect(snap.groups[0].rows[0]).toMatchObject({ key: 's1', title: 'Sessão 1', children: 2 });
    expect(snap.groups[0].rows[1].title).toBe('sem título');
    expect(snap.groups[1].name).toBe('sem projeto');
    expect(snap.groups[1].rows).toEqual([]);
  });

  it('sessionsSnapshot reflete colapsado, oculto e paginação', () => {
    const many = [{ path: '/p', name: 'p', sessions: Array.from({ length: 10 }, (_, i) => ({ id: 'k' + i, title: 't' + i })) }];
    const cut = sessionsSnapshot(many, opts({ collapsed: new Set(['/p']), hidden: new Set(['/p']), homeDir: null }));
    expect(cut.groups[0].caret).toBe('▸');
    expect(cut.groups[0].hideMark).toBe('↺');
    expect(cut.groups[0].rows.length).toBe(8);
    expect(cut.groups[0].hiddenCount).toBe(2);
    expect(cut.groups[0].moreLabel).toContain('2');
    const full = sessionsSnapshot(many, opts({ expanded: new Set(['/p']), homeDir: null }));
    expect(full.groups[0].rows.length).toBe(10);
    expect(full.groups[0].hiddenCount).toBe(0);
  });

  it('SessionTree monta, abre sessão e alterna projeto', async () => {
    const calls = [];
    const host = {
      snapshot: () => sessionsSnapshot(groups(), opts()),
      toggleProject: (p) => { calls.push(['toggle', p]); },
      hideProject: (p) => { calls.push(['hide', p]); },
      newSession: (p) => { calls.push(['new', p]); },
      open: (p, k) => { calls.push(['open', p, k]); },
      askDelete: (p, k) => { calls.push(['delete', p, k]); },
      loadMore: (p) => { calls.push(['more', p]); },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(SessionTree, { target, props: { host } });
    expect(target.querySelectorAll('.group').length).toBe(2);
    expect(target.querySelectorAll('.sess').length).toBe(2);
    target.querySelectorAll('.sess')[0].click();
    expect(calls[0]).toEqual(['open', '/home/user/proj', 's1']);
    target.querySelector('.group-head').click();
    expect(calls[1]).toEqual(['toggle', '/home/user/proj']);
    unmount(inst);
    target.remove();
  });
});

describe('resultados da busca (Fase 3c)', () => {
  const items = () => [
    { id: '2026-11-18T10-41-00-000Z_a', title: 'Alpha', file: '/s/a.jsonl', snippet: 'trecho…', matches: 3, tools: ['edit', 'bash', 'read', 'grep'], hasError: true, cwd: '/home/user/p' },
    { id: '2026-11-18T10-42-00-000Z_b', title: '', file: '/s/b.jsonl', matches: 1 },
  ];

  it('searchSnapshot normaliza linhas, badge e erro', () => {
    const snap = searchSnapshot(items(), { total: 5, offset: 2 });
    expect(snap.rows.length).toBe(2);
    expect(snap.rows[0]).toMatchObject({ key: '2026-11-18T10-41-00-000Z_a', title: 'Alpha', snippet: 'trecho…', tools: 'edit,bash,read', hasError: true });
    expect(snap.rows[0].meta).toContain('3');
    expect(snap.rows[1].title).toBe('sem título');
    expect(snap.rows[1].snippet).toBe('');
    expect(snap.showMore).toBe(true);
    expect(snap.moreLabel).toContain('3');
    expect(snap.empty).toBe(false);
  });

  it('searchSnapshot: vazio e sem paginação', () => {
    const vazio = searchSnapshot([], { total: 0, offset: 0 });
    expect(vazio.empty).toBe(true);
    expect(vazio.showMore).toBe(false);
    expect(vazio.emptyLabel).toBe('nada encontrado');
    const fim = searchSnapshot(items(), { total: 2, offset: 2 });
    expect(fim.showMore).toBe(false);
    expect(fim.moreLabel).toBe('');
  });

  it('SearchResults monta, abre resultado e pagina', async () => {
    const calls = [];
    let total = 5;
    const host = {
      snapshot: () => searchSnapshot(items(), { total, offset: 2 }),
      open: (k) => { calls.push(['open', k]); },
      loadMore: () => { calls.push(['more']); },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(SearchResults, { target, props: { host } });
    expect(target.querySelectorAll('.sess').length).toBe(2);
    expect(target.querySelector('.badge').textContent).toBe('edit,bash,read');
    target.querySelectorAll('.sess')[0].click();
    expect(calls[0]).toEqual(['open', '2026-11-18T10-41-00-000Z_a']);
    target.querySelector('.sess-more').click();
    expect(calls[1]).toEqual(['more']);
    total = 2;
    inst.sync();
    await tick();
    expect(target.querySelector('.sess-more')).toBe(null);
    unmount(inst);
    target.remove();
  });
});

describe('painel Plano (Fase 4a)', () => {
  it('plansSnapshot: erro, sem dados, sem repo e vazio', () => {
    expect(plansSnapshot(null, 'falhou')).toEqual({ empty: 'falhou', rows: [] });
    expect(plansSnapshot(null, '').empty).toBe('nenhum plano');
    expect(plansSnapshot({ repo: false }, '').empty).toContain('nenhum plano encontrado');
    expect(plansSnapshot({ repo: true, plans: [] }, '').empty).toBe('nenhum plano');
  });

  it('plansSnapshot monta nome, fonte, próximo item, checklist e barra', () => {
    const snap = plansSnapshot({ repo: true, plans: [
      { file: 'plans/a.md', name: 'A', source: 'spec', current: 'fazer X', done: 3, total: 4 },
      { file: 'plans/b.md', done: 0, total: 0 },
    ] }, '');
    expect(snap.rows[0]).toMatchObject({ file: 'plans/a.md', name: 'A', source: 'spec', current: 'fazer X', count: '3/4', pct: 75 });
    expect(snap.rows[1].name).toBe('plans/b.md');
    expect(snap.rows[1].count).toBe('sem checklist');
    expect(snap.rows[1].pct).toBe(0);
  });

  it('PlansPane monta, pinta a barra e abre o plano', async () => {
    const opened = [];
    const host = {
      snapshot: () => plansSnapshot({ repo: true, plans: [{ file: 'plans/a.md', name: 'A', done: 1, total: 2 }] }, ''),
      open: (f) => { opened.push(f); },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(PlansPane, { target, props: { host } });
    expect(target.querySelectorAll('.plan-item').length).toBe(1);
    expect(target.querySelector('.plan-bar-fill').style.width).toBe('50%');
    target.querySelector('.plan-item').click();
    expect(opened).toEqual(['plans/a.md']);
    unmount(inst);
    target.remove();
  });
});

describe('painel Missões (Fase 4b)', () => {
  it('missionsSnapshot: erro, vazio e linhas', () => {
    expect(missionsSnapshot([], 'falhou')).toEqual({ empty: 'falhou', head: '', rows: [] });
    const vazio = missionsSnapshot([], '');
    expect(vazio.rows).toEqual([]);
    expect(vazio.empty).toBeTruthy();
    const snap = missionsSnapshot([
      { id: 'm1', title: 'Corrigir X', status: 'open', runs: 3, cwd: '/p' },
      { id: 'm2', status: 'done' },
    ], '');
    expect(snap.rows[0]).toEqual({ key: 'm1', title: 'Corrigir X', status: 'open', runs: '3', titleAttr: '/p' });
    expect(snap.rows[1].title).toBe('m2');
    expect(snap.head).toContain('2');
  });

  it('MissionsPane monta e abre o detalhe', async () => {
    const opened = [];
    const host = {
      snapshot: () => missionsSnapshot([{ id: 'm1', title: 'A', status: 'open', runs: 1 }], ''),
      open: (k) => { opened.push(k); },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(MissionsPane, { target, props: { host } });
    expect(target.querySelectorAll('.file-row').length).toBe(1);
    target.querySelector('.file-row').click();
    expect(opened).toEqual(['m1']);
    unmount(inst);
    target.remove();
  });
});

describe('painel Git (Fase 4c)', () => {
  it('gitSnapshot: erro, sem repo e sem sessão', () => {
    expect(gitSnapshot(null, { error: 'falhou' }).empty).toBe('falhou');
    expect(gitSnapshot({ repo: false }, { cwd: '/p' }).empty).toContain('/p');
    expect(gitSnapshot(null, {}).empty).toBe('sem sessão aberta');
  });

  it('gitSnapshot monta head, arquivos, seleção e labels', () => {
    const snap = gitSnapshot({
      repo: true, branch: 'main', ahead: 2, behind: 1,
      totals: { add: 10, del: 3 },
      changes: [
        { path: 'src/a.js', status: 'M', add: 5, del: 1, staged: true },
        { path: 'b.md', status: '??', untracked: true },
      ],
    }, { cwd: '/p', sel: new Set(['b.md']), msg: 'oi', amend: true, lease: false, note: 'ok', noteErr: false });
    expect(snap.head).toEqual({ branch: 'main', ahead: 2, behind: 1, count: 2, add: 10, del: 3 });
    expect(snap.files[0]).toMatchObject({ path: 'src/a.js', name: 'a.js', dir: 'src', status: 'M', add: 5, del: 1, selected: false });
    expect(snap.files[0].titleAttr).toContain('no índice');
    expect(snap.files[1]).toMatchObject({ path: 'b.md', name: 'b.md', dir: '', selected: true, add: null, del: null });
    expect(snap.files[1].titleAttr).toContain('não rastreado');
    expect(snap.selCount).toBe(1);
    expect(snap).toMatchObject({ msg: 'oi', amend: true, lease: false, note: 'ok', noteErr: false, empty: '' });
    expect(snap.labels.reload).toBeTruthy();
  });

  it('GitPane monta, seleciona, abre diff e digita a mensagem', async () => {
    const calls = [];
    const snapData = gitSnapshot(
      { repo: true, branch: 'main', changes: [{ path: 'a.js', status: 'M', add: 1, del: 0 }] },
      { cwd: '/p', sel: new Set() },
    );
    const host = {
      snapshot: () => snapData,
      reload: () => { calls.push(['reload']); },
      discard: () => { calls.push(['discard']); },
      stash: () => { calls.push(['stash']); },
      stashPop: () => { calls.push(['stashPop']); },
      pull: () => { calls.push(['pull']); },
      toggleSel: (p) => { calls.push(['toggle', p]); },
      openDiff: (p) => { calls.push(['diff', p]); },
      setMsg: (v) => { calls.push(['msg', v]); },
      setFlag: (w, on) => { calls.push(['flag', w, on]); },
      commit: (push) => { calls.push(['commit', push]); },
      push: () => { calls.push(['push']); },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(GitPane, { target, props: { host } });
    expect(target.querySelectorAll('.file-row').length).toBe(1);
    expect(target.querySelector('button[disabled]')).not.toBe(null);
    target.querySelector('.file-row').click();
    expect(calls[0]).toEqual(['toggle', 'a.js']);
    target.querySelector('.file-row button').click();
    expect(calls[1]).toEqual(['diff', 'a.js']);
    const ta = target.querySelector('#gitmsg');
    expect(ta).not.toBe(null);
    ta.value = 'feat: x';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    expect(calls[2]).toEqual(['msg', 'feat: x']);
    target.querySelector('button.primary').click();
    expect(calls[3]).toEqual(['commit', false]);
    unmount(inst);
    target.remove();
  });
});

describe('painel Subagents (Fase 4d)', () => {
  it('subsSnapshot: vazio com e sem aviso de extensão', () => {
    const v = subsSnapshot([], [], { emptyLabel: 'nenhum subagent', warn: false });
    expect(v.empty).toBe(true);
    expect(v.runs).toEqual([]);
    expect(v.history).toEqual([]);
    expect(v.emptyLabel).toBe('nenhum subagent');
    expect(subsSnapshot([], [], { warn: true }).warn).toBe(true);
  });

  it('subsSnapshot: live com children, tempos e dedupe do histórico', () => {
    const now = 100000;
    const live = [{
      id: 'r1', label: 'run A', state: 'running', startedAt: now - 5000, updatedAt: now,
      children: [{ id: 'c1', label: 'child', state: 'running', model: 'anthropic/claude', thinking: 'high', startedAt: now - 3000, updatedAt: now }],
    }];
    const disk = [
      { id: 'r1', label: 'dup', state: 'running', run: 1, mtime: now },
      { id: 'd1', label: 'disco', state: 'done', run: 2, mtime: now - 60000 },
    ];
    const snap = subsSnapshot(live, disk, { now, emptyLabel: 'x' });
    expect(snap.empty).toBe(false);
    expect(snap.runs.length).toBe(1);
    expect(snap.runs[0]).toMatchObject({ id: 'r1', label: 'run A', state: 'running', time: '5s' });
    expect(snap.runs[0].children[0]).toMatchObject({ label: 'child', model: 'claude', thinking: 'high', time: '3s' });
    expect(snap.history.length).toBe(1);
    expect(snap.history[0]).toMatchObject({ id: 'd1', label: 'disco', stateText: 'concluído', stateClass: 'chip-done' });
    expect(snap.historyHead).toContain('1');
  });

  it('SubsPane monta live + histórico e abre o child do disco', async () => {
    const opened = [];
    const now = Date.now();
    const live = [{ id: 'r1', label: 'A', state: 'running', startedAt: now - 1000, updatedAt: now }];
    const disk = [{ id: 'd1', state: 'done', run: 1, mtime: now - 1000 }];
    const host = {
      snapshot: (n) => subsSnapshot(live, disk, { now: n || now, emptyLabel: 'vazio' }),
      openChild: (id) => { opened.push(id); },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(SubsPane, { target, props: { host } });
    expect(target.querySelectorAll('.run').length).toBe(2);
    expect(target.querySelectorAll('.run.clickable').length).toBe(1);
    target.querySelector('.run.clickable').click();
    expect(opened).toEqual(['d1']);
    unmount(inst);
    target.remove();
  });
});

describe('anexos do composer (Fase 5a)', () => {
  it('attachmentsSnapshot lista dataUrl com índice e rótulos', () => {
    const snap = attachmentsSnapshot([
      { dataUrl: 'data:image/png;base64,AAA', mimeType: 'image/png' },
      null,
    ]);
    expect(snap.length).toBe(2);
    expect(snap[0]).toEqual({ idx: 0, src: 'data:image/png;base64,AAA', alt: 'imagem colada', removeTitle: 'Remover imagem' });
    expect(snap[1].src).toBe('');
    expect(attachmentsSnapshot(null)).toEqual([]);
  });

  it('Attachments monta e remove pelo índice', async () => {
    const removed = [];
    const host = {
      snapshot: () => attachmentsSnapshot([{ dataUrl: 'data:image/png;base64,AAA' }]),
      remove: (i) => { removed.push(i); },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(Attachments, { target, props: { host } });
    expect(target.querySelectorAll('.attach').length).toBe(1);
    expect(target.querySelector('img').getAttribute('src')).toBe('data:image/png;base64,AAA');
    target.querySelector('.attach button').click();
    expect(removed).toEqual([0]);
    unmount(inst);
    target.remove();
  });

  /** Colagem real: keydown Ctrl+V seguido do evento `paste` do WebView. */
  function pasteGesture(items) {
    const input = document.getElementById('input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { items };
    input.dispatchEvent(ev);
  }

  async function clearAttachments() {
    document.querySelectorAll('#attachrow .attach button').forEach(b => b.click());
    await tick();
  }

  it('Ctrl+V com imagem no evento paste não anexa duas vezes', async () => {
    await clearAttachments();
    const calls = [];
    invokeImpl = async (cmd) => {
      calls.push(cmd);
      if (cmd === 'paste_image') return ['QUJD', 'image/png'];
      throw new Error('sem Tauri no teste');
    };
    try {
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' });
      pasteGesture([{ kind: 'file', type: 'image/png', getAsFile: () => file }]);
      await new Promise(r => setTimeout(r, 25));
      await tick();
      expect(calls).not.toContain('paste_image');
      expect(document.querySelectorAll('#attachrow .attach').length).toBe(1);
    } finally {
      await clearAttachments();
      invokeImpl = async () => { throw new Error('sem Tauri no teste'); };
    }
  });

  it('Ctrl+V sem imagem no evento paste ainda consulta o clipboard do sistema', async () => {
    await clearAttachments();
    const calls = [];
    invokeImpl = async (cmd) => {
      calls.push(cmd);
      if (cmd === 'paste_image') return ['QUJD', 'image/png'];
      throw new Error('sem Tauri no teste');
    };
    try {
      pasteGesture([]); // WebKitGTK antigo: `paste` só traz texto
      await new Promise(r => setTimeout(r, 25));
      await tick();
      expect(calls).toContain('paste_image');
      expect(document.querySelectorAll('#attachrow .attach').length).toBe(1);
    } finally {
      await clearAttachments();
      invokeImpl = async () => { throw new Error('sem Tauri no teste'); };
    }
  });
});

describe('palette de comandos (Fase 5b)', () => {
  it('paletteSnapshot marca a seleção e monta rótulos', () => {
    const snap = paletteSnapshot([
      { name: 'compact', description: 'compacta', source: 'builtin' },
      { name: 'model', app: true },
    ], 1);
    expect(snap.rows.length).toBe(2);
    expect(snap.rows[0]).toEqual({ idx: 0, name: '/compact', desc: 'compacta', src: 'builtin', sel: false });
    expect(snap.rows[1]).toEqual({ idx: 1, name: '/model', desc: '', src: 'pi', sel: true });
    expect(paletteSnapshot([], 0).rows).toEqual([]);
  });

  it('Palette monta e escolhe pelo índice', async () => {
    const picked = [];
    const host = {
      snapshot: () => paletteSnapshot([{ name: 'a' }, { name: 'b' }], 0),
      pick: (i) => { picked.push(i); },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(Palette, { target, props: { host } });
    expect(target.querySelectorAll('.palette-row').length).toBe(2);
    expect(target.querySelectorAll('.palette-row.sel').length).toBe(1);
    target.querySelectorAll('.palette-row')[1].click();
    expect(picked).toEqual([1]);
    unmount(inst);
    target.remove();
  });
});

describe('palette global Ctrl+K (Fase 5c)', () => {
  it('cmdkSnapshot achata o índice entre grupos e marca a seleção', () => {
    const snap = cmdkSnapshot([
      { label: 'RECENTES', rows: [{ title: '/a', desc: 'A', src: 's' }] },
      { label: 'COMANDOS', rows: [{ title: '/b' }, { title: '/c' }] },
    ], 1);
    expect(snap.empty).toBe(false);
    expect(snap.groups[0].rows[0]).toEqual({ idx: 0, title: '/a', desc: 'A', src: 's', sel: false });
    expect(snap.groups[1].rows[0]).toMatchObject({ idx: 1, title: '/b', sel: true });
    expect(snap.groups[1].rows[1]).toMatchObject({ idx: 2, title: '/c', sel: false });
    expect(cmdkSnapshot([], 0).empty).toBe(true);
  });

  it('CmdkList monta grupos e escolhe pelo índice', async () => {
    const picked = [];
    const host = {
      snapshot: () => cmdkSnapshot([{ label: 'COMANDOS', rows: [{ title: '/x' }, { title: '/y' }] }], 0),
      pick: (i) => { picked.push(i); },
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(CmdkList, { target, props: { host } });
    expect(target.querySelectorAll('.palette-group').length).toBe(1);
    expect(target.querySelectorAll('.palette-row').length).toBe(2);
    target.querySelectorAll('.palette-row')[1].click();
    expect(picked).toEqual([1]);
    unmount(inst);
    target.remove();
  });

  it('abrir o cmdk não destrói o componente da palette (container próprio)', () => {
    const target = document.getElementById('palettelist');
    const inst = mount(Palette, {
      target,
      props: { host: { snapshot: () => paletteSnapshot([{ name: 'x' }], 0), pick: () => {} } },
    });
    expect(target.querySelectorAll('.palette-row').length).toBe(1);
    openCmdk();
    // Regressão: `clear(#palettelist)` destruiria os nós do Svelte.
    expect(target.querySelectorAll('.palette-row').length).toBe(1);
    expect(document.getElementById('cmdklist').childElementCount).toBeGreaterThan(0);
    expect(target.classList.contains('hidden')).toBe(true);
    // Regressão da 5c: o early-path retornava antes do remove('hidden') do overlay.
    expect(document.getElementById('palette').classList.contains('hidden')).toBe(false);
    closeCmdk();
    expect(target.classList.contains('hidden')).toBe(false);
    unmount(inst);
  });
});

describe('indicador de digitação (Fase 5d)', () => {
  it('typingSnapshot: visível, label padrão e custom', () => {
    expect(typingSnapshot(true, '')).toEqual({ visible: true, label: 'pensando…' });
    expect(typingSnapshot(false, 'enviado…')).toEqual({ visible: false, label: 'enviado…' });
    expect(typingSnapshot(true, null).label).toBe('pensando…');
  });

  it('TypingIndicator monta dots/label, atualiza e some', async () => {
    let on = true;
    let label = 'pensando…';
    const host = { snapshot: () => typingSnapshot(on, label) };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const inst = mount(TypingIndicator, { target, props: { host } });
    expect(target.querySelectorAll('.tdot').length).toBe(3);
    expect(target.querySelector('.tlabel').textContent).toBe('pensando…');
    label = 'lendo…';
    inst.sync();
    await tick();
    expect(target.querySelector('.tlabel').textContent).toBe('lendo…');
    on = false;
    inst.sync();
    await tick();
    expect(target.querySelectorAll('.tdot').length).toBe(0);
    unmount(inst);
    target.remove();
  });

  it('setTyping sincroniza o componente montado no HTML real', async () => {
    setTyping(true, 'integracao');
    await tick();
    expect(document.getElementById('typing-svelte').textContent).toContain('integracao');
    setTyping(false);
    await tick();
    expect(document.getElementById('typing-svelte').textContent.trim()).toBe('');
  });
});

describe('integridade da migracao Svelte (Fase 7b)', () => {
  it('não existe mais wrapper legacy no HTML (migração completa)', () => {
    // Fase 7c: com os componentes Svelte assumindo todas as telas, os wrappers
    // de fallback foram removidos. Se algum voltar, este teste avisa.
    for (const id of ['settings-legacy', 'theme-legacy', 'modelpop-legacy', 'ctxpop-legacy', 'forkpop-legacy', 'typing-legacy']) {
      expect({ id, present: !!document.getElementById(id) }).toEqual({ id, present: false });
    }
  });

  it('os containers Svelte existem no HTML (montagem previsivel)', () => {
    for (const id of ['settings-general', 'theme-svelte', 'modelpop-svelte', 'ctxpop-svelte',
      'forkpop-svelte', 'typing-svelte', 'attachrow', 'palettelist', 'cmdklist',
      'tabs', 'sessions', 'searchresults', 'plans', 'missions', 'git', 'subs']) {
      expect({ id, present: !!document.getElementById(id) }).toEqual({ id, present: true });
    }
  });
});

describe('inspetor de contexto (Fase 8)', () => {
  it('ctxComposition separa system/user/assistant/tools por estimativa', () => {
    const msgs = [
      { role: 'system', content: [{ type: 'text', text: 'x'.repeat(400) }] },
      { role: 'user', content: [{ type: 'text', text: 'y'.repeat(400) }] },
      { role: 'assistant', content: [
        { type: 'text', text: 'z'.repeat(400) },
        { type: 'toolCall', name: 'edit', arguments: { a: 1 } },
      ] },
      { role: 'tool', content: [{ type: 'toolResult', text: 'w'.repeat(400) }] },
    ];
    const comp = ctxComposition(msgs);
    expect(comp.system).toBe(100);
    expect(comp.user).toBe(100);
    expect(comp.assistant).toBe(100);
    expect(comp.tools).toBeGreaterThan(100);
    expect(comp.total).toBe(comp.system + comp.user + comp.assistant + comp.tools);
    expect(ctxComposition([]).total).toBe(0);
  });
});

describe('Esc interrompe o turno', () => {
  it('aborta com turno trabalhando e foco no composer', () => {
    expect(shouldAbortOnEsc({ overlayOpen: false, inTerminal: false, working: true })).toBe(true);
  });

  it('não aborta sem turno trabalhando', () => {
    expect(shouldAbortOnEsc({ overlayOpen: false, inTerminal: false, working: false })).toBe(false);
  });

  it('não aborta com overlay aberto (Esc é de fechar)', () => {
    expect(shouldAbortOnEsc({ overlayOpen: true, inTerminal: false, working: true })).toBe(false);
  });

  it('não rouba o Esc do terminal embutido', () => {
    expect(shouldAbortOnEsc({ overlayOpen: false, inTerminal: true, working: true })).toBe(false);
  });
});

describe('layout com zoom', () => {
  it('colunas laterais relativas em vez de espremer o centro', () => {
    const css = readFileSync(resolve(process.cwd(), 'ui/src/styles.css'), 'utf8');
    // Regressão: `300px 1fr 340px` fixos — com zoom a viewport CSS encolhe e o
    // centro sumia (painel direito engolia tudo). Relativas (%/vars) escalam juntas.
    expect(css).toMatch(/--w-aside:\s*24%;\s*--w-panel:\s*27%/);
    expect(css).toMatch(/grid-template-columns:\s*minmax\(220px,\s*var\(--w-aside\)\)\s+minmax\(0,\s*1fr\)\s+minmax\(240px,\s*var\(--w-panel\)\)/);
    expect(css).toMatch(/body\.no-subs\s*\{\s*grid-template-columns:\s*minmax\(220px,\s*var\(--w-aside\)\)\s+minmax\(0,\s*1fr\)/);
    // O painel fechado some de verdade: `#rightpanel` (1,0,0) vence `section` (0,1,2).
    expect(css).toMatch(/body\.no-subs\s+#rightpanel\s*\{\s*display:\s*none/);
  });

  it('abre como caixinha modal no meio, fora do grid', () => {
    const css = readFileSync(resolve(process.cwd(), 'ui/src/styles.css'), 'utf8');
    const html = readFileSync(resolve(process.cwd(), 'ui/index.html'), 'utf8');
    // Regressão: célula do grid ou offsets fixos quebravam com zoom/colunas
    // redimensionadas (virava terceira coluna ou cortava o transcript). Agora é
    // scrim fixo + caixa central, imune ao layout das colunas.
    expect(css).not.toMatch(/\.detail\s*\{[^}]*grid-column/);
    expect(css).not.toMatch(/\.detail\s*\{[^}]*left:\s*300px/);
    expect(css).toMatch(/\.detail\s*\{[^}]*position:\s*fixed[^}]*align-items:\s*center[^}]*justify-content:\s*center/);
    expect(css).toMatch(/\.detail-box\s*\{/);
    expect(html).toContain('class="detail-box"');
    // Título longo (worker id) não pode empurrar a caixa: flex com piso zero.
    expect(css).toMatch(/\.detail-title\s*\{[^}]*flex:\s*1[^}]*min-width:\s*0/);
  });

  it('bloco de código rola em vez de cortar linha longa', () => {
    const css = readFileSync(resolve(process.cwd(), 'ui/src/styles.css'), 'utf8');
    expect(css).toMatch(/\.md-code-box pre\s*\{[^}]*overflow-x:\s*auto/);
  });
});

describe('avisos de extensão no Debug e overlay Sobre', () => {
  it('renderHealthList escreve o vazio no #healthlist (id tem que bater com o index.html)', () => {
    // Sem sessão atual o mapa não existe: o overlay precisa dizer isso, não ficar em branco.
    renderHealthList();
    const host = document.getElementById('healthlist');
    expect(host).not.toBeNull();
    expect(host.textContent).toContain('nenhum aviso');
  });

  it('renderHealthList lista kind + mensagem de cada aviso (o que o chip só conta)', () => {
    renderHealthList(new Map([
      ['MCP servers need attention: fetch failed', 'mcp'],
      ['LSP inactive', 'lsp'],
    ]));
    const rows = document.querySelectorAll('#healthlist .file-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('MCP servers need attention');
    expect(rows[0].textContent).toContain('mcp');
    expect(rows[1].textContent).toContain('lsp');
  });

  it('toda aba do modal tem o seu pane e vice-versa', () => {
    // Regressão real: a aba Custo existia, mas 'usage' não estava na lista
    // de panes do switchSettingsTab — a aba abria vazia.
    const html = readFileSync(resolve(process.cwd(), 'ui/index.html'), 'utf8');
    // Só as abas do modal: o painel direito também usa data-pane.
    const tabsBlock = html.slice(html.indexOf('id="settings-tabs"'));
    const modalTabs = tabsBlock.slice(0, tabsBlock.indexOf('</div>'));
    const tabs = [...modalTabs.matchAll(/data-pane="([a-z]+)"/g)].map(m => m[1]);
    for (const name of tabs) {
      expect(html.includes(`id="pane-${name}"`), `pane-${name}`).toBe(true);
    }
    expect(tabs).toContain('usage');
  });

  it('todo id que o main.js consulta no Sobre/avisos existe no index.html', () => {
    // Fase 7d: Sobre e manutenção viraram ABAS do modal único (sem popover).
    for (const id of ['aboutlist', 'healthlist', 'healthchip', 'settings', 'settings-tabs',
      'pane-about', 'pane-debug', 'pane-pkgs', 'pane-theme', 'pane-general', 'pane-providers', 'pane-usage',
      'provtab', 'provstatus', 'provsearchtab', 'meminfo', 'usagetotals', 'usagedays', 'usageprojects',
      'checkupdate', 'updExt', 'updPi', 'updOut']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });
});

describe('duplicação de resposta ao voltar para a aba', () => {
  it('não reanexa o parcial quando o disco já pintou a resposta inteira', () => {
    // Regressão: trocar de aba no meio do stream e voltar duplicava a mesma resposta.
    const rendered = ['Rode isso para validar.', 'Rode isso para validar.\n\nSegunda parte'];
    expect(answerAlreadyRendered('Rode isso para validar.', rendered)).toBe(true);
    expect(answerAlreadyRendered('Rode isso para validar.', ['outra resposta'])).toBe(false);
    // Parcial mais longo que o texto já pintado não é duplicata: ainda há stream.
    expect(answerAlreadyRendered('Rode isso para validar.\n\nAinda escrevendo', rendered)).toBe(false);
  });

  it('normaliza espaços antes de comparar (parcial x markdown do disco)', () => {
    expect(answerAlreadyRendered('linha 1\n\nlinha 2', ['linha 1\n\n  linha 2  '])).toBe(true);
    expect(normalizeRowText('  a\n  b  ')).toBe('a b');
  });

  it('parcial vazio nunca conta como resposta já pintada', () => {
    expect(answerAlreadyRendered('', ['qualquer'])).toBe(false);
    expect(answerAlreadyRendered('   ', ['qualquer'])).toBe(false);
  });
});

describe('mensagem do usuário não some ao trocar de conversa', () => {
  it('deduplica texto cru local contra o texto trim() do disco', () => {
    const seen = new Set([normalizeRowText('prompt grande\n')]);
    expect(shouldRestoreLocalRow({ text: 'prompt grande\n', state: 'pending' }, seen)).toBe(false);
  });

  it('reinsere quando o disco não tem a mensagem (linha grande omitida)', () => {
    const seen = new Set([normalizeRowText('outra mensagem')]);
    expect(shouldRestoreLocalRow({ text: 'prompt com imagem', state: 'pending' }, seen)).toBe(true);
  });
});

describe('tempo dos runs ao vivo', () => {
  it('run em andamento usa `now`, então o relógio anda a cada repaint', () => {
    const run = { state: 'running', startedAt: 1_000_000 };
    expect(elapsedFor(run, 1_011_000)).toBe('11s');
    expect(elapsedFor(run, 1_131_000)).toBe('2m11');
    expect(elapsedFor(run, 1_005_000)).toBe('5s');
  });

  it('run terminado congela no updatedAt/endedAt', () => {
    const run = { state: 'complete', startedAt: 1_000_000, updatedAt: 1_125_000 };
    expect(elapsedFor(run, 9_999_999)).toBe('2m05');
  });

  it('classifica só running/queued como ao vivo', () => {
    expect(isLiveRun({ state: 'running' })).toBe(true);
    expect(isLiveRun({ state: 'queued' })).toBe(true);
    expect(isLiveRun({ state: 'complete' })).toBe(false);
    expect(isLiveRun(null)).toBe(false);
  });
});

describe('painel de subagents: relógio ao vivo', () => {
  it('o tempo do run em andamento avança sozinho, sem novo snapshot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:11Z'));
    try {
      renderSubs({
        runs: [{
          id: 'run-1', label: 'worker, worker, worker, +1 more', kind: 'subagent',
          state: 'running', startedAt: Date.now() - 11000,
          children: [{ id: 'c1', label: 'manifest', state: 'complete', startedAt: Date.now() - 9000, updatedAt: Date.now() - 1000 }],
        }],
      });
      // Com o painel em Svelte o paint é flushado no microtask: sem o tick o
      // teste leria o estado anterior (early-path de `paintSubs`).
      await tick();
      expect(document.getElementById('subs').textContent).toContain('11s');
      vi.advanceTimersByTime(3000);
      await tick();
      expect(document.getElementById('subs').textContent).toContain('14s');
      // O child terminado congela no próprio updatedAt (não acompanha o relógio).
      expect(document.getElementById('subs').textContent).toContain('8s');
    } finally {
      renderSubs(null);
      vi.advanceTimersByTime(1000);
      vi.useRealTimers();
    }
  });
});

describe('reattachPlan (âncora antes do descarte)', () => {
  it('turno encerrado descarta o parcial: o disco manda', () => {
    expect(reattachPlan({ working: false, streamText: 'x', renderedBody: true, tailInLog: true })).toBe('drop-turn');
  });

  it('sem parcial, só ancora no bloco de thinking', () => {
    expect(reattachPlan({ working: true, streamText: '', renderedBody: null, tailInLog: false })).toBe('thinking');
  });

  it('bloco já pintado vence o descarte por cauda (não cria 2ª cópia)', () => {
    expect(reattachPlan({ working: true, streamText: 'Rode isso', renderedBody: true, tailInLog: true })).toBe('anchor');
  });

  it('parcial truncado que é sufixo do log é descartado', () => {
    expect(reattachPlan({ working: true, streamText: 'final da resposta', renderedBody: false, tailInLog: true })).toBe('drop-tail');
  });

  it('nada pintado: abre o bloco com o parcial', () => {
    expect(reattachPlan({ working: true, streamText: 'começando', renderedBody: false, tailInLog: false })).toBe('append');
  });
});

describe('renderedAnswerNode (âncora do parcial em vez de 2ª cópia)', () => {
  it('acha o bloco já pintado e não deixa o próximo delta abrir outra resposta', () => {
    const log = document.getElementById('log');
    log.innerHTML = '';
    const firstUser = document.createElement('div');
    firstUser.className = 'row user';
    const old = document.createElement('div');
    old.className = 'md-body';
    old._md = 'resposta anterior';
    const curUser = document.createElement('div');
    curUser.className = 'row user';
    const cur = document.createElement('div');
    cur.className = 'md-body';
    cur._md = 'Rode isso para validar.\n\nDetalhes finais.';
    log.append(firstUser, old, curUser, cur);

    expect(renderedAnswerNode('Rode isso para validar.')).toBe(cur);
    expect(renderedAnswerNode('texto que não está no log')).toBe(null);
    // Resposta de um turno ANTERIOR não pode ser a âncora do stream atual.
    expect(renderedAnswerNode('resposta anterior')).toBe(null);
    log.innerHTML = '';
  });
});

describe('tokens do turno em voo (mensagem ainda não persistida)', () => {
  const usage = (over = {}) => ({
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, ...over,
  });

  it('estima tokens por conteúdo como o pi (4 chars/token)', () => {
    expect(estimateMessageTokens({ content: [{ type: 'text', text: 'a'.repeat(400) }] })).toBe(100);
    expect(estimateMessageTokens({ content: [{ type: 'thinking', thinking: 'b'.repeat(800) }] })).toBe(200);
    const tool = { type: 'toolCall', name: 'read', arguments: { path: 'x'.repeat(343) } };
    const toolChars = tool.name.length + JSON.stringify(tool.arguments).length;
    expect(estimateMessageTokens({ content: [tool] })).toBe(Math.ceil(toolChars / 4));
    expect(estimateMessageTokens(null)).toBe(0);
  });

  it('velocidade por mensagem: output/durationMs, null sem dados válidos', () => {
    expect(msgSpeed({ usage: { output: 142 }, durationMs: 2688 })).toBe('52,8 tok/s · 142 out · 2,7s');
    expect(msgSpeed({ usage: { output: 308 }, durationMs: 3009 })).toBe('102 tok/s · 308 out · 3,0s');
    expect(msgSpeed({ usage: { output: 160 }, durationMs: 2225 })).toBe('71,9 tok/s · 160 out · 2,2s');
    expect(msgSpeed({})).toBe(null);
    expect(msgSpeed({ usage: { output: 10 } })).toBe(null);
    expect(msgSpeed({ usage: { output: 10 }, durationMs: 0 })).toBe(null);
    expect(msgSpeed({ usage: { output: 0 }, durationMs: 1000 })).toBe(null);
  });

  it('usa usage do parcial quando o provider já informou; senão estima', () => {
    const msg = { content: [{ type: 'text', text: 'a'.repeat(400) }], usage: usage() };
    expect(liveTurnTokens(msg)).toBe(100);
    msg.usage = usage({ input: 1000, output: 200, totalTokens: 1200 });
    expect(liveTurnTokens(msg)).toBe(1200);
  });

  it('soma o parcial aos totals e ao contexto e recalcula o %', () => {
    const data = {
      tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, total: 1500 },
      contextUsage: { tokens: 120_000, contextWindow: 1_000_000, percent: 12 },
      totalMessages: 10,
    };
    const snapshot = JSON.parse(JSON.stringify(data));
    const view = liveStatsView(data, { billed: 800, context: 600 });
    expect(view.billed).toBe(800);
    expect(view.ctxDelta).toBe(600);
    expect(view.stats.tokens.total).toBe(2300);
    expect(view.stats.contextUsage.tokens).toBe(120_600);
    expect(view.stats.contextUsage.percent).toBeCloseTo(12.06, 5);
    expect(data).toEqual(snapshot); // não muta o cache do RPC
  });

  it('sem parcial devolve os stats intactos', () => {
    const data = { tokens: { total: 10 }, contextUsage: { tokens: 5, contextWindow: 100, percent: 5 } };
    const view = liveStatsView(data, null);
    expect(view.billed).toBe(0);
    expect(view.ctxDelta).toBe(0);
    expect(view.stats).toBe(data);
  });

  it('não estoura a janela de contexto', () => {
    const view = liveStatsView(
      { tokens: { total: 0 }, contextUsage: { tokens: 99_900, contextWindow: 100_000, percent: 99.9 } },
      { billed: 10, context: 5000 },
    );
    expect(view.stats.contextUsage.tokens).toBe(100_000);
    expect(view.stats.contextUsage.percent).toBe(100);
  });
});

describe('renderToolImages', () => {
  it('mostra a imagem embutida que o modelo leu', () => {
    const body = document.createElement('div');
    const entry = { body, path: '/tmp/v-extrato2.png' };
    renderToolImages(entry, {
      content: [
        { type: 'text', text: '2 linhas' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
    });
    const img = body.querySelector('.tool-imgs img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(entry.imgsDone).toBe(true);
  });

  it('não repete a imagem quando o resultado chega parcial e depois final', () => {
    const body = document.createElement('div');
    const entry = { body, path: '' };
    const raw = { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] };
    renderToolImages(entry, raw);
    renderToolImages(entry, raw);
    expect(body.querySelectorAll('.tool-imgs img').length).toBe(1);
  });

  it('sem caminho na chamada, deixa o marcador em vez de pedir o arquivo', () => {
    const body = document.createElement('div');
    const entry = { body, path: '' };
    renderToolImages(entry, {
      content: [{ type: 'text', text: '[imagem 176 KB]', img: { mimeType: 'image/png', bytes: 180224 } }],
    });
    expect(body.querySelector('.img-missing').textContent).toBe('[imagem 176 KB]');
    expect(body.querySelector('img')).toBeNull();
  });
});

/* ---------------------------------------------------------------------------
 * Aba "Arquivos da pasta": árvore montada no cliente a partir dos paths que o
 * Rust devolve (`project_files`). Só funções puras — nada de Tauri aqui.
 * ------------------------------------------------------------------------- */
describe('filetree — árvore e filas visíveis', () => {
  const paths = ['README.md', 'src/main.rs', 'src/app/a.ts', 'src/app/b.ts', 'docs/x.md'];

  it('buildTree aninha por diretório, dirs antes de arquivos e A–Z', () => {
    const tree = buildTree(paths);
    expect(tree.children.map((n) => n.name)).toEqual(['docs', 'src', 'README.md']);
    const src = tree.children.find((n) => n.name === 'src');
    expect(src.dir).toBe(true);
    expect(src.path).toBe('src');
    expect(src.children.map((n) => n.name)).toEqual(['app', 'main.rs']);
    const app = src.children.find((n) => n.name === 'app');
    expect(app.children.map((n) => n.path)).toEqual(['src/app/a.ts', 'src/app/b.ts']);
  });

  it('buildTree aceita Windows separador e ignora vazio', () => {
    const tree = buildTree(['a\\b.ts', '', '/']);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].path).toBe('a');
    expect(tree.children[0].children[0].path).toBe('a/b.ts');
  });

  it('visibleRows sem filtro: pasta fechada esconde os filhos', () => {
    const tree = buildTree(paths);
    const rows = visibleRows(tree, [], '');
    expect(rows.map((r) => r.name)).toEqual(['docs', 'src', 'README.md']);
    expect(rows.find((r) => r.name === 'src').depth).toBe(0);
  });

  it('visibleRows respeita as pastas abertas (Set ou array)', () => {
    const tree = buildTree(paths);
    const rows = visibleRows(tree, new Set(['src']), '');
    expect(rows.map((r) => r.name)).toEqual(['docs', 'src', 'app', 'main.rs', 'README.md']);
    expect(rows.find((r) => r.name === 'app').depth).toBe(1);
    // aberta a subpasta, os netos aparecem com depth 2
    const deep = visibleRows(tree, ['src', 'src/app'], '');
    expect(deep.find((r) => r.name === 'a.ts').depth).toBe(2);
  });

  it('visibleRows com filtro lista só arquivos e achata a árvore', () => {
    const tree = buildTree(paths);
    const rows = visibleRows(tree, [], 'APP/');
    expect(rows.map((r) => r.path)).toEqual(['src/app/a.ts', 'src/app/b.ts']);
    expect(rows.every((r) => !r.dir && r.depth === 0)).toBe(true);
  });

  it('visibleRows com filtro limita a 200 arquivos', () => {
    const many = Array.from({ length: 250 }, (_, i) => `f${i}.ts`);
    const rows = visibleRows(buildTree(many), [], 'f');
    expect(rows).toHaveLength(200);
  });
});
