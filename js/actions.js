// Folhas de ação reutilizadas por várias telas (pagamento, marcar pago, ajustes, correção).
import * as S from './store.js';
import { money, moneyPlain, parseMoney, todayISO, dateBR } from './fmt.js';
import { FORMAS, proportionalMaterial } from './calc.js';
import { sheet, toast, esc, excedeHTML, confirmSheet } from './ui.js';

export let refresh = () => {};
export function setRefresh(fn) { refresh = fn; }

/** Trata erros de validação de forma padronizada (com atalho para aditivo, item 9). */
export function handleError(e) {
  if (e?.name !== 'ValidationError') { console.error(e); toast('Erro inesperado: ' + (e?.message || e), true); return; }
  if (e.detail?.tipo === 'excede') {
    const temItem = !!e.detail.itemId;
    sheet('Pagamento bloqueado', excedeHTML(e.detail) + `
      <div class="sheet-actions">
        <button class="btn ghost" data-close>Corrigir valor</button>
        ${temItem ? '<button class="btn accent" data-adit>Registrar aditivo</button>' : '<span></span>'}
      </div>`, (el, close) => {
      el.querySelector('[data-adit]')?.addEventListener('click', () => {
        close();
        adjustmentSheet(e.detail.itemId, { tipo: 'Aditivo', valor: e.detail.excedente });
      });
    });
    return;
  }
  toast(e.message, true);
}

const formaOptions = (sel) => `<option value="">—</option>` + FORMAS.map(f => `<option ${f === sel ? 'selected' : ''}>${f}</option>`).join('');

function readMoney(el, name) {
  const inp = el.querySelector(`[name=${name}]`);
  const v = parseMoney(inp.value);
  inp.classList.toggle('invalid', !(Number.isInteger(v) && v > 0));
  return v;
}

/** Registrar (Realizado) ou programar (Programado) pagamento. */
export async function paymentSheet(itemId, situacao = 'Realizado') {
  const b = await S.getBundle(itemId);
  const disponivel = b.totals.atualizado - b.totals.pago - b.totals.programado;
  const prog = situacao === 'Programado';
  sheet(prog ? 'Programar pagamento' : 'Registrar pagamento', `
    <p class="small muted" style="margin-top:-6px">${esc(b.item.descricao)} · disponível <b class="num">${money(disponivel)}</b></p>
    <label class="field"><span>Valor <em>*</em></span><input class="input money num" name="valor" inputmode="decimal" placeholder="0,00" autocomplete="off" autofocus></label>
    <div class="row" style="margin:-6px 0 12px"><button class="btn ghost sm" type="button" data-all>Usar saldo disponível (${money(disponivel)})</button></div>
    <div class="grid2">
      <label class="field"><span>${prog ? 'Vencimento' : 'Data do pagamento'} <em>*</em></span><input class="input" type="date" name="data" value="${todayISO()}" required></label>
      <label class="field"><span>Forma</span><select class="input" name="forma">${formaOptions(b.item.formaPagamento)}</select></label>
    </div>
    <div class="grid2">
      <label class="field"><span>Parcela nº</span><input class="input" name="parcela" inputmode="numeric" placeholder="ex.: 2"></label>
      <label class="field"><span>de</span><input class="input" name="totalParcelas" inputmode="numeric" placeholder="ex.: 3"></label>
    </div>
    <label class="field"><span>Descrição</span><input class="input" name="descricao" autocomplete="off"></label>
    <div class="sheet-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Salvar</button></div>`,
  (el, close) => {
    el.querySelector('[data-all]').addEventListener('click', () => { el.querySelector('[name=valor]').value = moneyPlain(Math.max(0, disponivel)); });
    el.querySelector('[data-ok]').addEventListener('click', async () => {
      const valor = readMoney(el, 'valor');
      if (!(valor > 0)) return;
      const f = (n) => el.querySelector(`[name=${n}]`).value;
      try {
        await S.addPayment(itemId, { valor, situacao, data: f('data'), forma: f('forma'), descricao: f('descricao'),
          parcela: parseInt(f('parcela')) || null, totalParcelas: parseInt(f('totalParcelas')) || null });
        close(); toast(prog ? 'Pagamento programado.' : 'Pagamento registrado.'); refresh();
      } catch (e) { handleError(e); }
    });
  });
}

