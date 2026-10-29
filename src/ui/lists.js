/**
 * lists.js — разметка сводки, ответов на вопросы и списка файлов базы.
 */

import { esc, icon } from './dom.js';
import { badge, quoteHtml, sourceChip } from './chips.js';

const KIND = { contract: 'Договор', amendment: 'Допсоглашение', letter: 'Письмо', unknown: 'Не распознан' };
const ROLE = {
  contract: ['ok', 'В таблице'],
  applied: ['info', 'Применено'],
  proposal: ['warn', 'Не согласовано'],
  scheduled: ['info', 'Вступит позже'],
  review: ['danger', 'Нужна проверка'],
  unlinked: ['danger', 'Не привязан'],
};
const ANSWER_KIND = { ok: 'ok', review: 'warn', nodata: 'muted' };

/**
 * Кнопки-счётчики над таблицей: клик включает фильтр.
 * @param {{contracts:object[]}} analysis результат analyze
 * @param {string} active выбранный фильтр
 * @returns {string}
 */
export function statsHtml(analysis, active) {
  const list = analysis.contracts;
  const items = [
    ['all', 'Договоров', list.length],
    ['review', 'Нужна проверка', list.filter((c) => c.level === 'review').length],
    ['unagreed', 'Есть не согласованное', list.filter((c) => c.proposals.length).length],
  ];
  return items.map(([id, label, n]) => `<button class="stat ${id}" data-act="filter" data-filter="${id}" aria-pressed="${id === active}"><b>${n}</b><span>${label}</span></button>`).join('');
}

const answerLine = (l, i) => `<li class="${i === 0 ? 'lead' : ''}"><span>${esc(l.text)}</span>${l.evidence ? sourceChip(l.evidence) : ''}${l.evidence && i === 0 ? quoteHtml(l.evidence) : ''}</li>`;

/**
 * Блок ответа на вопрос.
 * @param {{level:string,title:string,lines:object[]}|null} answer результат answerField/answerBefore
 * @returns {string}
 */
export function answerHtml(answer) {
  if (!answer || !answer.lines.length) return '<p class="hint">Выберите договор.</p>';
  const kind = ANSWER_KIND[answer.level] || 'muted';
  return `<div class="answer ${kind}"><h4>${esc(answer.title)}</h4><ul>${answer.lines.map(answerLine).join('')}</ul></div>`;
}

function docMeta(rec) {
  if (!rec) return '';
  const when = new Date(rec.addedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  return `${esc(rec.addedBy || 'аноним')} · ${esc(when)}`;
}

/**
 * Строка списка файлов: имя, вид, роль в сверке, примечание и кто и когда загрузил.
 */
function docRow(d, rec) {
  const [kind, roleText] = ROLE[d.role] || ROLE.unlinked;
  const link = d.linkedTo && d.kind !== 'contract' ? `<span class="muted">→ ${esc(d.linkedTo)}</span>` : '';
  const note = d.note ? ` — ${esc(d.note)}` : '';
  return `<li class="doc ${d.level === 'review' ? 'is-review' : ''}">
    <div class="doc-main"><button class="doc-name" data-act="open" data-doc="${esc(d.id)}" data-start="0" data-end="0">${icon('file', 15)}${esc(d.name)}</button>
      <div class="doc-tags">${badge('muted', KIND[d.kind])} <span class="doc-label">${esc(d.label)}</span> ${link} ${badge(kind, roleText)}</div>
      <div class="doc-note">${esc(d.statusLabel)}${note}</div></div>
    <div class="doc-meta">${docMeta(rec)}<button class="icon-btn" data-act="remove" data-doc="${esc(d.id)}" title="Удалить из общей базы" aria-label="Удалить ${esc(d.name)} из общей базы">${icon('trash', 15)}</button></div>
  </li>`;
}

/**
 * Список файлов базы: вид, статус, привязка к договору и роль в сверке.
 * @param {object[]} docs analysis.docs
 * @param {Map<string,object>} records записи базы по id
 * @returns {string}
 */
export const documentsList = (docs, records) => docs.map((d) => docRow(d, records.get(d.id))).join('');
