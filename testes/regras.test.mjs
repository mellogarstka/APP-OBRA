import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import * as S from '../app/js/store.js';
import { resetDBHandle } from '../app/js/db.js';
import { todayISO, addMonths, addDays, parseMoney } from '../app/js/fmt.js';
import { projectTotals, splitMaterialMO } from '../app/js/calc.js';

const R = (v) => Math.round(v * 100);
let base;
async function fresh() {
  globalThis.indexedDB = new IDBFactory();
  resetDBHandle();
  await S.init();
  const all = await S.loadAll();
  base = { categoriaId: all.categories[0].id, etapaId: all.stages[0].id, tipo: 'Mão de obra', natureza: 'Normal', dataCompra: '2026-11-01' };
}
const tot = async (id) => (await S.getBundle(id));
const results = [];
async function test(name, fn) {
  try { await fresh(); await fn(); results.push(['OK  ', name]); }
  catch (e) { results.push(['FALHA', name + ' → ' + e.message]); }
}
async function expectBlocked(fn, excedente) {
  try { await fn(); } catch (e) {
    assert.equal(e.name, 'ValidationError');
    if (excedente !== undefined) assert.equal(e.detail.excedente, excedente);
    return e;
  }
  throw new Error('Deveria ter bloqueado');
}

await test('parseMoney formatos BR', () => {
  assert.equal(parseMoney('1.234,56'), 123456);
  assert.equal(parseMoney('R$ 8.000'), 800000);
  assert.equal(parseMoney('1234.5'), 123450);
  assert.equal(parseMoney('0,10'), 10);
  assert.ok(Number.isNaN(parseMoney('abc')));
});

await test('T1 – Serviço com aditivos e pagamento programado', async () => {
  const it = await S.createItem({ ...base, descricao: 'Pintura', valorOriginal: R(8000) });
  await S.addAdjustment(it.id, { tipo: 'Aditivo', valor: R(1200) });
  await S.addAdjustment(it.id, { tipo: 'Aditivo', valor: R(500) });
  await S.addPayment(it.id, { valor: R(3000), situacao: 'Realizado', data: '2026-11-10' });
  await S.addPayment(it.id, { valor: R(2000), situacao: 'Programado', data: '2026-11-20' });
  const { totals: t, adj } = await tot(it.id);
  assert.deepEqual([t.atualizado, t.pago, t.programado, t.pendente, t.semData], [R(9700), R(3000), R(2000), R(6700), R(4700)]);
  assert.deepEqual(adj.map(a => a.descricao).sort(), ['Aditivo 01', 'Aditivo 02']);
});

await test('T2 – Cartão de crédito 10x, 3 pagas', async () => {
  const hoje = todayISO();
  const parcelas = S.monthlyInstallments(R(6000), 10, addMonths(hoje, -2));
  const it = await S.createItem({ ...base, tipo: 'Equipamento', descricao: 'Equipamento', valorOriginal: R(6000), dataCompra: addMonths(hoje, -2) },
    { modo: 'cartao', parcelas, marcarVencidasPagas: true });
  const { totals: t, pays } = await tot(it.id);
  assert.deepEqual([t.atualizado, t.pago, t.programado, t.semData], [R(6000), R(1800), R(4200), 0]);
  assert.equal(pays.filter(p => p.situacao === 'Programado').length, 7);
  assert.ok(pays.every(p => p.data));
});

await test('Cartão – centavos vão para a última parcela', async () => {
  const ps = S.monthlyInstallments(R(1000), 3, '2026-01-31');
  assert.deepEqual(ps.map(p => p.valor), [33333, 33333, 33334]);
  assert.deepEqual(ps.map(p => p.data), ['2026-01-31', '2026-02-28', '2026-03-31']);
});

await test('T3 – Pagamento conforme evolução (entrada)', async () => {
  const it = await S.createItem({ ...base, descricao: 'Ampliação', valorOriginal: R(20000) }, { modo: 'entrada', valorEntrada: R(5000) });
  const { totals: t, pays } = await tot(it.id);
  assert.deepEqual([t.pago, t.pendente, t.programado, t.semData], [R(5000), R(15000), 0, R(15000)]);
  assert.equal(pays.filter(p => p.situacao === 'Programado').length, 0);
});

