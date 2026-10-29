/**
 * parse.js — разбор одного документа: тип (договор / допсоглашение / письмо),
 * статус подписания, даты, стороны, номер договора, на который ссылается
 * документ, и кандидаты значений полей с точными цитатами.
 *
 * Здесь нет решений «какое значение действует» — только то, что написано в
 * тексте. Решения принимает resolve.js, учитывая статус и дату проверки.
 */

import { FIELDS } from './fields.js';
import { findDates, normalizeText, splitParagraphs, splitSentences } from './text.js';

const CHANGE_VERB_RE = /изложить|заменить|изменить|дополнить/i;
const CONTRACT_ID = String.raw`[A-ZА-ЯЁ]{1,8}[-‑–—]\d[\w\-‑–—/]*`;
const PARTY = String.raw`((?:[А-ЯA-Z][А-Яа-яA-Za-z]{0,4}\s+)?«[^»\n]+»|[^.;,\n]+)`;
const SKIP_SENTENCE_RE = /^(?:Статус|Дата(?:\s+проекта)?|От|Кому)\s*:/;

/**
 * Приводит номер договора к сравнимому виду (регистр, тире, пробелы).
 * @param {string} raw номер из текста
 * @returns {string}
 */
export function normalizeNumber(raw) {
  return raw.toUpperCase().replace(/[‑–—]/g, '-').replace(/\s+/g, '');
}

/**
 * Приводит название организации к виду для сравнения сторон.
 * @param {string|null} name название из текста
 * @returns {string}
 */
