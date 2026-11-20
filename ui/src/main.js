import './styles.css';

import { inv, listen, PREFIX } from './rpc.js';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { $, el, stripAnsi, clear, setEmpty, scrollBottom, updateScrollBtn, uiSettings, caps, cards, pendingPromptRows } from './shared.js';
import { setMarkdown, mdRow, copyText, extActivity } from './markdown.js';
import { card, thinkBlock, applyToolResult, setDiffRenderer } from './tool-cards.js';
import { appendHighlighted, langFor } from './highlight.js';
import { diffView, setDiffView, splitHunk } from './diffview.js';
import { initTerminal, reconcileTerminal } from './terminal.js';
import { validateTheme, applyTheme, resetTheme, themeFromDom, bootTheme } from './theme.js';
import { t, getLang, getLangPref, setLang, applyStaticI18n } from './i18n.js';
import { mountSettings } from './settings/mount.js';
import { mountTheme } from './settings/theme/mount.js';
import { mountModelPop, mountCtxPop, mountForkPop, mountAttachments, mountPalette, mountCmdkList, mountTyping } from './composer/mount.js';
import { mountTabBar } from './tabs/mount.js';
import { mountSessionTree } from './sidebar/mount.js';
import { mountSearchResults } from './sidebar/search-mount.js';
import { mountPlansPane, mountMissionsPane, mountGitPane, mountSubsPane, mountFilesPane } from './panels/mount.js';
import { PRESETS } from './themes/presets.js';

/* E2E: o plugin do WebdriverIO só entra no bundle de teste (`--mode e2e`).
 * `__WDIO_E2E__` é definido pelo vite config; no vitest/produção fica false.
 * O coletor abaixo transforma erro silencioso de console em falha do smoke. */
if (typeof __WDIO_E2E__ !== 'undefined' && __WDIO_E2E__) {
  window.__e2eErrors = [];
  const push = (msg) => window.__e2eErrors.push(String(msg));
  window.addEventListener('error', (e) => push(e.message || e.error || 'error'));
  window.addEventListener('unhandledrejection', (e) => push('unhandledrejection: ' + (e.reason?.message || e.reason)));
  const origError = console.error.bind(console);
  console.error = (...args) => {
    push(args.map((a) => (a && a.message) || String(a)).join(' '));
    origError(...args);
  };
  import('@wdio/tauri-plugin');
}

/* Idioma: auto-detect via navigator.language, persistido em localStorage['lang']. */
setLang(getLangPref());

/* Tema por JSON: aplicado antes de qualquer render para o padrão não piscar na tela. */
bootTheme();

/* Zoom da UI: o webview não tem zoom de página, então escala o `body`.
   0.6–2.0, passo 0.1, persistido no localStorage. Devolve o valor aplicado. */
let zoom = 1;
try { zoom = +localStorage.getItem('zoom') || 1; } catch { /* sem storage */ }
export function setZoom(z) {
  zoom = Math.min(2, Math.max(0.6, Math.round(z * 100) / 100));
  document.body.style.zoom = zoom;
  try { localStorage.setItem('zoom', zoom); } catch { /* sem storage */ }
  return zoom;
}
setZoom(zoom);
$('zoomin').onclick = () => setZoom(zoom + 0.1);
$('zoomout').onclick = () => setZoom(zoom - 0.1);

/* Esc interrompe o turno da aba atual. Registrado no topo de propósito: os outros
   handlers de Esc (paleta, model-pop, imagens) fecham overlays sem `preventDefault`
   e rodariam depois — assim a checagem enxerga o overlay ainda aberto e um Esc de
   "fechar" nunca aborta turno. Vale com o foco no composer/busca (é de lá que o
   usuário vê o turno rodando); só o terminal embutido consome o Esc (ex.: vim). */
/* Decisão pura do atalho Esc: aborta quando o turno trabalha, sem overlay aberto,
   sem foco no terminal embutido e sem foco em campo de busca/filtro — nesses
   campos o Esc não deve derrubar o turno por acidente. O composer (`#input`) e o
   próprio terminal são exceção: é de lá que se interrompe de propósito. */
export function shouldAbortOnEsc({ overlayOpen, inTerminal, inOtherField, working }) {
  return !overlayOpen && !inTerminal && !inOtherField && !!working;
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  // Modal de configurações: Esc fecha (o overlay antigo não tinha esse caminho).
  const modal = $('settings');
  if (modal && !modal.classList.contains('hidden')) {
    modal.classList.add('hidden');
    return;
  }
  const overlayOpen = !!document.querySelector('.overlay:not(.hidden),.confirm-bar:not(.hidden),.palette:not(.hidden),.model-pop:not(.hidden),.img-view:not(.hidden)');
  const ae = document.activeElement;
  const inTerminal = !!(ae && ae.closest && ae.closest('#termdock'));
  // Busca/filtro (INPUT) e textareas que não são o composer: Esc é do campo, não do turno.
  const inOtherField = !!(ae && !inTerminal && (ae.tagName === 'INPUT'
    || (ae.tagName === 'TEXTAREA' && ae.id !== 'input')));
  const t = tabs.find(x => current && x.key === current.key);
  if (shouldAbortOnEsc({ overlayOpen, inTerminal, inOtherField, working: !!(t && t.working) })) abortTurn();
});

let current = null;
let seq = 0;
let stream = null;            // { node, text }
let pendingRender = 0;
let homeDir = null;
let sessionState = null;
let compactBusy = false;      // compactação manual em voo (evita duplo clique)
let compactReserve = null;    // reserva escolhida para o modelo atual (null = padrão do pi)
let allModels = [];
let modelsByProvider = new Map();
let levelList = [];
/* Modelos favoritos: ficam no topo da lista e persistem em localStorage. */
let modelFavs = new Set();
function loadModelFavs() {
  try {
    const raw = JSON.parse(localStorage.getItem('model-favs') || '[]');
    modelFavs = new Set(Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : []);
  } catch { modelFavs = new Set(); }
}
function saveModelFavs() {
  try { localStorage.setItem('model-favs', JSON.stringify([...modelFavs])); } catch { /* sem storage */ }
}
let debugEnabled = false;
let tabs = [];
/* Pops do composer em Svelte (Fase 2): instâncias montadas ou null (fallback legado). */
let modelPop = null, ctxPop = null, forkPop = null;
/* Anexos do composer em Svelte (Fase 5a): instância montada ou null (fallback). */
let attachmentsPane = null;
/* Palette de comandos em Svelte (Fase 5b): instância montada ou null (fallback). */
let palettePane = null;
/* Palette global Ctrl+K em Svelte (Fase 5c): instância montada ou null (fallback). */
let cmdkPane = null;
/* Indicador de digitação em Svelte (Fase 5d): instância + estado canônico. */
let typingPane = null;
let typingOn = false;
let typingLabel = '';
/* Grupos crus do cmdk (labels + rows) para o snapshot do componente. */
let cmdkGroups = [];
/* Barra de abas em Svelte (Fase 3): instância montada ou null (fallback legado). */
let tabBar = null;
/* Árvore de sessões em Svelte (Fase 3b): grupos crus para os callbacks + instância. */
let sessionGroups = [];
let sessionTree = null;
/* Erro transitório de `loadChildren` exibido pelo painel (substitui o setEmpty legado). */
let subsError = '';
/* Erro transitório de `loadSessions` exibido pela árvore (substitui o setEmpty legado). */
let treeError = '';
/* Resultados da busca global em Svelte (Fase 3c): itens acumulados + instância. */
let searchItems = [];
let searchTotal = 0;
let searchResults = null;
/* Painel Plano em Svelte (Fase 4a): instância montada ou null (fallback legado). */
let plansPane = null;
/* Painel Missões em Svelte (Fase 4b): instância montada ou null (fallback legado). */
let missionsPane = null;
/* Painel Git em Svelte (Fase 4c): instância montada ou null (fallback legado). */
let gitPane = null;
/* Painel Subagents em Svelte (Fase 4d): instância montada ou null (fallback legado). */
let subsPane = null;
/* Título canônico por sessão (lido do .jsonl por loadSessions) — a aba mostra isso,
   não a data/hora do id. */
let sessionTitles = new Map();
/* Imagens coladas no composer, aguardando envio (base64 + mimeType). */
let pendingImages = [];
let activeTab = null;
/* Geração da view: cada troca de sessão incrementa. Leitura assíncrona que resolve
   depois da troca (histórico, "carregar anteriores", children) não pode mais pintar
   no #log nem reabrir a barra de paginação na sessão nova (bug 2026-11-15). */
let viewSeq = 0;

let statsNoteRequested = false;

function setEmptyState(on, kind) {
  const el0 = $('emptystate');
  if (!el0) return;
  el0.classList.toggle('hidden', !on);
  const sub = el0.querySelector('.es-sub');
  if (sub) {
    if (kind === 'newsession') {
      sub.textContent = t('empty.new_session');
    } else if (kind === 'nosession') {
      clear(sub);
      sub.append(t('empty.no_session_a'));
      sub.append(el('br'));
      sub.append(t('empty.no_session_b'));
      const b = el('b', null, t('empty.plus_new'));
      sub.append(b, ' / ');
      sub.append(el('b', null, '+'));
      sub.append(t('empty.no_session_c'));
    }
  }
}

/** Mostra/esconde o indicador de atividade do turno. */
/** Snapshot puro do indicador de digitação (Svelte + testes). */
export function typingSnapshot(on, label) {
  return { visible: !!on, label: label || t('status.thinking') };
}

export function setTyping(on, label) {
  const box = $('typing');
  if (!box) return;
  box.classList.toggle('hidden', !on);
  typingOn = !!on;
  if (label) typingLabel = label;
  if (typingPane) typingPane.sync();
}

/** Botão de parar do composer: aparece só com turno rodando.
    O `#send` fica SEMPRE habilitado de propósito — com turno rodando ele enfileira
    (`streamingBehavior: steer`) e a fila é recurso pedido (`#unque` devolve as
    mensagens ao composer); só o `title` muda para dizer que é enfileiramento. */
export function syncStopButton(working) {
  const stop = $('stopbtn');
  if (stop) stop.classList.toggle('hidden', !working);
  const send = $('send');
  if (send) send.title = working ? t('composer.enqueue') : t('composer.send');
  return !!working;
}

/**
 * Turno em andamento é estado da ABA, não da janela: sem isso o "enviado…/pensando…"
 * da aba anterior continuava na tela depois de trocar (inclusive em sessão nova vazia).
 */
function setTurn(sessionId, working, phase) {
  const t = tabs.find(x => x.key === sessionId);
  if (t) {
    const changed = !!t.working !== !!working;
    t.working = working;
    t.phase = working ? (phase || t.phase || 'pensando…') : '';
    // Turno que começa zera o silêncio: o vigia conta a partir daqui, não do último
    // evento antigo da sessão (senão sondaria o turno recém-enviado).
    if (changed && working) t.lastEventAt = Date.now();
    // Só redesenha na transição: text_delta chega a cada token.
    if (changed) renderTabs();
  }
  // Turno da aba em foco começou: liga o poll de stats (tokens/tempo reais).
  if (working && current && current.key === sessionId) ensureStatsPoll();
  if (current && current.key === sessionId) {
    setTyping(working, (t && t.phase) || phase || 'pensando…');
    // Mesmo caminho do indicador: o botão de parar segue o turno da aba em foco.
    syncStopButton(!!working);
    if (working) { setStatus('trabalhando'); setState('busy'); }
  }
}

/* =============== vigia do turno fantasma =============== */
/* `agent_settled` é o único sinal de fim de turno. Quando ele se perde (processo morto
   sem exit, filho trocado, sessão aberta em duas instâncias) a aba fica "trabalhando"
   para sempre: spinner girando e Esc sem efeito. O vigia pergunta o estado real ao pi
   e destrava a aba quando ele confirma que já não há turno rodando. */
const TURN_SILENCE_MS = 45000; // silêncio por aba que dispara a sonda
const TURN_PROBE_MS = 30000;   // intervalo mínimo entre sondas da mesma aba
const PROBE_PREFIX = 'probe:';
/* Última sonda por aba (transiente: não vai para o saveTabs). */
const lastProbeAt = {};

/** Predicado puro do vigia: só sonda aba trabalhando, silenciosa e fora do intervalo. */
export function shouldProbeTurn({ working, lastEventAt, now, silenceMs, lastProbeAt: probeAt, probeIntervalMs }) {
  if (!working) return false;
  if (now - (lastEventAt || 0) <= silenceMs) return false;
  return now - (probeAt || 0) >= probeIntervalMs;
}

/** Turno fantasma: zera o indicador, descarta o parcial e realinha com o disco. */
function settleGhostTurn(key, why) {
  const t = tabs.find(x => x.key === key);
  setTurn(key, false);
  delete lastProbeAt[key];
  if (t) { t.streamText = ''; t.thinkText = ''; t.queue = []; saveTabs(); }
  renderTabs();
  if (!current || current.key !== key) return;
  flushStream();
  stream = null;
  setTyping(false);
  setStatus(why);
  setState('ready');
  // O parcial do turno morto nunca foi para o disco: repinta o que o pi persistiu.
  if (t && t.file) loadHistoryFromDisk(t.file);
  else sendCommand({ type: 'get_messages' });
  loadGit(); loadEdits();
  note(why);
}

/** Resposta da sonda: só destrava quando o pi confirma que não há turno rodando. */
function reconcileTurn(key, rec) {
  const t = tabs.find(x => x.key === key);
  // Turno já encerrou por outro caminho (agent_settled/exit) ou a aba sumiu.
  if (!t || !t.working) return;
  const d = (rec && rec.data) || {};
  // Ainda rodando: nada a fazer. A própria linha da sonda já renovou o silêncio.
  if (rec && rec.success && (d.isStreaming || d.isCompacting || d.pendingMessageCount)) return;
  settleGhostTurn(key, rec && rec.success
    ? 'turno encerrado sem aviso do pi — indicador destravado'
    : 'o pi não respondeu ao estado do turno — indicador destravado');
}

function turnWatchdog() {
  const now = Date.now();
  for (const t of tabs) {
    // Aba sem processo vivo não tem turno para reconciliar (e some de `tabs` ao fechar).
    if (!t.connected) continue;
    const probe = shouldProbeTurn({
      working: !!t.working, lastEventAt: t.lastEventAt, now,
      silenceMs: TURN_SILENCE_MS, lastProbeAt: lastProbeAt[t.key], probeIntervalMs: TURN_PROBE_MS,
    });
    if (!probe) continue;
    lastProbeAt[t.key] = now;
    // `probe:<key>` não colide com id de RPC normal e identifica a aba na resposta.
    inv('rpc_command', { sessionId: t.key, payload: JSON.stringify({ id: PROBE_PREFIX + t.key, type: 'get_state' }) })
      // Sonda recusada = slot do processo morreu; também não há turno rodando.
      .catch(() => reconcileTurn(t.key, null));
  }
}
setInterval(turnWatchdog, 5000);

/** Último aviso por sessão: turnos curtos em sequência não podem empilhar som/popup. */
const lastNotifyAt = {};

/** Toque curto (WebAudio): o turno de outra aba terminou. */
function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    const t0 = ctx.currentTime;
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    o.start(t0); o.stop(t0 + 0.4);
    o.onended = () => ctx.close().catch(() => {});
  } catch { /* sem áudio */ }
}

/**
 * Turno de aba em 2º plano terminou: avisa (popup + som) uma vez por janela.
 * Só dispara quando a sessão que assentou NÃO é a atual E a aba estava trabalhando.
 */
function maybeNotifyDone(sessionId) {
  if (!uiSettings.notifyDesktop && !uiSettings.notifySound) return;
  if (current && sessionId === current.key) return;
  const t = tabs.find(x => x.key === sessionId);
  if (!t || !t.working) return;
  const now = Date.now();
  if (now - (lastNotifyAt[sessionId] || 0) < 4000) return;
  lastNotifyAt[sessionId] = now;
  if (uiSettings.notifySound) beep();
  if (uiSettings.notifyDesktop && window.Notification && Notification.permission === 'granted') {
    try { new Notification('sightdeck: turno pronto', { body: t.label || sessionId }); } catch { /* negado */ }
  }
}

/** Reaplica o indicador do turno da aba que acabou de ficar ativa. */
function applyTurnUi() {
  const t = current ? tabs.find(x => x.key === current.key) : null;
  const on = !!(t && t.working);
  setTyping(on, (t && t.phase) || 'pensando…');
  syncStopButton(on);
  renderHealthChip();
  if (on) { setStatus('trabalhando'); setState('busy'); }
}
function setStatus(t) { $('status').textContent = stripAnsi(t); }

function setState(kind) {
  const dot = $('statedot');
  if (dot) dot.className = 'dot ' + kind;
}

function debugNote(msg) {
  if (!debugEnabled) return;
  inv('debug_note', { msg }).catch(() => {});
}

function showFatal(msg) {
  let bar = document.getElementById('fatal');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fatal';
    bar.className = 'fatal';
    document.body.appendChild(bar);
  }
  bar.textContent = String(msg);
}

window.addEventListener('error', (e) => showFatal('JS: ' + (e.message || 'erro')));
window.addEventListener('unhandledrejection', (e) =>
  showFatal('promise: ' + ((e.reason && e.reason.message) || e.reason)));

function prettyId(stem) {
  const m = stem.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-\d{2}-\d{3}Z[_-]?(.*)$/);
  if (!m) return stem;
  const [, , mo, d, h, mi, rest] = m;
  return `${d}/${mo} ${h}:${mi}${rest ? ' · ' + rest.slice(0, 14) : ''}`;
}

/** Nome do projeto da aba, mesma convenção da sidebar (`cwd` sem o último segmento). */
function projectName(cwd) {
  if (!cwd) return '';
  if (homeDir && cwd === homeDir) return '~';
  const name = String(cwd).replace(/\/+$/, '').split('/').pop();
  return name || cwd;
}

/* =============== sidebar =============== */
/* =============== árvore de projetos =============== */
let collapsedProjects = new Set();
let hiddenProjects = new Set();
/* Projetos com a lista completa liberada ("carregar mais"). */
let expandedProjects = new Set();
const SESS_PAGE = 8;

/** Opções do snapshot da árvore (estado de UI persistido). */
function treeOpts() {
  return { collapsed: collapsedProjects, expanded: expandedProjects, hidden: hiddenProjects, homeDir, error: treeError };
}

/** Snapshot puro da árvore de sessões (Svelte + testes). */
export function sessionsSnapshot(groups, opts) {
  const o = opts || {};
  if (o.error) return { emptyLabel: String(o.error), groups: [] };
  const collapsed = o.collapsed || new Set();
  const expanded = o.expanded || new Set();
  const hidden = o.hidden || new Set();
  const page = o.page || SESS_PAGE;
  return {
    emptyLabel: t('sidebar.no_sessions'),
    groups: (groups || []).map(g => {
      const isCollapsed = collapsed.has(g.path);
      const isHidden = hidden.has(g.path);
      const shown = expanded.has(g.path) ? g.sessions : g.sessions.slice(0, page);
      const hiddenCount = g.sessions.length - shown.length;
      const isHome = !!(o.homeDir && g.path === o.homeDir);
      return {
        path: g.path,
        collapsed: isCollapsed,
        caret: isCollapsed ? '▸' : '▾',
        name: isHome ? t('sidebar.no_project') : (g.name || g.path),
        count: g.sessions.length,
        hidden: isHidden,
        hideMark: isHidden ? '↺' : '⊘',
        hideTitle: isHidden ? t('proj.show') : t('proj.hide'),
        newTitle: t('proj.new_here', { path: g.path }),
        hiddenCount,
        moreLabel: hiddenCount > 0 ? t('sidebar.load_more', { n: hiddenCount }) : '',
        rows: shown.map(s => ({
          key: s.id,
          title: s.title || t('sidebar.untitled'),
          titleAttr: (s.title || s.id) + '\n' + s.id,
          meta: prettyId(s.id),
          children: s.children || 0,
          childrenTitle: t('sess.badge_runs'),
          trashTitle: t('sess.trash'),
        })),
      };
    }),
  };
}

function loadTreeState() {
  try {
    collapsedProjects = new Set(JSON.parse(localStorage.getItem('collapsed-projects') || '[]'));
    hiddenProjects = new Set(JSON.parse(localStorage.getItem('hidden-projects') || '[]'));
    expandedProjects = new Set(JSON.parse(localStorage.getItem('expanded-projects') || '[]'));
  } catch { /* defaults */ }
}

function saveTreeState() {
  try {
    localStorage.setItem('collapsed-projects', JSON.stringify([...collapsedProjects]));
    localStorage.setItem('hidden-projects', JSON.stringify([...hiddenProjects]));
    localStorage.setItem('expanded-projects', JSON.stringify([...expandedProjects]));
  } catch { /* sem storage */ }
}

/* Excluir sessão = mover para <projeto>/.sightdeck-trash/ (nunca apaga). */
function askDeleteSession(s) {
  confirmRun('mover para lixeira: ' + s.file, async () => {
    if (current && current.key === s.id) { try { await closeTab(s.id); } catch { /* já fechada */ } }
    try {
      const out = await inv('delete_session', { file: s.file });
      setStatus(String(out));
      await loadSessions();
    } catch (e) {
      setStatus('erro: ' + e);
    }
  });
}

async function addProject() {
  let path = '';
  // O seletor nativo pode abrir atrás de outra janela: avisa para procurá-lo.
  setStatus('seletor de pasta aberto — procure a janela de arquivos…');
  try {
    path = String(await inv('pick_directory')).trim();
  } catch (e) {
    if (!String(e).includes('cancelado')) setStatus(String(e));
    else setStatus('pronto');
    return;
  }
  if (!path) return;

  // Projeto escolhido: abre já expandido quando a lista recarregar.
  collapsedProjects.delete(path);
  hiddenProjects.delete(path);
  saveTreeState();

  await newSessionIn(path);
  setTimeout(() => loadSessions(), 1200);
}

function newSessionIn(cwd) {
  const key = 'ui-' + Date.now().toString(36);
  return start(cwd, key, key, '--session-id', null);
}

async function loadSessions() {
  try {
    const groups = JSON.parse(await inv('list_sessions'));
    // Projeto aberto agora (ex.: + Pasta) ainda não tem .jsonl — o pi só grava na
    // primeira mensagem. Sem isto o projeto não entra na lista e parece que falhou.
    for (const t of tabs) {
      if (!t.cwd || groups.some(g => g.path === t.cwd)) continue;
      groups.push({ path: t.cwd, name: t.cwd.split('/').pop() || t.cwd, sessions: [] });
    }
    const visible = groups.filter(g => !hiddenProjects.has(g.path) || uiSettings.showHidden);
    sessionGroups = visible;
    if (!visible.length) {
      treeError = '';
      if (sessionTree) sessionTree.sync();
      return;
    }

    // Títulos ficam em cache: a aba aberta mostra o mesmo nome da lista.
    let titlesChanged = false;
    for (const g of visible) {
      for (const s of g.sessions) {
        if (s.title) sessionTitles.set(s.id, s.title);
        const tab = tabs.find(t => t.key === s.id);
        if (tab && s.title && tab.label !== s.title) { tab.label = s.title; titlesChanged = true; }
      }
    }
    if (titlesChanged) renderTabs();

    const treeInit = localStorage.getItem('collapsed-initialized');
    if (treeInit === null) {
      for (const g of visible) collapsedProjects.add(g.path);
      saveTreeState();
      try { localStorage.setItem('collapsed-initialized', '1'); } catch { /* sem storage */ }
    }

    treeError = '';
    if (sessionTree) sessionTree.sync();
  } catch (e) {
    treeError = String(e);
    if (sessionTree) sessionTree.sync();
  }
}

/* =============== busca global nas sessões =============== */
let searchTimer = 0;
let searchOffset = 0;
const SEARCH_PAGE = 20;

function searchActive() {
  const q = ($('sesssearch') && $('sesssearch').value || '').trim();
  const t = ($('toolfilter') && $('toolfilter').value || '').trim();
  const e = !!($('erronly') && $('erronly').checked);
  return q !== '' || t !== '' || e;
}

function setSearchMeta(t) {
  const m = $('searchmeta');
  clear(m);
  m.appendChild(el('span', null, t));
}

/** Snapshot puro dos resultados da busca global (Svelte + testes). */
export function searchSnapshot(items, opts) {
  const o = opts || {};
  const list = items || [];
  const total = Number(o.total) || 0;
  const offset = Number(o.offset) || 0;
  return {
    rows: list.map(r => ({
      key: r.id,
      title: r.title || t('sidebar.untitled'),
      titleAttr: (r.title || r.id) + '\n' + r.file,
      snippet: r.snippet || '',
      meta: t('search.matches', { id: prettyId(r.id), n: r.matches }),
      tools: (r.tools || []).slice(0, 3).join(','),
      hasError: !!r.hasError,
      errorLabel: t('sidebar.error_badge'),
    })),
    showMore: offset < total,
    moreLabel: offset < total ? t('sidebar.show_more', { n: total - offset }) : '',
    empty: !list.length,
    emptyLabel: t('search.none'),
  };
}

function scheduleSearch() {
  // Filtros aparecem ao focar/digitar; sem critério a árvore normal volta.
  const on = searchActive();
  const focused = document.activeElement === $('sesssearch');
  $('searchfilters').classList.toggle('hidden', !on && !focused);
  $('searchresults').classList.toggle('hidden', !on);
  $('searchmeta').classList.toggle('hidden', !on);
  if (!on) { loadSessions(); return; }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(false), 300);
}

async function runSearch(append) {
  const query = $('sesssearch').value || '';
  const tool = $('toolfilter').value || '';
  const errorsOnly = !!$('erronly').checked;
  if (!append) searchOffset = 0;
  setSearchMeta('buscando…');
  try {
    const raw = await inv('search_sessions', { query, tool, errorsOnly, limit: SEARCH_PAGE, offset: searchOffset });
    const res = JSON.parse(raw);
    const items = (res && res.results) || [];
    if (!append) searchItems = [];
    searchItems.push(...items);
    searchOffset += items.length;
    const total = (res && res.total) || 0;
    searchTotal = total;
    const cov = res && res.files ? t('search.coverage', { n: res.scannedFiles || 0, m: res.files }) : '';
    setSearchMeta(t('search.total', { n: total }) + (res && res.truncated ? ' · ' + t('search.capped') : '') + (cov ? ' · ' + cov : '') + (searchOffset < total ? ' · ' + t('search.showing', { n: searchOffset }) : ''));
    if (searchResults) searchResults.sync();
  } catch (e) {
    setSearchMeta(String(e));
  }
}

function clearSearch() {
  $('sesssearch').value = '';
  $('toolfilter').value = '';
  $('erronly').checked = false;
  scheduleSearch();
}

/* =============== sessão =============== */
async function start(cwd, key, refValue, refFlag, childrenDir) {
  // Nova sessão / troca: zera paginação e esconde a barra herdada da sessão anterior.
  resetPaged();

  // Click na sessão já aberta: recarrega o histórico em vez de ignorar.
  if (current && current.key === key) {
    if (refFlag !== '--session-id' && refValue) await loadHistoryFromDisk(refValue);
    if (await ensureRpc()) sendCommand({ type: 'get_messages' });
    return;
  }
  // Sim, encerra a sessão anterior — mas nunca no meio de um turno e sempre limpando
  // o estado (senão a aba fica "connected" apontando para um processo morto).
  if (current) {
    const prev = tabs.find(x => x.key === current.key);
    if (!(prev && prev.working)) {
      try { await inv('stop_session', { sessionId: current.key }); } catch { /* já parado */ }
      stopLive(current.key);
    }
  }
  stashDraft();
  viewSeq++;
  current = { key, cwd, childrenDir, refValue, refFlag: refFlag || '--session' };
  reconcileTerminal();  // terminal aberto herda a pasta da sessão
  cards.clear();
  pendingPromptRows.clear();
  lastSnap = null;
  lastDiskList = null;
  resetFiles();
  stream = null;
  sessionState = null;
  // Sessão nova não tem cache: zera a lista para não mostrar o thinking do modelo anterior.
  levelList = [];
  fillLevels([]);
  allModels = [];
  clear($('log'));
  setTyping(false);
  restoreDraft(tabs.find(t => t.key === key) || null);
  // `+`, `+ Nova` e `+ Pasta` abrem sessão sem histórico; a overlay de estado
  // vazio é opaca e cobre o #log, então sem isto a sessão nova parece não ter aberto.
  setEmptyState(false);
  if (subsPane) subsPane.sync();
  setStatus('iniciando… ' + prettyId(key));

  // Histórico vem do disco primeiro: não depende do RPC responder.
  if (refFlag !== '--session-id' && refValue) await loadHistoryFromDisk(refValue);

  try {
    await inv('start_session', { sessionId: key, cwd, refFlag: refFlag || '--session', refValue });
    // O processo já existe: registra aba e fila do LRU mesmo que a view tenha mudado,
    // senão ele fica órfão (sem ✕, fora da evicção e contando no #procinfo até fechar).
    if (!tabs.find(t => t.key === key)) {
      tabs.push({
        key, cwd, childrenDir, refValue,
        refFlag: refFlag || '--session',
        file: (refFlag || '--session') === '--session' ? refValue : null,
        label: sessionTitles.get(key) || '',
      });
    }
    const tab = tabs.find(t => t.key === key);
    if (tab) tab.connected = true;
    if (!liveOrder.includes(key)) liveOrder.push(key);
    updateProcCount();
    renderTabs();
    // Outra sessão assumiu a view enquanto o processo subia: não rouba a aba de volta.
    if (!current || current.key !== key) return;
    setStatus('conectado · ' + prettyId(key));
    setState('ready');
    current.connected = true;
    activeTab = tab || null;
    if (childrenDir) await loadChildren(childrenDir);
    // Sessão nova só ganha `.jsonl` na 1ª mensagem: o get_state traz `sessionFile`,
    // sem o qual "carregar anteriores" e a aba Arquivos ficam sem caminho no disco.
    sendCommand({ type: 'get_state' });
    loadGit(); loadEdits(); loadPlans();
  } catch (e) {
    // Erro de outra sessão não aparece no transcript da atual.
    if (!current || current.key !== key) return;
    setStatus('erro');
    $('log').appendChild(el('div', 'note', String(e)));
  }
}

