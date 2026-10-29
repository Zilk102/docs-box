/**
 * field-resolve.js — действующее значение одного условия договора: основа
 * из договора плюс применённые изменения по порядку вступления в силу.
 * Конфликты и отсутствие данных возвращаются явно.
 */

import { docLabel } from './parse.js';

const uniqueValues = (items, field) => items.filter((x, i) => items.findIndex((y) => field.equals(x.value, y.value)) === i);

/**
 * Выбирает значения высшего приоритета среди кандидатов. Результат: none (нет кандидатов), ok (одно значение) или conflict (несколько разных значений на одном уровне).
 */
export function pickTop(cands, field) {
  if (!cands.length) return { status: 'none', all: [] };
  const top = Math.max(...cands.map((c) => c.priority));
  const group = cands.filter((c) => c.priority === top);
  return uniqueValues(group, field).length > 1
    ? { status: 'conflict', all: group }
    : { status: 'ok', chosen: group[0], all: group };
}

/**
 * Краткая ссылка на документ для результата: id, имя файла, подпись и вид.
 */
export function docRef(doc) {
  return { id: doc.id, fileName: doc.name, label: docLabel(doc), kind: doc.kind };
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

const sourceOf = (c, last) => (last
  ? { kind: 'amendment', ...docRef(last.doc), effective: last.effective }
  : { kind: 'contract', ...docRef(c) });

const baseOf = (base) => (base.status === 'ok' ? { display: base.chosen.display, evidence: base.chosen.evidence } : null);

function isChanged(f, base, last) {
  if (!last) return false;
  return base.status === 'none' || !f.equals(base.chosen.value, last.value);
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
    evidence: current.evidence, source: sourceOf(c, last), changed: isChanged(f, base, last), base: baseOf(base),
    history, notes: [], warnings, rejected: [], candidates: [],
  };
}

/**
 * Определяет действующее значение одного условия: основа из договора, затем применённые допсоглашения по порядку вступления в силу. Конфликты и отсутствие данных возвращаются явно, значение не угадывается.
 */
export function resolveField(f, c, changes) {
  const base = pickTop(c.candidates[f.key], f);
  if (base.status === 'conflict') return conflictResult(f, base.all, 'в договоре найдено несколько разных значений');
  const sorted = [...changes].sort(byEffectiveOrder);
  const { last, conflict, peers } = latestChange(f, sorted);
  if (conflict) return conflictResult(f, peers, 'допсоглашения с одной датой вступления в силу задают разные значения');
  if (base.status === 'none' && !last) return noDataResult(f, c);
  return okResult(f, c, base, sorted, last);
}
