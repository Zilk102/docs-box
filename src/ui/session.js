/**
 * session.js — синхронизация с подключённым хранилищем: первая загрузка,
 * отправка правок, опрос изменений коллег, отключение.
 *
 * Хранилище приходит снаружи (любой объект с read/write), а перерисовку
 * модуль запрашивает через хуки, поэтому он не зависит ни от разметки,
 * ни от конкретного вида хранилища.
 */

import { activeDocuments, mergeDbs } from '../core/db.js';
import { pollOnce, syncOnce } from '../sync/sync.js';
import { toast } from './dom.js';
import { clearConnection } from './persist.js';
import { state } from './state.js';

const POLL_MS = 5000;
const hooks = { render() {}, renderSync() {}, renderConnect() {} };

/**
 * Передаёт модулю функции перерисовки.
 * @param {{render:Function,renderSync:Function,renderConnect:Function}} h хуки
 */
export function setHooks(h) {
  Object.assign(hooks, h);
}

/**
 * Показывает ошибку синхронизации; повторное одинаковое сообщение не дублируется.
 * @param {Error} error ошибка
 */
export function fail(error) {
  state.status = 'error';
  state.error = error.message || String(error);
  hooks.renderSync();
  if (state.error !== state.lastError) toast(state.error, 'error');
  state.lastError = state.error;
}

function markSynced(token) {
  Object.assign(state, { token, lastSync: Date.now(), status: 'ok', error: '', lastError: '' });
  hooks.renderSync();
}

const enqueue = (task) => {
  state.queue = state.queue.then(task, task);
  return state.queue;
};

/**
 * Отправляет локальные правки и забирает чужие. Запросы идут по очереди,
 * поэтому две записи из одной вкладки не пересекаются.
 * @returns {Promise<void>}
 */
export function pushNow() {
  if (!state.store) return Promise.resolve();
  return enqueue(async () => {
    state.status = 'syncing';
    hooks.renderSync();
    try {
      const result = await syncOnce(state.store, state.db);
      state.db = mergeDbs(state.db, result.db);
      state.unsaved = false;
      markSynced(result.token);
      hooks.render();
    } catch (e) {
      fail(e);
    }
  });
}

/** Проверяет, не изменили ли базу коллеги. Скрытая вкладка сервер не опрашивает. */
export function poll() {
  if (!state.store || document.hidden) return;
  enqueue(async () => {
    try {
      const r = await pollOnce(state.store, state.db, state.token);
      markSynced(r.token);
      if (!r.changed) return;
      state.db = mergeDbs(state.db, r.db);
      hooks.render();
      toast('Коллеги обновили базу', 'info');
    } catch (e) {
      fail(e);
    }
  });
}

/**
 * Принимает локальное изменение: перерисовывает экран и отправляет его в базу.
 * @param {object} db новая база
 */
export function commit(db) {
  state.db = db;
  state.unsaved = !state.store;
  hooks.render();
  pushNow();
}

/**
 * Подключает хранилище и запускает опрос. Если первая синхронизация не
 * удалась, подключение не устанавливается.
 * @param {{read:Function,write:Function,label:string}} store хранилище базы
 * @returns {Promise<boolean>} удалось ли подключиться
 */
export async function attach(store) {
  state.status = 'syncing';
  hooks.renderSync();
  try {
    const result = await syncOnce(store, state.db);
    state.db = mergeDbs(state.db, result.db);
    markSynced(result.token);
  } catch (e) {
    fail(e);
    return false;
  }
  state.store = store;
  state.unsaved = false;
  clearInterval(state.poller);
  state.poller = setInterval(poll, POLL_MS);
  hooks.renderConnect();
  hooks.render();
  return true;
}

/** Отключает базу. Загруженное остаётся на экране до закрытия вкладки. */
export function disconnect() {
  clearInterval(state.poller);
  Object.assign(state, { store: null, status: 'offline', token: null, unsaved: activeDocuments(state.db).length > 0 });
  clearConnection();
  history.replaceState(null, '', location.pathname);
  hooks.renderSync();
  hooks.renderConnect();
}
