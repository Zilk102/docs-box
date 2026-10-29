/**
 * render.js — превращает результат сверки в HTML: таблица договоров, ответы
 * на вопросы, список документов. Чистые функции «данные → строка»; события
 * навешивает app.js через data-act.
 */

import { esc, icon } from './dom.js';

const KIND = { contract: 'Договор', amendment: 'Допсоглашение', letter: 'Письмо', unknown: 'Не распознан' };
const ROLE = {
  contract: ['ok', 'Основа таблицы'],
  applied: ['info', 'Применено'],
  proposal: ['warn', 'Не согласовано'],
  scheduled: ['info', 'Вступит позже'],
  review: ['danger', 'Нужна проверка'],
  unlinked: ['danger', 'Не привязан'],
};

/**
 * Кнопка перехода к цитате в исходном документе.
 * @param {object} ev evidence {docId,fileName,clause,paragraph,start,end}
 * @returns {string}
 */
export function sourceChip(ev) {
  const where = ev.end <= ev.start ? '' : ev.clause ? `п. ${ev.clause}` : `абз. ${ev.paragraph}`;
  return `<button class="src" data-act="open" data-doc="${esc(ev.docId)}" data-start="${ev.start}" data-end="${ev.end}" title="Открыть документ на этом месте">${icon('file', 13)}<span>${esc(ev.fileName)}</span>${where ? `<b>${esc(where)}</b>` : ''}</button>`;
}

const quote = (ev) => `<q class="quote">${esc(ev.quote)}</q>`;
const badge = (kind, text) => `<span class="badge ${kind}">${esc(text)}</span>`;

function evidenceBlock(ev) {
  return ev ? `<div class="ev">${sourceChip(ev)}${quote(ev)}</div>` : '';
}

function nodataCell(f) {
  const notes = f.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('');
  const rejected = f.rejected.map((r) => `<div class="rej"><span>Не принято${r.display ? `: <b>${esc(r.display)}</b>` : ''} — ${esc(r.reason)}</span>${sourceChip(r.evidence)}</div>`).join('');
  return `${badge('muted', 'нет данных')}${notes}${f.evidence ? evidenceBlock(f.evidence) : ''}${rejected}`;
}

function conflictCell(f) {
  const items = f.candidates.map((c) => `<div class="cand"><b>${esc(c.display)}</b>${sourceChip(c.evidence)}</div>`).join('');
  return `${badge('danger', 'нужна проверка')}<p class="note">${esc(f.notes.join('; '))}</p>${items}`;
}

/**
 * Ячейка со значением: сумма/срок, бейджи «изменено/проверьте», что было в договоре, предупреждения и цитата-источник.
 */
function valueCell(f) {
  const flags = [];
  if (f.status === 'review') flags.push(badge('danger', 'проверьте'));
  if (f.changed) flags.push(badge('info', `изменено: ${f.source.label}`));
  const was = f.changed && f.base
    ? `<div class="was">в договоре было <s>${esc(f.base.display)}</s> ${sourceChip(f.base.evidence)}</div>`
    : f.changed ? '<div class="was">в договоре значения не было</div>' : '';
  const warn = [...f.warnings, ...f.notes].map((w) => `<p class="note bad">${esc(w)}</p>`).join('');
  return `<div class="val">${esc(f.display)}</div>${flags.join(' ')}${warn}${was}${evidenceBlock(f.evidence)}`;
}

/**
 * HTML ячейки таблицы для одного условия договора.
 * @param {object} f результат resolveField
 * @returns {string}
 */
export function fieldCell(f) {
  if (f.status === 'nodata') return nodataCell(f);
  return f.display ? valueCell(f) : conflictCell(f);
}

/**
 * Строки под договором: пункты для проверки, несогласованные предложения (письма, проекты) и документы, которые вступят в силу позже.
 */
function sideRows(c) {
  const rows = [];
  for (const r of c.review) rows.push(`<div class="side danger">${badge('danger', 'нужна проверка')}<span>${esc(r.text)}</span>${r.evidence ? sourceChip(r.evidence) : ''}</div>`);
  for (const p of c.proposals) {
    rows.push(`<div class="side warn">${badge('warn', 'не согласовано, не учтено')}<span><b>${esc(p.label || labelOf(p))}</b> → ${esc(p.display)} · ${esc(p.doc.label)} <em>(${esc(p.reason)})</em></span>${sourceChip(p.evidence)}${quote(p.evidence)}</div>`);
  }
  for (const p of c.scheduled) {
    rows.push(`<div class="side info">${badge('info', 'вступит в силу позже')}<span><b>${esc(labelOf(p))}</b> → ${esc(p.display)} · ${esc(p.doc.label)} <em>(${esc(p.reason)})</em></span>${sourceChip(p.evidence)}</div>`);
  }
  return rows.join('');
}

