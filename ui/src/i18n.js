/* i18n PT/EN com auto-detect.
 * Fonte única para o chrome da UI. `main.js` e `tool-cards.js` usam `t()`;
 * estáticos do `index.html` via `applyStaticI18n()` (por id, sem data-i18n).
 * Persistência: `localStorage['lang']` ('pt'|'en'). Default: navigator.language
 * pt-* -> 'pt', resto -> 'en'. Seguro sem DOM/storage (testes/jsdom).
 */
export const LANGS = ['pt', 'en'];

export function detectLang() {
  try {
    const n = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || '';
    return String(n).toLowerCase().startsWith('pt') ? 'pt' : 'en';
  } catch { return 'en'; }
}

export function getLang() {
  try {
    const s = localStorage.getItem('lang');
    if (s === 'pt' || s === 'en') return s;
    if (s === 'auto' || s == null) return detectLang();
  } catch { /* sem storage */ }
  return detectLang();
}

export function getLangPref() {
  try {
    const s = localStorage.getItem('lang');
    if (s === 'pt' || s === 'en' || s === 'auto') return s;
  } catch { /* sem storage */ }
  return 'auto';
}

export function setLang(lang) {
  const pref = lang === 'pt' || lang === 'en' || lang === 'auto' ? lang : 'auto';
  const l = pref === 'auto' ? detectLang() : pref;
  try { localStorage.setItem('lang', pref); } catch { /* sem storage */ }
  try { document.documentElement.lang = l === 'pt' ? 'pt-BR' : 'en'; } catch { /* sem DOM */ }
  return l;
}

