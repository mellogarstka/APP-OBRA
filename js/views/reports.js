import { money, dateBR, monthLabel } from '../fmt.js';
import { splitMaterialMO, TIPOS, NATUREZAS } from '../calc.js';
import { esc, icon, sheet, toast } from '../ui.js';
import { todayISO } from '../fmt.js';
import { gerarPDF, entregarPDF, TIPOS_RELATORIO } from '../pdf.js';

const PDFF = { tipo: 'resumo', f: { tipo: '', etapa: '', cat: '', de: '', ate: '' } };

function pdfSheet(ctx) {
  const cats = ctx.categories.filter(c => !c.parentId && c.ativo !== false).sort((a, b) => a.ordem - b.ordem);
  const sel = (name, label, opts) => `<label class="field"><span>${label}</span><select class="input" name="${name}"><option value="">Todos</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${PDFF.f[name] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  sheet('Gerar relatório em PDF', `
    ${TIPOS_RELATORIO.map(([k, l, d]) => `<label class="opt ${PDFF.tipo === k ? 'on' : ''}"><input type="radio" name="rel" value="${k}" ${PDFF.tipo === k ? 'checked' : ''}><div><b>${l}</b><small>${d}</small></div></label>`).join('')}
    <div data-filtros class="${PDFF.tipo === 'resumo' ? 'hidden' : ''}" style="margin-top:6px">
      <div class="grid2">${sel('tipo', 'Tipo de custo', TIPOS.map(t => [t, t]))}${sel('etapa', 'Etapa', [...ctx.stages].sort((a, b) => a.ordem - b.ordem).map(x => [x.id, x.nome]))}</div>
      ${sel('cat', 'Categoria', cats.map(c => [c.id, c.nome]))}
      <div class="grid2">
        <label class="field"><span data-de-label>De</span><input class="input" type="date" name="de" value="${PDFF.f.de}" max="${todayISO()}"></label>
        <label class="field"><span>Até</span><input class="input" type="date" name="ate" value="${PDFF.f.ate}"></label>
      </div>
      <p class="tiny muted" data-per-hint style="margin:-4px 2px 8px"></p>
    </div>
    <div class="sheet-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>${icon('doc')} Gerar PDF</button></div>`,
  (el, close) => {
    const hint = () => {
      const t = el.querySelector('[name=rel]:checked').value;
      el.querySelector('[data-filtros]').classList.toggle('hidden', t === 'resumo');
      el.querySelector('[data-per-hint]').textContent = t === 'pagamentos' ? 'Período pela data em que o pagamento foi feito.' : 'Período pela data da compra/contratação do item.';
      el.querySelectorAll('.opt').forEach(o => o.classList.toggle('on', o.querySelector('input').checked));
    };
    el.querySelectorAll('[name=rel]').forEach(r => r.addEventListener('change', hint)); hint();
    el.querySelector('[data-ok]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      PDFF.tipo = el.querySelector('[name=rel]:checked').value;
      for (const k of Object.keys(PDFF.f)) PDFF.f[k] = el.querySelector(`[name=${k}]`).value;
      if (PDFF.f.de && PDFF.f.ate && PDFF.f.de > PDFF.f.ate) return toast('A data inicial é maior que a final.', true);
      btn.disabled = true; btn.textContent = 'Gerando…';
      try {
        const r = await gerarPDF(ctx, { tipo: PDFF.tipo, f: PDFF.tipo === 'resumo' ? {} : { ...PDFF.f } });
        const como = await entregarPDF(r);
        close();
        if (como !== 'cancelado') toast(`PDF gerado (${r.paginas} página${r.paginas > 1 ? 's' : ''}).`);
      } catch (err) { toast(err.message || 'Falha ao gerar o PDF.', true); btn.disabled = false; btn.textContent = 'Gerar PDF'; }
    });
  });
}

const TABS = [
  ['categoria', 'Categoria'], ['etapa', 'Etapa'], ['tipo', 'Tipo de custo'], ['natureza', 'Natureza'], ['fornecedor', 'Fornecedor'],
  ['mes', 'Por mês'], ['futuro', 'Compromissos'], ['ajustes', 'Aditivos'], ['cartao', 'Parcelados'],
];
let mesVisao = 'custo';

