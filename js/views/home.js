import { money, dateBR, todayISO, addDays } from '../fmt.js';
import { projectTotals } from '../calc.js';
import { esc, icon } from '../ui.js';
import { markPaidSheet } from '../actions.js';

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function pill(iso, cls = '') {
  const [, m, d] = iso.split('-');
  return `<div class="date-pill ${cls}"><b>${d}</b><span>${MES[+m - 1]}</span></div>`;
}

/** Classifica compromissos (pagamentos programados de itens não cancelados). */
export function agenda(ctx) {
  const hoje = todayISO();
  const lim30 = addDays(hoje, 30);
  const ativos = new Set(ctx.rows.filter(r => r.item.status !== 'Cancelado').map(r => r.item.id));
  const prog = ctx.payments.filter(p => p.situacao === 'Programado' && ativos.has(p.itemId)).sort((a, b) => a.data.localeCompare(b.data));
  return {
    atrasados: prog.filter(p => p.data < hoje),
    hoje: prog.filter(p => p.data === hoje),
    prox30: prog.filter(p => p.data > hoje && p.data <= lim30),
    realizados: ctx.payments.filter(p => p.situacao === 'Realizado' && ativos.has(p.itemId))
      .sort((a, b) => (b.dataPago || b.data).localeCompare(a.dataPago || a.data) || b.criadoEm - a.criadoEm).slice(0, 15),
    semData: ctx.rows.filter(r => r.item.status !== 'Cancelado' && r.totals.semData > 0).sort((a, b) => b.totals.semData - a.totals.semData),
  };
}

let tabAtual = null;

