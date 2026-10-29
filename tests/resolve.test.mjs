/**
 * resolve.test.mjs — проверки сверки: эталонные ответы на учебных документах,
 * учёт статуса документов, отсутствующие значения, проверяемость цитат и
 * устойчивость к изменению данных (на встрече поле меняют и грузят новый договор).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerBefore, answerField } from '../src/core/ask.js';
import { contract, loadExamples, run } from './helpers.mjs';

const ex = loadExamples();
const base = run(ex);

test('STN-101: сумма и срок изменены подписанным ДС №1, проект ДС №2 не учитывается', () => {
  const c = contract(base, 'STN-101');
  assert.equal(c.fields.amount.value, 1380000);
  assert.equal(c.fields.deadline.value, '2026-04-30');
  assert.equal(c.fields.deadline.changed, true);
  assert.equal(c.fields.deadline.base.display, '15.04.2026');
  assert.match(c.fields.deadline.source.fileName, /02_amendment_signed/);
  const proposed = c.proposals.map((p) => `${p.field}:${p.display}`).sort();
  assert.deepEqual(proposed, ['amount:1 450 000 ₽', 'deadline:10.05.2026']);
  assert.ok(c.proposals.every((p) => p.kind === 'draft' && /не подписан/.test(p.reason)));
  assert.equal(c.level, 'ok', 'проект ДС не требует проверки');
  assert.equal(base.docs.find((d) => /06_/.test(d.name)).role, 'proposal');
});

test('STN-102: сумма — стоимость договора, а не аванс; письмо — только предложение', () => {
  const c = contract(base, 'STN-102');
  assert.equal(c.fields.amount.value, 840000);
  assert.equal(c.fields.deadline.value, '2026-03-20', 'срок оплаты 10.04 не путается со сроком поставки');
  assert.equal(c.fields.deadline.changed, false);
  assert.deepEqual(c.proposals.map((p) => [p.field, p.display, p.kind]), [['deadline', '27.03.2026', 'letter']]);
});

test('STN-103: суммы нет — «нет данных», лимит 600 000 не подставляется', () => {
  const c = contract(base, 'STN-103');
  assert.equal(c.fields.amount.status, 'nodata');
  assert.equal(c.fields.amount.value, null);
  assert.ok(c.fields.amount.notes.some((n) => /спецификац/i.test(n)));
  assert.ok(c.fields.amount.rejected.some((r) => /лимит/.test(r.reason) && /600/.test(r.display)));
  assert.equal(c.fields.penalty.status, 'nodata');
  assert.equal(c.fields.deadline.value, '2026-04-30');
});

test('неустойка извлекается с процентом и пределом', () => {
  assert.equal(contract(base, 'STN-101').fields.penalty.display, '0,1% за каждый день просрочки, не более 10%');
  assert.equal(contract(base, 'STN-102').fields.penalty.display, '0,05% за каждый день просрочки, не более 5%');
});

test('таблица содержит поставщиков и ровно три договора', () => {
  assert.equal(base.contracts.length, 3);
  assert.equal(contract(base, 'STN-101').supplier.name, 'ООО «Вектор Прибор»');
  assert.equal(contract(base, 'STN-102').supplier.name, 'ООО «Контур Электро»');
  assert.equal(contract(base, 'STN-103').supplier.name, 'ООО «ПромСнаб Сервис»');
});

test('четвёртый вопрос: раньше 01.04.2026 только STN-102, и у него есть несогласованное изменение срока', () => {
  const a = answerBefore(base, '2026-04-01');
  assert.deepEqual(a.matches, [base.contracts.find((c) => c.number === 'STN-102').docId]);
  assert.equal(a.level, 'review');
  assert.ok(a.lines.some((l) => /27\.03\.2026/.test(l.text) && /Не согласовано/.test(l.text)));
});

test('ответы на вопросы 1–3 содержат значение и цитату-источник', () => {
  const id = (n) => contract(base, n).docId;
  const q1 = answerField(base, id('STN-101'), 'deadline');
  assert.match(q1.lines[0].text, /30\.04\.2026/);
  assert.match(q1.lines[0].evidence.quote, /30\.04\.2026/);
  assert.match(answerField(base, id('STN-102'), 'amount').lines[0].text, /840 000/);
  const q3 = answerField(base, id('STN-103'), 'amount');
  assert.equal(q3.level, 'nodata');
  assert.match(q3.lines[0].text, /нет данных/);
});

test('каждая цитата дословно присутствует в исходном файле по указанным смещениям', () => {
  const quotes = [];
  for (const c of base.contracts) {
    for (const f of Object.values(c.fields)) {
      [f.evidence, f.base && f.base.evidence, ...f.history.map((h) => h.evidence), ...f.rejected.map((r) => r.evidence)].forEach((e) => e && quotes.push(e));
    }
    c.proposals.forEach((p) => quotes.push(p.evidence));
  }
  assert.ok(quotes.length > 15);
  for (const e of quotes) {
    assert.equal(ex[e.fileName].replace(/\r\n/g, '\n').slice(e.start, e.end), e.quote, `${e.fileName} п. ${e.clause || e.paragraph}`);
  }
});

test('приоритет документа не зависит от имён файлов и порядка загрузки', () => {
  const renamed = {};
  const names = ['zzz.txt', 'a.txt', 'm_final_v2.txt', 'b.txt', 'письмо.txt', 'x.txt'];
  Object.values(ex).reverse().forEach((t, i) => { renamed[names[i]] = t; });
  const r = run(renamed);
  for (const n of ['STN-101', 'STN-102', 'STN-103']) {
    for (const k of ['amount', 'deadline', 'penalty']) {
      assert.deepEqual(contract(r, n).fields[k].value, contract(base, n).fields[k].value, `${n}.${k}`);
    }
  }
});

test('на дату до вступления ДС №1 действуют условия договора', () => {
  const r = run(ex, '2026-02-20');
  const c = contract(r, 'STN-101');
  assert.equal(c.fields.amount.value, 1200000);
  assert.equal(c.fields.deadline.value, '2026-04-15');
  assert.equal(c.fields.deadline.changed, false);
});

test('подписанное ДС, вступающее в силу позже даты проверки, не применяется', () => {
  const files = { ...ex, '02_amendment_signed.txt': ex['02_amendment_signed.txt'].replace('вступает в силу 01.03.2026', 'вступает в силу 01.04.2026') };
  const c = contract(run(files), 'STN-101');
  assert.equal(c.fields.amount.value, 1200000);
  assert.equal(c.scheduled.length, 2);
});

test('ДС без даты вступления в силу — «нужна проверка», а не догадка', () => {
  const files = { ...ex, '02_amendment_signed.txt': ex['02_amendment_signed.txt'].replace(/4\. Настоящее.*\n?/, '') };
  const c = contract(run(files), 'STN-101');
  assert.equal(c.fields.amount.value, 1200000, 'не применяется без даты вступления');
  assert.equal(c.level, 'review');
  assert.ok(c.review.some((r) => /вступлени/.test(r.text)));
});

test('неподписанное ДС (статус «не подписано») не меняет условия', () => {
  const files = { ...ex, '02_amendment_signed.txt': ex['02_amendment_signed.txt'].replace('подписано обеими сторонами 01.03.2026', 'не подписано, ожидает подписи покупателя') };
  const c = contract(run(files), 'STN-101');
  assert.equal(c.fields.amount.value, 1200000);
  assert.ok(c.proposals.some((p) => p.display === '1 380 000 ₽'));
});

test('ДС с другим поставщиком не применяется', () => {
  const files = { ...ex, '02_amendment_signed.txt': ex['02_amendment_signed.txt'].replace('Вектор Прибор', 'Другой Поставщик') };
  const c = contract(run(files), 'STN-101');
  assert.equal(c.fields.amount.value, 1200000);
  assert.equal(c.level, 'review');
});

test('смена значения в договоре отражается в таблице: другой формат суммы и даты', () => {
  const edited = ex['03_contract.txt']
    .replace('840 000 (восемьсот сорок тысяч)', '910 500,50 (девятьсот десять тысяч пятьсот)')
    .replace('не позднее 20.03.2026', 'не позднее 5 апреля 2026 г.');
  const c = contract(run({ ...ex, '03_contract.txt': edited }), 'STN-102');
  assert.equal(c.fields.amount.value, 910500.5);
  assert.equal(c.fields.deadline.value, '2026-04-05');
});

test('новый договор того же формата попадает в таблицу без правки кода', () => {
  const extra = ex['01_contract.txt'].replace(/STN-101/g, 'STN-200').replace('Вектор Прибор', 'Новый Поставщик').replace('1 200 000 (один миллион двести тысяч)', '77 000 (семьдесят семь тысяч)');
  const r = run({ ...ex, 'new.txt': extra });
  assert.equal(r.contracts.length, 4);
  assert.equal(contract(r, 'STN-200').fields.amount.value, 77000);
  assert.equal(contract(r, 'STN-200').supplier.name, 'ООО «Новый Поставщик»');
});

test('расхождение суммы цифрами и прописью — «нужна проверка»', () => {
  const edited = ex['03_contract.txt'].replace('(восемьсот сорок тысяч)', '(восемьсот тысяч)');
  const c = contract(run({ ...ex, '03_contract.txt': edited }), 'STN-102');
  assert.equal(c.fields.amount.status, 'review');
  assert.equal(c.fields.amount.value, 840000);
  assert.match(c.fields.amount.warnings[0], /прописью/);
});

test('два разных значения в договоре — конфликт, значение не выбирается', () => {
  const edited = ex['03_contract.txt'].replace('3.2. Оплата', '3.3. Поставщик обязуется поставить комплектующие не позднее 25.03.2026.\n3.2. Оплата');
  const c = contract(run({ ...ex, '03_contract.txt': edited }), 'STN-102');
  assert.equal(c.fields.deadline.status, 'review');
  assert.equal(c.fields.deadline.value, null);
  assert.equal(c.fields.deadline.candidates.length, 2);
});

test('документ неизвестного вида и пустой файл не ломают сверку', () => {
  const r = run({ ...ex, 'junk.txt': 'просто заметка', 'empty.txt': '' });
  assert.equal(r.contracts.length, 3);
  assert.equal(r.docs.find((d) => d.name === 'junk.txt').kind, 'unknown');
});

test('письмо о неизвестном договоре отмечается как непривязанное', () => {
  const orphan = ex['05_supplier_email.txt'].replace(/STN-102/g, 'STN-999');
  const d = run({ ...ex, '05_supplier_email.txt': orphan }).docs.find((x) => x.name === '05_supplier_email.txt');
  assert.equal(d.role, 'unlinked');
  assert.equal(d.level, 'review');
  assert.match(d.note, /STN-999/);
});
