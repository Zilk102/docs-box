/**
 * db.test.mjs — проверки формата базы и слияния: идемпотентность,
 * коммутативность, удаление, замена версии файла и защита от чужого JSON.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDocuments, dbEqual, emptyDb, getSetting, mergeDbs, parseDb, removeDocument, serializeDb, setSetting } from '../src/core/db.js';

const T1 = '2026-03-10T10:00:00.000Z';
const T2 = '2026-03-10T10:00:05.000Z';
const T3 = '2026-03-10T10:00:09.000Z';

test('одинаковый файл от двух людей — одна запись', async () => {
  const a = (await addDocuments(emptyDb(T1), [{ name: 'a.txt', text: 'Договор' }], { author: 'Анна', now: T1 })).db;
  const b = (await addDocuments(emptyDb(T1), [{ name: 'a.txt', text: 'Договор' }], { author: 'Борис', now: T2 })).db;
  assert.equal(mergeDbs(a, b).documents.length, 1);
});

test('слияние идемпотентно и коммутативно', async () => {
  const a = (await addDocuments(emptyDb(T1), [{ name: 'a.txt', text: 'A' }], { author: 'Анна', now: T1 })).db;
  const b = (await addDocuments(emptyDb(T1), [{ name: 'b.txt', text: 'B' }], { author: 'Борис', now: T2 })).db;
  assert.ok(dbEqual(mergeDbs(a, b), mergeDbs(b, a)));
  assert.ok(dbEqual(mergeDbs(a, a), a));
  assert.equal(mergeDbs(a, b).documents.length, 2);
});

test('удаление распространяется через слияние, повторная загрузка возвращает документ', async () => {
  const a = (await addDocuments(emptyDb(T1), [{ name: 'a.txt', text: 'A' }], { author: 'Анна', now: T1 })).db;
  const removed = removeDocument(a, a.documents[0].id, { author: 'Борис', now: T2 });
  const merged = mergeDbs(a, removed);
  assert.equal(merged.documents[0].deleted, true);
  assert.equal(merged.documents[0].text, '');
  const back = (await addDocuments(merged, [{ name: 'a.txt', text: 'A' }], { author: 'Анна', now: T3 })).db;
  assert.equal(back.documents.filter((d) => !d.deleted).length, 1);
});

test('файл с тем же именем и другим текстом заменяет прежнюю версию', async () => {
  const v1 = (await addDocuments(emptyDb(T1), [{ name: 'c.txt', text: 'v1' }], { author: 'Анна', now: T1 })).db;
  const { db, replaced } = await addDocuments(v1, [{ name: 'c.txt', text: 'v2' }], { author: 'Анна', now: T2 });
  assert.equal(replaced, 1);
  const active = db.documents.filter((d) => !d.deleted);
  assert.deepEqual(active.map((d) => d.text), ['v2']);
});

test('настройки: побеждает более позднее значение', () => {
  const a = setSetting(emptyDb(T1), 'checkDate', '2026-03-10', T1);
  const b = setSetting(emptyDb(T1), 'checkDate', '2026-04-01', T2);
  assert.equal(getSetting(mergeDbs(a, b), 'checkDate'), '2026-04-01');
  assert.equal(getSetting(mergeDbs(b, a), 'checkDate'), '2026-04-01');
});

test('чужой или повреждённый JSON не принимается за базу', () => {
  assert.throws(() => parseDb('не json'), /JSON/);
  assert.throws(() => parseDb('{"hello":1}'), /не файл базы/);
  assert.throws(() => parseDb(JSON.stringify({ format: 'docsbox-db', version: 99, documents: [] })), /новее/);
  assert.throws(() => parseDb(JSON.stringify({ format: 'docsbox-db', version: 1, documents: [{ id: 1 }] })), /Повреждена/);
});

test('сериализация стабильна и обратима', async () => {
  const a = (await addDocuments(emptyDb(T1), [{ name: 'a.txt', text: 'A\r\nB' }], { author: 'Анна', now: T1 })).db;
  assert.equal(serializeDb(parseDb(serializeDb(a))), serializeDb(a));
  assert.equal(a.documents[0].text, 'A\nB', 'переводы строк нормализуются');
});
