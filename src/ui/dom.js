/**
 * dom.js — мелкие помощники интерфейса: экранирование HTML, иконки, уведомления.
 *
 * Весь текст документов — недоверенные данные, поэтому в разметку он попадает
 * только через esc().
 */

/**
 * Экранирует строку для вставки в HTML-текст и атрибуты.
 * @param {unknown} s значение
 * @returns {string}
 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const PATHS = {
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  upload: 'M12 16V4m0 0L7 9m5-5 5 5M5 20h14',
  download: 'M12 4v12m0 0 5-5m-5 5-5-5M5 20h14',
  x: 'M6 6l12 12M18 6 6 18',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  sync: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  server: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
  disk: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  alert: 'M12 9v4m0 4h.01M10.3 4.2 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  logo: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
};

/**
 * Возвращает inline-SVG иконку (контурную, наследует цвет текста).
 * @param {string} name имя из набора PATHS
 * @param {number} size размер в px
 * @returns {string}
 */
export function icon(name, size = 16) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
}

/**
 * Показывает всплывающее уведомление.
 * @param {string} message текст
 * @param {'info'|'ok'|'error'} kind вид
 */
export function toast(message, kind = 'info') {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.append(el);
  setTimeout(() => el.classList.add('out'), kind === 'error' ? 7000 : 3500);
  setTimeout(() => el.remove(), kind === 'error' ? 7400 : 3900);
}

/**
 * Читает файл как текст: UTF-8, а если в нём есть ошибки декодирования —
 * Windows-1251 (частый случай для выгрузок из 1С и старых договоров).
 * @param {File} file выбранный файл
 * @returns {Promise<string>}
 */
export async function readFileText(file) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1251').decode(buffer);
  }
}
