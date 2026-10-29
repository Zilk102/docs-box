/**
 * app.js — точка входа интерфейса: отрисовка по текущей базе, обработка
 * действий пользователя (загрузка файлов, импорт/экспорт, вопросы) и запуск.
 * Подключение к общей базе и синхронизация — в session.js, состояние — в state.js.
 */

import { answerBefore, answerField, questionFields } from '../core/ask.js';
import { activeDocuments, addDocuments, mergeDbs, parseDb, removeDocument, serializeDb, setSetting } from '../core/db.js';
import { fmtDate } from '../core/text.js';
import { connectHtml } from './connect.js';
import { icon, readFileText, toast } from './dom.js';
import { answerHtml, contractsTable, documentsList } from './render.js';
import { commit, connectFile, connectRemote, disconnect, poll, pushNow, setHooks } from './session.js';
import { analysis, authorName, nowIso, state, todayIso } from './state.js';
import { hideViewer, showViewer } from './viewer.js';

const $ = (id) => document.getElementById(id);

function defaultBefore(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/** Обновляет индикатор синхронизации в шапке (офлайн, идёт, успех, ошибка). */
function renderSync() {
  const pill = $('sync-pill');
  const time = state.lastSync ? new Date(state.lastSync).toLocaleTimeString('ru-RU') : '';
  const map = {
    offline: ['muted', 'Без синхронизации'],
    syncing: ['info', 'Синхронизация…'],
    ok: ['ok', `Синхронизировано ${time}`],
    error: ['danger', 'Ошибка синхронизации'],
  };
  const [kind, text] = map[state.status];
  pill.className = `pill ${kind}`;
  pill.textContent = text;
  pill.title = state.error || '';
}

function renderConnect() {
  $('connect').innerHTML = connectHtml({ ...state, canPickFile: 'showOpenFilePicker' in window });
}

/** Перерисовывает блок вопросов: сохраняет выбор пользователя и пересчитывает оба ответа. */
function renderQA(a) {
  const fieldSel = $('q-field');
  if (!fieldSel.options.length) {
    fieldSel.innerHTML = questionFields().map((f) => `<option value="${f.key}">${f.label}</option>`).join('');
  }
  fieldSel.value = state.qField;
  const contractSel = $('q-contract');
  const options = a.contracts.map((c) => `<option value="${c.docId}">${c.number || c.fileName}</option>`).join('');
  if (contractSel.dataset.sig !== options) {
    contractSel.innerHTML = options;
    contractSel.dataset.sig = options;
  }
  if (!a.contracts.some((c) => c.docId === state.qContract)) state.qContract = a.contracts[0] ? a.contracts[0].docId : '';
  contractSel.value = state.qContract;
  $('q-answer').innerHTML = answerHtml(answerField(a, state.qContract, state.qField));
  if (!state.qBefore) state.qBefore = defaultBefore(a.checkDate);
  $('q-before').value = state.qBefore;
  $('q-before-answer').innerHTML = answerHtml(answerBefore(a, state.qBefore));
}

/** Перерисовывает таблицу, вопросы и список документов по текущей базе; пустую базу показывает как стартовый экран. */
function render() {
  const a = analysis();
  const docs = activeDocuments(state.db);
  const has = docs.length > 0;
  for (const id of ['result', 'qa', 'docs']) $(id).hidden = !has;
  $('drop').classList.toggle('compact', has);
  $('demo-btn').hidden = has;
  if (!has) return;
  $('check-date').value = a.checkDate;
  $('contracts').innerHTML = contractsTable(a, fmtDate(a.checkDate));
  renderQA(a);
  $('doclist').innerHTML = documentsList(a.docs, new Map(docs.map((d) => [d.id, d])));
  const review = a.docs.filter((d) => d.level === 'review').length;
  $('docs-sub').textContent = `${docs.length} файл(ов)${review ? `, требуют внимания: ${review}` : ''}`;
}

/** Читает выбранные TXT-файлы, добавляет их в базу и сообщает итог. Другие форматы пропускаются с пояснением. */
async function addFiles(fileList) {
  const files = [...fileList];
  const texts = files.filter((f) => /\.txt$/i.test(f.name) || f.type === 'text/plain');
  const skipped = files.length - texts.length;
  if (skipped) toast(`Пропущено файлов не в формате TXT: ${skipped} (PDF/DOCX/OCR не поддерживаются)`, 'error');
  if (!texts.length) return;
  const loaded = await Promise.all(texts.map(async (f) => ({ name: f.name, text: await readFileText(f) })));
  const { db, added, replaced } = await addDocuments(state.db, loaded, { author: authorName(), now: nowIso() });
  commit(db);
  toast(added ? `Добавлено документов: ${added}${replaced ? `, заменено версий: ${replaced}` : ''}` : 'Эти файлы уже есть в базе', added ? 'ok' : 'info');
}

/** Вливает файл базы в текущую (слияние, а не замена) и сообщает результат; чужой JSON отклоняется. */
async function importDb(file) {
  try {
    const imported = parseDb(await readFileText(file));
    const before = activeDocuments(state.db).length;
    commit(mergeDbs(state.db, imported));
    toast(`База импортирована, документов в ней: ${activeDocuments(state.db).length} (было ${before})`, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function exportDb() {
  const blob = new Blob([serializeDb(state.db)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `docsbox-db-${todayIso()}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
  state.unsaved = false;
}

async function loadDemo() {
  try {
    const res = await fetch('examples/demo-db.json');
    commit(mergeDbs(state.db, parseDb(await res.text())));
  } catch {
    toast('Не удалось загрузить демо-набор', 'error');
  }
}

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
  toast('Ссылка скопирована: коллеги подключатся к той же базе', 'ok');
}

function removeDocumentWithConfirm(target) {
  const rec = state.db.documents.find((d) => d.id === target.dataset.doc);
  if (rec && confirm(`Удалить «${rec.name}» из общей базы? Это увидят все пользователи.`)) {
    commit(removeDocument(state.db, rec.id, { author: authorName(), now: nowIso() }));
  }
}

const ACTIONS = {
  pick: () => $('file-input').click(),
  import: () => $('db-input').click(),
  export: exportDb,
  demo: loadDemo,
  tab: (t) => { state.tab = t.dataset.tab; renderConnect(); },
  'connect-remote': connectRemote,
  'connect-file': (t) => connectFile(t.dataset.mode),
  disconnect,
  'sync-now': pushNow,
  'copy-link': copyShareLink,
  open: openSource,
  'close-viewer': () => hideViewer($('viewer')),
  remove: removeDocumentWithConfirm,
};

const SELECT_BINDINGS = { 'q-field': 'qField', 'q-contract': 'qContract', 'q-before': 'qBefore' };

/** Навешивает обработчики кликов, ввода, выбора файлов и перетаскивания. */
function bindEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (t && ACTIONS[t.dataset.act]) ACTIONS[t.dataset.act](t);
  });
  document.addEventListener('input', (e) => {
    if (e.target.dataset.bind) state[e.target.dataset.bind] = e.target.value;
  });
  for (const [id, key] of Object.entries(SELECT_BINDINGS)) $(id).addEventListener('change', (e) => { state[key] = e.target.value; render(); });
  $('user-name').addEventListener('input', (e) => { state.name = e.target.value; });
  $('file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('db-input').addEventListener('change', (e) => { if (e.target.files[0]) importDb(e.target.files[0]); e.target.value = ''; });
  $('check-date').addEventListener('change', (e) => { if (e.target.value) commit(setSetting(state.db, 'checkDate', e.target.value, nowIso())); });
  bindDrop();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.addEventListener('beforeunload', (e) => {
    if (state.unsaved) { e.preventDefault(); e.returnValue = ''; }
  });
}

function bindDrop() {
  const drop = $('drop');
  for (const ev of ['dragenter', 'dragover']) window.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) window.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || !e.relatedTarget) drop.classList.remove('over'); });
  window.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
}

/** Запуск: читает параметры ссылки (#db=адрес — автоподключение, #demo — демо-набор, #u=имя), рисует стартовый экран. */
function boot() {
  setHooks({ render, renderSync, renderConnect });
  $('logo').innerHTML = icon('logo', 22);
  $('drop-ico').innerHTML = icon('upload', 26);
  const params = new URLSearchParams(location.hash.slice(1));
  state.name = params.get('u') || '';
  $('user-name').value = state.name;
  bindEvents();
  renderSync();
  renderConnect();
  render();
  if (params.get('db')) {
    state.url = params.get('db');
    state.tab = 'server';
    renderConnect();
    connectRemote();
  } else if (params.has('demo')) {
    loadDemo();
  }
}

boot();