function groupRows(rows, keyFn) {
  const g = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const x = g.get(k) || { atualizado: 0, pago: 0, pendente: 0, n: 0 };
    x.atualizado += r.totals.atualizado; x.pago += r.totals.pago; x.pendente += r.totals.pendente; x.n++;
    g.set(k, x);
  }
  return [...g.entries()].sort((a, b) => b[1].atualizado - a[1].atualizado);
}

function barRows(entries, nameFn, hrefFn, total) {
  if (!entries.length) return '<div class="empty">Sem dados.</div>';
  return entries.map(([k, x]) => {
    const pPago = total ? (x.pago / total) * 100 : 0;
    const pOpen = total ? (Math.max(0, x.atualizado - x.pago) / total) * 100 : 0;
    return `<a class="rep-row" ${hrefFn ? `href="${hrefFn(k)}"` : ''}>
      <div class="top"><span class="clamp2">${esc(nameFn(k))}</span><b class="num">${money(x.atualizado)}</b></div>
      <div class="bar"><span class="paid" style="width:${pPago}%"></span><span class="open" style="width:${pOpen}%"></span></div>
      <div class="sub"><span>${x.n} ${x.n === 1 ? 'item' : 'itens'} · ${(total ? (x.atualizado / total) * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do total</span><span class="num pf">pago ${money(x.pago)} · falta ${money(x.pendente)}</span></div>
    </a>`;
  }).join('');
}

