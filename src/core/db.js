/**
 * db.js — формат «базы» и её слияние.
 *
 * Приложение само ничего не хранит: база — это один JSON-файл с исходными
 * текстами документов. Файл лежит там, где его положила команда (сервер, сетевой
 * диск), а приложение только читает и записывает его.
 *
 * Чтобы несколько человек работали одновременно, база устроена как набор
 * записей с метками времени: слияние — объединение по id, при совпадении
 * побеждает более свежая запись, удаление — «надгробие» (deleted). Слияние
 * коммутативно, ассоциативно и идемпотентно, поэтому порядок синхронизаций
 * не важен и никто не теряет чужие загрузки.
 */

import { normalizeText } from './text.js';

export const DB_FORMAT = 'docsbox-db';
export const DB_VERSION = 1;

/**
 * Создаёт пустую базу.
 * @param {string} now ISO-время создания
 * @returns {object} пустая база
 */
export function emptyDb(now = new Date().toISOString()) {
  return { format: DB_FORMAT, version: DB_VERSION, updatedAt: now, settings: {}, documents: [] };
}

/**
 * Проверяет и нормализует произвольный JSON как базу.
 * Контракт: бросает Error с понятным текстом, если это не база DocsBox, —
 * чужой файл не должен затереть данные.
 * @param {unknown} obj результат JSON.parse
 * @returns {object} база с гарантированными полями
 */
export function normalizeDb(obj) {
  if (!obj || obj.format !== DB_FORMAT) throw new Error('Это не файл базы DocsBox (нет поля format)');
  if (obj.version > DB_VERSION) throw new Error(`Версия базы ${obj.version} новее поддерживаемой ${DB_VERSION}`);
  const documents = Array.isArray(obj.documents) ? obj.documents : [];
  if (!documents.every(isDocumentRecord)) throw new Error('Повреждена запись документа в базе');
  return { format: DB_FORMAT, version: DB_VERSION, updatedAt: obj.updatedAt || '', settings: obj.settings || {}, documents };
}

const isDocumentRecord = (d) => ['id', 'name', 'updatedAt'].every((k) => typeof d[k] === 'string');

function newer(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (Boolean(a.deleted) !== Boolean(b.deleted)) return a.deleted ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function mergeSettings(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? newer(out[k], v) : v;
  return out;
}

/**
 * Сливает две базы без потерь.
 * @param {object} a база
 * @param {object} b база
 * @returns {object} новая база; входные не изменяются
 */
export function mergeDbs(a, b) {
  const byId = new Map(a.documents.map((d) => [d.id, d]));
  for (const d of b.documents) byId.set(d.id, byId.has(d.id) ? newer(byId.get(d.id), d) : d);
  const documents = [...byId.values()].sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
  return {
    format: DB_FORMAT, version: DB_VERSION,
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
    settings: mergeSettings(a.settings, b.settings),
    documents,
  };
}

/**
 * Сравнивает базы по содержимому (без учёта порядка ключей).
 * @param {object} a база
 * @param {object} b база
 * @returns {boolean}
 */
export function dbEqual(a, b) {
  return serializeDb({ ...a, updatedAt: '' }) === serializeDb({ ...b, updatedAt: '' });
}

/**
 * Сериализует базу в стабильный JSON (одинаковая база — одинаковые байты).
 * @param {object} db база
 * @returns {string}
 */
export function serializeDb(db) {
  const sortKeys = (_key, value) => (value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]))
    : value);
  return JSON.stringify(db, sortKeys, 2) + '\n';
}

/**
 * Разбирает текст файла базы.
 * @param {string} text содержимое файла
 * @returns {object} нормализованная база
 */
export function parseDb(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Файл не является корректным JSON');
  }
  return normalizeDb(obj);
}

/**
 * Идентификатор документа — хэш имени и содержимого: один и тот же файл,
 * загруженный двумя людьми, превращается в одну запись.
 * @param {string} name имя файла
 * @param {string} text нормализованный текст
 * @returns {Promise<string>} 16 hex-символов
 */
export async function makeDocId(name, text) {
  const bytes = new TextEncoder().encode(`${name}\u0000${text}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Добавляет файлы в базу. Файл с тем же именем и другим содержимым считается
 * новой версией и заменяет старую (старая получает «надгробие»).
 * @param {object} db база
 * @param {{name:string,text:string}[]} files загружаемые файлы
 * @param {{author:string,now:string}} ctx кто и когда загружает
 * @returns {Promise<{db:object,added:number,replaced:number}>}
 */
export async function addDocuments(db, files, { author, now }) {
  let next = db;
  let added = 0;
  let replaced = 0;
  for (const f of files) {
    const text = normalizeText(f.text);
    const id = await makeDocId(f.name, text);
    const existing = next.documents.find((d) => d.id === id && !d.deleted);
    if (existing) continue;
    const stale = next.documents.filter((d) => d.name === f.name && !d.deleted);
    const tombstones = stale.map((d) => ({ ...d, text: '', deleted: true, updatedAt: now, deletedBy: author }));
    replaced += stale.length;
    added += 1;
    const record = { id, name: f.name, text, addedBy: author, addedAt: now, updatedAt: now };
    next = mergeDbs(next, { ...emptyDb(now), documents: [...tombstones, record] });
  }
  return { db: { ...next, updatedAt: now }, added, replaced };
}

/**
 * Помечает документ удалённым («надгробие»), чтобы удаление дошло до всех.
 * @param {object} db база
 * @param {string} id id документа
 * @param {{author:string,now:string}} ctx кто и когда удаляет
 * @returns {object} новая база
 */
export function removeDocument(db, id, { author, now }) {
  const doc = db.documents.find((d) => d.id === id);
  if (!doc) return db;
  const tomb = { ...doc, text: '', deleted: true, updatedAt: now, deletedBy: author };
  return { ...mergeDbs(db, { ...emptyDb(now), documents: [tomb] }), updatedAt: now };
}

/**
 * Записывает общий параметр (например, дату проверки) с меткой времени.
 * @param {object} db база
 * @param {string} key имя параметра
 * @param {unknown} value значение
 * @param {string} now ISO-время изменения
 * @returns {object} новая база
 */
export function setSetting(db, key, value, now) {
  return { ...db, updatedAt: now, settings: { ...db.settings, [key]: { value, updatedAt: now } } };
}

/**
 * Возвращает значение параметра или запасное, если оно не задано.
 * @param {object} db база
 * @param {string} key имя параметра
 * @param {unknown} fallback запасное значение
 * @returns {unknown}
 */
export function getSetting(db, key, fallback) {
  return db.settings[key] ? db.settings[key].value : fallback;
}

/**
 * Активные (не удалённые) документы базы.
 * @param {object} db база
 * @returns {object[]}
 */
export function activeDocuments(db) {
  return db.documents.filter((d) => !d.deleted);
}
