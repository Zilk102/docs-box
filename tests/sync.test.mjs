/**
 * sync.test.mjs — проверки многопользовательской работы: реальный HTTP-сервер
 * базы, несколько «закупщиков» с параллельными записями, конфликты версий,
 * защита сервера и файловое хранилище на поддельном дескрипторе.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { addDocuments, emptyDb, serializeDb } from '../src/core/db.js';
import { createDbServer } from '../server/server.mjs';
import { FileStore } from '../src/sync/file-store.js';
import { RemoteStore, validateRemoteUrl } from '../src/sync/remote-store.js';
import { pollOnce, syncOnce } from '../src/sync/sync.js';

let server;
let url;
let dir;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docsbox-'));
  server = createDbServer({ file: path.join(dir, 'db.json'), token: 'secret' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/db.json`;
});
after(async () => {
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const client = (auth = 'Bearer secret') => new RemoteStore({ url, authorization: auth });
const withDoc = async (name, text, author, now) => (await addDocuments(emptyDb(now), [{ name, text }], { author, now })).db;

test('сервер: без токена — 401, с токеном — 404 пока базы нет', async () => {
  await assert.rejects(() => client('').read(), /401|доступ/);
  assert.deepEqual(await client().read(), { db: null, token: null });
});

test('создание и чтение базы, повторная запись без версии отклоняется', async () => {
  const a = await withDoc('a.txt', 'A', 'Анна', '2026-03-10T10:00:00.000Z');
  const first = await syncOnce(client(), a);
  assert.equal(first.wrote, true);
  const read = await client().read();
  assert.equal(read.db.documents.length, 1);
  assert.deepEqual(await client().write(a, null), { ok: false }, 'If-None-Match: * не должен затирать существующую базу');
});

test('если у других ничего не изменилось, запись не выполняется', async () => {
  const a = await withDoc('a.txt', 'A', 'Анна', '2026-03-10T10:00:00.000Z');
  const result = await syncOnce(client(), a);
  assert.equal(result.wrote, false);
});

test('параллельные записи пяти закупщиков: все документы сохраняются', async () => {
  const names = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дина'];
  const people = await Promise.all(names.map((n, i) => withDoc(`doc-${i}.txt`, `текст ${i}`, n, `2026-03-10T11:00:0${i}.000Z`)));
  await Promise.all(people.map((db) => syncOnce(client(), db)));
  const final = (await client().read()).db;
  const stored = final.documents.map((d) => d.name);
  for (let i = 0; i < 5; i++) assert.ok(stored.includes(`doc-${i}.txt`), `doc-${i}.txt потерян`);
});

test('опрос: 304 без изменений и подхват чужой загрузки', async () => {
  const me = await syncOnce(client(), emptyDb('2026-03-10T09:00:00.000Z'));
  const idle = await pollOnce(client(), me.db, me.token);
  assert.equal(idle.changed, false);
  const other = await withDoc('new-from-colleague.txt', 'N', 'Борис', '2026-03-10T12:00:00.000Z');
  await syncOnce(client(), other);
  const seen = await pollOnce(client(), me.db, me.token);
  assert.equal(seen.changed, true);
  assert.ok(seen.db.documents.some((d) => d.name === 'new-from-colleague.txt'));
});

test('сервер не принимает постороннее содержимое', async () => {
  const token = (await client().read()).token;
  const res = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bearer secret', 'If-Match': token }, body: '{"x":1}' });
  assert.equal(res.status, 400);
});

test('предупреждения об адресе: http на https-странице и мусор', () => {
  assert.throws(() => validateRemoteUrl('http://example.com/db.json', 'https:'), /HTTPS/);
  assert.doesNotThrow(() => validateRemoteUrl('http://localhost:8787/db.json', 'https:'));
  assert.throws(() => validateRemoteUrl('не адрес'), /URL/);
});

function fakeHandle(initial = '') {
  const state = { text: initial, modified: 1 };
  return {
    state,
    name: 'db.json',
    getFile: async () => ({ lastModified: state.modified, size: state.text.length, text: async () => state.text }),
    createWritable: async () => {
      let buf = '';
      return { write: async (s) => { buf += s; }, close: async () => { state.text = buf; state.modified += 1; } };
    },
  };
}

test('файловое хранилище: запись, чтение и конфликт при изменении файла другим', async () => {
  const handle = fakeHandle();
  const store = new FileStore(handle);
  const a = await withDoc('a.txt', 'A', 'Анна', '2026-03-10T10:00:00.000Z');
  const first = await syncOnce(store, a);
  assert.equal(first.wrote, true);
  assert.equal(JSON.parse(handle.state.text).documents.length, 1);
  const stale = (await store.read()).token;
  handle.state.text = serializeDb(emptyDb('2026-03-10T10:05:00.000Z'));
  handle.state.modified += 1;
  assert.deepEqual(await store.write(a, stale), { ok: false });
  const healed = await syncOnce(store, a);
  assert.equal(JSON.parse(handle.state.text).documents.length, 1, 'после конфликта локальные документы дописываются обратно');
  assert.equal(healed.wrote, true);
});