/* Abrir sessão = leitura. Nenhum processo `pi` nasce aqui. */
async function openSession(cwd, s) {
  document.querySelectorAll('.sess').forEach(n => n.classList.toggle('active', n.dataset.key === s.id));

  if (current && current.key === s.id) {
    await loadHistoryFromDisk(s.file);
    return;
  }

  stashDraft();
  viewSeq++;
  resetPaged();
  current = {
    key: s.id, cwd,
    childrenDir: s.file.replace(/\.jsonl$/, ''),
    refValue: s.file, refFlag: '--session',
    file: s.file, connected: false,
  };
  cards.clear();
  pendingPromptRows.clear();
  lastSnap = null;
  lastDiskList = null;
  resetFiles();
  stream = null;
  sessionState = null;
  // openSession é só leitura: zera a lista para não herdar o thinking da view anterior.
  levelList = [];
  fillLevels([]);
  clear($('log'));
  setEmptyState(false);
  setTyping(false);
  setStatus('somente leitura');
  setState('off');

  const existing = tabs.find(t => t.key === s.id);
  if (!existing) {
    tabs.push({ key: s.id, cwd, childrenDir: current.childrenDir, refValue: s.file, refFlag: '--session', file: s.file, connected: false, label: s.title || '' });
  } else {
    existing.file = s.file;
    existing.childrenDir = current.childrenDir;
    if (s.title) existing.label = s.title;
  }
  activeTab = tabs.find(t => t.key === s.id) || null;
  if (activeTab && Array.isArray(activeTab.levelList) && activeTab.levelList.length) fillLevels(activeTab.levelList.slice());
  if (activeTab && activeTab.model) { sessionState = { model: activeTab.model, thinkingLevel: activeTab.thinkingLevel || null }; updateModelButton(activeTab.model); }
  restoreDraft(activeTab);
  renderTabs();

  await loadHistoryFromDisk(s.file);

  // Modelo do histórico (sem RPC) + catálogo em cache para o seletor já nascer preenchido.
  if (!modelsByProvider.size) loadCachedModels();
  try {
    const parsed = JSON.parse(String(await inv('session_model', { path: s.file })));
    if (current && current.key !== s.id) return; // trocou de sessão durante a leitura
    if (parsed && parsed.id) {
      const full = allModels.find(m => m.id === parsed.id) || parsed;
      sessionState = { ...(sessionState || {}), model: { ...full, provider: parsed.provider || full.provider } };
      updateModelButton(sessionState.model);
    }
  } catch { /* sessão sem model_change */ }

  await loadChildren(current.childrenDir);

  // Conecta já na abertura: contexto, thinking, modelo e comandos vêm do pi.
  await ensureRpc();
  checkAuth();
  loadGit(); loadEdits(); loadPlans();
}

/* Sobe o processo sob demanda, com teto de sessões vivas. */
const MAX_LIVE = 3;
let liveOrder = [];

async function ensureRpc() {
  if (!current) return false;
  if (current.connected) return true;
  const key = current.key;
  // Chave repetida (reconexão após processo morto) inflava a contagem e disparava
  // evicção de sessão viva com menos de MAX_LIVE processos de verdade.
  liveOrder = [...new Set(liveOrder)];

  // Encolhe até o teto. Vítima errada aqui mata turno em andamento de outra aba
  // (bug: mandar em A, mandar em B, A morre) — só sai aba ociosa e nunca a atual.
  while (liveOrder.length >= MAX_LIVE) {
    const victim = liveOrder.find(k => k !== key && !(tabs.find(t => t.key === k) || {}).working);
    if (!victim) break; // todas ocupadas: prefere exceder o teto a perder trabalho
    liveOrder = liveOrder.filter(k => k !== victim);
    try { await inv('stop_session', { sessionId: victim }); } catch { /* ja parado */ }
    const t = tabs.find(x => x.key === victim);
    if (t) t.connected = false;
    renderTabs();
  }

  const { cwd, refValue, refFlag, file } = current;
  // Processo é desta chave; se a view trocou no meio, o estado da sessão anterior
  // não pode ser anunciado como se fosse a atual.
  const isCurrent = () => !!current && current.key === key;
  try {
    await inv('start_session', {
      sessionId: key, cwd,
      refFlag: refFlag || '--session',
      refValue: refValue || file,
    });
  } catch (e) {
    if (isCurrent()) {
      setStatus('erro ao iniciar pi');
      $('log').appendChild(el('div', 'row note', String(e)));
    }
    return false;
  }

  if (isCurrent()) current.connected = true;
  const tab = tabs.find(t => t.key === key);
  if (tab) tab.connected = true;
  // Dedupe: chave remanescente de processo morto inflava a fila e disparava
  // evicção prematura de sessão viva.
  if (!liveOrder.includes(key)) liveOrder.push(key);
  updateProcCount();
  if (isCurrent()) {
    setStatus('conectado · ' + prettyId(key));
    setState('ready');
    // Processo novo: modelo/contexto/arquivo da sessão vêm daqui.
    sendCommand({ type: 'get_state' });
  }
  return true;
}

async function updateProcCount() {
  try {
    const list = await inv('running_sessions');
    $('procinfo').textContent = list && list.length ? list.length + ' pi' : '';
    $('procinfo').title = Array.isArray(list) ? list.join('\n') : '';
  } catch { /* ignora */ }
}

function stopLive(key) {
  liveOrder = liveOrder.filter(k => k !== key);
  const t = tabs.find(x => x.key === key);
  if (t) t.connected = false;
  setTurn(key, false);
  updateProcCount();
}

/* =============== envio =============== */

/** `send_prompt`, com uma reconexão: o stdin do filho pode ter morrido entre o
 *  connect e este envio (o pi morreu, o Rust liberou o slot). Como o write falhou,
 *  a mensagem não saiu: sobe um processo novo e reenvia uma única vez. */
async function sendPromptWithRetry(key, payload) {
  try {
    await inv('send_prompt', payload);
  } catch (e) {
    if (!/processo do pi encerrou|nao iniciada/.test(String(e))) throw e;
    const t = tabs.find(x => x.key === key);
    if (t) t.connected = false;
    const isCurrent = () => !!current && current.key === key;
    if (isCurrent()) current.connected = false;
    // `ensureRpc` sobe o processo da view atual: só serve se ainda é esta aba.
    if (!isCurrent() || !(await ensureRpc())) throw e;
    await inv('send_prompt', payload);
  }
}

