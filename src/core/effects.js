/**
 * effects.js — как документ влияет на договор на дату проверки.
 * Применяется только подписанное обеими сторонами допсоглашение, вступившее
 * в силу к этой дате; остальное — предложение, будущее изменение или повод
 * для проверки.
 */

import { normalizeParty } from './parse.js';
import { fmtDate } from './text.js';

function partiesMismatch(a, c) {
  const diff = (x, y) => x && y && normalizeParty(x.name) !== normalizeParty(y.name);
  return diff(a.supplier, c.supplier) || diff(a.buyer, c.buyer);
}

const review = (reason) => ({ role: 'review', reason, proposalKind: 'unsigned' });

const EFFECT_RULES = [
  (a) => a.kind === 'letter' && { role: 'proposal', reason: 'предложение, а не согласованное изменение', proposalKind: 'letter' },
  (a) => a.status.signed === false && { role: 'proposal', reason: a.isDraft ? 'проект, не подписан сторонами' : 'не подписано сторонами', proposalKind: 'draft' },
  (a) => a.status.signed === null && review('статус подписания не определён'),
  (a, c) => partiesMismatch(a, c) && review('стороны в допсоглашении не совпадают с договором'),
  (a) => !a.signDate && review('не указана дата подписания'),
  (a, c, day) => a.signDate > day && { role: 'scheduled', effective: a.signDate, reason: `подписано ${fmtDate(a.signDate)} — позже даты проверки` },
];

function effectiveDate(a) {
  if (a.effective.kind === 'date') return a.effective.iso;
  return a.effective.kind === 'on-signing' ? a.signDate : null;
}

/**
 * Решает, как документ влияет на договор на дату проверки: применяется, вступит позже, предложение или нужна проверка. Применяется только подписанное обеими сторонами допсоглашение с наступившей датой вступления в силу.
 */
export function amendmentEffect(a, c, checkDate) {
  for (const rule of EFFECT_RULES) {
    const verdict = rule(a, c, checkDate);
    if (verdict) return verdict;
  }
  const effective = effectiveDate(a);
  if (!effective) return review('не указана дата вступления в силу');
  if (effective > checkDate) return { role: 'scheduled', effective, reason: `вступает в силу ${fmtDate(effective)} — позже даты проверки` };
  return { role: 'applied', effective, reason: `вступило в силу ${fmtDate(effective)}` };
}
