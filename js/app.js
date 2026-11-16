import * as S from './store.js';
import { todayISO, addDays, money } from './fmt.js';
import { icon, esc, toast } from './ui.js';
import { setRefresh } from './actions.js';
import { renderHome, agenda } from './views/home.js';
import { renderNovo } from './views/novo.js';
import { renderItem } from './views/item.js';
import { renderItens, renderPagamentos } from './views/lists.js';
import { renderReports } from './views/reports.js';
import { renderConfig } from './views/config.js';
import * as Sync from './sync.js';

let lastTab = 'inicio'; // aba de origem: a tela do item mantém destacada a aba de onde veio
const NAV = [['inicio', 'Início', 'home'], ['itens', 'Itens', 'list'], ['pagamentos', 'Pagamentos', 'pay'], ['relatorios', 'Relatórios', 'chart'], ['config', 'Configurações', 'gear']];
const CONFIG_TITLES = { nuvem: 'Sincronização', obra: 'Dados da obra', categorias: 'Categorias', etapas: 'Etapas', fornecedores: 'Fornecedores', avisos: 'Avisos', backup: 'Backup', historico: 'Histórico geral', instalar: 'Instalar' };

async function buildCtx() {
  const data = await S.loadAll();
  const keys = ['obra', 'ultimos', 'avisoDias', 'ultimoBackup', 'lancamentosDesdeBackup'];
  const settings = Object.fromEntries(await Promise.all(keys.map(async k => [k, await S.getSetting(k)])));
  return {
    ...data, settings,
    catName: (id) => data.catMap[id]?.nome || (id ? '—' : ''),
    stageName: (id) => data.stageMap[id]?.nome || (id ? '—' : ''),
    supName: (id) => data.supMap[id]?.nome || '',
  };
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'inicio';
  const [path, qs = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { route: parts[0] || 'inicio', arg: parts[1], params: new URLSearchParams(qs) };
}

function shell() {
  document.body.innerHTML = `
    <header class="topbar"><button class="icon-btn hidden" data-back aria-label="Voltar">${icon('back')}</button><h1 data-title></h1><a class="icon-btn cloud-btn hidden" data-cloud href="#/config/nuvem" aria-label="Sincronização">${icon('cloud')}<i class="dot"></i></a></header>
    <main id="view"></main>
    <button class="fab" data-fab aria-label="Novo lançamento" title="Novo lançamento">${icon('plus')}<span class="fab-label">NOVO LANÇAMENTO</span></button>
    <nav class="bottom-nav">${NAV.map(([k, l, i]) => `<a href="#/${k}" data-nav="${k}">${icon(i)}<span>${l}</span>${k === 'inicio' ? '<b class="nav-badge hidden" data-badge></b>' : ''}</a>`).join('')}</nav>`;
  document.querySelector('[data-fab]').addEventListener('click', () => { location.hash = '#/novo'; });
  document.querySelector('[data-back]').addEventListener('click', () => { history.length > 1 ? history.back() : (location.hash = '#/inicio'); });
}

let rendering = Promise.resolve();
let lastRoute = '';

async function render(keepScroll = false) {
  const { route, arg, params } = parseHash();
  const ctx = await buildCtx();
  const main = document.getElementById('view');
  const y = window.scrollY;
  const fresh = document.createElement('div'); // container novo: evita listeners duplicados
  const obra = ctx.settings.obra || {};

  let title = '', back = false, navKey = route;
  try {
    switch (route) {
      case 'inicio': title = `${esc(obra.nome || 'Controle da Obra')}<span class="sub">${esc(obra.endereco || 'Controle financeiro da construção')}</span>`; await renderHome(fresh, ctx); break;
      case 'novo': title = 'Novo lançamento'; back = true; navKey = ''; await renderNovo(fresh, ctx); break;
      case 'item': title = 'Item'; back = true; navKey = lastTab; await renderItem(fresh, ctx, arg); break;
      case 'itens': title = 'Itens'; await renderItens(fresh, ctx, params); break;
      case 'pagamentos': title = 'Pagamentos'; await renderPagamentos(fresh, ctx, params); break;
      case 'relatorios': title = 'Relatórios'; await renderReports(fresh, ctx, arg); break;
      case 'config': title = arg ? CONFIG_TITLES[arg] || 'Configurações' : 'Configurações'; back = !!arg; navKey = 'config'; await renderConfig(fresh, ctx, arg); break;
      default: location.hash = '#/inicio'; return;
    }
  } catch (e) { console.error(e); fresh.innerHTML = `<div class="banner danger">Erro ao abrir a tela: ${esc(e.message)}</div>`; }

  if (NAV.some(([k]) => k === navKey)) lastTab = navKey;
  main.replaceChildren(fresh);
  document.querySelector('[data-title]').innerHTML = title;
  document.querySelector('[data-back]').classList.toggle('hidden', !back);
  document.querySelector('[data-fab]').classList.toggle('hidden', route === 'novo');
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
  window.scrollTo(0, keepScroll ? y : 0);
  updateBadge(ctx);
}

function queueRender(keep) { rendering = rendering.then(() => render(keep)).catch(console.error); return rendering; }

function updateBadge(ctx) {
  const ag = agenda(ctx);
  const dias = ctx.settings.avisoDias ?? 3;
  const lim = addDays(todayISO(), dias);
  const n = ag.atrasados.length + ag.hoje.length + ag.prox30.filter(p => p.data <= lim).length;
  const b = document.querySelector('[data-badge]');
  if (b) { b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n); }
  try { if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch { /* opcional */ }
  return { n, ag };
}

/** Notificação nativa opcional, no máximo uma vez por dia, ao abrir o app. */
async function maybeNotify(ctx) {
  if (!('Notification' in globalThis) || Notification.permission !== 'granted') return;
  const { n, ag } = updateBadge(ctx);
  if (!n) return;
  const key = 'notificadoEm';
  if ((await S.getSetting(key)) === todayISO()) return;
  const atras = ag.atrasados.reduce((s, p) => s + p.valor, 0);
  const body = ag.atrasados.length ? `${ag.atrasados.length} atrasado(s) — ${money(atras)}` : `${n} pagamento(s) próximos do vencimento`;
  try { const reg = await navigator.serviceWorker?.ready; await reg?.showNotification('Controle da Obra', { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'vencimentos' }); await S.setSetting(key, todayISO()); }
  catch { /* opcional */ }
}

async function start() {
  shell();
  try { await S.init(); }
  catch (e) { document.getElementById('view').innerHTML = `<div class="banner danger">Não foi possível abrir o banco de dados local: ${esc(e.message)}. Verifique se o navegador não está em modo anônimo.</div>`; return; }
  setRefresh(() => queueRender(true));
  window.addEventListener('hashchange', () => {
    const cur = location.hash;
    queueRender(cur === lastRoute); lastRoute = cur;
  });
  lastRoute = location.hash;
  await queueRender(false);
  maybeNotify(await buildCtx());

  // Sincronização com a nuvem (só ativa se js/config.js estiver preenchido)
  let ultimoStatus = null;
  Sync.subscribe((st) => {
    const b = document.querySelector('[data-cloud]');
    if (b) { b.classList.toggle('hidden', !Sync.configured()); b.dataset.st = st.status; b.title = statusLabel(st); }
    if (st.status === 'conflict' && ultimoStatus !== 'conflict' && !location.hash.startsWith('#/config/nuvem')) location.hash = '#/config/nuvem';
    if (location.hash.startsWith('#/config/nuvem') && st.status !== ultimoStatus) queueRender(true);
    ultimoStatus = st.status;
  });
  Sync.initSync(() => queueRender(true)).catch(console.error);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') queueRender(true); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Nova versão disponível — feche e abra o app para atualizar.'); });
      });
    }).catch(() => {});
  }
}

export function statusLabel(st) {
  return ({ off: 'Sincronização desativada', signedout: 'Não conectado à nuvem', idle: 'Sincronizado', syncing: 'Sincronizando…',
    offline: 'Sem internet — alterações ficam guardadas e sobem depois', error: 'Erro na sincronização', conflict: 'Escolha como juntar os dados' })[st.status] || st.status;
}

start();
