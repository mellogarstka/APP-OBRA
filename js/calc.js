// Fórmulas e validações puras (sem acesso ao banco). Todos os valores em centavos.

// Administrativo: projetos, taxas, cartório, impostos, terreno/financiamento — custo da obra que não é material nem execução.
export const TIPOS = ['Material', 'Mão de obra', 'Serviço misto', 'Equipamento', 'Administrativo'];
export const NATUREZAS = ['Normal', 'Upgrade', 'Retrabalho', 'Imprevisto'];
export const FORMAS = ['Pix', 'Dinheiro', 'Débito', 'Cartão de crédito', 'Boleto', 'Transferência', 'Outro'];
export const AJUSTES = ['Aditivo', 'Redução', 'Desconto de quitação'];

/**
 * Item 3 do prompt — fórmulas por item.
 * @param item         registro do item
 * @param adjustments  ajustes do item (qualquer status)
 * @param payments     pagamentos do item (qualquer status)
 */
export function itemTotals(item, adjustments = [], payments = []) {
  const ativos = adjustments.filter(a => a.status !== 'Cancelado');
  const sum = (arr) => arr.reduce((s, x) => s + x.valor, 0);
  const aditivos = sum(ativos.filter(a => a.tipo === 'Aditivo'));
  const reducoes = sum(ativos.filter(a => a.tipo === 'Redução'));
  const descontos = sum(ativos.filter(a => a.tipo === 'Desconto de quitação'));
  const atualizado = item.valorOriginal + aditivos - reducoes - descontos;
  const pago = sum(payments.filter(p => p.situacao === 'Realizado'));
  const programado = sum(payments.filter(p => p.situacao === 'Programado'));
  const pendente = atualizado - pago;
  const semData = pendente - programado;
  const pctPago = atualizado > 0 ? Math.min(100, (pago / atualizado) * 100) : (pago > 0 ? 100 : 0);
  const diffUpgrade = item.natureza === 'Upgrade' && Number.isInteger(item.valorReferencia)
    ? atualizado - item.valorReferencia : 0;
  return { original: item.valorOriginal, aditivos, reducoes, descontos, atualizado, pago, programado, pendente, semData, pctPago, diffUpgrade };
}

/** Status derivado: Cancelado (manual) | Quitado (saldo = 0) | Ativo */
export function derivedStatus(item, totals) {
  if (item.status === 'Cancelado') return 'Cancelado';
  return totals.pendente === 0 ? 'Quitado' : 'Ativo';
}

/**
 * Item 9 — validação: pago + programado + novo ≤ atualizado.
 * `liberar` = valor de um pagamento programado que está sendo convertido/editado
 * (deixa de contar como comprometido, para não contar duas vezes).
 */
export function validatePayment(totals, valor, liberar = 0) {
  const comprometido = totals.pago + totals.programado - liberar;
  const disponivel = totals.atualizado - comprometido;
  const excedente = valor - disponivel;
  return {
    ok: valor > 0 && excedente <= 0,
    disponivel,
    excedente: Math.max(0, excedente),
    atualizado: totals.atualizado,
    pago: totals.pago,
    programado: totals.programado - liberar,
    valor,
  };
}

/** Redução/desconto: novo atualizado não pode ficar abaixo de pago + programado. */
export function validateReduction(totals, valor) {
  const novo = totals.atualizado - valor;
  const minimo = totals.pago + totals.programado;
  return { ok: valor > 0 && novo >= minimo, novo, minimo, excedente: Math.max(0, minimo - novo) };
}

/** Divide um total em N parcelas; a diferença de centavos vai para a última. */
export function splitInstallments(total, n) {
  n = Math.max(1, Math.floor(n));
  const base = Math.floor(total / n);
  const arr = Array(n).fill(base);
  arr[n - 1] = total - base * (n - 1);
  return arr;
}

/** Totais da obra — soma de todos os itens não cancelados. */
export function projectTotals(rows) {
  const t = { custo: 0, pago: 0, pendente: 0, programado: 0, semData: 0, aditivosLiq: 0, upgrades: 0, retrabalho: 0, imprevisto: 0, itens: 0 };
  for (const r of rows) {
    if (r.item.status === 'Cancelado') continue;
    const x = r.totals;
    t.itens++;
    t.custo += x.atualizado;
    t.pago += x.pago;
    t.pendente += x.pendente;
    t.programado += x.programado;
    t.semData += x.semData;
    t.aditivosLiq += x.aditivos - x.reducoes;
    t.upgrades += x.diffUpgrade;
    if (r.item.natureza === 'Retrabalho') t.retrabalho += x.atualizado;
    if (r.item.natureza === 'Imprevisto') t.imprevisto += x.atualizado;
  }
  return t;
}

/**
 * Separa material / mão de obra de um item para relatórios por tipo.
 * Serviço misto: o valor original segue a proporção do cadastro; cada ajuste usa a
 * separação informada nele (valorMaterial) ou, se não informada, a mesma proporção.
 */
export function proportionalMaterial(item, valor) {
  const pm = item.parcelaMaterial, pmo = item.parcelaMO;
  if (!Number.isInteger(pm) || !Number.isInteger(pmo) || pm + pmo <= 0) return null;
  return Math.round(valor * pm / (pm + pmo));
}

export function splitMaterialMO(item, totals, adjustments = []) {
  const v = totals.atualizado;
  if (item.tipo === 'Material') return { material: v, maoDeObra: 0, outros: 0 };
  if (item.tipo === 'Mão de obra') return { material: 0, maoDeObra: v, outros: 0 };
  if (item.tipo === 'Serviço misto' && proportionalMaterial(item, item.valorOriginal) !== null) {
    let mat = proportionalMaterial(item, item.valorOriginal);
    for (const a of adjustments) {
      if (a.status === 'Cancelado') continue;
      const sinal = a.tipo === 'Aditivo' ? 1 : -1;
      const m = Number.isInteger(a.valorMaterial) ? a.valorMaterial : proportionalMaterial(item, a.valor);
      mat += sinal * m;
    }
    return { material: mat, maoDeObra: v - mat, outros: 0 };
  }
  return { material: 0, maoDeObra: 0, outros: v };
}