async function send() {
  const typed = $('input').value.trim();
  const hasImages = pendingImages.length > 0;
  if ((!typed && !hasImages) || !current) return;
  // Permissão de notificação se pede no gesto (popup exige interação prévia).
  if (window.Notification && Notification.permission === 'default') {
    try { Promise.resolve(Notification.requestPermission()).catch(() => {}); } catch { /* ignora */ }
  }
  // Imagem sem texto é válida: o pi aceita prompt só com ImageContent.
  const message = typed || 'Segue imagem.';

  // Comando do app (/compact, /login, ...) roda aqui, sem ir para o modelo.
  const app = parseAppCommand(message);
  if (app) {
    $('input').value = '';
    autosizeInput();
    hidePalette();
    $('log').appendChild(el('div', 'row user', '▸ ' + message));
    scrollBottom(true);
    // Comando que fala com o pi precisa do processo vivo (sessão pode estar em leitura).
    if (app.cmd.needsRpc && !(await ensureRpc())) {
      note('não consegui conectar ao pi para rodar /' + app.cmd.name);
      return;
    }
    pushRecent('/' + app.cmd.name + (app.args ? ' ' + app.args : ''));
    app.cmd.run(app.args);
    return;
  }

  if (!(await ensureRpc())) return;

  $('input').value = '';
  autosizeInput();
  // Rascunho da aba zera junto: senão trocar de aba e voltar ressuscita o texto enviado.
  const tab = tabs.find(t => t.key === current.key);
  const wasWorking = !!(tab && tab.working);
  if (tab) { tab.draft = ''; tab.images = []; }
  // O RPC espera pares (base64, mimeType); capturar antes de limpar.
  const sentImages = pendingImages.slice();
  const images = sentImages.map(i => [i.data, i.mime]);
  pendingImages = [];
  renderAttachments();
  const id = 'ui-' + (++seq);
  const key = current.key;
  const urow = el('div', 'row user', '▸ ' + message);
  urow.dataset.text = message;
  // Posição cronológica da linha local: o log é reconstruído do disco a cada render,
  // então a reinserção devolve a linha ao lugar que ela ocupava (insertRowByAt).
  // `data-local` a exclui do `seen` do restore: sem isso ela se auto-invalidaria na
  // restauração seguinte (o próprio texto já estaria no log).
  const at = Date.now();
  urow.dataset.at = String(at);
  urow.dataset.local = '1';
  sentImages.forEach(img => urow.appendChild(thumb(img.dataUrl)));
  $('log').appendChild(urow);
  // A linha fica na aba (não só no Map global): trocar de aba não pode apagá-la
  // antes de o pi persistir a mensagem no .jsonl.
  const entry = { key, text: message, row: urow, state: 'pending', at };
  pendingPromptRows.set(id, entry);
  localRows(tab).push(entry);
  scrollBottom();
  try {
    // O Rust manda `streamingBehavior: "steer"`: com turno rodando o pi enfileira
    // (disposition "queued"), parado é ignorado e o turno começa.
    const payload = { sessionId: key, message, id, images };
    await sendPromptWithRetry(key, payload);
    // Resposta pode chegar depois de trocar de aba: o estado do turno é da chave
    // que enviou, nunca da sessão que está em foco agora.
    const isCurrent = () => !!current && current.key === key;
    if (isCurrent()) {
      setStatus('trabalhando');
      setState('busy');
    }
    // Mensagem enfileirada não reinicia o rótulo do turno que já está rodando.
    setTurn(key, true, wasWorking ? (tab && tab.phase) || 'pensando…' : 'enviado…');
    // Sessão nova ainda sem título: usa a 1ª mensagem (mesma regra do read_title no Rust).
    if (tab && !tab.label) {
      tab.label = message.split('\n')[0].replace(/`/g, '').trim().slice(0, 48);
      renderTabs();
    }
  } catch (e) {
    pendingPromptRows.delete(id);
    // Envio não chegou ao pi: a linha local sai do log (não foi mensagem) e o texto
    // volta ao composer da aba, senão o que foi digitado se perde.
    const list = localRows(tab);
    const li = list.indexOf(entry);
    if (li >= 0) list.splice(li, 1);
    urow.remove();
    if (tab) {
      tab.draft = tab.draft ? message + '\n' + tab.draft : message;
      tab.images = sentImages.concat(Array.isArray(tab.images) ? tab.images : []);
      saveTabs();
    }
    if (current && current.key === key) {
      const box = $('input');
      box.value = box.value.trim() ? message + '\n' + box.value : message;
      autosizeInput();
      pendingImages = sentImages.concat(pendingImages);
      renderAttachments();
      $('log').appendChild(el('div', 'row note', String(e)));
      scrollBottom(true);
    }
  }
}

/* =============== histórico =============== */
/* scrollBottom força layout (lê scrollHeight) e é chamado a cada delta de token.
   Coalescer no rAF derruba isso a um layout por frame. */
let scrollQueued = false;
function scrollBottomSoon() {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; scrollBottom(); });
}

/* Render em fatias: sessão longa (250 msgs) montava o log inteiro num tick e
   travava a janela. A cada RENDER_CHUNK linhas a main thread respira; se outra
   renderização começar no meio (troca de aba), esta aborta — o log já é dela. */
const RENDER_CHUNK = 25;
let renderToken = 0;

async function renderMessages(data, ctx, keepNote) {
  const target = (ctx && ctx.target) || $('log');
  // Renderizou no painel principal: não há mais "nenhuma sessão" a mostrar.
  if (target === $('log')) setEmptyState(false);
  const store = (ctx && ctx.store) || cards;
  const messages = (data && data.messages) || [];
  // Guarda a lista carregada da sessão atual para o inspetor de contexto.
  if (target === $('log')) lastMessages = messages;
  const note = keepNote ? target.querySelector('.row.note') : null;
  clear(target);
  // Rebuild do log principal: enquanto as fatias entram a janela mostraria o topo
  // do histórico e só no fim saltaria para o rodapé — é o "sobe e desce" da troca
  // de aba. O log fica preso no fim e escondido até a última fatia.
  const mainLog = target === $('log');
  if (mainLog) target.classList.add('rebuilding');
  if (note) target.appendChild(note);
  store.clear();
  if (!ctx) stream = null;
  const token = ++renderToken;
  // Ancora de fork por linha: índice/texto das user messages na ordem do transcript.
  let userIdx = -1;
  const userTexts = [];

  const paint = (m) => {
    if (!m || m.role === 'system') return;
    const blocks = Array.isArray(m.content) ? m.content : null;
    if (m.role === 'user') userIdx++;
    if (m.role === 'user' && userTexts.length <= userIdx) userTexts.push('');

    if (m.role === 'custom') {
      const node = el('div', 'row ext');
      node.appendChild(el('b', null, t('custom.label')));
      node.appendChild(el('span', null, ' ' + (m.customType || m.type || 'custom')));
      target.appendChild(node);
      return;
    }

    if (m.role === 'user') {
      const text = blocks
        ? blocks.filter(b => b && b.type === 'text').map(b => b.text).join('\n')
        : (typeof m.content === 'string' ? m.content : '');
      // Imagem enviada também aparece: sem isto o print some do transcript.
      const imgs = blocks ? blocks.filter(b => b && b.type === 'image' && b.data) : [];
      if (!text.trim() && !imgs.length) { userIdx--; userTexts.pop(); return; }
      const urow = el('div', 'row user', '▸ ' + text.trim());
      urow.dataset.text = text.trim();
      // Âncora do restore: uma linha local só volta antes da 1ª mensagem mais nova.
      if (Number.isFinite(m.timestamp)) urow.dataset.at = String(m.timestamp);
      userTexts[userIdx] = text.trim();
      // Só no log principal: no transcript de child o fork valeria para outra sessão.
      if (!ctx) urow.appendChild(forkRowBtn({ uindex: userIdx, utext: text.trim() }, t('fork.row_msg')));
      imgs.forEach(b => urow.appendChild(thumb('data:' + (b.mimeType || 'image/png') + ';base64,' + b.data)));
      target.appendChild(urow);
      return;
    }

    if (m.role === 'assistant') {
      if (!blocks) return;
      for (const b of blocks) {
        if (!b) continue;
        if (b.type === 'thinking' && b.thinking && b.thinking.trim()) {
          target.appendChild(thinkBlock(b.thinking.slice(0, 20000)));
        } else if (b.type === 'text' && b.text && b.text.trim()) {
          const row = mdRow();
          setMarkdown(row.body, b.text.trim());
          const speed = msgSpeed(m);
          if (speed) {
            const meta = el('div', 'msg-meta', speed);
            if (m.model) meta.title = String(m.model);
            row.root.appendChild(meta);
          }
          // Fork daqui: ancora na user message que provocou esta resposta.
          // Só no log principal (ver comentário na user row).
          if (!ctx) row.root.appendChild(forkRowBtn({ uindex: userIdx, utext: userTexts[userIdx] || '' }, t('fork.row_ans')));
          target.appendChild(row.root);
        } else if (b.type === 'toolCall') {
          card(b.id, b.name, b.arguments, { target, store }, m.timestamp);
        }
      }
      return;
    }

    if (m.role === 'toolResult') {
      const entry = store.get(m.toolCallId) || card(m.toolCallId, m.toolName, null, { target, store }, m.timestamp);
      entry.root.classList.add(m.isError ? 'err' : 'ok');
      entry.icon.textContent = m.isError ? '✕' : '✓';
      applyToolResult(entry, m);
      renderToolImages(entry, m);
      if (uiSettings.expandTools) entry.root.classList.remove('collapsed');
    }
  };

  // Offscreen (preview, child, loadEarlier) fica síncrono: quem chama lê o DOM
  // logo depois — `loadEarlier` move os childNodes de `tmp` para o log.
  const chunk = target === $('log') ? RENDER_CHUNK : messages.length + 1;
  for (let i = 0; i < messages.length; i += chunk) {
    const end = Math.min(i + chunk, messages.length);
    for (let j = i; j < end; j++) paint(messages[j]);
    if (end >= messages.length) break;
    // Outra renderização tomou o log: o que sobrar aqui não é mais desta sessão.
    if (token !== renderToken) return;
    await new Promise(r => setTimeout(r, 0));
    // Pinta a próxima fatia já ancorada no fim: sem isto a janela mostra o topo
    // do histórico e depois salta para o rodapé.
    if (mainLog) target.scrollTop = target.scrollHeight;
  }
  if (token !== renderToken) return;
  if (target === $('log')) { restoreLocalRows(); reattachStream(); }
  if (ctx) target.scrollTop = 0;
  else { scrollBottom(true); updateScrollBtn(); }
  if (mainLog) target.classList.remove('rebuilding');
}

/* =============== subagents: histórico do disco =============== */
function relTime(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

const CHILD_STATE = {
  done: ['concluído', 'chip-done'],
  running: ['rodando', 'state-running'],
  unfinished: ['interrompido', 'chip-unfinished'],
  unknown: ['?', 'chip-unknown'],
};

function renderChildren(list) {
  subsError = '';
  const next = Array.isArray(list) ? list : [];
  // Poll de 2 s durante o turno relê o disco: repintar sem mudança zera o scroll do
  // painel. `mtime` fica fora da chave (o filho escreve o tempo todo e o relógio do
  // disco nem é atualizado); `id|state` muda quando o run nasce, anda ou termina.
  const key = next.map(c => c.id + '|' + c.state).join(',');
  if (key === lastDiskKey && lastDiskList) return;
  lastDiskKey = key;
  lastDiskList = next;
  paintSubs();
}

/* =============== painel: arquivos editados + diffs =============== */
/* Sem aba própria: `session_edits` alimenta o diff do painel Git (clique numa row
   que esteja na lista abre o patch com "desfazer hunk"). */
let editedFiles = []; // último resultado de session_edits ({file, tool, at, src, patch})

/* =============== diagnóstico: log circular das linhas RPC =============== */
/* Buffer circular (máx 200) preenchido no listener `rpc-line` existente e no
   par sendCommand/handleResponse, sem mudar o roteamento. Cada linha guarda
   comando, latência e resultado; a aba Diagnóstico só renderiza este buffer. */
const DIAG_MAX = 200;
const diagBuf = []; // {t, cmd, lat, res} — ordem de chegada, as mais novas por último
const diagPending = new Map(); // rpc id -> Date.now() do envio (para a latência)

function diagPush(cmd, lat, res) {
  diagBuf.push({ t: Date.now(), cmd: String(cmd == null ? '' : cmd).slice(0, 220), lat: lat || '—', res: res || '' });
  if (diagBuf.length > DIAG_MAX) diagBuf.splice(0, diagBuf.length - DIAG_MAX);
  if ($('pane-debug') && !$('pane-debug').classList.contains('hidden')) renderDiag();
}

function renderDiag() {
  const host = $('diaglist');
  if (!host) return;
  const head = $('diaghead');
  if (head) head.textContent = t('diag.count', { n: diagBuf.length, max: DIAG_MAX });
  clear(host);
  if (!diagBuf.length) { host.appendChild(el('div', 'empty', t('panel.no_lines'))); return; }
  for (const e of diagBuf.slice().reverse()) {
    const row = el('div', 'file-row' + (String(e.res || '').startsWith('falhou') ? ' err' : ''));
    row.title = (e.cmd || '') + (e.res ? '\n' + e.res : '');
    row.appendChild(el('span', 'file-name', e.cmd || '—'));
    row.appendChild(el('span', 'file-dir', e.res || ''));
    row.appendChild(el('span', 'file-count', e.lat || '—'));
    host.appendChild(row);
  }
}

/* =============== painel direito: divisória arrastável =============== */
/* Sem abas comutáveis: subagents ficam em cima e o Git fixo embaixo. `--split`
   (no #rightpanel) é a altura da metade de baixo em % do painel; o clamp 20..80
   garante que nenhum dos dois lados desapareça. Um valor legado em
   localStorage['panel-pane'] é simplesmente ignorado. */
const SPLIT_DEFAULT = 50;
const SPLIT_MIN = 20;
const SPLIT_MAX = 80;

function setSplit(ratio, persist) {
  const pct = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Number(ratio) || SPLIT_DEFAULT));
  const host = $('rightpanel');
  if (host) host.style.setProperty('--split', pct + '%');
  if (persist) { try { localStorage.setItem('split-ratio', String(pct)); } catch { /* sem storage */ } }
  return pct;
}

function initSplit() {
  let saved = SPLIT_DEFAULT;
  try { saved = Number(localStorage.getItem('split-ratio')) || SPLIT_DEFAULT; } catch { /* sem storage */ }
  setSplit(saved, false);
  const grip = $('splitgrip');
  if (!grip) return;
  let dragging = false;
  grip.addEventListener('mousedown', (e) => {
    e.preventDefault(); // sem isto o arrasto vira seleção de texto
    dragging = true;
    document.body.style.cursor = 'row-resize';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const host = $('rightpanel');
    const box = host ? host.getBoundingClientRect() : null;
    if (!box || !box.height) return;
    // Altura da metade de baixo = distância da borda inferior do painel ao cursor.
    setSplit(((box.bottom - e.clientY) / box.height) * 100, false);
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    const host = $('rightpanel');
    setSplit(host ? parseFloat(host.style.getPropertyValue('--split')) : SPLIT_DEFAULT, true);
  });
}

/* =============== colunas laterais e largura do composer =============== */
/* Os dois grips verticais (`.col-grip`, dentro da `aside` e do `#rightpanel`) só
   capturam o ponteiro com Ctrl pressionado: `body.ctrl-held` liga o
   `pointer-events` deles no keydown. Sem Ctrl o clique atravessa para o conteúdo,
   então arrastar a borda não rouba clique de lista nem seleção de texto.
   As larguras ficam em px (não em %) para escalarem junto com o `zoom` do body;
   `usableWidth()` desconta o zoom ao comparar com a janela. */
const ASIDE_MIN = 180, ASIDE_MAX = 520;
const PANEL_MIN = 240, PANEL_MAX = 720;
const CENTER_MIN = 320;        // piso do composer/transcript entre as duas colunas
const COMPOSER_MIN = 520, COMPOSER_MAX = 1600, COMPOSER_DEFAULT = 820;
const COMPOSER_STEP = 40;      // px por passo de Ctrl+wheel sobre o composer
/* Partida do arrasto quando não há layout medido (primeira pintura, jsdom). */
const ASIDE_DEFAULT = 320, PANEL_DEFAULT = 340;

/** Clampa um número em [min, max]; valor não numérico cai no mínimo. */
export function clampWidth(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Colunas laterais sem espremer o centro: o excedente sobre `total - 320` sai das
    duas na proporção da folga de cada uma (quem está no teto não cede), e nenhuma
    desce do próprio piso. Se nem os pisos couberem, devolve os pisos. */
export function clampColumns(asidePx, panelPx, totalPx) {
  const aside = clampWidth(asidePx, ASIDE_MIN, ASIDE_MAX);
  const panel = clampWidth(panelPx, PANEL_MIN, PANEL_MAX);
  const total = Number(totalPx);
  if (!Number.isFinite(total) || total <= 0) return { aside, panel };
  const over = aside + panel + CENTER_MIN - total;
  if (over <= 0) return { aside, panel };
  const slackAside = aside - ASIDE_MIN;
  const slackPanel = panel - PANEL_MIN;
  const slack = slackAside + slackPanel;
  if (over >= slack) return { aside: ASIDE_MIN, panel: PANEL_MIN };
  return {
    aside: Math.floor(aside - over * (slackAside / slack)),
    panel: Math.floor(panel - over * (slackPanel / slack)),
  };
}

/** Fator do `zoom` aplicado no body (1 quando ausente/inválido). */
function zoomFactor() {
  const z = parseFloat(document.body.style.zoom);
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** Largura útil do layout em px de CSS (o zoom divide a janela). */
function usableWidth() {
  const vw = Number(window.innerWidth) || 0;
  return vw ? vw / zoomFactor() : 0;
}

/** Largura renderizada de uma coluna em px de CSS, já sem o zoom. */
function columnPx(id) {
  const node = $(id);
  const rect = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null;
  const w = rect ? rect.width : 0;
  return w > 0 ? w / zoomFactor() : 0;
}

let colWanted = null;   // px de CSS pedidos pelo usuário (null = % padrão do CSS)
let composerWidth = 0;  // 0 = max-width padrão do CSS

function applyColumns(persist) {
  if (!colWanted) {
    colWanted = { aside: columnPx('sidebar') || ASIDE_DEFAULT, panel: columnPx('rightpanel') || PANEL_DEFAULT };
  }
  const fit = clampColumns(colWanted.aside, colWanted.panel, usableWidth());
  document.body.style.setProperty('--w-aside', Math.round(fit.aside) + 'px');
  document.body.style.setProperty('--w-panel', Math.round(fit.panel) + 'px');
  if (persist) {
    try {
      localStorage.setItem('w-aside', String(Math.round(fit.aside)));
      localStorage.setItem('w-panel', String(Math.round(fit.panel)));
    } catch { /* sem storage */ }
  }
  return fit;
}

function setComposerWidth(px, persist) {
  composerWidth = clampWidth(px, COMPOSER_MIN, COMPOSER_MAX);
  document.body.style.setProperty('--composer-w', Math.round(composerWidth) + 'px');
  if (persist) {
    try { localStorage.setItem('composer-w', String(Math.round(composerWidth))); } catch { /* sem storage */ }
  }
  return composerWidth;
}

/** Base do primeiro wheel: largura atual do card, ou o padrão do CSS se o jsdom
    (sem layout) não a resolve. */
function composerBasePx(card) {
  if (composerWidth) return composerWidth;
  const w = card && window.getComputedStyle ? parseFloat(window.getComputedStyle(card).maxWidth) : NaN;
  return Number.isFinite(w) && w > 0 ? w : COMPOSER_DEFAULT;
}

function readSavedPx(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

/** Arrasto de uma borda. `side` diz qual var o movimento alimenta: a da esquerda
    cresce com o cursor (`x`), a da direita cresce ao contrário. */
function dragGrip(grip, side) {
  if (!grip) return;
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    if (!e.ctrlKey || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    if (grip.setPointerCapture) grip.setPointerCapture(e.pointerId);
    const base = colWanted || {
      aside: columnPx('sidebar') || ASIDE_DEFAULT,
      panel: columnPx('rightpanel') || PANEL_DEFAULT,
    };
    drag = { x: e.clientX, z: zoomFactor(), base: { aside: base.aside, panel: base.panel } };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const delta = (e.clientX - drag.x) / drag.z; // px de CSS: o body é escalado pelo zoom
    colWanted = side === 'aside'
      ? { aside: drag.base.aside + delta, panel: drag.base.panel }
      : { aside: drag.base.aside, panel: drag.base.panel - delta };
    applyColumns(false);
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    applyColumns(true);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

function initColumnResize() {
  // Boot: reaplica o salvo antes do primeiro render (sem salvar de novo).
  const aside = readSavedPx('w-aside');
  const panel = readSavedPx('w-panel');
  if (aside || panel) {
    colWanted = { aside: aside || ASIDE_DEFAULT, panel: panel || PANEL_DEFAULT };
    applyColumns(false);
  }
  const composer = readSavedPx('composer-w');
  if (composer) setComposerWidth(composer, false);

  dragGrip($('colgripaside'), 'aside');
  dragGrip($('colgrippanel'), 'panel');

  // Ctrl libera o `pointer-events` dos grips (CSS não lê modificador).
  const syncCtrl = (e) => document.body.classList.toggle('ctrl-held', !!e.ctrlKey);
  document.addEventListener('keydown', syncCtrl);
  document.addEventListener('keyup', syncCtrl);
  window.addEventListener('blur', () => document.body.classList.remove('ctrl-held'));

  // Ctrl+wheel sobre o composer muda a largura máxima do card; fora dele o wheel
  // é do conteúdo (transcript) e não é interceptado.
  const card = document.querySelector('.composer-card');
  if (card) {
    card.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const step = e.deltaY < 0 ? COMPOSER_STEP : -COMPOSER_STEP;
      setComposerWidth(composerBasePx(card) + step, true);
    }, { passive: false });
  }

  // Janela menor (ou zoom maior) pode espremer o centro: re-clampa o que foi fixado.
  window.addEventListener('resize', () => { if (colWanted) applyColumns(false); });
}

/** Lê as edições do disco (sessão + children). Só roda com o painel Git visível:
    é dele que sai o diff com "desfazer hunk" para o arquivo clicado. */
async function loadEdits() {
  const file = current && current.file;
  const seq = viewSeq;
  if (!file) { editedFiles = []; return; }
  try {
    const list = JSON.parse(String(await inv('session_edits', { path: file })));
    if (seq !== viewSeq) return; // trocou de sessão durante a leitura
    editedFiles = Array.isArray(list) ? list : [];
  } catch {
    if (seq !== viewSeq) return;
    editedFiles = [];
  }
}

/** "a/b/c.dart" -> ["c.dart", "a/b"] (aceita separador do Windows). */
function splitPath(p) {
  const s = String(p || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i < 0 ? [s, ''] : [s.slice(i + 1), s.slice(0, i)];
}

/** Mesmo arquivo depois de normalizar separador e `./` (cwd pode vir com `\\`). */
function samePath(a, b) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '');
  return norm(a) === norm(b);
}

/** Grupo de edições da sessão para um path do git. `session_edits` guarda o
    caminho absoluto; o status do git é relativo ao `cwd`. */
function sessionEditsFor(path) {
  const cwd = String((current && current.cwd) || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const abs = cwd ? cwd + '/' + String(path || '').replace(/\\/g, '/') : String(path || '');
  const items = editedFiles.filter((e) => e && e.file && (samePath(e.file, abs) || samePath(e.file, path)));
  if (!items.length) return null;
  return { file: items[0].file, items, at: Math.max(...items.map((e) => Number(e.at) || 0)) };
}

/** Clique na row: edição da sessão (com desfazer) ou patch do git (só leitura). */
function openGitDiff(path) {
  const g = sessionEditsFor(path);
  if (g) { openDiffs(g); return; }
  openWorktreeDiff(path);
}

/** Patch do worktree (`git_file_diff`) no MESMO painel de detalhe; `file` null
    desliga o botão "desfazer hunk" do `renderPatch`. */
async function openWorktreeDiff(path) {
  const host = $('detaillog');
  const [name, dir] = splitPath(path);
  $('detailtitle').textContent = name + (dir ? '  ·  ' + dir : '');
  clear(host);
  host.appendChild(el('div', 'history-head', 'git diff · somente leitura'));
  const box = el('div', 'diff');
  const body = el('div', 'diff-body');
  box.appendChild(body);
  host.appendChild(box);
  body.appendChild(el('div', 'empty', 'lendo diff…'));
  $('detail').classList.remove('hidden');
  const seq = viewSeq;
  let patch = '';
  try {
    patch = String(await inv('git_file_diff', { cwd: current && current.cwd, path }));
  } catch (e) {
    if (seq !== viewSeq) return;
    clear(body);
    body.appendChild(el('div', 'empty', 'git diff: ' + e));
    return;
  }
  if (seq !== viewSeq) return; // trocou de sessão durante a leitura
  clear(body);
  if (!patch.trim()) { body.appendChild(el('div', 'empty', t('tools.no_changes'))); return; }
  renderPatch(body, patch, null, path);
}

/** Viewer read-only de um arquivo do projeto (aba "Arquivos da pasta").
    O texto vem de `read_text_file`, que confina no `cwd` e corta em 256 KB;
    "abrir no editor" é o `open_file` (app padrão do sistema). Não edita. */
async function openFileViewer(path) {
  const host = $('detaillog');
  const [name, dir] = splitPath(path);
  $('detailtitle').textContent = name + (dir ? '  ·  ' + dir : '');
  clear(host);

  const bar = el('div', 'fileview-bar');
  const openBtn = el('button', 'ghost', t('files.open_editor'));
  openBtn.onclick = async () => {
    try { await inv('open_file', { cwd: current && current.cwd, path }); }
    catch (e) { note('abrir: ' + e); }
  };
  const copyBtn = el('button', 'ghost', t('files.copy_path'));
  copyBtn.onclick = () => copyText(copyBtn, path);
  bar.append(openBtn, copyBtn);
  host.appendChild(bar);

  const body = el('div', 'fileview-body md');
  body.textContent = t('files.loading');
  host.appendChild(body);
  $('detail').classList.remove('hidden');

  const kb = (n) => {
    const v = Number(n) || 0;
    return v >= 1024 * 1024 ? (v / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(v / 1024)) + ' KB';
  };
  const seq = viewSeq;
  let data;
  try {
    data = JSON.parse(String(await inv('read_text_file', { cwd: current && current.cwd, path })));
  } catch (e) {
    if (seq === viewSeq) body.textContent = 'ler ' + path + ': ' + e;
    return;
  }
  if (seq !== viewSeq) return; // trocou de sessão durante a leitura

  if (data.truncated) {
    host.insertBefore(el('div', 'history-head', t('files.truncated', { total: kb(data.bytes) })), body);
  }
  if (data.binary) { body.textContent = t('files.binary'); return; }

  const text = String(data.text || '');
  body.textContent = '';
  setMarkdown(body, text);
}

/** Abre o diff no mesmo painel de detalhe dos subagents. */
function openDiffs(g) {
  const host = $('detaillog');
  const [name, dir] = splitPath(g.file);
  $('detailtitle').textContent = name + (dir ? '  ·  ' + dir : '');
  clear(host);
  // Ações do arquivo (copiar caminho reusa o clipboard do sistema; abrir usa o app padrão).
  const actions = el('div');
  actions.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';
  const cp = el('button', 'tiny', 'copiar caminho');
  cp.onclick = () => copyText(cp, g.file);
  const op = el('button', 'tiny', 'abrir');
  op.onclick = async () => {
    try { await inv('open_file', { cwd: current && current.cwd, path: g.file }); }
    catch (e) { note('abrir: ' + e); }
  };
  actions.append(cp, op);
  host.appendChild(actions);
  // items já vem do mais novo para o mais antigo; inverte para ler a evolução.
  for (const e of g.items.slice().reverse()) {
    const box = el('div', 'diff');
    const head = el('div', 'diff-head');
    head.appendChild(el('span', 'tool-name', String(e.tool || 'edit')));
    head.appendChild(el('span', 'diff-file', String(e.src || '')));
    head.appendChild(el('span', 'tool-right', relTime(Number(e.at) || 0)));
    box.appendChild(head);
    const body = el('div', 'diff-body');
    renderPatch(body, e.patch, g.file);
    box.appendChild(body);
    host.appendChild(box);
  }
  $('detail').classList.remove('hidden');
}

/** Linhas com a coluna do diff (`+`, `-`, ` `): o código vem depois dela. */
const hasDiffPrefix = (cls, line) =>
  cls === 'diff-add' || cls === 'diff-del' || (cls === 'diff-ctx' && line[0] === ' ');

/* =============== vista do diff (unificada/split) =============== */

/** Re-renderiza todo diff vivo ao alternar a vista: painel de edições, git diff
    e cards de `edit`/`write` compartilham `.diff-body` + `node.diffArgs`. */
function refreshDiffs() {
  for (const node of document.querySelectorAll('.diff-body')) {
    const args = node.diffArgs;
    if (args) renderPatch(node, args.patch, args.file, args.langPath);
  }
}

function renderPatch(node, patch, file, langPath) {
  const text = String(patch || '');
  const lines = text.split('\n');
  clear(node);
  node.diffArgs = { patch, file, langPath };
  if (!text.trim()) {
    node.appendChild(el('div', 'diff-line diff-meta', t('tools.no_diff')));
    return;
  }
  const lang = langFor(langPath || file);
  const MAX = 1200;
  const truncated = text.includes('\u2026 patch truncado');
  const split = diffView() === 'split';
  const bar = el('div', 'diff-view-bar');
  const toggle = el('button', 'ghost', split ? 'vista unificada' : 'vista dividida');
  toggle.title = split ? 'mostrar em uma coluna' : 'mostrar lado a lado';
  toggle.onclick = () => {
    setDiffView(split ? 'unified' : 'split');
    refreshDiffs();
  };
  bar.appendChild(toggle);
  node.appendChild(bar);
  const host = split ? el('div', 'diff-split') : node;
  if (split) node.appendChild(host);
  // Separa o cabeçalho (---/+++) dos hunks (@@): um botão "desfazer" por hunk.
  // Patch sintético do `write` (só +) e patch truncado não ganham botão —
  // o backend recusaria mesmo, com erro legível.
  const groups = [];
  let cur = { head: [], hunk: null };
  for (const line of lines.slice(0, MAX)) {
    if (line.startsWith('@@')) {
      if (cur.hunk || cur.head.length) groups.push(cur);
      cur = { head: [], hunk: [] };
    }
    if (cur.hunk) cur.hunk.push(line);
    else cur.head.push(line);
  }
  groups.push(cur);
  const paint = (hostNode, line, wide) => {
    let cls = 'diff-ctx';
    if (line.startsWith('+++') || line.startsWith('---')) cls = 'diff-meta';
    else if (line.startsWith('@@')) cls = 'diff-hunk';
    else if (line.startsWith('+')) cls = 'diff-add';
    else if (line.startsWith('-')) cls = 'diff-del';
    const row = el('div', 'diff-line ' + cls + (wide ? ' diff-split-wide' : ''));
    if (!line.length) { row.textContent = ' '; hostNode.appendChild(row); return; }
    // Só add/del/ctx têm a coluna do prefixo; cabeçalho/hunk ficam texto puro.
    if (hasDiffPrefix(cls, line)) {
      row.appendChild(document.createTextNode(line[0]));
      appendHighlighted(row, line.slice(1), lang);
    } else {
      row.appendChild(document.createTextNode(line));
    }
    hostNode.appendChild(row);
  };
  // Célula da vista split: mesma pintura/prefixo do unified, lado pela classe.
  const paintCell = (cell, side) => {
    const cls = cell.kind === 'pad' ? 'diff-pad' : 'diff-' + cell.kind;
    const row = el('div', 'diff-line ' + cls + ' diff-' + side);
    if (!cell.text.length) { row.textContent = ' '; host.appendChild(row); return; }
    if (hasDiffPrefix(cls, cell.text)) {
      row.appendChild(document.createTextNode(cell.text[0]));
      appendHighlighted(row, cell.text.slice(1), lang);
    } else {
      row.appendChild(document.createTextNode(cell.text));
    }
    host.appendChild(row);
  };
  for (const g of groups) {
    for (const line of g.head) paint(host, line, split);
    if (!g.hunk) continue;
    const undoable = !truncated && file
      && g.hunk.some((l) => l.startsWith('-') && !l.startsWith('---'));
    if (undoable) {
      const hunkText = g.hunk.join('\n');
      const btn = el('button', 'tiny', 'desfazer hunk');
      btn.style.cssText = 'margin:2px 0 6px;';
      if (split) btn.classList.add('diff-split-wide');
      btn.onclick = async () => {
        if (!confirm('Desfazer este hunk em ' + file + '?')) return;
        btn.disabled = true;
        try {
          const res = await inv('revert_hunk', { cwd: current && current.cwd, file, hunk: hunkText });
          note(String(res));
          loadEdits();
        } catch (e) { note('reverter: ' + e); btn.disabled = false; }
      };
      host.appendChild(btn);
    }
    if (split) {
      for (const pair of splitHunk(g.hunk)) {
        if (pair.hunk !== undefined) paint(host, pair.hunk, true);
        else { paintCell(pair.left, 'left'); paintCell(pair.right, 'right'); }
      }
    } else {
      for (const line of g.hunk) paint(host, line, false);
    }
  }
  if (lines.length > MAX) {
    node.appendChild(el('div', 'diff-line diff-meta', t('tools.omitted', { n: lines.length - MAX })));
  }
}

/* =============== painel: missões (somente leitura, sem runner) =============== */
let missionsList = []; // último resultado de missions_status ({project,id,title,status,updatedAt,runs,cwd})
let missionsError = '';

async function loadMissions() {
  try {
    const list = JSON.parse(String(await inv('missions_status')));
    missionsList = Array.isArray(list) ? list : [];
    missionsError = '';
  } catch (e) {
    missionsList = [];
    missionsError = String(e);
  }
  renderMissions();
}

/** Snapshot puro do painel Missões (Svelte + testes). */
export function missionsSnapshot(list, err) {
  if (err) return { empty: err, head: '', rows: [] };
  const rows = (list || []).map(m => ({
    key: String(m.id || ''),
    title: String(m.title || m.id || t('sidebar.untitled')),
    status: String(m.status || ''),
    runs: String(m.runs || 0),
    titleAttr: String(m.cwd || m.project || ''),
  }));
  return {
    empty: rows.length ? '' : t('missions.empty'),
    head: rows.length ? t('missions.count', { n: rows.length }) : '',
    rows,
  };
}

function renderMissions() {
  if (missionsPane) missionsPane.sync();
}

/** Detalhe da missão no mesmo painel dos diffs (só mostra, não executa). */
function openMission(m) {
  const host = $('detaillog');
  $('detailtitle').textContent = String(m.title || m.id || t('missions.detail_fallback'));
  clear(host);
  host.appendChild(el('div', 'history-head',
    t('missions.detail_head', { status: m.status || '?', runs: m.runs || 0 })));
  for (const [k, v] of [['projeto', m.cwd || m.project], ['id', m.id], ['atualizada', m.updatedAt]]) {
    host.appendChild(el('div', 'row note', k + ': ' + (v || '—')));
  }
  $('detail').classList.remove('hidden');
}

/* =============== painel: git (status/diff + escrita) =============== */
let gitData = null; // último payload de git_status ({repo,branch,ahead,behind,detached,changes,totals})
let gitError = '';
/* Seleção da lista = intenção da ação: `commit` e `descartar` agem sobre estes
   paths. O clique na row marca/desmarca; abrir o diff é o botão `diff` da row
   (clique simples ambíguo: marcar ou abrir? — dois alvos explícitos). */
let gitSel = new Set();
let gitCwd = '';   // dono da seleção/rascunho; trocar de sessão zera os dois
let gitNote = '';  // resultado da última ação, na linha de status do painel
let gitNoteErr = false;
let gitMsg = '';   // rascunho da mensagem de commit (sobrevive ao re-render)
let gitAmend = false;
let gitLease = false; // toggle explícito: só ele habilita --force-with-lease
let gitBusy = false;  // ação em voo: trava duplo clique

/* O status vem do disco: atualiza sozinho a cada 5 s (pausado com a janela
   oculta e durante ação de escrita). Um `git status` custa ms — watcher nativo
   de fs não se paga aqui. */
let gitPoll = null;
function startGitPoll() {
  if (gitPoll) return;
  gitPoll = setInterval(() => {
    if (document.hidden || gitBusy) return;
    if (current && current.cwd) loadGit();
  }, 5000);
}

async function loadGit() {
  const cwd = current && current.cwd;
  const seq = viewSeq;
  if (!cwd) { gitData = null; gitError = ''; renderGit(); return; }
  try {
    const data = JSON.parse(String(await inv('git_status', { cwd })));
    if (seq !== viewSeq) return; // trocou de sessão durante a leitura
    gitData = data && typeof data === 'object' ? data : null;
    gitError = '';
  } catch (e) {
    if (seq !== viewSeq) return;
    gitData = null;
    gitError = String(e);
  }
  renderGit();
}

/** Executa uma ação de escrita do painel: marca "em voo", pinta o resultado na
    linha de status (nunca `alert`) e relê o status no fim. */
async function gitAct(label, call, opts) {
  const cwd = String((current && current.cwd) || '');
  if (!cwd || gitBusy) return null;
  gitBusy = true;
  gitNote = label + '…';
  gitNoteErr = false;
  renderGit();
  try {
    const out = String((await call(cwd)) || '').trim();
    gitNote = label + ' ok' + (out ? ': ' + out : '');
    gitNoteErr = false;
    return { ok: true, out };
  } catch (e) {
    gitNote = label + ' falhou: ' + String(e).trim();
    gitNoteErr = true;
    return { ok: false, err: String(e) };
  } finally {
    gitBusy = false;
    if (opts && opts.clearSel) gitSel.clear();
    await loadGit();
  }
}

/** `descartar`: `git restore` dos marcados. Untracked é recusado no backend (o
    equivalente seria `git clean`), e o erro aparece na linha de status. */
async function gitDiscardSelected() {
  const paths = [...gitSel];
  if (!paths.length) return;
  const ok = confirm(t('git.discard_prompt', { n: paths.length, files: paths.join('\n') }));
  if (!ok) return;
  await gitAct(t('git.discard'), (cwd) => inv('git_discard', { cwd, paths }), { clearSel: true });
}

function gitStash() {
  return gitAct(t('git.stash'), (cwd) => inv('git_stash', { cwd }), { clearSel: true });
}

function gitStashPop() {
  return gitAct(t('git.stash_pop'), (cwd) => inv('git_stash_pop', { cwd }), { clearSel: true });
}

/** `pull` só fast-forward: sem upstream ou non-fast-forward o stderr do git vai
    para a linha de status; não há confirmação porque nada local é descartado. */
function gitPull() {
  return gitAct(t('git.pull'), (cwd) => inv('git_pull', { cwd }));
}

/** Confirma o comando literal do force (só existe atrás do toggle). */
function gitConfirmLease(cwd) {
  return confirm(t('git.push_force_confirm', { cwd }));
}

/** `commit` (ou `commit & push`): estágia os marcados e commita; com push, uma
    falha do push NÃO desfaz o commit — o stderr do git vai para a linha. */
async function gitCommit(push) {
  const cwd = String((current && current.cwd) || '');
  const message = gitMsg;
  const paths = [...gitSel];
  if (!message.trim()) {
    gitNote = 'mensagem vazia — nada foi commitado';
    gitNoteErr = true;
    renderGit();
    return;
  }
  if (push && gitLease && !gitConfirmLease(cwd)) return;
  const label = push ? 'commit & push' : 'commit';
  await gitAct(label, async (dir) => {
    const hash = String(await inv('git_commit', { cwd: dir, message, paths, amend: gitAmend }));
    gitMsg = '';      // a mensagem foi consumida: o próximo commit começa limpo
    gitAmend = false;
    if (!push) return hash;
    try {
      const out = String(await inv('git_push', { cwd: dir, forceWithLease: gitLease }));
      return hash + ' · push: ' + (out || 'ok');
    } catch (e) {
      throw new Error('commit ' + hash + ' feito, push falhou — ' + String(e));
    }
  }, { clearSel: true });
}

async function gitPush() {
  const cwd = String((current && current.cwd) || '');
  if (gitLease && !gitConfirmLease(cwd)) return;
  await gitAct(gitLease ? 'push --force-with-lease' : 'push',
    (dir) => inv('git_push', { cwd: dir, forceWithLease: gitLease }));
}

/** Checkbox com rótulo (o `<label>` faz o texto também alternar a caixa). */

/** Snapshot puro do painel Git (Svelte + testes). */
export function gitSnapshot(data, ui) {
  const u = ui || {};
  const cwd = String(u.cwd || '');
  if (u.error) return { empty: u.error, files: [], head: null };
  const repo = !!data && data.repo === true;
  if (!repo) return { empty: cwd ? t('git.no_repo', { path: cwd }) : t('composer.no_session'), files: [], head: null };
  const list = Array.isArray(data.changes) ? data.changes : [];
  const tot = data.totals || {};
  const sel = u.sel || new Set();
  return {
    empty: '',
    head: {
      branch: String(data.branch || '') || (data.detached ? '(detached)' : '—'),
      ahead: Number(data.ahead) || 0,
      behind: Number(data.behind) || 0,
      count: list.length,
      add: Number(tot.add) || 0,
      del: Number(tot.del) || 0,
    },
    cwd,
    files: list.map(c => {
      const path = String(c.path || '');
      const [name, dir] = splitPath(path);
      return {
        path, name, dir,
        status: String(c.status || '?'),
        add: typeof c.add === 'number' ? c.add : null,
        del: typeof c.del === 'number' ? c.del : null,
        selected: sel.has(path),
        titleAttr: path + ' · ' + (c.untracked ? 'não rastreado' : (c.staged ? 'no índice' : 'no worktree'))
          + ' · clique na row seleciona; `diff` abre o patch',
      };
    }),
    cleanLabel: t('panel.git_clean'),
    note: u.note || '',
    noteErr: !!u.noteErr,
    msg: u.msg || '',
    amend: !!u.amend,
    lease: !!u.lease,
    selCount: sel.size,
    labels: {
      reload: t('git.reload'), hintReload: t('git.hint_reload'),
      discard: t('git.discard'), hintDiscard: t('git.hint_discard'),
      stash: t('git.stash'), hintStash: t('git.hint_stash'),
      stashPop: t('git.stash_pop'), hintStashPop: t('git.hint_stash_pop'),
      pull: t('git.pull'), hintPull: t('git.hint_pull'),
      selectTitle: 'selecionar para commit/descartar',
      diffTitle: 'abrir o diff deste arquivo',
      msgPh: 'mensagem do commit · Ctrl+Enter commita',
      hintAmend: t('git.hint_amend'),
      hintLease: t('git.hint_lease'),
      hintCommit: t('git.hint_commit'),
      commitPushTitle: 'commit e depois push; se o push falhar o commit fica',
      pushTitle: 'git push (--force-with-lease se o toggle estiver ligado)',
    },
  };
}

function renderGit() {
  // Contador da aba e reset por sessão continuam fora do componente.
  const repo = !!gitData && gitData.repo === true;
  const list = repo && Array.isArray(gitData.changes) ? gitData.changes : [];
  const cnt = $('gitcnt');
  if (cnt) cnt.textContent = list.length ? String(list.length) : '';
  const cwdTxt = String((current && current.cwd) || '');
  if (cwdTxt !== gitCwd) { // outra sessão: seleção/mensagem de commit não valem
    gitCwd = cwdTxt;
    gitSel.clear();
    gitMsg = '';
    gitNote = '';
  }
  if (gitPane) gitPane.sync();
}
/* =============== aba Plano (plans/ do projeto) =============== */
let plansData = null;   // último `plans_list` da sessão em foco (null = ainda não leu)
let plansError = '';

/** Relê os planos do `cwd` da sessão. Mesma geração (`viewSeq`) dos vizinhos:
    resposta de sessão que já saiu não pinta no painel da atual. */
async function loadPlans() {
  const cwd = current && current.cwd;
  const seq = viewSeq;
  if (!cwd) { plansData = null; plansError = ''; renderPlans(); return; }
  try {
    const data = JSON.parse(String(await inv('plans_list', { cwd })));
    if (seq !== viewSeq) return; // trocou de sessão durante a leitura
    plansData = data && typeof data === 'object' ? data : null;
    plansError = '';
  } catch (e) {
    if (seq !== viewSeq) return;
    plansData = null;
    plansError = String(e);
  }
  renderPlans();
}

/** Uma linha por plano (`name`, `done/total`, próximo item aberto) + barra de 2px.
    Clique na linha abre o markdown no app padrão. */
/** Snapshot puro do painel Plano (Svelte + testes). */
export function plansSnapshot(data, err) {
  if (err) return { empty: err, rows: [] };
  if (!data) return { empty: t('panel.no_plans'), rows: [] };
  if (data.repo !== true) return { empty: t('panel.no_plans_found'), rows: [] };
  const list = Array.isArray(data.plans) ? data.plans : [];
  if (!list.length) return { empty: t('panel.no_plans'), rows: [] };
  return {
    empty: '',
    rows: list.map(p => {
      const file = String(p.file || '');
      const done = Number(p.done) || 0;
      const total = Number(p.total) || 0;
      return {
        file,
        name: String(p.name || file),
        source: p.source ? String(p.source) : '',
        current: p.current ? String(p.current) : '',
        count: total ? done + '/' + total : t('panel.no_checklist'),
        pct: total ? Math.min(100, Math.round((done / total) * 100)) : 0,
        title: file + ' · ' + t('plan.open_in_app'),
      };
    }),
  };
}

function renderPlans() {
  if (plansPane) plansPane.sync();
}

async function loadChildren(dir) {
  if (!dir) return;
  const seq = viewSeq;
  try {
    const list = JSON.parse(await inv('list_children', { dir }));
    // Comparar só a geração não basta: `switchTab` chama isto DEPOIS do await do
    // histórico, então a leitura nasce já com a geração nova e pintaria os runs da
    // aba anterior no painel da atual (bug: ir numa sessão com subagents e voltar).
    if (seq !== viewSeq || !current || current.childrenDir !== dir) return;
    // Vazio também renderiza: o paint fundido mantém o widget ao vivo visível.
    renderChildren(list);
  } catch (e) {
    if (seq !== viewSeq) return;
    subsError = String(e);
    if (subsPane) subsPane.sync();
  }
}

/* =============== subagents: ao vivo =============== */
function extractSnapshot(line) {
  const i = line.indexOf(PREFIX);
  if (i < 0) return null;
  const rest = line.slice(i + PREFIX.length);
  let end = -1, backslashes = 0;
  for (let k = 0; k < rest.length; k++) {
    const ch = rest[k];
    if (ch === '\\') { backslashes++; continue; }
    if (ch === '"' && backslashes % 2 === 0) { end = k; break; }
    backslashes = 0;
  }
  if (end < 0) return null;
  try { return JSON.parse(JSON.parse('"' + rest.slice(0, end) + '"')); }
  catch { return null; }
}

function fmtElapsed(from, to) {
  if (!from) return '';
  const s = Math.max(0, Math.round(((to || Date.now()) - from) / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0');
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
}

/** Run ainda em andamento: o relógio anda com `now`, não congela no último snapshot.
 *  Estado terminal usa `updatedAt` (o snapshot é o dono do instante final). */
export function isLiveRun(run) {
  const state = String((run && run.state) || '');
  return state === 'running' || state === 'queued';
}

/** Tempo exibido de um run/child, recalculado a cada repaint (relógio de 1 s). */
export function elapsedFor(run, now) {
  if (!run || !run.startedAt) return '';
  const end = isLiveRun(run)
    ? (now || Date.now())
    : (run.updatedAt || run.endedAt || run.startedAt);
  return fmtElapsed(run.startedAt, end);
}

let lastSnap = null; // último widget ao vivo (runs em andamento), por sessão em foco
let lastDiskList = null; // último histórico do disco, da sessão em foco
let lastDiskKey = ''; // id/estado da última lista pintada: poll igual não repinta

/* Dedupe conservador: só esconde o item do disco se o id for exatamente igual ao
   do run ao vivo. O formato de run.id do widget não é verificado (produtor é a
   extensão externa pi-subagents), então igualdade frouxa poderia sumir com item. */
function sameSub(r, c) {
  return !!r && !!c && r.id != null && c.id != null && String(r.id) === String(c.id);
}

/* Ao vivo e histórico se fundem: cada fonte atualiza só o seu estado e o snapshot
   desenha as duas metades (o preview resolve os tempos no componente). */

/** Snapshot puro do painel Subagents (Svelte + testes). `live` são os runs do
 *  widget; `disk` o histórico de `list_children` (deduplicado por id). */
export function subsSnapshot(live, disk, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  if (o.error) return { empty: true, emptyLabel: String(o.error), warn: false, runs: [], history: [], historyHead: '' };
  const liveList = Array.isArray(live) ? live : [];
  const diskList = (Array.isArray(disk) ? disk : []).filter(c => !liveList.some(r => sameSub(r, c)));
  const runs = liveList.map(run => ({
    id: String(run.id || ''),
    label: String(run.label || run.kind || 'run'),
    state: String(run.state || '?'),
    time: elapsedFor(run, now),
    children: (run.children || []).map(ch => ({
      key: String(ch.id || ch.agent || ch.label || ''),
      label: String(ch.label || ch.agent || ch.id),
      state: String(ch.state || '?'),
      model: ch.model ? String(ch.model).split('/').pop() : '',
      thinking: ch.thinking ? String(ch.thinking) : '',
      time: elapsedFor(ch, now),
    })),
  }));
  const history = diskList.map(c => {
    const meta = CHILD_STATE[c.state] || CHILD_STATE.unknown;
    return {
      id: String(c.id || ''),
      label: String(c.label || String(c.id || '').slice(0, 8)),
      stateText: meta[0],
      stateClass: meta[1],
      meta: (c.run != null ? c.run + ' · ' : '') + relTime(c.mtime),
    };
  });
  return {
    empty: !runs.length && !history.length,
    emptyLabel: o.emptyLabel || '',
    warn: !!o.warn,
    runs,
    history,
    historyHead: history.length ? t('subs.history', { n: history.length }) : '',
  };
}

function paintSubs() {
  if (subsPane) subsPane.sync();
}

export function renderSubs(snap) {
  lastSnap = (snap && Array.isArray(snap.runs) && snap.runs.length) ? snap : null;
  paintSubs();
}

/** Painel de Subagents à vista? Clicar na aba já recarrega do disco; com o painel
 *  escondido, reler a cada tique é I/O à toa (`list_children` abre cada child). */
function subsPaneVisible() {
  const pane = $('subs');
  return !!pane && !pane.classList.contains('hidden')
    && !document.body.classList.contains('no-subs');
}

/** Enquanto um turno roda, o chip de contexto/tokens só mudava no `agent_settled`
 *  (ou seja, "depois de um tempo"). O pi expõe `get_session_stats` a qualquer
 *  momento: poll curto mantém tokens, custo e % do contexto em tempo real. */
const STATS_POLL_MS = 2000;
let statsPoll = null;
function ensureStatsPoll() {
  if (statsPoll) return;
  statsPoll = setInterval(() => {
    const t = current && tabs.find(x => x.key === current.key);
    if (!t || !t.working) {
      clearInterval(statsPoll);
      statsPoll = null;
      return;
    }
    // Run novo de subagent nasce no disco: o snapshot ao vivo é só do widget
    // `subagent-async` (jobs async) — run em primeiro plano não emite nada. Sem
    // esta releitura o painel só mostrava o run ao trocar de aba ou no fim do turno.
    if (current.childrenDir && subsPaneVisible()) loadChildren(current.childrenDir);
    // Aba sem processo vivo não aceita RPC: poll falharia e encheria o log de erro.
    if (!t.connected) return;
    sendCommand({ type: 'get_session_stats' });
  }, STATS_POLL_MS);
}

/* =============== fila de mensagens =============== */
/* `queue_update` traz a fila completa a cada mudança (docs/json.md) e é o único
   sinal de que uma mensagem enfileirada foi entregue. As linhas locais moram na
   aba porque o log é reconstruído do disco, que ainda não tem a mensagem. */
function localRows(t) { return t ? (t.localRows || (t.localRows = [])) : []; }

function queueTag(row, text, cls) {
  let tag = row.querySelector('.queue-tag');
  if (!tag) { tag = el('span', 'queue-tag'); row.appendChild(tag); }
  tag.className = 'queue-tag' + (cls ? ' ' + cls : '');
  tag.textContent = text;
}

function markRow(entry, state) {
  entry.state = state;
  entry.row.classList.toggle('queued', state === 'queued');
  // Cancelada também no nível da row: quando o render a reinsere no meio do
  // transcript, ela não pode se confundir com mensagem de fato enviada.
  entry.row.classList.toggle('cancelled', state === 'cancelled');
  if (state === 'queued') queueTag(entry.row, '· na fila');
  else if (state === 'delivered') queueTag(entry.row, '· entregue', 'delivered');
  else if (state === 'cancelled') queueTag(entry.row, '· cancelada', 'cancelled');
}

/** `clear_queue` em voo (`{key, at}`): enquanto ele não responde, sumir da lista não é
 *  entrega. O pi emite `queue_update` com as listas vazias **antes** de devolver a
 *  resposta (`agent-session.js: clearQueue` → `_emitQueueUpdate` → return), então sem
 *  esta janela o desfazer fila marcava tudo como "· entregue" (a row já não estava
 *  mais 'queued' quando a resposta chegava e o cancelamento não alcançava). */
const QUEUE_CLEAR_WINDOW_MS = 10000;
let queueClearing = null;

function queueClearInFlight(key) {
  if (!queueClearing || queueClearing.key !== key) return false;
  if (Date.now() - queueClearing.at > QUEUE_CLEAR_WINDOW_MS) { queueClearing = null; return false; }
  return true;
}

/** Manda `clear_queue` marcando a janela: quem some da fila agora foi cancelado, não
 *  entregue. Usado pelo desfazer fila e pelo abort (que também esvazia a fila). */
function clearQueueNow(tabKey) {
  queueClearing = { key: tabKey, at: Date.now() };
  sendCommand({ type: 'clear_queue' });
}

function syncQueue(key, texts) {
  const t = tabs.find(x => x.key === key);
  if (!t) return;
  const left = texts.slice();
  t.queue = texts;
  const clearing = queueClearInFlight(key);
  for (const entry of t.localRows || []) {
    if (entry.state !== 'queued') continue;
    const i = left.findIndex(s => s === entry.text || s.includes(entry.text) || entry.text.includes(s));
    if (i >= 0) left.splice(i, 1);
    else markRow(entry, clearing ? 'cancelled' : 'delivered');
  }
  // Fila repovoada com o clear ainda em voo: a janela perdeu o efeito.
  if (clearing && texts.length) queueClearing = null;
}

/** Tira do transcript as rows em fila que o `clear_queue` devolveu (desfazer fila /
 *  abort). Nada disso foi entregue — o texto voltou para o composer — e
 *  `restoreLocalRows` reinsere toda row local cujo texto o disco não tem, ou seja,
 *  elas ficariam para sempre na tela. 'cancelled' entra junto: o `queue_update` do
 *  pi chega antes da resposta, então as rows já foram marcadas canceladas quando o
 *  `clear_queue` responde. */
export function dropQueuedRows(t) {
  if (!t || !Array.isArray(t.localRows)) return 0;
  const keep = [];
  for (const entry of t.localRows) {
    if (entry && (entry.state === 'queued' || entry.state === 'cancelled')) {
      if (entry.row && typeof entry.row.remove === 'function') entry.row.remove();
      continue;
    }
    keep.push(entry);
  }
  const dropped = t.localRows.length - keep.length;
  t.localRows = keep;
  return dropped;
}

/* Posição cronológica dentro do log. Insere antes da 1ª row mais nova que `at`;
   sem âncora (transcript inteiro mais antigo, ou `at` desconhecido) vai para o fim. */
export function insertRowByAt(log, row, at) {
  const cut = Number(at);
  for (const child of Array.from(log.children)) {
    const raw = child.dataset ? child.dataset.at : undefined;
    const childAt = raw === undefined || raw === '' ? NaN : Number(raw);
    if (Number.isFinite(childAt) && childAt > cut) { log.insertBefore(row, child); return; }
  }
  log.appendChild(row);
}

/** Texto de comparação de rows: colapsa espaços e remove as bordas.
 *  O disco grava `text.trim()`; a linha local guarda o texto cru. Sem normalizar,
 *  a mesma mensagem virava duas (uma do disco, outra local). */
export function normalizeRowText(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/* Regra do restore: o que conta é o texto, não o estado. Linha cancelada cujo texto
   já está no transcript era a mesma mensagem — reinseri-la a prendia no fim do log
   para sempre (bug: mensagem antiga reaparecendo no fim do transcript). */
export function shouldRestoreLocalRow(entry, seen) {
  if (!entry || !seen) return false;
  const key = normalizeRowText(entry.text);
  if (!key) return false;
  if (typeof seen.has === 'function' && seen.has(key)) return false;
  for (const text of seen) {
    if (normalizeRowText(text) === key) return false;
  }
  return true;
}

/** O parcial da aba já está no log? O disco/RPC pode ter pintado a resposta
 *  inteira (ou um prefixo maior) antes do `reattachStream`: reanexar o parcial
 *  criava uma SEGUNDA cópia da mesma resposta ao trocar de aba e voltar. */
export function answerAlreadyRendered(partial, renderedTexts) {
  const p = normalizeRowText(partial);
  if (!p) return false;
  return (renderedTexts || []).some((text) => {
    const n = normalizeRowText(text);
    return !!n && n.startsWith(p);
  });
}

/** Acumula `delta` em `prev` mantendo no máximo os `cap` últimos caracteres.
 *  O corte não pode começar no meio de um par substituto (emoji fora do BMP). */
export function appendCapped(prev, delta, cap) {
  const next = String(prev == null ? '' : prev) + String(delta == null ? '' : delta);
  if (!(cap > 0) || next.length <= cap) return next;
  let start = next.length - cap;
  const code = next.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) start += 1;
  return next.slice(start);
}

/* =============== saúde das extensões (LSP/MCP) =============== */
/* O pi avisa problema de extensão em texto no RPC (`extensão LSP inactive`,
   `extensão MCP servers need attention: …`). Até aqui isso caía no transcript como
   linha crua e nada virava estado; o chip do header é ADICIONAL (as linhas continuam
   no log). O casamento é por texto porque o pi não emite evento tipado para isso e o
   resto da frase varia com versão/idioma — só `LSP`/`MCP` são estáveis. */
const HEALTH_MAX = 20;      // avisos guardados por sessão (descarta o mais antigo)
const HEALTH_TITLE_MAX = 3; // mensagens listadas no tooltip
const HEALTH_ID_MAX = 200;  // corte do `id`: linha inteira não cabe num title

const HEALTH_RULES = [
  { kind: 'lsp', re: /extensão LSP|LSP inactive|lsp.*inactive/i },
  { kind: 'mcp', re: /MCP servers need attention|mcp.*failed|failed:.*fetch failed/i },
];
/* Prefixo de log (`[12:34:56] `, `2026-01-02T12:34:56Z `) não é mensagem: sai antes do
   casamento e do `id`, senão a mesma frase repetida viraria dois avisos. */
const HEALTH_TS = /^\s*(?:\[?\d{2}:\d{2}(?::\d{2})?\]?|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)\s+/;

/** Avisos por sessão: `Map<sessionKey, Map<id, kind>>` (o interno é FIFO por inserção). */
const healthBySession = new Map();

/** Texto a classificar: a própria linha, ou a mensagem de um notify de extensão.
 *  O aviso do pi chega das duas formas: texto no stdout e `extension_ui_request`
 *  (`method: notify|setStatus`) — é esse JSON que pinta a linha "extensão …" no
 *  transcript. Olhar só o JSON de extensão evita casar regex em args de tool ou em
 *  texto do modelo. */
function healthText(line) {
  const text = stripAnsi(line).replace(HEALTH_TS, '').trim();
  if (!text.startsWith('{')) return text;
  let rec = null;
  try { rec = JSON.parse(text); } catch { return ''; }
  if (!rec || rec.type !== 'extension_ui_request') return '';
  const msg = typeof rec.message === 'string' ? rec.message : rec.statusText;
  return typeof msg === 'string' ? stripAnsi(msg).trim() : '';
}

/** Classifica uma linha de saúde do CLI: `{kind, id}` ou `null`.
 *  `id` é o texto normalizado (sem ANSI, sem prefixo de hora, espaços colapsados) —
 *  é a chave de deduplicação, não o texto exibido. */
export function classifyHealthLine(line) {
  if (typeof line !== 'string') return null;
  const text = healthText(line);
  if (!text) return null;
  const rule = HEALTH_RULES.find(r => r.re.test(text));
  if (!rule) return null;
  return { kind: rule.kind, id: text.replace(/\s+/g, ' ').slice(0, HEALTH_ID_MAX) };
}

/** Mapa `id -> kind` da sessão, criado sob demanda. */
function healthMapFor(sessionKey) {
  let map = healthBySession.get(sessionKey);
  if (!map) { map = new Map(); healthBySession.set(sessionKey, map); }
  return map;
}

/** Avisos dispensados pelo usuário (`localStorage['muted-health']`). A chave é o `id`
 *  do aviso, global e não por sessão: a mesma frase volta em toda sessão nova — sem
 *  isso o chip reaparecia a cada aba aberta (lsp inativo, MCP "fetch failed"). */
const MUTED_KEY = 'muted-health';
let mutedHealth = null;
function mutedIds() {
  if (mutedHealth) return mutedHealth;
  mutedHealth = new Set();
  try {
    for (const id of JSON.parse(localStorage.getItem(MUTED_KEY) || '[]')) mutedHealth.add(String(id));
  } catch { /* sem storage: fica vazio */ }
  return mutedHealth;
}

/** Dispensa um aviso: sai de todas as sessões abertas e não conta mais no chip. */
export function muteHealth(id) {
  const key = String(id || '');
  if (!key) return;
  mutedIds().add(key);
  try { localStorage.setItem(MUTED_KEY, JSON.stringify([...mutedIds()])); } catch { /* sem storage */ }
  for (const map of healthBySession.values()) map.delete(key);
  renderHealthChip();
}

/** Traz os dispensados de volta: o mesmo `id` volta a contar quando o pi repetir. */
export function unmuteHealth() {
  mutedIds().clear();
  try { localStorage.removeItem(MUTED_KEY); } catch { /* sem storage */ }
  renderHealthChip();
}

/** Registra a linha no mapa (dedup por `id`) e devolve o `kind` reconhecido, ou `null`.
 *  Acima de `HEALTH_MAX` avisos o mais antigo sai: o chip mostra a contagem, não a lista. */
export function noteHealth(map, line) {
  const hit = classifyHealthLine(line);
  if (!hit) return null;
  if (mutedIds().has(hit.id)) return null; // dispensado: não conta nem repinta o chip
  if (!(map instanceof Map)) return hit.kind;
  if (!map.has(hit.id)) {
    map.set(hit.id, hit.kind);
    while (map.size > HEALTH_MAX) map.delete(map.keys().next().value);
  }
  return hit.kind;
}

/** Estado do chip para um mapa de avisos: `{count, kinds, title}`.
 *  `kinds` sai na ordem de chegada; `title` lista no máximo `HEALTH_TITLE_MAX`
 *  mensagens e resume o resto em `… +N`. */
export function healthChipState(map) {
  const entries = map instanceof Map ? Array.from(map.entries()) : [];
  const kinds = [];
  for (const [, kind] of entries) if (!kinds.includes(kind)) kinds.push(kind);
  if (!entries.length) return { count: 0, kinds, title: '' };
  const lines = entries.slice(0, HEALTH_TITLE_MAX).map(([id, kind]) => kind + ': ' + id);
  if (entries.length > HEALTH_TITLE_MAX) lines.push(t('health.more', { n: entries.length - HEALTH_TITLE_MAX }));
  return {
    count: entries.length,
    kinds,
    title: [t('health.chip', { n: entries.length }), ...lines].join('\n'),
  };
}

/** Repinta o chip do header com os avisos da sessão ATUAL; sem sessão fica escondido. */
function renderHealthChip() {
  const chip = $('healthchip');
  if (!chip) return null;
  const st = healthChipState(current ? healthBySession.get(current.key) : null);  // mcp pesa mais: servidor de MCP quebrado derruba tool, LSP inativo só tira refino.
  const warn = st.kinds.includes('mcp');
  chip.classList.toggle('hidden', !st.count);
  chip.classList.toggle('warn', !!st.count && warn);
  chip.classList.toggle('mute', !!st.count && !warn);
  chip.textContent = st.count ? '⚠ ' + st.count : '';
  chip.title = st.title;
  // O chip só mostra a contagem; o overlay Debug é onde a lista vira legível.
  if ($('pane-debug') && !$('pane-debug').classList.contains('hidden')) renderHealthList();
  renderNotify();
  return st;
}

/** Lista os avisos de extensão da sessão atual no overlay Debug (kind + mensagem).
 *  Sem isso o clique no `⚠ N` abria um Diagnóstico só com linhas RPC e o aviso
 *  ficava existindo apenas no `title` nativo do chip. */
export function renderHealthList(map = current ? healthBySession.get(current.key) : null) {
  const host = $('healthlist');
  if (!host) return;
  const entries = map instanceof Map ? Array.from(map.entries()) : [];
  clear(host);
  if (!entries.length) {
    host.appendChild(el('div', 'empty', t('panel.no_warnings')));
    return;
  }
  for (const [id, kind] of entries) {
    const row = el('div', 'file-row');
    row.appendChild(el('span', 'file-name', id));
    row.appendChild(el('span', 'file-count', kind));
    const off = el('button', 'tiny', '✕');
    off.title = t('health.dismiss');
    off.onclick = () => muteHealth(id);
    row.appendChild(off);
    host.appendChild(row);
  }
  const muted = mutedIds().size;
  if (!muted) return;
  const foot = el('div', 'file-row');
  foot.appendChild(el('span', 'file-name', muted + ' aviso(s) dispensado(s)'));
  const back = el('button', 'tiny', 'restaurar');
  back.title = 'volta a contar os avisos dispensados';
  back.onclick = () => unmuteHealth();
  foot.appendChild(back);
  host.appendChild(foot);
}

/* =============== central de notificações =============== */
/** Avisos vivos de TODAS as sessões (o ⚠ do header só conta a atual). */
function notifyEntries() {
  const out = [];
  for (const [key, map] of healthBySession) {
    if (!(map instanceof Map) || !map.size) continue;
    const tab = tabs.find(x => x.key === key);
    const label = (tab && tab.label) || prettyId(key);
    for (const [id, kind] of map) out.push({ key, label, id, kind });
  }
  return out;
}

/** Lista do popover de avisos, aberto pelo chip do topo. Chamado por `renderHealthChip`,
 *  que já roda quando um aviso chega, é dispensado ou a sessão fecha. */
export function renderNotify() {
  const entries = notifyEntries();
  const pop = $('notifypop');
  if (!pop || pop.classList.contains('hidden')) return;
  const head = $('notifyhead');
  if (head) head.textContent = t('notify.head');
  const host = $('notifylist');
  clear(host);
  if (!entries.length) { setEmpty(host, t('notify.empty')); return; }
  for (const e of entries) {
    const row = el('div', 'notify-row');
    row.appendChild(el('span', 'notify-kind', e.kind));
    const body = el('div', 'notify-body');
    body.appendChild(el('div', 'notify-msg', e.id));
    body.appendChild(el('div', 'notify-src', e.label));
    row.appendChild(body);
    const off = el('button', 'tiny', '✕');
    off.title = t('health.dismiss');
    off.onclick = () => muteHealth(e.id);
    row.appendChild(off);
    host.appendChild(row);
  }
  const restore = $('notifyrestore');
  if (restore) restore.classList.toggle('hidden', !mutedIds().size);
}

function toggleNotify(force) {
  const pop = $('notifypop');
  if (!pop) return;
  const show = force === undefined ? pop.classList.contains('hidden') : force;
  pop.classList.toggle('hidden', !show);
  if (show) renderNotify();
}

/* Reanexa linhas locais que o histórico do disco ainda não tem. Roda depois do
   render do log principal, então `seen` só contém linhas vindas do disco
   (`data-local` fica de fora): quando a mensagem já foi persistida, a cópia local cai. */
function restoreLocalRows() {
  const t = tabs.find(x => current && x.key === current.key);
  if (!t || !t.localRows || !t.localRows.length) return;
  const log = $('log');
  const seen = new Set(Array.from(log.querySelectorAll('.row.user:not([data-local])'))
    .map(n => normalizeRowText(n.dataset.text)));
  t.localRows = t.localRows.filter((entry) => {
    if (!shouldRestoreLocalRow(entry, seen)) return false;
    if (!entry.row.isConnected) insertRowByAt(log, entry.row, entry.at);
    return true;
  });
}

/* =============== eventos =============== */

/** Delta de um `message_update` do tipo pedido, ou '' se a linha não for isso. */
function deltaOf(line, type) {
  try {
    const d = JSON.parse(line).assistantMessageEvent;
    return d && d.type === type && typeof d.delta === 'string' ? d.delta : '';
  } catch { return ''; }
}

function scheduleStreamRender() {
  if (pendingRender) return;
  pendingRender = requestAnimationFrame(() => {
    pendingRender = 0;
    if (!stream || !stream.node) return;
    // Durante o stream só o delta novo entra no DOM, como texto cru: reconstruir o
    // markdown inteiro a cada frame custava 39,7 ms e 3.599 nós no pior caso
    // (STREAM_CAP = 30000) — a aba ficava 100% ocupada por toda a resposta.
    if (!stream.tail) {
      stream.tail = document.createTextNode('');
      stream.node.appendChild(stream.tail);
      stream.rendered = 0;
    }
    const rest = stream.text.slice(stream.rendered);
    if (rest) stream.tail.appendData(rest);
    stream.rendered = stream.text.length;
  });
}

/** Encerra o trecho em voo: converte o texto cru acumulado em markdown uma vez. */
function flushStream() {
  if (!stream || !stream.node) return;
  if (pendingRender) { cancelAnimationFrame(pendingRender); pendingRender = 0; }
  if (stream.tail) { stream.tail.remove(); stream.tail = null; }
  if (stream.text) setMarkdown(stream.node, stream.text);
  stream.rendered = stream.text.length;
}

listen('rpc-line', (ev) => {
  const [sessionId, line] = ev.payload;
  // Vigia do turno: toda linha da sessão é sinal de vida, inclusive de aba de fundo.
  const liveTab = tabs.find(x => x.key === sessionId);
  if (liveTab) liveTab.lastEventAt = Date.now();
  // Diagnóstico: só registra no buffer circular; o roteamento abaixo não muda.
  try {
    const rec = JSON.parse(line);
    const fg = current && sessionId === current.key ? 'atual' : 'fundo';
    diagPush(rec.type || rec.command || line.slice(0, 120), '—', rec.command ? ((rec.success ? 'ok' : 'falhou') + ' · ' + fg) : (String(rec.type || 'evento') + ' · ' + fg));
  } catch { diagPush(line.slice(0, 160), '—', 'raw'); }
  // Aviso de extensão vale para a aba que o emitiu, inclusive de fundo: o chip só
  // aparece quando aquela aba está em foco (o mapa é por sessão).
  if (noteHealth(healthMapFor(sessionId), line) && current && sessionId === current.key) renderHealthChip();
  // Resposta da sonda vale para aba em foco e de fundo: fica antes do split e nunca
  // cai no `handleResponse` (get_state da sonda não é o estado da sessão da view).
  if (line.includes('"type":"response"')) {
    let probe = null;
    try { probe = JSON.parse(line); } catch { /* linha crua */ }
    const pid = probe ? String(probe.id || '') : '';
    if (pid.startsWith(PROBE_PREFIX)) { reconcileTurn(pid.slice(PROBE_PREFIX.length), probe); return; }
  }
  if (!current || sessionId !== current.key) {
    // A fila muda também em aba de segundo plano: sem isto o estado nunca sairia de
    // "na fila" ao voltar para a aba.
    if (line.includes('"type":"queue_update"')) {
      let rec = null;
      try { rec = JSON.parse(line); } catch { return; }
      syncQueue(sessionId, [].concat(rec.steering || [], rec.followUp || []));
      return;
    }
    // Aba em segundo plano: o transcript dela volta por get_messages, mas o estado do
    // turno precisa sobreviver à troca — senão o indicador congela no rótulo antigo.
    if (line.includes('"type":"agent_settled"')) {
      maybeNotifyDone(sessionId);
      setTurn(sessionId, false);
      renderHealthChip();
      // Turno fechou: o disco já tem thinking e texto completos.
      const bst = tabs.find(x => x.key === sessionId);
      if (bst) { bst.streamText = ''; bst.thinkText = ''; }
      saveTabs();
    } else if (line.includes('thinking_delta')) {
      // Aba de fundo: o parcial acumula aqui. O .jsonl só recebe a mensagem no fim
      // do turno, então sem isto voltar para a aba não acharia nem o thinking.
      const bt = tabs.find(x => x.key === sessionId);
      if (bt) bt.thinkText = appendCapped(bt.thinkText, deltaOf(line, 'thinking_delta'), STREAM_CAP);
      setTurn(sessionId, true, 'pensando…');
    } else if (line.includes('text_delta')) {
      const bt = tabs.find(x => x.key === sessionId);
      if (bt) bt.streamText = appendCapped(bt.streamText, deltaOf(line, 'text_delta'), STREAM_CAP);
      maybeSaveTabs();
      setTurn(sessionId, true, 'respondendo…');
    }
    return;
  }

  if (line.includes('"type":"response"') && !line.includes(PREFIX)) {
    let resp = null;
    try { resp = JSON.parse(line); } catch { /* nao e resposta */ }
    if (resp && resp.command) {
      if (resp.success) handleResponse(resp);
      else {
        $('log').appendChild(el('div', 'row note', resp.command + ': falhou'));
        // O Diagnóstico virou overlay (⚙ → Debug): o buffer já guarda a falha,
        // mas nada abre sozinho por cima do que o usuário está lendo.
      }
      return;
    }
  }

  const snap = extractSnapshot(line);
  if (snap) { renderSubs(snap); return; }

  if (!line.includes('"type":"')) return;
  let rec;
  try { rec = JSON.parse(line); } catch { return; }

  switch (rec.type) {
    case 'message_start':
      if (rec.message && rec.message.role === 'assistant') {
        stream = { node: null, text: '', thinkBody: null };
        // Turno novo: o parcial guardado era do anterior (já está no disco).
        const mt = tabs.find(x => current && x.key === current.key);
        if (mt) { mt.streamText = ''; mt.thinkText = ''; mt.live = null; mt.livePending = false; }
      }
      break;

    case 'message_update': {
      // Tokens/contexto do turno em voo: o `get_session_stats` só enxerga mensagens
      // persistidas, então sem isto o chip ficava parado até o fim do turno.
      if (rec.message && rec.message.role === 'assistant' && rec.message.stopReason === 'pending') {
        const lt = tabs.find(x => current && x.key === current.key);
        if (lt) {
          lt.live = {
            billed: liveTurnTokens(rec.message),
            context: estimateMessageTokens(rec.message),
            at: Date.now(),
          };
          scheduleStatsRefresh();
        }
      }
      const d = rec.assistantMessageEvent;
      if (!d || !d.delta) break;

      if (d.type === 'thinking_delta') {
        if (!stream) stream = { node: null, text: '', thinkBody: null };
        setTurn(current.key, true, 'pensando…');
        if (!stream.thinkBody) {
          const wrap = thinkBlock('');
          stream.thinkBody = wrap.querySelector('.think-body');
          $('log').appendChild(wrap);
        }
        stream.thinkBody.textContent += d.delta;
        // Guarda por aba: trocar de aba no meio do pensamento não perde o parcial.
        const tt = tabs.find(x => current && x.key === current.key);
        if (tt) tt.thinkText = appendCapped(tt.thinkText, d.delta, STREAM_CAP);
        scrollBottomSoon();
        break;
      }

      if (d.type === 'text_delta') {
        if (!stream) stream = { node: null, text: '', thinkBody: null };
        setTurn(current.key, true, 'respondendo…');
        if (!stream.node) {
          const row = mdRow();
          $('log').appendChild(row.root);
          stream.node = row.body;
        }
        stream.text += d.delta;
        // Guarda por aba: trocar de aba no meio do stream não perde o parcial.
        const tt = tabs.find(x => current && x.key === current.key);
        if (tt) tt.streamText = stream.text.slice(-STREAM_CAP);
        maybeSaveTabs();
        scheduleStreamRender();
        scrollBottomSoon();
      }
      break;
    }

    case 'message_end':
      // Fim da resposta: pede stats frescos e deixa o live cair na resposta
      // (a mensagem já foi persistida, então o próximo total a inclui).
      if (rec.message && rec.message.role === 'assistant') {
        flushStream();
        const et = tabs.find(x => current && x.key === current.key);
        if (et && et.live) et.livePending = true;
        // Sem processo vivo o RPC falharia e a nota de erro cairia no transcript.
        if (et && et.connected) sendCommand({ type: 'get_session_stats' });
        scheduleStatsRefresh();
        // Velocidade da mensagem que acabou de persistir: o stream em voo (mdRow
        // sem meta) vira a row final sem recarregar o transcript.
        try {
          const speed = msgSpeed(rec.message);
          if (speed && stream && stream.node && stream.node.parentElement
              && !stream.node.parentElement.querySelector('.msg-meta')) {
            const meta = el('div', 'msg-meta', speed);
            if (rec.message.model) meta.title = String(rec.message.model);
            stream.node.parentElement.appendChild(meta);
          }
        } catch { /* speed é decorativo */ }
      }
      break;

    case 'tool_execution_start':
      card(rec.toolCallId, rec.toolName, rec.args, null, Date.now());
      flushStream();
      stream = null;
      // Trecho de texto anterior já está renderizado: não reanexa na volta.
      {
        const tst = tabs.find(x => current && x.key === current.key);
        if (tst) {
          tst.streamText = '';
          tst.thinkText = '';
          // A mensagem do assistente terminou e foi persistida: mantém o parcial
          // somando só até a resposta do stats, para o número não piscar para trás.
          if (tst.live) tst.livePending = true;
        }
      }
      if (rec.toolName === 'subagent') setStatus('subagent disparado…');
      break;

    case 'tool_execution_update': {
      const entry = cards.get(rec.toolCallId);
      if (entry) applyToolResult(entry, rec.partialResult);
      break;
    }

    case 'tool_execution_end': {
      const entry = cards.get(rec.toolCallId) || card(rec.toolCallId, rec.toolName, rec.args, null, Date.now());
      entry.root.classList.add(rec.isError ? 'err' : 'ok');
      entry.icon.textContent = rec.isError ? '✕' : '✓';
      applyToolResult(entry, rec.result);
      renderToolImages(entry, rec.result);
      if (uiSettings.expandTools) entry.root.classList.remove('collapsed');
      // Tokens crescem também entre tool calls: atualiza o chip sem esperar o turno.
      {
        const tt = tabs.find(x => current && x.key === current.key);
        if (tt && tt.connected) sendCommand({ type: 'get_session_stats' });
      }
      scrollBottom();
      break;
    }

    case 'agent_settled':
      maybeNotifyDone(sessionId);
      setStatus('pronto');
      setState('ready');
      setTurn(sessionId, false);
      // Resposta completa foi para o disco: os parciais guardados caducaram.
      renderHealthChip();
      {
        const st = tabs.find(x => x.key === sessionId);
        if (st) { st.streamText = ''; st.thinkText = ''; st.live = null; st.livePending = false; }
        // `stream` também caduca. Sem isto, trocar de aba depois do fim do turno
        // fazia `stashDraft` regravar a resposta final em `t.streamText`, e voltar
        // pintava a mesma resposta duas vezes (histórico do disco + reattach).
        // Último frame do rAF: sem o flush o trecho cru acumulado desde o frame
        // anterior ficaria fora do markdown final.
        flushStream();
        stream = null;
        saveTabs();
      }
      if (current && current.childrenDir) loadChildren(current.childrenDir);
      // Turno pode ter editado arquivos: a aba de diffs se atualiza sozinha.
      loadGit(); loadEdits(); loadPlans();
      sendCommand({ type: 'get_session_stats' });
      break;

    case 'extension_ui_request': {
      if (rec.method === 'notify' && rec.message) {
        extActivity(rec.message, null);
      } else if (rec.method === 'setStatus' && rec.statusText) {
        extActivity(rec.statusText, rec.statusKey || 'status');
      }
      break;
    }

    case 'queue_update':
      syncQueue(sessionId, [].concat(rec.steering || [], rec.followUp || []));
      break;

    case 'auto_retry_start':
      $('log').appendChild(el('div', 'row note', 'retry ' + rec.attempt + '/' + rec.maxAttempts));
      break;

    default:
      break;
  }
});

listen('rpc-stderr', (ev) => {
  const [sessionId, line] = ev.payload;
  if (!current || sessionId !== current.key) return;
  // Aviso benigno: sessão nova criada pelo próprio app.
  if (/No project session found with id .*creating a new session/i.test(line)) return;
  $('log').appendChild(el('div', 'row note', '[stderr] ' + line));
  scrollBottom();
});

listen('rpc-exit', (ev) => {
  const key = ev.payload;
  const t = tabs.find(x => x.key === key);
  const wasWorking = !!(t && t.working);
  // Processo morreu: zera o estado da aba, senão a próxima troca manda comandos
  // para uma sessão que o Rust já não tem ("sessao '...' nao iniciada").
  liveOrder = liveOrder.filter(k => k !== key);
  if (t) t.connected = false;
  if (current && current.key === key) current.connected = false;
  setTurn(key, false);
  const dead = tabs.find(x => x.key === key);
  if (dead) for (const entry of dead.localRows || []) if (entry.state === 'queued') markRow(entry, 'cancelled');
  pendingPromptRows.clear();
  renderTabs();
  updateProcCount();
  if (current && key === current.key) {
    setStatus('processo encerrado');
    setTyping(false);
    setState('off');
    $('log').appendChild(el('div', 'row note', wasWorking
      ? 'o processo do pi encerrou no meio do turno — resposta incompleta (envie de novo para continuar)'
      : 'processo do pi encerrado'));
    scrollBottom();
  }
});

/* =============== respostas do RPC (modelo, thinking, estado) =============== */

function contextLabel(n) {
  if (!n) return '';
  if (n >= 1000000) return (Math.round(n / 100000) / 10) + 'M';
  return Math.round(n / 1000) + 'k';
}

function updateModelButton(m) {
  if (!m) return;
  $('modelname').textContent = m.name || m.id;
  $('modelctx').textContent = contextLabel(m.contextWindow);
  $('modeltoggle').title = (m.provider ? m.provider + '/' : '') + m.id;
  try { localStorage.setItem('last-model', JSON.stringify(m)); } catch { /* sem storage */ }
}

/** Catálogo instantâneo do CLI (`pi --list-models`) — não exige sessão nem RPC. */
async function warmModels() {
  try {
    const list = JSON.parse(String(await inv('pi_models')));
    if (Array.isArray(list) && list.length) fillModels(list);
  } catch { /* fica com o cache */ }
}

/** Último modelo usado, para o botão não nascer vazio. */
function loadLastModel() {
  try {
    const m = JSON.parse(localStorage.getItem('last-model') || 'null');
    if (m && m.id) updateModelButton(m);
  } catch { /* ignora */ }
}

function loadCachedLevels() {
  try {
    const cached = JSON.parse(localStorage.getItem('levels-cache') || 'null');
    if (Array.isArray(cached) && cached.length) fillLevels(cached);
  } catch { /* ignora */ }
}

function fillModels(models, currentModel) {
  if (Array.isArray(models) && models.length) {
    allModels = models;
    modelsByProvider = new Map();
    for (const m of models) {
      if (!m || !m.id) continue;
      const p = m.provider || 'outros';
      if (!modelsByProvider.has(p)) modelsByProvider.set(p, []);
      modelsByProvider.get(p).push(m);
    }
  }
  const cur = (sessionState && sessionState.model) || currentModel;
  if (cur) updateModelButton(cur);
  // Montado (Svelte): o filtro vive no componente; undefined = só atualizar.
  renderModelList();
  try { localStorage.setItem('models-cache', JSON.stringify(models)); } catch { /* sem storage */ }
  debugNote('providers=' + modelsByProvider.size + ' models=' + allModels.length);
}

/** Pinta o seletor na hora com o último catálogo conhecido (antes do RPC responder). */
function loadCachedModels() {
  try {
    const cached = JSON.parse(localStorage.getItem('models-cache') || 'null');
    if (Array.isArray(cached) && cached.length) fillModels(cached);
  } catch { /* ignora */ }
}

/** Snapshot puro da lista de modelos (pop Svelte + testes): grupos por provider
 *  com linhas `{id,name,ctx,current}`. `providers` é o Map montado em `fillModels`. */
export function modelListSnapshot(providers, currentId, filter, favs) {
  const q = String(filter || '').toLowerCase();
  const favorite = favs instanceof Set ? favs : new Set(Array.isArray(favs) ? favs : []);
  const hit = (m) => !q || (m.id + ' ' + (m.name || '')).toLowerCase().includes(q);
  const groups = [];
  const favRows = [];
  for (const provider of [...providers.keys()].sort()) {
    const all = providers.get(provider).filter(m => m && m.id);
    // Favoritos saem da lista principal e ganham seção própria (provider/modelo).
    for (const m of all) {
      if (!favorite.has(m.id) || !hit(m)) continue;
      favRows.push({
        id: m.id,
        label: provider + '/' + (m.name || m.id),
        ctx: contextLabel(m.contextWindow),
        current: m.id === currentId,
        fav: true,
      });
    }
    const rows = all
      .filter(m => !favorite.has(m.id) && hit(m))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map(m => ({
        id: m.id, name: m.name || m.id, ctx: contextLabel(m.contextWindow),
        current: m.id === currentId, fav: false,
      }));
    if (rows.length) groups.push({ provider, rows });
  }
  favRows.sort((a, b) => a.label.localeCompare(b.label));
  return { groups, favs: favRows, empty: groups.length === 0 && favRows.length === 0 };
}

/** Snapshot puro do thinking (pop Svelte + testes): níveis, posição e se há slider. */
export function levelsSnapshot(levels, thinkingLevel) {
  const list = Array.isArray(levels) ? levels : [];
  if (!list.length) return { levels: [], at: 0, name: '', showSlider: false };
  const at = Math.max(0, list.indexOf(thinkingLevel));
  return { levels: list.slice(), at, name: list[at], showSlider: list.length > 1 };
}

function renderModelList(filter) {
  if (modelPop) modelPop.sync(filter);
}

function fillLevels(levels) {
  if (Array.isArray(levels)) levelList = levels;
  const snap = levelsSnapshot(levelList, sessionState && sessionState.thinkingLevel);
  // `#thinkbtn` é o chip da barra do composer (fora do pop): continua sendo do main.
  const btn = $('thinkbtn');
  if (btn) {
    if (!snap.levels.length) btn.textContent = 'thinking';
    else {
      btn.textContent = snap.name;
      btn.title = 'thinking: ' + snap.name + ' — clique para escolher';
    }
  }
  if (modelPop) modelPop.sync();
}

function fmtTokens(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.0', '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

/** Estimativa de tokens de uma mensagem em voo (chars/4, a mesma heurística do
 *  pi): o RPC só contabiliza mensagens persistidas, então o turno em andamento
 *  ficaria de fora do chip de contexto até o `message_end`. */
export function estimateMessageTokens(message) {
  if (!message || !Array.isArray(message.content)) return 0;
  let chars = 0;
  for (const block of message.content) {
    if (!block) continue;
    if (block.type === 'text') chars += String(block.text || '').length;
    else if (block.type === 'thinking') chars += String(block.thinking || '').length;
    else if (block.type === 'toolCall') {
      chars += String(block.name || '').length;
      try { chars += JSON.stringify(block.arguments || {}).length; } catch { /* argumento parcial */ }
    }
  }
  return Math.ceil(chars / 4);
}

/** Tokens cobrados do turno em voo: usa o `usage` do parcial quando o provider já
 *  informou; senão estima pelo conteúdo (output crescendo token a token). */
export function liveTurnTokens(message) {
  const u = (message && message.usage) || null;
  const used = u
    ? (Number(u.totalTokens) || (Number(u.input) || 0) + (Number(u.output) || 0)
        + (Number(u.cacheRead) || 0) + (Number(u.cacheWrite) || 0))
    : 0;
  return Math.max(used, estimateMessageTokens(message));
}

/** Velocidade de geração de uma mensagem do assistente: `output/durationMs`.
 *  Devolve `52 tok/s · 142 out · 2,7s` ou `null` sem `usage`/`durationMs` válidos. */
export function msgSpeed(m) {
  const u = m && m.usage;
  const out = u ? Number(u.output) : NaN;
  const ms = m ? Number(m.durationMs) : NaN;
  if (!Number.isFinite(out) || !Number.isFinite(ms) || ms <= 0 || out <= 0) return null;
  const secs = ms / 1000;
  const tps = out / secs;
  const tpsTxt = tps >= 100 ? String(Math.round(tps)) : tps.toFixed(1).replace('.', ',');
  const secsTxt = (secs >= 10 ? secs.toFixed(0) : secs.toFixed(1)).replace('.', ',');
  return tpsTxt + ' tok/s · ' + out + ' out · ' + secsTxt + 's';
}

/** Velocidade média de geração do histórico: soma de `output` ÷ soma do tempo
 *  das respostas que têm `usage.output` + `durationMs` (média ponderada pelo
 *  tamanho — a média das taxas daria o mesmo peso a respostas curtas e longas).
 *  Devolve `37,5 tok/s` ou `null` quando nenhuma resposta tem duração. */
export function avgMsgSpeed(messages) {
  let out = 0;
  let ms = 0;
  let n = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    const u = m && m.usage;
    const o = u ? Number(u.output) : NaN;
    const d = m ? Number(m.durationMs) : NaN;
    if (!Number.isFinite(o) || !Number.isFinite(d) || d <= 0 || o <= 0) continue;
    out += o;
    ms += d;
    n++;
  }
  if (!n || ms <= 0) return null;
  const tps = out / (ms / 1000);
  // Mesma régua de `msgSpeed`, sem o ",0" que só polui (50,0 → 50).
  const txt = tps >= 100 ? String(Math.round(tps)) : tps.toFixed(1).replace('.', ',').replace(/,0$/, '');
  return txt + ' tok/s';
}

/** Stats do RPC + parcial em voo, sem tocar no cache por aba. */
export function liveStatsView(data, live) {
  const stats = data || {};
  const billed = live ? Math.max(0, Number(live.billed) || 0) : 0;
  const ctxDelta = live ? Math.max(0, Number(live.context) || 0) : 0;
  if (!billed && !ctxDelta) return { stats, billed: 0, ctxDelta: 0 };
  const tokens = stats.tokens
    ? { ...stats.tokens, total: (Number(stats.tokens.total) || 0) + billed }
    : stats.tokens;
  let contextUsage = stats.contextUsage;
  if (contextUsage && contextUsage.contextWindow) {
    const base = typeof contextUsage.tokens === 'number' ? contextUsage.tokens : null;
    const tokensCtx = base == null ? null : Math.min(contextUsage.contextWindow, base + ctxDelta);
    contextUsage = {
      ...contextUsage,
      tokens: tokensCtx,
      percent: tokensCtx == null ? null : (tokensCtx / contextUsage.contextWindow) * 100,
      live: ctxDelta,
    };
  }
  return { stats: { ...stats, tokens, contextUsage }, billed, ctxDelta };
}

/** Detalhamento do contexto (mesmo formato que o pi-gpui mostra). */
function fmtCost(c) { return typeof c === 'number' ? 'US$ ' + c.toFixed(2) : '—'; }

/** Parcial do turno em voo da aba em foco (setado em message_update/get_messages). */
function currentLive() {
  const t = current && tabs.find(x => x.key === current.key);
  return (t && t.live) ? t.live : null;
}

let statsRefreshTimer = 0;
/** Repinta o chip no máximo a cada 250 ms: text_delta chega por token. */
function scheduleStatsRefresh() {
  if (statsRefreshTimer) return;
  statsRefreshTimer = setTimeout(() => {
    statsRefreshTimer = 0;
    if (current) renderCtxChip();
    if (!$('ctxpop').classList.contains('hidden')) renderCtxPop();
  }, 250);
}

/** Snapshot puro do seletor de limite (ctx Svelte + testes). */
export function limitSnapshot(win, reserve, canEdit) {
  const options = [{ value: '', label: t('ctx.limit_default') }];
  let matched = '';
  for (const p of LIMIT_PRESETS) {
    const r = win ? Math.round(win * (100 - p) / 100) : 0;
    options.push({ value: String(p), label: r ? t('ctx.limit_pct', { p, r: fmtTokens(r) }) : p + '%' });
    if (reserve != null && r &&
        Math.abs(reserve - r) <= Math.max(1, win * 0.004)) matched = String(p);
  }
  if (reserve != null && !matched) options.push({ value: 'custom', label: t('ctx.limit_custom', { r: fmtTokens(reserve) }) });
  return {
    options,
    value: reserve == null ? '' : (matched || 'custom'),
    disabled: !canEdit || !(win > 0),
    title: t('ctx.limit_title'),
  };
}

/** Snapshot puro do agregado por sessão (ctx Svelte + testes). */
/** Snapshot puro do popover de contexto (Svelte + testes): blocos ordenados
 *  `{t:'row'|'alert'|'limit'|'agg'}`. `view` vem de `liveStatsView`. */
export function ctxSnapshot(view, opts) {
  const o = opts || {};
  const st = view.stats;
  if (!st || !st.tokens) return { empty: true, blocks: [] };
  const cu = st.contextUsage || {};
  const tok = st.tokens || {};
  const blocks = [];
  blocks.push({ t: 'row', k: t('ctx.window'),
    v: (cu.percent != null ? t('ctx.percent_used', { pct: Math.round(cu.percent) }) + ' · ' : '') +
      t('ctx.tokens_of', { used: fmtTokens(cu.tokens), win: fmtTokens(cu.contextWindow) }) });
  // Alerta por % do contexto: mesmo limiar do chip (70/90).
  if (cu.percent != null && Math.round(cu.percent) >= 70) {
    const pct = Math.round(cu.percent);
    blocks.push({ t: 'alert', kind: pct >= 90 ? 'danger' : 'warn',
      text: pct >= 90 ? t('ctx.alert_full', { pct }) : t('ctx.alert_warn', { pct }) });
  }
  blocks.push({ t: 'row', k: t('ctx.auto'), v: o.autoOn ? t('ctx.on') : t('ctx.off'), dim: true });
  const win = cu.contextWindow || o.win;
  blocks.push({ t: 'limit', win, limit: limitSnapshot(win, o.reserve, !!o.canEdit) });
  blocks.push({ t: 'row', k: t('ctx.cache'),
    v: t('ctx.cache_value', { r: fmtTokens(tok.cacheRead), w: fmtTokens(tok.cacheWrite) }), dim: true });
  const cacheRead = Number(tok.cacheRead) || 0;
  const rawIn = Number(tok.input) || 0;
  if (cacheRead + rawIn > 0) {
    blocks.push({ t: 'row', k: t('ctx.cache_hit'),
      v: t('ctx.cache_hit_value', { pct: Math.round((cacheRead / (cacheRead + rawIn)) * 100) }), dim: true });
  }
  blocks.push({ t: 'row', k: t('ctx.io'), v: fmtTokens(tok.input) + ' / ' + fmtTokens(tok.output) });
  // Velocidade média de geração (tok/s), não tokens de cache: `tokens.total`
  // soma cacheRead e não é "por mensagem". Só respostas com duração entram.
  const speed = avgMsgSpeed(o.messages);
  if (speed) blocks.push({ t: 'row', k: t('ctx.avg'), v: t('ctx.avg_value', { n: speed }), dim: true });
  if (view.billed || view.ctxDelta) {
    blocks.push({ t: 'row', k: t('ctx.live'),
      v: t('ctx.live_value', { b: fmtTokens(view.billed), c: fmtTokens(view.ctxDelta) }) });
  }
  blocks.push({ t: 'row', k: t('ctx.cost'), v: fmtCost(st.cost) });
  blocks.push({ t: 'row', k: t('ctx.messages'), v: String(st.totalMessages || 0), dim: true });
  // Composição estimada do contexto carregado (o que ocupa a janela).
  if (Array.isArray(o.messages) && o.messages.length) {
    const comp = ctxComposition(o.messages);
    if (comp.total > 0) blocks.push({ t: 'comp', comp });
  }
  return { empty: false, blocks };
}

function renderCtxPop() {
  if (ctxPop) ctxPop.sync();
}

/** Chip do contexto. O valor exibido soma o parcial do turno em voo (liveStatsView),
 *  então o % anda durante o streaming em vez de esperar o `message_end`. */
function renderCtxChip() {
  const btn = $('ctxbtn');
  const view = liveStatsView(sessionState && sessionState.stats, currentLive());
  const cu = view.stats.contextUsage;
  if (!cu || cu.percent == null) {
    btn.textContent = '—';
    btn.title = t('ctx.unavailable');
    btn.classList.remove('warn', 'danger');
    if (!$('ctxpop').classList.contains('hidden')) renderCtxPop();
    return;
  }
  const pct = Math.round(cu.percent);
  btn.textContent = pct + '% · ' + fmtTokens(cu.tokens) + '/' + fmtTokens(cu.contextWindow);
  btn.title = t('ctx.chip_title', { used: cu.tokens == null ? '?' : cu.tokens, win: cu.contextWindow, pct })
    + (view.billed ? t('ctx.chip_live', { b: view.billed }) : '')
    + t('ctx.chip_more');
  btn.classList.toggle('warn', pct >= 70 && pct < 90);
  btn.classList.toggle('danger', pct >= 90);
  if (!$('ctxpop').classList.contains('hidden')) renderCtxPop();
}

function updateStats(data, opts) {
  const fresh = !!(opts && opts.fresh);
  if (current) {
    sessionState = { ...(sessionState || {}), stats: data || {} };
    // Cache por sessão: o popover agrega tokens/custo sem pedir nada novo ao RPC.
    const tb = tabs.find(x => x.key === current.key);
    if (tb) {
      tb.stats = data || {};
      // Resposta do RPC depois do message_end: a mensagem já está persistida,
      // o parcial deixou de somar (evita contar duas vezes).
      if (fresh && tb.livePending) { tb.livePending = false; tb.live = null; }
    }
  }
  if (data && typeof data.autoCompactionEnabled === 'boolean') {
    sessionState = { ...(sessionState || {}), autoCompactionEnabled: data.autoCompactionEnabled, stats: data };
    $('autocompact').classList.toggle('on', data.autoCompactionEnabled);
  }
  renderCtxChip();
}

function closeModelPop() { $('modelpop').classList.add('hidden'); }

/* =============== desfazer fila / fork (criação) ===============
   Desfazer fila manda só `clear_queue` (docs/rpc-commands.md): o pi devolve
   {steering[], followUp[]} e o handler `clear_queue` existente restaura a última
   no composer. Sem `abort`: o turno continua.
   Fork cria sessão nova (runtimeHost.fork + rebindSession no pi): a original é
   preservada. Não rotular como desfazer — é criação. */
let pendingForkReload = false;
let pendingForkAnchor = null;

function normForkText(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120); }

function forkRowBtn(anchor, title) {
  const btn = el('button', 'tiny forkrow', 'fork');
  btn.title = title;
  btn.onclick = (e) => { e.stopPropagation(); forkFromAnchor(anchor); };
  return btn;
}

/** Fork a partir de uma linha: resolve o entryId via get_fork_messages (ordem + texto).
    Cai para o picker (openForkPop) quando não há match exato — nunca chuta entryId. */
function forkFromAnchor(anchor) {
  if (!current) return note(t('composer.no_session'));
  if (!current.connected) return note('sessão somente leitura — conecte para forkar');
  pendingForkAnchor = { uindex: anchor.uindex, utext: anchor.utext, key: current.key };
  sendCommand({ type: 'get_fork_messages' });
}

function resolveForkAnchor(msgs) {
  const a = pendingForkAnchor;
  pendingForkAnchor = null;
  if (!a || !current || current.key !== a.key) return false;
  const items = (msgs || []).filter(m => m && m.entryId);
  if (!items.length) return false;
  const want = normForkText(a.utext);
  let hit = null;
  if (want) {
    if (items[a.uindex] && normForkText(items[a.uindex].text) === want) hit = items[a.uindex];
    else hit = items.find(m => normForkText(m.text) === want) || null;
  } else if (items[a.uindex]) hit = items[a.uindex];
  if (!hit) return false;
  sendCommand({ type: 'fork', entryId: hit.entryId });
  return true;
}

/** Envia `clear_queue` sem `abort`: a fila volta ao composer, o turno continua. */
async function desfazerFila() {
  if (!current) return note(t('composer.no_session'));
  if (!current.connected && !(await ensureRpc())) return;
  const t = tabs.find(x => current && x.key === current.key);
  const empty = !(t && t.queue && t.queue.length) && !localRows(t).some(e => e.state === 'queued');
  if (empty) return note('nada na fila para desfazer');
  clearQueueNow(current.key);
}

function closeForkPop() { $('forkpop').classList.add('hidden'); }

/** Snapshot puro do picker de fork (pop Svelte + testes). */
export function forkSnapshot(messages) {
  const items = (messages || []).filter(m => m && m.entryId);
  return items.map(m => ({
    entryId: m.entryId,
    label: String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 120) || t('composer.notext'),
    short: String(m.entryId).slice(0, 8),
    title: (m.text || '') + '\n' + t('fork.title_suffix'),
  }));
}

function openForkPop(messages) {
  closeModelPop();
  if (!forkPop) return;
  forkPop.sync(messages);
  $('forkpop').classList.remove('hidden');
}

/* =============== limite de contexto para compactar ===============
   O pi só entende `compaction.reserveTokens` (folga abaixo do limite) e lê o
   settings.json na criação da sessão: gravar aqui vale no próximo reinício (↻).
   Nada é gravado enquanto o usuário não escolher — o padrão é o do próprio pi. */
const LIMIT_PRESETS = [70, 75, 80, 85, 90, 95];

function ctxWindow() {
  const cu = sessionState && sessionState.stats && sessionState.stats.contextUsage;
  const m = sessionState && sessionState.model;
  return (cu && cu.contextWindow) || (m && m.contextWindow) || 0;
}

/** Núcleo do save do limite (Svelte): IPC + `compactReserve` + texto p/ `note`. */
async function applyLimitValue(value, win) {
  const model = sessionState && sessionState.model;
  if (!current || !model || !(win > 0) || value === 'custom') return null;
  const pct = value === '' ? null : Number(value);
  const reserve = pct == null ? null : Math.max(0, Math.round(win * (100 - pct) / 100));
  try {
    const raw = await inv('compaction_set', {
      cwd: current.cwd,
      provider: model.provider,
      model: model.id,
      reserveTokens: reserve,
    });
    const st = JSON.parse(String(raw));
    compactReserve = typeof st.reserveTokens === 'number' ? st.reserveTokens : null;
    return pct == null
      ? t('ctx.limit_saved_default')
      : t('ctx.limit_saved', { pct, r: fmtTokens(compactReserve) });
  } catch (e) {
    return t('ctx.limit_fail', { e });
  }
}


async function refreshCompactLimit() {
  const model = sessionState && sessionState.model;
  if (!current || !model) { compactReserve = null; return; }
  try {
    const raw = await inv('compaction_get', {
      cwd: current.cwd,
      provider: model.provider,
      model: model.id,
    });
    const st = JSON.parse(String(raw));
    compactReserve = typeof st.reserveTokens === 'number' ? st.reserveTokens : null;
  } catch {
    compactReserve = null;
  }
  if (!$('ctxpop').classList.contains('hidden')) renderCtxPop();
}

function handleResponse(rec) {
  const data = rec.data || {};
  // Diagnóstico: latência do comando (só registra; o switch abaixo não muda).
  try {
    const t0 = diagPending.get(rec.id);
    if (t0 != null) diagPending.delete(rec.id);
    diagPush('\u2190 ' + (rec.command || '?'), t0 == null ? '—' : (Date.now() - t0) + 'ms', rec.success ? 'ok' : 'falhou');
  } catch { /* diagnóstico nunca quebra resposta */ }
  switch (rec.command) {
    case 'prompt': {
      // disposition: started | queued | handled. Só "queued" ganha a marca de fila.
      const entry = pendingPromptRows.get(rec.id);
      if (entry) {
        pendingPromptRows.delete(rec.id);
        if (data.disposition === 'queued') markRow(entry, 'queued');
      }
      break;
    }
    case 'clear_queue': {
      // Devolve o que estava enfileirado: a última volta para o composer.
      const back = [].concat(data.steering || [], data.followUp || []);
      const ct = tabs.find(x => current && x.key === current.key);
      queueClearing = null; // resposta chegou: o próximo queue_update volta a valer como entrega
      if (ct) {
        ct.queue = [];
        // Nada disso foi entregue: a fila voltou para o composer, então as rows em
        // fila saem do transcript em vez de ficarem presas como "entregue".
        dropQueuedRows(ct);
      }
      if (!back.length) break;
      note(t('queue.restored', { n: back.length }));
      const last = back.at(-1);
      $('input').value = last;
      autosizeInput();
      const qtab = tabs.find(x => x.key === current.key);
      if (qtab) qtab.draft = last;
      break;
    }
    case 'get_fork_messages': {
      // Lista para fork (getUserMessagesForForking no pi): mensagens do usuário
      // forkáveis com entryId. Escolher cria sessão nova (case 'fork').
      const msgs = (data && data.messages) || [];
      // Vinda de botão por linha: tenta resolver direto; sem match, cai no picker.
      if (pendingForkAnchor) {
        const akey = pendingForkAnchor.key;
        if (!current || current.key !== akey) { pendingForkAnchor = null; break; }
        if (resolveForkAnchor(msgs)) break;
        note(t('fork.no_match'));
      }
      if (!msgs.length) { note(t('composer.nothing_fork')); break; }
      openForkPop(msgs);
      break;
    }
    case 'fork': {
      // Criação, não desfazer: o pi troca o RPC para o arquivo novo (rebindSession)
      // e a original continua no disco. Posição "before": o texto volta ao composer.
      if (rec.success === false) { note(t('fork.failed')); break; }
      if (data.cancelled) { note(t('fork.cancelled')); break; }
      const ft = data.text || '';
      if (ft) {
        $('input').value = ft;
        autosizeInput();
        const ft0 = tabs.find(x => current && x.key === current.key);
        if (ft0) ft0.draft = ft;
      }
      note(t('fork.created') + (ft ? t('fork.restored') : ''));
      pendingForkReload = true;
      sendCommand({ type: 'get_state' });
      break;
    }
    case 'get_messages': {
      // Não deixa uma resposta vazia do RPC apagar o histórico já renderizado do disco.
      if (Array.isArray(data.messages) && data.messages.length) {
        renderMessages(data);
        const mt = tabs.find(x => current && x.key === current.key);
        const partial = [...data.messages].reverse()
          .find(m => m && m.role === 'assistant' && m.stopReason === 'pending');
        if (mt && mt.working && partial) {
          mt.live = {
            billed: liveTurnTokens(partial),
            context: estimateMessageTokens(partial),
            at: Date.now(),
          };
        } else if (mt && !mt.working) {
          mt.live = null;
          mt.livePending = false;
        }
        renderCtxChip();
      }
      break;
    }
    case 'get_state':
      sessionState = data;
      if (current) { const tb = tabs.find(x => x.key === current.key); if (tb) { if (data.model) tb.model = data.model; if (data.thinkingLevel) tb.thinkingLevel = data.thinkingLevel; } }
      // Thinking é por sessão/modelo: pede a lista certa sempre, não só após set_model.
      sendCommand({ type: 'get_available_thinking_levels' });
      if (data.model) updateModelButton(data.model);
      // Arquivo real da sessão: sessão nova só ganha `.jsonl` na 1ª mensagem.
      if (data.sessionFile) {
        const dir = data.sessionFile.replace(/\.jsonl$/, '');
        if (activeTab) { activeTab.file = data.sessionFile; activeTab.childrenDir = dir; }
        if (current) { current.file = data.sessionFile; current.childrenDir = dir; }
        // Sessão criada com `+ Nova` nasce sem childrenDir: sem isto o painel de
        // subagents fica sem origem e nunca lista nada até reabrir pela sidebar.
        if (current) loadChildren(dir);
        loadGit(); loadEdits(); loadPlans();
        // Pós-fork: abre a sessão nova resultante (histórico + sidebar).
        if (pendingForkReload) {
          pendingForkReload = false;
          loadSessions();
          loadHistoryFromDisk(data.sessionFile);
        }
      }
      fillLevels(null);
      $('autocompact').classList.toggle('on', data.autoCompactionEnabled !== false);
      break;
    case 'get_session_stats':
      updateStats(data, { fresh: true });
      // Só narra no transcript quando o usuário pediu (/session ou chip de contexto).
      if (statsNoteRequested && data && data.tokens) {
        statsNoteRequested = false;
        const c = typeof data.cost === 'number' ? ' · US$ ' + data.cost.toFixed(2) : '';
        $('log').appendChild(el('div', 'row note',
          t('stats.note', { msgs: data.totalMessages, tokens: data.tokens.total, cost: c })));
      }
      break;
    case 'get_last_assistant_text': {
      const text = (data && (data.text || data.content)) || '';
      if (!text) { $('log').appendChild(el('div', 'row note', t('composer.no_answer'))); break; }
      inv('copy_text', { text })
        .then(() => $('log').appendChild(el('div', 'row note', t('copy.done', { n: text.length }))))
        .catch((e) => $('log').appendChild(el('div', 'row note', t('composer.copy_fail', { e }))));
      break;
    }
    case 'cycle_thinking_level':
      $('log').appendChild(el('div', 'row note',
        data && data.level ? t('think.set', { level: data.level }) : t('think.none')));
      if (data && data.level) {
        sessionState = { ...(sessionState || {}), thinkingLevel: data.level };
        if (current) { const tb = tabs.find(x => x.key === current.key); if (tb) tb.thinkingLevel = data.level; }
        fillLevels(null);
      }
      break;
    case 'set_model':
      // Níveis de thinking são por modelo (xhigh/max só existem em alguns): sem isto
      // a lista continuava sendo a do modelo anterior e o xhigh nunca aparecia.
      if (rec.success) {
        sendCommand({ type: 'get_available_thinking_levels' });
        sendCommand({ type: 'get_state' });
      } else {
        $('log').appendChild(el('div', 'row note', t('model.set_fail')));
      }
      break;
    case 'compact':
      endCompact(rec.success ? t('compact.done') : t('compact.fail'));
      break;
    case 'export_html':
      $('log').appendChild(el('div', 'row note', t('export.done', { x: ((data && (data.path || data.outputPath)) || 'ok') })));
      break;
    case 'set_session_name':
      $('log').appendChild(el('div', 'row note', t('sess.renamed')));
      break;
    case 'abort':
      $('log').appendChild(el('div', 'row note', t('turn.interrupted')));
      setStatus('pronto');
      setTurn(current && current.key, false);
      setState('ready');
      break;
    default:
      // Nenhum comando pode ser silencioso: se não há handler específico, registra o resultado.
      if (rec.command) {
        $('log').appendChild(el('div', 'row note',
          rec.command + ': ' + (rec.success ? 'ok' : 'falhou')));
      }
      break;
    case 'get_available_models':
      fillModels(data.models || [], !allModels.length ? data.models && data.models[0] : null);
      break;
    case 'get_available_thinking_levels':
      fillLevels(data.levels || []);
      if (current) { const tb = tabs.find(x => x.key === current.key); if (tb) tb.levelList = (data.levels || []).slice(); }
      break;
    case 'get_commands':
      saveCommands(data.commands || []);
      checkCommands(data.commands || []);
      renderPalette();
      break;
  }
}

function sendCommand(payload) {
  if (!current) { note(t('composer.no_session')); return; }
  payload.id = 'ui-' + (++seq);
  // Diagnóstico: marca o envio para medir a latência na resposta.
  try { diagPending.set(payload.id, Date.now()); diagPush('\u2192 ' + (payload.type || '?'), '—', payload.id); } catch { /* ignora */ }
  inv('rpc_command', { sessionId: current.key, payload: JSON.stringify(payload) })
    .catch((e) => {
      note('falha ao enviar ' + (payload.type || 'comando') + ': ' + e);
      if (payload.type === 'compact') resetCompact();
    });
}

/* =============== detalhe do subagent =============== */
function parseSessionFile(raw) {
  const messages = [];
  let meta = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let rec = null;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec) continue;
    if (rec.type === '__deck_meta') { meta = rec; continue; }
    if (rec.type === 'message' && rec.message) messages.push(rec.message);
  }
  return { messages, meta };
}

let loadedConsumed = 0;

/** Zera a paginação da view (contador + barra) em toda troca de sessão. */
function resetPaged() {
  loadedConsumed = 0;
  const bar = $('loadmore');
  if (bar) bar.classList.add('hidden');
}

/** Arquivos editados são da sessão: a lista não sobrevive à troca. */
function resetFiles() {
  editedFiles = [];
  fileList = [];
  filesError = '';
  syncFiles();
  // Aba visível na troca: relê com o `current` novo (os chamadores já o setaram ou zeraram).
  const pane = $('files');
  if (pane && !pane.classList.contains('hidden')) queueMicrotask(loadFiles);
}

function updateLoadMore(meta) {
  const bar = $('loadmore');
  if (!meta || !meta.hasMore) {
    bar.classList.add('hidden');
    return;
  }
  loadedConsumed = meta.consumed || messages0(meta);
  const left = Math.max(0, (meta.total || 0) - loadedConsumed);
  $('loadmorebtn').textContent = 'carregar anteriores (' + left + ' de ' + (meta.total || 0) + ')';
  bar.classList.remove('hidden');
}

let lastMessages = [];

/** Composição estimada do contexto por categoria (chars/4, mesma heurística). */
export function ctxComposition(messages) {
  const out = { system: 0, user: 0, assistant: 0, tools: 0, total: 0 };
  for (const m of messages || []) {
    if (!m) continue;
    let text = 0;
    let tool = 0;
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (!b) continue;
      if (b.type === 'text' || b.type === 'thinking') text += String(b.text || b.thinking || '').length;
      else if (b.type === 'toolCall') {
        tool += String(b.name || '').length;
        try { tool += JSON.stringify(b.arguments || {}).length; } catch { /* parcial */ }
      } else if (b.type === 'toolResult') {
        tool += String(b.text || '').length;
        try { tool += JSON.stringify(b.content || '').length; } catch { /* parcial */ }
      }
    }
    const tk = Math.ceil(text / 4);
    const tl = Math.ceil(tool / 4);
    if (m.role === 'system') out.system += tk + tl;
    else if (m.role === 'user') out.user += tk;
    else if (m.role === 'assistant') { out.assistant += tk; out.tools += tl; }
    else out.tools += tk + tl;
  }
  out.total = out.system + out.user + out.assistant + out.tools;
  return out;
}

function messages0(meta) {
  // `oversized` agora só conta mensagens truncadas (continuam no histórico).
  return (meta.total || 0) - (meta.omitted || 0);
}

async function loadEarlier() {
  const file = current && current.file;
  if (!file) return;
  const seq = viewSeq;
  const btn = $('loadmorebtn');
  btn.disabled = true;
  btn.textContent = 'carregando…';
  try {
    const raw = await inv('read_session_messages', { path: file, limit: 250, skip: loadedConsumed });
    if (seq !== viewSeq) return; // trocou de sessão: não insere no log novo
    const { messages, meta } = parseSessionFile(raw);
    if (!messages.length) { updateLoadMore(meta); return; }

    const tmp = document.createElement('div');
    renderMessages({ messages }, { target: tmp, store: new Map() }, false);

    const log = $('log');
    const beforeHeight = log.scrollHeight;
    const anchor = log.firstChild;
    for (const node of Array.from(tmp.childNodes)) log.insertBefore(node, anchor);
    log.scrollTop += log.scrollHeight - beforeHeight;

    updateLoadMore(meta);
    updateScrollBtn();
  } catch (e) {
    if (seq !== viewSeq) return; // erro da sessão anterior não aparece na nova
    $('log').appendChild(el('div', 'row note', String(e)));
  } finally {
    btn.disabled = false;
  }
}

async function loadHistoryFromDisk(file) {
  const seq = viewSeq;
  try {
    loadedConsumed = 0;
    const raw = await inv('read_session_messages', { path: file, limit: 250 });
    // Troquei de sessão durante a leitura: este histórico não é mais da view.
    if (seq !== viewSeq) return;
    const { messages, meta } = parseSessionFile(raw);
    if (messages.length) renderMessages({ messages }, null, true);
    updateLoadMore(meta);
    if (current && !messages.length) setEmptyState(true, 'newsession');
  } catch { /* o RPC ainda pode preencher */ }
}

async function openChild(c) {
  if (!c || !c.file) return;
  const seq = viewSeq;
  const host = $('detaillog');
  setEmpty(host, 'carregando transcript…');
  $('detailtitle').textContent = (c.label || c.id.slice(0, 8)) + '  ·  ' + c.run;
  $('detail').classList.remove('hidden');

  try {
    const raw = await inv('read_session_messages', { path: c.file });
    if (seq !== viewSeq) return;
    const { messages } = parseSessionFile(raw);
    if (!messages.length) {
      setEmpty(host, 'transcript vazio (arquivo sem mensagens)');
      return;
    }
    renderMessages({ messages }, { target: host, store: new Map() }, false);
  } catch (e) {
    if (seq !== viewSeq) return;
    setEmpty(host, String(e));
  }
}

function closeDetail() { $('detail').classList.add('hidden'); }

/* =============== recarregar o pi (sem comando RPC: reinicia processo) =============== */
async function reloadSession() {
  if (!current) return;
  const { key, cwd, childrenDir, refValue, refFlag } = current;
  setStatus('recarregando…');
  try { await inv('stop_session', { sessionId: key }); } catch { /* já parado */ }
  current = null;
  sessionState = null;
  allModels = [];
  await start(cwd, key, refValue, refFlag, childrenDir);
}

/* =============== abas =============== */
/** Altura do composer acompanha o texto (digitação e colagem), com teto de 40% da
    viewport: colar um log enorme não pode engolir o transcript. Mesmo teto do CSS
    (`max-height:40vh`), que fica só como rede de segurança. */
function autosizeInput() {
  const box = $('input');
  if (!box) return;
  box.style.height = 'auto';
  const max = Math.min(Math.round(window.innerHeight * 0.40), 400);
  box.style.height = Math.min(box.scrollHeight, max) + 'px';
}

/** O composer é da aba: guarda o rascunho (texto + imagens) antes de sair. */
function stashDraft() {
  const t = current && tabs.find(x => x.key === current.key);
  if (!t) return;
  t.draft = $('input').value;
  t.images = pendingImages.slice();
  // Resposta parcial em andamento: guarda por aba para reanexar ao voltar.
  if (stream && stream.text) t.streamText = String(stream.text).slice(-STREAM_CAP);
  saveTabs();
}

/** Restaura o rascunho da aba que entrou em foco (vazio para aba nova). */
function restoreDraft(t) {
  $('input').value = (t && t.draft) || '';
  // No próximo tick: a aba acabou de entrar em foco e o painel ainda está sendo
  // medido — `scrollHeight` de um elemento recém-exibido viria 0.
  setTimeout(autosizeInput, 0);
  pendingImages = (t && Array.isArray(t.images) ? t.images : []).slice();
  renderAttachments();
  hidePalette();
}

/** Estado da aba: turno rodando manda mais que a conexão. */
function tabState(t) {
  if (t.working) return { label: 'running', dot: ' busy' };
  if (t.connected) return { label: 'conectado', dot: ' live' };
  return { label: 'somente leitura', dot: '' };
}

/** Snapshot puro da barra de abas (Svelte + testes). */
export function tabsSnapshot(list, active) {
  return (list || []).map(t => {
    const st = tabState(t);
    return {
      key: t.key,
      active: !!(active && t.key === active.key),
      dot: st.dot,
      project: projectName(t.cwd),
      title: t.label || prettyId(t.key),
      titleAttr: projectName(t.cwd) + '\n' + (t.cwd || '—') + '\n' + t.key + '\n' + st.label,
    };
  });
}

function renderTabs() {
  // Toda mutação de aba passa por aqui: persiste sem RPC novo.
  saveTabs();
  if (tabBar) tabBar.sync();
}

async function switchTab(key) {
  const t = tabs.find(x => x.key === key);
  if (!t || (current && current.key === key)) return;

  stashDraft();
  viewSeq++;
  resetPaged();
  current = { key: t.key, cwd: t.cwd, childrenDir: t.childrenDir, refValue: t.refValue, refFlag: t.refFlag, file: t.file, connected: !!t.connected };
  reconcileTerminal();
  activeTab = t;
  cards.clear();
  // pendingPromptRows NÃO é limpo aqui: a resposta do prompt pode chegar depois da
  // troca de aba e ainda precisa marcar a linha como "na fila".
  lastSnap = null;
  lastDiskList = null;
  resetFiles();
  stream = null;
  sessionState = null;
  // Troca de sessão: nunca pinta a lista de thinking da sessão anterior.
  levelList = [];
  fillLevels([]);
  if (Array.isArray(t.levelList) && t.levelList.length) fillLevels(t.levelList.slice());
  if (t.model) { sessionState = { model: t.model, thinkingLevel: t.thinkingLevel || null }; updateModelButton(t.model); }
  // Chip de contexto é por sessão: repinta do cache e o get_session_stats abaixo atualiza.
  if (t.stats) { sessionState = { ...(sessionState || {}), stats: t.stats }; updateStats(t.stats); }
  clear($('log'));
  // O restore NÃO roda aqui: com o log recém-limpo o `seen` está vazio e tudo
  // voltaria para o fim. `renderMessages` já o chama depois de pintar (o caminho do
  // disco e o do `get_messages` passam por lá); a chamada abaixo cobre a aba sem
  // histórico, e é inofensiva se um render chegar depois — ele limpa e repinta.
  renderTabs();
  setStatus(t.connected ? 'conectado · ' + prettyId(t.key) : 'somente leitura');
  setState(t.connected ? 'ready' : 'off');
  applyTurnUi();
  restoreDraft(t);

  if (t.file) await loadHistoryFromDisk(t.file);
  restoreLocalRows();
  // Aba que entra em foco com turno rodando: stats (tokens/contexto) em tempo real.
  if (t.working) ensureStatsPoll();
  // Sempre confirma o processo antes de falar com ele (a flag `connected` pode estar
  // velha após exit/evicção). ensureRpc devolve true na hora se já está vivo.
  if (await ensureRpc()) {
    sendCommand({ type: 'get_messages' });
    sendCommand({ type: 'get_state' });
    sendCommand({ type: 'get_session_stats' });
  }
  if (t.childrenDir) await loadChildren(t.childrenDir);
  loadGit(); loadEdits(); loadPlans();
}

async function closeTab(key) {
  try { await inv('stop_session', { sessionId: key }); } catch { /* já parado */ }
  stopLive(key);
  // Aba fechada leva os avisos junto: reabrir a mesma key não pode herdar chip velho.
  healthBySession.delete(key);
  // A central de notificações soma todas as sessões: fechar uma aba tira os
  // avisos dela da contagem.
  renderNotify();
  // Aba fechada sai do vigia: sem isto uma sonda pendente poderia destravar a chave
  // reaberta logo depois (mesma key, outro processo).
  delete lastProbeAt[key];
  const wasActive = current && current.key === key;
  tabs = tabs.filter(t => t.key !== key);

  if (wasActive) {
    // Geração nova: leitura em voo da aba fechada não pode pintar na view vazia.
    viewSeq++;
    current = null;
    activeTab = null;
    cards.clear();
    pendingPromptRows.clear();
    lastSnap = null;
    lastDiskList = null;
    resetPaged();
    resetFiles();
    clear($('log'));
    const next = tabs[tabs.length - 1];
    renderTabs();
    if (next) await switchTab(next.key);
    else { setStatus('desconectado'); setTyping(false); renderHealthChip(); }
    return;
  }
  renderTabs();
}

/* =============== persistência de abas/stream (só localStorage) =============== */
const TABS_KEY = 'tabs-v1';
const DRAFT_CAP = 10000;
const STREAM_CAP = 30000;
let lastTabsSave = 0;

/** Serializa as abas (só dados: sem DOM, sem imagens, sem flags vivas). */
function saveTabs() {
  try {
    const slim = tabs.map(t => ({
      key: t.key, cwd: t.cwd || null, childrenDir: t.childrenDir || null,
      refValue: t.refValue || null, refFlag: t.refFlag || '--session',
      file: t.file || null, label: t.label || '',
      draft: String(t.draft || '').slice(-DRAFT_CAP),
      streamText: String(t.streamText || '').slice(-STREAM_CAP),
      model: t.model || null, thinkingLevel: t.thinkingLevel || null,
      levelList: Array.isArray(t.levelList) ? t.levelList.slice(0, 50) : [],
      stats: t.stats || null,
      queue: Array.isArray(t.queue) ? t.queue.slice(0, 20) : [],
    }));
    const activeKey = activeTab ? activeTab.key : (current ? current.key : null);
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: slim, activeKey }));
    lastTabsSave = Date.now();
  } catch { /* quota ou webview sem storage: a sessão segue em memória */ }
}

/** Economiza escrita durante o stream: persiste no máximo a cada 3s. */
function maybeSaveTabs() {
  if (Date.now() - lastTabsSave > 3000) saveTabs();
}

/** Restaura as abas como somente leitura: nada conecta aqui, o foco reconecta via ensureRpc. */
function restoreTabs() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(TABS_KEY) || 'null'); } catch { raw = null; }
  const list = raw && Array.isArray(raw.tabs) ? raw.tabs : [];
  tabs = list
    .filter(t => t && typeof t.key === 'string' && t.key)
    .map(t => ({
      key: t.key, cwd: t.cwd || null, childrenDir: t.childrenDir || null,
      refValue: t.refValue || null, refFlag: t.refFlag || '--session',
      file: t.file || null, label: t.label || '', draft: t.draft || '',
      images: [], streamText: t.streamText || '', thinkText: '',
      model: t.model || null, thinkingLevel: t.thinkingLevel || null,
      levelList: Array.isArray(t.levelList) ? t.levelList : [],
      stats: t.stats || null, queue: Array.isArray(t.queue) ? t.queue : [],
      connected: false, working: false, phase: '',
    }));
  const key = raw && raw.activeKey;
  activeTab = tabs.find(t => t.key === key) || null;
  renderTabs();
}

