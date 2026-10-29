/**
 * viewer.js — панель «исходный документ»: показывает полный текст файла по
 * абзацам и подсвечивает цитату, на которую сослался пользователь.
 */

import { esc, icon } from './dom.js';
import { splitParagraphs } from '../core/text.js';

function paragraphHtml(par, start, end) {
  const hit = end > start && start >= par.start && end <= par.end;
  const body = hit
    ? `${esc(par.text.slice(0, start - par.start))}<mark>${esc(par.text.slice(start - par.start, end - par.start))}</mark>${esc(par.text.slice(end - par.start))}`
    : esc(par.text);
  return `<p class="par${hit ? ' hit' : ''}" id="par-${par.n}"><span class="ln" title="строка ${par.line} файла">${par.n}</span><span class="tx">${body}</span></p>`;
}

/**
 * Рисует документ в панели просмотра и прокручивает к цитате.
 * @param {HTMLElement} panel контейнер #viewer
 * @param {{name:string,text:string}} doc запись документа из базы
 * @param {{start:number,end:number}} range диапазон цитаты в тексте (0,0 — без подсветки)
 * @param {{label?:string,statusLabel?:string}} info подпись и статус из сверки
 */
export function showViewer(panel, doc, range, info = {}) {
  const pars = splitParagraphs(doc.text);
  const quote = doc.text.slice(range.start, range.end);
  panel.hidden = false;
  document.body.classList.add('has-viewer');
  panel.innerHTML = `
    <header class="viewer-head">
      <div><div class="viewer-title">${icon('file', 16)}${esc(doc.name)}</div>
      <div class="viewer-sub">${esc(info.label || '')}${info.statusLabel ? ` · ${esc(info.statusLabel)}` : ''}</div></div>
      <button class="icon-btn" data-act="close-viewer" aria-label="Закрыть просмотр">${icon('x', 18)}</button>
    </header>
    ${quote ? `<div class="viewer-quote"><span>Цитата</span>${esc(quote)}</div>` : ''}
    <div class="viewer-body">${pars.map((p) => paragraphHtml(p, range.start, range.end)).join('')}</div>`;
  const mark = panel.querySelector('mark');
  if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  else panel.querySelector('.viewer-body').scrollTop = 0;
}

/**
 * Скрывает панель просмотра.
 * @param {HTMLElement} panel контейнер #viewer
 */
export function hideViewer(panel) {
  panel.hidden = true;
  panel.innerHTML = '';
  document.body.classList.remove('has-viewer');
}
