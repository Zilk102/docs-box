/**
 * session.js — подключение к общей базе и синхронизация: первая загрузка,
 * отправка правок, опрос изменений коллег, отключение.
 *
 * Модуль не знает про разметку: после изменений он вызывает хуки
 * render/renderSync/renderConnect, которые передаёт app.js.
 */

import { activeDocuments, mergeDbs } from '../core/db.js';
import { pickDatabaseFile } from '../sync/file-store.js';
import { RemoteStore, validateRemoteUrl } from '../sync/remote-store.js';
import { pollOnce, syncOnce } from '../sync/sync.js';
import { toast } from './dom.js';
import { state } from './state.js';

const POLL_MS = 5000;
const hooks = { render() {}, renderSync() {}, renderConnect() {} };

/**
 * Передаёт модулю функции перерисовки интерфейса.
 * @param {{render:Function,renderSync:Function,renderConnect:Function}} h хуки
 */
export function setHooks(h) {
  Object.assign(hooks, h);
}

function fail(error) {
  state.status = 'error';
  state.error = error.message || String(error);
  hooks.renderSync();
  if (state.error !== state.lastError) toast(state.error, 'error');
  state.lastError = state.error;
}

function markSynced(token) {
  state.token = token;
  state.lastSync = Date.now();
  state.status = 'ok';
  state.error = '';
  state.lastError = '';
  hooks.renderSync();
}

/**
 * Принимает результат синхронизации: сливает его с локальной базой (чтобы не
 * потерять правки, сделанные во время запроса) и обновляет статус.
 */
function adopt(result) {
  state.db = mergeDbs(state.db, result.db);
  state.unsaved = false;
  markSynced(result.token);
}

const enqueue = (task) => {
  state.queue = state.queue.then(task, task);
  return state.queue;
};

/**
 * Ставит в очередь цикл «прочитать → слить → записать». Очередь исключает
 * параллельные записи из одной вкладки; без подключённой базы ничего не делает.
 * @returns {Promise<void>}
 */
export function pushNow() {
  if (!state.store) return Promise.resolve();
  return enqueue(async () => {
    state.status = 'syncing';
    hooks.renderSync();
    try {
      adopt(await syncOnce(state.store, state.db));
      hooks.render();
    } catch (e) {
      fail(e);
    }
  });
}

/**
 * Раз в несколько секунд проверяет, не изменили ли базу коллеги; чужие
 * изменения вливаются в локальную копию. Скрытая вкладка не опрашивает сервер.
 */
export function poll() {
  if (!state.store || document.hidden) return;
  enqueue(async () => {
    try {
      const r = await pollOnce(state.store, state.db, state.token);
      markSynced(r.token);
      if (r.changed) {
        state.db = mergeDbs(state.db, r.db);
        hooks.render();
        toast('База обновлена: появились изменения от коллег', 'info');
      }
    } catch (e) {
      fail(e);
    }
  });
}

/**
 * Применяет локальное изменение базы: перерисовывает интерфейс и отправляет
 * правку в общую базу (если она подключена).
 * @param {object} db новая база
 */
export function commit(db) {
  state.db = db;
  state.unsaved = !state.store;
  hooks.render();
  pushNow();
}

/**
 * Подключает хранилище: первая синхронизация (чтение и слияние), затем запуск
 * опроса. При ошибке подключение не устанавливается.
 * @param {{read:Function,write:Function,label:string}} store хранилище базы
 */
async function attach(store) {
  state.status = 'syncing';
  hooks.renderSync();
  try {
    adopt(await syncOnce(store, state.db));
  } catch (e) {
    fail(e);
    return false;
  }
  state.store = store;
  clearInterval(state.poller);
  state.poller = setInterval(poll, POLL_MS);
  hooks.renderConnect();
  hooks.render();
  toast(`Подключено: ${store.label}`, 'ok');
  return true;
}

/** Подключается к базе на сервере по адресу из поля ввода и запоминает его в ссылке (#db=…). */
export async function connectRemote() {
  try {
    const url = state.url.trim();
    validateRemoteUrl(url, location.protocol);
    if (await attach(new RemoteStore({ url, authorization: state.auth.trim() }))) {
      history.replaceState(null, '', `#db=${encodeURIComponent(url)}`);
    }
  } catch (e) {
    fail(e);
  }
}

/**
 * Подключается к файлу базы на диске или в сетевой папке.
 * @param {'open'|'create'} mode открыть существующий или создать новый
 */
export async function connectFile(mode) {
  try {
    await attach(await pickDatabaseFile(mode));
  } catch (e) {
    if (e.name !== 'AbortError') fail(e);
  }
}

/** Отключает общую базу; данные остаются в памяти вкладки, поэтому до экспорта включается предупреждение о закрытии. */
export function disconnect() {
  clearInterval(state.poller);
  state.store = null;
  state.status = 'offline';
  state.token = null;
  state.unsaved = activeDocuments(state.db).length > 0;
  history.replaceState(null, '', location.pathname);
  hooks.renderSync();
  hooks.renderConnect();
}