/** true se o log já mostra esse thinking: o disco trouxe e o parcial seria duplicata. */
function logHasThinking(text) {
  const head = String(text || '').trim().slice(0, 120);
  if (!head) return false;
  return Array.from($('log').querySelectorAll('.think-body'))
    .some(n => String(n.textContent || '').trim().startsWith(head));
}

/** Blocos markdown do turno atual: depois da última `.row.user`. Evita casar
 *  com resposta de um turno anterior que começa/termina igual ("Ok", "Feito"). */
function turnAnswerBodies() {
  const log = $('log');
  const users = log.querySelectorAll('.row.user');
  const lastUser = users.length ? users[users.length - 1] : null;
  return Array.from(log.querySelectorAll('.md-body')).filter(body =>
    !lastUser || (lastUser.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING));
}

/** Último bloco markdown DO TURNO ATUAL cujo texto já contém o parcial. */
export function renderedAnswerNode(partial) {
  if (!normalizeRowText(partial)) return null;
  const bodies = turnAnswerBodies();
  for (let i = bodies.length - 1; i >= 0; i--) {
    const md = String(bodies[i]._md || bodies[i].textContent || '');
    if (answerAlreadyRendered(partial, [md])) return bodies[i];
  }
  return null;
}

/** true se o turno atual já mostra esse texto: o disco/RPC trouxe e o parcial seria
 *  duplicata. Compara pela cauda (normalizada) porque `t.streamText` é cortado em
 *  `STREAM_CAP` (`slice(-cap)`), então a cabeça pode não existir no log. */
