/**
 * connect.js — разметка карточки «Общая база»: выбор способа подключения
 * (сервер по URL, файл на диске/в сетевой папке, работа без синхронизации)
 * и сводка подключённой базы.
 */

import { esc, icon } from './dom.js';

const TABS = [
  ['server', 'server', 'Сервер по URL'],
  ['file', 'disk', 'Файл на диске'],
  ['offline', 'download', 'Только импорт/экспорт'],
];

function tabsHtml(active) {
  return `<div class="tabs" role="tablist">${TABS.map(([id, ico, label]) => `<button role="tab" class="tab" data-act="tab" data-tab="${id}" aria-selected="${id === active}">${icon(ico, 15)}${label}</button>`).join('')}</div>`;
}

/**
 * Панель подключения к серверу: адрес файла базы, необязательный заголовок Authorization и пояснение про CORS.
 */
function serverPanel(s) {
  return `<div class="panel">
    <div class="fields">
      <label class="grow">Адрес файла базы<input data-bind="url" type="url" inputmode="url" placeholder="https://db.example.com/docsbox/db.json" value="${esc(s.url)}" spellcheck="false" autocomplete="off"></label>
      <label>Authorization <i>(если нужен)</i><input data-bind="auth" type="password" placeholder="Bearer …" value="${esc(s.auth)}" autocomplete="off"></label>
      <button class="btn primary" data-act="connect-remote">${icon('link', 16)}Подключиться</button>
    </div>
    <p class="hint">Страница читает и записывает файл напрямую с вашего сервера (GET/PUT с ETag). Токен живёт только в памяти вкладки. Нужен CORS для этого сайта — см. <a href="https://github.com/Zilk102/docs-box#сервер-для-общей-базы" target="_blank" rel="noopener">инструкцию</a>.</p>
  </div>`;
}

/**
 * Панель подключения к файлу на диске; без File System Access API (не Chrome/Edge) кнопки отключены с объяснением.
 */
function filePanel(canPick) {
  return `<div class="panel">
    <div class="fields">
      <button class="btn primary" data-act="connect-file" data-mode="open" ${canPick ? '' : 'disabled'}>${icon('disk', 16)}Открыть файл базы</button>
      <button class="btn" data-act="connect-file" data-mode="create" ${canPick ? '' : 'disabled'}>Создать новый файл</button>
    </div>
    <p class="hint">${canPick
    ? 'Подойдёт файл на сетевом диске или в синхронизируемой папке (SMB, OneDrive, Яндекс Диск): у всех, кто откроет тот же файл, база будет общей.'
    : 'Этот браузер не умеет работать с файлами на диске. Откройте страницу в Chrome или Edge либо используйте сервер.'}</p>
  </div>`;
}

function offlinePanel() {
  return `<div class="panel">
    <p class="hint wide">Работа без общей базы: всё живёт только в этой вкладке. Загрузите базу кнопкой «Импорт базы», поработайте и сохраните результат кнопкой «Экспорт базы» — при закрытии вкладки несохранённое пропадёт, страница ничего не запоминает.</p>
  </div>`;
}

/**
 * Разметка карточки подключения.
 * @param {{tab:string,url:string,auth:string,store:(object|null),status:string,canPickFile:boolean}} s состояние подключения
 * @returns {string}
 */
export function connectHtml(s) {
  if (s.store) {
    const share = s.store.url ? `<button class="btn" data-act="copy-link">${icon('copy', 15)}Копировать ссылку для коллег</button>` : '';
    return `<div class="card-head"><div><h2 id="h-connect">Общая база</h2>
      <p class="sub">${icon(s.store.url ? 'server' : 'disk', 14)} <b>${esc(s.store.label)}</b> — подключено. Загрузки видны всем, кто открыл эту же базу, изменения подтягиваются каждые 5 секунд.</p></div>
      <div class="btn-row">${share}<button class="btn" data-act="sync-now">${icon('sync', 15)}Синхронизировать</button><button class="btn ghost" data-act="disconnect">Отключиться</button></div></div>`;
  }
  const panel = s.tab === 'server' ? serverPanel(s) : s.tab === 'file' ? filePanel(s.canPickFile) : offlinePanel();
  return `<div class="card-head"><div><h2 id="h-connect">Общая база</h2>
    <p class="sub">Приложение не хранит данные. Укажите, где лежит файл базы, — все специалисты по закупкам будут работать с одним файлом.</p></div></div>
    ${tabsHtml(s.tab)}${panel}`;
}