/** Corrigir pagamento (valor, data, forma, descrição, parcela). */
export async function editPaymentSheet(payment) {
  const real = payment.situacao === 'Realizado';
  const dataAtual = real ? (payment.dataPago || payment.data) : payment.data;
  sheet('Corrigir pagamento', `
    <p class="small muted" style="margin-top:-6px">${real ? 'Pagamento realizado' : 'Pagamento programado'} · as alterações ficam registradas no histórico.</p>
    <div class="grid2">
      <label class="field"><span>Valor <em>*</em></span><input class="input money num" name="valor" inputmode="decimal" value="${moneyPlain(payment.valor)}"></label>
      <label class="field"><span>${real ? 'Data do pagamento' : 'Vencimento'} <em>*</em></span><input class="input" type="date" name="data" value="${dataAtual}"></label>
    </div>
    <div class="grid2">
      <label class="field"><span>Forma</span><select class="input" name="forma">${formaOptions(payment.forma)}</select></label>
      <label class="field"><span>Parcela (nº / de)</span><div class="grid2" style="gap:6px"><input class="input" name="parcela" inputmode="numeric" value="${payment.parcela || ''}"><input class="input" name="totalParcelas" inputmode="numeric" value="${payment.totalParcelas || ''}"></div></label>
    </div>
    <label class="field"><span>Descrição</span><input class="input" name="descricao" value="${esc(payment.descricao || '')}" autocomplete="off"></label>
    <label class="field"><span>Motivo da correção (opcional)</span><input class="input" name="motivo" placeholder="ex.: data digitada errada" autocomplete="off"></label>
    <div class="sheet-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Salvar correção</button></div>`,
  (el, close) => {
    el.querySelector('[data-ok]').addEventListener('click', async () => {
      const valor = readMoney(el, 'valor');
      if (!(valor > 0)) return;
      const f = (n) => el.querySelector(`[name=${n}]`).value;
      try {
        const r = await S.editPayment(payment.id, { valor, data: f('data'), forma: f('forma'), descricao: f('descricao').trim(),
          parcela: parseInt(f('parcela')) || null, totalParcelas: parseInt(f('totalParcelas')) || null }, f('motivo').trim());
        close(); toast(r === payment ? 'Nenhuma alteração.' : 'Pagamento corrigido.'); refresh();
      } catch (e) { handleError(e); }
    });
  });
}

/** "Marcar como pago" — data e valor editáveis; se pagar a menos, pergunta o destino do restante. */
export async function markPaidSheet(payment, itemDesc = '') {
  sheet('Marcar como pago', `
    <p class="small muted" style="margin-top:-6px">${esc(itemDesc)}${payment.parcela ? ` · parcela ${payment.parcela}/${payment.totalParcelas}` : ''} · vencimento ${dateBR(payment.data)}</p>
    <label class="field"><span>Valor pago</span><input class="input money num" name="valor" inputmode="decimal" value="${moneyPlain(payment.valor)}"></label>
    <label class="field"><span>Data em que foi pago</span><input class="input" type="date" name="data" value="${todayISO()}"></label>
    <div class="hidden" data-rest>
      <div class="banner info" style="margin-bottom:8px"><span>Pagou <b data-rest-v></b> a menos que o programado. O que fazer com o restante?</span></div>
      <div class="restante-opts">
        <label class="opt"><input type="radio" name="rest" value="mesma" checked><div><b>Continua devido na mesma data</b><small>Fica programado para ${dateBR(payment.data)}.</small></div></label>
        <label class="opt"><input type="radio" name="rest" value="outra"><div><b>Devido em outra data</b><small>Programa o restante para a data escolhida.</small></div></label>
        <label class="field hidden" data-rest-data style="margin:0 0 0 34px"><span>Nova data</span><input class="input" type="date" name="restData" value="${payment.data > todayISO() ? payment.data : todayISO()}"></label>
        <label class="opt"><input type="radio" name="rest" value="semdata"><div><b>Ainda devido, sem data</b><small>Vira saldo sem data definida.</small></div></label>
        <label class="opt"><input type="radio" name="rest" value="desconto"><div><b>Foi desconto (não será pago)</b><small>Registra desconto de quitação e reduz o valor do item.</small></div></label>
      </div>
    </div>
    <div class="sheet-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok autofocus>Confirmar pagamento</button></div>`,
  (el, close) => {
    const inp = el.querySelector('[name=valor]');
    const modo = () => el.querySelector('[name=rest]:checked').value;
    const upd = () => {
      const v = parseMoney(inp.value);
      const diff = Number.isInteger(v) && v > 0 ? payment.valor - v : 0;
      el.querySelector('[data-rest]').classList.toggle('hidden', !(diff > 0));
      if (diff > 0) el.querySelector('[data-rest-v]').textContent = money(diff);
      el.querySelector('[data-rest-data]').classList.toggle('hidden', modo() !== 'outra');
    };
    inp.addEventListener('input', upd);
    el.querySelectorAll('[name=rest]').forEach(r => r.addEventListener('change', upd));
    upd();
    el.querySelector('[data-ok]').addEventListener('click', async () => {
      const valor = readMoney(el, 'valor');
      if (!(valor > 0)) return;
      const restante = valor < payment.valor ? { modo: modo(), data: el.querySelector('[name=restData]').value } : null;
      try {
        await S.markPaid(payment.id, { valor, dataPago: el.querySelector('[name=data]').value, restante });
        close(); toast('Pagamento confirmado.'); refresh();
      } catch (e) { handleError(e); }
    });
  });
}

