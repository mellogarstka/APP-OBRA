// Sincronização local-first com o Supabase.
//
// Modelo: o app continua lendo e gravando SOMENTE no IndexedDB (funciona offline).
// Cada gravação entra na fila "outbox" (db.js). Este módulo:
//   1) ENVIA a fila → tabela public.registros (upsert por usuário/store/id);
//   2) BAIXA o que mudou na nuvem desde o último cursor (updated_at do servidor).
// Conflito entre aparelhos: vence a última gravação enviada (registro a registro).
// Uma alteração local ainda não enviada nunca é sobrescrita pela nuvem.
// Nada é apagado de verdade: exclusões viram "deleted = true" (lápide).
import * as db from './db.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const TABLE = 'registros';
const LIB = 'js/vendor/supabase-2.119.0.js';
const PAGE = 500;
const OVERLAP_MS = 5 * 60 * 1000; // releitura de segurança (transações que gravaram fora de ordem)

let client = null;
let user = null;
let running = null;
let again = false;
let timer = null;
let onRemote = () => {};
const listeners = new Set();
export const state = { status: 'off', lastSync: null, pendentes: 0, error: null, conflito: null };

export const configured = () => !!(SUPABASE_URL && SUPABASE_KEY);
export const currentUser = () => user;
export function subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
function emit(patch = {}) { Object.assign(state, patch); for (const fn of listeners) { try { fn(state); } catch { /* ignore */ } } }

// ---------------------------------------------------------------- meta (por aparelho)
async function meta() {
  const r = await db.get('syncmeta', 'meta');
  return r?.value || { userId: null, cursor: null, lastSync: null };
}
async function setMeta(v) { await db.writeAll([{ store: 'syncmeta', value: { key: 'meta', value: v } }], { track: false }); }

// ---------------------------------------------------------------- inicialização
function loadLib() {
  if (globalThis.supabase?.createClient) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = LIB; s.onload = res; s.onerror = () => rej(new Error('Biblioteca de sincronização não carregou.'));
    document.head.appendChild(s);
  });
}

/** Para testes: injeta um cliente falso. */
export function _setClient(c, u) { client = c; user = u; }

export async function initSync(onRemoteChange) {
  onRemote = onRemoteChange || onRemote;
  const m = await meta();
  emit({ lastSync: m.lastSync, pendentes: (await db.getAllKeys('outbox')).length });
  if (!configured()) { emit({ status: 'off' }); return; }
  try {
    await loadLib();
    client = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'obra-auth' },
    });
    const { data } = await client.auth.getSession();
    user = data.session?.user || null;
    client.auth.onAuthStateChange((ev, session) => {
      const novo = session?.user || null;
      const mudouUser = (novo?.id || null) !== (user?.id || null);
      user = novo;
      emit({ status: user ? 'idle' : 'signedout' });
      if (mudouUser && user) schedule(0);
    });
    emit({ status: user ? 'idle' : 'signedout' });
  } catch (e) {
    emit({ status: 'error', error: e.message });
    return;
  }
  globalThis.addEventListener('obra:changed', () => schedule(1500));
  globalThis.addEventListener('online', () => schedule(0));
  globalThis.addEventListener('offline', () => emit({ status: user ? 'offline' : state.status }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
  setInterval(() => { if (document.visibilityState === 'visible') schedule(0); }, 60_000);
  if (user) schedule(0);
}

export function schedule(ms = 0) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, ms);
}

// ---------------------------------------------------------------- conta
export async function signIn(email, senha) {
  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password: senha });
  if (error) throw new Error(traduz(error.message));
}
export async function signUp(email, senha) {
  const redirect = globalThis.location ? location.origin + location.pathname : undefined;
  const { data, error } = await client.auth.signUp({ email: email.trim(), password: senha, options: { emailRedirectTo: redirect } });
  if (error) throw new Error(traduz(error.message));
  return { precisaConfirmar: !data.session };
}
export async function resetPassword(email) {
  const redirect = globalThis.location ? location.origin + location.pathname : undefined;
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect });
  if (error) throw new Error(traduz(error.message));
}
export async function updatePassword(senha) {
  const { error } = await client.auth.updateUser({ password: senha });
  if (error) throw new Error(traduz(error.message));
}
/** Sair: os dados ficam no aparelho; a próxima conta que entrar passa pelo "primeiro envio". */
export async function signOut() {
  await client.auth.signOut();
  const m = await meta();
  await setMeta({ ...m, userId: null, cursor: null });
  user = null;
  emit({ status: 'signedout' });
}

