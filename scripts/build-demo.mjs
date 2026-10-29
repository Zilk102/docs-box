/**
 * build-demo.mjs — собирает examples/demo-db.json из учебных TXT-файлов
 * (examples/documents). Запуск: node scripts/build-demo.mjs
 * Время фиксировано, поэтому результат воспроизводим и не создаёт шума в git.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDocuments, emptyDb, serializeDb, setSetting } from '../src/core/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'examples', 'documents');
const NOW = '2026-03-10T09:00:00.000Z';

const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.txt')).sort();
const files = await Promise.all(names.map(async (name) => ({ name, text: await fs.readFile(path.join(dir, name), 'utf8') })));
const { db } = await addDocuments(emptyDb(NOW), files, { author: 'демо', now: NOW });
const out = setSetting(db, 'checkDate', '2026-03-10', NOW);
await fs.writeFile(path.join(root, 'examples', 'demo-db.json'), serializeDb(out));
console.log(`demo-db.json: ${files.length} документов`);
