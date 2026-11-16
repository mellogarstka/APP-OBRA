import { money, dateBR, todayISO, addDays, addMonths, monthLabel } from '../fmt.js';
import { TIPOS, NATUREZAS, FORMAS } from '../calc.js';
import { esc, icon } from '../ui.js';
import { markPaidSheet } from '../actions.js';
import { pill } from './home.js';

const PERIODOS = [['todos', 'Todos'], ['hoje', 'Hoje'], ['semana', 'Esta semana'], ['mes', 'Este mês'], ['30', 'Últimos 30 dias'], ['custom', 'Personalizado']];

export function periodRange(p, de, ate) {
  const h = todayISO();
  const d = new Date();
  switch (p) {
    case 'hoje': return [h, h];
    case 'semana': { const dow = (d.getDay() + 6) % 7; const ini = addDays(h, -dow); return [ini, addDays(ini, 6)]; }
    case 'mes': { const ini = h.slice(0, 8) + '01'; return [ini, addDays(addMonths(ini, 1), -1)]; }
    case '30': return [addDays(h, -30), h];
    case 'custom': return [de || '0000-01-01', ate || '9999-12-31'];
    default: return ['0000-01-01', '9999-12-31'];
  }
}

const inRange = (iso, [a, b]) => iso >= a && iso <= b;

// estado dos filtros mantido entre navegações
const F = { q: '', cat: '', etapa: '', tipo: '', nat: '', forn: '', forma: '', status: '', per: 'todos', de: '', ate: '', semdata: '', inc: '', sub: '' };

