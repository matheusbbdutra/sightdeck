import { mount } from 'svelte';
import PlansPane from './PlansPane.svelte';
import MissionsPane from './MissionsPane.svelte';
import GitPane from './GitPane.svelte';
import SubsPane from './SubsPane.svelte';
import FilesPane from './FilesPane.svelte';

/** Monta o painel Plano no container `#plans`.
 *  `host` injeta snapshot/open — o componente não importa `main.js`, então não
 *  há ciclo. Retorna null sem o container (o render legado continua valendo). */
export function mountPlansPane(host) {
  const target = document.getElementById('plans');
  if (!target) return null;
  return mount(PlansPane, { target, props: { host } });
}

/** Monta o painel Missões (Debug) no container `#missions` (mesmo contrato). */
export function mountMissionsPane(host) {
  const target = document.getElementById('missions');
  if (!target) return null;
  return mount(MissionsPane, { target, props: { host } });
}

/** Monta o painel Git no container `#git` (mesmo contrato). */
export function mountGitPane(host) {
  const target = document.getElementById('git');
  if (!target) return null;
  return mount(GitPane, { target, props: { host } });
}

/** Monta o painel Arquivos no container `#files` (mesmo contrato). */
export function mountFilesPane(host) {
  const target = document.getElementById('files');
  if (!target) return null;
  return mount(FilesPane, { target, props: { host } });
}

/** Monta o painel Subagents no container `#subs` (mesmo contrato). */
export function mountSubsPane(host) {
  const target = document.getElementById('subs');
  if (!target) return null;
  return mount(SubsPane, { target, props: { host } });
}
