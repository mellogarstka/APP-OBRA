import * as S from '../store.js';
import { money, moneyPlain, parseMoney, dateBR, dateTimeBR, todayISO } from '../fmt.js';
import { TIPOS, NATUREZAS, FORMAS } from '../calc.js';
import { esc, sheet, toast, confirmSheet, icon } from '../ui.js';
import { paymentSheet, markPaidSheet, adjustmentSheet, correctSheet, cancelPaymentFlow, editPaymentSheet, cancelAdjustmentFlow, handleError, refresh } from '../actions.js';
import { pill } from './home.js';

const statusTag = (s) => `<span class="tag ${s === 'Quitado' ? 'ok' : s === 'Cancelado' ? 'danger' : 'brand'}">${s}</span>`;
const natTag = (n) => n === 'Normal' ? '' : `<span class="tag ${n === 'Upgrade' ? 'info' : 'warn'}">${n}</span>`;

export async function renderItem(root, ctx, id) {
  let b;
  try { b = await S.getBundle(id); } catch { root.innerHTML = '<div class="empty">Item não encontrado.</div>'; return; }
  const { item, totals: t, status } = b;
  const cancelado = item.status === 'Cancelado';
  const hoje = todayISO();
  const prog = b.pays.filter(p => p.situacao === 'Programado').sort((a, c) => a.data.localeCompare(c.data));
  const real = b.pays.filter(p => p.situacao === 'Realizado').sort((a, c) => (c.dataPago || c.data).localeCompare(a.dataPago || a.data));
  const canc = b.pays.filter(p => p.situacao === 'Cancelado');
  const sub = item.subcategoriaId ? ctx.catName(item.subcategoriaId) : '';

  root.innerHTML = `
    <div class="layout-2 item-layout">
    <section class="col-main sticky-col">
    <div class="card item-head">
      <div class="row between" style="align-items:flex-start">
        <h2>${esc(item.descricao)}</h2>
        <button class="icon-btn" data-edit title="Editar dados" style="color:var(--ink-2);margin:-8px -8px 0 0">✎</button>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:6px">${statusTag(status)} ${natTag(item.natureza)} <span class="tag">${esc(item.tipo)}</span> ${item.incompleto ? '<span class="tag danger">Incompleto</span>' : ''}</div>
      <div class="small muted" style="margin-top:10px;line-height:1.5">
        ${esc(ctx.catName(item.categoriaId))}${sub ? ' › ' + esc(sub) : ''} · ${esc(ctx.stageName(item.etapaId))}<br>
        ${item.fornecedorId ? esc(ctx.supName(item.fornecedorId)) + ' · ' : ''}Compra em ${dateBR(item.dataCompra)}${item.formaPagamento ? ' · ' + esc(item.formaPagamento) : ''}${item.cartao ? ' (' + esc(item.cartao) + ')' : ''}
      </div>
      ${item.obs ? `<p class="small" style="margin:10px 0 0;white-space:pre-wrap">${esc(item.obs)}</p>` : ''}

      <div class="summary num">
        <div><div class="label">Valor original</div><div class="value">${money(t.original)}</div></div>
        <div><div class="label">Aditivos / ajustes</div><div class="value">${t.aditivos - t.reducoes - t.descontos >= 0 ? '+' : '−'} ${money(Math.abs(t.aditivos - t.reducoes - t.descontos))}</div></div>
        <div><div class="label">Valor atualizado</div><div class="value strong">${money(t.atualizado)}</div></div>
        <div><div class="label">Total pago</div><div class="value" style="color:var(--ok)">${money(t.pago)}</div></div>
        <div><div class="label">Programado</div><div class="value" style="color:var(--info)">${money(t.programado)}</div></div>
        <div><div class="label">Saldo pendente</div><div class="value">${money(t.pendente)}</div></div>
        <div><div class="label">Sem data definida</div><div class="value" style="color:var(--accent)">${money(t.semData)}</div></div>
        <div><div class="label">${item.natureza === 'Upgrade' && Number.isInteger(item.valorReferencia) ? 'Diferença de upgrade' : '% pago'}</div><div class="value">${item.natureza === 'Upgrade' && Number.isInteger(item.valorReferencia) ? money(t.diffUpgrade) : t.pctPago.toFixed(0) + '%'}</div></div>
      </div>
      ${item.natureza === 'Upgrade' && Number.isInteger(item.valorReferencia) ? `<div class="tiny muted" style="margin-top:6px">Referência: ${money(item.valorReferencia)}</div>` : ''}
      ${item.tipo === 'Serviço misto' && Number.isInteger(item.parcelaMaterial) ? `<div class="tiny muted" style="margin-top:6px">Material ${money(item.parcelaMaterial)} · Mão de obra ${money(item.parcelaMO)}</div>` : ''}
      <div class="progress"><span style="width:${t.pctPago.toFixed(1)}%"></span></div>
    </div>

    ${cancelado ? '<div class="banner danger" style="margin-top:12px">Item cancelado — não entra nos totais da obra.</div>' : `
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" data-a="pagar">Registrar pagamento</button>
      <button class="btn ghost" data-a="programar">Programar pagamento</button>
      <button class="btn ghost" data-a="ajuste">Aditivo / redução / desconto</button>
      <button class="btn ghost" data-a="corrigir">Corrigir valor original</button>
      <button class="btn danger-ghost" data-a="cancelar" style="grid-column:1/-1">Cancelar item</button>
    </div>`}

    </section>
    <section class="col-side">
    <div class="section-title">Pagamentos programados</div>
    <div class="list">${prog.length ? prog.map(p => `
      <div class="li">${pill(p.data, p.data < hoje ? 'late' : p.data === hoje ? 'today' : '')}
        <div class="grow"><div class="title num">${money(p.valor)}</div><div class="meta">${p.parcela ? `Parcela ${p.parcela}/${p.totalParcelas} · ` : ''}${esc(p.descricao || p.forma || '')}</div></div>
        ${cancelado ? '' : `<div class="right"><button class="quick-pay" data-pay="${p.id}">Marcar pago</button></div><button class="icon-btn" data-ep="${p.id}" title="Corrigir pagamento" aria-label="Corrigir pagamento">${icon('edit')}</button><button class="icon-btn" data-cp="${p.id}" title="Cancelar pagamento" aria-label="Cancelar pagamento" style="color:var(--ink-3)">✕</button>`}
      </div>`).join('') : '<div class="empty">Nenhum pagamento programado.</div>'}</div>

    <div class="section-title">Pagamentos realizados</div>
    <div class="list">${real.length ? real.map(p => `
      <div class="li">${pill(p.dataPago || p.data)}
        <div class="grow"><div class="title num">${money(p.valor)}</div><div class="meta">${p.parcela ? `Parcela ${p.parcela}/${p.totalParcelas} · ` : ''}${esc([p.descricao, p.forma].filter(Boolean).join(' · '))}${p.dataNaoInformada ? ' · <span class="tag warn">data não informada</span>' : ''}</div></div>
        ${cancelado ? '' : `<button class="icon-btn" data-ep="${p.id}" title="Corrigir pagamento" aria-label="Corrigir pagamento">${icon('edit')}</button><button class="icon-btn" data-cp="${p.id}" title="Cancelar" aria-label="Cancelar pagamento" style="color:var(--ink-3)">✕</button>`}
      </div>`).join('') : '<div class="empty">Nenhum pagamento realizado.</div>'}
      ${canc.map(p => `<div class="li strike"><div class="grow"><div class="title num">${money(p.valor)}</div><div class="meta">Cancelado · ${dateBR(p.dataPago || p.data)}</div></div></div>`).join('')}
    </div>

    <div class="section-title">Aditivos e ajustes</div>
    <div class="list">${b.adj.length ? b.adj.sort((a, c) => a.criadoEm - c.criadoEm).map(a => `
      <div class="li ${a.status === 'Cancelado' ? 'strike' : ''}">
        <div class="grow"><div class="title">${esc(a.descricao)}</div><div class="meta">${a.tipo} · ${dateBR(a.data)}${Number.isInteger(a.valorMaterial) ? ` · material ${money(a.valorMaterial)} · MO ${money(a.valor - a.valorMaterial)}` : ''}${a.obs ? ' · ' + esc(a.obs) : ''}${a.status === 'Cancelado' ? ' · Cancelado' : ''}</div></div>
        <div class="amount num">${a.tipo === 'Aditivo' ? '+' : '−'} ${money(a.valor)}</div>
        ${a.status !== 'Cancelado' && !cancelado ? `<button class="icon-btn" data-ca="${a.id}" title="Cancelar" style="color:var(--ink-3)">✕</button>` : ''}
      </div>`).join('') : '<div class="empty">Nenhum aditivo ou ajuste.</div>'}</div>

    <div class="section-title">Anexos</div>
    <div class="list"><div class="empty">Anexos (notas, recibos, fotos) chegam na próxima fase.</div></div>

    <div class="section-title">Histórico</div>
    <div class="list">${b.history.map(h => `
      <div class="hist"><div class="when">${dateTimeBR(h.ts)} · ${esc(h.entity)}</div>
        <div><b>${esc(h.acao)}</b>${h.campo ? ` — ${esc(h.campo)}` : ''}</div>
        ${h.anterior || h.novo ? `<div class="chg">${h.anterior ? esc(h.anterior) + ' → ' : ''}${esc(h.novo || '')}</div>` : ''}
        ${h.motivo ? `<div class="tiny muted">Motivo: ${esc(h.motivo)}</div>` : ''}</div>`).join('') || '<div class="empty">Sem registros.</div>'}</div>
    </section>
    </div>
  `;

  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-a],[data-pay],[data-cp],[data-ep],[data-ca],[data-edit]');
    if (!el) return;
    if (el.dataset.pay) return markPaidSheet(b.pays.find(p => p.id === el.dataset.pay), item.descricao);
    if (el.dataset.ep) return editPaymentSheet(b.pays.find(p => p.id === el.dataset.ep));
    if (el.dataset.cp) return cancelPaymentFlow(b.pays.find(p => p.id === el.dataset.cp));
    if (el.dataset.ca) return cancelAdjustmentFlow(b.adj.find(a => a.id === el.dataset.ca));
    if (el.hasAttribute('data-edit')) return editSheet(ctx, item);
    switch (el.dataset.a) {
      case 'pagar': return paymentSheet(id, 'Realizado');
      case 'programar': return paymentSheet(id, 'Programado');
      case 'ajuste': return adjustmentSheet(id);
      case 'corrigir': return correctSheet(id);
      case 'cancelar': {
        if (real.length) return toast(`Este item possui ${real.length} pagamento(s) realizado(s). Cancele-os ou registre uma redução antes.`, true);
        const r = await confirmSheet({ title: 'Cancelar item', text: `<b>${esc(item.descricao)}</b> deixará de contar nos totais da obra.${prog.length ? ` Os ${prog.length} pagamento(s) programado(s) também serão cancelados.` : ''} O registro permanece no histórico.`, confirmLabel: 'Cancelar item' });
        if (!r) return;
        try { await S.cancelItem(id, r.motivo); toast('Item cancelado.'); refresh(); } catch (err) { handleError(err); }
      }
    }
  }, { once: false });
}

