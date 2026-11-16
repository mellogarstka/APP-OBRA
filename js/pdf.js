// Relatórios em PDF — gerados no próprio aparelho (funciona offline).
// Bibliotecas (versão fixa, carregadas só quando o usuário gera um PDF):
//   js/vendor/jspdf-4.2.1.umd.min.js · js/vendor/jspdf-autotable-5.0.9.min.js
import { projectTotals, TIPOS } from './calc.js';
import { dateBR, todayISO, monthLabel } from './fmt.js';

const LIBS = ['js/vendor/jspdf-4.2.1.umd.min.js', 'js/vendor/jspdf-autotable-5.0.9.min.js'];
export const TIPOS_RELATORIO = [
  ['resumo', 'Resumo geral da obra', 'Indicadores, totais por etapa, tipo e categoria, saldos a pagar e próximos vencimentos.'],
  ['itens', 'Itens detalhados', 'Lista de itens com valor, pago e saldo. Aceita filtros.'],
  ['pagamentos', 'Extrato de pagamentos', 'Pagamentos realizados no período, com subtotal por mês. Aceita filtros.'],
];

const VERDE = [31, 95, 74], CINZA = [110, 118, 114], LINHA = [222, 226, 223], ZEBRA = [246, 248, 247];
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const R$ = (c) => brl.format((c || 0) / 100).replace(/ /g, ' ');
const pct = (a, b) => (b ? (a / b) * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
// fonte padrão do PDF (WinAnsi): troca caracteres fora da tabela
const txt = (s) => String(s ?? '').replace(/[→]/g, '>').replace(/[›]/g, '>').replace(/[   ]/g, ' ');

let carregando = null;
function carregar() {
  if (globalThis.jspdf?.jsPDF && typeof new globalThis.jspdf.jsPDF().autoTable === 'function') return Promise.resolve();
  carregando ||= LIBS.reduce((p, src) => p.then(() => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('Não foi possível carregar o gerador de PDF. Abra o app com internet e tente de novo.'));
    document.head.appendChild(s);
  })), Promise.resolve()).then(() => {
    const { jsPDF } = globalThis.jspdf;
    if (typeof new jsPDF().autoTable !== 'function' && globalThis.jspdfAutoTable?.applyPlugin) globalThis.jspdfAutoTable.applyPlugin(jsPDF);
  }).catch(e => { carregando = null; throw e; });
  return carregando;
}

