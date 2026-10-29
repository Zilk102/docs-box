/**
 * screen.js — перерисовка экрана по текущему состоянию: индикатор
 * синхронизации, карточка подключения, таблица, вопросы, список файлов.
 */

import { answerBefore, answerField, questionFields } from '../core/ask.js';
import { activeDocuments } from '../core/db.js';
import { fmtDate } from '../core/text.js';
import { connectHtml } from './connect.js';
import { answerHtml, documentsList, statsHtml } from './lists.js';
import { analysis, state } from './state.js';
import { contractsTable } from './table.js';

const $ = (id) => document.getElementById(id);

const SYNC_VIEW = {
  offline: ['muted', () => 'Не подключено'],
  syncing: ['info', () => 'Синхронизация…'],
  ok: ['ok', () => `Синхронизировано ${new Date(state.lastSync).toLocaleTimeString('ru-RU')}`],
  error: ['danger', () => 'Ошибка синхронизации'],
};

/** Обновляет индикатор синхронизации в шапке. */
export function renderSync() {
  const [kind, text] = SYNC_VIEW[state.status];
  const pill = $('sync-pill');
  pill.className = `pill ${kind}`;
  pill.textContent = text();
  pill.title = state.error;
}

/** Перерисовывает карточку подключения. */
export function renderConnect() {
  $('connect').innerHTML = connectHtml({ ...state, canPickFile: 'showOpenFilePicker' in window });
}

function firstOfNextMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/**
 * Обновляет список договоров в вопросе и сохраняет выбор, если договор остался в базе.
 */
function renderContractSelect(a) {
  const select = $('q-contract');
  const options = a.contracts.map((c) => `<option value="${c.docId}">${c.number || c.fileName}</option>`).join('');
  if (select.dataset.sig !== options) {
    select.innerHTML = options;
    select.dataset.sig = options;
  }
  if (!a.contracts.some((c) => c.docId === state.qContract)) state.qContract = a.contracts.length ? a.contracts[0].docId : '';
  select.value = state.qContract;
}

/** Перерисовывает блок вопросов, сохраняя выбор пользователя. */
function renderQuestions(a) {
  const field = $('q-field');
  if (!field.options.length) field.innerHTML = questionFields().map((f) => `<option value="${f.key}">${f.label}</option>`).join('');
  field.value = state.qField;
  renderContractSelect(a);
  $('q-answer').innerHTML = answerHtml(answerField(a, state.qContract, state.qField));
  state.qBefore = state.qBefore || firstOfNextMonth(a.checkDate);
  $('q-before').value = state.qBefore;
  $('q-before-answer').innerHTML = answerHtml(answerBefore(a, state.qBefore));
}

function renderControls(a) {
  $('check-date').value = a.checkDate;
  $('stats').innerHTML = statsHtml(a, state.filter);
  $('search').value = state.query;
  $('show-quotes').checked = state.quotes;
  $('result').classList.toggle('no-quotes', !state.quotes);
}

/** Перерисовывает страницу по текущей базе. Пустая база показывает только блоки подключения и загрузки. */
export function render() {
  const a = analysis();
  const docs = activeDocuments(state.db);
  for (const id of ['result', 'qa', 'docs']) $(id).hidden = docs.length === 0;
  $('drop').classList.toggle('compact', docs.length > 0);
  $('demo-btn').hidden = docs.length > 0;
  if (!docs.length) return;
  renderControls(a);
  $('contracts').innerHTML = contractsTable(a, fmtDate(a.checkDate), state);
  renderQuestions(a);
  $('doclist').innerHTML = documentsList(a.docs, new Map(docs.map((d) => [d.id, d])));
  const attention = a.docs.filter((d) => d.level === 'review').length;
  $('docs-sub').textContent = attention ? `Файлов: ${docs.length}, требуют внимания: ${attention}` : `Файлов: ${docs.length}`;
}