await test('T4 – Bloqueio de pagamento realizado (excedente 500)', async () => {
  const it = await S.createItem({ ...base, descricao: 'Contrato', valorOriginal: R(8000) });
  await S.addPayment(it.id, { valor: R(2500), situacao: 'Realizado', data: '2026-11-05' });
  const e = await expectBlocked(() => S.addPayment(it.id, { valor: R(6000), situacao: 'Realizado', data: '2026-11-06' }), R(500));
  assert.equal(e.message, S.MSG_EXCEDE);
  // atalho: aditivo do excedente libera o pagamento
  await S.addAdjustment(it.id, { tipo: 'Aditivo', valor: e.detail.excedente });
  await S.addPayment(it.id, { valor: R(6000), situacao: 'Realizado', data: '2026-11-06' });
  assert.equal((await tot(it.id)).totals.pendente, 0);
});

await test('T5 – Bloqueio de pagamento programado (excedente 500)', async () => {
  const it = await S.createItem({ ...base, descricao: 'Contrato', valorOriginal: R(8000) });
  await S.addPayment(it.id, { valor: R(2500), situacao: 'Realizado', data: '2026-11-05' });
  await S.addPayment(it.id, { valor: R(5000), situacao: 'Programado', data: '2026-12-05' });
  await expectBlocked(() => S.addPayment(it.id, { valor: R(1000), situacao: 'Programado', data: '2026-12-10' }), R(500));
});

await test('T6 – Desconto de quitação', async () => {
  const it = await S.createItem({ ...base, descricao: 'Contrato', valorOriginal: R(8000) });
  await S.addPayment(it.id, { valor: R(7800), situacao: 'Realizado', data: '2026-11-05' });
  await S.addAdjustment(it.id, { tipo: 'Desconto de quitação', valor: R(200) });
  const b = await tot(it.id);
  assert.deepEqual([b.item.valorOriginal, b.totals.atualizado, b.totals.pendente, b.status], [R(8000), R(7800), 0, 'Quitado']);
  assert.ok(b.history.some(h => h.acao === 'Desconto de quitação registrado'));
});

await test('T7 – Correção de digitação 8.500 → 8.000', async () => {
  const it = await S.createItem({ ...base, descricao: 'Contrato', valorOriginal: R(8500) });
  await expectBlocked(() => S.correctOriginal(it.id, R(8000), ''));
  await S.correctOriginal(it.id, R(8000), 'Erro de digitação');
  const b = await tot(it.id);
  assert.equal(b.item.valorOriginal, R(8000));
  assert.equal(b.adj.length, 0);
  const h = b.history.find(h => h.acao === 'Correção do valor original');
  assert.ok(h && h.anterior.includes('8.500') && h.novo.includes('8.000'));
});

await test('T8 – Retrabalho aparece em MO e retrabalho, custo +1.200 uma vez', async () => {
  const it = await S.createItem({ ...base, descricao: 'Refazer reboco', valorOriginal: R(1200), natureza: 'Retrabalho' });
  const { rows } = await S.loadAll();
  const pt = projectTotals(rows);
  assert.equal(pt.custo, R(1200));
  assert.equal(pt.retrabalho, R(1200));
  assert.equal(splitMaterialMO(rows[0].item, rows[0].totals).maoDeObra, R(1200));
});

await test('T9 – Upgrade: custo +7.000, diferença 2.000', async () => {
  await S.createItem({ ...base, tipo: 'Material', descricao: 'Porcelanato', valorOriginal: R(7000), natureza: 'Upgrade', valorReferencia: R(5000) });
  const pt = projectTotals((await S.loadAll()).rows);
  assert.equal(pt.custo, R(7000));
  assert.equal(pt.upgrades, R(2000));
});

await test('T10 – Parcela atrasada marcada como paga', async () => {
  const ontem = addDays(todayISO(), -1);
  const it = await S.createItem({ ...base, descricao: 'Serviço', valorOriginal: R(1000) });
  const p = await S.addPayment(it.id, { valor: R(1000), situacao: 'Programado', data: ontem });
  let { pays } = await tot(it.id);
  assert.ok(pays.some(x => x.situacao === 'Programado' && x.data < todayISO()), 'deveria estar atrasada');
  await S.markPaid(p.id, { dataPago: todayISO(), valor: R(1000) });
  const b = await tot(it.id);
  assert.deepEqual([b.totals.pago, b.totals.programado], [R(1000), 0]);
  assert.ok(!b.pays.some(x => x.situacao === 'Programado'));
});

