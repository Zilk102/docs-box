/**
 * helpers.mjs — общие утилиты тестов: загрузка учебных документов и сборка
 * «базы» из строк, чтобы тесты правили текст договоров, а не код.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/core/resolve.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'documents');

/** Читает учебные документы: {имя файла: текст}. */
export function loadExamples() {
  return Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
}

/** Превращает {имя: текст} в записи базы с простыми id. */
export function toDocs(files) {
  return Object.entries(files).map(([name, text], i) => ({ id: `d${i}`, name, text, updatedAt: '2026-03-10T00:00:00Z' }));
}

/** Сверка набора файлов на дату (по умолчанию — 10.03.2026). */
export function run(files, date = '2026-03-10') {
  return analyze(toDocs(files), date);
}

/** Находит результат по номеру договора. */
export function contract(result, number) {
  return result.contracts.find((c) => c.number === number);
}
