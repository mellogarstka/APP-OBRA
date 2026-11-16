import * as S from '../store.js';
import { money, moneyPlain, parseMoney, todayISO, addMonths, dateBR } from '../fmt.js';
import { TIPOS, NATUREZAS, FORMAS, splitInstallments } from '../calc.js';
import { esc, toast } from '../ui.js';
import { handleError } from '../actions.js';

const MODOS = [
  ['avista', 'Pago à vista', 'Cria o item e um pagamento realizado na mesma data.'],
  ['entrada', 'Entrada + saldo conforme evolução', 'Registra a entrada; o restante fica como saldo sem data.'],
  ['parcelado', 'Parcelado com datas', 'Parcelas mensais com datas e valores editáveis.'],
  ['cartao', 'Cartão de crédito', 'Custo uma única vez; parcelas programadas nas faturas.'],
  ['semdata', 'Ainda não pago / sem data definida', 'Cria apenas o item; todo o valor fica sem data.'],
];

export async function renderNovo(root, ctx) {
  const ult = ctx.settings.ultimos || {};
  const cats = ctx.categories.filter(c => !c.parentId && c.ativo).sort((a, b) => a.ordem - b.ordem);
  const etapas = ctx.stages.filter(s => s.ativo).sort((a, b) => a.ordem - b.ordem);
  const st = { tipo: 'Material', natureza: 'Normal', modo: 'avista', parcelas: [] };

  root.innerHTML = `
    <form data-form autocomplete="off" novalidate>
      <label class="field"><span>Descrição <em>*</em></span><input class="input" name="descricao" placeholder="ex.: Pintura da casa, Vaso sanitário…" autofocus></label>
      <label class="field"><span>Valor total <em>*</em></span><input class="input money num" name="valor" inputmode="decimal" placeholder="0,00"></label>
      <div class="field"><span>Tipo de custo <em>*</em></span><div class="seg wrap" data-seg="tipo">${TIPOS.map(t => `<button type="button" data-v="${t}">${t}</button>`).join('')}</div></div>
      <label class="field"><span>Categoria <em>*</em></span><select class="input" name="categoriaId">${cats.map(c => `<option value="${c.id}" ${c.id === ult.categoriaId ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      <label class="field" data-subwrap><span>Subcategoria</span><select class="input" name="subcategoriaId"></select></label>
      <div>
        <label class="field"><span>Etapa <em>*</em></span><select class="input" name="etapaId">${etapas.map(s => `<option value="${s.id}" ${s.id === ult.etapaId ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}</select></label>
        <label class="field"><span>Data da compra/contratação <em>*</em></span><input class="input" type="date" name="dataCompra" value="${todayISO()}"></label>
      </div>

      <div class="section-title">Como será pago?</div>
      <div data-modos>
        ${MODOS.map(([k, t, d]) => `
          <label class="opt" data-opt="${k}"><input type="radio" name="modo" value="${k}" ${k === st.modo ? 'checked' : ''}><div><b>${t}</b><small>${d}</small></div></label>
          <div class="subform hidden" data-sub="${k}"></div>`).join('')}
      </div>

      <details class="more">
        <summary>Mais detalhes</summary>
        <div class="inner">
          <div class="field"><span>Natureza</span><div class="seg wrap" data-seg="natureza">${NATUREZAS.map(t => `<button type="button" data-v="${t}">${t}</button>`).join('')}</div></div>
          <label class="field hidden" data-ref><span>Valor de referência (o que seria gasto sem o upgrade)</span><input class="input num" name="valorReferencia" inputmode="decimal" placeholder="0,00"></label>
          <div class="grid2 hidden" data-misto>
            <label class="field"><span>Parcela de material</span><input class="input num" name="parcelaMaterial" inputmode="decimal" placeholder="0,00"></label>
            <label class="field"><span>Parcela de mão de obra</span><input class="input num" name="parcelaMO" inputmode="decimal" placeholder="0,00"></label>
          </div>
          <label class="field"><span>Fornecedor / profissional</span><input class="input" name="fornecedor" list="dl-forn" placeholder="digite para buscar ou cadastrar"></label>
          <datalist id="dl-forn">${ctx.suppliers.map(s => `<option value="${esc(s.nome)}">`).join('')}</datalist>
          <div class="grid2">
            <label class="field"><span>Forma de pagamento</span><select class="input" name="formaPagamento"><option value="">—</option>${FORMAS.map(f => `<option>${f}</option>`).join('')}</select></label>
            <label class="field"><span>Cartão utilizado</span><input class="input" name="cartao" placeholder="ex.: Nubank"></label>
          </div>
          <label class="field"><span>Observações</span><textarea class="input" name="obs"></textarea></label>
        </div>
      </details>

      <div class="sticky-save grid2">
        <button type="button" class="btn ghost block" data-save="novo">Salvar e novo</button>
        <button type="submit" class="btn primary block">Salvar</button>
      </div>
    </form>`;

  const f = root.querySelector('[data-form]');
  const q = (n) => f.querySelector(`[name=${n}]`);

  // segmentados
  const segs = {};
  f.querySelectorAll('[data-seg]').forEach(seg => {
    const key = seg.dataset.seg;
    segs[key] = seg;
    const paint = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === st[key]));
    paint();
    seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st[key] = b.dataset.v; paint(); syncDetails(); if (key === 'tipo') autoCategoria(); });
  });

  const syncDetails = () => {
    f.querySelector('[data-ref]').classList.toggle('hidden', st.natureza !== 'Upgrade');
    f.querySelector('[data-misto]').classList.toggle('hidden', st.tipo !== 'Serviço misto');
    if (st.natureza !== 'Normal' || st.tipo === 'Serviço misto') f.querySelector('details.more').open = true;
  };
  syncDetails();

  // categoria sugerida pelo tipo, enquanto o usuário não escolher manualmente
  let catManual = false;
  const SUG = { 'Mão de obra': 'Mão de obra', 'Equipamento': 'Equipamentos' };
  function autoCategoria() {
    if (catManual || !SUG[st.tipo]) return;
    const c = cats.find(x => x.nome === SUG[st.tipo]);
    if (c && q('categoriaId').value !== c.id) { q('categoriaId').value = c.id; syncSubs(); }
  }
  // subcategorias dependentes
  const syncSubs = () => {
    const subs = ctx.categories.filter(c => c.parentId === q('categoriaId').value && c.ativo).sort((a, b) => a.ordem - b.ordem);
    q('subcategoriaId').innerHTML = `<option value="">—</option>` + subs.map(s => `<option value="${s.id}" ${s.id === ult.subcategoriaId ? 'selected' : ''}>${esc(s.nome)}</option>`).join('');
    f.querySelector('[data-subwrap]').classList.toggle('hidden', !subs.length);
  };
  q('categoriaId').addEventListener('change', () => { catManual = true; syncSubs(); });
  syncSubs();

  // ---------- forma de pagamento ----------
  const total = () => { const v = parseMoney(q('valor').value); return Number.isInteger(v) && v > 0 ? v : 0; };

  const subHTML = {
    avista: () => `<label class="field"><span>Forma de pagamento</span><select class="input" name="formaAvista"><option value="">—</option>${FORMAS.filter(x => x !== 'Cartão de crédito').map(x => `<option>${x}</option>`).join('')}</select></label>`,
    entrada: () => `<div class="grid2">
        <label class="field"><span>Valor da entrada <em>*</em></span><input class="input num" name="valorEntrada" inputmode="decimal" placeholder="0,00"></label>
        <label class="field"><span>Data da entrada</span><input class="input" type="date" name="dataEntrada" value="${q('dataCompra').value}"></label></div>
        <div class="sumline" data-entrada-sum></div>`,
    parcelado: () => `<div class="grid2">
        <label class="field"><span>Nº de parcelas</span><input class="input" name="nParc" inputmode="numeric" value="3"></label>
        <label class="field"><span>1ª parcela</span><input class="input" type="date" name="dataParc" value="${addMonths(q('dataCompra').value || todayISO(), 1)}"></label></div>
        <label class="field"><span>Valor de cada parcela (opcional — padrão: total ÷ nº)</span><input class="input num" name="valorParc" inputmode="decimal" placeholder="automático"></label>
        <button type="button" class="btn ghost sm" data-gerar style="margin-bottom:12px">Gerar parcelas mensais</button>
        <div data-parcs></div>`,
    cartao: () => `<div class="grid2">
        <label class="field"><span>Nº de parcelas</span><input class="input" name="nCart" inputmode="numeric" value="1"></label>
        <label class="field"><span>1ª parcela (vencimento da fatura)</span><input class="input" type="date" name="dataCart" value="${addMonths(q('dataCompra').value || todayISO(), 1)}"></label></div>
        <div class="grid2">
          <label class="field"><span>Valor da parcela</span><input class="input num" name="valorCart" inputmode="decimal" placeholder="automático"></label>
          <label class="field"><span>Cartão</span><input class="input" name="cartaoNome" placeholder="ex.: Nubank"></label></div>
        <label class="check"><input type="checkbox" name="vencidasPagas" checked> Marcar parcelas já vencidas como pagas</label>
        <div data-cart-prev class="small"></div>`,
    semdata: () => `<p class="small muted" style="margin:0 0 10px">Nenhum pagamento ou vencimento será criado. O valor total aparecerá em "Sem data definida".</p>`,
  };

  const subs = Object.fromEntries([...f.querySelectorAll('[data-sub]')].map(el => [el.dataset.sub, el]));
  const showModo = () => {
    f.querySelectorAll('[data-opt]').forEach(o => o.classList.toggle('on', o.dataset.opt === st.modo));
    for (const [k, el] of Object.entries(subs)) {
      if (k === st.modo) { if (!el.dataset.ready) { el.innerHTML = subHTML[k](); el.dataset.ready = '1'; mountSub(k, el); } el.classList.remove('hidden'); }
      else el.classList.add('hidden');
    }
    refreshPreviews();
  };
  f.querySelectorAll('[name=modo]').forEach(r => r.addEventListener('change', () => { st.modo = r.value; showModo(); }));

  // parcelado: linhas editáveis
  const drawParcs = () => {
    const box = subs.parcelado.querySelector('[data-parcs]');
    if (!box) return;
    const soma = st.parcelas.reduce((s, p) => s + p.valor, 0);
    const tt = total();
    box.innerHTML = st.parcelas.length ? `
      <div class="parc tiny muted"><span class="n">#</span><span>Valor</span><span>Vencimento</span><span title="Já paga">Paga</span></div>
      ${st.parcelas.map((p, i) => `<div class="parc" data-i="${i}"><span class="n">${i + 1}</span>
        <input class="input num" data-k="valor" inputmode="decimal" value="${moneyPlain(p.valor)}">
        <input class="input" type="date" data-k="data" value="${p.data}">
        <input type="checkbox" data-k="pago" ${p.pago ? 'checked' : ''}></div>`).join('')}
      <div class="sumline"><span>Soma das parcelas</span><b>${money(soma)}</b></div>
      <div class="sumline ${soma > tt ? 'warn' : ''}"><span>${soma > tt ? 'Excede o valor total em' : 'Saldo sem data'}</span><b>${money(Math.abs(tt - soma))}</b></div>` : '<p class="tiny muted">Informe o valor total e toque em "Gerar parcelas mensais".</p>';
  };

  const genParcelas = () => {
    const tt = total();
    const n = Math.max(1, Math.min(120, parseInt(q('nParc').value) || 1));
    const d1 = q('dataParc').value || todayISO();
    const vp = parseMoney(q('valorParc').value);
    const vals = Number.isInteger(vp) && vp > 0 ? Array(n).fill(vp) : splitInstallments(tt, n);
    st.parcelas = vals.map((valor, i) => ({ valor, data: addMonths(d1, i), pago: false }));
    st.parcelasEditadas = false;
    drawParcs();
  };

  const cartParcelas = () => {
    const tt = total();
    const n = Math.max(1, Math.min(48, parseInt(q('nCart')?.value) || 1));
    const d1 = q('dataCart')?.value || todayISO();
    const vp = parseMoney(q('valorCart')?.value);
    let vals = splitInstallments(tt, n);
    if (Number.isInteger(vp) && vp > 0) { vals = Array(n).fill(vp); vals[n - 1] = tt - vp * (n - 1); }
    return vals.map((valor, i) => ({ valor, data: addMonths(d1, i) }));
  };

  const refreshPreviews = () => {
    const tt = total();
    if (st.modo === 'entrada') {
      const el = subs.entrada.querySelector('[data-entrada-sum]');
      const ve = parseMoney(q('valorEntrada')?.value);
      if (el) el.innerHTML = Number.isInteger(ve) && ve > 0 ? (ve > tt ? `<span style="color:var(--danger)">Entrada maior que o total</span><b></b>` : `<span>Saldo sem data</span><b>${money(tt - ve)}</b>`) : '';
    }
    if (st.modo === 'cartao') {
      const el = subs.cartao.querySelector('[data-cart-prev]');
      if (!el) return;
      if (!tt) { el.innerHTML = '<p class="tiny muted">Informe o valor total.</p>'; return; }
      const ps = cartParcelas();
      const hoje = todayISO();
      const marcar = q('vencidasPagas')?.checked;
      const last = ps[ps.length - 1];
      el.innerHTML = last.valor <= 0 ? `<p class="sumline warn">Valor da parcela incompatível com o total.</p>` : `
        <div class="sumline"><span>${ps.length}x de ${money(ps[0].valor)}${ps.length > 1 && last.valor !== ps[0].valor ? ` (última ${money(last.valor)})` : ''}</span><b>${money(tt)}</b></div>
        <div class="sumline"><span>${dateBR(ps[0].data)} → ${dateBR(last.data)}</span><span>${marcar ? ps.filter(p => p.data <= hoje).length + ' já paga(s)' : ''}</span></div>`;
    }
    if (st.modo === 'parcelado') drawParcs();
  };

  function mountSub(k, el) {
    el.addEventListener('input', refreshPreviews);
    el.addEventListener('change', refreshPreviews);
    if (k === 'parcelado') {
      el.querySelector('[data-gerar]').addEventListener('click', genParcelas);
      el.querySelector('[data-parcs]').addEventListener('change', (e) => {
        const row = e.target.closest('[data-i]'); if (!row) return;
        const p = st.parcelas[+row.dataset.i]; const k2 = e.target.dataset.k;
        if (k2 === 'valor') { const v = parseMoney(e.target.value); if (Number.isInteger(v) && v > 0) p.valor = v; }
        else if (k2 === 'data') p.data = e.target.value;
        else if (k2 === 'pago') p.pago = e.target.checked;
        st.parcelasEditadas = true;
        drawParcs();
      });
      if (total()) genParcelas(); else drawParcs();
    }
  }
  q('valor').addEventListener('input', () => { if (st.modo === 'parcelado' && st.parcelas.length && !st.parcelasEditadas) genParcelas(); refreshPreviews(); });
  showModo();

  // ---------- salvar ----------
  const save = async (again) => {
    const valor = parseMoney(q('valor').value);
    q('valor').classList.toggle('invalid', !(Number.isInteger(valor) && valor > 0));
    q('descricao').classList.toggle('invalid', !q('descricao').value.trim());
    if (!q('descricao').value.trim()) { q('descricao').focus(); return toast('Informe a descrição.', true); }
    if (!(Number.isInteger(valor) && valor > 0)) { q('valor').focus(); return toast('Informe um valor válido.', true); }
    const optMoney = (n) => { const v = parseMoney(q(n)?.value); return Number.isInteger(v) ? v : null; };

    const data = {
      descricao: q('descricao').value, valorOriginal: valor, tipo: st.tipo, natureza: st.natureza,
      categoriaId: q('categoriaId').value, subcategoriaId: q('subcategoriaId').value || null, etapaId: q('etapaId').value,
      dataCompra: q('dataCompra').value, fornecedorNome: q('fornecedor').value,
      formaPagamento: q('formaPagamento').value || null, cartao: q('cartao').value.trim() || null, obs: q('obs').value.trim(),
      valorReferencia: optMoney('valorReferencia'), parcelaMaterial: optMoney('parcelaMaterial'), parcelaMO: optMoney('parcelaMO'),
    };
    let plano = { modo: st.modo };
    if (st.modo === 'avista') { data.formaPagamento = q('formaAvista').value || data.formaPagamento; }
    if (st.modo === 'entrada') plano = { modo: 'entrada', valorEntrada: parseMoney(q('valorEntrada').value), dataEntrada: q('dataEntrada').value };
    if (st.modo === 'parcelado') { if (!st.parcelas.length) genParcelas(); plano = { modo: 'parcelado', parcelas: st.parcelas }; }
    if (st.modo === 'cartao') {
      data.formaPagamento = 'Cartão de crédito';
      data.cartao = q('cartaoNome').value.trim() || data.cartao;
      plano = { modo: 'cartao', parcelas: cartParcelas(), marcarVencidasPagas: q('vencidasPagas').checked };
    }
    try {
      const item = await S.createItem(data, plano);
      toast('Lançamento salvo.');
      if (again) { location.hash = '#/novo?t=' + Date.now(); }
      else location.hash = `#/item/${item.id}`;
    } catch (e) { handleError(e); }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
  f.querySelector('[data-save=novo]').addEventListener('click', () => save(true));
}
