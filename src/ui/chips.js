/**
 * chips.js — мелкие элементы разметки, общие для таблицы, ответов и списков:
 * бейдж, цитата и кнопка перехода к источнику.
 */

import { esc, icon } from './dom.js';

/**
 * Бейдж статуса.
 * @param {'ok'|'warn'|'danger'|'info'|'muted'} kind цветовая роль
 * @param {string} text подпись
 * @returns {string}
 */
export const badge = (kind, text) => `<span class="badge ${kind}">${esc(text)}</span>`;

/**
 * Цитата из документа.
 * @param {{quote:string}} ev основание значения
 * @returns {string}
 */
export const quoteHtml = (ev) => `<q class="quote">${esc(ev.quote)}</q>`;

function placeOf(ev) {
  if (ev.end <= ev.start) return '';
  return ev.clause ? `п. ${ev.clause}` : `абз. ${ev.paragraph}`;
}

/**
 * Кнопка перехода к цитате в исходном документе.
 * @param {{docId:string,fileName:string,clause:(string|null),paragraph:number,start:number,end:number}} ev основание значения
 * @returns {string}
 */
export function sourceChip(ev) {
  const place = placeOf(ev);
  return `<button class="src" data-act="open" data-doc="${esc(ev.docId)}" data-start="${ev.start}" data-end="${ev.end}" title="Открыть документ на этом месте">${icon('file', 13)}<span>${esc(ev.fileName)}</span>${place ? `<b>${esc(place)}</b>` : ''}</button>`;
}

/**
 * Ссылка на источник вместе с цитатой.
 * @param {object|null} ev основание значения
 * @returns {string} пустая строка, если основания нет
 */
export const evidenceBlock = (ev) => (ev ? `<div class="ev">${sourceChip(ev)}${quoteHtml(ev)}</div>` : '');
