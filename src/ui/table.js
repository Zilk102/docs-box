/**
 * table.js — таблица договоров: ячейки значений, строки «не согласовано» и
 * «нужна проверка», фильтрация по статусу и поиску.
 */

import { esc } from './dom.js';
import { badge, evidenceBlock, quoteHtml, sourceChip } from './chips.js';

const FIELD_LABELS = { amount: 'Сумма', deadline: 'Срок поставки', penalty: 'Неустойка' };

const FILTERS = {
  all: () => true,
  review: (c) => c.level === 'review',
  unagreed: (c) => c.proposals.length > 0,
};

/**
 * Отбирает договоры по фильтру статуса и строке поиска.
 * @param {object[]} contracts договоры из analyze
 * @param {{filter:string,query:string}} view выбранный фильтр и текст поиска
 * @returns {object[]}
 */
export function filterContracts(contracts, view) {
  const query = view.query.trim().toLowerCase();
  const matches = (c) => [c.number, c.fileName, c.supplier && c.supplier.name].some((s) => (s || '').toLowerCase().includes(query));
  return contracts.filter((c) => (FILTERS[view.filter] || FILTERS.all)(c) && matches(c));
}

function noDataCell(f) {
  const notes = f.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('');
  const rejected = f.rejected.map((r) => `<div class="rej"><span>Не принято${r.display ? `: <b>${esc(r.display)}</b>` : ''} — ${esc(r.reason)}</span>${sourceChip(r.evidence)}</div>`).join('');
  return `${badge('muted', 'нет данных')}${notes}${evidenceBlock(f.evidence)}${rejected}`;
}

function conflictCell(f) {
  const items = f.candidates.map((c) => `<div class="cand"><b>${esc(c.display)}</b>${sourceChip(c.evidence)}</div>`).join('');
  return `${badge('danger', 'нужна проверка')}<p class="note">${esc(f.notes.join('; '))}</p>${items}`;
}

function changeNote(f) {
  if (!f.changed) return '';
  if (!f.base) return '<div class="was">в договоре значения не было</div>';
  return `<div class="was">в договоре было <s>${esc(f.base.display)}</s> ${sourceChip(f.base.evidence)}</div>`;
}

function valueCell(f) {
  const flags = [];
  if (f.status === 'review') flags.push(badge('danger', 'проверьте'));
  if (f.changed) flags.push(badge('info', `изменено: ${f.source.label}`));
  const warnings = [...f.warnings, ...f.notes].map((w) => `<p class="note bad">${esc(w)}</p>`).join('');
  return `<div class="val">${esc(f.display)}</div>${flags.join(' ')}${warnings}${changeNote(f)}${evidenceBlock(f.evidence)}`;
}

function cellKind(f) {
  if (f.status === 'nodata') return noDataCell;
  return f.display ? valueCell : conflictCell;
}

const fieldCell = (f) => cellKind(f)(f);

const reviewRow = (r) => `<div class="side danger">${badge('danger', 'нужна проверка')}<span>${esc(r.text)}</span>${r.evidence ? sourceChip(r.evidence) : ''}</div>`;

const changeRow = (p, kind, title) => `<div class="side ${kind}">${badge(kind, title)}<span><b>${esc(FIELD_LABELS[p.field] || p.field)}</b> → ${esc(p.display)} · ${esc(p.doc.label)} <em>(${esc(p.reason)})</em></span>${sourceChip(p.evidence)}${kind === 'warn' ? quoteHtml(p.evidence) : ''}</div>`;

function sideRows(c) {
  return [
    ...c.review.map(reviewRow),
    ...c.proposals.map((p) => changeRow(p, 'warn', 'не согласовано, не учтено')),
    ...c.scheduled.map((p) => changeRow(p, 'info', 'вступит в силу позже')),
  ].join('');
}

function partyCell(p) {
  return p ? `<div class="val sm">${esc(p.name)}</div>${p.evidence ? sourceChip(p.evidence) : ''}` : badge('muted', 'нет данных');
}

/**
 * Строка таблицы по одному договору плюс строка с несогласованными изменениями и пунктами для проверки.
 */
function contractRow(c, dateText) {
  const side = sideRows(c);
  const file = { docId: c.docId, fileName: c.fileName, paragraph: 1, start: 0, end: 0 };
  const status = c.level === 'review' ? badge('danger', 'нужна проверка') : badge('ok', 'сверено');
  return `<tr class="${c.level === 'review' ? 'is-review' : ''}">
    <th scope="row" data-label="Договор"><div class="num">${esc(c.number || 'без номера')}</div>${status}${sourceChip(file)}</th>
    <td data-label="Поставщик">${partyCell(c.supplier)}</td>
    <td data-label="Сумма">${fieldCell(c.fields.amount)}</td>
    <td data-label="Срок поставки на ${esc(dateText)}">${fieldCell(c.fields.deadline)}</td>
    <td data-label="Неустойка">${fieldCell(c.fields.penalty)}</td>
  </tr>${side ? `<tr class="sub"><td colspan="5">${side}</td></tr>` : ''}`;
}

/**
 * Таблица договоров с учётом фильтра и поиска.
 * @param {{contracts:object[]}} analysis результат analyze
 * @param {string} dateText дата проверки ДД.ММ.ГГГГ
 * @param {{filter:string,query:string}} view фильтр и поиск
 * @returns {string}
 */
export function contractsTable(analysis, dateText, view) {
  if (!analysis.contracts.length) return '<div class="empty">Среди загруженных файлов нет договоров.</div>';
  const rows = filterContracts(analysis.contracts, view);
  if (!rows.length) return '<div class="empty">Ничего не найдено. Измените фильтр или строку поиска.</div>';
  return `<div class="tablewrap"><table class="grid">
    <thead><tr><th>Договор</th><th>Поставщик</th><th>Сумма</th><th>Срок поставки на ${esc(dateText)}</th><th>Неустойка</th></tr></thead>
    <tbody>${rows.map((c) => contractRow(c, dateText)).join('')}</tbody></table></div>`;
}
