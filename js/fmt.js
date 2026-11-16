// Formatação e conversão: dinheiro em CENTAVOS (inteiro) e datas ISO (AAAA-MM-DD).

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos (inteiro) -> "R$ 1.234,56" */
export function money(cents) {
  return brl.format((Number(cents) || 0) / 100);
}

/** Centavos -> "1.234,56" (para campos de edição) */
export function moneyPlain(cents) {
  const v = (Number(cents) || 0) / 100;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Texto digitado -> centavos inteiros. Aceita "1.234,56", "1234,56", "1234.56", "R$ 1.234", "1234".
 * Retorna NaN se inválido.
 */
export function parseMoney(text) {
  if (typeof text === 'number') return Math.round(text * 100);
  let s = String(text ?? '').trim().replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (!s) return NaN;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const hasComma = s.includes(',');
  if (hasComma) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Sem vírgula: pontos podem ser milhar ("1.234") ou decimal ("1234.5").
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = parts.join('');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [int, dec = ''] = s.split('.');
  const cents = parseInt(int, 10) * 100 + parseInt((dec + '00').slice(0, 2), 10);
  return neg ? -cents : cents;
}

/** Hoje em ISO local (não UTC) */
export function todayISO() {
  const d = new Date();
  return toISO(d);
}

export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "2026-11-16" -> "16/11/2026" */
export function dateBR(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** "16/11/2026" -> "2026-11-16" (ou null) */
export function parseDateBR(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isValidISO(iso) ? iso : null;
}

export function isValidISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * Soma k meses a uma data ISO, mantendo o dia; se o mês não tiver o dia
 * (ex.: 31), usa o último dia do mês.
 */
export function addMonths(iso, k) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1 + k, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  return toISO(target);
}

export function addDays(iso, k) {
  const [y, m, d] = iso.split('-').map(Number);
  return toISO(new Date(y, m - 1, d + k));
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
  return s.replace('.', '');
}

export function dateTimeBR(ts) {
  const d = new Date(ts);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
