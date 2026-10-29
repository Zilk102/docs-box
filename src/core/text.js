/**
 * text.js — низкоуровневые функции разбора текста: абзацы, предложения, даты,
 * денежные суммы, проценты и «сумма прописью».
 *
 * Модуль чистый (без DOM и без обращения к сети), поэтому им пользуются и
 * браузерный интерфейс, и Node-тесты. Все смещения (start/end) — индексы в
 * исходной строке документа, на них строится «переход к цитате».
 */

const MONTHS = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
};

const NBSP = ' ';

/**
 * Приводит загруженный текст к единому виду: убирает BOM и переводы строк
 * Windows, чтобы смещения цитат не зависели от платформы автора файла.
 * @param {string} text исходный текст файла
 * @returns {string} нормализованный текст
 */
export function normalizeText(text) {
  return String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/**
 * Делит текст на непустые строки-абзацы с номерами и смещениями.
 * @param {string} text нормализованный текст документа
 * @returns {{n:number,line:number,start:number,end:number,text:string}[]}
 *   n — порядковый номер абзаца (с 1), line — номер строки в файле
 */
export function splitParagraphs(text) {
  const out = [];
  let offset = 0;
  let n = 0;
  let line = 0;
  for (const raw of text.split('\n')) {
    line++;
    const trimmed = raw.trim();
    if (trimmed) {
      n++;
      const lead = raw.length - raw.trimStart().length;
      out.push({ n, line, start: offset + lead, end: offset + lead + trimmed.length, text: trimmed });
    }
    offset += raw.length + 1;
  }
  return out;
}

const CLAUSE_RE = /^(\d{1,3}(?:\.\d{1,3})*)\.?\s+/;
const ABBREVIATION_RE = /(?:^|[\s(«"])(?:п|пп|ст|гл|рис|руб|коп|г|гг|тыс|млн|млрд|им|ул|др|пр|т\.д|т\.п|т\.е|№)$/i;
const SENTENCE_END_RE = /([.!?…]+["»”)]*)\s+(?=[«"“(]?[А-ЯЁA-Z])/g;

/**
 * Делит абзац на предложения, отделяя номер пункта («2.1.») от текста.
 * Предложение — минимальная единица цитирования: именно оно показывается
 * пользователю как основание значения.
 * @param {{n:number,line:number,start:number,text:string}} par абзац из splitParagraphs
 * @returns {{text:string,start:number,end:number,clause:(string|null),paragraph:number,line:number}[]}
 */
export function splitSentences(par) {
  let body = par.text;
  let base = par.start;
  let clause = null;
  const clauseMatch = CLAUSE_RE.exec(body);
  if (clauseMatch) {
    clause = clauseMatch[1];
    body = body.slice(clauseMatch[0].length);
    base += clauseMatch[0].length;
  }
  const out = [];
  const push = (from, to) => {
    if (to > from) out.push({ text: body.slice(from, to), start: base + from, end: base + to, clause, paragraph: par.n, line: par.line });
  };
  let from = 0;
  for (const m of body.matchAll(SENTENCE_END_RE)) {
    if (m[1] === '.' && ABBREVIATION_RE.test(body.slice(from, m.index))) continue;
    push(from, m.index + m[1].length);
    from = m.index + m[0].length;
  }
  push(from, body.length);
  return out;
}

function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toIso(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Находит даты вида 15.04.2026 и «15 апреля 2026 г.».
 * Несуществующие даты (31.02.2026) отбрасываются, а не «исправляются».
 * @param {string} s фрагмент текста
 * @returns {{iso:string,index:number,length:number,raw:string}[]} по возрастанию позиции
 */
export function findDates(s) {
  const found = [];
  const add = (m, y, mo, d) => {
    if (isRealDate(+y, +mo, +d)) found.push({ iso: toIso(+y, +mo, +d), index: m.index, length: m[0].length, raw: m[0] });
  };
  for (const m of s.matchAll(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/g)) add(m, m[3], m[2], m[1]);
  const names = Object.keys(MONTHS).join('|');
  const textual = new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${names})\\s+(\\d{4})(?:\\s*г(?:ода|\\.)?(?![а-яё]))?`, 'giu');
  for (const m of s.matchAll(textual)) add(m, m[3], MONTHS[m[2].toLowerCase()], m[1]);
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Форматирует ISO-дату как ДД.ММ.ГГГГ.
 * @param {string} iso дата YYYY-MM-DD
 * @returns {string}
 */
export function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Форматирует сумму в рублях с неразрывными пробелами между разрядами.
 * @param {number} n сумма
 * @returns {string} например «1 200 000 ₽»
 */
export function formatRub(n) {
  const fixed = Number.isInteger(n) ? String(n) : n.toFixed(2);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${grouped}${frac ? ',' + frac : ''}${NBSP}₽`;
}

/**
 * Форматирует число процентов по-русски (запятая как разделитель).
 * @param {number} n значение
 * @returns {string} например «0,05%»
 */
export function fmtPercent(n) {
  return `${String(n).replace('.', ',')}%`;
}

const WORDS = {
  ноль: 0, один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7,
  восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14,
  пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
};
const SCALES = [[/^тысяч/, 1e3], [/^миллион/, 1e6], [/^миллиард/, 1e9]];

function scaleOf(word) {
  const hit = SCALES.find(([re]) => re.test(word));
  return hit ? hit[1] : null;
}

/**
 * Переводит «один миллион двести тысяч» в число. Нужен только для
 * перекрёстной проверки «цифрами/прописью».
 * @param {string} words фраза на русском (хвост «рублей/копеек» игнорируется)
 * @returns {number|null} число или null, если встретилось неизвестное слово
 */
export function ruWordsToNumber(words) {
  const tokens = words.toLowerCase().match(/[а-яё]+/g) || [];
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of tokens) {
    if (/^(рубл|копе)/.test(w)) break;
    const scale = scaleOf(w);
    if (scale) {
      total += (current || 1) * scale;
      current = 0;
    } else if (w in WORDS) current += WORDS[w];
    else return null;
    seen = true;
  }
  return seen ? total + current : null;
}

const MONEY_RE = new RegExp(
  String.raw`(?<![\d.,])(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?!\d)\s*` +
  String.raw`(?:\(([^)]{2,200})\)\s*)?(?:руб(?:лей|ля|ль|\.)?|₽|р\.)(?:\s*\(([^)]{2,200})\))?`,
  'giu',
);

/**
 * Находит суммы в рублях («1 200 000 (прописью) рублей», «840000 руб.»).
 * Если рядом есть сумма прописью, она сверяется с цифрами.
 * @param {string} s фрагмент текста
 * @returns {{value:number,index:number,length:number,raw:string,words:(string|null),wordsValue:(number|null),wordsMismatch:boolean}[]}
 */
export function findMoney(s) {
  const out = [];
  for (const m of s.matchAll(MONEY_RE)) {
    const value = Number(m[1].replace(/\D/g, '') + (m[2] ? '.' + m[2] : ''));
    const words = m[3] || m[4] || null;
    const wordsValue = words ? ruWordsToNumber(words) : null;
    out.push({
      value, index: m.index, length: m[0].length, raw: m[0], words, wordsValue,
      wordsMismatch: wordsValue !== null && wordsValue !== Math.trunc(value),
    });
  }
  return out;
}

/**
 * Находит проценты («0,1%», «5 %»).
 * @param {string} s фрагмент текста
 * @returns {{value:number,index:number,length:number}[]}
 */
export function findPercents(s) {
  return [...s.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*%/g)].map((m) => ({
    value: Number(m[1].replace(',', '.')), index: m.index, length: m[0].length,
  }));
}