export async function renderItens(root, ctx, params) {
  if (params.size) { for (const k of Object.keys(F)) F[k] = params.get(k) ?? (k === 'per' ? 'todos' : ''); }
  const cats = ctx.categories.filter(c => !c.parentId).sort((a, b) => a.ordem - b.ordem);
  const sel = (name, label, opts) => `<select class="input" data-f="${name}"><option value="">${label}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${F[name] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  root.innerHTML = `
    <div class="search">${icon('search')}<input class="input" data-f="q" placeholder="Buscar descrição, fornecedor, observação" value="${esc(F.q)}"></div>
    <div class="tabs">${PERIODOS.map(([k, l]) => `<button class="tab ${F.per === k ? 'active' : ''}" data-per="${k}">${l}</button>`).join('')}</div>
    <div class="grid2 ${F.per === 'custom' ? '' : 'hidden'}" data-custom>
      <label class="field"><span>De</span><input class="input" type="date" data-f="de" value="${F.de}"></label>
      <label class="field"><span>Até</span><input class="input" type="date" data-f="ate" value="${F.ate}"></label>
    </div>
    <details class="more" ${Object.entries(F).some(([k, v]) => !['q', 'per', 'de', 'ate'].includes(k) && v) ? 'open' : ''}>
      <summary>Filtros</summary>
      <div class="inner"><div class="filters">
        ${sel('cat', 'Categoria', cats.map(c => [c.id, c.nome]))}
        ${sel('etapa', 'Etapa', ctx.stages.sort((a, b) => a.ordem - b.ordem).map(s => [s.id, s.nome]))}
        ${sel('tipo', 'Tipo', TIPOS.map(t => [t, t]))}
        ${sel('nat', 'Natureza', NATUREZAS.map(t => [t, t]))}
        ${sel('forn', 'Fornecedor', ctx.suppliers.map(s => [s.id, s.nome]).sort((a, b) => a[1].localeCompare(b[1])))}
        ${sel('forma', 'Forma de pagamento', FORMAS.map(t => [t, t]))}
        ${sel('status', 'Status', [['Ativo', 'Ativo'], ['Quitado', 'Quitado'], ['Cancelado', 'Cancelado']])}
        ${sel('semdata', 'Saldo', [['1', 'Com saldo sem data']])}
        ${sel('inc', 'Completude', [['1', 'Somente incompletos']])}
      </div><button class="btn ghost sm" data-clear style="margin-bottom:12px">Limpar filtros</button></div>
    </details>
    <div class="row between small muted" style="margin:0 4px 8px"><span data-count></span><span data-sum class="num"></span></div>
    <div class="list grid-wide" data-list></div>`;

  const draw = () => {
    const q = F.q.trim().toLocaleLowerCase('pt-BR');
    const range = periodRange(F.per, F.de, F.ate);
    const rows = ctx.rows.filter(r => {
      const it = r.item;
      if (q && ![it.descricao, it.obs, ctx.supName(it.fornecedorId)].join(' ').toLocaleLowerCase('pt-BR').includes(q)) return false;
      if (F.cat && it.categoriaId !== F.cat && it.subcategoriaId !== F.cat) return false;
      if (F.sub && it.subcategoriaId !== F.sub) return false;
      if (F.etapa && it.etapaId !== F.etapa) return false;
      if (F.tipo && it.tipo !== F.tipo) return false;
      if (F.nat && it.natureza !== F.nat) return false;
      if (F.forn && it.fornecedorId !== F.forn) return false;
      if (F.forma && it.formaPagamento !== F.forma && !r.pays.some(p => p.forma === F.forma)) return false;
      if (F.status && r.status !== F.status) return false;
      if (!F.status && r.status === 'Cancelado' && !q) return false; // cancelados ocultos por padrão
      if (F.semdata && !(r.totals.semData > 0 && r.status !== 'Cancelado')) return false;
      if (F.inc && !it.incompleto) return false;
      if (!inRange(it.dataCompra, range)) return false;
      return true;
    }).sort((a, b) => b.item.dataCompra.localeCompare(a.item.dataCompra) || b.item.criadoEm - a.item.criadoEm);
    root.querySelector('[data-count]').textContent = `${rows.length} item(ns)`;
    root.querySelector('[data-sum]').textContent = money(rows.filter(r => r.status !== 'Cancelado').reduce((s, r) => s + r.totals.atualizado, 0));
    root.querySelector('[data-list]').innerHTML = rows.length ? rows.map(r => `
      <a class="li ${r.status === 'Cancelado' ? 'strike' : ''}" href="#/item/${r.item.id}">
        <div class="grow">
          <div class="title clamp2">${esc(r.item.descricao)}</div>
          <div class="meta">${dateBR(r.item.dataCompra)} · ${esc(ctx.catName(r.item.categoriaId))} · ${esc(ctx.stageName(r.item.etapaId))}</div>
          <div class="meta">${r.status === 'Quitado' ? '<span class="tag ok">Quitado</span>' : ''}${r.item.natureza !== 'Normal' ? ` <span class="tag ${r.item.natureza === 'Upgrade' ? 'info' : 'warn'}">${r.item.natureza}</span>` : ''}${r.item.incompleto ? ' <span class="tag danger">Incompleto</span>' : ''}</div>
        </div>
        <div class="amount num">${money(r.totals.atualizado)}<div class="meta">${r.totals.pendente > 0 ? 'falta ' + money(r.totals.pendente) : r.status === 'Cancelado' ? 'cancelado' : 'pago'}</div></div>
      </a>`).join('') : '<div class="empty">Nenhum item encontrado.</div>';
  };
  draw();

  root.addEventListener('input', (e) => { const k = e.target.dataset.f; if (k) { F[k] = e.target.value; draw(); } });
  root.addEventListener('change', (e) => { const k = e.target.dataset.f; if (k) { F[k] = e.target.value; draw(); } });
  root.querySelectorAll('[data-per]').forEach(b => b.addEventListener('click', () => {
    F.per = b.dataset.per;
    root.querySelectorAll('[data-per]').forEach(x => x.classList.toggle('active', x === b));
    root.querySelector('[data-custom]').classList.toggle('hidden', F.per !== 'custom');
    draw();
  }));
  root.querySelector('[data-clear]').addEventListener('click', () => {
    for (const k of Object.keys(F)) F[k] = k === 'per' ? 'todos' : '';
    location.hash = '#/itens?r=' + Date.now();
  });
}

// ------------------------------------------------------------ pagamentos
const PF = { sit: '', per: 'todos', de: '', ate: '' };

export async function renderPagamentos(root, ctx, params) {
  if (params.get('sit') !== null) PF.sit = params.get('sit');
  const itemOf = (id) => ctx.rows.find(r => r.item.id === id);
  root.innerHTML = `
    <div class="tabs">${[['', 'Todos'], ['Realizado', 'Realizados'], ['Programado', 'Programados'], ['Cancelado', 'Cancelados']].map(([k, l]) => `<button class="tab ${PF.sit === k ? 'active' : ''}" data-sit="${k}">${l}</button>`).join('')}</div>
    <div class="tabs">${PERIODOS.map(([k, l]) => `<button class="tab ${PF.per === k ? 'active' : ''}" data-per="${k}">${l}</button>`).join('')}</div>
    <div class="grid2 ${PF.per === 'custom' ? '' : 'hidden'}" data-custom>
      <label class="field"><span>De</span><input class="input" type="date" data-f="de" value="${PF.de}"></label>
      <label class="field"><span>Até</span><input class="input" type="date" data-f="ate" value="${PF.ate}"></label>
    </div>
    <div class="row between small" style="margin:0 4px 10px"><span class="muted">Data considerada: pagamento (realizados) ou vencimento (programados)</span></div>
    <div class="kpis" data-tot style="margin:0 0 14px"></div>
    <div data-list></div>`;

  const draw = () => {
    const range = periodRange(PF.per, PF.de, PF.ate);
    const hoje = todayISO();
    const list = ctx.payments.filter(p => {
      const r = itemOf(p.itemId); if (!r) return false;
      if (PF.sit && p.situacao !== PF.sit) return false;
      if (!PF.sit && p.situacao === 'Cancelado') return false;
      if (r.item.status === 'Cancelado' && p.situacao !== 'Cancelado') return false;
      return inRange(p.situacao === 'Realizado' ? (p.dataPago || p.data) : p.data, range);
    }).map(p => ({ ...p, _d: p.situacao === 'Realizado' ? (p.dataPago || p.data) : p.data }))
      .sort((a, b) => PF.sit === 'Programado' ? a._d.localeCompare(b._d) : b._d.localeCompare(a._d));

    const sum = (s) => list.filter(p => p.situacao === s).reduce((a, p) => a + p.valor, 0);
    root.querySelector('[data-tot]').innerHTML = `
      <div class="kpi"><div class="label">Realizado no período</div><div class="value num" style="color:var(--ok)">${money(sum('Realizado'))}</div></div>
      <div class="kpi info"><div class="label">Programado no período</div><div class="value num">${money(sum('Programado'))}</div></div>`;

    const groups = {};
    for (const p of list) (groups[p._d.slice(0, 7)] ||= []).push(p);
    root.querySelector('[data-list]').innerHTML = list.length ? Object.entries(groups).map(([ym, ps]) => `
      <div class="section-title row between"><span>${monthLabel(ym)}</span><span class="num">${money(ps.filter(p => p.situacao !== 'Cancelado').reduce((s, p) => s + p.valor, 0))}</span></div>
      <div class="list grid-wide">${ps.map(p => {
        const it = itemOf(p.itemId).item;
        const prog = p.situacao === 'Programado';
        const cls = prog ? (p._d < hoje ? 'late' : p._d === hoje ? 'today' : '') : '';
        return `<div class="li ${p.situacao === 'Cancelado' ? 'strike' : ''}" data-open="${p.itemId}">${pill(p._d, cls)}
          <div class="grow"><div class="title clamp2">${esc(it.descricao)}</div>
          <div class="meta">${prog ? '<span class="tag info">Programado</span>' : p.situacao === 'Realizado' ? '<span class="tag ok">Realizado</span>' : '<span class="tag">Cancelado</span>'} ${p.parcela ? `${p.parcela}/${p.totalParcelas}` : ''} ${esc(p.forma || '')}</div></div>
          <div class="right"><div class="amount num">${money(p.valor)}</div>
          ${prog ? `<button class="quick-pay" data-pay="${p.id}">Marcar pago</button>` : ''}</div></div>`;
      }).join('')}</div>`).join('') : '<div class="list"><div class="empty">Nenhum pagamento no filtro.</div></div>';
  };
  draw();

  root.querySelectorAll('[data-sit]').forEach(b => b.addEventListener('click', () => { PF.sit = b.dataset.sit; root.querySelectorAll('[data-sit]').forEach(x => x.classList.toggle('active', x === b)); draw(); }));
  root.querySelectorAll('[data-per]').forEach(b => b.addEventListener('click', () => {
    PF.per = b.dataset.per; root.querySelectorAll('[data-per]').forEach(x => x.classList.toggle('active', x === b));
    root.querySelector('[data-custom]').classList.toggle('hidden', PF.per !== 'custom'); draw();
  }));
  root.addEventListener('change', (e) => { const k = e.target.dataset.f; if (k) { PF[k] = e.target.value; draw(); } });
  root.querySelector('[data-list]').addEventListener('click', (e) => {
    const pay = e.target.closest('[data-pay]');
    if (pay) { e.stopPropagation(); const p = ctx.payments.find(x => x.id === pay.dataset.pay); return markPaidSheet(p, itemOf(p.itemId).item.descricao); }
    const op = e.target.closest('[data-open]'); if (op) location.hash = `#/item/${op.dataset.open}`;
  });
}
