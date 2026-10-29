/**
 * persist.js — что браузер помнит между перезагрузками страницы.
 *
 * Только способ подключения: адрес сервера или дескриптор выбранного файла.
 * Документы, результаты и токены в постоянное хранилище не попадают;
 * заголовок Authorization живёт в sessionStorage и исчезает с закрытием вкладки.
 * Любая ошибка хранилища (приватный режим, запрет) не мешает работе.
 */

const KEY = 'docsbox.connection';
const AUTH_KEY = 'docsbox.auth';
const DB_NAME = 'docsbox';
const HANDLE_STORE = 'handles';

function safely(action, fallback = null) {
  try {
    return action();
  } catch {
    return fallback;
  }
}

/**
 * Запоминает способ подключения.
 * @param {{type:'remote',url:string}|{type:'file',name:string}} connection описание подключения
 */
export function saveConnection(connection) {
  safely(() => localStorage.setItem(KEY, JSON.stringify(connection)));
}

/**
 * Читает запомненное подключение.
 * @returns {{type:string,url?:string,name?:string}|null}
 */
export function loadConnection() {
  return safely(() => JSON.parse(localStorage.getItem(KEY)));
}

/** Забывает подключение и связанные с ним значения. */
export function clearConnection() {
  safely(() => {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(AUTH_KEY);
  });
  openHandles().then((db) => db && db.transaction(HANDLE_STORE, 'readwrite').objectStore(HANDLE_STORE).clear());
}

/**
 * Хранит заголовок Authorization до закрытия вкладки.
 * @param {string} value значение заголовка
 */
export function saveAuth(value) {
  safely(() => sessionStorage.setItem(AUTH_KEY, value));
}

/**
 * Возвращает Authorization, сохранённый в этой вкладке.
 * @returns {string}
 */
export function loadAuth() {
  return safely(() => sessionStorage.getItem(AUTH_KEY), '') || '';
}

/**
 * Открывает IndexedDB для дескрипторов файлов; при недоступности хранилища возвращает null.
 */
function openHandles() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    return undefined;
  });
}

/**
 * Сохраняет дескриптор файла базы (структурно клонируется в IndexedDB).
 * @param {FileSystemFileHandle} handle дескриптор выбранного файла
 */
export async function saveHandle(handle) {
  const db = await openHandles();
  if (db) db.transaction(HANDLE_STORE, 'readwrite').objectStore(HANDLE_STORE).put(handle, 'db');
}

/**
 * Возвращает сохранённый дескриптор файла базы.
 * @returns {Promise<FileSystemFileHandle|null>}
 */
export async function loadHandle() {
  const db = await openHandles();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(HANDLE_STORE).objectStore(HANDLE_STORE).get('db');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}
