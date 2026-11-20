<script>
  /* Painel "Arquivos da pasta" (read-only). Sem imports do `main.js`: o `host`
     injeta snapshot e abertura; a árvore vem de `filetree.js` (puro/testável).
     As classes (.ft-row, .fileview…) são do `styles.css` global. */
  import { buildTree, visibleRows } from '../filetree.js';

  let { host } = $props();

  // svelte-ignore state_referenced_locally: snapshot inicial; refresh via sync().
  // pi-lens-ignore: lint/correctness/noUnusedVariables — consumido no template
  let snap = $state(host.snapshot());
  let q = $state('');
  let open = $state([]);

  let tree = $derived(buildTree(snap.files));
  let rows = $derived(visibleRows(tree, open, q));

  /** Chamado pelo `main.js` depois de recarregar a lista. */
  export function sync() {
    snap = host.snapshot();
  }

  function toggle(path) {
    open = open.includes(path) ? open.filter((p) => p !== path) : open.concat(path);
  }

  function act(row) {
    if (row.dir) toggle(row.path);
    else host.open(row.path);
  }

  function keyAct(e, fn) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  }
</script>

{#if snap.error}
  <div class="empty">{snap.error}</div>
{:else if !snap.files.length}
  <div class="empty">{snap.empty}</div>
{:else}
  <div class="ft-filter">
    <input
      class="mfield"
      placeholder={snap.filterPh}
      value={q}
      oninput={(e) => (q = e.currentTarget.value)}
      aria-label={snap.filterPh}
    />
  </div>
  {#each rows as r (r.path)}
    <div
      class={'ft-row' + (r.dir ? ' dir' : '')}
      style="padding-left:{10 + r.depth * 12}px"
      role="button"
      tabindex="0"
      title={r.path}
      onclick={() => act(r)}
      onkeydown={(e) => keyAct(e, () => act(r))}
    >
      <span class="ft-caret">{r.dir ? (open.includes(r.path) ? '▾' : '▸') : ''}</span>
      <span class="ft-name">{r.name}</span>
    </div>
  {:else}
    <div class="empty">{snap.empty}</div>
  {/each}
{/if}