const FIELD_LABELS = { amount: 'Сумма', deadline: 'Срок поставки', penalty: 'Неустойка' };
const labelOf = (p) => FIELD_LABELS[p.field] || p.field;

function partyCell(p) {
  return p ? `<div class="val sm">${esc(p.name)}</div>${p.evidence ? sourceChip(p.evidence) : ''}` : badge('muted', 'нет данных');
}

/**
 * Таблица по договорам: номер, поставщик, сумма, срок, неустойка + строки
 * «не согласовано / нужна проверка» под каждым договором.
 * @param {{checkDate:string,contracts:object[]}} analysis результат analyze
 * @param {string} dateText дата проверки в виде ДД.ММ.ГГГГ
 * @returns {string}
 */
export function contractsTable(analysis, dateText) {
  if (!analysis.contracts.length) {
    return '<div class="empty">В базе нет ни одного договора. Загрузите TXT-файлы договоров — таблица построится автоматически.</div>';
  }
  const rows = analysis.contracts.map((c) => {
    const side = sideRows(c);
    return `<tr class="${c.level === 'review' ? 'is-review' : ''}">
      <th scope="row" data-label="Договор"><div class="num">${esc(c.number || 'без номера')}</div>${c.level === 'review' ? badge('danger', 'нужна проверка') : badge('ok', 'сверено')}${sourceChip({ docId: c.docId, fileName: c.fileName, paragraph: 1, start: 0, end: 0 })}</th>
      <td data-label="Поставщик">${partyCell(c.supplier)}</td>
      <td data-label="Сумма">${fieldCell(c.fields.amount)}</td>
      <td data-label="Срок поставки на ${esc(dateText)}">${fieldCell(c.fields.deadline)}</td>
      <td data-label="Неустойка">${fieldCell(c.fields.penalty)}</td>
    </tr>${side ? `<tr class="sub"><td colspan="5">${side}</td></tr>` : ''}`;
  }).join('');
  return `<div class="tablewrap"><table class="grid">
    <thead><tr><th>Договор</th><th>Поставщик</th><th>Сумма, ₽</th><th>Срок поставки на ${esc(dateText)}</th><th>Неустойка</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

/**
 * HTML блока ответа на вопрос.
 * @param {{level:string,title:string,lines:{text:string,evidence:object|null}[]}|null} answer результат answerField/answerBefore
 * @returns {string}
 */
export function answerHtml(answer) {
  if (!answer || !answer.lines.length) return '<p class="hint">Выберите договор — ответ появится здесь, с цитатой и ссылкой на документ.</p>';
  const lines = answer.lines.map((l, i) => `<li class="${i === 0 ? 'lead' : ''}"><span>${esc(l.text)}</span>${l.evidence ? sourceChip(l.evidence) : ''}${l.evidence && i === 0 ? quote(l.evidence) : ''}</li>`).join('');
  const kind = { ok: 'ok', review: 'warn', nodata: 'muted' }[answer.level] || 'muted';
  return `<div class="answer ${kind}"><h4>${esc(answer.title)}</h4><ul>${lines}</ul></div>`;
}

/**
 * Список документов базы: вид, статус, привязка к договору и роль в сверке.
 * @param {object[]} docs analysis.docs
 * @param {Map<string,object>} records записи базы по id (автор, время)
 * @returns {string}
 */
export function documentsList(docs, records) {
  if (!docs.length) return '';
  return docs.map((d) => {
    const [kind, roleText] = ROLE[d.role] || ROLE.unlinked;
    const rec = records.get(d.id);
    const meta = rec ? `${esc(rec.addedBy || 'кто-то')} · ${esc(new Date(rec.addedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }))}` : '';
    const link = d.linkedTo && d.kind !== 'contract' ? `<span class="muted">→ ${esc(d.linkedTo)}</span>` : '';
    return `<li class="doc ${d.level === 'review' ? 'is-review' : ''}">
      <div class="doc-main"><button class="doc-name" data-act="open" data-doc="${esc(d.id)}" data-start="0" data-end="0">${icon('file', 15)}${esc(d.name)}</button>
        <div class="doc-tags">${badge('muted', KIND[d.kind])} <span class="doc-label">${esc(d.label)}</span> ${link} ${badge(kind, roleText)}</div>
        <div class="doc-note">${esc(d.statusLabel)}${d.note ? ` — ${esc(d.note)}` : ''}</div></div>
      <div class="doc-meta">${meta}<button class="icon-btn" data-act="remove" data-doc="${esc(d.id)}" title="Удалить из общей базы" aria-label="Удалить ${esc(d.name)} из общей базы">${icon('trash', 15)}</button></div>
    </li>`;
  }).join('');
}
