/**
 * ask.js — ответы на вопросы закупщика по результату сверки (analyze).
 *
 * Два вида вопросов: «значение поля по договору» и «у каких договоров срок
 * поставки раньше даты и есть ли несогласованные изменения срока».
 * Ответ — структура {level, title, lines[]}; у каждой строки может быть
 * evidence (имя файла, цитата, абзац) для перехода к источнику.
 */

import { FIELDS, fieldByKey } from './fields.js';
import { fmtDate } from './text.js';

const PROPOSAL_KIND = { letter: 'письмо поставщика', draft: 'проект допсоглашения', unsigned: 'допсоглашение с неясным статусом', scheduled: 'допсоглашение' };

const line = (text, evidence = null) => ({ text, evidence });

function proposalLines(contract, fieldKey) {
  return contract.proposals
    .filter((p) => p.field === fieldKey)
    .map((p) => line(`Не согласовано и не учтено: ${p.display} — ${PROPOSAL_KIND[p.kind] || p.kind} («${p.doc.label}»; ${p.reason}).`, p.evidence));
}

function scheduledLines(contract, fieldKey) {
  return contract.scheduled
    .filter((p) => p.field === fieldKey)
    .map((p) => line(`Позже даты проверки: ${p.display} — «${p.doc.label}», ${p.reason}.`, p.evidence));
}

/**
 * Строит строки ответа о значении поля: значение с цитатой, что и каким документом изменено, предупреждения. Для «нет данных» и конфликта объясняет причину вместо подстановки значения.
 */
function valueLines(contract, f, checkDate) {
  const r = contract.fields[f.key];
  const head = `${f.question} по договору ${contract.number || contract.fileName} на ${fmtDate(checkDate)}`;
  if (r.status === 'nodata') {
    const out = [line(`${head}: нет данных.`)];
    r.notes.forEach((n) => out.push(line(n, r.evidence)));
    r.rejected.forEach((x) => out.push(line(`Найдено, но не принято как значение${x.display ? ` (${x.display})` : ''}: ${x.reason}.`, x.evidence)));
    return out;
  }
  if (!r.display) {
    return [line(`${head}: нужна проверка — ${r.notes.join('; ')}.`), ...r.candidates.map((c) => line(`Вариант: ${c.display}`, c.evidence))];
  }
  const out = [line(`${head}: ${r.display}.`, r.evidence)];
  if (r.changed) {
    const was = r.base ? `в договоре было ${r.base.display}` : 'в договоре значения не было';
    out.push(line(`Изменено документом «${r.source.label}» (${r.source.fileName}), в силе с ${fmtDate(r.source.effective)}; ${was}.`, r.base ? r.base.evidence : null));
  }
  r.warnings.forEach((w) => out.push(line(`Проверьте: ${w}.`, r.evidence)));
  r.notes.forEach((n) => out.push(line(`Проверьте: ${n}.`)));
  return out;
}

/**
 * Отвечает на вопрос «чему равно поле X по договору Y на дату проверки».
 * Контракт: если договора или поля нет — возвращает level='nodata'.
 * @param {object} analysis результат analyze
 * @param {string} contractId id документа-договора
 * @param {string} fieldKey ключ поля из FIELDS
 * @returns {{level:string,title:string,lines:{text:string,evidence:object|null}[]}}
 */
export function answerField(analysis, contractId, fieldKey) {
  const contract = analysis.contracts.find((c) => c.docId === contractId);
  const f = fieldByKey(fieldKey);
  if (!contract || !f) return { level: 'nodata', title: 'Выберите договор', lines: [] };
  const r = contract.fields[fieldKey];
  const lines = [...valueLines(contract, f, analysis.checkDate), ...proposalLines(contract, fieldKey), ...scheduledLines(contract, fieldKey)];
  const level = r.status === 'nodata' ? 'nodata' : r.status === 'review' ? 'review' : 'ok';
  return { level, title: `${f.question} · ${contract.number || contract.fileName}`, lines };
}

/**
 * Строки об одном договоре для вопроса «раньше даты»: пустой список, если срок
 * не раньше границы; иначе срок и несогласованные изменения срока.
 * Договор без определённого срока попадает в ответ строкой «срок не определён».
 */
function beforeEntry(c, beforeIso) {
  const d = c.fields.deadline;
  const name = c.number || c.fileName;
  if (!d.display) return { undetermined: true, lines: [line(`${name}: срок поставки не определён (${d.status === 'nodata' ? 'нет данных' : 'нужна проверка'}).`, d.evidence)] };
  if (d.value >= beforeIso) return { lines: [] };
  const props = proposalLines(c, 'deadline');
  const head = line(`${name}: поставка до ${d.display}${d.changed ? ` (изменено «${d.source.label}»)` : ''}.`, d.evidence);
  return { match: true, unagreed: props.length > 0, lines: [head, ...(props.length ? props : [line(`${name}: несогласованных изменений срока нет.`)])] };
}

/**
 * Отвечает на вопрос «по каким договорам поставка раньше даты X и есть ли
 * несогласованные изменения срока».
 * @param {object} analysis результат analyze
 * @param {string} beforeIso граница, YYYY-MM-DD (строго «раньше»)
 * @returns {{level:string,title:string,lines:object[],matches:string[]}}
 */
export function answerBefore(analysis, beforeIso) {
  const entries = analysis.contracts.map((c) => ({ c, ...beforeEntry(c, beforeIso) }));
  const matches = entries.filter((e) => e.match);
  const unagreed = matches.filter((e) => e.unagreed).length;
  const summary = matches.length
    ? `Договоров: ${matches.length}; с несогласованными изменениями срока: ${unagreed}.`
    : `Нет договоров со сроком поставки раньше ${fmtDate(beforeIso)}.`;
  return {
    level: unagreed ? 'review' : 'ok',
    title: `Поставка раньше ${fmtDate(beforeIso)}`,
    lines: [line(summary), ...entries.flatMap((e) => e.lines)],
    matches: matches.map((e) => e.c.docId),
  };
}

/**
 * Список полей для выбора в форме вопроса.
 * @returns {{key:string,label:string}[]}
 */
export function questionFields() {
  return FIELDS.map((f) => ({ key: f.key, label: f.question }));
}
