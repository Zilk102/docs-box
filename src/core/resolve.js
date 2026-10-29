/**
 * resolve.js — сверка: какое значение каждого условия действует по договору
 * на дату проверки.
 *
 * Правило предметной области: условия меняет ТОЛЬКО подписанное обеими
 * сторонами допсоглашение, вступившее в силу к дате проверки. Письма, проекты
 * и допсоглашения, которые вступят в силу позже, показываются отдельно и в
 * значение не попадают. Если ситуацию нельзя разрешить надёжно, результат
 * помечается «нужна проверка» — значение не угадывается.
 */

import { FIELDS } from './fields.js';
import { docLabel, normalizeParty, parseDocument } from './parse.js';
import { fmtDate } from './text.js';

const uniqueValues = (items, field) => items.filter((x, i) => items.findIndex((y) => field.equals(x.value, y.value)) === i);

function pickTop(cands, field) {
  if (!cands.length) return { status: 'none', all: [] };
  const top = Math.max(...cands.map((c) => c.priority));
  const group = cands.filter((c) => c.priority === top);
  return uniqueValues(group, field).length > 1
    ? { status: 'conflict', all: group }
    : { status: 'ok', chosen: group[0], all: group };
}

function linkDocument(doc, byNumber) {
  const numbers = doc.targets.primary.length ? doc.targets.primary : doc.targets.all;
  const known = numbers.filter((n) => byNumber.has(n));
  if (known.length === 1) return { status: 'linked', number: known[0] };
  if (known.length > 1) return { status: 'ambiguous', number: null, note: `ссылается сразу на несколько договоров: ${known.join(', ')}` };
  if (!numbers.length) return { status: 'none', number: null, note: 'номер договора в документе не найден' };
  return { status: 'unknown', number: numbers[0], note: `договор ${numbers[0]} не найден среди загруженных` };
}

function partiesMismatch(a, c) {
  const diff = (x, y) => x && y && normalizeParty(x.name) !== normalizeParty(y.name);
  return diff(a.supplier, c.supplier) || diff(a.buyer, c.buyer);
}

const review = (reason) => ({ role: 'review', reason, proposalKind: 'unsigned' });

const EFFECT_RULES = [
  (a) => a.kind === 'letter' && { role: 'proposal', reason: 'предложение, а не согласованное изменение', proposalKind: 'letter' },
  (a) => a.status.signed === false && { role: 'proposal', reason: a.isDraft ? 'проект, не подписан сторонами' : 'не подписано сторонами', proposalKind: 'draft' },
  (a) => a.status.signed === null && review('статус подписания не определён'),
  (a, c) => partiesMismatch(a, c) && review('стороны в допсоглашении не совпадают с договором'),
  (a) => !a.signDate && review('не указана дата подписания'),
  (a, c, day) => a.signDate > day && { role: 'scheduled', effective: a.signDate, reason: `подписано ${fmtDate(a.signDate)} — позже даты проверки` },
];

function effectiveDate(a) {
  if (a.effective.kind === 'date') return a.effective.iso;
  return a.effective.kind === 'on-signing' ? a.signDate : null;
}

/**
 * Решает, как документ влияет на договор на дату проверки: применяется, вступит позже, предложение или нужна проверка. Применяется только подписанное обеими сторонами допсоглашение с наступившей датой вступления в силу.
 */
function amendmentEffect(a, c, checkDate) {
  for (const rule of EFFECT_RULES) {
    const verdict = rule(a, c, checkDate);
    if (verdict) return verdict;
  }
  const effective = effectiveDate(a);
  if (!effective) return review('не указана дата вступления в силу');
  if (effective > checkDate) return { role: 'scheduled', effective, reason: `вступает в силу ${fmtDate(effective)} — позже даты проверки` };
  return { role: 'applied', effective, reason: `вступило в силу ${fmtDate(effective)}` };
}