/** Edição dos dados não financeiros do item (o valor só muda por ajuste ou correção). */
function editSheet(ctx, item) {
  const cats = ctx.categories.filter(c => !c.parentId && (c.ativo || c.id === item.categoriaId));
  const etapas = ctx.stages.filter(s => s.ativo || s.id === item.etapaId);
  const opt = (arr, sel) => arr.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.nome)}</option>`).join('');
  const sopt = (arr, sel) => arr.map(x => `<option ${x === sel ? 'selected' : ''}>${x}</option>`).join('');
  sheet('Editar dados do item', `
    <p class="tiny muted" style="margin-top:-8px">Valores financeiros mudam apenas por aditivo, redução, desconto ou correção.</p>
    <label class="field"><span>Descrição</span><input class="input" name="descricao" value="${esc(item.descricao)}"></label>
    <div class="grid2">
      <label class="field"><span>Tipo</span><select class="input" name="tipo">${sopt(TIPOS, item.tipo)}</select></label>
      <label class="field"><span>Natureza</span><select class="input" name="natureza">${sopt(NATUREZAS, item.natureza)}</select></label>
    </div>
    <label class="field"><span>Categoria</span><select class="input" name="categoriaId">${opt(cats, item.categoriaId)}</select></label>
    <label class="field"><span>Subcategoria</span><select class="input" name="subcategoriaId"></select></label>
    <div class="grid2">
      <label class="field"><span>Etapa</span><select class="input" name="etapaId">${opt(etapas, item.etapaId)}</select></label>
      <label class="field"><span>Data da compra</span><input class="input" type="date" name="dataCompra" value="${item.dataCompra}"></label>
    </div>
    <label class="field" data-ref><span>Valor de referência (upgrade)</span><input class="input num" name="valorReferencia" inputmode="decimal" value="${Number.isInteger(item.valorReferencia) ? moneyPlain(item.valorReferencia) : ''}"></label>
    <div class="grid2" data-misto>
      <label class="field"><span>Parcela material</span><input class="input num" name="parcelaMaterial" inputmode="decimal" value="${Number.isInteger(item.parcelaMaterial) ? moneyPlain(item.parcelaMaterial) : ''}"></label>
      <label class="field"><span>Parcela mão de obra</span><input class="input num" name="parcelaMO" inputmode="decimal" value="${Number.isInteger(item.parcelaMO) ? moneyPlain(item.parcelaMO) : ''}"></label>
    </div>
    <label class="field"><span>Fornecedor</span><input class="input" name="fornecedor" list="dl-forn2" value="${esc(ctx.supName(item.fornecedorId) || '')}"></label>
    <datalist id="dl-forn2">${ctx.suppliers.map(s => `<option value="${esc(s.nome)}">`).join('')}</datalist>
    <div class="grid2">
      <label class="field"><span>Forma de pagamento</span><select class="input" name="formaPagamento"><option value="">—</option>${sopt(FORMAS, item.formaPagamento)}</select></label>
      <label class="field"><span>Cartão</span><input class="input" name="cartao" value="${esc(item.cartao || '')}"></label>
    </div>
    <label class="field"><span>Observações</span><textarea class="input" name="obs">${esc(item.obs || '')}</textarea></label>
    ${item.incompleto ? '<label class="check"><input type="checkbox" name="completo"> Marcar como completo</label>' : ''}
    <div class="sheet-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Salvar</button></div>`,
  (el, close) => {
    const q = (n) => el.querySelector(`[name=${n}]`);
    const syncSubs = () => {
      const subs = ctx.categories.filter(c => c.parentId === q('categoriaId').value && (c.ativo || c.id === item.subcategoriaId));
      q('subcategoriaId').innerHTML = '<option value="">—</option>' + opt(subs, item.subcategoriaId);
    };
    const syncVis = () => {
      el.querySelector('[data-ref]').classList.toggle('hidden', q('natureza').value !== 'Upgrade');
      el.querySelector('[data-misto]').classList.toggle('hidden', q('tipo').value !== 'Serviço misto');
    };
    q('categoriaId').addEventListener('change', syncSubs); syncSubs();
    q('natureza').addEventListener('change', syncVis); q('tipo').addEventListener('change', syncVis); syncVis();
    el.querySelector('[data-ok]').addEventListener('click', async () => {
      const m = (n) => { const v = parseMoney(q(n).value); return Number.isInteger(v) ? v : null; };
      const tipo = q('tipo').value, natureza = q('natureza').value;
      const changes = {
        descricao: q('descricao').value.trim(), tipo, natureza, categoriaId: q('categoriaId').value, subcategoriaId: q('subcategoriaId').value || null,
        etapaId: q('etapaId').value, dataCompra: q('dataCompra').value, fornecedorNome: q('fornecedor').value,
        formaPagamento: q('formaPagamento').value || null, cartao: q('cartao').value.trim() || null, obs: q('obs').value.trim(),
        valorReferencia: natureza === 'Upgrade' ? m('valorReferencia') : null,
        parcelaMaterial: tipo === 'Serviço misto' ? m('parcelaMaterial') : null, parcelaMO: tipo === 'Serviço misto' ? m('parcelaMO') : null,
      };
      if (q('completo')?.checked) changes.incompleto = false;
      const lbl = { categoriaId: ctx.catName, subcategoriaId: ctx.catName, etapaId: ctx.stageName, fornecedorId: ctx.supName };
      try { await S.updateItem(item.id, changes, lbl); close(); toast('Dados atualizados.'); refresh(); } catch (err) { handleError(err); }
    });
  });
}