/** Monta o PDF e devolve { blob, nome }. opts: { tipo, f: { tipo, etapa, cat, de, ate } } */
export async function gerarPDF(ctx, opts) {
  await carregar();
  const { jsPDF } = globalThis.jspdf;
  const paisagem = opts.tipo !== 'resumo';
  const doc = new jsPDF({ orientation: paisagem ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), M = 14;
  const obra = ctx.settings.obra || {};
  const titulo = TIPOS_RELATORIO.find(t => t[0] === opts.tipo)[1];
  const emitido = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const f = opts.f || {};
  const filtrosTxt = descreverFiltros(ctx, f, opts.tipo);

  const cabecalho = () => {
    doc.setDrawColor(...VERDE); doc.setLineWidth(0.8); doc.line(M, 10, W - M, 10);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(20, 24, 22);
    doc.text(txt(obra.nome || 'Controle da Obra'), M, 17);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...CINZA);
    const l2 = [obra.proprietario && `Proprietário: ${obra.proprietario}`, obra.endereco].filter(Boolean).join('  |  ');
    if (l2) doc.text(txt(l2), M, 22, { maxWidth: W - 2 * M - 70 });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...VERDE);
    doc.text(txt(titulo), W - M, 17, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...CINZA);
    doc.text(`Emitido em ${emitido}`, W - M, 22, { align: 'right' });
  };
  const topo = 30;
  let y = topo;
  const secao = (t, extra = 0) => {
    if (y > doc.internal.pageSize.getHeight() - 40 - extra) { doc.addPage(); y = topo; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...VERDE);
    doc.text(txt(t.toUpperCase()), M, y + 4); y += 7;
  };
  // o.right: colunas numéricas (alinhadas à direita, inclusive título e total); o.w: larguras fixas (mm)
  const tabela = (head, body, o = {}) => {
    const right = new Set(o.right || []);
    const cols = {};
    for (const i of right) cols[i] = { halign: 'right' };
    for (const [i, w] of Object.entries(o.w || {})) cols[i] = { ...(cols[i] || {}), cellWidth: w };
    doc.autoTable({
      startY: y, head: [head.map(txt)], body: body.map(r => r.map(c => typeof c === 'object' && c ? { ...c, content: txt(c.content) } : txt(c))),
      foot: o.foot ? [o.foot.map(txt)] : undefined, showFoot: 'lastPage', rowPageBreak: 'avoid',
      margin: { left: M, right: M, top: topo }, theme: 'plain',
      styles: { font: 'helvetica', fontSize: o.fs || 8.5, cellPadding: { top: 1.6, bottom: 1.6, left: 1.8, right: 1.8 }, textColor: [30, 34, 32], lineColor: LINHA, lineWidth: { bottom: 0.15 }, overflow: 'linebreak', valign: 'top' },
      headStyles: { fontStyle: 'bold', textColor: [255, 255, 255], fillColor: VERDE, lineWidth: 0, valign: 'middle' },
      footStyles: { fontStyle: 'bold', fillColor: [232, 240, 236], textColor: [20, 24, 22] },
      alternateRowStyles: { fillColor: ZEBRA },
      columnStyles: cols,
      didParseCell: (d) => {
        if (right.has(d.column.index) && d.cell.colSpan === 1) d.cell.styles.halign = 'right';
        if (o.nowrap?.includes(d.column.index)) d.cell.styles.overflow = 'visible';
      },
      didDrawPage: () => cabecalho(),
    });
    y = doc.lastAutoTable.finalY + 8;
  };

  const ativos = ctx.rows.filter(r => r.item.status !== 'Cancelado');
  cabecalho();
  if (filtrosTxt) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...CINZA);
    doc.text(txt('Filtros: ' + filtrosTxt), M, y + 2, { maxWidth: W - 2 * M }); y += 7;
  }

  if (opts.tipo === 'resumo') {
    const t = projectTotals(ctx.rows);
    // cartões de indicadores
    const kpis = [
      ['Custo total da obra', R$(t.custo), `${t.itens} itens`], ['Pago', R$(t.pago), pct(t.pago, t.custo) + ' do total'], ['Falta pagar', R$(t.pendente), pct(t.pendente, t.custo) + ' do total'],
      ['Programado (com data)', R$(t.programado), ''], ['Sem data definida', R$(t.semData), ''], ['Aditivos (líquido)', R$(t.aditivosLiq), ''],
      ['Retrabalho', R$(t.retrabalho), pct(t.retrabalho, t.custo) + ' do total'], ['Imprevistos', R$(t.imprevisto), ''], ['Upgrades (diferença)', R$(t.upgrades), ''],
    ];
    const cw = (W - 2 * M - 8) / 3, ch = 17;
    kpis.forEach(([l, v, s], i) => {
      const x = M + (i % 3) * (cw + 4), yy = y + Math.floor(i / 3) * (ch + 3);
      doc.setFillColor(...(i < 3 ? [232, 240, 236] : ZEBRA)); doc.setDrawColor(...LINHA); doc.roundedRect(x, yy, cw, ch, 2, 2, 'FD');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...CINZA); doc.text(txt(l), x + 3, yy + 5);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(i < 3 ? 12 : 10.5); doc.setTextColor(...(i < 3 ? VERDE : [30, 34, 32])); doc.text(v, x + 3, yy + 11.5);
      if (s) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...CINZA); doc.text(txt(s), x + cw - 3, yy + 5, { align: 'right' }); }
    });
    y += 3 * (ch + 3) + 6;
    // barra de progresso
    doc.setFillColor(...LINHA); doc.roundedRect(M, y, W - 2 * M, 3, 1.5, 1.5, 'F');
    doc.setFillColor(...VERDE); doc.roundedRect(M, y, Math.max(3, (W - 2 * M) * Math.min(1, t.custo ? t.pago / t.custo : 0)), 3, 1.5, 1.5, 'F');
    y += 10;

    const grupo = (keyFn, nomeFn) => {
      const g = new Map();
      for (const r of ativos) { const k = keyFn(r); const x = g.get(k) || { n: 0, v: 0, p: 0, f: 0 }; x.n++; x.v += r.totals.atualizado; x.p += r.totals.pago; x.f += r.totals.pendente; g.set(k, x); }
      return [...g.entries()].sort((a, b) => b[1].v - a[1].v).map(([k, x]) => [nomeFn(k), String(x.n), R$(x.v), R$(x.p), R$(x.f), pct(x.v, t.custo)]);
    };
    const head = ['', 'Itens', 'Valor', 'Pago', 'Falta pagar', '% do total'];
    const foot = ['Total', String(t.itens), R$(t.custo), R$(t.pago), R$(t.pendente), '100%'];
    const cols = { right: [1, 2, 3, 4, 5], w: { 1: 14, 2: 30, 3: 30, 4: 30, 5: 20 } };
    secao('Por etapa'); tabela(['Etapa', ...head.slice(1)], grupo(r => r.item.etapaId, ctx.stageName), { foot, ...cols });
    secao('Por tipo de custo'); tabela(['Tipo de custo', ...head.slice(1)], grupo(r => r.item.tipo, k => k).sort((a, b) => TIPOS.indexOf(a[0]) - TIPOS.indexOf(b[0])), { foot, ...cols });
    secao('Por categoria'); tabela(['Categoria', ...head.slice(1)], grupo(r => r.item.categoriaId, ctx.catName), { foot, ...cols });

    const abertos = ativos.filter(r => r.totals.pendente > 0).sort((a, b) => b.totals.pendente - a.totals.pendente);
    secao('Saldos a pagar');
    if (abertos.length) {
      tabela(['Item', 'Etapa', 'Valor', 'Pago', 'Falta pagar', 'Próximo vencimento'], abertos.map(r => {
        const prox = r.pays.filter(p => p.situacao === 'Programado').sort((a, b) => a.data.localeCompare(b.data))[0];
        return [r.item.descricao, ctx.stageName(r.item.etapaId), R$(r.totals.atualizado), R$(r.totals.pago), R$(r.totals.pendente), prox ? `${dateBR(prox.data)} (${R$(prox.valor)})` : 'sem data definida'];
      }), { foot: ['Total', '', R$(abertos.reduce((s, r) => s + r.totals.atualizado, 0)), R$(abertos.reduce((s, r) => s + r.totals.pago, 0)), R$(abertos.reduce((s, r) => s + r.totals.pendente, 0)), ''], right: [2, 3, 4], w: { 1: 28, 2: 25, 3: 25, 4: 25, 5: 30 }, fs: 8 });
    } else { aviso('Nenhum saldo em aberto.'); }

    const hoje = todayISO();
    const lim = new Date(); lim.setDate(lim.getDate() + 90); const limISO = lim.toISOString().slice(0, 10);
    const prog = ctx.payments.filter(p => p.situacao === 'Programado' && p.data <= limISO && ativos.some(r => r.item.id === p.itemId)).sort((a, b) => a.data.localeCompare(b.data));
    secao('Pagamentos programados (próximos 90 dias e atrasados)');
    if (prog.length) {
      tabela(['Vencimento', 'Item', 'Descrição', 'Valor'], prog.map(p => [{ content: dateBR(p.data) + (p.data < hoje ? '  (atrasado)' : ''), styles: p.data < hoje ? { textColor: [179, 38, 30] } : {} },
        ctx.rows.find(r => r.item.id === p.itemId).item.descricao, p.descricao || '', R$(p.valor)]),
      { foot: ['Total', '', '', R$(prog.reduce((s, p) => s + p.valor, 0))], right: [3], w: { 0: 34, 3: 28 } });
    } else { aviso('Nenhum pagamento programado para os próximos 90 dias.'); }
  }

  if (opts.tipo === 'itens') {
    const lista = filtrarItens(ativos, f).sort((a, b) => a.item.dataCompra.localeCompare(b.item.dataCompra));
    const sum = (k) => lista.reduce((s, r) => s + r.totals[k], 0);
    tabela(['Data', 'Descrição', 'Etapa', 'Categoria', 'Tipo', 'Natureza', 'Valor', 'Pago', 'Falta pagar'], lista.map(r => [
      dateBR(r.item.dataCompra), r.item.descricao, ctx.stageName(r.item.etapaId),
      [ctx.catName(r.item.categoriaId), r.item.subcategoriaId ? ctx.catName(r.item.subcategoriaId) : ''].filter(Boolean).join(' > '),
      r.item.tipo, r.item.natureza, R$(r.totals.atualizado), R$(r.totals.pago), r.totals.pendente ? R$(r.totals.pendente) : '-',
    ]), { foot: [`${lista.length} itens`, '', '', '', '', '', R$(sum('atualizado')), R$(sum('pago')), R$(sum('pendente'))],
      right: [6, 7, 8], w: { 0: 18, 2: 28, 3: 46, 4: 22, 5: 19, 6: 24, 7: 24, 8: 24 }, fs: 8 });
  }

  if (opts.tipo === 'pagamentos') {
    const itensOk = new Map(filtrarItens(ativos, { ...f, de: '', ate: '' }).map(r => [r.item.id, r]));
    const lista = ctx.payments.filter(p => p.situacao === 'Realizado' && itensOk.has(p.itemId))
      .map(p => ({ ...p, _d: p.dataPago || p.data })).filter(p => (!f.de || p._d >= f.de) && (!f.ate || p._d <= f.ate))
      .sort((a, b) => a._d.localeCompare(b._d));
    const comForma = lista.some(p => p.forma);
    const body = []; let mes = '', sub = 0;
    const fechaMes = () => { if (mes) body.push([{ content: `Subtotal ${monthLabel(mes)}`, colSpan: comForma ? 5 : 4, styles: { fontStyle: 'bold', halign: 'right', fillColor: [232, 240, 236] } }, { content: R$(sub), styles: { fontStyle: 'bold', halign: 'right', fillColor: [232, 240, 236] } }]); };
    for (const p of lista) {
      if (p._d.slice(0, 7) !== mes) { fechaMes(); mes = p._d.slice(0, 7); sub = 0; }
      const it = itensOk.get(p.itemId).item; sub += p.valor;
      const linha = [dateBR(p._d), it.descricao, p.descricao && p.descricao !== 'Pagamento (planilha)' ? p.descricao : '', ctx.stageName(it.etapaId)];
      if (comForma) linha.push(p.forma || '');
      body.push([...linha, R$(p.valor)]);
    }
    fechaMes();
    const nc = comForma ? 6 : 5;
    tabela(['Data', 'Item', 'Descrição do pagamento', 'Etapa', ...(comForma ? ['Forma'] : []), 'Valor'], body,
      { foot: [`${lista.length} pagamentos`, ...Array(nc - 2).fill(''), R$(lista.reduce((s, p) => s + p.valor, 0))], right: [nc - 1], w: { 0: 18, 1: 80, 2: comForma ? 66 : 80, [nc - 1]: 26 }, fs: 8 });
  }

  // rodapé com numeração
  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...LINHA); doc.setLineWidth(0.2); doc.line(M, H - 10, W - M, H - 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...CINZA);
    doc.text('Controle da Obra - valores em reais (R$); itens cancelados não entram nos totais.', M, H - 6);
    doc.text(`Página ${i} de ${n}`, W - M, H - 6, { align: 'right' });
  }
  const nome = `${{ resumo: 'resumo-obra', itens: 'itens-obra', pagamentos: 'extrato-pagamentos' }[opts.tipo]}-${todayISO()}.pdf`;
  return { blob: doc.output('blob'), nome, paginas: n };

  function aviso(m) { doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...CINZA); doc.text(txt(m), M, y + 2); y += 9; }
}

