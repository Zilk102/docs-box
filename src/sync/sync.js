/**
 * sync.js — протокол синхронизации с хранилищем базы (read-merge-write).
 *
 * Хранилище (store) — любой объект с методами read(knownToken) и
 * write(db, token). Токен — «версия» файла (ETag или время изменения).
 * Запись условная: если файл успели изменить, хранилище вернёт conflict, и
 * цикл повторится — прочитает свежую версию, заново сольёт и попробует снова.
 * Так два закупщика, сохраняющих одновременно, не затирают друг друга.
 */

import { dbEqual, mergeDbs } from '../core/db.js';

const MAX_ATTEMPTS = 6;

/**
 * Ошибка синхронизации с понятным пользователю текстом.
 */
export class SyncError extends Error {}

/**
 * Один цикл «прочитать → слить → записать, если есть что записывать».
 * Контракт: возвращает объединённую базу; wrote=true, если в хранилище ушли
 * изменения. Бросает SyncError, если после нескольких попыток запись
 * продолжает конфликтовать.
 * @param {{read:Function,write:Function}} store хранилище базы
 * @param {object} local локальная (в памяти) база
 * @returns {Promise<{db:object,wrote:boolean,token:(string|null)}>}
 */
export async function syncOnce(store, local) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remote = await store.read();
    const merged = remote.db ? mergeDbs(remote.db, local) : local;
    if (remote.db && dbEqual(merged, remote.db)) return { db: merged, wrote: false, token: remote.token };
    const result = await store.write(merged, remote.token);
    if (result.ok) return { db: merged, wrote: true, token: result.token };
  }
  throw new SyncError('Не удалось записать базу: файл постоянно меняется другими пользователями. Повторите попытку.');
}

/**
 * Шаг опроса: дешёвый условный запрос; если файл у других изменился —
 * полный цикл syncOnce (слияние и, при необходимости, дописывание своих
 * документов обратно, если файл на сервере успели пересоздать).
 * @param {{read:Function,write:Function}} store хранилище базы
 * @param {object} local локальная база
 * @param {string|null} knownToken версия, виденная при прошлой синхронизации
 * @returns {Promise<{db:object,changed:boolean,wrote:boolean,token:(string|null)}>} changed — локальная база пополнилась чужими данными
 */
export async function pollOnce(store, local, knownToken) {
  const peek = await store.read(knownToken);
  if (peek.unchanged) return { db: local, changed: false, wrote: false, token: knownToken };
  const result = await syncOnce(store, local);
  return { ...result, changed: !dbEqual(result.db, local) };
}