export async function renderReports(root, ctx, tab = 'categoria') {
  const rows = ctx.rows.filter(r => r.item.status !== 'Cancelado');
  const total = rows.reduce((s, r) => s + r.totals.atualizado, 0);
  if (!TABS.some(t => t[0] === tab)) tab = 'categoria';

  let body = '';
  const legend = `<div class="legend"><span><i style="background:var(--brand)"></i>Pago</span><span><i style="background:var(--bar-open)"></i>A pagar</span></div>`;

  if (tab === 'categoria') {
    const g = groupRows(rows, r => r.item.categoriaId);
    body = legend + `<div class="rep-cols"><section><div class="list">${barRows(g, ctx.catName, k => `#/itens?cat=${k}`, total)}</div></section>`;
    const subs = groupRows(rows.filter(r => r.item.subcategoriaId), r => r.item.subcategoriaId);
    if (subs.length) body += `<section><div class="section-title first-wide">Subcategorias</div><div class="list">${barRows(subs, k => {
      const c = ctx.catMap[k]; return c ? `${ctx.catName(c.parentId)} › ${c.nome}` : '—';
    }, k => `#/itens?sub=${k}`, total)}</div>`;
    body += subs.length ? '</section></div>' : '</div>';
  }
  if (tab === 'etapa') body = legend + `<div class="list">${barRows(groupRows(rows, r => r.item.etapaId), ctx.stageName, k => `#/itens?etapa=${k}`, total)}</div>`;
  if (tab === 'fornecedor') body = legend + `<div class="list">${barRows(groupRows(rows, r => r.item.fornecedorId || ''), k => k ? ctx.supName(k) : 'Sem fornecedor', k => k ? `#/itens?forn=${k}` : null, total)}</div>`;

  if (tab === 'tipo') {
    const g = groupRows(rows, r => r.item.tipo);
    let mat = 0, mo = 0, outros = 0, adm = 0;
    for (const r of rows) {
      if (r.item.tipo === 'Administrativo') { adm += r.totals.atualizado; continue; }
      const s = splitMaterialMO(r.item, r.totals, r.adj); mat += s.material; mo += s.maoDeObra; outros += s.outros;
    }
    body = `
      <div class="kpis" style="margin-top:0">
        <div class="kpi"><div class="label">Materiais (incl. parcela de serviços mistos)</div><div class="value num">${money(mat)}</div></div>
        <div class="kpi"><div class="label">Mão de obra (incl. parcela de serviços mistos)</div><div class="value num">${money(mo)}</div></div>
      </div>
      <p class="tiny muted" style="margin:8px 4px;line-height:1.6">${outros ? `Equipamentos e serviços mistos sem separação informada: <b class="num">${money(outros)}</b><br>` : ''}${adm ? `Administrativo (projetos, taxas, terreno/financiamento): <b class="num">${money(adm)}</b>` : ''}</p>
      <div class="section-title">Por tipo cadastrado</div>${legend}
      <div class="list">${barRows(g.sort((a, b) => TIPOS.indexOf(a[0]) - TIPOS.indexOf(b[0])), k => k, k => `#/itens?tipo=${encodeURIComponent(k)}`, total)}</div>`;
  }

  if (tab === 'natureza') {
    const g = groupRows(rows, r => r.item.natureza).sort((a, b) => NATUREZAS.indexOf(a[0]) - NATUREZAS.indexOf(b[0]));
    const ups = rows.filter(r => r.item.natureza === 'Upgrade');
    body = legend + `<div class="list">${barRows(g, k => k, k => `#/itens?nat=${k}`, total)}</div>
      <div class="section-title">Upgrades — referência × valor final</div>
      <div class="list">${ups.length ? ups.map(r => `<a class="li" href="#/item/${r.item.id}"><div class="grow"><div class="title clamp2">${esc(r.item.descricao)}</div>
        <div class="meta num">Ref. ${Number.isInteger(r.item.valorReferencia) ? money(r.item.valorReferencia) : '—'} → final ${money(r.totals.atualizado)}</div></div>
        <div class="amount num">${Number.isInteger(r.item.valorReferencia) ? '+' + money(r.totals.diffUpgrade) : '—'}</div></a>`).join('')
        + `<div class="li"><div class="grow title">Total da diferença</div><div class="amount num">${money(ups.reduce((s, r) => s + r.totals.diffUpgrade, 0))}</div></div>` : '<div class="empty">Nenhum upgrade.</div>'}</div>
      <div class="section-title">Retrabalho e imprevistos</div>
      <div class="list">${rows.filter(r => ['Retrabalho', 'Imprevisto'].includes(r.item.natureza)).map(r => `<a class="li" href="#/item/${r.item.id}"><div class="grow"><div class="title clamp2">${esc(r.item.descricao)}</div><div class="meta">${r.item.natureza} · ${esc(r.item.tipo)} · ${dateBR(r.item.dataCompra)}</div></div><div class="amount num">${money(r.totals.atualizado)}</div></a>`).join('') || '<div class="empty">Nenhum registro.</div>'}</div>`;
  }

  if (tab === 'mes') {
    const by = new Map();
    if (mesVisao === 'custo') for (const r of rows) { const k = r.item.dataCompra.slice(0, 7); by.set(k, (by.get(k) || 0) + r.totals.atualizado); }
    else {
      const ativos = new Set(rows.map(r => r.item.id));
      for (const p of ctx.payments) if (p.situacao === 'Realizado' && ativos.has(p.itemId)) { const k = (p.dataPago || p.data).slice(0, 7); by.set(k, (by.get(k) || 0) + p.valor); }
    }
    const ent = [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    const max = Math.max(1, ...ent.map(e => e[1]));
    body = `<div class="seg" style="margin-bottom:8px"><button data-mv="custo" class="${mesVisao === 'custo' ? 'on' : ''}">Custo (data da compra)</button><button data-mv="pag" class="${mesVisao === 'pag' ? 'on' : ''}">Pagamentos (data do pagamento)</button></div>
      <p class="tiny muted" style="margin:0 4px 10px">${mesVisao === 'custo' ? 'Quanto a obra custou em cada mês — cada item conta uma única vez, no mês da compra/contratação.' : 'Quanto efetivamente saiu do bolso em cada mês.'}</p>
      <div class="list">${ent.length ? ent.map(([k, v]) => `<div class="rep-row"><div class="top"><span>${monthLabel(k)}</span><b class="num">${money(v)}</b></div><div class="bar"><span class="paid" style="width:${(v / max) * 100}%"></span></div></div>`).join('') : '<div class="empty">Sem dados.</div>'}
      ${ent.length ? `<div class="rep-row"><div class="top"><b>Total</b><b class="num">${money(ent.reduce((s, e) => s + e[1], 0))}</b></div></div>` : ''}</div>`;
  }

  if (tab === 'futuro') {
    const ativos = new Set(rows.map(r => r.item.id));
    const by = new Map();
    for (const p of ctx.payments) if (p.situacao === 'Programado' && ativos.has(p.itemId)) { const k = p.data.slice(0, 7); by.set(k, (by.get(k) || 0) + p.valor); }
    const ent = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const max = Math.max(1, ...ent.map(e => e[1]));
    const semData = rows.reduce((s, r) => s + Math.max(0, r.totals.semData), 0);
    body = `<p class="tiny muted" style="margin:0 4px 10px">Pagamentos programados por mês de vencimento (inclui atrasados no mês original).</p>
      <div class="list">${ent.length ? ent.map(([k, v]) => `<a class="rep-row" href="#/pagamentos?sit=Programado"><div class="top"><span>${monthLabel(k)}</span><b class="num">${money(v)}</b></div><div class="bar"><span style="background:var(--info);width:${(v / max) * 100}%"></span></div></a>`).join('') : '<div class="empty">Nenhum compromisso programado.</div>'}
      <div class="rep-row"><div class="top"><span>Total programado</span><b class="num">${money(ent.reduce((s, e) => s + e[1], 0))}</b></div></div>
      <a class="rep-row" href="#/itens?semdata=1"><div class="top"><span>Saldo sem data definida (fora do cronograma)</span><b class="num" style="color:var(--accent)">${money(semData)}</b></div></a></div>`;
  }

  if (tab === 'ajustes') {
    const ativos = new Map(rows.map(r => [r.item.id, r.item]));
    const adj = ctx.adjustments.filter(a => ativos.has(a.itemId)).sort((a, b) => b.data.localeCompare(a.data));
    const s = (t) => adj.filter(a => a.status !== 'Cancelado' && a.tipo === t).reduce((x, a) => x + a.valor, 0);
    body = `<div class="kpis" style="margin-top:0">
        <div class="kpi"><div class="label">Aditivos</div><div class="value num">+ ${money(s('Aditivo'))}</div></div>
        <div class="kpi"><div class="label">Reduções</div><div class="value num">− ${money(s('Redução'))}</div></div>
        <div class="kpi"><div class="label">Descontos de quitação</div><div class="value num">− ${money(s('Desconto de quitação'))}</div></div>
        <div class="kpi"><div class="label">Aditivos líquidos</div><div class="value num">${money(s('Aditivo') - s('Redução'))}</div></div></div>
      <div class="section-title">Lançamentos</div>
      <div class="list">${adj.length ? adj.map(a => `<a class="li ${a.status === 'Cancelado' ? 'strike' : ''}" href="#/item/${a.itemId}"><div class="grow"><div class="title clamp2">${esc(ativos.get(a.itemId).descricao)} — ${esc(a.descricao)}</div><div class="meta">${a.tipo} · ${dateBR(a.data)}${a.status === 'Cancelado' ? ' · cancelado' : ''}</div></div><div class="amount num">${a.tipo === 'Aditivo' ? '+' : '−'} ${money(a.valor)}</div></a>`).join('') : '<div class="empty">Nenhum ajuste.</div>'}</div>`;
  }

  if (tab === 'cartao') {
    const parc = rows.filter(r => r.pays.some(p => p.totalParcelas > 1 && p.situacao !== 'Cancelado'));
    body = `<div class="list">${parc.length ? parc.map(r => {
      const ps = r.pays.filter(p => p.situacao !== 'Cancelado' && p.totalParcelas);
      const pagas = ps.filter(p => p.situacao === 'Realizado');
      const prox = ps.filter(p => p.situacao === 'Programado').sort((a, b) => a.data.localeCompare(b.data))[0];
      return `<a class="li" href="#/item/${r.item.id}"><div class="grow"><div class="title clamp2">${esc(r.item.descricao)}</div>
        <div class="meta">${esc(r.item.formaPagamento || '')}${r.item.cartao ? ' · ' + esc(r.item.cartao) : ''} · ${pagas.length}/${ps.length} pagas${prox ? ` · próxima ${dateBR(prox.data)}` : ''}</div></div>
        <div class="amount num">${money(r.totals.programado)}<div class="meta">a vencer</div></div></a>`;
    }).join('') : '<div class="empty">Nenhuma compra parcelada.</div>'}</div>`;
  }

  root.innerHTML = `
    <div class="pdf-cta card">
      <div><b>Relatório em PDF</b><div class="small muted">Resumo da obra, itens detalhados ou extrato de pagamentos, pronto para salvar, imprimir ou enviar.</div></div>
      <button class="btn primary" data-pdf>${icon('doc')} Gerar PDF</button>
    </div>
    <div class="tabs wrap">${TABS.map(([k, l]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/relatorios/${k}" style="text-decoration:none">${l}</a>`).join('')}</div>
    <div class="row between small" style="margin:0 4px 10px"><span class="muted">Custo total considerado</span><b class="num">${money(total)}</b></div>
    ${body}`;

  root.querySelector('[data-pdf]').addEventListener('click', () => pdfSheet(ctx));
  root.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', () => { mesVisao = b.dataset.mv; renderReports(root, ctx, 'mes'); }));
}