/** Aditivo / Redução / Desconto de quitação. */
export async function adjustmentSheet(itemId, preset = {}) {
  const b = await S.getBundle(itemId);
  let tipo = preset.tipo || 'Aditivo';
  const help = {
    'Aditivo': 'Acréscimo real de escopo ou valor. Numerado automaticamente.',
    'Redução': 'Diminuição de escopo. Não pode deixar o valor abaixo de pago + programado.',
    'Desconto de quitação': 'Fornecedor aceitou encerrar com valor menor. Use para quitar o saldo.',
  };
  const misto = b.item.tipo === 'Serviço misto' && proportionalMaterial(b.item, 100) !== null;
  const pctMat = misto ? Math.round(b.item.parcelaMaterial * 100 / (b.item.parcelaMaterial + b.item.parcelaMO)) : 0;
  sheet('Ajuste de valor', `
    <p class="small muted" style="margin-top:-6px">${esc(b.item.descricao)} · valor atualizado <b class="num">${money(b.totals.atualizado)}</b> · pendente <b class="num">${money(b.totals.pendente)}</b></p>
    <div class="seg" data-seg style="margin-bottom:8px">${['Aditivo', 'Redução', 'Desconto de quitação'].map(t => `<button type="button" data-v="${t}" class="${t === tipo ? 'on' : ''}">${t === 'Desconto de quitação' ? 'Desconto' : t}</button>`).join('')}</div>
    <p class="tiny muted" data-help style="margin:0 0 12px">${help[tipo]}</p>
    <label class="field"><span>Valor (sempre positivo) <em>*</em></span><input class="input money num" name="valor" inputmode="decimal" placeholder="0,00" value="${preset.valor ? moneyPlain(preset.valor) : ''}" autofocus></label>
    <div class="row" style="margin:-6px 0 12px" data-quitar-wrap><button class="btn ghost sm" type="button" data-quitar>Descontar todo o saldo (${money(b.totals.pendente - b.totals.programado)})</button></div>
    ${misto ? `<div class="grid2" data-split>
      <label class="field"><span>Parte de material</span><input class="input num" name="valorMaterial" inputmode="decimal" placeholder="0,00"></label>
      <label class="field"><span>Parte de mão de obra</span><input class="input num" name="valorMO" inputmode="decimal" placeholder="0,00"></label>
    </div><p class="tiny muted" style="margin:-6px 0 12px">Preenchido na proporção do cadastro (${pctMat}% material). Ajuste se este aditivo for só material ou só mão de obra.</p>` : ''}
    <label class="field"><span>Descrição</span><input class="input" name="descricao" placeholder="automática se vazia" autocomplete="off"></label>
    <label class="field"><span>Data</span><input class="input" type="date" name="data" value="${todayISO()}"></label>
    <label class="field"><span>Observação</span><input class="input" name="obs" autocomplete="off"></label>
    <div class="sheet-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Registrar</button></div>`,
  (el, close) => {
    const qw = el.querySelector('[data-quitar-wrap]');
    if (misto) {
      const vIn = el.querySelector('[name=valor]'), mIn = el.querySelector('[name=valorMaterial]'), oIn = el.querySelector('[name=valorMO]');
      const fromTotal = () => { const v = parseMoney(vIn.value); if (Number.isInteger(v) && v > 0) { const m = proportionalMaterial(b.item, v); mIn.value = moneyPlain(m); oIn.value = moneyPlain(v - m); } };
      const rest = (src, dst) => { const v = parseMoney(vIn.value), x = parseMoney(src.value); if (Number.isInteger(v) && Number.isInteger(x)) dst.value = moneyPlain(Math.max(0, v - x)); };
      vIn.addEventListener('input', fromTotal);
      mIn.addEventListener('input', () => rest(mIn, oIn));
      oIn.addEventListener('input', () => rest(oIn, mIn));
      el._origQuitar = fromTotal;
      fromTotal();
    }
    const sync = () => { qw.classList.toggle('hidden', tipo !== 'Desconto de quitação'); el.querySelector('[data-help]').textContent = help[tipo]; };
    sync();
    el.querySelectorAll('[data-seg] button').forEach(btn => btn.addEventListener('click', () => {
      tipo = btn.dataset.v; el.querySelectorAll('[data-seg] button').forEach(x => x.classList.toggle('on', x === btn)); sync();
    }));
    el.querySelector('[data-quitar]').addEventListener('click', () => { el.querySelector('[name=valor]').value = moneyPlain(b.totals.pendente - b.totals.programado); el._origQuitar?.(); });
    el.querySelector('[data-ok]').addEventListener('click', async () => {
      const valor = readMoney(el, 'valor');
      if (!(valor > 0)) return;
      const f = (n) => el.querySelector(`[name=${n}]`).value.trim();
      try {
        let valorMaterial;
        if (misto) {
          const m = parseMoney(f('valorMaterial')), o = parseMoney(f('valorMO'));
          if (!Number.isInteger(m) || !Number.isInteger(o) || m < 0 || o < 0 || m + o !== valor) { toast(`Material + mão de obra deve somar ${money(valor)}.`, true); return; }
          valorMaterial = m;
        }
        const a = await S.addAdjustment(itemId, { tipo, valor, valorMaterial, descricao: f('descricao'), data: f('data'), obs: f('obs') });
        close(); toast(`${a.descricao} registrado.`); refresh();
      } catch (e) { handleError(e); }
    });
  });
}