export function logHasText(text) {
  const tail = normalizeRowText(text).slice(-120);
  if (!tail) return false;
  return turnAnswerBodies()
    .some(n => normalizeRowText(n._md || n.textContent || '').endsWith(tail));
}

/** Decisão do reattach, separada do DOM para ser testável:
 *  `drop-turn` (turno encerrado, o disco manda), `thinking` (só thinking em voo),
 *  `anchor` (o bloco já pintado é a continuação — vence `drop-tail`),
 *  `drop-tail` (parcial truncado é sufixo do que já está no log) ou `append`. */
export function reattachPlan({ working, streamText, renderedBody, tailInLog }) {
  if (!working) return 'drop-turn';
  if (!normalizeRowText(streamText)) return 'thinking';
  if (renderedBody) return 'anchor';
  if (tailInLog) return 'drop-tail';
  return 'append';
}

/** Reanexa o parcial da aba ao voltar (o histórico do disco não o tem). */
function reattachStream() {
  if (stream || !current) return;
  const t = tabs.find(x => x.key === current.key);
  if (!t) return;
  // Thinking do turno em voo: `renderMessages` acima só pintou o que está no disco.
  let thinkBody = null;
  if (t.working && t.thinkText && !logHasThinking(t.thinkText)) {
    const wrap = thinkBlock(t.thinkText);
    $('log').appendChild(wrap);
    thinkBody = wrap.querySelector('.think-body');
  }
  // Âncora antes do descarte: ancorar mantém um único bloco (o parcial truncado
  // que só é sufixo do log vem depois, em `drop-tail`).
  const existing = renderedAnswerNode(t.streamText);
  const plan = reattachPlan({
    working: t.working,
    streamText: t.streamText,
    renderedBody: !!existing,
    tailInLog: logHasText(t.streamText),
  });
  if (plan === 'drop-turn') {
    t.streamText = '';
    t.thinkText = '';
    return;
  }
  if (plan === 'thinking') {
    if (thinkBody) stream = { node: null, text: '', thinkBody };
    return;
  }
  if (plan === 'anchor') {
    const text = String(existing._md || t.streamText);
    stream = { node: existing, text, thinkBody };
    t.streamText = text.slice(-STREAM_CAP);
    return;
  }
  if (plan === 'drop-tail') {
    t.streamText = '';
    if (thinkBody) stream = { node: null, text: '', thinkBody };
    return;
  }
  const row = mdRow();
  setMarkdown(row.body, t.streamText);
  $('log').appendChild(row.root);
  stream = { node: row.body, text: t.streamText, thinkBody };
  scrollBottom(true);
}

