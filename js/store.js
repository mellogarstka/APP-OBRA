// Regras de negócio: toda operação financeira valida, grava atomicamente e registra histórico.
import * as db from './db.js';
import { itemTotals, derivedStatus, validatePayment, validateReduction, splitInstallments } from './calc.js';
import { uid, todayISO, addMonths, isValidISO, money, dateBR } from './fmt.js';
import { CATEGORIAS, ETAPAS } from './seed.js';

export const APP_ID = 'obra-financeiro';
export const SCHEMA = 1;

export class ValidationError extends Error {
  constructor(message, detail = {}) { super(message); this.name = 'ValidationError'; this.detail = detail; }
}

export const MSG_EXCEDE = 'Pagamento superior ao saldo disponível. Verifique o valor informado ou registre um aditivo caso exista alteração no serviço.';

// ---------------------------------------------------------------- histórico
function hist(entity, recordId, itemId, acao, { campo = null, anterior = null, novo = null, motivo = null } = {}) {
  return { store: 'history', value: { id: uid(), ts: Date.now(), entity, recordId, itemId, acao, campo, anterior, novo, motivo: motivo || null } };
}

// ---------------------------------------------------------------- settings
export async function getSetting(key, fallback = null) {
  const r = await db.get('settings', key);
  return r ? r.value : fallback;
}
export async function setSetting(key, value) { return db.put('settings', { key, value }); }

// ---------------------------------------------------------------- init / seed
export async function init() {
  await db.openDB();
  if (!(await getSetting('seeded'))) await seed();
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* opcional */ }
}

async function seed() {
  const ops = [];
  CATEGORIAS.forEach(([nome, subs], i) => {
    const id = uid();
    ops.push({ store: 'categories', value: { id, nome, parentId: null, ativo: true, ordem: i } });
    subs.forEach((s, j) => ops.push({ store: 'categories', value: { id: uid(), nome: s, parentId: id, ativo: true, ordem: j } }));
  });
  ETAPAS.forEach((nome, i) => ops.push({ store: 'stages', value: { id: uid(), nome, ativo: true, ordem: i } }));
  ops.push({ store: 'settings', value: { key: 'seeded', value: true } });
  ops.push({ store: 'settings', value: { key: 'obra', value: { nome: '', proprietario: '', endereco: '', inicio: '' } } });
  ops.push({ store: 'settings', value: { key: 'avisoDias', value: 3 } });
  await db.writeAll(ops);
}

// ---------------------------------------------------------------- leitura
export async function loadAll() {
  const [items, adjustments, payments, suppliers, categories, stages] = await Promise.all(
    ['items', 'adjustments', 'payments', 'suppliers', 'categories', 'stages'].map(s => db.getAll(s)));
  const adjBy = groupBy(adjustments, 'itemId');
  const payBy = groupBy(payments, 'itemId');
  const rows = items.map(item => {
    const adj = adjBy[item.id] || [];
    const pays = payBy[item.id] || [];
    const totals = itemTotals(item, adj, pays);
    return { item, adj, pays, totals, status: derivedStatus(item, totals) };
  });
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
  const stageMap = Object.fromEntries(stages.map(s => [s.id, s]));
  const supMap = Object.fromEntries(suppliers.map(s => [s.id, s]));
  return { items, adjustments, payments, suppliers, categories, stages, rows, catMap, stageMap, supMap };
}

function groupBy(arr, key) {
  const o = {};
  for (const x of arr) (o[x[key]] ||= []).push(x);
  return o;
}

export async function getBundle(itemId) {
  const item = await db.get('items', itemId);
  if (!item) throw new ValidationError('Item não encontrado.');
  const [adj, pays, history] = await Promise.all([
    db.getByIndex('adjustments', 'itemId', itemId),
    db.getByIndex('payments', 'itemId', itemId),
    db.getAll('history'),
  ]);
  const totals = itemTotals(item, adj, pays);
  return { item, adj, pays, totals, status: derivedStatus(item, totals), history: history.filter(h => h.itemId === itemId).sort((a, b) => b.ts - a.ts) };
}