export function normalizeParty(name) {
  if (!name) return '';
  const quoted = /«([^»]+)»/.exec(name);
  return (quoted ? quoted[1] : name).toLowerCase().replace(/[\s"«»]+/g, ' ').trim();
}

function detectKind(title, text) {
  const head = title.toLowerCase();
  if (/дополнительн\S*\s+соглашени/.test(head)) return 'amendment';
  if (/^(?:договор|контракт)(?![а-яё])/.test(head)) return 'contract';
  if (/письм/.test(head) || /^От\s*:/m.test(text)) return 'letter';
  return 'unknown';
}

function detectSigned(statusRaw, isDraft) {
  if (isDraft) return false;
  if (!statusRaw) return null;
  if (/не\s+подписан|проект|на\s+согласовани/i.test(statusRaw)) return false;
  if (/подписан\S*\s+(?:обеими|двумя|всеми)\s+сторонами/i.test(statusRaw)) return true;
  return null;
}

function detectEffective(doc) {
  const s = doc.sentences.find((x) => /вступ\S*\s+в\s+силу/i.test(x.text) && !/^Статус/.test(x.text));
  if (!s) return { kind: null, iso: null, evidence: null };
  const evidence = doc.evidenceOf(s);
  const date = findDates(s.text)[0];
  if (date) return { kind: 'date', iso: date.iso, evidence };
  if (/(?:с\s+момента|со\s+дня|с\s+даты)\s+подписани/i.test(s.text)) return { kind: 'on-signing', iso: null, evidence };
  return { kind: 'after-signing', iso: null, evidence };
}

function findParty(doc, label) {
  const m = new RegExp(`${label}\\s*:\\s*${PARTY}`).exec(doc.text);
  if (!m) return null;
  const name = m[1].trim();
  const s = doc.sentenceAt(m.index);
  return { name, evidence: s ? doc.evidenceOf(s) : null };
}

/**
 * Ищет номера договоров, на которые ссылается документ: «первичные» — из заголовка и темы, «все» — по всему тексту. Нужны, чтобы привязать допсоглашение или письмо к договору.
 */
function extractTargets(doc) {
  const re = new RegExp(`(?:договор\\S*|контракт\\S*)\\s*(?:поставки\\s*)?(?:№|N)?\\s*(${CONTRACT_ID})`, 'giu');
  const headLines = doc.paragraphs.slice(0, 2).map((p) => p.text).join('\n');
  const primary = [...headLines.matchAll(re)].map((m) => normalizeNumber(m[1]));
  const subject = /^Тема\s*:\s*(.+)$/m.exec(doc.text);
  const fromSubject = subject ? [...subject[1].matchAll(re)].map((m) => normalizeNumber(m[1])) : [];
  const all = [...doc.text.matchAll(re)].map((m) => normalizeNumber(m[1]));
  const uniq = (xs) => [...new Set(xs)];
  return { primary: uniq([...primary, ...fromSubject]), all: uniq(all) };
}

function extractNumber(doc) {
  const m = new RegExp(`№\\s*(${CONTRACT_ID}|[\\wА-Яа-я][\\w\\-‑–—/А-Яа-я]*)`, 'u').exec(doc.paragraphs[0]?.text || '');
  return m ? normalizeNumber(m[1]) : null;
}

const CLAUSE_REF_RE = /(?:пункт\S*|п\.)\s*(\d+(?:\.\d+)*)/i;

/** Номер пункта договора, который меняет абзац допсоглашения («Пункт 2.1 … изложить»), либо null. */
function changedClause(paragraphText) {
  const m = CHANGE_VERB_RE.test(paragraphText) ? CLAUSE_REF_RE.exec(paragraphText) : null;
  return m ? m[1] : null;
}

/**
 * Прогоняет каждое предложение через реестр полей и складывает принятые значения и отвергнутые кандидаты (с причиной). Служебные строки «Статус/Дата/От/Кому» пропускаются.
 */
function collectCandidates(doc) {
  const candidates = Object.fromEntries(FIELDS.map((f) => [f.key, []]));
  const rejected = Object.fromEntries(FIELDS.map((f) => [f.key, []]));
  const changed = new Set();
  const sentences = doc.sentences.filter((s) => !SKIP_SENTENCE_RE.test(s.text));
  for (const s of sentences) {
    const targetClause = changedClause(doc.paragraphs[s.paragraph - 1].text);
    for (const f of FIELDS) {
      const r = f.extract(s);
      if (!r) continue;
      const evidence = doc.evidenceOf(s);
      if (r.rejected) {
        rejected[f.key].push({ ...r.rejected, evidence });
        continue;
      }
      candidates[f.key].push({ field: f.key, ...r, evidence, targetClause });
      changed.add(s.paragraph);
    }
  }
  return { candidates, rejected, changed };
}

function findUnparsedChanges(doc, changedParagraphs) {
  const out = [];
  for (const p of doc.paragraphs) {
    const clause = changedClause(p.text);
    if (clause && !changedParagraphs.has(p.n)) out.push({ clause, evidence: doc.evidenceOf(doc.sentences.find((s) => s.paragraph === p.n)) });
  }
  return out;
}

function buildStatus(doc) {
  const m = /^Статус\s*:\s*(.+)$/m.exec(doc.text);
  const sentence = m ? doc.sentenceAt(m.index) : null;
  return {
    raw: m ? m[1].trim() : null,
    signed: detectSigned(m ? m[1] : null, doc.isDraft),
    evidence: sentence ? doc.evidenceOf(sentence) : null,
  };
}

const firstIso = (text) => (text ? (findDates(text)[0] || {}).iso || null : null);

function fillDates(doc) {
  const dateMatch = /^Дата(?:\s+проекта)?\s*:\s*(.+)$/m.exec(doc.text);
  doc.date = firstIso(dateMatch && dateMatch[1]);
  doc.signDate = doc.status.signed === true ? firstIso(doc.status.raw) || doc.date : null;
  doc.effective = detectEffective(doc);
}

function fillParties(doc) {
  doc.number = doc.kind === 'contract' ? extractNumber(doc) : null;
  doc.targets = extractTargets(doc);
  doc.supplier = findParty(doc, 'Поставщик');
  doc.buyer = findParty(doc, 'Покупател[ья]');
  const sender = /^От\s*:\s*(.+)$/m.exec(doc.text);
  doc.sender = sender ? sender[1].trim() : null;
}

/**
 * Строит «скелет» документа: нормализованный текст, абзацы, предложения и функции для ссылок на цитаты (evidenceOf, sentenceAt), тип и признак проекта по заголовку.
 */
function baseModel(raw) {
  const text = normalizeText(raw.text);
  const paragraphs = splitParagraphs(text);
  const sentences = paragraphs.flatMap(splitSentences);
  const doc = { id: raw.id, name: raw.name, text, paragraphs, sentences };
  doc.evidenceOf = (s) => ({
    docId: raw.id, fileName: raw.name, paragraph: s.paragraph, line: s.line, clause: s.clause,
    quote: s.text, start: s.start, end: s.end,
  });
  doc.sentenceAt = (offset) => sentences.find((s) => offset >= s.start && offset < s.end) || null;
  doc.title = paragraphs[0] ? paragraphs[0].text : '';
  doc.kind = detectKind(doc.title, text);
  doc.isDraft = /проект/i.test(doc.title);
  return doc;
}

/**
 * Разбирает документ из базы в модель, пригодную для сверки.
 * Контракт: ничего не придумывает — если признак в тексте не найден, поле
 * остаётся null/пустым. Не бросает исключений на «чужом» тексте: такой
 * документ получает kind='unknown'.
 * @param {{id:string,name:string,text:string}} raw запись документа из базы
 * @returns {object} модель документа: тип, статус, даты, стороны, ссылки на договоры, кандидаты значений
 */
export function parseDocument(raw) {
  const doc = baseModel(raw);
  doc.status = buildStatus(doc);
  fillDates(doc);
  fillParties(doc);
  const { candidates, rejected, changed } = collectCandidates(doc);
  doc.candidates = candidates;
  doc.rejected = rejected;
  doc.unparsedChanges = doc.kind === 'amendment' ? findUnparsedChanges(doc, changed) : [];
  return doc;
}

/**
 * Краткая подпись документа для интерфейса («Договор STN-101», «ДС №1»…).
 * @param {object} doc результат parseDocument
 * @returns {string}
 */
export function docLabel(doc) {
  if (doc.kind === 'contract') return `Договор ${doc.number || doc.name}`;
  if (doc.kind === 'amendment') {
    const n = /№\s*(\d+)/.exec(doc.title);
    const base = `${doc.isDraft ? 'Проект ДС' : 'ДС'}${n ? ' №' + n[1] : ''}`;
    return doc.targets.primary[0] ? `${base} к ${doc.targets.primary[0]}` : base;
  }
  if (doc.kind === 'letter') return 'Письмо поставщика';
  return doc.name;
}
