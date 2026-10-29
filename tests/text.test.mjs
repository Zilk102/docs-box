/**
 * text.test.mjs — проверки низкоуровневого разбора: даты, суммы, сумма
 * прописью, предложения и точность смещений цитат.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDates, findMoney, formatRub, normalizeText, ruWordsToNumber, splitParagraphs, splitSentences } from '../src/core/text.js';

test('даты: числовые и словесные, несуществующие отбрасываются', () => {
  assert.deepEqual(findDates('не позднее 15.04.2026 и 3 мая 2026 г.').map((d) => d.iso), ['2026-04-15', '2026-05-03']);
  assert.deepEqual(findDates('31.02.2026'), []);
  assert.deepEqual(findDates('срок 5.3.2026').map((d) => d.iso), ['2026-03-05']);
});

test('суммы: пробельные разряды, десятичные, сумма прописью', () => {
  const [a] = findMoney('составляет 1 200 000 (один миллион двести тысяч) рублей, включая НДС');
  assert.equal(a.value, 1200000);
  assert.equal(a.wordsValue, 1200000);
  assert.equal(a.wordsMismatch, false);
  assert.equal(findMoney('840000 руб.')[0].value, 840000);
  assert.equal(findMoney('2 500 000,50 ₽')[0].value, 2500000.5);
  assert.equal(findMoney('в 2026 году').length, 0);
});

test('сумма цифрами и прописью расходятся — это фиксируется', () => {
  const [m] = findMoney('1 380 000 (один миллион триста тысяч) рублей');
  assert.equal(m.wordsMismatch, true);
  assert.equal(m.wordsValue, 1300000);
});

test('сумма прописью: разные формы числительных', () => {
  assert.equal(ruWordsToNumber('восемьсот сорок тысяч'), 840000);
  assert.equal(ruWordsToNumber('тысяча двести'), 1200);
  assert.equal(ruWordsToNumber('две тысячи пятьсот рублей 00 копеек'), 2500);
  assert.equal(ruWordsToNumber('что-то непонятное'), null);
});

test('форматирование рублей', () => {
  assert.equal(formatRub(1200000), '1 200 000 ₽');
  assert.equal(formatRub(10.5), '10,50 ₽');
});

test('предложения: номер пункта отделяется, даты и «п. 3.1» не рвут предложение', () => {
  const text = '3.2. Оплата не позднее 10.04.2026. Этот срок — срок оплаты, см. п. 3.1 договора.';
  const [par] = splitParagraphs(text);
  const sentences = splitSentences(par);
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0].clause, '3.2');
  assert.equal(sentences[0].text, 'Оплата не позднее 10.04.2026.');
  for (const s of sentences) assert.equal(text.slice(s.start, s.end), s.text, 'смещения указывают ровно на цитату');
});

test('смещения цитат корректны при CRLF и BOM после нормализации', () => {
  const raw = '﻿ДОГОВОР\r\n\r\n2.1. Сумма 5 руб. всего.\r\n';
  const text = normalizeText(raw);
  const sentences = splitParagraphs(text).flatMap(splitSentences);
  for (const s of sentences) assert.equal(text.slice(s.start, s.end), s.text);
});