function filtrarItens(rows, f) {
  return rows.filter(r => {
    const it = r.item;
    if (f.tipo && it.tipo !== f.tipo) return false;
    if (f.etapa && it.etapaId !== f.etapa) return false;
    if (f.cat && it.categoriaId !== f.cat && it.subcategoriaId !== f.cat) return false;
    if (f.de && it.dataCompra < f.de) return false;
    if (f.ate && it.dataCompra > f.ate) return false;
    return true;
  });
}

function descreverFiltros(ctx, f, tipo) {
  if (tipo === 'resumo') return '';
  const p = [];
  if (f.tipo) p.push(`tipo ${f.tipo}`);
  if (f.etapa) p.push(`etapa ${ctx.stageName(f.etapa)}`);
  if (f.cat) p.push(`categoria ${ctx.catName(f.cat)}`);
  if (f.de || f.ate) p.push(`${tipo === 'pagamentos' ? 'pagamentos' : 'compras'} de ${f.de ? dateBR(f.de) : 'início'} até ${f.ate ? dateBR(f.ate) : 'hoje'}`);
  return p.length ? p.join(' · ') : 'nenhum (todos os registros)';
}

/** Entrega o arquivo: menu de compartilhar no celular; download no computador. */
export async function entregarPDF({ blob, nome }) {
  const file = new File([blob], nome, { type: 'application/pdf' });
  const celular = matchMedia('(pointer: coarse)').matches;
  if (celular && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nome }); return 'compartilhado'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelado'; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'baixado';
}
