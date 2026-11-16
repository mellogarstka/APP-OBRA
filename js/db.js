// Camada IndexedDB nativa, com versionamento de esquema e migrações incrementais.
// Optou-se por IndexedDB puro (sem Dexie) para não haver dependência externa
// e o app funcionar offline sem baixar bibliotecas.

export const DB_NAME = 'obra-financeiro';
export const DB_VERSION = 2;
export const STORES = ['items', 'adjustments', 'payments', 'suppliers', 'categories', 'stages', 'history', 'settings'];

// Sincronização (v2): toda gravação nos stores de dados entra também numa fila local
// ("outbox"), na MESMA transação. A fila é enviada à nuvem quando houver conexão.
// Configurações sincronizadas: só as que valem para a obra; as demais são do aparelho.
export const SYNC_SETTINGS = ['obra', 'avisoDias'];
export const keyOf = (store, v) => store === 'settings' ? v.key : v.id;
const tracked = (store, key) => STORES.includes(store) && (store !== 'settings' || SYNC_SETTINGS.includes(key));
let seq = 0;
const outboxEntry = (store, id, deleted) => ({ k: `${store}|${id}`, store, id, deleted, n: `${Date.now()}-${++seq}` });

// Cada migração recebe (db, tx) e leva o esquema da versão N-1 para N.
// Novas versões: acrescentar uma função e incrementar DB_VERSION — dados nunca são apagados.
const MIGRATIONS = {
  1(db) {
    const items = db.createObjectStore('items', { keyPath: 'id' });
    items.createIndex('dataCompra', 'dataCompra');
    const adj = db.createObjectStore('adjustments', { keyPath: 'id' });
    adj.createIndex('itemId', 'itemId');
    const pay = db.createObjectStore('payments', { keyPath: 'id' });
    pay.createIndex('itemId', 'itemId');
    pay.createIndex('situacao', 'situacao');
    db.createObjectStore('suppliers', { keyPath: 'id' });
    const cat = db.createObjectStore('categories', { keyPath: 'id' });
    cat.createIndex('parentId', 'parentId');
    db.createObjectStore('stages', { keyPath: 'id' });
    const hist = db.createObjectStore('history', { keyPath: 'id' });
    hist.createIndex('recordId', 'recordId');
    hist.createIndex('ts', 'ts');
    db.createObjectStore('settings', { keyPath: 'key' });
  },
  2(db) {
    db.createObjectStore('outbox', { keyPath: 'k' });   // fila de envio à nuvem
    db.createObjectStore('syncmeta', { keyPath: 'key' }); // estado da sincronização (por aparelho)
  },
};

let dbPromise = null;

export function openDB(idb = globalThis.indexedDB) {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion + 1; v <= DB_VERSION; v++) MIGRATIONS[v](db, req.transaction);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); globalThis.location?.reload?.(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function resetDBHandle() { dbPromise = null; }

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, id) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(id));
}

export async function getByIndex(store, index, value) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).index(index).getAll(value));
}

/**
 * Executa várias gravações em UMA transação atômica: ou tudo grava, ou nada.
 * ops: [{ store, value }] (put) | [{ store, del: id }] | [{ store, clear: true }]
 * opts.track = false → não enfileira para a nuvem (usado ao aplicar dados vindos da nuvem).
 */
export async function writeAll(ops, { track = true } = {}) {
  const db = await openDB();
  if (!ops.length) return;
  // "clear" em store sincronizado: lê as chaves antes para enviar exclusões à nuvem.
  const cleared = {};
  if (track) for (const o of ops) if (o.clear && STORES.includes(o.store)) cleared[o.store] = await getAllKeys(o.store);
  const names = [...new Set(ops.map(o => o.store))];
  let mudou = false;
  if (track) names.push('outbox');
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...new Set(names)], 'readwrite');
    const out = track ? tx.objectStore('outbox') : null;
    for (const o of ops) {
      const st = tx.objectStore(o.store);
      if (o.clear) {
        st.clear();
        if (out) for (const k of cleared[o.store] || []) if (tracked(o.store, k)) { out.put(outboxEntry(o.store, k, true)); mudou = true; }
      } else if (o.del !== undefined) {
        st.delete(o.del);
        if (out && tracked(o.store, o.del)) { out.put(outboxEntry(o.store, o.del, true)); mudou = true; }
      } else {
        st.put(o.value);
        const k = keyOf(o.store, o.value);
        if (out && tracked(o.store, k)) { out.put(outboxEntry(o.store, k, false)); mudou = true; }
      }
    }
    tx.oncomplete = () => { if (mudou) globalThis.dispatchEvent?.(new Event('obra:changed')); resolve(); };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
  });
}

export async function getAllKeys(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAllKeys());
}

/** Remove da fila somente as entradas que não mudaram desde o envio (evita perder edição feita durante o envio). */
export async function ackOutbox(entries) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    const st = tx.objectStore('outbox');
    for (const e of entries) {
      const r = st.get(e.k);
      r.onsuccess = () => { if (r.result && r.result.n === e.n) st.delete(e.k); };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Enfileira todos os registros locais (primeiro envio de um aparelho para a nuvem). */
export async function enqueueAll() {
  const ops = [];
  for (const s of STORES) for (const k of await getAllKeys(s)) if (tracked(s, k)) ops.push({ store: 'outbox', value: outboxEntry(s, k, false) });
  if (ops.length) await writeAll(ops, { track: false });
  return ops.length;
}

export async function put(store, value) { return writeAll([{ store, value }]); }

export async function dumpAll() {
  const out = {};
  for (const s of STORES) out[s] = await getAll(s);
  return out;
}