/* =============== comandos do app (não vão para o modelo) =============== */

/** Interrompe o turno atual (comando `/abort` e Esc).
 *  Esvazia a fila antes: o `abort` do pi continua mensagens enfileiradas
 *  (docs/rpc-commands.md §clear_queue), então sem isto o turno seguinte começaria sozinho. */
function abortTurn() {
  if (current && current.key) clearQueueNow(current.key);
  else sendCommand({ type: 'clear_queue' });
  sendCommand({ type: 'abort' });
}

const APP_COMMANDS = [
  { name: 'compact', description: t('cmd.compact'), app: true, needsRpc: true,
    run: (a) => sendCommand(a ? { type: 'compact', customInstructions: a } : { type: 'compact' }) },
  { name: 'model', description: t('cmd.model'), app: true,
    run: (a) => runModelArg(a) },
  { name: 'thinking', description: t('cmd.thinking'), app: true, needsRpc: true,
    run: () => sendCommand({ type: 'cycle_thinking_level' }) },
  { name: 'new', description: t('cmd.new'), app: true,
    run: () => newSessionIn(current ? current.cwd : (homeDir || '/')) },
  { name: 'name', description: t('cmd.name'), app: true, needsRpc: true,
    run: (a) => {
      if (!a) return note(t('cmd.name_usage'));
      const named = tabs.find(x => current && x.key === current.key);
      if (named) { named.label = a; renderTabs(); }
      sendCommand({ type: 'set_session_name', name: a });
    } },
  { name: 'session', description: t('cmd.session'), app: true, needsRpc: true,
    run: () => { statsNoteRequested = true; sendCommand({ type: 'get_session_stats' }); } },
  { name: 'copy', description: t('cmd.copy'), app: true, needsRpc: true,
    run: () => sendCommand({ type: 'get_last_assistant_text' }) },
  { name: 'export', description: t('cmd.export'), app: true, needsRpc: true,
    run: () => sendCommand({ type: 'export_html' }) },
  { name: 'abort', description: t('cmd.abort'), app: true, needsRpc: true,
    run: abortTurn },
  { name: 'desfazer', description: t('cmd.unqueue'), app: true, needsRpc: true,
    run: () => desfazerFila() },
  { name: 'fork', description: t('cmd.fork'), app: true, needsRpc: true,
    run: () => sendCommand({ type: 'get_fork_messages' }) },
  { name: 'login', description: t('cmd.login'), app: true,
    run: (a) => (a ? startLogin(a) : openProvPicker()) },
];

/* Nomes dos comandos do app → chave do catálogo. `description` acima congela no
   idioma do boot; a troca de idioma (langsel) re-resolve via este mapa. */
const CMD_KEYS = { compact: 'cmd.compact', model: 'cmd.model', thinking: 'cmd.thinking',
  new: 'cmd.new', name: 'cmd.name', session: 'cmd.session', copy: 'cmd.copy',
  export: 'cmd.export', abort: 'cmd.abort', desfazer: 'cmd.unqueue', fork: 'cmd.fork',
  login: 'cmd.login' };

function note(text) {
  $('log').appendChild(el('div', 'row note', String(text)));
  scrollBottom(true);
}

/** Reconhece `/nome args` como comando do app. */
function parseAppCommand(text) {
  const m = String(text).match(/^\/([A-Za-z0-9:_-]+)\s*([\s\S]*)$/);
  if (!m) return null;
  const cmd = APP_COMMANDS.find(c => c.name === m[1]);
  return cmd ? { cmd, args: m[2].trim() } : null;
}

/* ===== fuzzy + recentes + /model com args (base da paleta global) ===== */
/** Subsequência com bônus de prefixo/contiguidade; -1 = não casa. */
function fuzzyScore(hay, q) {
  if (!q) return 0;
  let score = 0, hi = 0, streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const at = hay.indexOf(q[qi], hi);
    if (at < 0) return -1;
    if (at === hi) { streak++; score += 10 + streak * 5; }
    else { streak = 0; score += at === 0 ? 8 : 1; }
    if (at > 0 && /[\s\/_:-]/.test(hay[at - 1])) score += 4;
    hi = at + 1;
  }
  if (hay.startsWith(q)) score += 20;
  return score - hay.length * 0.01;
}

const RECENT_KEY = 'palette-recent';
const RECENT_MAX = 10;
let recentList = null;

function loadRecents() {
  if (recentList) return recentList;
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    recentList = Array.isArray(raw) ? raw.filter(x => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch { recentList = []; }
  return recentList;
}

function saveRecents() {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(loadRecents())); } catch { /* sem storage */ }
}

/** Guarda `/comando [args]` no topo, sem duplicar, no máximo RECENT_MAX. */
function pushRecent(entry) {
  const e = String(entry || '').trim();
  if (!e) return;
  recentList = [e, ...loadRecents().filter(x => x !== e)].slice(0, RECENT_MAX);
  saveRecents();
}

function recentRank(entry) {
  const i = loadRecents().indexOf(entry);
  return i < 0 ? 999 : i;
}

const cmdk = { open: false, items: [], index: 0 };

/** Troca efetiva de modelo (seletor, /model <busca> e paleta global usam o mesmo). */
async function applyModel(m) {
  if (!m || !m.id) return;
  if (!current || !current.connected) {
    if (!(await ensureRpc())) return;
  }
  sendCommand({ type: 'set_model', provider: m.provider, modelId: m.id });
  sessionState = { ...(sessionState || {}), model: m };
  if (current) { const tb = tabs.find(x => x.key === current.key); if (tb) tb.model = m; }
  updateModelButton(m);
  pushRecent('/model ' + m.id);
  closeModelPop();
}

