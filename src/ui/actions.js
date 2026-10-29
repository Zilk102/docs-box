/**
 * actions.js — реестр действий интерфейса. Кнопки в разметке помечены
 * data-act, а обработчик ищет действие в этой таблице: новая кнопка требует
 * одной записи здесь, а не правки общего обработчика.
 */

import { removeDocument } from '../core/db.js';
import { toast } from './dom.js';
import { connectFile, connectRemote, reopenSavedFile } from './connection.js';
import { exportDb, loadDemo } from './files.js';
import { renderConnect, render } from './screen.js';
import { commit, disconnect, pushNow } from './session.js';
import { analysis, authorName, nowIso, state } from './state.js';
import { hideViewer, showViewer } from './viewer.js';

const $ = (id) => document.getElementById(id);

function openSource(target) {
  const { doc: id, start, end } = target.dataset;
  const rec = state.db.documents.find((d) => d.id === id);
  if (!rec || rec.deleted) return toast('Документ удалён из базы', 'error');
  const info = analysis().docs.find((d) => d.id === id) || {};
  return showViewer($('viewer'), rec, { start: Number(start), end: Number(end) }, info);
}

async function copyShareLink() {
  const link = `${location.origin}${location.pathname}#db=${encodeURIComponent(state.store.url)}`;
  await navigator.clipboard.writeText(link);
  toast('Ссылка скопирована', 'ok');
}

function removeWithConfirm(target) {
  const rec = state.db.documents.find((d) => d.id === target.dataset.doc);
  if (rec && confirm(`Удалить «${rec.name}» из общей базы? Файл исчезнет у всех пользователей.`)) {
    commit(removeDocument(state.db, rec.id, { author: authorName(), now: nowIso() }));
  }
}

const setFilter = (t) => {
  state.filter = state.filter === t.dataset.filter ? 'all' : t.dataset.filter;
  render();
};

/** Действия, доступные по атрибуту data-act. */
export const ACTIONS = {
  pick: () => $('file-input').click(),
  import: () => $('db-input').click(),
  export: exportDb,
  demo: loadDemo,
  tab: (t) => { state.tab = t.dataset.tab; renderConnect(); },
  'connect-remote': connectRemote,
  'connect-file': (t) => connectFile(t.dataset.mode),
  'reopen-file': reopenSavedFile,
  disconnect,
  'sync-now': pushNow,
  'copy-link': copyShareLink,
  open: openSource,
  'close-viewer': () => hideViewer($('viewer')),
  remove: removeWithConfirm,
  filter: setFilter,
};
