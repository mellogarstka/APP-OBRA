// Camada IndexedDB nativa, com versionamento de esquema e migrações incrementais.
// Optou-se por IndexedDB puro (sem Dexie) para não haver dependência externa
// e o app funcionar offline sem baixar bibliotecas.

export const DB_NAME = 'obra-financeiro';
export const DB_VERSION = 1;
export const STORES = ['items', 'adjustments', 'payments', 'suppliers', 'categories', 'stages', 'history', 'settings'];

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
 */
export async function writeAll(ops) {
  const db = await openDB();
  const names = [...new Set(ops.map(o => o.store))];
  if (!names.length) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    for (const o of ops) {
      const st = tx.objectStore(o.store);
      if (o.clear) st.clear();
      else if (o.del !== undefined) st.delete(o.del);
      else st.put(o.value);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
  });
}

export async function put(store, value) { return writeAll([{ store, value }]); }

export async function dumpAll() {
  const out = {};
  for (const s of STORES) out[s] = await getAll(s);
  return out;
}
