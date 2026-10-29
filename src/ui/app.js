/**
 * app.js — точка входа: подписывает страницу на события и запускает
 * приложение. Отрисовка — в screen.js, действия — в actions.js, загрузка
 * файлов — в files.js, подключение — в connection.js.
 */

import { setSetting } from '../core/db.js';
import { ACTIONS } from './actions.js';
import { restoreConnection } from './connection.js';
import { icon } from './dom.js';
import { addFiles, importDb } from './files.js';
import { render, renderConnect, renderSync } from './screen.js';
import { commit, poll, setHooks } from './session.js';
import { nowIso, state } from './state.js';
import { hideViewer } from './viewer.js';

const $ = (id) => document.getElementById(id);

/** Поля, значение которых сразу попадает в состояние и перерисовывает экран. */
const RENDERED_INPUTS = {
  'q-field': ['qField', 'value'],
  'q-contract': ['qContract', 'value'],
  'q-before': ['qBefore', 'value'],
  search: ['query', 'value'],
  'show-quotes': ['quotes', 'checked'],
};

/**
 * Подключает поля, значение которых попадает в состояние и перерисовывает экран: поиск, переключатель цитат, выбор договора и даты.
 */
function bindInputs() {
  for (const [id, [key, prop]] of Object.entries(RENDERED_INPUTS)) {
    $(id).addEventListener(id === 'search' ? 'input' : 'change', (e) => { state[key] = e.target[prop]; render(); });
  }
  document.addEventListener('input', (e) => {
    if (e.target.dataset.bind) state[e.target.dataset.bind] = e.target.value;
  });
  $('user-name').addEventListener('input', (e) => { state.name = e.target.value; });
  $('check-date').addEventListener('change', (e) => {
    if (e.target.value) commit(setSetting(state.db, 'checkDate', e.target.value, nowIso()));
  });
}

/**
 * Подключает выбор файлов кнопкой и перетаскивание на страницу; сбрасывает значение поля, чтобы тот же файл можно было выбрать повторно.
 */
function bindFileInputs() {
  $('file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('db-input').addEventListener('change', (e) => {
    if (e.target.files[0]) importDb(e.target.files[0]);
    e.target.value = '';
  });
  const drop = $('drop');
  const over = (on) => (e) => { e.preventDefault(); drop.classList.toggle('over', on); };
  window.addEventListener('dragover', over(true));
  window.addEventListener('dragleave', over(false));
  window.addEventListener('drop', (e) => {
    over(false)(e);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
}

/**
 * Подключает общие события: клики по data-act, Esc для закрытия документа, обновление при возврате на вкладку и предупреждение о несохранённых данных.
 */
function bindGlobal() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-act]');
    if (target && ACTIONS[target.dataset.act]) ACTIONS[target.dataset.act](target);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideViewer($('viewer')); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.addEventListener('beforeunload', (e) => {
    if (state.unsaved) e.preventDefault();
  });
}

/** Запуск. Ссылка с #db=адрес подключает базу, #u=имя подставляет имя пользователя. */
function boot() {
  setHooks({ render, renderSync, renderConnect });
  $('logo').innerHTML = icon('logo', 22);
  $('drop-ico').innerHTML = icon('upload', 26);
  const params = new URLSearchParams(location.hash.slice(1));
  state.name = params.get('u') || '';
  $('user-name').value = state.name;
  bindInputs();
  bindFileInputs();
  bindGlobal();
  renderSync();
  renderConnect();
  render();
  restoreConnection(params).then(renderConnect);
}

boot();