export async function renderHome(root, ctx) {
  const t = projectTotals(ctx.rows);
  const ag = agenda(ctx);
  const obra = ctx.settings.obra || {};
  const pct = t.custo > 0 ? Math.min(100, t.pago / t.custo * 100) : 0;

  const tabs = [
    ['atrasados', 'Atrasados', ag.atrasados.length, 'danger'],
    ['hoje', 'Hoje', ag.hoje.length, ''],
    ['prox30', 'Próximos 30 dias', ag.prox30.length, ''],
    ['realizados', 'Realizados', null, ''],
    ['semData', 'Sem data', ag.semData.length, ''],
  ];
  if (!tabAtual) tabAtual = ag.atrasados.length ? 'atrasados' : ag.hoje.length ? 'hoje' : 'prox30';

  // Lembrete de backup: >7 dias ou ≥20 lançamentos
  const ub = ctx.settings.ultimoBackup;
  const desde = ctx.settings.lancamentosDesdeBackup || 0;
  const diasBk = ub ? Math.floor((Date.now() - ub) / 864e5) : null;
  const precisaBackup = ctx.rows.length > 0 && (ub === null || ub === undefined || diasBk > 7 || desde >= 20);

  const avisoDias = ctx.settings.avisoDias ?? 3;
  const proxAviso = ag.prox30.filter(p => p.data <= addDays(todayISO(), avisoDias)).length;

  root.innerHTML = `
    ${!obra.nome ? `<div class="banner info"><span>Comece informando os dados da obra.</span><a class="btn sm primary" href="#/config/obra">Preencher</a></div>` : ''}
    ${ag.atrasados.length ? `<a class="banner danger" href="#" data-goto="atrasados" style="text-decoration:none"><span><b>${ag.atrasados.length}</b> pagamento(s) atrasado(s) — <b>${money(ag.atrasados.reduce((s, p) => s + p.valor, 0))}</b></span></a>` : ''}
    ${ag.hoje.length ? `<div class="banner warn"><span><b>${ag.hoje.length}</b> pagamento(s) vence(m) hoje</span></div>` : ''}
    ${!ag.hoje.length && proxAviso ? `<div class="banner warn"><span><b>${proxAviso}</b> pagamento(s) nos próximos ${avisoDias} dia(s)</span></div>` : ''}
    ${precisaBackup ? `<div class="banner warn"><span>${ub ? `Último backup há ${diasBk} dia(s)${desde ? ` · ${desde} lançamento(s) novos` : ''}.` : 'Você ainda não fez nenhum backup.'}</span><a class="btn sm accent" href="#/config/backup">Fazer backup</a></div>` : ''}

    <div class="kpi-hero">
      <div class="label">Custo total da obra</div>
      <div class="value num">${money(t.custo)}</div>
      <div class="bar"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="split">
        <div><span>Pago (${pct.toFixed(0)}%)</span><b class="num">${money(t.pago)}</b></div>
        <div><span>Falta pagar</span><b class="num">${money(t.pendente)}</b></div>
      </div>
    </div>
    <div class="kpis">
      <a class="kpi info" href="#/pagamentos?sit=Programado"><div class="label">Programado (com data)</div><div class="value num">${money(t.programado)}</div></a>
      <a class="kpi warn" href="#/itens?semdata=1"><div class="label">Sem data definida</div><div class="value num">${money(t.semData)}</div></a>
      <a class="kpi" href="#/relatorios/ajustes"><div class="label">Aditivos (líquido de reduções)</div><div class="value num">${money(t.aditivosLiq)}</div></a>
      <a class="kpi" href="#/relatorios/natureza"><div class="label">Upgrades (diferença)</div><div class="value num">${money(t.upgrades)}</div></a>
      <a class="kpi" href="#/itens?nat=Retrabalho"><div class="label">Retrabalho</div><div class="value num">${money(t.retrabalho)}</div></a>
      <a class="kpi" href="#/itens?nat=Imprevisto"><div class="label">Imprevistos</div><div class="value num">${money(t.imprevisto)}</div></a>
    </div>

    <div class="section-title">Próximos pagamentos</div>
    <div class="tabs" role="tablist">
      ${tabs.map(([k, l, c, cls]) => `<button class="tab ${k === tabAtual ? 'active' : ''} ${c && cls ? cls : ''}" data-tab="${k}">${l}${c !== null ? ` <span class="count">${c}</span>` : ''}</button>`).join('')}
    </div>
    <div class="list" data-agenda></div>
  `;

  const box = root.querySelector('[data-agenda]');
  const itemOf = (id) => ctx.rows.find(r => r.item.id === id)?.item;
  const drawTab = () => {
    if (tabAtual === 'semData') {
      box.innerHTML = ag.semData.length ? ag.semData.map(r => `
        <a class="li" href="#/item/${r.item.id}">
          <div class="grow"><div class="title clamp2">${esc(r.item.descricao)}</div><div class="meta">${esc(ctx.supName(r.item.fornecedorId) || ctx.stageName(r.item.etapaId))}</div></div>
          <div class="amount num">${money(r.totals.semData)}<div class="meta">de ${money(r.totals.pendente)}</div></div>
        </a>`).join('') : `<div class="empty">Nenhum saldo sem data definida.</div>`;
      return;
    }
    const list = ag[tabAtual];
    const hoje = todayISO();
    box.innerHTML = list.length ? list.map(p => {
      const it = itemOf(p.itemId);
      const realizado = p.situacao === 'Realizado';
      const d = realizado ? (p.dataPago || p.data) : p.data;
      const cls = realizado ? '' : d < hoje ? 'late' : d === hoje ? 'today' : '';
      return `
      <div class="li" data-open="${p.itemId}">
        ${pill(d, cls)}
        <div class="grow"><div class="title clamp2">${esc(it?.descricao || '—')}</div>
          <div class="meta">${[p.parcela ? `Parcela ${p.parcela}/${p.totalParcelas}` : '', esc(p.forma || '')].filter(Boolean).join(' · ')}${!realizado && cls === 'late' ? ' · <span style="color:var(--danger)">atrasado</span>' : ''}</div></div>
        <div class="right"><div class="amount num">${money(p.valor)}</div>
        ${realizado ? '' : `<button class="quick-pay" data-pay="${p.id}">Marcar pago</button>`}</div>
      </div>`;
    }).join('') : `<div class="empty">${{ atrasados: 'Nenhum pagamento atrasado. 👍', hoje: 'Nada vence hoje.', prox30: 'Nenhum compromisso nos próximos 30 dias.', realizados: 'Nenhum pagamento realizado ainda.' }[tabAtual]}</div>`;
  };
  drawTab();

  root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    tabAtual = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
    drawTab();
  }));
  root.querySelector('[data-goto]')?.addEventListener('click', (e) => { e.preventDefault(); root.querySelector('[data-tab=atrasados]').click(); root.querySelector('[data-agenda]').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  box.addEventListener('click', (e) => {
    const pay = e.target.closest('[data-pay]');
    if (pay) { e.stopPropagation(); const p = ctx.payments.find(x => x.id === pay.dataset.pay); markPaidSheet(p, itemOf(p.itemId)?.descricao); return; }
    const op = e.target.closest('[data-open]');
    if (op) location.hash = `#/item/${op.dataset.open}`;
  });
  void icon;
}
