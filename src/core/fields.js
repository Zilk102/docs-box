/**
 * fields.js — реестр извлекаемых условий договора (сумма, срок поставки,
 * неустойка).
 *
 * Каждое поле описывает, как распознать значение в ОДНОМ предложении и как его
 * показать. Остальной код (разбор, разрешение допсоглашений, вопросы, таблица)
 * универсален и работает с любым полем из реестра — чтобы добавить новое
 * условие, достаточно описать его здесь.
 */

import { findDates, findMoney, findPercents, fmtDate, fmtPercent, formatRub } from './text.js';

const NOT_LETTER_BEFORE = '(?<![а-яё])';
const NOT_LETTER_AFTER = '(?![а-яё])';
const rejected = (reason, display = null) => ({ rejected: { reason, display } });

const AMOUNT_EXCLUSIONS = [
  [/аванс|предоплат/i, 'аванс — часть общей стоимости, а не итоговая сумма'],
  [/лимит|бюджет/i, 'внутренний лимит покупателя — это не согласованная стоимость договора'],
  [new RegExp(`неустойк|штраф|${NOT_LETTER_BEFORE}пени${NOT_LETTER_AFTER}`, 'i'), 'санкция, а не стоимость'],
];
const AMOUNT_KEYWORD = new RegExp(`стоимост|${NOT_LETTER_BEFORE}цен[аыуе]${NOT_LETTER_AFTER}|сумм[аы]\\s+(?:договора|контракта|поставки)`, 'i');
const AMOUNT_TOTAL = /общ\S*\s+стоимост|итогов|цена\s+(?:договора|контракта)/i;

/**
 * Выбирает из нескольких сумм в предложении ту, что является новым значением:
 * допустима только формула «с X на Y» (две суммы, между ними «на/до»).
 */
function pickMoney(text, money) {
  if (money.length === 1) return { picked: money[0] };
  const between = money.length === 2 ? text.slice(money[0].index + money[0].length, money[1].index).trim() : '';
  if (!/^(?:на|до)$/i.test(between)) return { reason: 'в предложении несколько сумм — значение неоднозначно' };
  return { picked: money[1] };
}

/**
 * Распознаёт итоговую стоимость договора в предложении. Аванс, лимит бюджета и санкции отвергаются с причиной — это не стоимость; несколько сумм без явного «с X на Y» считаются неоднозначными.
 */
function extractAmount(sentence) {
  const money = findMoney(sentence.text);
  if (!money.length) return null;
  const display = formatRub(money[0].value);
  const excluded = AMOUNT_EXCLUSIONS.find(([re]) => re.test(sentence.text));
  if (excluded) return rejected(excluded[1], display);
  if (!AMOUNT_KEYWORD.test(sentence.text)) return rejected('сумма не связана со стоимостью договора', display);
  const { picked, reason } = pickMoney(sentence.text, money);
  if (!picked) return rejected(reason, display);
  const warnings = picked.wordsMismatch
    ? [`Сумма цифрами (${formatRub(picked.value)}) не совпадает с суммой прописью (${formatRub(picked.wordsValue)})`]
    : [];
  return { value: picked.value, display: formatRub(picked.value), priority: AMOUNT_TOTAL.test(sentence.text) ? 2 : 1, warnings };
}

/**
 * Распознаёт срок поставки: нужна дата и слово «поставка/поставить». Срок оплаты отвергается; в формуле «с X на Y» берётся новая дата.
 */
function extractDeadline(sentence) {
  const dates = findDates(sentence.text);
  if (!dates.length || !/постав(?!щик)/i.test(sentence.text)) return null;
  if (/оплат|платеж/i.test(sentence.text)) return rejected('это срок оплаты, а не поставки', fmtDate(dates[0].iso));
  let picked = dates[0];
  if (dates.length > 1) {
    const between = sentence.text.slice(dates[0].index + dates[0].length, dates[1].index).trim();
    if (dates.length > 2 || !/^(?:на|до|по)$/i.test(between)) return rejected('в предложении несколько дат — значение неоднозначно', fmtDate(dates[0].iso));
    picked = dates[1];
  }
  return { value: picked.iso, display: fmtDate(picked.iso), priority: 1, warnings: [] };
}

const PENALTY_RE = new RegExp(`неустойк|${NOT_LETTER_BEFORE}пени${NOT_LETTER_AFTER}`, 'i');

/**
 * Распознаёт ставку неустойки в процентах и предельный размер («не более N%»). Без процентов значения нет — предложение не принимается.
 */
function penaltyDisplay({ rate, cap, perDay }) {
  const parts = [];
  if (rate !== null) parts.push(`${fmtPercent(rate)}${perDay ? ' за каждый день просрочки' : ''}`);
  if (cap !== null) parts.push(`не более ${fmtPercent(cap)}`);
  return parts.join(', ');
}

/**
 * Распознаёт ставку неустойки в процентах и предельный размер («не более N%»). Без процентов значения нет — предложение не принимается.
 */
function extractPenalty(sentence) {
  if (!PENALTY_RE.test(sentence.text)) return null;
  const capMatch = /не\s+более\s+(\d+(?:[.,]\d+)?)\s*%/i.exec(sentence.text);
  const rate = findPercents(sentence.text).find((p) => !capMatch || p.index < capMatch.index);
  const value = {
    rate: rate ? rate.value : null,
    cap: capMatch ? Number(capMatch[1].replace(',', '.')) : null,
    perDay: /за\s+каждый\s+день|в\s+день|ежедневно/i.test(sentence.text),
  };
  if (value.rate === null && value.cap === null) return null;
  return { value, display: penaltyDisplay(value), priority: 1, warnings: [] };
}

function findSentence(doc, test) {
  return doc.sentences.find((s) => test.test(s.text)) || null;
}

/**
 * Реестр полей. Контракт extract: вернуть null (предложение не про это поле),
 * {rejected:{reason,display}} (похоже на значение, но принимать нельзя) или
 * {value, display, priority, warnings}.
 * nodataHint объясняет, почему значения нет, если это видно из текста договора.
 */
export const FIELDS = [
  {
    key: 'amount',
    label: 'Сумма',
    question: 'Сумма договора',
    equals: (a, b) => a === b,
    extract: extractAmount,
    nodataHint(doc) {
      const s = findSentence(doc, /(?=.*стоимост)(?=.*(?:спецификац|приложени))/i);
      return s && { text: 'Стоимость определяется внешним документом (спецификация/приложение), которого нет среди загруженных', sentence: s };
    },
  },
  {
    key: 'deadline',
    label: 'Срок поставки',
    question: 'Срок поставки',
    equals: (a, b) => a === b,
    extract: extractDeadline,
    nodataHint: () => null,
  },
  {
    key: 'penalty',
    label: 'Неустойка',
    question: 'Неустойка за просрочку',
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    extract: extractPenalty,
    nodataHint(doc) {
      const s = findSentence(doc, /(?=.*неустойк)(?=.*(?:не\s+установлен|не\s+предусмотрен|отсутству))/i);
      return s && { text: 'Договор прямо указывает, что ставка не установлена', sentence: s };
    },
  },
];

/**
 * Возвращает описание поля по ключу.
 * @param {string} key ключ из FIELDS
 * @returns {object} поле реестра
 */
export function fieldByKey(key) {
  return FIELDS.find((f) => f.key === key);
}
