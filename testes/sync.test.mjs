// Testes da sincronização com um "Supabase falso" em memória e dois aparelhos simulados.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import assert from 'node:assert/strict';
import * as S from '../app/js/store.js';
import * as db from '../app/js/db.js';
import * as Sync from '../app/js/sync.js';

const R = (v) => Math.round(v * 100);
globalThis.navigator ??= {};

// ---------- servidor falso (imita a tabela public.registros com RLS por user_id)
function fakeServer() {
  const rows = new Map(); let clock = Date.parse('2026-11-16T12:00:00Z');
  const ts = () => new Date(clock += 7).toISOString().replace('Z', '123+00:00');
  const clientFor = (uid) => ({
    from() {
      return {
        upsert(list) {
          for (const r of list) { assert.equal(r.user_id, uid); rows.set(`${uid}|${r.store}|${r.id}`, { ...structuredClone(r), updated_at: ts() }); }
          return Promise.resolve({ error: null });
        },
        select(cols, opt = {}) {
          const mine = () => [...rows.values()].filter(r => r.user_id === uid);
          if (opt.head) return Promise.resolve({ count: mine().length, error: null });
          let gt = '';
          const q = {
            gt(_, v) { gt = v; return q; },
            order() { return q; },
            range(a, b) {
              const d = mine().filter(r => r.updated_at > gt).sort((x, y) => x.updated_at < y.updated_at ? -1 : 1).slice(a, b + 1)
                .map(r => structuredClone({ store: r.store, id: r.id, data: r.data, deleted: r.deleted, updated_at: r.updated_at }));
              return Promise.resolve({ data: d, error: null });
            },
          };
          return q;
        },
      };
    },
  });
  return { rows, clientFor };
}

// ---------- aparelhos
const devices = {};
async function useDevice(name, server, uid = 'u1') {
  if (!devices[name]) devices[name] = new IDBFactory();
  globalThis.indexedDB = devices[name];
  db.resetDBHandle();
  await S.init();
  Sync._setClient(server.clientFor(uid), { id: uid, email: 'joao@x' });
}
async function base() {
  const all = await S.loadAll();
  return { categoriaId: all.categories[0].id, etapaId: all.stages[0].id, tipo: 'Material', natureza: 'Normal', dataCompra: '2026-11-01' };
}

const results = [];
async function test(name, fn) {
  for (const k of Object.keys(devices)) delete devices[k];
  try { await fn(); results.push(['OK  ', name]); } catch (e) { results.push(['FALHA', name + ' → ' + (e.stack || e.message)]); }
}

await test('S1 – Celular envia, computador recebe tudo (sem duplicar categorias)', async () => {
  const sv = fakeServer();
  await useDevice('cel', sv);
  const it = await S.createItem({ ...(await base()), descricao: 'Cimento', valorOriginal: R(1560) }, { modo: 'avista' });
  await S.setSetting('obra', { nome: 'Residência', proprietario: 'JP', endereco: 'SMS' });
  await Sync.syncNow();
  assert.equal((await db.getAllKeys('outbox')).length, 0);
  const catsCel = (await db.getAll('categories')).length;

  await useDevice('pc', sv);
  await Sync.syncNow();
  const { rows, categories } = await S.loadAll();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item.id, it.id);
  assert.equal(rows[0].totals.pago, R(1560));
  assert.equal(categories.length, catsCel);
  assert.equal((await S.getSetting('obra')).nome, 'Residência');
});

await test('S2 – Alteração no computador chega ao celular', async () => {
  const sv = fakeServer();
  await useDevice('cel', sv);
  const it = await S.createItem({ ...(await base()), descricao: 'Muro', valorOriginal: R(10000) });
  await Sync.syncNow();
  await useDevice('pc', sv); await Sync.syncNow();
  await S.addPayment(it.id, { valor: R(4000), situacao: 'Realizado', data: '2026-11-10' });
  await S.addAdjustment(it.id, { tipo: 'Aditivo', valor: R(500) });
  await Sync.syncNow();
  await useDevice('cel', sv); await Sync.syncNow();
  const b = await S.getBundle(it.id);
  assert.deepEqual([b.totals.atualizado, b.totals.pago], [R(10500), R(4000)]);
});

await test('S3 – Offline: alteração fica na fila e sobe depois; local pendente não é sobrescrito', async () => {
  const sv = fakeServer();
  await useDevice('cel', sv);
  const it = await S.createItem({ ...(await base()), descricao: 'Porta', valorOriginal: R(1000) });
  await Sync.syncNow();
  await useDevice('pc', sv); await Sync.syncNow();
  await S.updateItem(it.id, { descricao: 'Porta (PC)' }); await Sync.syncNow();
  await useDevice('cel', sv);
  await S.updateItem(it.id, { descricao: 'Porta (celular, offline)' });
  assert.ok((await db.getAllKeys('outbox')).includes(`items|${it.id}`));
  await Sync.syncNow(); // sobe a versão do celular (última gravação vence)
  assert.equal((await db.get('items', it.id)).descricao, 'Porta (celular, offline)');
  await useDevice('pc', sv); await Sync.syncNow();
  assert.equal((await db.get('items', it.id)).descricao, 'Porta (celular, offline)');
});

await test('S4 – Dados nos dois aparelhos antes do 1º login → pede escolha; "nuvem" substitui', async () => {
  const sv = fakeServer();
  await useDevice('cel', sv);
  await S.createItem({ ...(await base()), descricao: 'A', valorOriginal: R(100) }); await Sync.syncNow();
  await useDevice('pc', sv, 'u1');
  // pc tinha dado próprio ANTES de logar: simula apagando meta e criando item
  await db.writeAll([{ store: 'syncmeta', del: 'meta' }], { track: false });
  devices.pc2 = null;
  await S.createItem({ ...(await base()), descricao: 'B', valorOriginal: R(200) });
  await db.writeAll([{ store: 'syncmeta', value: { key: 'meta', value: { userId: null } } }], { track: false });
  await Sync.syncNow();
  assert.equal(Sync.state.status, 'conflict');
  await Sync.resolveConflict('nuvem');
  const { rows } = await S.loadAll();
  assert.deepEqual(rows.map(r => r.item.descricao), ['A']);
});

await test('S5 – Restaurar backup propaga para o outro aparelho (inclusive exclusões)', async () => {
  const sv = fakeServer();
  await useDevice('cel', sv);
  const bk = JSON.parse(JSON.stringify(await S.exportBackup()));
  await S.createItem({ ...(await base()), descricao: 'Temporário', valorOriginal: R(50) });
  await Sync.syncNow();
  await useDevice('pc', sv); await Sync.syncNow();
  assert.equal((await S.loadAll()).rows.length, 1);
  await useDevice('cel', sv);
  await S.restoreBackup(bk); await Sync.syncNow();
  await useDevice('pc', sv); await Sync.syncNow();
  assert.equal((await S.loadAll()).rows.length, 0);
});

await test('S6 – Configuração local do aparelho não sobe (só obra e avisos)', async () => {
  const sv = fakeServer();
  await useDevice('cel', sv);
  await S.setSetting('ultimos', { categoriaId: 'x' });
  await Sync.syncNow();
  const keys = [...sv.rows.values()].filter(r => r.store === 'settings').map(r => r.id).sort();
  assert.deepEqual(keys, ['avisoDias', 'obra']);
});

for (const [s, n] of results) console.log(s, n);
const fails = results.filter(r => r[0] === 'FALHA').length;
console.log(`\n${results.length - fails}/${results.length} aprovados`);
process.exit(fails ? 1 : 0);