function fmt(tpl, vars) {
  let s = String(tpl == null ? '' : tpl);
  if (!vars) return s;
  for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

export const STRINGS = {
  pt: {
    'status.disconnected': 'desconectado',
    'status.connected': 'conectado',
    'status.working': 'trabalhando',
    'status.readonly': 'somente leitura',
    'status.reloading': 'recarregando…',
    'status.thinking': 'pensando…',
    'status.ghost_unlocked_ok': 'turno encerrado sem aviso do pi — indicador destravado',
    'status.ghost_unlocked_fail': 'o pi não respondeu ao estado do turno — indicador destravado',

    'sidebar.sessions': 'Sessões',
    'sidebar.search_ph': 'buscar nas sessões…',
    'sidebar.tool_filter_ph': 'tool (ex: edit)',
    'sidebar.errors_only': 'erros',
    'sidebar.no_sessions': 'nenhuma sessão em ~/.pi/agent/sessions',
    'sidebar.loading': 'carregando…',
    'sidebar.no_project': 'sem projeto',
    'sidebar.untitled': 'sem título',
    'sidebar.load_more': 'carregar mais ({n})',
    'sidebar.show_more': 'mostrar mais ({n})',
    'sidebar.matches': 'trecho(s)',
    'sidebar.error_badge': 'erro',

    'empty.new_session': 'Sessão nova — escreva abaixo para começar.',
    'empty.no_session_a': 'Selecione uma sessão na barra à esquerda',
    'empty.no_session_b': 'ou crie uma nova com ',
    'empty.no_session_c': ' no projeto.',

    'composer.placeholder': 'mensagem para o pi  ·  Enter envia · Ctrl+Enter quebra linha',
    'composer.cmd_ph': 'comando, /model …  ·  Esc fecha',
    'composer.send': 'Enviar (Enter)',
    'composer.enqueue': 'Enfileirar mensagem (turno rodando)',
    'composer.stop': 'Interromper o turno (Esc)',
    'composer.model_search_ph': 'Search models…',
    'composer.thinking': 'Thinking',
    'composer.fork_from': 'fork a partir de… · cria sessão nova · a original é preservada',
    'composer.no_answer': 'nenhuma resposta para copiar',
    'composer.copy_fail': 'falha ao copiar: {e}',
    'composer.no_session': 'sem sessão aberta',
    'composer.nothing_fork': 'nada para fork: sem mensagens do usuário nesta sessão',
    'composer.notext': '(sem texto)',
    'composer.palette_recent': '↑↓ navegar · Enter executar · Esc fechar · sem busca: recentes primeiro',
    'composer.palette_complete': '↑↓ selecionar · Tab completar · Enter executar · Esc fechar',

    'panel.subs': 'Subagents',
    'panel.plans': 'Plano',
    'panel.git': 'Git',
    'panel.no_subs': 'nenhum subagent',
    'panel.no_subs_ext': 'pi-subagents não carregou nesta sessão (possível conflito de tool). Veja ⚙ → Pacotes e MCP.',
    'panel.no_plans': 'nenhum plano',
    'panel.no_plans_found': 'nenhum plano encontrado (plans/, docs/spec, PLAN.md…)',
    'panel.no_checklist': 'sem checklist',
    'panel.no_git': 'sem repositório git',
    'panel.git_clean': 'repositório limpo — nenhuma mudança no worktree',
    'panel.no_warnings': 'nenhum aviso nesta sessão',
    'panel.no_lines': 'sem linhas RPC ainda',
    'panel.no_missions': 'nenhuma missão',
    'panel.no_stats': 'sem estatísticas ainda',
    'panel.transcript_loading': 'carregando transcript…',
    'panel.transcript_empty': 'transcript vazio (arquivo sem mensagens)',
    'panel.starting': 'iniciando… {id}',
    'panel.thinking_label': 'pensando…',
    'panel.files': 'Arquivos da pasta',
    'panel.changed': 'Alterado',
    'panel.no_files': 'nenhum plano (.md) na pasta',
    'files.filter_ph': 'filtrar planos…',
    'files.loading': 'lendo arquivo…',
    'files.binary': 'arquivo binário — use "abrir no editor" para ver o conteúdo',
    'files.truncated': 'mostrando os primeiros 256 KB de {total}',
    'files.open_editor': 'abrir no editor',
    'files.copy_path': 'copiar caminho',

    'history.load_more': 'carregar anteriores ({left} de {total})',
    'history.loading': 'carregando…',

    'settings.expand_tools': 'Ferramentas expandidas',
    'settings.expand_think': 'Thinking expandido',
    'settings.show_hidden': 'Mostrar projetos ocultos',
    'settings.notify_desktop': 'Notificar término em 2º plano',
    'settings.notify_sound': 'Som ao terminar em 2º plano',
    'settings.instrument': 'Instrumentar hooks',
    'settings.theme': 'Tema',
    'settings.packages': 'Pacotes e MCP',
    'settings.debug': 'Debug',
    'settings.about': 'Sobre',
    'settings.check_update': 'Verificar atualização',
    'settings.update_ext': 'Atualizar extensões',
    'settings.update_pi': 'Atualizar pi',
    'settings.language': 'Idioma',
    'settings.lang_pt': 'Português',
    'settings.lang_en': 'English',
    'settings.lang_auto': 'Auto (navegador)',
    'settings.group_transcript': 'Transcript',
    'settings.group_notify': 'Notificações',
    'settings.group_project': 'Projeto',
    'settings.group_appearance': 'Aparência',
    'settings.group_tools': 'Ferramentas',
    'settings.group_maintenance': 'Manutenção',

    'common.loading': 'carregando…',
    'common.updating': 'Atualizar',
    'common.refresh': 'Atualizar',
    'common.back': '← voltar',
    'common.close': 'Fechar',
    'common.cancel': 'Cancelar',
    'common.execute': 'Executar',
    'common.download': 'Baixar',
    'common.dismiss': 'Dispensar',
    'common.clear': 'limpar',
    'common.apply': 'aplicar',
    'common.export_current': 'exportar atual',
    'common.reset': 'resetar',
    'common.add_test': 'Adicionar e testar',
    'common.remove_by_name': 'Remover pelo nome',
    'common.save': 'Salvar',

    'pkgs.title': 'Pacotes',
    'pkgs.installed': 'Instalados',
    'pkgs.catalog': 'Catálogo',
    'pkgs.mcp': 'MCP',
    'pkgs.hooks': 'Hooks',
    'pkgs.catalog_ph': 'filtrar o catálogo (npm keywords:pi-package)…',
    'pkgs.querying': 'consultando registry.npmjs.org…',
    'pkgs.query_fail': 'falha ao consultar o registry: {e}',
    'pkgs.none_found': 'nada encontrado',
    'pkgs.no_mcp': 'nenhum servidor MCP configurado',
    'pkgs.removing': 'removendo…',
    'pkgs.installing': 'instalando {spec}…',
    'pkgs.removing_spec': 'removendo {spec}…',
    'pkgs.need_name': 'informe o nome',
    'pkgs.need_target': 'informe uma URL ou um comando',
    'pkgs.running': 'executando…',
    'pkgs.hooks_empty': '(sem registros ainda) — dispare uma mensagem e volte aqui',
    'pkgs.logger_on': 'logger ativo · ',
    'pkgs.logger_off': 'logger inativo · ',

    'mcp.name_ph': 'nome do servidor',
    'mcp.target_ph': 'https://… (HTTP) ou comando: npx -y pacote',
    'mcp.args_ph': 'argumentos extras (ex.: /home/usuario)',
    'mcp.add_env': '+ variável de ambiente',
    'mcp.project_scope': 'projeto (.pi/mcp.json)',
    'mcp.raw_json': 'JSON cru',
    'mcp.add_server': 'Adicionar servidor',
    'mcp.remove': 'Remover',

    'prov.title': 'Login — escolha o provedor',
    'prov.search_ph': 'filtrar provedores…',
    'prov.loading': 'carregando provedores…',
    'prov.none': 'nenhum provedor encontrado',
    'prov.no_cred': 'sem credencial',
    'prov.current': 'atual: {p}',
    'prov.login': 'logar {p}',
    'prov.auth_ok': 'auth ok',

    'theme.restored': "tema padrão restaurado (localStorage['theme'] removido)",
    'theme.paste_note': 'cole um JSON de tokens (--bg, --accent, …) e clique em aplicar',
    'theme.presets': 'Presets',
    'theme.custom': 'Personalizado (JSON)',
    'theme.use_preset': 'usar {name}',
    'theme.active': 'ativo',
    'theme.exported': 'exportado',

    'about.body': 'O sightdeck é um cliente desktop para o pi — ele não instala nem atualiza o pi sozinho: os botões de atualização chamam pi update.',

    'update.available': 'Atualização disponível: {tag}',
    'update.check_fail': 'falha ao verificar',
    'update.running': 'rodando… (pode demorar)',

    'git.pull': 'pull',
    'git.discard': 'descartar',
    'git.stash': 'stash',
    'git.stash_pop': 'stash pop',
    'git.commit': 'commit',
    'git.commit_push': 'commit & push',
    'git.push': 'push',
    'git.reload': 'atualizar',
    'git.commit_msg_ph': 'mensagem do commit · Ctrl+Enter commita',
    'git.amend': 'amend',
    'git.force_lease': 'force-with-lease',
    'git.empty_msg': 'mensagem vazia — nada foi commitado',
    'git.commit_push_done': 'commit {h} feito, push falhou — {e}',
    'git.discard_confirm': 'descartar {n} arquivo(s)?\n\n{files}\ne excluir {extra} extra(s) não listado(s)?',
    'git.push_force_confirm': 'git push --force-with-lease\n\nno repositório {cwd}?',

    'tools.lines': 'linhas',
    'tools.matches': 'matches',
    'tools.entries': 'entradas',
    'tools.truncated': '\n… saída truncada ({cut} de {total} linhas)',
    'tools.thinking': 'thinking',
    'tools.unified': 'vista unificada',
    'tools.split': 'vista dividida',
    'tools.undo_hunk': 'desfazer hunk',
    'tools.copy_path': 'copiar caminho',
    'tools.open': 'abrir',
    'tools.diff_readonly': 'git diff · somente leitura',
    'tools.reading_diff': 'lendo diff…',
    'tools.no_changes': 'sem alterações no worktree',
    'tools.no_diff': 'sem diff (arquivo novo ou conteúdo não registrado)',
    'tools.diff_fail': 'git diff: {e}',

    'term.in': 'terminal em {cwd} · sessão em {sess} — use reiniciar',
    'term.dir': 'diretório do terminal ativo',
    'term.tab': 'terminal {n}',
    'term.ended': '[terminou]',
    'term.close_tab': 'fechar esta aba',
    'term.new': 'Novo terminal',
    'term.restart': 'reiniciar',
    'term.close': 'Fechar o terminal (Ctrl+`)',
    'term.no_session': 'abra uma sessão para o terminal herdar a pasta',
    'term.open_fail': 'não foi possível abrir o terminal: {e}',
    'term.resize': 'arraste para redimensionar',

    'theme.invalid_json': 'JSON inválido: {e}',

    'empty.plus_new': '+ Nova',
    'empty.new_hint': 'Nova sessão sem projeto (inicia em ~)',
    'empty.new_folder': '+ Pasta',
    'empty.folder_hint': 'Abrir uma pasta como projeto',

    'proj.new_here': 'Nova sessão neste projeto ({path})',
    'proj.show': 'Mostrar projeto',
    'proj.hide': 'Ocultar projeto (não apaga nada)',

    'sess.badge_runs': 'subagent runs desta sessão',
    'sess.trash': 'Mover esta sessão para a lixeira',
    'sess.renamed': 'sessão renomeada',

    'search.total': '{n} sessão(ões)',
    'search.none': 'nada encontrado',
    'search.capped': 'teto de leitura atingido',
    'search.coverage': '{n} de {m} sessões',
    'search.showing': 'mostrando {n}',
    'search.matches': '{id} · {n} trecho(s)',

    'missions.empty': 'nenhuma missão no disco',
    'missions.count': '{n} missão(ões)',
    'missions.detail_fallback': 'missão',
    'missions.detail_head': '{status} · {runs} run(s)',

    'subs.history': 'histórico · {n} run(s)',

    'plan.open_in_app': 'clique abre no app padrão',

    'diag.count': '{n} linha(s) (máx {max})',

    'tools.omitted': '… {n} linha(s) omitida(s)',

    'custom.label': 'extensão',

    'ctx.window': 'Context window',
    'ctx.percent_used': '{pct}% usado',
    'ctx.tokens_of': '{used} / {win} tokens',
    'ctx.alert_full': 'Contexto quase cheio ({pct}%) — rode /compact agora',
    'ctx.alert_warn': 'Contexto em {pct}% — considere /compact',
    'ctx.auto': 'Auto-compactação',
    'ctx.on': 'ligada',
    'ctx.off': 'desligada',
    'ctx.compact_at': 'Compactar em',
    'ctx.limit_default': 'padrão do pi',
    'ctx.limit_pct': '{p}% · reserva {r}',
    'ctx.limit_custom': 'custom · reserva {r}',
    'ctx.limit_title': 'Em que ponto do contexto o pi compacta. Vale ao reiniciar o pi (↻).',
    'ctx.limit_saved_default': 'compactação: padrão do pi (aplica ao reiniciar ↻)',
    'ctx.limit_saved': 'compactação em {pct}% do contexto · reserva {r} (aplica ao reiniciar ↻)',
    'ctx.limit_fail': 'falha ao salvar o limite de compactação: {e}',
    'ctx.cache': 'Prompt cache (sessão)',
    'ctx.cache_value': 'read {r} · write {w}',
    'ctx.cache_hit': 'Cache hit do input',
    'ctx.cache_hit_value': '{pct}% veio do cache',
    'ctx.avg': 'Velocidade média',
    'ctx.avg_value': '{n}',
    'ctx.composition': 'Composição (estimada)',
    'ctx.comp_system': 'system',
    'ctx.comp_user': 'usuário',
    'ctx.comp_assistant': 'assistente',
    'ctx.comp_tools': 'tools',
    'ctx.io': 'Input / Output',
    'ctx.live': 'Turno em andamento',
    'ctx.live_value': '+{b} tokens · +{c} no contexto',
    'ctx.cost': 'Custo',
    'ctx.messages': 'Mensagens',
    'ctx.sess_one': '{n} sessão',
    'ctx.sess_many': '{n} sessões',
    'ctx.agg': '{tok} · {cost} · {n} msg',
    'ctx.unavailable': 'contexto indisponível',
    'ctx.chip_title': '{used} / {win} tokens ({pct}%)',
    'ctx.chip_live': ' · +{b} em voo',
    'ctx.chip_more': ' — clique para detalhes',
    'ctx.compact_now': 'Compactar agora (resume o histórico)',
    'ctx.open': 'Contexto',

    'queue.restored': 'fila devolvida: {n} mensagem(ns)',
    'queue.unqueue_hint': 'Desfazer fila: devolve as mensagens enfileiradas ao composer sem interromper o turno',

    'fork.row_msg': 'fork a partir desta mensagem (nova sessão, original preservada)',
    'fork.row_ans': 'fork daqui (nova sessão a partir do prompt anterior)',
    'fork.title_suffix': 'fork cria uma sessão nova — a original é preservada',
    'fork.empty': 'nada para fork',
    'fork.no_match': 'não localizei a mensagem para fork — escolha na lista',
    'fork.created': 'fork criado em nova sessão — a original foi preservada',
    'fork.restored': ' (texto restaurado no composer)',
    'fork.failed': 'fork falhou',
    'fork.cancelled': 'fork cancelado',
    'fork.header': 'fork a partir de… · cria sessão nova · a original é preservada',

    'stats.note': 'sessão: {msgs} mensagens · {tokens} tokens{cost}',

    'think.set': 'thinking: {level}',
    'think.none': 'modelo sem níveis de thinking',

    'model.none': 'nenhum modelo',
    'model.fav_toggle': 'Favoritar modelo (vai para o topo)',
    'model.favs': 'FAVORITOS',
    'model.not_found': 'modelo não encontrado para "{q}"',

    'palette.empty': 'nenhum resultado',

    'cmd.compact': 'Compactar o histórico (opcional: instruções)',
    'cmd.model': 'Escolher o modelo: /model [busca]',
    'cmd.thinking': 'Ciclar o nível de thinking',
    'cmd.new': 'Nova sessão nesta pasta',
    'cmd.name': 'Renomear a sessão: /name <nome>',
    'cmd.name_usage': 'uso: /name <nome>',
    'cmd.session': 'Info da sessão (tokens e custo)',
    'cmd.copy': 'Copiar a última resposta',
    'cmd.export': 'Exportar a sessão em HTML',
    'cmd.abort': 'Interromper o turno atual',
    'cmd.unqueue': 'Devolver a fila ao composer (sem interromper o turno)',
    'cmd.fork': 'Criar fork (nova sessão) de mensagem anterior — a original é preservada',
    'cmd.login': 'Escolher provedor e logar: /login [provider]',

    'pkgs.per_month': '/mês',

    'mcp.env_ph': 'valor ou nome da variável',

    'about.pi_bin': 'binário do pi',

    'health.chip': '{n} aviso(s) de extensão · clique para abrir o Diagnóstico',
    'health.dismiss': 'dispensar: não conta mais no ⚠ (dá para restaurar depois)',

    'git.no_repo': 'sem repositório git em {path}',
    'git.hint_reload': 'relê o git status',
    'git.hint_discard': 'git restore dos selecionados (só rastreados)',
    'git.hint_stash': 'git stash push --include-untracked (tudo, com untracked)',
    'git.hint_stash_pop': 'git stash pop (conflito aparece na linha de status)',
    'git.hint_pull': 'git pull --ff-only (falha aparece na linha de status)',
    'git.hint_amend': 'git commit --amend -m (troca a mensagem do último commit)',
    'git.hint_lease': 'só liga `git push --force-with-lease`; pede confirmação com o comando literal',
    'git.hint_commit': 'estágia os selecionados e commita (Ctrl+Enter)',
    'git.discard_prompt': 'descartar {n} arquivo(s)?\n\n{files}\n\ngit restore -- (só rastreados; não tem desfazer)',

    'sys.reload_hint': 'Reinicia o pi (recarrega extensões)',

    'composer.attach_hint': 'Anexar arquivo como contexto (insere o caminho no texto)',
    'composer.thinking_btn': 'thinking',

    'panel.subs_hint': 'Subagents desta sessão',
    'panel.plans_hint': 'planos de plans/ no projeto da sessão',
    'panel.git_hint': 'Status do repositório git · commit, descartar, stash, push',

    'debug.missions': 'Missões',
    'debug.health': 'Avisos de extensão',
    'debug.diag': 'Diagnóstico',

    'update.available_have': 'Atualização disponível: {tag} (você tem v{ver})',
    'update.latest_yes': 'atualização disponível',
    'update.latest_no': 'já está atualizado',

    'copy.done': 'resposta copiada ({n} caracteres)',
    'model.set_fail': 'set_model: falhou',
    'compact.done': 'contexto compactado',
    'compact.fail': 'falha ao compactar',
    'export.done': 'exportado: {x}',
    'turn.interrupted': 'turno interrompido',
    'health.more': '… +{n} aviso(s)',
    'notify.head': 'Notificações',
    'notify.title': '{n} aviso(s) de extensão no total (todas as sessões)',
    'notify.empty': 'nenhum aviso agora',
    'update.install': 'Baixar e instalar'
  },
  en: {
    'status.disconnected': 'disconnected',
    'status.connected': 'connected',
    'status.working': 'working',
    'status.readonly': 'read-only',
    'status.reloading': 'reloading…',
    'status.thinking': 'thinking…',
    'status.ghost_unlocked_ok': 'turn ended without pi notice — indicator unlocked',
    'status.ghost_unlocked_fail': 'pi did not answer turn state — indicator unlocked',

    'sidebar.sessions': 'Sessions',
    'sidebar.search_ph': 'search sessions…',
    'sidebar.tool_filter_ph': 'tool (e.g. edit)',
    'sidebar.errors_only': 'errors',
    'sidebar.no_sessions': 'no sessions in ~/.pi/agent/sessions',
    'sidebar.loading': 'loading…',
    'sidebar.no_project': 'no project',
    'sidebar.untitled': 'untitled',
    'sidebar.load_more': 'load more ({n})',
    'sidebar.show_more': 'show more ({n})',
    'sidebar.matches': 'match(es)',
    'sidebar.error_badge': 'error',

    'empty.new_session': 'New session — write below to start.',
    'empty.no_session_a': 'Select a session in the left bar',
    'empty.no_session_b': 'or create a new one with ',
    'empty.no_session_c': ' in the project.',

    'composer.placeholder': 'message for pi  ·  Enter sends · Ctrl+Enter new line',
    'composer.cmd_ph': 'command, /model …  ·  Esc closes',
    'composer.send': 'Send (Enter)',
    'composer.enqueue': 'Enqueue message (turn running)',
    'composer.stop': 'Interrupt the turn (Esc)',
    'composer.model_search_ph': 'Search models…',
    'composer.thinking': 'Thinking',
    'composer.fork_from': 'fork from… · creates a new session · the original is kept',
    'composer.no_answer': 'no answer to copy',
    'composer.copy_fail': 'copy failed: {e}',
    'composer.no_session': 'no open session',
    'composer.nothing_fork': 'nothing to fork: no user messages in this session',
    'composer.notext': '(no text)',
    'composer.palette_recent': '↑↓ navigate · Enter run · Esc close · no search: recent first',
    'composer.palette_complete': '↑↓ select · Tab complete · Enter run · Esc close',

    'panel.subs': 'Subagents',
    'panel.plans': 'Plan',
    'panel.git': 'Git',
    'panel.no_subs': 'no subagents',
    'panel.no_subs_ext': 'pi-subagents did not load in this session (possible tool conflict). See ⚙ → Packages & MCP.',
    'panel.no_plans': 'no plans',
    'panel.no_plans_found': 'no plans found (plans/, docs/spec, PLAN.md…)',
    'panel.no_checklist': 'no checklist',
    'panel.no_git': 'no git repository',
    'panel.git_clean': 'clean tree — no worktree changes',
    'panel.no_warnings': 'no warnings in this session',
    'panel.no_lines': 'no RPC lines yet',
    'panel.no_missions': 'no missions',
    'panel.no_stats': 'no stats yet',
    'panel.transcript_loading': 'loading transcript…',
    'panel.transcript_empty': 'empty transcript (file has no messages)',
    'panel.starting': 'starting… {id}',
    'panel.thinking_label': 'thinking…',
    'panel.files': 'Folder files',
    'panel.changed': 'Changed',
    'panel.no_files': 'no plans (.md) in this folder',
    'files.filter_ph': 'filter plans…',
    'files.loading': 'reading file…',
    'files.binary': 'binary file — use "open in editor" to view it',
    'files.truncated': 'showing the first 256 KB of {total}',
    'files.open_editor': 'open in editor',
    'files.copy_path': 'copy path',

    'history.load_more': 'load older ({left} of {total})',
    'history.loading': 'loading…',

    'settings.expand_tools': 'Expanded tools',
    'settings.expand_think': 'Expanded thinking',
    'settings.show_hidden': 'Show hidden projects',
    'settings.notify_desktop': 'Notify on background finish',
    'settings.notify_sound': 'Sound on background finish',
    'settings.instrument': 'Instrument hooks',
    'settings.theme': 'Theme',
    'settings.packages': 'Packages & MCP',
    'settings.debug': 'Debug',
    'settings.about': 'About',
    'settings.check_update': 'Check for updates',
    'settings.update_ext': 'Update extensions',
    'settings.update_pi': 'Update pi',
    'settings.language': 'Language',
    'settings.lang_pt': 'Português',
    'settings.lang_en': 'English',
    'settings.lang_auto': 'Auto (browser)',
    'settings.group_transcript': 'Transcript',
    'settings.group_notify': 'Notifications',
    'settings.group_project': 'Project',
    'settings.group_appearance': 'Appearance',
    'settings.group_tools': 'Tools',
    'settings.group_maintenance': 'Maintenance',

    'common.loading': 'loading…',
    'common.updating': 'Update',
    'common.refresh': 'Refresh',
    'common.back': '← back',
    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.execute': 'Run',
    'common.download': 'Download',
    'common.dismiss': 'Dismiss',
    'common.clear': 'clear',
    'common.apply': 'apply',
    'common.export_current': 'export current',
    'common.reset': 'reset',
    'common.add_test': 'Add & test',
    'common.remove_by_name': 'Remove by name',
    'common.save': 'Save',

    'pkgs.title': 'Packages',
    'pkgs.installed': 'Installed',
    'pkgs.catalog': 'Catalog',
    'pkgs.mcp': 'MCP',
    'pkgs.hooks': 'Hooks',
    'pkgs.catalog_ph': 'filter catalog (npm keywords:pi-package)…',
    'pkgs.querying': 'querying registry.npmjs.org…',
    'pkgs.query_fail': 'registry query failed: {e}',
    'pkgs.none_found': 'nothing found',
    'pkgs.no_mcp': 'no MCP servers configured',
    'pkgs.removing': 'removing…',
    'pkgs.installing': 'installing {spec}…',
    'pkgs.removing_spec': 'removing {spec}…',
    'pkgs.need_name': 'enter a name',
    'pkgs.need_target': 'enter a URL or a command',
    'pkgs.running': 'running…',
    'pkgs.hooks_empty': '(no records yet) — send a message and come back here',
    'pkgs.logger_on': 'logger active · ',
    'pkgs.logger_off': 'logger inactive · ',

    'mcp.name_ph': 'server name',
    'mcp.target_ph': 'https://… (HTTP) or command: npx -y package',
    'mcp.args_ph': 'extra args (e.g. /home/user)',
    'mcp.add_env': '+ environment variable',
    'mcp.project_scope': 'project (.pi/mcp.json)',
    'mcp.raw_json': 'Raw JSON',
    'mcp.add_server': 'Add server',
    'mcp.remove': 'Remove',

    'prov.title': 'Login — choose a provider',
    'prov.search_ph': 'filter providers…',
    'prov.loading': 'loading providers…',
    'prov.none': 'no providers found',
    'prov.no_cred': 'no credential',
    'prov.current': 'current: {p}',
    'prov.login': 'log in {p}',
    'prov.auth_ok': 'auth ok',

    'theme.restored': "default theme restored (localStorage['theme'] removed)",
    'theme.paste_note': 'paste a JSON of tokens (--bg, --accent, …) and click apply',
    'theme.presets': 'Presets',
    'theme.custom': 'Custom (JSON)',
    'theme.use_preset': 'use {name}',
    'theme.active': 'active',
    'theme.exported': 'exported',

    'about.body': 'sightdeck is a desktop client for pi — it never installs or updates pi by itself: the update buttons call pi update.',

    'update.available': 'Update available: {tag}',
    'update.check_fail': 'check failed',
    'update.running': 'running… (may take a while)',

    'git.pull': 'pull',
    'git.discard': 'discard',
    'git.stash': 'stash',
    'git.stash_pop': 'stash pop',
    'git.commit': 'commit',
    'git.commit_push': 'commit & push',
    'git.push': 'push',
    'git.reload': 'refresh',
    'git.commit_msg_ph': 'commit message · Ctrl+Enter commits',
    'git.amend': 'amend',
    'git.force_lease': 'force-with-lease',
    'git.empty_msg': 'empty message — nothing committed',
    'git.commit_push_done': 'commit {h} done, push failed — {e}',
    'git.discard_confirm': 'discard {n} file(s)?\n\n{files}\nand delete {extra} unlisted extra(s)?',
    'git.push_force_confirm': 'git push --force-with-lease\n\nin repository {cwd}?',

    'tools.lines': 'lines',
    'tools.matches': 'matches',
    'tools.entries': 'entries',
    'tools.truncated': '\n… output truncated ({cut} of {total} lines)',
    'tools.thinking': 'thinking',
    'tools.unified': 'unified view',
    'tools.split': 'split view',
    'tools.undo_hunk': 'undo hunk',
    'tools.copy_path': 'copy path',
    'tools.open': 'open',
    'tools.diff_readonly': 'git diff · read-only',
    'tools.reading_diff': 'reading diff…',
    'tools.no_changes': 'no worktree changes',
    'tools.no_diff': 'no diff (new file or untracked content)',
    'tools.diff_fail': 'git diff: {e}',

    'term.in': 'terminal in {cwd} · session in {sess} — use restart',
    'term.dir': 'active terminal directory',
    'term.tab': 'terminal {n}',
    'term.ended': '[ended]',
    'term.close_tab': 'close this tab',
    'term.new': 'New terminal',
    'term.restart': 'restart',
    'term.close': 'Close terminal (Ctrl+`)',
    'term.no_session': 'open a session so the terminal inherits its folder',
    'term.open_fail': 'could not open the terminal: {e}',
    'term.resize': 'drag to resize',

    'theme.invalid_json': 'Invalid JSON: {e}',

    'empty.plus_new': '+ New',
    'empty.new_hint': 'New session without a project (starts at ~)',
    'empty.new_folder': '+ Folder',
    'empty.folder_hint': 'Open a folder as a project',

    'proj.new_here': 'New session in this project ({path})',
    'proj.show': 'Show project',
    'proj.hide': 'Hide project (deletes nothing)',

    'sess.badge_runs': 'subagent runs of this session',
    'sess.trash': 'Move this session to trash',
    'sess.renamed': 'session renamed',

    'search.total': '{n} session(s)',
    'search.none': 'nothing found',
    'search.capped': 'read cap reached',
    'search.coverage': '{n} of {m} sessions',
    'search.showing': 'showing {n}',
    'search.matches': '{id} · {n} match(es)',

    'missions.empty': 'no missions on disk',
    'missions.count': '{n} mission(s)',
    'missions.detail_fallback': 'mission',
    'missions.detail_head': '{status} · {runs} run(s)',

    'subs.history': 'history · {n} run(s)',

    'plan.open_in_app': 'click opens in the default app',

    'diag.count': '{n} line(s) (max {max})',

    'tools.omitted': '… {n} line(s) omitted',

    'custom.label': 'extension',

    'ctx.window': 'Context window',
    'ctx.percent_used': '{pct}% used',
    'ctx.tokens_of': '{used} / {win} tokens',
    'ctx.alert_full': 'Context nearly full ({pct}%) — run /compact now',
    'ctx.alert_warn': 'Context at {pct}% — consider /compact',
    'ctx.auto': 'Auto-compaction',
    'ctx.on': 'on',
    'ctx.off': 'off',
    'ctx.compact_at': 'Compact at',
    'ctx.limit_default': 'pi default',
    'ctx.limit_pct': '{p}% · reserve {r}',
    'ctx.limit_custom': 'custom · reserve {r}',
    'ctx.limit_title': 'Context point at which pi compacts. Applies when restarting pi (↻).',
    'ctx.limit_saved_default': 'compaction: pi default (applies on restart ↻)',
    'ctx.limit_saved': 'compaction at {pct}% of context · reserve {r} (applies on restart ↻)',
    'ctx.limit_fail': 'failed to save the compaction limit: {e}',
    'ctx.cache': 'Prompt cache (session)',
    'ctx.cache_value': 'read {r} · write {w}',
    'ctx.cache_hit': 'Input cache hit',
    'ctx.cache_hit_value': '{pct}% came from cache',
    'ctx.avg': 'Average speed',
    'ctx.avg_value': '{n}',
    'ctx.composition': 'Composition (estimated)',
    'ctx.comp_system': 'system',
    'ctx.comp_user': 'user',
    'ctx.comp_assistant': 'assistant',
    'ctx.comp_tools': 'tools',
    'ctx.io': 'Input / Output',
    'ctx.live': 'Turn in progress',
    'ctx.live_value': '+{b} tokens · +{c} in context',
    'ctx.cost': 'Cost',
    'ctx.messages': 'Messages',
    'ctx.sess_one': '{n} session',
    'ctx.sess_many': '{n} sessions',
    'ctx.agg': '{tok} · {cost} · {n} msg',
    'ctx.unavailable': 'context unavailable',
    'ctx.chip_title': '{used} / {win} tokens ({pct}%)',
    'ctx.chip_live': ' · +{b} live',
    'ctx.chip_more': ' — click for details',
    'ctx.compact_now': 'Compact now (summarize history)',
    'ctx.open': 'Context',

    'queue.restored': 'queue returned: {n} message(s)',
    'queue.unqueue_hint': 'Unqueue: return queued messages to the composer without interrupting the turn',

    'fork.row_msg': 'fork from this message (new session, original preserved)',
    'fork.row_ans': 'fork here (new session from the previous prompt)',
    'fork.title_suffix': 'fork creates a new session — the original is preserved',
    'fork.empty': 'nothing to fork',
    'fork.no_match': 'could not locate the message to fork — pick from the list',
    'fork.created': 'fork created in a new session — the original was preserved',
    'fork.restored': ' (text restored to the composer)',
    'fork.failed': 'fork failed',
    'fork.cancelled': 'fork cancelled',
    'fork.header': 'fork from… · creates a new session · the original is preserved',

    'stats.note': 'session: {msgs} messages · {tokens} tokens{cost}',

    'think.set': 'thinking: {level}',
    'think.none': 'model has no thinking levels',

    'model.none': 'no models',
    'model.fav_toggle': 'Favorite model (pins to top)',
    'model.favs': 'FAVORITES',
    'model.not_found': 'no model found for "{q}"',

    'palette.empty': 'no results',

    'cmd.compact': 'Compact history (optional: instructions)',
    'cmd.model': 'Pick the model: /model [query]',
    'cmd.thinking': 'Cycle the thinking level',
    'cmd.new': 'New session in this folder',
    'cmd.name': 'Rename the session: /name <name>',
    'cmd.name_usage': 'usage: /name <name>',
    'cmd.session': 'Session info (tokens and cost)',
    'cmd.copy': 'Copy the last answer',
    'cmd.export': 'Export the session as HTML',
    'cmd.abort': 'Interrupt the current turn',
    'cmd.unqueue': 'Return the queue to the composer (without interrupting the turn)',
    'cmd.fork': 'Create a fork (new session) from an earlier message — the original is preserved',
    'cmd.login': 'Pick a provider and log in: /login [provider]',

    'pkgs.per_month': '/mo',

    'mcp.env_ph': 'value or variable name',

    'about.pi_bin': 'pi binary',

    'health.chip': '{n} extension warning(s) · click to open Diagnostics',
    'health.dismiss': 'dismiss: no longer counts toward ⚠ (restorable later)',

    'git.no_repo': 'no git repository in {path}',
    'git.hint_reload': 're-read git status',
    'git.hint_discard': 'git restore of selected (tracked only)',
    'git.hint_stash': 'git stash push --include-untracked (all, with untracked)',
    'git.hint_stash_pop': 'git stash pop (conflict shows on the status line)',
    'git.hint_pull': 'git pull --ff-only (failure shows on the status line)',
    'git.hint_amend': 'git commit --amend -m (change the last commit message)',
    'git.hint_lease': 'only enables `git push --force-with-lease`; asks for confirmation with the literal command',
    'git.hint_commit': 'stage selected and commit (Ctrl+Enter)',
    'git.discard_prompt': 'discard {n} file(s)?\n\n{files}\n\ngit restore -- (tracked only; no undo)',

    'sys.reload_hint': 'Restart pi (reload extensions)',

    'composer.attach_hint': 'Attach a file as context (inserts its path into the text)',
    'composer.thinking_btn': 'thinking',

    'panel.subs_hint': 'Subagents of this session',
    'panel.plans_hint': 'plans/ specs in the session project',
    'panel.git_hint': 'Git repo status · commit, discard, stash, push',

    'debug.missions': 'Missions',
    'debug.health': 'Extension warnings',
    'debug.diag': 'Diagnostics',

    'update.available_have': 'Update available: {tag} (you have v{ver})',
    'update.latest_yes': 'update available',
    'update.latest_no': 'already up to date',

    'copy.done': 'answer copied ({n} characters)',
    'model.set_fail': 'set_model: failed',
    'compact.done': 'context compacted',
    'compact.fail': 'compaction failed',
    'export.done': 'exported: {x}',
    'turn.interrupted': 'turn interrupted',
    'health.more': '… +{n} warning(s)',
    'notify.head': 'Notifications',
    'notify.title': '{n} extension warning(s) across all sessions',
    'notify.empty': 'no warnings right now',
    'update.install': 'Download and install'
  },
};

export function t(key, vars) {
  const lang = getLang();
  const dict = STRINGS[lang] || {};
  const pt = STRINGS.pt || {};
  let tpl = key;
  if (key in dict) tpl = dict[key];
  else if (key in pt) tpl = pt[key];
  return fmt(tpl, vars);
}

/* Aplica o idioma aos estáticos do index.html (por id). Idempotente e tolerante
 * a ids ausentes (testes carregam o HTML parcial). Chamado no boot e ao trocar. */
export function applyStaticI18n() {
  const set = (id, v) => { try { const n = document.getElementById(id); if (n) n.textContent = v; } catch { /* sem DOM */ } };
  const ph = (id, v) => { try { const n = document.getElementById(id); if (n) n.placeholder = v; } catch { /* sem DOM */ } };
  const ti = (id, v) => { try { const n = document.getElementById(id); if (n) n.title = v; } catch { /* sem DOM */ } };
  ph('sesssearch', t('sidebar.search_ph'));
  ph('toolfilter', t('sidebar.tool_filter_ph'));
  ph('input', t('composer.placeholder'));
  ph('cmdkinput', t('composer.cmd_ph'));
  ph('catsearch', t('pkgs.catalog_ph'));
  ph('provsearch', t('prov.search_ph'));
  ph('mcpname', t('mcp.name_ph'));
  ph('mcptarget', t('mcp.target_ph'));
  ph('mcpargs', t('mcp.args_ph'));
  set('confirmok', t('common.execute'));
  set('confirmcancel', t('common.cancel'));
  ti('stopbtn', t('composer.stop'));
  set('themebtn', t('settings.theme'));
  set('pkgbtn', t('settings.packages'));
  set('debugbtn', t('settings.debug'));
  set('aboutbtn', t('settings.about'));
  set('checkupdate', t('settings.check_update'));
  set('updatebtn', t('update.install'));
  set('updExt', t('settings.update_ext'));
  set('updPi', t('settings.update_pi'));
}