function findModels(q) {
  const needle = String(q || '').toLowerCase().trim();
  if (!needle || !Array.isArray(allModels)) return [];
  const exact = allModels.filter(m => m && m.id && String(m.id).toLowerCase() === needle);
  if (exact.length) return exact.slice(0, 10);
  return allModels
    .filter(m => m && m.id)
    .map(m => ({ m, s: fuzzyScore((m.id + ' ' + (m.name || '') + ' ' + (m.provider || '')).toLowerCase(), needle) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 10)
    .map(x => x.m);
}

/** `/model` sem args abre o seletor; com args tenta casar direto no catálogo. */
function runModelArg(args) {
  const q = String(args || '').trim();
  if (!q) { $('modeltoggle').click(); return; }
  const hits = findModels(q);
  if (hits.length === 1) { applyModel(hits[0]); return; }
  if ($('modelpop').classList.contains('hidden')) $('modeltoggle').click();
  renderModelList(q);
  if (!hits.length) note(t('model.not_found', { q }));
  else note(hits.length + ' modelos para "' + q + '" — escolha no seletor');
}

/* =============== paleta de comandos (/) =============== */
let commandsCache = [];
const palette = { open: false, items: [], index: 0 };

function loadCachedCommands() {
  try {
    const c = JSON.parse(localStorage.getItem('commands-cache') || '[]');
    if (Array.isArray(c)) commandsCache = c;
  } catch { /* ignora */ }
}

function saveCommands(list) {
  commandsCache = list;
  try { localStorage.setItem('commands-cache', JSON.stringify(list)); } catch { /* sem storage */ }
}

/** Token `/algo` no fim do composer, sem espaço depois da barra. */
function slashToken() {
  const v = $('input').value;
  const m = v.match(/(^|\s)\/([^\s]*)$/);
  if (!m) return null;
  return { prefix: m[2], start: v.length - m[2].length };
}

function hidePalette() {
  if (cmdk.open) return; // paleta global gerencia o próprio ciclo
  palette.open = false;
  $('palette').classList.add('hidden');
}

/** Snapshot puro da palette de `/` (Svelte + testes). */
export function paletteSnapshot(items, index) {
  return {
    rows: (items || []).map((c, i) => ({
      idx: i,
      name: '/' + c.name,
      desc: c.description || '',
      src: c.app ? 'pi' : (c.source || ''),
      sel: i === index,
    })),
  };
}

function renderPalette() {
  const tok = slashToken();
  if (!tok) { hidePalette(); return; }

  // Primeira vez sem cache: precisa de sessão viva para pedir get_commands.
  if (!commandsCache.length) {
    ensureRpc().then((ok) => { if (ok) sendCommand({ type: 'get_commands' }); });
  }

  const q = tok.prefix.toLowerCase().slice(0, 120); // teto anti-jank em colagem gigante
  const seen = new Set();
  const items = [...APP_COMMANDS, ...commandsCache]
    .filter(c => {
      if (!c || !c.name) return false;
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return !q || fuzzyScore(key, q) >= 0;
    })
    .sort((a, b) => {
      if (q) {
        const sa = fuzzyScore(a.name.toLowerCase(), q);
        const sb = fuzzyScore(b.name.toLowerCase(), q);
        if (sa !== sb) return sb - sa;
      }
      // Sem busca (ou empate): recentes primeiro, depois alfabético.
      const ra = recentRank('/' + a.name);
      const rb = recentRank('/' + b.name);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 60);

  if (!items.length) { hidePalette(); return; }

  palette.items = items;
  palette.open = true;
  if (palette.index >= items.length) palette.index = 0;

  $('palette').classList.remove('hidden');
  // Palette `/` e cmdk dividem o overlay: a lista visível é a da palette.
  $('cmdklist').classList.add('hidden');
  $('palettelist').classList.remove('hidden');
  if (palettePane) palettePane.sync();
}

function applyPaletteItem(run) {
  const tok = slashToken();
  const cmd = palette.items[palette.index];
  if (!tok || !cmd) return;

  const v = $('input').value;
  const head = v.slice(0, tok.start - 1);
  $('input').value = head + '/' + cmd.name + ' ';
  autosizeInput();
  hidePalette();
  renderPalette(); // some com o token completo
  $('input').focus();
  if (run) send();
}

/* =============== paleta global (Cmd-K / Ctrl-K) =============== */
function cmdkCandidates() {
  const out = [];
  const seen = new Set();
  for (const c of [...APP_COMMANDS, ...commandsCache]) {
    if (!c || !c.name || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({ kind: 'cmd', cmd: c, title: '/' + c.name,
      desc: c.description || '', src: c.app ? 'pi' : (c.source || '') });
  }
  return out;
}

/** Snapshot puro do cmdk (Svelte + testes): grupos com linhas e seleção plana. */
export function cmdkSnapshot(groups, index) {
  let k = 0;
  const out = (groups || []).map(g => ({
    label: g.label || '',
    rows: (g.rows || []).map(it => {
      const idx = k++;
      return { idx, title: it.title, desc: it.desc || '', src: it.src || '', sel: idx === index };
    }),
  }));
  const total = out.reduce((n, g) => n + g.rows.length, 0);
  return { groups: out, empty: total === 0, emptyLabel: t('palette.empty') };
}

export function openCmdk() {
  cmdk.open = true;
  cmdk.index = 0;
  palette.open = false;
  // Primeira vez sem cache: precisa de sessão viva para pedir get_commands.
  if (!commandsCache.length) {
    ensureRpc().then((ok) => { if (ok) sendCommand({ type: 'get_commands' }); });
  }
  $('cmdkbar').classList.remove('hidden');
  $('palettefoot').textContent = '↑↓ navegar · Enter executar · Esc fechar · sem busca: recentes primeiro';
  $('cmdkinput').value = '';
  renderCmdk();
  $('cmdkinput').focus();
}

export function closeCmdk() {
  cmdk.open = false;
  $('cmdkbar').classList.add('hidden');
  $('cmdklist').classList.add('hidden');
  $('palettelist').classList.remove('hidden');
  $('palettefoot').textContent = '↑↓ selecionar · Tab completar · Enter executar · Esc fechar';
  $('palette').classList.add('hidden');
  if (document.activeElement === $('cmdkinput')) $('input').focus();
}

function toggleCmdk() {
  if (cmdk.open) closeCmdk(); else openCmdk();
}

function renderCmdk() {
  const raw = $('cmdkinput').value.trim().toLowerCase();
  const q = raw.replace(/^\/model\s+/, '').slice(0, 120); // teto anti-jank em colagem gigante
  const cmds = cmdkCandidates();
  const groups = [];
  if (!raw) {
    // Sem busca: recentes (só os que ainda existem) + comandos A–Z.
    const byTitle = new Map(cmds.map(c => [c.title.toLowerCase(), c]));
    const seenR = new Set();
    const recentRows = [];
    for (const r of loadRecents()) {
      const base = r.split(' ')[0].toLowerCase();
      let it = null;
      if (base === '/model' && r.length > 7) {
        const hit = (Array.isArray(allModels) ? allModels : [])
          .find(m => m && m.id && ('/model ' + m.id).toLowerCase() === r.toLowerCase());
        if (hit) it = { kind: 'model', model: hit, title: '/model ' + hit.id,
          desc: (hit.provider ? hit.provider + ' · ' : '') + (hit.name || hit.id), src: hit.provider || '' };
      } else if (byTitle.has(base)) {
        const c = byTitle.get(base);
        it = { kind: 'cmd', cmd: c.cmd, title: r, desc: c.desc, src: c.src, args: r.slice(base.length).trim() };
      }
      if (it && !seenR.has(it.title)) { seenR.add(it.title); recentRows.push(it); }
      if (recentRows.length >= RECENT_MAX) break;
    }
    if (recentRows.length) groups.push({ label: 'RECENTES', rows: recentRows });
    groups.push({ label: 'COMANDOS', rows: cmds
      .filter(c => ![...seenR].some(t => t.split(' ')[0].toLowerCase() === c.title.toLowerCase()))
      .sort((a, b) => a.title.localeCompare(b.title)) });
  } else {
    const cmdRows = cmds
      .map(c => ({ c, s: fuzzyScore((c.title + ' ' + c.desc).toLowerCase(), raw) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map(x => ({ kind: 'cmd', cmd: x.c.cmd, title: x.c.title, desc: x.c.desc, src: x.c.src }));
    if (cmdRows.length) groups.push({ label: 'COMANDOS', rows: cmdRows });
    const mRows = (Array.isArray(allModels) ? allModels : [])
      .map(m => ({ m, s: m && m.id
        ? fuzzyScore((m.id + ' ' + (m.name || '') + ' ' + (m.provider || '')).toLowerCase(), q) : -1 }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 15)
      .map(x => ({ kind: 'model', model: x.m, title: '/model ' + x.m.id,
        desc: (x.m.provider ? x.m.provider + ' · ' : '') + (x.m.name || x.m.id), src: x.m.provider || '' }));
    if (mRows.length) groups.push({ label: 'MODELOS', rows: mRows });
  }
  cmdk.items = groups.flatMap(g => g.rows);
  if (cmdk.index >= cmdk.items.length) cmdk.index = 0;
  cmdkGroups = groups;
  // O cmdk tem container próprio: `#palettelist` é do componente Svelte da
  // palette `/` e `clear()` nele destruiria os nós dele.
  $('palettelist').classList.add('hidden');
  $('cmdklist').classList.remove('hidden');
  // O overlay precisa ficar visível antes do early-path: no caminho Svelte o
  // `return` antigo pulava este `remove('hidden')` e o Ctrl+K não abria.
  $('palette').classList.remove('hidden');
  if (cmdkPane) cmdkPane.sync();
}

function runCmdkItem(i) {
  const it = cmdk.items[typeof i === 'number' ? i : cmdk.index];
  if (!it) return;
  if (it.kind === 'model') {
    const m = it.model;
    closeCmdk();
    applyModel(m); // registra o recente
    return;
  }
  const line = '/' + it.cmd.name + (it.args ? ' ' + it.args : '');
  if (!it.cmd.app) pushRecent(line);
  closeCmdk();
  if (!it.cmd.app) {
    // Comando de extensão: completa no composer (template, pode pedir args) sem enviar.
    $('input').value = line + ' ';
    $('input').focus();
    $('input').dispatchEvent(new Event('input'));
    return;
  }
  $('input').value = line;
  send(); // o ramo app do send() registra o recente e executa
}

$('cmdkinput').addEventListener('input', () => { cmdk.index = 0; renderCmdk(); });
$('cmdkinput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (cmdk.items.length) { cmdk.index = (cmdk.index + 1) % cmdk.items.length; renderCmdk(); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cmdk.items.length) { cmdk.index = (cmdk.index - 1 + cmdk.items.length) % cmdk.items.length; renderCmdk(); }
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    runCmdkItem(cmdk.index);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCmdk();
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'k') {
    // Atalhos existentes (p.ex. Ctrl+B do painel) ficam intactos: só o K é tratado aqui.
    e.preventDefault();
    toggleCmdk();
  } else if (e.key === 'Escape' && cmdk.open) {
    e.preventDefault();
    closeCmdk();
  }
});

/* =============== pacotes e MCP =============== */
function checkCommands(list) {
  const has = list.some(c => String((c && c.sourceInfo && c.sourceInfo.source) || '').includes('pi-subagents'));
  caps.subagents = has;
  // Aviso de extensão agora é renderizado pelo componente (snapshot.warn).
  if (subsPane) subsPane.sync();
  debugNote('pi-subagents carregado=' + has);
}

function noSubsMessage() {
  return caps.subagents === false ? t('panel.no_subs_ext') : t('panel.no_subs');
}


/* Cada aba carrega só o que precisa. Antes `openPkgs` pagava `pi_list` (241 ms)
 * + `pi_mcp_list` (1519 ms) em série mesmo abrindo "Instalados". */
async function loadInstalled() {
  $('pkglist').textContent = 'carregando…';
  try {
    const text = String(await inv('pi_list'));
    $('pkglist').textContent = text;
    installedSet = parseInstalledSources(text);
  } catch (e) {
    $('pkglist').textContent = String(e);
  }
  if (catalogObjects) renderCatalog();
}

/* `pi mcp list --json` custa ~1,5 s: guarda o resultado por 30 s e só relê ao
 * trocar para a aba MCP (ou depois de add/remove, que chamam `invalidateMcp`). */
const MCP_TTL_MS = 30_000;
let mcpCache = { at: 0, servers: null, raw: '' };

function invalidateMcp() { mcpCache = { at: 0, servers: null, raw: '' }; }

async function loadMcp(highlight, force) {
  const fresh = !force && mcpCache.servers && Date.now() - mcpCache.at < MCP_TTL_MS;
  if (fresh) {
    $('mcpjson').textContent = mcpCache.raw;
    renderMCP(mcpCache.servers, highlight);
    return;
  }
  try {
    const raw = String(await inv('pi_mcp_list'));
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* veio texto de erro */ }
    const servers = parsed && Array.isArray(parsed.servers) ? parsed.servers : [];
    $('mcpjson').textContent = parsed ? JSON.stringify(parsed, null, 2) : raw;
    mcpCache = { at: Date.now(), servers, raw: parsed ? JSON.stringify(parsed, null, 2) : raw };
    renderMCP(servers, highlight);
  } catch (e) {
    setEmpty($('mcplist'), String(e));
  }
}

/* ---------- quais pacotes já estão instalados ---------- */
let installedSet = new Set();

function parseInstalledSources(text) {
  const set = new Set();
  for (const line of String(text).split('\n')) {
    // `pi list` usa 2 espaços para o source e 4 para o caminho resolvido
    const m = line.match(/^ {2}(?! )(\S.*)$/);
    if (!m) continue;
    let src = m[1].trim();
    if (src.startsWith('npm:')) src = src.slice(4);
    set.add(src);
  }
  return set;
}

/* ---------- servidores MCP ---------- */
function renderMCP(servers, highlight) {
  const host = $('mcplist');
  if (!servers.length) {
    setEmpty(host, 'nenhum servidor MCP configurado');
    return;
  }
  clear(host);
  for (const s of servers) {
    const row = el('div', 'mcp-row' + (highlight && s.name === highlight ? ' new' : ''));
    row.appendChild(el('span', 'mcp-name', String(s.name)));

    const state = String(s.state || '?');
    row.appendChild(el('span', 'mcp-chip' + (state === 'connected' ? ' ok' : (/error|fail/i.test(state) ? ' err' : '')), state));
    if (s.enabled === false) row.appendChild(el('span', 'mcp-chip off', 'disabled'));
    if (s.scope) row.appendChild(el('span', 'mcp-chip', String(s.scope)));

    row.appendChild(el('span', 'mcp-transport', String(s.transport || '')));
    if (Array.isArray(s.tools)) row.appendChild(el('span', 'mcp-chip', s.tools.length + ' tools'));

    const rm = el('button', 'ghost', 'Remover');
    rm.onclick = () => confirmRemoveMcp(s);
    row.appendChild(rm);
    host.appendChild(row);
  }
}

function confirmRemoveMcp(s) {
  const local = s.scope === 'project';
  confirmRun('pi mcp remove ' + s.name + (local ? ' -l' : ''), async () => {
    $('mcpout').textContent = 'removendo…';
    try {
      $('mcpout').textContent = String(await inv('pi_mcp_remove', { name: s.name, local }));
      await loadPkgs();
    } catch (e) {
      $('mcpout').textContent = String(e);
    }
  });
}

/* ---------- catálogo npm (keywords:pi-package) ---------- */
const CATALOG_KEY = 'catalog:pi-package';
const CATALOG_TTL = 3600 * 1000;
let catalogObjects = null;
let pendingAction = null;

function catalogFromCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null');
    if (raw && raw.at && Date.now() - raw.at < CATALOG_TTL && Array.isArray(raw.items)) return raw.items;
  } catch { /* ignora */ }
  return null;
}

async function loadCatalog(force) {
  const host = $('catlist');
  if (!force) {
    const cached = catalogFromCache();
    if (cached) { catalogObjects = cached; renderCatalog(); return; }
  }
  setEmpty(host, 'consultando registry.npmjs.org…');
  try {
    const res = await fetch('https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const items = (data.objects || [])
      .filter(o => o && o.package && (o.package.keywords || []).includes('pi-package'))
      .map(o => ({
        name: o.package.name,
        version: o.package.version,
        description: o.package.description || '',
        downloads: (o.downloads && o.downloads.monthly) || 0,
      }));
    catalogObjects = items;
    try { localStorage.setItem(CATALOG_KEY, JSON.stringify({ at: Date.now(), items })); } catch { /* sem storage */ }
    renderCatalog();
  } catch (e) {
    setEmpty(host, 'falha ao consultar o registry: ' + String(e));
  }
}

function renderCatalog() {
  const host = $('catlist');
  if (!catalogObjects) return;
  const q = String(($('catsearch') && $('catsearch').value) || '').toLowerCase();
  const rows = catalogObjects.filter(p => !q || (p.name + ' ' + p.description).toLowerCase().includes(q));
  clear(host);
  if (!rows.length) { setEmpty(host, 'nada encontrado'); return; }
  for (const p of rows) {
    const row = el('div', 'cat-row');
    row.appendChild(el('span', 'cat-name', p.name));
    row.appendChild(el('span', 'cat-meta', 'v' + p.version));
    row.appendChild(el('span', 'cat-desc', p.description));
    row.appendChild(el('span', 'cat-meta', p.downloads ? p.downloads + t('pkgs.per_month') : ''));
    if (installedSet.has(p.name)) {
      row.appendChild(el('span', 'cat-installed', 'instalado'));
      const rm = el('button', 'ghost', 'Remover');
      rm.onclick = () => askRemove(p);
      row.appendChild(rm);
    } else {
      const btn = el('button', 'ghost', 'Instalar…');
      btn.onclick = () => askInstall(p);
      row.appendChild(btn);
    }
    host.appendChild(row);
  }
  debugNote('catalogo=' + rows.length + '/' + catalogObjects.length);
}

/* ---------- confirmação explícita antes de escrever ---------- */
function confirmRun(cmdText, action) {
  pendingAction = action;
  $('confirmcmd').textContent = cmdText;
  $('confirmbar').classList.remove('hidden');
}

function closeConfirm() {
  pendingAction = null;
  $('confirmbar').classList.add('hidden');
}

function askInstall(p) {
  const spec = 'npm:' + p.name + '@' + p.version;
  confirmRun('pi install ' + spec, async () => {
    switchPkgPane('installed');
    $('pkglist').textContent = 'instalando ' + spec + '…';
    try {
      $('pkglist').textContent = String(await inv('pi_install', { spec, local: false }));
      await loadPkgs();
    } catch (e) {
      $('pkglist').textContent = String(e);
    }
  });
}

function askRemove(p) {
  const spec = 'npm:' + p.name;
  const extra = p.name === 'pi-subagents'
    ? '\n(o painel de subagents depende deste pacote)'
    : '';
  confirmRun('pi remove ' + spec + extra, async () => {
    switchPkgPane('installed');
    $('pkglist').textContent = 'removendo ' + spec + '…';
    try {
      $('pkglist').textContent = String(await inv('pi_remove', { spec, local: false }));
      await loadPkgs();
    } catch (e) {
      $('pkglist').textContent = String(e);
    }
  });
}

/* ---------- MCP ---------- */
// Só presets cujo pacote existe de fato no npm (verificado).
const MCP_PRESETS = {
  filesystem: { name: 'filesystem', target: 'npx -y @modelcontextprotocol/server-filesystem' },
  memory: { name: 'memory', target: 'npx -y @modelcontextprotocol/server-memory' },
  'sequential-thinking': { name: 'sequential-thinking', target: 'npx -y @modelcontextprotocol/server-sequential-thinking' },
};

/** Divide comando respeitando aspas simples/duplas (caminho com espaço). */
function splitArgs(text) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of String(text || '')) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function addEnvRow() {
  const row = el('div', 'env-row');
  const key = el('input', 'mfield env-k');
  key.placeholder = 'KEY';
  const val = el('input', 'mfield env-v');
  val.placeholder = t('mcp.env_ph');
  const del = el('button', 'ghost', '×');
  del.onclick = () => row.remove();
  row.append(key, val, del);
  $('mcpenvrows').appendChild(row);
}

function collectEnv() {
  const env = [];
  document.querySelectorAll('#mcpenvrows .env-row').forEach(r => {
    const key = r.querySelector('.env-k').value.trim();
    const val = r.querySelector('.env-v').value;
    if (key) env.push(key + '=' + val);
  });
  return env;
}

function applyPreset(id) {
  const p = MCP_PRESETS[id];
  if (!p) return;
  $('mcpname').value = p.name;
  $('mcptarget').value = p.target;
  $('mcpargs').focus();
}

function mcpAdd() {
  const name = $('mcpname').value.trim();
  const target = $('mcptarget').value.trim();
  const extra = splitArgs($('mcpargs').value);
  const env = collectEnv();
  const local = $('mcplocal').checked;

  if (!name) { $('mcpout').textContent = 'informe o nome'; return; }
  if (!target) { $('mcpout').textContent = 'informe uma URL ou um comando'; return; }

  const isUrl = /^https?:\/\//i.test(target);
  const url = isUrl ? target : '';
  const argv = isUrl ? [] : splitArgs(target).concat(extra);

  const shown = 'pi mcp add ' + name + (local ? ' -l' : '') +
    env.map(e => ' --env ' + e).join('') +
    (url ? ' --url ' + url : ' -- ' + argv.join(' '));

  confirmRun(shown, async () => {
    $('mcpout').textContent = 'executando…';
    try {
      $('mcpout').textContent = String(await inv('pi_mcp_add', { name, url, argv, env, headers: [], local }));
      invalidateMcp();
      await loadMcp(name, true);
    } catch (e) {
      $('mcpout').textContent = String(e);
    }
  });
}

function mcpRemove() {
  const name = $('mcpname').value.trim();
  const local = $('mcplocal').checked;
  if (!name) { $('mcpout').textContent = 'informe o nome'; return; }
  confirmRun('pi mcp remove ' + name + (local ? ' -l' : ''), async () => {
    try {
      $('mcpout').textContent = String(await inv('pi_mcp_remove', { name, local }));
      invalidateMcp();
      await loadMcp(null, true);
    } catch (e) {
      $('mcpout').textContent = String(e);
    }
  });
}

/* ---------- panes ---------- */
/* ---------- hooks ---------- */
let hooksTimer = null;

async function loadHooks() {
  try {
    const raw = String(await inv('hooks_tail', { lines: 200 }));
    $('hookslog').textContent = raw.trim() ? raw : '(sem registros ainda) — dispare uma mensagem e volte aqui';
  } catch (e) {
    $('hookslog').textContent = String(e);
  }
}

async function refreshHooksStatus() {
  try {
    const st = JSON.parse(String(await inv('hooks_status')));
    $('setHooks').checked = !!st.installed;
    $('hooksstatus').textContent = (st.installed ? 'logger ativo · ' : 'logger inativo · ') + st.log;
  } catch { /* ignora */ }
}

function setHooksEnabled(on) {
  const cmd = on ? 'escrever ~/.pi/agent/extensions/sightdeck-hooks.js' : 'remover ~/.pi/agent/extensions/sightdeck-hooks.js';
  confirmRun(cmd, async () => {
    try {
      const out = await inv(on ? 'hooks_install' : 'hooks_remove');
      setStatus(String(out));
      await refreshHooksStatus();
      await loadHooks();
    } catch (e) {
      setStatus('erro: ' + e);
    }
  });
}

function switchPkgPane(name) {
  document.querySelectorAll('.pkg-tab').forEach(t => t.classList.toggle('active', t.dataset.pane === name));
  for (const p of ['installed', 'catalog', 'mcp', 'hooks']) {
    const node = $('pane-' + p);
    if (node) node.classList.toggle('hidden', p !== name);
  }
  if (hooksTimer) { clearInterval(hooksTimer); hooksTimer = null; }

  if (name === 'installed') loadInstalled();
  if (name === 'catalog') {
    if (!catalogObjects) loadCatalog(false);
    else renderCatalog();
  }
  if (name === 'mcp') loadMcp();
  if (name === 'hooks') {
    loadHooks();
    refreshHooksStatus();
    hooksTimer = setInterval(loadHooks, 2500);
  }
}

/** Aba Debug do modal único: Missões e Diagnóstico. */
function openDebug() {
  openSettingsTab('debug');
}

/** Abre o modal de configurações numa aba (⚙ chama com 'general'). */
function openSettingsTab(name) {
  $('settings').classList.remove('hidden');
  switchSettingsTab(name);
}

/** Alterna a aba visível; cada aba carrega o que precisa (sem RPC a toa). */
function switchSettingsTab(name) {
  for (const b of document.querySelectorAll('#settings-tabs .settings-tab')) {
    b.classList.toggle('active', b.dataset.pane === name);
  }
  for (const p of ['general', 'theme', 'pkgs', 'providers', 'usage', 'debug', 'about']) {
    const node = $('pane-' + p);
    if (node) node.classList.toggle('hidden', p !== name);
  }
  if (name === 'pkgs') {
    switchPkgPane('installed');
    // Primeira abertura: uma linha de env vazia pronta para editar.
    if (!$('mcpenvrows').childElementCount) addEnvRow();
  }
  if (name === 'debug') { loadMissions(); renderHealthList(); renderDiag(); }
  if (name === 'providers') loadProvidersTab();
  if (name === 'usage') loadUsageTab();
  if (name === 'about') openAbout();
}

/* =============== sobre =============== */

/** Overlay "Sobre": versão do app, do `pi` e os caminhos que o app usa de fato
 *  (`app_info` resolve o binário como `pi_bin()`; mostrar `pi` do PATH seria mentira). */
async function openAbout() {
  const host = $('aboutlist');
  const add = (label, value) => {
    const row = el('div', 'file-row');
    row.appendChild(el('span', 'file-name', label));
    row.appendChild(el('span', 'file-dir', value));
    host.appendChild(row);
  };
  clear(host);
  add('sightdeck', appVersion || '?');
  // Os dois IPC são independentes (cada um sobe um processo): em paralelo o
  // overlay abre em ~1 chamada em vez de somar as duas latências.
  const [piV, appInfo] = await Promise.all([
    inv('pi_version').then(String).catch(() => '?'),
    inv('app_info').then(JSON.parse).catch(() => null),
  ]);
  add('pi', piV);
  const info = appInfo;
  if (info) {
    add(t('about.pi_bin'), info.piBin || '?');
    add('config do pi', info.agent || '?');
    add('sessões', info.sessions || '?');
    add('sistema', info.os || '?');
  }
}

/* =============== tema (JSON) =============== */

/** Texto da linha de status do tema: quantas chaves entraram, quais foram ignoradas e o erro de parse. */
function themeNoteText(res, prefix) {
  const applied = Object.keys(res.ok).length;
  const parts = [];
  if (prefix) parts.push(prefix);
  parts.push(applied + ' aplicada(s)');
  if (res.ignored.length) parts.push(res.ignored.length + ' ignorada(s): ' + res.ignored.join(', '));
  if (res.error) parts.push(res.error);
  return parts.join(' · ');
}


/* =============== auth do provider (perto da versão do pi) =============== */
let authProvider = null;
let authTimer = null;
let authProvidersCache = [];
/* Providers ocultados pelo usuário na aba Providers (só esconde da lista; não
   mexe em credencial — built-in do CLI não é removível). */
let hiddenProviders = new Set();
function loadHiddenProviders() {
  try {
    const raw = JSON.parse(localStorage.getItem('hidden-providers') || '[]');
    hiddenProviders = new Set(Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : []);
  } catch { hiddenProviders = new Set(); }
}
function saveHiddenProviders() {
  try { localStorage.setItem('hidden-providers', JSON.stringify([...hiddenProviders])); } catch { /* sem storage */ }
}

async function openProvPicker() {
  $('provpick').classList.remove('hidden');
  $('provsearch').value = '';
  $('provcurrent').textContent = authProvider ? 'atual: ' + authProvider : '';
  setEmpty($('provlist'), 'carregando provedores…');
  try {
    authProvidersCache = JSON.parse(String(await inv('auth_providers')));
  } catch {
    authProvidersCache = [];
  }
  renderProviders('');
}

function closeProvPicker() { $('provpick').classList.add('hidden'); }

function renderProviders(filter) {
  const host = $('provlist');
  const q = String(filter || '').toLowerCase();
  const rows = authProvidersCache.filter(p => p && p.name && p.name.toLowerCase().includes(q));
  clear(host);
  if (!rows.length) { setEmpty(host, 'nenhum provedor encontrado'); return; }

  for (const p of rows) {
    const row = el('div', 'cat-row prov-row');
    row.appendChild(el('span', 'cat-name', p.name));

    if (p.status === 'ready') {
      row.appendChild(el('span', 'cat-installed', 'pronto'));
    } else if (p.reason === 'provider_not_found') {
      // Provider que só existe por extensão (commandcode): `pi auth login` não
      // conhece o nome, então o botão "logar" só daria erro.
      row.appendChild(el('span', 'prov-nocred', 'via extensão'));
    } else if (p.configured) {
      row.appendChild(el('span', 'prov-nocred', 'sem credencial'));
    }

    if (p.reason !== 'provider_not_found') {
      const btn = el('button', 'ghost', 'logar');
      btn.onclick = () => { closeProvPicker(); startLogin(p.name); };
      row.appendChild(btn);
    }
    host.appendChild(row);
  }
}

/* =============== aba Custo (histórico de tokens/custo) =============== */
/** Agrega o histórico (Rust varre os .jsonl): custo e tokens por dia/projeto. */
async function loadUsageTab() {
  const st = $('usagestatus');
  if (st) st.textContent = 'lendo histórico…';
  try {
    const data = JSON.parse(String(await inv('usage_stats', { days: 30 })));
    renderUsageTab(data);
    if (st) st.textContent = '';
  } catch (e) {
    if (st) st.textContent = 'falha ao ler o histórico: ' + String(e);
  }
}

function usageKv(label, value) {
  const box = el('div', 'usage-kv');
  box.appendChild(el('span', 'usage-kv-k', label));
  box.appendChild(el('span', 'usage-kv-v', value));
  return box;
}

function renderUsageTab(data) {
  const d = data || {};
  const totals = d.totals || {};
  const totHost = $('usagetotals');
  if (totHost) {
    clear(totHost);
    totHost.append(
      usageKv('sessões', String(totals.sessions || 0)),
      usageKv('tokens', fmtTokens(totals.tokens || 0)),
      usageKv('custo', fmtCost(totals.cost || 0)),
    );
  }

  const daysHost = $('usagedays');
  if (daysHost) {
    clear(daysHost);
    const days = Array.isArray(d.days) ? d.days : [];
    if (!days.length) setEmpty(daysHost, 'sem histórico de custo');
    const max = Math.max(1e-9, ...days.map(x => Number(x.cost) || 0));
    for (const x of days) {
      const cost = Number(x.cost) || 0;
      const row = el('div', 'usage-bar-row');
      row.appendChild(el('span', 'usage-bar-label', String(x.date || '').slice(5)));
      const bar = el('div', 'usage-bar');
      const fill = el('div', 'usage-bar-fill');
      fill.style.width = Math.round((cost / max) * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('span', 'usage-bar-val', fmtCost(cost)));
      row.title = (x.date || '') + ' · ' + fmtTokens(x.tokens || 0) + ' tokens';
      daysHost.appendChild(row);
    }
  }

  const projHost = $('usageprojects');
  if (projHost) {
    clear(projHost);
    const projects = Array.isArray(d.projects) ? d.projects : [];
    if (!projects.length) setEmpty(projHost, 'sem sessões com usage');
    for (const p of projects.slice(0, 15)) {
      const row = el('div', 'file-row');
      row.appendChild(el('span', 'file-name', String(p.name || '?')));
      row.appendChild(el('span', 'file-count', String(p.sessions || 0) + ' sess'));
      row.appendChild(el('span', 'file-dir', fmtTokens(p.tokens || 0)));
      row.appendChild(el('span', 'git-add', fmtCost(p.cost || 0)));
      projHost.appendChild(row);
    }
  }
}

/* =============== aba Providers (modal) =============== */
/** Carrega a lista de providers e pinta a aba do modal (logar/remover). */
async function loadProvidersTab() {
  const status = $('provstatus');
  if (status) status.textContent = 'carregando…';
  try {
    authProvidersCache = JSON.parse(String(await inv('auth_providers')));
    if (status) status.textContent = '';
  } catch (e) {
    authProvidersCache = [];
    if (status) status.textContent = 'falha ao listar: ' + String(e);
  }
  renderProvidersTab();
}

function renderProvidersTab() {
  const host = $('provtab');
  if (!host) return;
  clear(host);
  const q = String(($('provsearchtab') && $('provsearchtab').value) || '').toLowerCase().trim();
  const all = Array.isArray(authProvidersCache) ? authProvidersCache : [];
  const visible = all.filter(p => p && p.name && !hiddenProviders.has(p.name));
  const list = visible.filter(p => !q || p.name.toLowerCase().includes(q));
  if (!all.length) { setEmpty(host, 'nenhum provedor'); return; }
  if (!list.length) {
    setEmpty(host, visible.length ? 'nenhum provedor para "' + q + '"' : 'todos ocultos (use Atualizar para voltar)');
    return;
  }
  for (const p of list) {
    if (!p || !p.name) continue;
    const row = el('div', 'cat-row prov-row');
    row.appendChild(el('span', 'cat-name', p.name));
    if (p.status === 'ready') row.appendChild(el('span', 'cat-installed', 'pronto'));
    else if (p.reason === 'provider_not_found') row.appendChild(el('span', 'prov-nocred', 'via extensão'));
    else if (p.configured) row.appendChild(el('span', 'prov-nocred', 'sem credencial'));

    if (p.reason !== 'provider_not_found') {
      const login = el('button', 'ghost', p.status === 'ready' ? 'relogar' : 'logar');
      login.title = 'abre um terminal com pi auth login ' + p.name;
      login.onclick = () => startLogin(p.name);
      row.appendChild(login);
    }

    const del = el('button', 'ghost', 'remover');
    del.title = 'pi auth logout ' + p.name + ' (apaga a credencial de auth.json)';
    del.onclick = async () => {
      del.disabled = true;
      const st = $('provstatus');
      if (st) st.textContent = 'removendo ' + p.name + '…';
      const done = [];
      // 1) credencial do auth.json (via CLI).
      try {
        await inv('auth_logout', { provider: p.name });
        done.push('auth.json');
      } catch { /* sem credencial no auth.json */ }
      // 2) provider custom do models.json (único jeito de remover built-in
      //    configurado por extensão — o logout do CLI não toca nesse arquivo).
      try {
        const out = String(await inv('models_provider_remove', { provider: p.name }));
        done.push(out);
      } catch (e) {
        if (!done.length) done.push(String(e));
      }
      if (st) st.textContent = done.length ? done.join(' · ') : p.name + ': nada para remover';
      await loadProvidersTab();
    };
    row.appendChild(del);

    const hideBtn = el('button', 'ghost', 'ocultar');
    hideBtn.title = 'ocultar ' + p.name + ' desta lista (não mexe em credencial)';
    hideBtn.onclick = () => {
      hiddenProviders.add(p.name);
      saveHiddenProviders();
      renderProvidersTab();
    };
    row.appendChild(hideBtn);
    host.appendChild(row);
  }
}

/* =============== monitor de memória (app + pi) =============== */
let memTimer = null;
function fmtMb(kb) {
  const n = Number(kb) || 0;
  if (!n) return '—';
  return n >= 1024 ? Math.round(n / 1024) + ' MB' : n + ' kB';
}
async function updateMem() {
  const node = $('meminfo');
  if (!node) return;
  try {
    const m = JSON.parse(String(await inv('mem_usage')));
    node.textContent = 'app ' + fmtMb(m.appKb) + ' · pi ' + fmtMb(m.piKb)
      + (m.piCount ? ' (' + m.piCount + ')' : '');
    node.title = 'RSS do sightdeck: ' + fmtMb(m.appKb)
      + '\nRSS do pi em execução (' + m.piCount + ' processo(s)): ' + fmtMb(m.piKb);
  } catch { /* sem /proc ou comando indisponível */ }
}
function startMemMonitor() {
  if (memTimer) return;
  updateMem();
  memTimer = setInterval(updateMem, 5000);
}

async function checkAuth() {
  let provider = sessionState && sessionState.model && sessionState.model.provider;
  if (!provider) {
    try {
      const m = JSON.parse(localStorage.getItem('last-model') || 'null');
      provider = m && m.provider;
    } catch { /* ignora */ }
  }
  if (!provider) { $('authchip').classList.add('hidden'); return; }
  authProvider = provider;

  try {
    const st = JSON.parse(String(await inv('auth_status', { provider })));
    const ready = !!st && st.status === 'ready';
    const chip = $('authchip');
    // `provider_not_found` = provider de extensão (ex.: commandcode): quem
    // autentica é a extensão, não o CLI — o chip "logar" seria um botão morto.
    if (st && st.reason === 'provider_not_found') { chip.classList.add('hidden'); return; }
    chip.classList.remove('hidden');
    chip.classList.toggle('ok', ready);
    chip.classList.toggle('warn', !ready);
    chip.textContent = ready ? 'auth ok' : 'logar ' + provider;
    chip.title = ready
      ? 'provider ' + provider + ' autenticado'
      : 'clique para abrir o terminal e rodar pi auth login ' + provider;
  } catch { /* sem pi no PATH */ }
}

async function startLogin(provider) {
  const p = (provider || authProvider || '').trim();
  if (!p) { setStatus('uso: /login <provider>'); return; }
  try {
    setStatus(String(await inv('open_terminal_login', { provider: p })));
  } catch (e) {
    setStatus(String(e));
  }

  if (authTimer) clearInterval(authTimer);
  let ticks = 0;
  authTimer = setInterval(async () => {
    ticks += 1;
    await checkAuth();
    if ($('authchip').classList.contains('ok') || ticks > 40) {
      clearInterval(authTimer);
      authTimer = null;
    }
  }, 3000);
}

/* =============== atualização (Tauri updater assinado) =============== */
let appVersion = null;
let pendingUpdate = null;

async function checkUpdate(manual) {
  if (!appVersion) return;
  if (manual) setStatus('verificando…');
  try {
    const update = await check();
    if (!update) {
      pendingUpdate = null;
      $('updatebar').classList.add('hidden');
      if (manual) setStatus(t('update.latest_no'));
      return;
    }
    pendingUpdate = update;
    $('updatetext').textContent = t('update.available_have', { tag: update.version, ver: appVersion });
    const btn = $('updatebtn');
    btn.textContent = t('update.install');
    btn.disabled = false;
    $('updatebar').classList.remove('hidden');
    if (manual) setStatus(t('update.latest_yes'));
  } catch (e) {
    if (manual) setStatus(t('update.check_fail'));
    debugNote('update check falhou: ' + e);
  }
}


/* =============== wiring =============== */
$('send').onclick = send;
$('stopbtn').onclick = () => abortTurn();
$('loadmorebtn').onclick = loadEarlier;
$('scrollbottom').onclick = () => {
  const l = $('log');
  l.scrollTo({ top: l.scrollHeight, behavior: 'smooth' });
};
$('log').addEventListener('scroll', () => {
  updateScrollBtn();
});
$('input').addEventListener('keydown', (e) => {
  if (palette.open) {
    if (e.key === 'ArrowDown') {
      palette.index = (palette.index + 1) % palette.items.length;
      renderPalette();
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowUp') {
      palette.index = (palette.index - 1 + palette.items.length) % palette.items.length;
      renderPalette();
      e.preventDefault();
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); applyPaletteItem(false); return; }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); applyPaletteItem(true); return; }
    if (e.key === 'Escape') { e.preventDefault(); hidePalette(); return; }
  }
  if (e.key === 'Enter') {
    // Enter envia; Ctrl/Cmd+Enter quebra linha (Shift+Enter quebra nativo do textarea).
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const box = e.target;
      box.setRangeText('\n', box.selectionStart, box.selectionEnd, 'end');
      box.dispatchEvent(new Event('input'));
      return;
    }
    if (!e.shiftKey) { e.preventDefault(); send(); }
  }
});

