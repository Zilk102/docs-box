/**
 * file-store.js — хранилище базы в файле на диске или сетевой папке через
 * File System Access API (Chrome / Edge). Браузер даёт доступ только к файлу,
 * который пользователь сам выбрал; приложение ничего не запоминает между
 * сессиями.
 *
 * Работает с любым объектом-«дескриптором» с методами getFile() и
 * createWritable(), поэтому тестируется без браузера.
 */

import { SyncError } from './sync.js';
import { emptyDb, parseDb, serializeDb } from '../core/db.js';

const tokenOf = (file) => `${file.lastModified}:${file.size}`;

/**
 * Хранилище на файле, выбранном пользователем.
 */
export class FileStore {
  /**
   * @param {{name:string,getFile:Function,createWritable:Function}} handle FileSystemFileHandle
   */
  constructor(handle) {
    this.handle = handle;
    this.label = handle.name;
  }

  /**
   * Читает базу из файла. Пустой файл считается «базы ещё нет».
   * @param {string|null} knownToken версия, виденная ранее
   * @returns {Promise<{db:(object|null),token:string,unchanged?:boolean}>}
   */
  async read(knownToken = null) {
    const file = await this.handle.getFile();
    const token = tokenOf(file);
    if (knownToken && token === knownToken) return { unchanged: true, db: null, token };
    const text = await file.text();
    return { db: text.trim() ? parseDb(text) : null, token };
  }

  /**
   * Записывает базу, если файл не менялся после чтения.
   * Окно гонки между проверкой и записью сводится к миллисекундам; при
   * промахе следующая синхронизация сольёт обе версии (данные сохраняются,
   * т.к. каждый клиент хранит свою копию в памяти и дописывает недостающее).
   * @param {object} db база для записи
   * @param {string|null} token версия, на которой основано слияние
   * @returns {Promise<{ok:boolean,token?:string}>}
   */
  async write(db, token) {
    const current = tokenOf(await this.handle.getFile());
    if (token && current !== token) return { ok: false };
    try {
      const writable = await this.handle.createWritable();
      await writable.write(serializeDb(db));
      await writable.close();
    } catch {
      throw new SyncError('Не удалось записать файл: нет прав на запись или файл занят другой программой.');
    }
    return { ok: true, token: tokenOf(await this.handle.getFile()) };
  }
}

/**
 * Просит у пользователя файл базы (или место для нового) и права записи.
 * Должна вызываться из обработчика клика (требование браузера).
 * @param {'open'|'create'} mode открыть существующий или создать новый
 * @param {object} win объект window (подменяется в тестах)
 * @returns {Promise<FileStore>}
 */
export async function pickDatabaseFile(mode, win = window) {
  if (!win.showOpenFilePicker) throw new SyncError('Этот браузер не умеет работать с файлами на диске. Откройте в Chrome или Edge либо используйте сервер/импорт-экспорт.');
  const types = [{ description: 'База DocsBox', accept: { 'application/json': ['.json'] } }];
  const [handle] = mode === 'create'
    ? [await win.showSaveFilePicker({ suggestedName: 'docsbox-db.json', types })]
    : await win.showOpenFilePicker({ types });
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new SyncError('Нужно разрешение на запись в файл базы');
  const store = new FileStore(handle);
  if (mode === 'create') await store.write(emptyDb(), null);
  return store;
}

/**
 * Проверяет доступ на чтение и запись к ранее выбранному файлу.
 * @param {FileSystemFileHandle} handle дескриптор из прошлого сеанса
 * @param {boolean} ask запрашивать ли разрешение (только из клика пользователя)
 * @returns {Promise<boolean>} есть ли доступ
 */
export async function restorePermission(handle, ask) {
  const options = { mode: 'readwrite' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return ask && (await handle.requestPermission(options)) === 'granted';
}