/** Correção de digitação do valor original (motivo obrigatório; não é aditivo). */
export async function correctSheet(itemId) {
  const b = await S.getBundle(itemId);
  sheet('Corrigir valor original', `
    <div class="banner info">Use somente para erro de digitação. Mudança real de valor deve ser registrada como aditivo ou redução.</div>
    <p class="small">Valor original atual: <b class="num">${money(b.item.valorOriginal)}</b></p>
    <label class="field"><span>Valor correto <em>*</em></span><input class="input money num" name="valor" inputmode="decimal" autofocus></label>
    <label class="field"><span>Motivo <em>*</em></span><input class="input" name="motivo" value="Erro de digitação"></label>
    <div class="sheet-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Corrigir</button></div>`,
  (el, close) => {
    el.querySelector('[data-ok]').addEventListener('click', async () => {
      const valor = readMoney(el, 'valor');
      if (!(valor > 0)) return;
      try { await S.correctOriginal(itemId, valor, el.querySelector('[name=motivo]').value); close(); toast('Valor original corrigido.'); refresh(); }
      catch (e) { handleError(e); }
    });
  });
}

export async function cancelPaymentFlow(p) {
  const r = await confirmSheet({ title: 'Cancelar pagamento', text: `O pagamento de <b>${money(p.valor)}</b> (${p.situacao.toLowerCase()}) deixará de contar nos totais, mas continuará visível como Cancelado.`, confirmLabel: 'Cancelar pagamento' });
  if (!r) return;
  try { await S.cancelPayment(p.id, r.motivo); toast('Pagamento cancelado.'); refresh(); } catch (e) { handleError(e); }
}

export async function cancelAdjustmentFlow(a) {
  const r = await confirmSheet({ title: `Cancelar ${a.descricao}`, text: `O ajuste de <b>${money(a.valor)}</b> deixará de ser considerado no valor atualizado.`, confirmLabel: 'Cancelar ajuste' });
  if (!r) return;
  try { await S.cancelAdjustment(a.id, r.motivo); toast('Ajuste cancelado.'); refresh(); } catch (e) { handleError(e); }
}
