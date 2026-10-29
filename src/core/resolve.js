/**
 * resolve.js — сверка: какое значение каждого условия действует по договору
 * на дату проверки.
 *
 * Правило предметной области: условия меняет ТОЛЬКО подписанное обеими
 * сторонами допсоглашение, вступившее в силу к дате проверки. Письма, проекты
 * и допсоглашения, которые вступят в силу позже, показываются отдельно и в
 * значение не попадают. Если ситуацию нельзя разрешить однозначно, результат
 * помечается «нужна проверка».
 */

import { amendmentEffect } from './effects.js';
import { docRef, pickTop, resolveField } from './field-resolve.js';
import { FIELDS } from './fields.js';
import { docLabel, parseDocument } from './parse.js';
import { fmtDate } from './text.js';

function linkDocument(doc, byNumber) {
  const numbers = doc.targets.primary.length ? doc.targets.primary : doc.targets.all;
  const known = numbers.filter((n) => byNumber.has(n));
  if (known.length === 1) return { status: 'linked', number: known[0] };
  if (known.length > 1) return { status: 'ambiguous', number: null, note: `ссылается сразу на несколько договоров: ${known.join(', ')}` };
  if (!numbers.length) return { status: 'none', number: null, note: 'номер договора в документе не найден' };
  return { status: 'unknown', number: numbers[0], note: `договор ${numbers[0]} не найден среди загруженных` };
}

function amendmentEntries(a, review) {
  const out = [];
  for (const f of FIELDS) {
    const top = pickTop(a.candidates[f.key], f);
    if (top.status === 'ok') out.push(top.chosen);
    if (top.status === 'conflict') review.push({ text: `${docLabel(a)}: для поля «${f.label}» найдено несколько разных значений`, evidence: top.all[0].evidence });
  }
  return out;
}

/**
 * Помечает поля «нужна проверка», если применённое допсоглашение меняет пункт с нужным условием, а новое значение распознать не удалось — оставить старое значение без пометки было бы ошибкой.
 */
function flagUnparsedChanges(fields, c, applied, review) {
  for (const a of applied) {
    for (const u of a.unparsedChanges) {
      const hit = FIELDS.map((f) => f.key).filter((k) => c.candidates[k].some((x) => x.evidence.clause === u.clause));
      for (const key of hit) {
        fields[key].status = 'review';
        fields[key].notes.push(`${docLabel(a)} меняет п. ${u.clause}, но новое значение не распознано — проверьте вручную`);
      }
      if (hit.length) review.push({ text: `${docLabel(a)}: изменение п. ${u.clause} не распознано`, evidence: u.evidence });
    }
  }
}

function contractSelfChecks(c, checkDate, review) {
  if (!c.number) review.push({ text: 'Не удалось определить номер договора', evidence: null });
  if (c.status.signed === false) review.push({ text: 'Договор не подписан сторонами', evidence: c.status.evidence });
  if (c.status.signed === true && c.signDate && c.signDate > checkDate) {
    review.push({ text: `Договор подписан ${fmtDate(c.signDate)} — позже даты проверки`, evidence: c.status.evidence });
  }
}

const roleRecord = (a, c, effect) => ({
  contractNumber: c.number, role: effect.role, level: effect.role === 'review' ? 'review' : 'ok', note: effect.reason, effective: effect.effective || null,
});

function applyEntries(a, effect, entries, ctx) {
  ctx.applied.push(a);
  for (const e of entries) ctx.changes[e.field].push({ ...e, doc: a, effective: effect.effective, signDate: a.signDate });
}

function parkEntries(a, effect, entries, ctx) {
  const bucket = effect.role === 'scheduled' ? ctx.scheduled : ctx.proposals;
  const level = effect.role === 'review' ? 'review' : 'ok';
  for (const e of entries) {
    bucket.push({ ...e, doc: docRef(a), kind: effect.proposalKind || 'scheduled', reason: effect.reason, effective: effect.effective || null, level });
  }
  if (level === 'review') ctx.review.push({ text: `${docLabel(a)}: ${effect.reason}`, evidence: a.status.evidence || a.effective.evidence });
}

/**
 * Раскладывает один связанный документ по корзинам результата: применённые
 * изменения, будущие (вступят позже) и предложения; фиксирует роль документа.
 */
function sortRelated(a, c, ctx) {
  const effect = amendmentEffect(a, c, ctx.checkDate);
  const entries = amendmentEntries(a, ctx.review);
  ctx.roles.set(a.id, roleRecord(a, c, effect));
  if (effect.role === 'applied') applyEntries(a, effect, entries, ctx);
  else parkEntries(a, effect, entries, ctx);
}