await test('T11 – Cancelamento de pagamento realizado', async () => {
  const it = await S.createItem({ ...base, descricao: 'Serviço', valorOriginal: R(5000) });
  const p = await S.addPayment(it.id, { valor: R(3000), situacao: 'Realizado', data: '2026-11-10' });
  await S.cancelPayment(p.id, 'Lançado em duplicidade');
  const b = await tot(it.id);
  assert.equal(b.totals.pago, 0);
  assert.equal(b.pays.find(x => x.id === p.id).situacao, 'Cancelado');
  assert.ok(b.history.some(h => h.acao === 'Cancelado' && h.motivo === 'Lançado em duplicidade'));
});

await test('Regra 14 – não cancela item com pagamento realizado', async () => {
  const it = await S.createItem({ ...base, descricao: 'X', valorOriginal: R(100) }, { modo: 'avista' });
  await expectBlocked(() => S.cancelItem(it.id, 'teste'));
});

await test('Redução não pode ficar abaixo de pago + programado', async () => {
  const it = await S.createItem({ ...base, descricao: 'X', valorOriginal: R(1000) }, { modo: 'entrada', valorEntrada: R(800) });
  await expectBlocked(() => S.addAdjustment(it.id, { tipo: 'Redução', valor: R(300) }));
  await S.addAdjustment(it.id, { tipo: 'Redução', valor: R(200) });
});

await test('Serviço misto: soma material + MO deve bater', async () => {
  await expectBlocked(() => S.createItem({ ...base, tipo: 'Serviço misto', descricao: 'X', valorOriginal: R(1000), parcelaMaterial: R(400), parcelaMO: R(500) }));
});

await test('Backup → restauração preserva dados', async () => {
  const it = await S.createItem({ ...base, descricao: 'Pintura', valorOriginal: R(8000) }, { modo: 'avista' });
  const bk = JSON.parse(JSON.stringify(await S.exportBackup()));
  await S.createItem({ ...base, descricao: 'Outro', valorOriginal: R(10) });
  await S.restoreBackup(bk);
  const { rows } = await S.loadAll();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item.id, it.id);
  assert.equal(rows[0].totals.pago, R(8000));
});

await test('D3 – Aditivo misto com separação informada (só mão de obra)', async () => {
  const it = await S.createItem({ ...base, tipo: 'Serviço misto', descricao: 'Muro', valorOriginal: R(10000), parcelaMaterial: R(6000), parcelaMO: R(4000) });
  await S.addAdjustment(it.id, { tipo: 'Aditivo', valor: R(2500), valorMaterial: 0 });
  const b = await tot(it.id);
  const sp = splitMaterialMO(b.item, b.totals, b.adj);
  assert.deepEqual([sp.material, sp.maoDeObra], [R(6000), R(6500)]);
});

await test('D3 – Aditivo misto sem separação segue a proporção', async () => {
  const it = await S.createItem({ ...base, tipo: 'Serviço misto', descricao: 'Muro', valorOriginal: R(10000), parcelaMaterial: R(6000), parcelaMO: R(4000) });
  await S.addAdjustment(it.id, { tipo: 'Aditivo', valor: R(1000) });
  await S.addAdjustment(it.id, { tipo: 'Redução', valor: R(500), valorMaterial: R(500) });
  const b = await tot(it.id);
  const sp = splitMaterialMO(b.item, b.totals, b.adj);
  assert.deepEqual([sp.material, sp.maoDeObra], [R(6100), R(4400)]);
  await expectBlocked(() => S.addAdjustment(it.id, { tipo: 'Aditivo', valor: R(100), valorMaterial: R(200) }));
});

