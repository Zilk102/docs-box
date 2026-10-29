/**
 * connection.js — выбор способа подключения: сервер по адресу, файл на диске
 * и восстановление подключения после перезагрузки страницы.
 */

import { FileStore, pickDatabaseFile, restorePermission } from '../sync/file-store.js';
import { RemoteStore, validateRemoteUrl } from '../sync/remote-store.js';
import { toast } from './dom.js';
import { loadAuth, loadConnection, loadHandle, saveAuth, saveConnection, saveHandle } from './persist.js';
import { attach, fail } from './session.js';
import { state } from './state.js';

async function connect(store, remember) {
  if (!(await attach(store))) return false;
  remember();
  toast(`Подключено: ${store.label}`, 'ok');
  return true;
}

/** Подключается к серверу по адресу из поля ввода и запоминает адрес для следующих запусков. */
export async function connectRemote() {
  try {
    const url = state.url.trim();
    validateRemoteUrl(url, location.protocol);
    const store = new RemoteStore({ url, authorization: state.auth.trim() });
    await connect(store, () => {
      saveConnection({ type: 'remote', url });
      saveAuth(state.auth.trim());
      history.replaceState(null, '', `#db=${encodeURIComponent(url)}`);
    });
  } catch (e) {
    fail(e);
  }
}

/**
 * Подключает файл на диске или в сетевой папке.
 * @param {'open'|'create'} mode открыть существующий или создать новый
 */
export async function connectFile(mode) {
  try {
    const store = await pickDatabaseFile(mode);
    await connect(store, () => {
      saveConnection({ type: 'file', name: store.label });
      saveHandle(store.handle);
    });
  } catch (e) {
    if (e.name !== 'AbortError') fail(e);
  }
}

/**
 * Возвращает подключение, которое было до перезагрузки. Ссылка с #db=
 * приоритетнее запомненного. Файл без выданного заново разрешения ждёт клика
 * по кнопке «Переподключить» (браузер не даёт запросить доступ без жеста).
 * @param {URLSearchParams} params параметры ссылки
 */
export async function restoreConnection(params) {
  const saved = loadConnection();
  const url = params.get('db') || (saved && saved.type === 'remote' ? saved.url : '');
  if (url) {
    Object.assign(state, { tab: 'server', url, auth: loadAuth() });
    await connectRemote();
  } else if (saved && saved.type === 'file') {
    await restoreFile(saved);
  }
}

async function restoreFile(saved) {
  state.tab = 'file';
  state.pendingFile = saved.name;
  const handle = await loadHandle();
  if (handle && (await restorePermission(handle, false))) await reconnectFile(handle);
}

/** Повторно открывает запомненный файл базы; вызывается по клику пользователя. */
export async function reopenSavedFile() {
  const handle = await loadHandle();
  if (!handle) return connectFile('open');
  if (!(await restorePermission(handle, true))) return fail(new Error('Нет разрешения на доступ к файлу базы'));
  return reconnectFile(handle);
}

async function reconnectFile(handle) {
  const store = new FileStore(handle);
  await connect(store, () => { state.pendingFile = ''; });
}