function traduz(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('invalid login')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'E-mail ainda não confirmado. Abra o link enviado para o seu e-mail.';
  if (m.includes('already registered')) return 'Este e-mail já tem conta. Use "Entrar".';
  if (m.includes('password should be')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'Criação de contas desativada no Supabase.';
  if (m.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sem conexão com a nuvem.';
  return msg;
}

// ---------------------------------------------------------------- ciclo de sincronização
export async function syncNow() {
  if (!client || !user) return;
  if (globalThis.navigator && navigator.onLine === false) { emit({ status: 'offline' }); return; }
  if (running) { again = true; return running; }
  running = (async () => {
    emit({ status: 'syncing', error: null });
    try {
      do {
        again = false;
        const m = await meta();
        if (m.userId !== user.id) {
          const ok = await firstSync(m);
          if (!ok) return; // aguardando escolha do usuário (conflito)
        }
        await push();
        const n = await pull();
        const fim = new Date().toISOString();
        await setMeta({ ...(await meta()), lastSync: fim });
        emit({ lastSync: fim });
        if (n) onRemote();
      } while (again);
      emit({ status: 'idle', pendentes: (await db.getAllKeys('outbox')).length });
    } catch (e) {
      const msg = traduz(e?.message || String(e));
      emit({ status: globalThis.navigator?.onLine === false ? 'offline' : 'error', error: msg, pendentes: (await db.getAllKeys('outbox')).length });
      throw e;
    } finally { running = null; }
  })();
  return running;
}

const temDadosLocais = async () => (await db.getAllKeys('items')).length + (await db.getAllKeys('payments')).length > 0;

async function contagemNuvem() {
  const { count, error } = await client.from(TABLE).select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count || 0;
}

/**
 * Primeira sincronização desta conta NESTE aparelho.
 *  - nuvem vazia            → envia tudo deste aparelho;
 *  - aparelho sem lançamentos → troca as listas locais (categorias/etapas iniciais) pelas da nuvem;
 *  - ambos com dados        → pergunta ao usuário (state.conflito).
 */
async function firstSync(m) {
  const nuvem = await contagemNuvem();
  if (nuvem === 0) {
    await db.enqueueAll();
  } else if (!(await temDadosLocais())) {
    await replaceLocalWithCloud();
  } else {
    emit({ status: 'conflict', conflito: { nuvem, local: (await db.getAllKeys('items')).length } });
    return false;
  }
  await setMeta({ ...m, userId: user.id, cursor: m.userId === user.id ? m.cursor : null });
  return true;
}

/** Resolve o conflito do primeiro envio. modo: 'nuvem' (substitui este aparelho) | 'juntar' (soma os dois). */
export async function resolveConflict(modo) {
  const m = await meta();
  if (modo === 'nuvem') await replaceLocalWithCloud();
  else await db.enqueueAll();
  await setMeta({ ...m, userId: user.id, cursor: null });
  emit({ conflito: null });
  await syncNow();
  onRemote();
}

async function replaceLocalWithCloud() {
  const ops = [{ store: 'outbox', clear: true }];
  for (const s of db.STORES) {
    if (s === 'settings') { for (const k of db.SYNC_SETTINGS) ops.push({ store: s, del: k }); }
    else ops.push({ store: s, clear: true });
  }
  await db.writeAll(ops, { track: false });
  const m = await meta();
  await setMeta({ ...m, cursor: null });
}

async function push() {
  for (;;) {
    const fila = (await db.getAll('outbox')).slice(0, PAGE);
    if (!fila.length) break;
    const rows = [];
    for (const e of fila) {
      const v = e.deleted ? null : await db.get(e.store, e.id);
      rows.push({ user_id: user.id, store: e.store, id: String(e.id), data: v ?? {}, deleted: !v });
    }
    const { error } = await client.from(TABLE).upsert(rows, { onConflict: 'user_id,store,id' });
    if (error) throw new Error(error.message);
    await db.ackOutbox(fila);
    emit({ pendentes: (await db.getAllKeys('outbox')).length });
    if (fila.length < PAGE) {
      // pode ter sobrado entrada alterada durante o envio: repete o laço
      if (!(await db.getAllKeys('outbox')).length) break;
    }
  }
}

async function pull() {
  const m = await meta();
  const desde = m.cursor ? new Date(new Date(m.cursor).getTime() - OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z';
  let cursor = m.cursor;
  let aplicados = 0;
  let from = 0;
  for (;;) {
    const { data, error } = await client.from(TABLE).select('store,id,data,deleted,updated_at')
      .gt('updated_at', desde).order('updated_at', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    const pend = new Set(await db.getAllKeys('outbox'));
    const ops = [];
    for (const r of data) {
      if (!cursor || r.updated_at > cursor) cursor = r.updated_at;
      if (!db.STORES.includes(r.store)) continue;
      if (r.store === 'settings' && !db.SYNC_SETTINGS.includes(r.id)) continue;
      if (pend.has(`${r.store}|${r.id}`)) continue; // alteração local pendente prevalece
      const atual = await db.get(r.store, r.id);
      if (r.deleted) { if (atual) { ops.push({ store: r.store, del: r.id }); aplicados++; } continue; }
      if (atual && JSON.stringify(atual) === JSON.stringify(r.data)) continue;
      ops.push({ store: r.store, value: r.data });
      aplicados++;
    }
    if (ops.length) await db.writeAll(ops, { track: false });
    if (data.length < PAGE) break;
    from += PAGE;
  }
  await setMeta({ ...(await meta()), cursor });
  return aplicados;
}
