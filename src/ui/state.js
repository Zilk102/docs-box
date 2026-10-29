/**
 * state.js — единственное изменяемое состояние вкладки и производные от него
 * значения (дата проверки, результат сверки с мемоизацией).
 *
 * Состояние живёт только в памяти страницы. Ни localStorage, ни cookies,
 * ни IndexedDB не используются: «источник правды» — файл базы, который
 * указал пользователь.
 */

import { activeDocuments, emptyDb, getSetting } from '../core/db.js';
import { analyze } from '../core/resolve.js';

export const state = {
  db: emptyDb(),
  store: null,
  token: null,
  status: 'offline',
  error: '',
  lastError: '',
  lastSync: null,
  tab: 'server',
  url: '',
  auth: '',
  name: '',
  unsaved: false,
  queue: Promise.resolve(),
  poller: null,
  memo: { db: null, date: null, value: null },
  qField: 'deadline',
  qContract: '',
  qBefore: '',
};

/** Текущее время в ISO — метка изменений в базе. */
export const nowIso = () => new Date().toISOString();

/** Сегодняшняя локальная дата YYYY-MM-DD (значение по умолчанию для даты проверки). */
export const todayIso = () => new Date().toLocaleDateString('sv-SE');

/** Подпись автора загрузок; без имени — «аноним». */
export const authorName = () => state.name.trim() || 'аноним';

/**
 * Дата проверки: общая настройка базы (видна всем пользователям) или сегодня.
 * @returns {string} YYYY-MM-DD
 */
export const checkDate = () => getSetting(state.db, 'checkDate', todayIso());

/**
 * Результат сверки по текущей базе. Пересчитывается только при смене базы
 * или даты проверки.
 * @returns {object} результат analyze
 */
export function analysis() {
  const date = checkDate();
  if (state.memo.db !== state.db || state.memo.date !== date) {
    state.memo = { db: state.db, date, value: analyze(activeDocuments(state.db), date) };
  }
  return state.memo.value;
}
