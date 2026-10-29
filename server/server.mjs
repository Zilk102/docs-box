/**
 * server.mjs — референсный сервер общей базы DocsBox (Node 18+, без зависимостей).
 *
 * Хранит ОДИН файл и умеет ровно три вещи: отдать его (GET с ETag), принять
 * новую версию (PUT с обязательным If-Match — оптимистичная блокировка) и
 * ответить на CORS-запрос браузера. Содержимое он не разбирает, кроме
 * проверки, что это JSON базы DocsBox. Любой другой сервер с теми же
 * гарантиями (WebDAV, Nextcloud…) подойдёт так же.
 *
 * Настройка через переменные окружения: PORT, DB_FILE, TOKEN (если задан —
 * нужен заголовок «Authorization: Bearer <TOKEN>»), ALLOW_ORIGIN (по
 * умолчанию «*»; для продакшена укажите адрес вашего GitHub Pages).
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 64 * 1024 * 1024;

function etagOf(buffer) {
  return `"${crypto.createHash('sha1').update(buffer).digest('hex')}"`;
}

/**
 * Читает тело запроса целиком. Нужен, чтобы PUT проверял и записывал базу одним куском; бросает ошибку со статусом 413, если тело больше MAX_BODY.
 */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readCurrent(file) {
  try {
    const buffer = await fs.readFile(file);
    return { buffer, etag: etagOf(buffer) };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function isDocsBoxJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8')).format === 'docsbox-db';
  } catch {
    return false;
  }
}

const WRITE_RULES = [
  // [условие отказа, статус, текст, отдавать ли текущий ETag]
  [(cur, m, n) => cur && n === '*', 412, 'already exists', true],
  [(cur, m) => cur && !m, 428, 'If-Match required', false],
  [(cur, m) => cur && m !== cur.etag, 412, 'version conflict', true],
  [(cur, m) => !cur && m, 412, 'version conflict', false],
  [(cur, m, n) => !cur && !n, 428, 'If-None-Match: * required to create', false],
];

/**
 * Проверяет условия записи (оптимистичная блокировка) и возвращает отказ
 * [статус, заголовки, текст] либо null, если запись разрешена. Правила:
 * существующую базу можно заменить только с совпадающим If-Match; создать —
 * только с If-None-Match: *.
 */
function writeRefusal(current, ifMatch, ifNoneMatch) {
  const rule = WRITE_RULES.find(([refuses]) => refuses(current, ifMatch, ifNoneMatch));
  if (!rule) return null;
  const [, status, text, withEtag] = rule;
  return [status, withEtag ? { ETag: current.etag } : {}, text];
}

async function writeAtomically(file, body) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(tmp, body);
  await fs.rename(tmp, file);
}

const GET_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

async function handleGet(ctx, req, res) {
  const current = await readCurrent(ctx.file);
  if (!current) return ctx.send(res, 404, {}, 'no database yet');
  if (req.headers['if-none-match'] === current.etag) return ctx.send(res, 304, { ETag: current.etag });
  return ctx.send(res, 200, { ETag: current.etag, ...GET_HEADERS }, current.buffer);
}

async function handlePut(ctx, req, res) {
  const body = await readBody(req);
  if (!isDocsBoxJson(body)) return ctx.send(res, 400, {}, 'not a DocsBox database');
  const current = await readCurrent(ctx.file);
  const refusal = writeRefusal(current, req.headers['if-match'], req.headers['if-none-match']);
  if (refusal) return ctx.send(res, ...refusal);
  await writeAtomically(ctx.file, body);
  return ctx.send(res, current ? 200 : 201, { ETag: etagOf(body) });
}

/**
 * Создаёт HTTP-сервер общей базы.
 * Контракт: запросы выполняются строго по очереди, поэтому проверка версии и
 * запись не могут пересечься с другим PUT; чужой JSON не принимается; при
 * несовпадении If-Match ответ 412.
 * @param {{file:string,token?:string,origin?:string}} options путь к файлу базы, токен, разрешённый Origin
 * @returns {http.Server}
 */
export function createDbServer({ file, token = '', origin = '*' }) {
  let queue = Promise.resolve();
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag',
    'Access-Control-Max-Age': '600',
  };
  const send = (res, status, headers = {}, body = '') => {
    res.writeHead(status, { ...cors, ...headers });
    res.end(body);
  };
  const ctx = { file, send };
  const handlers = { GET: handleGet, PUT: handlePut };

  return http.createServer((req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204);
    if (token && req.headers.authorization !== `Bearer ${token}`) return send(res, 401, {}, 'unauthorized');
    const handler = handlers[req.method];
    if (!handler) return send(res, 405);
    queue = queue.then(() => handler(ctx, req, res)).catch((e) => { if (!res.headersSent) send(res, e.status || 500, {}, String(e.message)); });
    return queue;
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  const file = process.env.DB_FILE || './data/db.json';
  createDbServer({ file, token: process.env.TOKEN || '', origin: process.env.ALLOW_ORIGIN || '*' })
    .listen(port, () => console.log(`DocsBox DB server: http://localhost:${port}/  →  ${path.resolve(file)}${process.env.TOKEN ? '  (token required)' : ''}`));
}
