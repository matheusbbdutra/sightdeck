<script>
  import { tick } from 'svelte';
  /* Pop de modelo + thinking (Fase 2). Sem imports do `main.js`: tudo entra
     pelo `host` (snapshot/apply/previewLevel/setLevel). `q`/`preview` são
     estado local; `snap` espelha o host e é atualizado por `sync` — chamado
     pelo `main.js` nos mesmos pontos que repintavam o DOM legado. */
  let { host } = $props();

  let q = $state('');
  // pi-lens-ignore: lint/correctness/noUnusedVariables — consumido no template ({preview || snap.levels.name})
  let preview = $state('');
  // svelte-ignore state_referenced_locally: snapshot inicial; refresh via sync().
  // pi-lens-ignore: lint/correctness/noUnusedVariables — consumido no template ({#each snap.list.groups})
  let snap = $state(host.snapshot(''));
  let inputEl = $state(null);

  // pi-lens-ignore: lint/correctness/noUnusedVariables — consumido no template ({tr(...)})
  function tr(key, vars) {
    return host.t(key, vars);
  }

  function refresh() {
    snap = host.snapshot(q);
  }

  /** Chamado pelo `main.js` (renderModelList/fillLevels). `undefined` = mantém o filtro. */
  export function sync(filter) {
    if (filter !== undefined) q = filter;
    refresh();
  }

  /** Chamado pelo `main.js` ao abrir o pop: limpa a busca e foca o campo. */
  export async function open() {
    sync('');
    await tick();
    if (inputEl) inputEl.focus();
  }
</script>

<input
  bind:this={inputEl}
  class="model-search"
  placeholder={tr('composer.model_search_ph')}
  value={q}
  oninput={(e) => {
    q = e.currentTarget.value;
    refresh();
  }}
  autocomplete="off"
/>
<div class="model-list">
  {#if snap.list.favs.length}
    <div class="model-group">{tr('model.favs')}</div>
    {#each snap.list.favs as f (f.key)}
      <div
        class="model-row"
        class:current={f.current}
        role="button"
        tabindex="0"
        onclick={() => host.apply(f.key)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            host.apply(f.key);
          }
        }}
      >
        <span class="model-name">{f.label}</span>
        <span class="model-ctx">{f.ctx}</span>
        <button
          class="fav on"
          title={tr('model.fav_toggle')}
          onclick={(e) => { e.stopPropagation(); host.toggleFav(f.key); }}
        >★</button>
      </div>
    {/each}
  {/if}
  {#each snap.list.groups as g (g.provider)}
    <div class="model-group">{g.provider.toUpperCase()}</div>
    {#each g.rows as r (r.key)}
      <div
        class="model-row"
        class:current={r.current}
        role="button"
        tabindex="0"
        onclick={() => host.apply(r.key)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            host.apply(r.key);
          }
        }}
      >
        <span class="model-name">{r.name}</span>
        <span class="model-ctx">{r.ctx}</span>
        <button
          class="fav"
          class:on={r.fav}
          title={tr('model.fav_toggle')}
          onclick={(e) => { e.stopPropagation(); host.toggleFav(r.key); }}
        >{r.fav ? '★' : '☆'}</button>
      </div>
    {/each}
  {/each}
  {#if snap.list.empty}
    <div class="model-empty">{tr('model.none')}</div>
  {/if}
</div>
{#if snap.levels.showSlider}
  <div class="think-foot">
    <div class="think-foot-row"><span>{tr('tools.thinking')}</span><span>{preview || snap.levels.name}</span></div>
    <input
      type="range"
      min="0"
      max={snap.levels.levels.length - 1}
      step="1"
      value={snap.levels.at}
      oninput={(e) => {
        preview = host.previewLevel(e.currentTarget.value);
      }}
      onchange={(e) => {
        preview = '';
        host.setLevel(e.currentTarget.value);
      }}
    />
  </div>
{/if}

<style>
  .fav {
    background: none;
    border: none;
    padding: 0 3px;
    cursor: pointer;
    color: var(--mute);
    font-size: 16px;
    line-height: 1;
    flex: none;
  }
  .fav:hover { color: var(--warn); }
  .fav.on { color: var(--warn); }
</style>