/**
 * Собирает результат по одному договору: связанные документы раскладываются на применённые, будущие и предложения, затем считаются все поля и признак «нужна проверка».
 */
function resolveContract(c, related, checkDate, roles) {
  const ctx = {
    checkDate, roles, review: [], proposals: [], scheduled: [], applied: [],
    changes: Object.fromEntries(FIELDS.map((f) => [f.key, []])),
  };
  contractSelfChecks(c, checkDate, ctx.review);
  for (const a of related) sortRelated(a, c, ctx);
  const fields = Object.fromEntries(FIELDS.map((f) => [f.key, resolveField(f, c, ctx.changes[f.key])]));
  flagUnparsedChanges(fields, c, ctx.applied, ctx.review);
  const anyFieldReview = Object.values(fields).some((x) => x.status === 'review');
  return {
    docId: c.id, fileName: c.name, number: c.number, label: docLabel(c),
    supplier: c.supplier, buyer: c.buyer,
    fields, proposals: ctx.proposals, scheduled: ctx.scheduled, review: ctx.review,
    level: ctx.review.length || anyFieldReview ? 'review' : 'ok',
  };
}

/**
 * Помечает договоры с одинаковым номером в разных файлах: какой из них верный, программа не решает.
 */
function flagDuplicateNumbers(results) {
  const byNumber = new Map();
  for (const r of results) if (r.number) byNumber.set(r.number, [...(byNumber.get(r.number) || []), r]);
  for (const list of byNumber.values()) {
    if (list.length < 2) continue;
    for (const r of list) {
      r.review.push({ text: `Номер ${r.number} встречается в нескольких файлах: ${list.map((x) => x.fileName).join(', ')}`, evidence: null });
      r.level = 'review';
    }
  }
}

function documentLevel(doc, link, role) {
  if (role) return role.level;
  const unlinked = link && link.status !== 'linked';
  return unlinked || doc.kind === 'unknown' ? 'review' : 'ok';
}

const firstTruthy = (...values) => values.find(Boolean) || null;

const statusLabelOf = (doc) => doc.status.raw || (doc.kind === 'letter' ? 'письмо' : 'статус не указан');

function roleOf(doc, role) {
  if (role) return role.role;
  return doc.kind === 'contract' ? 'contract' : 'unlinked';
}

/**
 * Формирует строку списка документов: вид, статус, к какому договору привязан и какую роль сыграл в сверке.
 */
function describeDocument(doc, link, role) {
  return {
    id: doc.id, name: doc.name, kind: doc.kind, label: docLabel(doc), statusLabel: statusLabelOf(doc), signed: doc.status.signed,
    date: doc.date, linkedTo: firstTruthy((role || {}).contractNumber, (link || {}).number),
    role: roleOf(doc, role),
    note: firstTruthy((role || {}).note, (link || {}).note),
    level: documentLevel(doc, link, role),
  };
}

/**
 * Главная функция сверки: разбирает все документы базы и считает действующие
 * условия по каждому договору на дату проверки.
 * Контракт: детерминирована, не обращается к сети и хранилищам; порядок
 * загрузки и имена файлов на результат не влияют.
 * @param {{id:string,name:string,text:string,deleted?:boolean}[]} rawDocs документы базы
 * @param {string} checkDate дата проверки, YYYY-MM-DD
 * @returns {{checkDate:string,contracts:object[],docs:object[]}} таблица по договорам и список документов
 */
export function analyze(rawDocs, checkDate) {
  const docs = rawDocs.filter((d) => !d.deleted).map(parseDocument);
  const contracts = docs.filter((d) => d.kind === 'contract');
  const byNumber = new Map();
  for (const c of contracts) if (c.number) byNumber.set(c.number, true);
  const links = new Map();
  for (const d of docs) if (d.kind === 'amendment' || d.kind === 'letter') links.set(d.id, linkDocument(d, byNumber));
  const roles = new Map();
  const results = contracts.map((c) => {
    const related = docs.filter((d) => links.get(d.id)?.status === 'linked' && links.get(d.id).number === c.number);
    return resolveContract(c, related, checkDate, roles);
  });
  flagDuplicateNumbers(results);
  const info = docs.map((d) => describeDocument(d, links.get(d.id), roles.get(d.id)));
  return { checkDate, contracts: results, docs: info };
}