// ---------------------------------------------------------------- fornecedores
export async function findOrCreateSupplierOps(nome) {
  nome = (nome || '').trim();
  if (!nome) return { id: null, ops: [] };
  const all = await db.getAll('suppliers');
  const found = all.find(s => s.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'));
  if (found) return { id: found.id, ops: [] };
  const s = { id: uid(), nome, tipo: '', telefone: '', documento: '', obs: '', criadoEm: Date.now() };
  return { id: s.id, ops: [{ store: 'suppliers', value: s }, hist('Fornecedor', s.id, null, 'Criado', { novo: nome })] };
}

export async function saveSupplier(data) {
  const isNew = !data.id;
  const s = { tipo: '', telefone: '', documento: '', obs: '', ...data, id: data.id || uid(), nome: (data.nome || '').trim() };
  if (!s.nome) throw new ValidationError('Informe o nome do fornecedor.');
  await db.writeAll([{ store: 'suppliers', value: s }, hist('Fornecedor', s.id, null, isNew ? 'Criado' : 'Alterado', { novo: s.nome })]);
  return s;
}

// ---------------------------------------------------------------- categorias / etapas
export async function saveListEntry(store, data) {
  const v = { ativo: true, ordem: 9999, parentId: null, ...data, id: data.id || uid(), nome: (data.nome || '').trim() };
  if (store === 'stages') delete v.parentId;
  if (!v.nome) throw new ValidationError('Informe o nome.');
  await db.put(store, v);
  return v;
}

// ---------------------------------------------------------------- criação de item
const REQUIRED = [['descricao', 'Descrição'], ['tipo', 'Tipo de custo'], ['categoriaId', 'Categoria'], ['etapaId', 'Etapa'], ['natureza', 'Natureza']];

/**
 * Cria item + pagamentos conforme o plano escolhido em "Como será pago?".
 * plano.modo: 'avista' | 'entrada' | 'parcelado' | 'cartao' | 'semdata'
 *   entrada:   { valorEntrada, dataEntrada }
 *   parcelado: { parcelas: [{ valor, data }] }
 *   cartao:    { parcelas: [{ valor, data }], marcarVencidasPagas }
 */
export async function createItem(data, plano = { modo: 'semdata' }) {
  for (const [k, label] of REQUIRED) if (!data[k] || !String(data[k]).trim()) throw new ValidationError(`Campo obrigatório: ${label}.`);
  const valor = data.valorOriginal;
  if (!Number.isInteger(valor) || valor <= 0) throw new ValidationError('Informe um valor válido maior que zero.');
  const dataCompra = data.dataCompra || todayISO();
  if (!isValidISO(dataCompra)) throw new ValidationError('Data da compra inválida.');

  if (data.tipo === 'Serviço misto' && (Number.isInteger(data.parcelaMaterial) || Number.isInteger(data.parcelaMO))) {
    const pm = data.parcelaMaterial || 0, pmo = data.parcelaMO || 0;
    if (pm + pmo !== valor) throw new ValidationError(`Parcela de material + mão de obra (${money(pm + pmo)}) deve ser igual ao valor original (${money(valor)}).`);
  }

  const { id: fornecedorId, ops } = data.fornecedorId ? { id: data.fornecedorId, ops: [] } : await findOrCreateSupplierOps(data.fornecedorNome);

  const item = {
    id: uid(),
    descricao: data.descricao.trim(),
    tipo: data.tipo,
    categoriaId: data.categoriaId,
    subcategoriaId: data.subcategoriaId || null,
    etapaId: data.etapaId,
    natureza: data.natureza || 'Normal',
    fornecedorId: fornecedorId || null,
    valorOriginal: valor,
    valorReferencia: data.natureza === 'Upgrade' && Number.isInteger(data.valorReferencia) ? data.valorReferencia : null,
    parcelaMaterial: data.tipo === 'Serviço misto' && Number.isInteger(data.parcelaMaterial) ? data.parcelaMaterial : null,
    parcelaMO: data.tipo === 'Serviço misto' && Number.isInteger(data.parcelaMO) ? data.parcelaMO : null,
    dataCompra,
    formaPagamento: data.formaPagamento || null,
    cartao: data.cartao || null,
    obs: data.obs || '',
    status: 'Ativo',
    incompleto: !!data.incompleto,
    criadoEm: Date.now(),
  };

  const pays = buildPlanPayments(item, plano);
  const soma = pays.reduce((s, p) => s + p.valor, 0);
  if (soma > valor) {
    throw new ValidationError(MSG_EXCEDE, { tipo: 'excede', ...validatePayment({ atualizado: valor, pago: 0, programado: 0 }, soma) });
  }

  ops.push({ store: 'items', value: item }, hist('Item', item.id, item.id, 'Criado', { novo: `${item.descricao} — ${money(valor)}` }));
  for (const p of pays) {
    ops.push({ store: 'payments', value: p }, hist('Pagamento', p.id, item.id, p.situacao === 'Realizado' ? 'Pagamento realizado' : 'Pagamento programado',
      { novo: `${money(p.valor)}${p.parcela ? ` (${p.parcela}/${p.totalParcelas})` : ''}` }));
  }
  await db.writeAll(ops);
  await setSetting('ultimos', { categoriaId: item.categoriaId, subcategoriaId: item.subcategoriaId, etapaId: item.etapaId, tipo: item.tipo });
  await bumpCounter();
  return item;
}

function newPayment(itemId, o) {
  return {
    id: uid(), itemId, valor: o.valor, situacao: o.situacao, data: o.data,
    dataPago: o.situacao === 'Realizado' ? (o.dataPago || o.data) : null,
    forma: o.forma || null, descricao: o.descricao || '', parcela: o.parcela || null, totalParcelas: o.totalParcelas || null,
    dataNaoInformada: !!o.dataNaoInformada, criadoEm: Date.now(),
  };
}

function buildPlanPayments(item, plano) {
  const forma = item.formaPagamento;
  const hoje = todayISO();
  switch (plano.modo) {
    case 'avista':
      return [newPayment(item.id, { valor: item.valorOriginal, situacao: 'Realizado', data: item.dataCompra, forma, descricao: 'Pagamento à vista' })];
    case 'entrada': {
      const v = plano.valorEntrada;
      if (!Number.isInteger(v) || v <= 0) throw new ValidationError('Informe o valor da entrada.');
      const d = plano.dataEntrada || item.dataCompra;
      return [newPayment(item.id, { valor: v, situacao: 'Realizado', data: d, forma, descricao: 'Entrada' })];
    }
    case 'parcelado':
    case 'cartao': {
      const ps = plano.parcelas || [];
      if (!ps.length) throw new ValidationError('Informe as parcelas.');
      const n = ps.length;
      return ps.map((p, i) => {
        if (!Number.isInteger(p.valor) || p.valor <= 0) throw new ValidationError(`Valor inválido na parcela ${i + 1}.`);
        if (!isValidISO(p.data)) throw new ValidationError(`Data inválida na parcela ${i + 1}.`);
        const vencida = p.data <= hoje;
        const realizado = plano.modo === 'cartao' ? (plano.marcarVencidasPagas && vencida) : !!p.pago;
        return newPayment(item.id, {
          valor: p.valor, situacao: realizado ? 'Realizado' : 'Programado', data: p.data,
          forma: plano.modo === 'cartao' ? 'Cartão de crédito' : forma, parcela: i + 1, totalParcelas: n,
          descricao: plano.modo === 'cartao' ? `Parcela cartão${item.cartao ? ' ' + item.cartao : ''}` : 'Parcela',
        });
      });
    }
    case 'semdata':
    default:
      return [];
  }
}

/** Gera parcelas mensais (cartão ou parcelado). */
export function monthlyInstallments(total, n, primeiraData) {
  return splitInstallments(total, n).map((valor, i) => ({ valor, data: addMonths(primeiraData, i) }));
}

// ---------------------------------------------------------------- pagamentos
export async function addPayment(itemId, o) {
  const b = await getBundle(itemId);
  if (b.item.status === 'Cancelado') throw new ValidationError('Item cancelado não aceita pagamentos.');
  if (!Number.isInteger(o.valor) || o.valor <= 0) throw new ValidationError('Informe um valor válido.');
  if (!isValidISO(o.data)) throw new ValidationError(o.situacao === 'Programado' ? 'Pagamento programado exige data de vencimento.' : 'Data inválida.');
  const v = validatePayment(b.totals, o.valor);
  if (!v.ok) throw new ValidationError(MSG_EXCEDE, { tipo: 'excede', itemId, ...v });
  const p = newPayment(itemId, o);
  await db.writeAll([{ store: 'payments', value: p }, hist('Pagamento', p.id, itemId, p.situacao === 'Realizado' ? 'Pagamento realizado' : 'Pagamento programado', { novo: money(p.valor) })]);
  await bumpCounter();
  return p;
}

/**
 * Marca um programado como realizado (valor e data editáveis).
 * Se o valor pago for menor que o programado, `restante.modo` define o destino da diferença:
 *   'mesma'    → continua programada na mesma data de vencimento
 *   'outra'    → programada para `restante.data`
 *   'semdata'  → vira saldo sem data definida
 *   'desconto' → registrada como desconto de quitação (reduz o valor atualizado)
 */
export const RESTANTE_MODOS = ['mesma', 'outra', 'semdata', 'desconto'];

export async function markPaid(paymentId, { dataPago, valor, restante = null }) {
  const p = await db.get('payments', paymentId);
  if (!p || p.situacao !== 'Programado') throw new ValidationError('Pagamento não está programado.');
  const b = await getBundle(p.itemId);
  if (!isValidISO(dataPago)) throw new ValidationError('Data do pagamento inválida.');
  if (!Number.isInteger(valor) || valor <= 0) throw new ValidationError('Informe um valor válido.');
  const v = validatePayment(b.totals, valor, p.valor); // não conta duas vezes
  if (!v.ok) throw new ValidationError(MSG_EXCEDE, { tipo: 'excede', itemId: p.itemId, ...v });
  const diff = p.valor - valor;
  if (diff > 0 && (!restante || !RESTANTE_MODOS.includes(restante.modo)))
    throw new ValidationError(`Informe o que fazer com o restante de ${money(diff)}.`);
  const np = { ...p, situacao: 'Realizado', dataPago, valor, ...(diff > 0 ? { valorProgramadoOriginal: p.valor } : {}) };
  const ops = [{ store: 'payments', value: np }, hist('Pagamento', p.id, p.itemId, 'Marcado como pago', { campo: 'situacao', anterior: `Programado ${money(p.valor)}`, novo: `Realizado ${money(valor)} em ${dataPago}` })];
  if (diff > 0) {
    const ref = p.parcela ? `parcela ${p.parcela}/${p.totalParcelas}` : 'pagamento';
    if (restante.modo === 'mesma' || restante.modo === 'outra') {
      const data = restante.modo === 'mesma' ? p.data : restante.data;
      if (!isValidISO(data)) throw new ValidationError('Informe a data do restante.');
      const r = newPayment(p.itemId, { valor: diff, situacao: 'Programado', data, forma: p.forma, descricao: `Restante da ${ref}` });
      ops.push({ store: 'payments', value: r }, hist('Pagamento', r.id, p.itemId, 'Pagamento programado', { novo: `${money(diff)} — restante da ${ref}` }));
    } else if (restante.modo === 'desconto') {
      const seq = b.adj.filter(a => a.tipo === 'Desconto de quitação').length + 1;
      const a = {
        id: uid(), itemId: p.itemId, tipo: 'Desconto de quitação', numero: seq,
        descricao: `Desconto de quitação ${String(seq).padStart(2, '0')}`, valor: diff,
        valorMaterial: null, valorMO: null,
        data: dataPago, obs: `Diferença paga a menor na ${ref}`, status: 'Ativo', criadoEm: Date.now(),
      };
      ops.push({ store: 'adjustments', value: a }, hist('Ajuste', a.id, p.itemId, 'Desconto de quitação registrado',
        { campo: 'valor atualizado', anterior: money(b.totals.atualizado), novo: `${money(b.totals.atualizado - diff)} (−${money(diff)})`, motivo: a.obs }));
    } else {
      ops.push(hist('Pagamento', p.id, p.itemId, 'Restante sem data', { novo: `${money(diff)} passou a saldo sem data` }));
    }
  }
  await db.writeAll(ops);
  return np;
}

/**
 * Corrige um pagamento (erro de digitação): valor, data, forma, descrição, parcela.
 * Realizado: a data editada é a data em que foi pago. Programado: o vencimento.
 * Valor continua limitado ao saldo do item (sem contar o próprio pagamento).
 */
export async function editPayment(paymentId, ch, motivo = '') {
  const p = await db.get('payments', paymentId);
  if (!p || p.situacao === 'Cancelado') throw new ValidationError('Pagamento cancelado não pode ser editado.');
  const b = await getBundle(p.itemId);
  if (b.item.status === 'Cancelado') throw new ValidationError('Item cancelado.');
  const real = p.situacao === 'Realizado';
  const np = { ...p };
  if (ch.valor !== undefined) {
    if (!Number.isInteger(ch.valor) || ch.valor <= 0) throw new ValidationError('Informe um valor válido.');
    const v = validatePayment(b.totals, ch.valor, p.valor);
    if (!v.ok) throw new ValidationError(MSG_EXCEDE, { tipo: 'excede', itemId: p.itemId, ...v });
    np.valor = ch.valor;
  }
  if (ch.data !== undefined) {
    if (!isValidISO(ch.data)) throw new ValidationError('Data inválida.');
    if (real) { np.dataPago = ch.data; np.data = ch.data; np.dataNaoInformada = false; } else np.data = ch.data;
  }
  for (const k of ['forma', 'descricao']) if (ch[k] !== undefined) np[k] = ch[k] || null;
  for (const k of ['parcela', 'totalParcelas']) if (ch[k] !== undefined) np[k] = Number.isInteger(ch[k]) && ch[k] > 0 ? ch[k] : null;
  const rotulo = { valor: 'valor', data: real ? 'data do pagamento' : 'vencimento', forma: 'forma', descricao: 'descrição', parcela: 'parcela', totalParcelas: 'total de parcelas' };
  const fmt = (k, v) => v == null || v === '' ? '—' : k === 'valor' ? money(v) : k === 'data' ? dateBR(v) : String(v);
  const antes = { ...p, data: real ? (p.dataPago || p.data) : p.data }, depois = { ...np, data: real ? np.dataPago : np.data };
  const ops = [{ store: 'payments', value: np }];
  for (const k of Object.keys(rotulo)) {
    if ((antes[k] ?? null) !== (depois[k] ?? null))
      ops.push(hist('Pagamento', p.id, p.itemId, 'Pagamento corrigido', { campo: rotulo[k], anterior: fmt(k, antes[k]), novo: fmt(k, depois[k]), motivo: motivo || null }));
  }
  if (ops.length === 1) return p; // nada mudou
  await db.writeAll(ops);
  return np;
}

export async function cancelPayment(paymentId, motivo) {
  const p = await db.get('payments', paymentId);
  if (!p || p.situacao === 'Cancelado') throw new ValidationError('Pagamento já cancelado.');
  const np = { ...p, situacao: 'Cancelado', situacaoAnterior: p.situacao, canceladoEm: Date.now() };
  await db.writeAll([{ store: 'payments', value: np }, hist('Pagamento', p.id, p.itemId, 'Cancelado', { campo: 'situacao', anterior: `${p.situacao} ${money(p.valor)}`, novo: 'Cancelado', motivo })]);
}

// ---------------------------------------------------------------- ajustes
export async function addAdjustment(itemId, o) {
  const b = await getBundle(itemId);
  if (b.item.status === 'Cancelado') throw new ValidationError('Item cancelado.');
  if (!['Aditivo', 'Redução', 'Desconto de quitação'].includes(o.tipo)) throw new ValidationError('Tipo de ajuste inválido.');
  if (!Number.isInteger(o.valor) || o.valor <= 0) throw new ValidationError('Informe um valor válido (sempre positivo).');
  if (o.tipo !== 'Aditivo') {
    const r = validateReduction(b.totals, o.valor);
    if (!r.ok) throw new ValidationError(`O valor atualizado não pode ficar abaixo de pago + programado (${money(r.minimo)}). Excedente: ${money(r.excedente)}.`, { tipo: 'reducao', ...r });
  }
  let valorMaterial = null;
  if (b.item.tipo === 'Serviço misto' && Number.isInteger(o.valorMaterial)) {
    if (o.valorMaterial < 0 || o.valorMaterial > o.valor) throw new ValidationError('A parte de material deve estar entre zero e o valor do ajuste.');
    valorMaterial = o.valorMaterial;
  }
  const seq = b.adj.filter(a => a.tipo === o.tipo).length + 1;
  const a = {
    id: uid(), itemId, tipo: o.tipo, numero: seq,
    descricao: o.descricao || `${o.tipo} ${String(seq).padStart(2, '0')}`,
    valor: o.valor, valorMaterial, valorMO: valorMaterial === null ? null : o.valor - valorMaterial,
    data: o.data || todayISO(), obs: o.obs || '', status: 'Ativo', criadoEm: Date.now(),
  };
  const sinal = a.tipo === 'Aditivo' ? '+' : '−';
  await db.writeAll([{ store: 'adjustments', value: a }, hist('Ajuste', a.id, itemId, `${a.tipo} registrado`,
    { campo: 'valor atualizado', anterior: money(b.totals.atualizado), novo: `${money(b.totals.atualizado + (a.tipo === 'Aditivo' ? a.valor : -a.valor))} (${sinal}${money(a.valor)})`, motivo: o.obs })]);
  await bumpCounter();
  return a;
}

export async function cancelAdjustment(adjId, motivo) {
  const a = await db.get('adjustments', adjId);
  if (!a || a.status === 'Cancelado') throw new ValidationError('Ajuste já cancelado.');
  const b = await getBundle(a.itemId);
  if (a.tipo === 'Aditivo') {
    const r = validateReduction(b.totals, a.valor);
    if (!r.ok) throw new ValidationError(`Cancelar este aditivo deixaria o valor atualizado abaixo de pago + programado (${money(r.minimo)}). Cancele pagamentos antes.`);
  }
  await db.writeAll([{ store: 'adjustments', value: { ...a, status: 'Cancelado', canceladoEm: Date.now() } },
    hist('Ajuste', a.id, a.itemId, `${a.tipo} cancelado`, { anterior: money(a.valor), novo: 'Cancelado', motivo })]);
}

/** Correção de digitação do valor original (não é aditivo; motivo obrigatório). */
export async function correctOriginal(itemId, novoValor, motivo) {
  if (!motivo || !motivo.trim()) throw new ValidationError('Informe o motivo da correção.');
  if (!Number.isInteger(novoValor) || novoValor <= 0) throw new ValidationError('Valor inválido.');
  const b = await getBundle(itemId);
  if (novoValor === b.item.valorOriginal) throw new ValidationError('O valor é igual ao atual.');
  const novoAtualizado = b.totals.atualizado - b.item.valorOriginal + novoValor;
  if (novoAtualizado < b.totals.pago + b.totals.programado) {
    throw new ValidationError(`Com esse valor, o valor atualizado (${money(novoAtualizado)}) ficaria abaixo de pago + programado (${money(b.totals.pago + b.totals.programado)}).`);
  }
  const item = { ...b.item, valorOriginal: novoValor };
  if (item.tipo === 'Serviço misto' && Number.isInteger(item.parcelaMaterial) && Number.isInteger(item.parcelaMO)) {
    // Mantém a proporção material/MO informada no cadastro.
    const pm = Math.round(novoValor * item.parcelaMaterial / (item.parcelaMaterial + item.parcelaMO));
    item.parcelaMaterial = pm; item.parcelaMO = novoValor - pm;
  }
  await db.writeAll([{ store: 'items', value: item }, hist('Item', itemId, itemId, 'Correção do valor original', { campo: 'valorOriginal', anterior: money(b.item.valorOriginal), novo: money(novoValor), motivo })]);
}

/** Edição de campos NÃO financeiros, com histórico campo a campo. */
const EDITABLE = { descricao: 'Descrição', tipo: 'Tipo', categoriaId: 'Categoria', subcategoriaId: 'Subcategoria', etapaId: 'Etapa', natureza: 'Natureza', fornecedorId: 'Fornecedor', dataCompra: 'Data da compra', formaPagamento: 'Forma de pagamento', cartao: 'Cartão', obs: 'Observações', valorReferencia: 'Valor de referência', parcelaMaterial: 'Parcela de material', parcelaMO: 'Parcela de mão de obra', incompleto: 'Incompleto' };

export async function updateItem(itemId, changes, labels = {}) {
  const b = await getBundle(itemId);
  const item = { ...b.item };
  const ops = [];
  if (changes.fornecedorNome !== undefined) {
    const r = await findOrCreateSupplierOps(changes.fornecedorNome);
    ops.push(...r.ops); changes.fornecedorId = r.id; delete changes.fornecedorNome;
  }
  for (const [k, v] of Object.entries(changes)) {
    if (!(k in EDITABLE)) continue;
    if ((item[k] ?? null) === (v ?? null)) continue;
    ops.push(hist('Item', itemId, itemId, 'Alterado', { campo: EDITABLE[k], anterior: labels[k]?.(item[k]) ?? fmtVal(item[k]), novo: labels[k]?.(v) ?? fmtVal(v) }));
    item[k] = v;
  }
  for (const [k, label] of REQUIRED) if (!item[k]) throw new ValidationError(`Campo obrigatório: ${label}.`);
  if (!isValidISO(item.dataCompra)) throw new ValidationError('Data inválida.');
  if (item.tipo === 'Serviço misto' && Number.isInteger(item.parcelaMaterial) && item.parcelaMaterial + (item.parcelaMO || 0) !== item.valorOriginal)
    throw new ValidationError('Parcela de material + mão de obra deve ser igual ao valor original.');
  if (!ops.length) return item;
  ops.push({ store: 'items', value: item });
  await db.writeAll(ops);
  return item;
}

function fmtVal(v) { return v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? money(v) : String(v); }

export async function cancelItem(itemId, motivo) {
  const b = await getBundle(itemId);
  if (b.item.status === 'Cancelado') throw new ValidationError('Item já cancelado.');
  const realizados = b.pays.filter(p => p.situacao === 'Realizado');
  if (realizados.length) throw new ValidationError(`Este item possui ${realizados.length} pagamento(s) realizado(s). Cancele os pagamentos ou registre uma redução antes de cancelar o item.`);
  const ops = [{ store: 'items', value: { ...b.item, status: 'Cancelado', canceladoEm: Date.now() } }, hist('Item', itemId, itemId, 'Item cancelado', { campo: 'status', anterior: b.status, novo: 'Cancelado', motivo })];
  for (const p of b.pays.filter(p => p.situacao === 'Programado')) {
    ops.push({ store: 'payments', value: { ...p, situacao: 'Cancelado', situacaoAnterior: 'Programado', canceladoEm: Date.now() } },
      hist('Pagamento', p.id, itemId, 'Cancelado (item cancelado)', { anterior: `Programado ${money(p.valor)}`, novo: 'Cancelado' }));
  }
  await db.writeAll(ops);
}

// ---------------------------------------------------------------- backup
async function bumpCounter() {
  const n = (await getSetting('lancamentosDesdeBackup', 0)) + 1;
  await setSetting('lancamentosDesdeBackup', n);
}

export async function exportBackup() {
  const data = await db.dumpAll();
  return { app: APP_ID, schema: SCHEMA, exportedAt: new Date().toISOString(), data };
}

export async function markBackupDone() {
  await db.writeAll([{ store: 'settings', value: { key: 'ultimoBackup', value: Date.now() } }, { store: 'settings', value: { key: 'lancamentosDesdeBackup', value: 0 } }]);
}

export function validateBackup(obj) {
  if (!obj || obj.app !== APP_ID || !obj.data) throw new ValidationError('Arquivo não é um backup válido deste aplicativo.');
  if (obj.schema > SCHEMA) throw new ValidationError('Backup gerado por uma versão mais nova do app. Atualize o app antes de restaurar.');
  for (const s of db.STORES) if (!Array.isArray(obj.data[s])) throw new ValidationError(`Backup incompleto (falta "${s}").`);
  return { itens: obj.data.items.length, pagamentos: obj.data.payments.length, data: obj.exportedAt };
}

export async function restoreBackup(obj) {
  validateBackup(obj);
  const ops = [];
  for (const s of db.STORES) {
    ops.push({ store: s, clear: true });
    for (const v of obj.data[s]) ops.push({ store: s, value: v });
  }
  ops.push(hist('Sistema', 'backup', null, 'Backup restaurado', { novo: obj.exportedAt }));
  await db.writeAll(ops); // atômico: falhou, nada muda
}

export async function allHistory() {
  return (await db.getAll('history')).sort((a, b) => b.ts - a.ts);
}
