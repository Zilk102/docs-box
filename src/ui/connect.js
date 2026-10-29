/**
 * connect.js — разметка карточки «Общая база»: вкладки способов подключения
 * и сводка подключённой базы.
 */

import { esc, icon } from './dom.js';

const TABS = [
  ['server', 'server', 'Сервер'],
  ['file', 'disk', 'Файл на диске'],
  ['offline', 'download', 'Без подключения'],
];

const tabsHtml = (active) => `<div class="tabs" role="tablist">${TABS.map(([id, ico, label]) => (
  `<button role="tab" class="tab" data-act="tab" data-tab="${id}" aria-selected="${id === active}">${icon(ico, 15)}${label}</button>`
)).join('')}</div>`;

const serverPanel = (s) => `<div class="panel">
  <div class="fields">
    <label class="grow">Адрес файла базы<input data-bind="url" type="url" inputmode="url" placeholder="https://example.com/db.json" value="${esc(s.url)}" spellcheck="false" autocomplete="off"></label>
    <label class="auth">Authorization<input data-bind="auth" type="password" placeholder="Bearer …" value="${esc(s.auth)}" autocomplete="off"></label>
    <button class="btn primary" data-act="connect-remote">${icon('link', 16)}Подключиться</button>
  </div>
  <p class="hint">Поле Authorization нужно, только если сервер требует токен. Настройка сервера описана в <a href="https://github.com/Zilk102/docs-box#сервер-для-общей-базы" target="_blank" rel="noopener">README</a>.</p>
</div>`;

/**
 * Панель подключения к файлу на диске: открыть, создать или переподключить файл из прошлого сеанса. Без поддержки браузера кнопки отключены.
 */
function filePanel(s) {
  const off = s.canPickFile ? '' : 'disabled';
  const again = s.pendingFile
    ? `<button class="btn primary" data-act="reopen-file">${icon('disk', 16)}Переподключить «${esc(s.pendingFile)}»</button>` : '';
  const note = s.canPickFile ? 'Подойдёт файл на сетевом диске или в синхронизируемой папке.' : 'Работа с файлами на диске доступна в Chrome и Edge.';
  return `<div class="panel"><div class="fields">${again}
    <button class="btn ${again ? '' : 'primary'}" data-act="connect-file" data-mode="open" ${off}>Открыть файл базы</button>
    <button class="btn" data-act="connect-file" data-mode="create" ${off}>Создать новый файл</button>
  </div><p class="hint">${note}</p></div>`;
}

const offlinePanel = () => `<div class="panel"><p class="hint wide">Данные остаются в этой вкладке. Загрузите базу кнопкой «Импорт», а в конце сохраните её кнопкой «Экспорт».</p></div>`;

function connectedHtml(s) {
  const share = s.store.url ? `<button class="btn" data-act="copy-link">${icon('copy', 15)}Копировать ссылку</button>` : '';
  return `<div class="card-head"><div><h2 id="h-connect">Общая база</h2>
    <p class="sub">${icon(s.store.url ? 'server' : 'disk', 14)} <b>${esc(s.store.label)}</b></p></div>
    <div class="btn-row">${share}<button class="btn" data-act="sync-now">${icon('sync', 15)}Обновить</button><button class="btn ghost" data-act="disconnect">Отключиться</button></div></div>`;
}

/**
 * Разметка карточки подключения.
 * @param {object} s состояние: tab, url, auth, store, pendingFile, canPickFile
 * @returns {string}
 */
export function connectHtml(s) {
  if (s.store) return connectedHtml(s);
  const panels = { server: serverPanel, file: filePanel, offline: offlinePanel };
  return `<div class="card-head"><h2 id="h-connect">Общая база</h2></div>${tabsHtml(s.tab)}${panels[s.tab](s)}`;
}
