/**
 * remote-store.js — хранилище базы на удалённом сервере по HTTP.
 *
 * Требования к серверу минимальны: GET и PUT одного URL, заголовки ETag /
 * If-Match / If-None-Match и CORS для адреса GitHub Pages. Подходят WebDAV
 * (Nextcloud, nginx dav), S3-совместимые хранилища с подписанными URL и
 * референсный сервер из каталога server/.
 */

import { SyncError } from './sync.js';
import { parseDb, serializeDb } from '../core/db.js';

/**
 * Проверяет адрес базы до сетевого запроса и объясняет типичные ошибки.
 * @param {string} url адрес файла базы
 * @param {string} pageProtocol протокол страницы (https: на GitHub Pages)
 * @returns {URL} разобранный адрес
 */
export function validateRemoteUrl(url, pageProtocol = 'https:') {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new SyncError('Некорректный адрес: ожидается полный URL вида https://сервер/db.json');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new SyncError('Поддерживаются только адреса http(s)');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (pageProtocol === 'https:' && parsed.protocol === 'http:' && !local) {
    throw new SyncError('Страница открыта по HTTPS, поэтому браузер не разрешит http-сервер. Используйте https:// (исключение — localhost).');
  }
  return parsed;
}

/**
 * Хранилище на HTTP-сервере.
 */
export class RemoteStore {
  /**
   * @param {{url:string,authorization?:string,fetchImpl?:Function}} opts адрес файла базы,
   *   необязательное значение заголовка Authorization (только в памяти) и подмена fetch для тестов
   */
  constructor({ url, authorization = '', fetchImpl = (...a) => fetch(...a) }) {
    this.url = url;
    this.authorization = authorization;
    this.fetch = fetchImpl;
    this.label = url;
  }

  /**
   * Добавляет заголовок Authorization, если он задан; токен хранится только в памяти.
   */
  headers(extra = {}) {
    return this.authorization ? { Authorization: this.authorization, ...extra } : extra;
  }

  /**
   * Выполняет HTTP-запрос и превращает сетевой сбой (часто — CORS или недоступный сервер) в понятное SyncError.
   */
  async request(method, options) {
    try {
      return await this.fetch(this.url, { method, cache: 'no-store', ...options });
    } catch {
      throw new SyncError('Сервер недоступен. Проверьте адрес, сеть и разрешение CORS для этого сайта (см. README → «Сервер для общей базы»).');
    }
  }

  /**
   * Читает базу. При известном токене и неизменном файле возвращает {unchanged:true}.
   * @param {string|null} knownToken ETag, виденный ранее
   * @returns {Promise<{db:(object|null),token:(string|null),unchanged?:boolean}>} db=null, если файла ещё нет (404)
   */
  async read(knownToken = null) {
    const headers = this.headers(knownToken ? { 'If-None-Match': knownToken } : {});
    const res = await this.request('GET', { headers });
    if (res.status === 304) return { unchanged: true, db: null, token: knownToken };
    if (res.status === 404) return { db: null, token: null };
    if (res.status === 401 || res.status === 403) throw new SyncError('Сервер отказал в доступе (401/403): проверьте заголовок Authorization.');
    if (!res.ok) throw new SyncError(`Сервер ответил ${res.status} на чтение базы`);
    const text = await res.text();
    return { db: text.trim() ? parseDb(text) : null, token: res.headers.get('ETag') || res.headers.get('Last-Modified') };
  }

  /**
   * Условно записывает базу: только если файл не менялся с момента чтения.
   * @param {object} db база для записи
   * @param {string|null} token версия, на которой основано слияние (null — файла не было)
   * @returns {Promise<{ok:boolean,token?:(string|null)}>} ok=false при конфликте версий
   */
  async write(db, token) {
    const condition = token && token.startsWith('"') ? { 'If-Match': token } : token ? {} : { 'If-None-Match': '*' };
    const headers = this.headers({ 'Content-Type': 'application/json', ...condition });
    const res = await this.request('PUT', { headers, body: serializeDb(db) });
    if (res.status === 412 || res.status === 409) return { ok: false };
    if (res.status === 401 || res.status === 403) throw new SyncError('Нет права записи (401/403): проверьте заголовок Authorization.');
    if (!res.ok) throw new SyncError(`Сервер ответил ${res.status} на запись базы`);
    return { ok: true, token: res.headers.get('ETag') };
  }
}