function docRef(doc) {
  return { id: doc.id, fileName: doc.name, label: docLabel(doc), kind: doc.kind };
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

const byEffectiveOrder = (x, y) => (x.effective + x.signDate).localeCompare(y.effective + y.signDate);

function conflictResult(f, cands, reason) {
  return {
    key: f.key, label: f.label, status: 'review', value: null, display: null, evidence: null, source: null,
    changed: false, base: null, history: [], notes: [reason], warnings: [], rejected: [],
    candidates: cands.map((c) => ({ display: c.display, evidence: c.evidence })),
  };
}

function historyItem(cand, doc, effective) {
  return { display: cand.display, value: cand.value, evidence: cand.evidence, effective, doc: docRef(doc) };
}

function noDataResult(f, c) {
  const hint = f.nodataHint(c);
  return {
    key: f.key, label: f.label, status: 'nodata', value: null, display: null, evidence: hint ? c.evidenceOf(hint.sentence) : null,
    source: null, changed: false, base: null, history: [], notes: hint ? [hint.text] : [], warnings: [],
    rejected: c.rejected[f.key], candidates: [],
  };
}

/** Находит самое позднее по вступлению в силу изменение и конфликт между равноправными изменениями. */
function latestChange(f, sorted) {
  const last = sorted[sorted.length - 1];
  if (!last) return { last: null, conflict: false };
  const peers = sorted.filter((x) => x.effective === last.effective && x.signDate === last.signDate);
  return { last, conflict: uniqueValues(peers, f).length > 1, peers };
}

/**
 * Собирает результат поля со значением: действующее значение, откуда оно взято, было ли изменено допсоглашением и история значений.
 */
function okResult(f, c, base, sorted, last) {
  const current = last || base.chosen;
  const warnings = current.warnings || [];
  const history = sorted.map((ch) => historyItem(ch, ch.doc, ch.effective));
  if (base.status === 'ok') history.unshift(historyItem(base.chosen, c, null));
  return {
    key: f.key, label: f.label, status: warnings.length ? 'review' : 'ok', value: current.value, display: current.display,
    evidence: current.evidence,
    source: last ? { kind: 'amendment', ...docRef(last.doc), effective: last.effective } : { kind: 'contract', ...docRef(c) },
    changed: Boolean(last) && (base.status === 'none' || !f.equals(base.chosen.value, current.value)),
    base: base.status === 'ok' ? { display: base.chosen.display, evidence: base.chosen.evidence } : null,
    history, notes: [], warnings, rejected: [], candidates: [],
  };
}

/**
 * Определяет действующее значение одного условия: основа из договора, затем применённые допсоглашения по порядку вступления в силу. Конфликты и отсутствие данных возвращаются явно, значение не угадывается.
 */
function resolveField(f, c, changes) {
  const base = pickTop(c.candidates[f.key], f);
  if (base.status === 'conflict') return conflictResult(f, base.all, 'в договоре найдено несколько разных значений');
  const sorted = [...changes].sort(byEffectiveOrder);
  const { last, conflict, peers } = latestChange(f, sorted);
  if (conflict) return conflictResult(f, peers, 'допсоглашения с одной датой вступления в силу задают разные значения');
  if (base.status === 'none' && !last) return noDataResult(f, c);
  return okResult(f, c, base, sorted, last);
}

/**
 * Помечает поля «нужна проверка», если применённое допсоглашение меняет пункт с нужным условием, а новое значение распознать не удалось — молча оставить старое было бы ошибкой.
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

/**
 * Раскладывает один связанный документ по корзинам результата: применённые
 * изменения, будущие (вступят позже) и предложения; фиксирует роль документа.
 */
function sortRelated(a, c, ctx) {
  const effect = amendmentEffect(a, c, ctx.checkDate);
  const entries = amendmentEntries(a, ctx.review);
  const isReview = effect.role === 'review';
  ctx.roles.set(a.id, { contractNumber: c.number, role: effect.role, level: isReview ? 'review' : 'ok', note: effect.reason, effective: effect.effective || null });
  if (effect.role === 'applied') {
    ctx.applied.push(a);
    for (const e of entries) ctx.changes[e.field].push({ ...e, doc: a, effective: effect.effective, signDate: a.signDate });
    return;
  }
  const bucket = effect.role === 'scheduled' ? ctx.scheduled : ctx.proposals;
  for (const e of entries) {
    bucket.push({ ...e, doc: docRef(a), kind: effect.proposalKind || 'scheduled', reason: effect.reason, effective: effect.effective || null, level: isReview ? 'review' : 'ok' });
  }
  if (isReview) ctx.review.push({ text: `${docLabel(a)}: ${effect.reason}`, evidence: a.status.evidence || a.effective.evidence });
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

/**
 * Формирует строку списка документов: вид, статус, к какому договору привязан и какую роль сыграл в сверке.
 */
function describeDocument(doc, link, role) {
  const statusLabel = doc.status.raw || (doc.kind === 'letter' ? 'письмо' : 'статус не указан');
  return {
    id: doc.id, name: doc.name, kind: doc.kind, label: docLabel(doc), statusLabel, signed: doc.status.signed,
    date: doc.date, linkedTo: role?.contractNumber || link?.number || null,
    role: role?.role || (doc.kind === 'contract' ? 'contract' : 'unlinked'),
    note: role?.note || link?.note || null,
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