await test('D3 – Correção do valor original mantém a proporção do misto', async () => {
  const it = await S.createItem({ ...base, tipo: 'Serviço misto', descricao: 'Muro', valorOriginal: R(10000), parcelaMaterial: R(6000), parcelaMO: R(4000) });
  await S.correctOriginal(it.id, R(9000), 'digitação');
  const b = await tot(it.id);
  assert.deepEqual([b.item.parcelaMaterial, b.item.parcelaMO], [R(5400), R(3600)]);
});

async function parcial(modo, data) {
  const it = await S.createItem({ ...base, descricao: 'Serviço', valorOriginal: R(3000) });
  const p = await S.addPayment(it.id, { valor: R(1000), situacao: 'Programado', data: '2026-12-10' });
  await S.markPaid(p.id, { dataPago: '2026-12-10', valor: R(700), restante: modo ? { modo, data } : null });
  return tot(it.id);
}
await test('D4 – Pago a menor exige destino do restante', async () => {
  await expectBlocked(() => parcial(null));
});
await test('D4 – Restante na mesma data', async () => {
  const { totals: t, pays } = await parcial('mesma');
  const r = pays.find(p => p.situacao === 'Programado');
  assert.deepEqual([t.pago, t.programado, t.semData, r.valor, r.data], [R(700), R(300), R(2000), R(300), '2026-12-10']);
});
await test('D4 – Restante em outra data', async () => {
  const { pays } = await parcial('outra', '2027-01-15');
  assert.equal(pays.find(p => p.situacao === 'Programado').data, '2027-01-15');
});
await test('D4 – Restante sem data', async () => {
  const { totals: t } = await parcial('semdata');
  assert.deepEqual([t.pago, t.programado, t.semData, t.atualizado], [R(700), 0, R(2300), R(3000)]);
});
await test('D4 – Restante como desconto de quitação', async () => {
  const { totals: t, adj } = await parcial('desconto');
  assert.deepEqual([t.atualizado, t.pago, t.semData], [R(2700), R(700), R(2000)]);
  assert.equal(adj[0].tipo, 'Desconto de quitação');
});

await test('E1 – Corrigir data e valor de pagamento realizado (com histórico)', async () => {
  const it = await S.createItem({ ...base, descricao: 'Porta', valorOriginal: R(1000) });
  const p = await S.addPayment(it.id, { valor: R(400), situacao: 'Realizado', data: '2026-11-01' });
  await S.editPayment(p.id, { data: '2026-10-01', valor: R(450) }, 'digitação');
  const b = await tot(it.id);
  const np = b.pays.find(x => x.id === p.id);
  assert.deepEqual([np.dataPago, np.data, b.totals.pago], ['2026-10-01', '2026-10-01', R(450)]);
  const h = b.history.filter(x => x.acao === 'Pagamento corrigido');
  assert.equal(h.length, 2);
  assert.ok(h.every(x => x.motivo === 'digitação'));
});
await test('E2 – Correção não pode passar do saldo do item', async () => {
  const it = await S.createItem({ ...base, descricao: 'Janela', valorOriginal: R(1000) });
  const p1 = await S.addPayment(it.id, { valor: R(600), situacao: 'Realizado', data: '2026-11-01' });
  await S.addPayment(it.id, { valor: R(300), situacao: 'Programado', data: '2026-12-01' });
  await expectBlocked(() => S.editPayment(p1.id, { valor: R(800) }));
  await S.editPayment(p1.id, { valor: R(700) }); // 700 + 300 = 1000: permitido
  assert.equal((await tot(it.id)).totals.pago, R(700));
});
await test('E3 – Corrigir vencimento de programado; cancelado não edita', async () => {
  const it = await S.createItem({ ...base, descricao: 'Pia', valorOriginal: R(500) });
  const p = await S.addPayment(it.id, { valor: R(500), situacao: 'Programado', data: '2026-12-10' });
  await S.editPayment(p.id, { data: '2026-12-20' });
  assert.equal((await tot(it.id)).pays[0].data, '2026-12-20');
  await S.cancelPayment(p.id, 'x');
  await expectBlocked(() => S.editPayment(p.id, { data: '2026-12-21' }));
});

for (const [s, n] of results) console.log(s, n);
const fails = results.filter(r => r[0] === 'FALHA').length;
console.log(`\n${results.length - fails}/${results.length} aprovados`);
process.exit(fails ? 1 : 0);
