// Utilitários de interface: escape, ícones, folhas (bottom sheets), toasts, confirmação.
import { money } from './fmt.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  pay: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.5 4.5 0 0 1-.5 9.5z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

let toastTimer;
export function toast(msg, err = false) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), err ? 4200 : 2600);
}

/**
 * Abre uma folha inferior. `render(close)` recebe o elemento da folha para montar eventos.
 * Retorna a função close.
 */
export function sheet(title, bodyHTML, mount, onClose) {
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grip"></div><h3>${esc(title)}</h3>${bodyHTML}</div>`;
  let closed = false;
  const close = () => { if (closed) return; closed = true; bd.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bd.addEventListener('click', (e) => { if (e.target === bd) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bd);
  const el = bd.querySelector('.sheet');
  el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  mount?.(el, close);
  setTimeout(() => el.querySelector('[autofocus]')?.focus(), 60);
  return close;
}

/** Confirmação com motivo opcional. Resolve com {motivo} ou null. */
export function confirmSheet({ title, text, confirmLabel = 'Confirmar', danger = true, askReason = true, reasonRequired = false }) {
  return new Promise((resolve) => {
    let result = null;
    sheet(title, `
      <p class="small" style="margin-top:0">${text}</p>
      ${askReason ? `<label class="field"><span>Motivo ${reasonRequired ? '<em>*</em>' : '(opcional)'}</span><input class="input" name="motivo" autocomplete="off"></label>` : ''}
      <div class="sheet-actions"><button class="btn ghost" data-close>Voltar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirmLabel)}</button></div>`,
    (el, cl) => {
      el.querySelector('[data-ok]').addEventListener('click', () => {
        const motivo = el.querySelector('[name=motivo]')?.value.trim() || '';
        if (reasonRequired && !motivo) { el.querySelector('[name=motivo]').classList.add('invalid'); return; }
        result = { motivo }; cl();
      });
    }, () => resolve(result));
  });
}

/** Painel da validação do item 9 (pagamento acima do saldo). */
export function excedeHTML(d) {
  return `
    <div class="banner danger" style="align-items:flex-start">⚠️ <div>Pagamento superior ao saldo disponível. Verifique o valor informado ou registre um aditivo caso exista alteração no serviço.</div></div>
    <table class="vtable">
      <tr><td>Valor atualizado</td><td>${money(d.atualizado)}</td></tr>
      <tr><td>Total pago</td><td>${money(d.pago)}</td></tr>
      <tr><td>Total programado</td><td>${money(d.programado)}</td></tr>
      <tr><td>Saldo disponível</td><td>${money(d.disponivel)}</td></tr>
      <tr><td>Valor informado</td><td>${money(d.valor)}</td></tr>
      <tr class="hl"><td>Diferença excedente</td><td>${money(d.excedente)}</td></tr>
    </table>`;
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

// ---------------------------------------------------------------- tema
export const TEMAS = [['escuro', 'Escuro', 'Padrão. Fundo escuro, minimalista.'], ['claro', 'Claro', 'Fundo claro, para ambientes muito iluminados.'], ['automatico', 'Automático', 'Segue o tema do celular ou do computador.']];
export function temaAtual() { try { return localStorage.getItem('obra-tema') || 'escuro'; } catch { return 'escuro'; } }
export function aplicarTema(t = temaAtual()) {
  try { localStorage.setItem('obra-tema', t); } catch { /* sem armazenamento */ }
  const d = t === 'automatico' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : (t === 'claro' ? 'light' : 'dark');
  document.documentElement.dataset.theme = d;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = d === 'dark' ? '#0b0f0d' : '#1f5f4a';
}
try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (temaAtual() === 'automatico') aplicarTema('automatico'); }); } catch { /* navegador antigo */ }
