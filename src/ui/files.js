/**
 * files.js — ввод и вывод документов: загрузка TXT, импорт и экспорт файла
 * базы, пример для знакомства.
 */

import { activeDocuments, addDocuments, mergeDbs, parseDb, serializeDb } from '../core/db.js';
import { readFileText, toast } from './dom.js';
import { commit } from './session.js';
import { authorName, nowIso, state, todayIso } from './state.js';

const isText = (f) => /\.txt$/i.test(f.name) || f.type === 'text/plain';

/**
 * Читает TXT-файлы и добавляет их в базу. Файлы других форматов пропускаются
 * с пояснением.
 * @param {FileList|File[]} fileList выбранные или перетащенные файлы
 */
export async function addFiles(fileList) {
  const files = [...fileList];
  const texts = files.filter(isText);
  if (texts.length < files.length) toast(`Пропущено файлов не в формате TXT: ${files.length - texts.length}`, 'error');
  if (!texts.length) return;
  const loaded = await Promise.all(texts.map(async (f) => ({ name: f.name, text: await readFileText(f) })));
  const { db, added, replaced } = await addDocuments(state.db, loaded, { author: authorName(), now: nowIso() });
  commit(db);
  if (!added) return toast('Эти файлы уже есть в базе', 'info');
  return toast(`Добавлено: ${added}${replaced ? `, заменено версий: ${replaced}` : ''}`, 'ok');
}

/**
 * Добавляет документы из файла базы к текущим (слияние, не замена).
 * @param {File} file файл JSON
 */
export async function importDb(file) {
  try {
    const imported = parseDb(await readFileText(file));
    const before = activeDocuments(state.db).length;
    commit(mergeDbs(state.db, imported));
    toast(`Импортировано. Документов: ${activeDocuments(state.db).length} (было ${before})`, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/** Скачивает текущую базу файлом JSON. */
export function exportDb() {
  const blob = new Blob([serializeDb(state.db)], { type: 'application/json' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `docsbox-db-${todayIso()}.json` });
  link.click();
  URL.revokeObjectURL(link.href);
  state.unsaved = false;
}

/** Загружает учебный набор документов. Вызывается только по кнопке. */
export async function loadDemo() {
  try {
    const res = await fetch('examples/demo-db.json');
    commit(mergeDbs(state.db, parseDb(await res.text())));
  } catch {
    toast('Не удалось загрузить пример', 'error');
  }
}