$('input').addEventListener('input', () => { renderPalette(); autosizeInput(); });
$('input').addEventListener('blur', () => setTimeout(hidePalette, 150));

/* =============== anexos =============== */
/** Snapshot puro da linha de anexos (Svelte + testes). */
export function attachmentsSnapshot(images) {
  return (images || []).map((img, idx) => ({
    idx,
    src: String((img && img.dataUrl) || ''),
    alt: 'imagem colada',
    removeTitle: 'Remover imagem',
  }));
}

function renderAttachments() {
  const row = $('attachrow');
  if (row) row.classList.toggle('hidden', pendingImages.length === 0);
  if (attachmentsPane) attachmentsPane.sync();
}

/** Imagem enviada, exibida no transcript. */
/** Imagem que uma tool leu: o histórico só traz `img: {mimeType, bytes}`, então o
 *  arquivo é lido do disco (uma vez) pelo caminho da própria chamada. */
export function renderToolImages(entry, raw) {
  if (!entry || entry.imgsDone || !entry.body) return;
  const content = raw && (raw.content || raw);
  if (!Array.isArray(content)) return;
  const blocks = content.filter(b => b && ((b.type === 'image' && b.data) || (b.img && b.img.mimeType)));
  if (!blocks.length) return;
  entry.imgsDone = true;
  const row = el('div', 'tool-imgs');
  entry.body.appendChild(row);
  for (const b of blocks) {
    if (b.type === 'image' && b.data) {
      row.appendChild(thumb('data:' + (b.mimeType || 'image/png') + ';base64,' + b.data));
      continue;
    }
    const box = el('div', 'img-missing', b.text || 'imagem');
    row.appendChild(box);
    if (!entry.path) continue;
    inv('read_image_data', { path: entry.path })
      .then(url => { if (box.isConnected) box.replaceWith(thumb(url)); })
      .catch(err => { box.textContent = String((err && err.message) || err); });
  }
}

function thumb(dataUrl) {
  const box = el('div', 'msg-img');
  const im = document.createElement('img');
  im.src = dataUrl;
  im.title = 'Clique para ampliar';
  im.onclick = () => {
    $('imgviewimg').src = dataUrl;
    $('imgview').classList.remove('hidden');
  };
  box.appendChild(im);
  return box;
}

$('imgview').onclick = () => $('imgview').classList.add('hidden');
$('imgviewimg').onclick = (e) => { e.stopPropagation(); $('imgview').classList.add('hidden'); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('imgview').classList.add('hidden');
});

function addImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const url = String(reader.result || '');
    const comma = url.indexOf(',');
    if (comma < 0) return;
    // dataUrl serve só para a miniatura; o RPC quer o base64 puro.
    pendingImages.push({ dataUrl: url, data: url.slice(comma + 1), mime: file.type || 'image/png' });
    renderAttachments();
  };
  reader.readAsDataURL(file);
}

// Print colado no composer: o pi aceita ImageContent no prompt (docs/rpc-commands.md).
$('input').addEventListener('paste', (e) => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  const files = [];
  for (const it of items) {
    if (it.kind === 'file' && String(it.type).startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (!files.length) return; // texto puro segue o caminho normal
  e.preventDefault();
  files.forEach(addImageFile);
});

// A WebKitGTK não entrega `image/*` no evento paste do webview: consulta o
// clipboard do sistema. Se não houver imagem, o texto cola normalmente (sem preventDefault).
$('input').addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v') return;
  inv('paste_image')
    .then(([data, mime]) => {
      pendingImages.push({ dataUrl: 'data:' + mime + ';base64,' + data, data, mime });
      renderAttachments();
    })
    .catch(() => { /* clipboard sem imagem: colagem de texto nativa segue */ });
});

// Arquivo como contexto: o RPC não tem campo de arquivo, então entra como @caminho
// e o agente lê com as próprias tools.
$('attachbtn').onclick = async () => {
  try {
    const path = String(await inv('pick_file')).trim();
    if (!path) return;
    const box = $('input');
    const sep = box.value && !/\s$/.test(box.value) ? ' ' : '';
    box.value += sep + '@' + path + ' ';
    box.focus();
    box.dispatchEvent(new Event('input'));
  } catch (e) {
    if (!String(e).includes('cancelado')) setStatus(String(e));
  }
};

function applySubsVisibility(hidden) {
  document.body.classList.toggle('no-subs', hidden);
  $('togglesubs').classList.toggle('on', !hidden);
  try { localStorage.setItem('subs-hidden', hidden ? '1' : '0'); } catch { /* webview sem storage */ }
}
$('togglesubs').onclick = () =>
  applySubsVisibility(!document.body.classList.contains('no-subs'));

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === 'b' || e.key === 'B') { e.preventDefault(); applySubsVisibility(!document.body.classList.contains('no-subs')); }
  else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom + 0.1); }
  else if (e.key === '-') { e.preventDefault(); setZoom(zoom - 0.1); }
  else if (e.key === '0') { e.preventDefault(); setZoom(1); }
});

$('newsession').onclick = async () => {
  let cwd = '/';
  try { cwd = await inv('home_dir'); } catch { /* usa raiz */ }
  await newSessionIn(cwd);
};
$('addproject').onclick = () => addProject();
$('sesssearch').oninput = scheduleSearch;
$('sesssearch').onfocus = scheduleSearch;
$('toolfilter').oninput = scheduleSearch;
$('erronly').onchange = () => runSearch(false);
$('searchclear').onclick = clearSearch;

$('reload').onclick = reloadSession;
$('unque').onclick = () => desfazerFila();
$('forkbtn').onclick = async (e) => {
  e.stopPropagation();
  closeModelPop();
  if (!current) return note(t('composer.no_session'));
  if (!current.connected && !(await ensureRpc())) return;
  sendCommand({ type: 'get_fork_messages' });
};
$('detailback').onclick = closeDetail;
// Clique fora da caixinha (no scrim) também volta — padrão dos overlays do projeto.
$('detail').addEventListener('mousedown', (e) => { if (e.target === $('detail')) closeDetail(); });

$('modeltoggle').onclick = (e) => {
  e.stopPropagation();
  $('modelpop').classList.toggle('hidden');
  if (!$('modelpop').classList.contains('hidden') && modelPop) modelPop.open();
};
$('thinkbtn').onclick = (e) => { e.stopPropagation(); $('modeltoggle').click(); };

document.addEventListener('click', (e) => {
  if (!$('modelpop').classList.contains('hidden')
    && !$('modelpop').contains(e.target) && !$('modeltoggle').contains(e.target)) closeModelPop();
  if (!$('forkpop').classList.contains('hidden') && !$('forkpop').contains(e.target)) closeForkPop();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modelpop').classList.contains('hidden')) closeModelPop();
  if (e.key === 'Escape' && !$('forkpop').classList.contains('hidden')) closeForkPop();
});

function resetCompact() {
  compactBusy = false;
  $('compactnow').classList.remove('on');
  $('compactnow').title = 'Compactar agora (resume o histórico)';
}

function endCompact(text) {
  resetCompact();
  $('log').appendChild(el('div', 'row note', text));
  sendCommand({ type: 'get_session_stats' });
}

$('compactnow').onclick = () => {
  if (!current) return note(t('composer.no_session'));
  if (compactBusy) return;
  compactBusy = true;
  $('compactnow').classList.add('on');
  $('compactnow').title = 'compactando…';
  sendCommand({ type: 'compact' });
};

$('autocompact').onclick = () => {
  const next = !(sessionState && sessionState.autoCompactionEnabled);
  sendCommand({ type: 'set_auto_compaction', enabled: next });
  sessionState = { ...(sessionState || {}), autoCompactionEnabled: next };
  $('autocompact').classList.toggle('on', next);
};

document.addEventListener('click', (e) => {
  const pop = $('ctxpop');
  if (pop.classList.contains('hidden')) return;
  if (pop.contains(e.target) || $('ctxbtn').contains(e.target)) return;
  pop.classList.add('hidden');
});

$('ctxbtn').onclick = () => {
  statsNoteRequested = true;
  sendCommand({ type: 'get_session_stats' });
  renderCtxPop();
  refreshCompactLimit();
  $('ctxpop').classList.toggle('hidden');
  $('modelpop').classList.add('hidden');
};

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem('ui-settings') || '{}');
    uiSettings.expandTools = !!raw.expandTools;
    uiSettings.expandThink = !!raw.expandThink;
    uiSettings.showHidden = !!raw.showHidden;
    uiSettings.notifyDesktop = raw.notifyDesktop !== false;
    uiSettings.notifySound = raw.notifySound !== false;
  } catch { /* defaults */ }
  try {
    document.documentElement.lang = getLang() === 'pt' ? 'pt-BR' : 'en';
  } catch { /* sem DOM */ }
  applyStaticI18n();
  // `status` e `#send.title` são estado vivo, não chrome: o catálogo não os toca.
  if (!current) setStatus(t('status.disconnected'));
  syncStopButton(!!(current && current.working));
}

function saveSettings() {
  try { localStorage.setItem('ui-settings', JSON.stringify(uiSettings)); } catch { /* sem storage */ }
}

$('settingsbtn').onclick = (e) => {
  e.stopPropagation();
  openSettingsTab('general');
};
$('settingsback').onclick = () => $('settings').classList.add('hidden');
// Fechável: clique no scrim (fora da caixa) fecha.
$('settings').addEventListener('mousedown', (e) => {
  if (e.target === $('settings')) $('settings').classList.add('hidden');
});
/* Host do componente Svelte de Configurações: passa `t`/estado e recebe as
   mudanças, sem o componente importar este módulo (evita ciclo). */
const settingsHost = {
  uiSettings,
  t,
  getLangPref,
  setSetting(key, value) {
    uiSettings[key] = value;
    saveSettings();
    if (key === 'showHidden') loadSessions();
  },
  setLang(pref) {
    setLang(pref);
    applyStaticI18n();
    for (const c of APP_COMMANDS) if (CMD_KEYS[c.name]) c.description = t(CMD_KEYS[c.name]);
    loadSessions();
    // Overlay de estado vazio só é repintada se já estava visível: com sessão
    // aberta ela é opaca e cobriria o transcript.
    if (current && !$('emptystate').classList.contains('hidden')) {
      setEmptyState(true, current.file ? 'newsession' : 'nosession');
    }
    syncStopButton(!!(current && current.working));
  },
};

/* Tela nova e tela antiga convivem: monta o Svelte e só esconde o markup legado
   quando o mount funciona. Sem Svelte, o popover continua funcionando como hoje. */
try {
  mountSettings(settingsHost);
} catch (e) {
  debugNote('settings svelte: mount falhou (' + e + ')');
}

async function runUpdate(scope) {
  const out = $('updOut');
  out.textContent = 'rodando… (pode demorar)';
  try {
    out.textContent = String(await inv('pi_update', { scope }));
    try { $('piversion').textContent = 'pi ' + await inv('pi_version'); } catch { /* ignora */ }
  } catch (e) {
    out.textContent = String(e);
  }
}
$('updExt').onclick = () => runUpdate('extensions');
$('updPi').onclick = () => runUpdate('self');

/* Host do diálogo Svelte de Tema: presets + JSON usam o mesmo motor
   (`applyTheme`/`validateTheme`/`themeFromDom`/`resetTheme`), sem o componente
   importar este módulo (evita ciclo). `themePreset` guarda o preset ativo. */
const PRESET_KEY = 'themePreset';
const themeHost = {
  t,
  getLangPref,
  presets: PRESETS,
  getActiveId() {
    try { return localStorage.getItem(PRESET_KEY) || 'sightdeck'; } catch { return 'sightdeck'; }
  },
  applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return { ok: {}, ignored: [] };
    const res = applyTheme(p.tokens);
    try {
      if (res.error) localStorage.removeItem(PRESET_KEY);
      else localStorage.setItem(PRESET_KEY, id);
    } catch { /* sem storage */ }
    return res;
  },
  applyJson(text) {
    const res = applyTheme(text);
    if (!res.error) { try { localStorage.setItem(PRESET_KEY, 'custom'); } catch { /* sem storage */ } }
    return res;
  },
  exportJson() {
    const current = themeFromDom();
    return { json: JSON.stringify(current, null, 2), res: validateTheme(current) };
  },
  resetAll() {
    resetTheme();
    try { localStorage.removeItem(PRESET_KEY); } catch { /* sem storage */ }
  },
  note(res, prefix) {
    return themeNoteText(res, prefix);
  },
};

/* Diálogo novo e overlay legado convivem: monta o Svelte e só esconde o markup
   legado quando o mount funciona. Sem Svelte, o overlay continua como hoje. */
try {
  mountTheme(themeHost);
} catch (e) {
  debugNote('theme svelte: mount falhou (' + e + ')');
}

/* Hosts dos pops do composer (Fase 2): snapshots puros entram no componente,
   ações voltam para as funções deste módulo. O componente nunca importa este
   módulo (evita ciclo) — mesmo contrato do piloto de Settings/Tema. */
const modelPopHost = {
  t,
  getLangPref,
  snapshot(filter) {
    return {
      list: modelListSnapshot(modelsByProvider, sessionState && sessionState.model ? sessionState.model.id : '', filter, modelFavs),
      levels: levelsSnapshot(levelList, sessionState && sessionState.thinkingLevel),
    };
  },
  async apply(id) {
    const m = allModels.find(x => x && x.id === id);
    await applyModel(m);
  },
  toggleFav(id) {
    if (modelFavs.has(id)) modelFavs.delete(id); else modelFavs.add(id);
    saveModelFavs();
    renderModelList();
  },
  previewLevel(i) {
    return levelList[Number(i)] || '';
  },
  async setLevel(v) {
    const key = current && current.key;
    const lv = levelList[Number(v)];
    if (!lv) return;
    if (!current || !current.connected) {
      if (!(await ensureRpc())) return;
    }
    if (!current || current.key !== key) return;
    sendCommand({ type: 'set_thinking_level', level: lv });
    sessionState = { ...(sessionState || {}), thinkingLevel: lv };
    if (current) { const tb = tabs.find(x => x.key === current.key); if (tb) tb.thinkingLevel = lv; }
    fillLevels(null);
  },
};

const ctxPopHost = {
  t,
  getLangPref,
  snapshot() {
    const view = liveStatsView(sessionState && sessionState.stats, currentLive());
    return ctxSnapshot(view, {
      autoOn: !!(sessionState && sessionState.autoCompactionEnabled),
      tabs, curKey: current && current.key,
      reserve: compactReserve, win: ctxWindow(),
      canEdit: !!(sessionState && sessionState.model && current),
      messages: lastMessages,
    });
  },
  async saveLimit(value) {
    const text = await applyLimitValue(value, ctxWindow());
    if (text != null) note(text);
    return this.snapshot();
  },
};

const forkPopHost = {
  t,
  getLangPref,
  snapshot(messages) {
    return forkSnapshot(messages);
  },
  doFork(entryId) {
    closeForkPop();
    sendCommand({ type: 'fork', entryId });
  },
};

/* Pops novos e markup legado convivem: monta os 3 e só esconde o legado quando
   o mount funciona. Sem Svelte, os pops continuam como hoje. */
try {
  modelPop = mountModelPop(modelPopHost);
} catch (e) {
  debugNote('modelpop svelte: mount falhou — usando o markup legado (' + e + ')');
}
try {
  ctxPop = mountCtxPop(ctxPopHost);
} catch (e) {
  debugNote('ctxpop svelte: mount falhou — usando o markup legado (' + e + ')');
}
try {
  forkPop = mountForkPop(forkPopHost);
} catch (e) {
  debugNote('forkpop svelte: mount falhou — usando o markup legado (' + e + ')');
}

/* Linha de anexos em Svelte (Fase 5a): snapshot das imagens pendentes + remover. */
const attachmentsHost = {
  snapshot: () => attachmentsSnapshot(pendingImages),
  remove(idx) {
    pendingImages.splice(idx, 1);
    renderAttachments();
  },
};
try {
  attachmentsPane = mountAttachments(attachmentsHost);
} catch (e) {
  debugNote('attachments svelte: mount falhou — usando o render legado (' + e + ')');
}

/* Palette de comandos em Svelte (Fase 5b): snapshot das linhas + escolher.
   A navegação por teclado segue no main (muta `palette.index` e re-renderiza). */
const paletteHost = {
  snapshot: () => paletteSnapshot(palette.items, palette.index),
  pick(idx) {
    palette.index = idx;
    applyPaletteItem(false);
  },
};
try {
  palettePane = mountPalette(paletteHost);
} catch (e) {
  debugNote('palette svelte: mount falhou — usando o render legado (' + e + ')');
}

/* Palette global Ctrl+K em Svelte (Fase 5c): grupos RECENTES/COMANDOS/MODELOS. */
const cmdkHost = {
  snapshot: () => cmdkSnapshot(cmdkGroups, cmdk.index),
  pick(idx) { runCmdkItem(idx); },
};
try {
  cmdkPane = mountCmdkList(cmdkHost);
} catch (e) {
  debugNote('cmdk svelte: mount falhou — usando o render legado (' + e + ')');
}

/* Indicador de digitação em Svelte (Fase 5d): estado canônico no main. */
const typingHost = {
  snapshot: () => typingSnapshot(typingOn, typingLabel),
};
try {
  typingPane = mountTyping(typingHost);
} catch (e) {
  debugNote('typing svelte: mount falhou (' + e + ')');
}

/* Barra de abas em Svelte (Fase 3): o snapshot vem deste módulo e as ações
   voltam para `switchTab`/`closeTab`. Sem o mount, `renderTabs` legado pinta. */
const tabBarHost = {
  snapshot: () => tabsSnapshot(tabs, activeTab),
  switchTab,
  closeTab,
};
try {
  tabBar = mountTabBar(tabBarHost);
} catch (e) {
  debugNote('tabs svelte: mount falhou — usando o render legado (' + e + ')');
}

/* Árvore de sessões em Svelte (Fase 3b): snapshot dos grupos + ações da sidebar.
   `sessionGroups` guarda os objetos crus para resolver sessão por path/key. */
const sessionTreeHost = {
  snapshot: () => sessionsSnapshot(sessionGroups, treeOpts()),
  toggleProject(path) {
    if (collapsedProjects.has(path)) collapsedProjects.delete(path);
    else collapsedProjects.add(path);
    saveTreeState();
    loadSessions();
  },
  hideProject(path) {
    if (hiddenProjects.has(path)) hiddenProjects.delete(path);
    else hiddenProjects.add(path);
    saveTreeState();
    loadSessions();
  },
  newSession(path) { newSessionIn(path); },
  open(path, key) {
    const g = sessionGroups.find(x => x.path === path);
    const s = g && (g.sessions || []).find(x => x.id === key);
    if (s) openSession(s.cwd || path, s);
  },
  askDelete(path, key) {
    const g = sessionGroups.find(x => x.path === path);
    const s = g && (g.sessions || []).find(x => x.id === key);
    if (s) askDeleteSession(s);
  },
  loadMore(path) {
    expandedProjects.add(path);
    saveTreeState();
    loadSessions();
  },
};
try {
  sessionTree = mountSessionTree(sessionTreeHost);
} catch (e) {
  debugNote('sidebar svelte: mount falhou (' + e + ')');
}

/* Resultados da busca global em Svelte (Fase 3c): snapshot dos itens acumulados
   + ações. `loadMore` repete `runSearch(true)` (append no mesmo offset). */
const searchResultsHost = {
  snapshot: () => searchSnapshot(searchItems, { total: searchTotal, offset: searchOffset }),
  open(key) {
    const r = searchItems.find(x => x && x.id === key);
    if (r) openSession(r.cwd, r);
  },
  loadMore() { runSearch(true); },
};
try {
  searchResults = mountSearchResults(searchResultsHost);
} catch (e) {
  debugNote('search svelte: mount falhou — usando o render legado (' + e + ')');
}

/* Painel Plano em Svelte (Fase 4a): snapshot dos planos + abertura do markdown. */
const plansHost = {
  snapshot: () => plansSnapshot(plansData, plansError),
  async open(file) {
    try { await inv('open_file', { cwd: current && current.cwd, path: file }); }
    catch (e) { plansError = 'abrir: ' + String(e); renderPlans(); }
  },
};
try {
  plansPane = mountPlansPane(plansHost);
} catch (e) {
  debugNote('plans svelte: mount falhou — usando o render legado (' + e + ')');
}

/* Aba "Arquivos da pasta" (read-only): lista do Rust, árvore montada no cliente.
   Só lê o que o git não ignora; sem watcher — relê ao clicar na aba e ao trocar de sessão. */
let fileList = [];
let filesError = '';
let filesPane = null;

/** Snapshot puro da aba Arquivos (Svelte + testes). */
export function filesSnapshot(files, err) {
  return {
    files: Array.isArray(files) ? files : [],
    error: err ? String(err) : '',
    empty: t('panel.no_files'),
    filterPh: t('files.filter_ph'),
  };
}

async function loadFiles() {
  const cwd = current && current.cwd;
  const seq = viewSeq;
  if (!cwd) { fileList = []; filesError = ''; syncFiles(); return; }
  try {
    const list = JSON.parse(String(await inv('project_files', { cwd })));
    if (seq !== viewSeq) return; // trocou de sessão durante a leitura
    fileList = Array.isArray(list) ? list : [];
    filesError = '';
  } catch (e) {
    if (seq !== viewSeq) return;
    fileList = [];
    filesError = String(e);
  }
  syncFiles();
}

function syncFiles() {
  if (filesPane) filesPane.sync();
}

const filesHost = {
  snapshot: () => filesSnapshot(fileList, filesError),
  open: (path) => openFileViewer(path),
};
try {
  filesPane = mountFilesPane(filesHost);
} catch (e) {
  debugNote('files svelte: mount falhou (' + e + ')');
}

/* Painel Missões em Svelte (Fase 4b): snapshot read-only + detalhe no overlay. */
const missionsHost = {
  snapshot: () => missionsSnapshot(missionsList, missionsError),
  open(key) {
    const m = missionsList.find(x => String(x.id || '') === key);
    if (m) openMission(m);
  },
};
try {
  missionsPane = mountMissionsPane(missionsHost);
} catch (e) {
  debugNote('missions svelte: mount falhou — usando o render legado (' + e + ')');
}

/* Painel Git em Svelte (Fase 4c): snapshot (repo/branch/totais/arquivos/seleção)
   + ações de escrita. `gitSel`/`gitMsg`/toggles seguem no main (fonte única). */
const gitHost = {
  snapshot: () => gitSnapshot(gitData, {
    error: gitError,
    cwd: current && current.cwd,
    sel: gitSel,
    msg: gitMsg,
    amend: gitAmend,
    lease: gitLease,
    note: gitNote,
    noteErr: gitNoteErr,
  }),
  reload: () => loadGit(),
  discard: () => gitDiscardSelected(),
  stash: () => gitStash(),
  stashPop: () => gitStashPop(),
  pull: () => gitPull(),
  toggleSel(path) {
    if (gitSel.has(path)) gitSel.delete(path);
    else gitSel.add(path);
    renderGit();
  },
  openDiff: (path) => openGitDiff(path),
  setMsg(v) { gitMsg = v; },
  setFlag(which, on) {
    if (which === 'amend') gitAmend = !!on;
    else gitLease = !!on;
    renderGit();
  },
  commit: (push) => gitCommit(push),
  push: () => gitPush(),
};
try {
  gitPane = mountGitPane(gitHost);
} catch (e) {
  debugNote('git svelte: mount falhou — usando o render legado (' + e + ')');
}

/* Painel Subagents em Svelte (Fase 4d): snapshot (live + histórico de disco) e
   abertura do child. `snapshot(now)` recalcula os tempos a cada tique do painel. */
const subsHost = {
  snapshot: (now) => subsSnapshot(
    lastSnap && lastSnap.runs,
    lastDiskList,
    { now, warn: caps.subagents === false, emptyLabel: noSubsMessage(), error: subsError },
  ),
  openChild(id) {
    const c = (lastDiskList || []).find(x => String(x.id) === id);
    if (c) openChild(c);
  },
};
try {
  subsPane = mountSubsPane(subsHost);
} catch (e) {
  debugNote('subs svelte: mount falhou — usando o render legado (' + e + ')');
}
// Aviso de extensão não tem overlay próprio: o chip do topo abre a lista, com dispensa
// por aviso e o atalho pro Diagnóstico (que lista as linhas RPC cruas).
$('healthchip').onclick = (e) => { e.stopPropagation(); toggleNotify(); };
$('notifyclose').onclick = () => toggleNotify(false);
$('notifydebug').onclick = () => { toggleNotify(false); openDebug(); };
$('notifyrestore').onclick = () => unmuteHealth();
// Fecha ao clicar fora (o clique no próprio popover e no chip não fecha).
document.addEventListener('click', (e) => {
  const pop = $('notifypop');
  if (!pop || pop.classList.contains('hidden')) return;
  if (pop.contains(e.target) || e.target.closest('#healthchip')) return;
  toggleNotify(false);
});
$('debugrefresh').onclick = () => { loadMissions(); renderDiag(); renderHealthList(); };
$('checkupdate').onclick = () => checkUpdate(true);
$('updatebtn').onclick = async () => {
  const u = pendingUpdate;
  if (!u) return;
  const btn = $('updatebtn');
  btn.disabled = true;
  let downloaded = 0, total = 0;
  try {
    await u.downloadAndInstall((ev) => {
      if (ev.event === 'Started') total = (ev.data && ev.data.contentLength) || 0;
      else if (ev.event === 'Progress') {
        downloaded += (ev.data && ev.data.chunkLength) || 0;
        $('updatetext').textContent = t('update.install') + (total ? ' ' + Math.round((downloaded / total) * 100) + '%' : ' …');
      } else if (ev.event === 'Finished') $('updatetext').textContent = t('update.install') + ' …';
    });
    await relaunch();
  } catch (e) {
    debugNote('update install falhou: ' + e);
    btn.disabled = false;
    $('updatetext').textContent = t('update.available_have', { tag: u.version, ver: appVersion });
  }
};
$('updatedismiss').onclick = () => $('updatebar').classList.add('hidden');
$('authchip').onclick = () => {
  if ($('authchip').classList.contains('ok')) checkAuth();
  else openProvPicker();
};
$('provback').onclick = closeProvPicker;
$('provsearch').oninput = (e) => renderProviders(e.target.value);
$('confirmok').onclick = async () => {
  const action = pendingAction;
  closeConfirm();
  if (action) await action();
};
$('confirmcancel').onclick = closeConfirm;
document.querySelectorAll('.pkg-tab').forEach(t => { t.onclick = () => switchPkgPane(t.dataset.pane); });
document.querySelectorAll('#settings-tabs .settings-tab').forEach(t => {
  t.onclick = () => switchSettingsTab(t.dataset.pane);
});
$('provsearchtab').oninput = () => renderProvidersTab();
$('provrefresh').onclick = () => loadProvidersTab();
$('catsearch').oninput = () => renderCatalog();
$('hooksrefresh').onclick = () => { loadHooks(); refreshHooksStatus(); };
$('setHooks').onchange = (e) => setHooksEnabled(e.target.checked);
$('mcpadd').onclick = mcpAdd;
$('mcpremove').onclick = mcpRemove;
$('mcpenvadd').onclick = () => addEnvRow();
$('mcppreset').onchange = (e) => applyPreset(e.target.value);

// Recarregar/fechar no meio do turno não perde abas nem o parcial em tela.
window.addEventListener('pagehide', () => {
  try { stashDraft(); } catch { /* ignora */ }
  try { saveTabs(); } catch { /* ignora */ }
});

applySubsVisibility((() => { try { return localStorage.getItem('subs-hidden') === '1'; } catch { return false; } })());
// Painel de subagents está sempre visível: clicar na tab é só um "atualizar"
// (run de subagent aparece no disco enquanto o turno roda, sem esperar o
// próximo agent_settled). O Git não é aba: fica fixo embaixo.
/** Aba do topo do painel direito: Subagents | Plano. Uma pane visível por vez,
    dentro do `.split-top` (o Git de baixo não participa). */
function switchPanelPane(name) {
  $('panelsubs').classList.toggle('active', name === 'subs');
  $('panelplans').classList.toggle('active', name === 'plans');
  $('panelfiles').classList.toggle('active', name === 'files');
  $('subs').classList.toggle('hidden', name !== 'subs');
  $('plans').classList.toggle('hidden', name !== 'plans');
  $('files').classList.toggle('hidden', name !== 'files');
}

$('panelsubs').onclick = () => {
  switchPanelPane('subs');
  if (current && current.childrenDir) loadChildren(current.childrenDir);
};
// Ativar a aba relê: o `plans/*.md` muda no disco entre turnos, sem polling próprio.
$('panelplans').onclick = () => { switchPanelPane('plans'); loadPlans(); };
// Ativar a aba relê: o agente cria arquivos entre turnos e não há watcher.
$('panelfiles').onclick = () => { switchPanelPane('files'); loadFiles(); };
$('diagclear').onclick = () => { diagBuf.length = 0; diagPending.clear(); renderDiag(); };
initSplit();
initColumnResize();
// Dock do terminal: cwd/home vêm da sessão ativa (o PTY não segue trocas de sessão sozinho)
initTerminal({ getCwd: () => (current && current.cwd) || '' });
// Diff dos tool cards: `tool-cards.js` não pode importar `main.js` (ciclo).
setDiffRenderer(renderPatch);
setEmptyState(true, 'nosession');

loadSettings();
loadTreeState();
loadCachedModels();
startMemMonitor();
loadModelFavs();
loadHiddenProviders();
loadLastModel();
loadCachedLevels();
loadCachedCommands();
warmModels();

(async () => {
  try { $('piversion').textContent = 'pi ' + await inv('pi_version'); } catch { /* sem versão */ }
  try { await inv('kill_orphans'); } catch { /* nada a limpar */ }
  try { appVersion = String(await inv('app_version')); } catch { appVersion = null; }
  checkUpdate(false);
  checkAuth();
  try { homeDir = await inv('home_dir'); } catch { homeDir = null; }
  restoreTabs();
  startGitPoll();
  await loadSessions();
  // Abas da sessão anterior voltam como leitura; o foco reconecta via ensureRpc.
  if (!current && activeTab) {
    try { await switchTab(activeTab.key); } catch { /* aba órfã: fica na barra para fechar */ }
  }
  try {
    const flags = String(await inv('debug_flags'));
    debugEnabled = flags.includes('debug');
    if (flags.includes('autonew')) $('newsession').click();
  } catch { /* sem flags */ }
})();
