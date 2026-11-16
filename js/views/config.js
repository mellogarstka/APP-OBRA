import * as S from '../store.js';
import { money, dateTimeBR, todayISO } from '../fmt.js';
import { esc, icon, sheet, toast, confirmSheet } from '../ui.js';
import { handleError, refresh } from '../actions.js';
import * as Sync from '../sync.js';

const MENU = [
  ['nuvem', 'Sincronização (celular + computador)', 'Conta, status da nuvem'],
  ['obra', 'Dados da obra', 'Nome, proprietário, endereço'],
  ['categorias', 'Categorias e subcategorias', 'Criar, renomear, desativar'],
  ['etapas', 'Etapas da obra', 'Criar, renomear, desativar'],
  ['fornecedores', 'Fornecedores', 'Cadastro e contatos'],
  ['avisos', 'Avisos', 'Antecedência dos lembretes'],
  ['backup', 'Backup e restauração', 'Proteção contra perda de dados'],
  ['historico', 'Histórico geral', 'Auditoria de todas as alterações'],
  ['instalar', 'Instalar na tela inicial', 'Android e iPhone'],
];

export let deferredInstall = null;
globalThis.addEventListener?.('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

export async function renderConfig(root, ctx, sec) {
  if (!sec) {
    const est = await navigator.storage?.estimate?.().catch(() => null);
    const persist = await navigator.storage?.persisted?.().catch(() => null);
    root.innerHTML = `<div class="list grid-wide">${MENU.map(([k, t, d]) => `<a class="li" href="#/config/${k}"><div class="grow"><div class="title">${t}</div><div class="meta">${d}</div></div>${icon('chev')}</a>`).join('')}</div>
      <p class="tiny muted" style="margin:14px 4px;line-height:1.6">
        Armazenamento: ${persist ? '<b style="color:var(--ok)">persistente</b> (o navegador não apagará os dados automaticamente)' : '<b style="color:var(--accent)">não persistente</b> — instale o app na tela inicial e mantenha backups'}${est ? ` · uso ${(est.usage / 1048576).toFixed(1)} MB` : ''}<br>
        ${Sync.currentUser() ? `Dados neste aparelho e na nuvem (${esc(Sync.currentUser().email)}).` : 'Dados guardados somente neste aparelho.'} Versão do esquema: ${S.SCHEMA}.</p>`;
    return;
  }
  const fn = { nuvem, obra, categorias, etapas, fornecedores, avisos, backup, historico, instalar }[sec];
  if (fn) await fn(root, ctx); else root.innerHTML = '<div class="empty">Seção não encontrada.</div>';
}

// ---------------------------------------------------------- nuvem
const fmtTs = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca';
const ST_TXT = { off: 'Desativada', signedout: 'Não conectado', idle: 'Sincronizado', syncing: 'Sincronizando…', offline: 'Sem internet', error: 'Erro', conflict: 'Ação necessária' };

async function nuvem(root) {
  const st = Sync.state;
  if (!Sync.configured()) {
    root.innerHTML = `<div class="card"><p>A sincronização ainda não foi configurada nesta versão do app.</p><p class="small muted">Os dados ficam somente neste aparelho. Use o backup para levá-los a outro.</p></div>`;
    return;
  }
  const u = Sync.currentUser();
  if (st.status === 'conflict' && st.conflito) {
    root.innerHTML = `<div class="card">
      <h3 style="margin-top:0">Dados nos dois lugares</h3>
      <p class="small">A nuvem já tem dados desta conta e este aparelho também tem lançamentos (${st.conflito.local} item(ns)). Escolha o que fazer:</p>
      <label class="opt"><input type="radio" name="m" value="nuvem" checked><div><b>Usar os dados da nuvem</b><small>Substitui os dados deste aparelho pelos da nuvem. Um backup deste aparelho é baixado antes.</small></div></label>
      <label class="opt"><input type="radio" name="m" value="juntar"><div><b>Juntar os dois</b><small>Envia os lançamentos deste aparelho para a nuvem. Categorias e etapas podem aparecer repetidas.</small></div></label>
      <button class="btn primary block" data-ok style="margin-top:12px">Continuar</button></div>`;
    root.querySelector('[data-ok]').addEventListener('click', async (e) => {
      const modo = root.querySelector('[name=m]:checked').value;
      e.target.disabled = true;
      try {
        if (modo === 'nuvem') await shareOrDownload(await S.exportBackup(), `backup-aparelho-${todayISO()}.json`);
        await Sync.resolveConflict(modo); toast('Dados sincronizados.');
      } catch (err) { toast(err.message, true); e.target.disabled = false; }
    });
    return;
  }
  if (!u) {
    root.innerHTML = `<form class="card" data-f autocomplete="on">
      <p class="small" style="margin-top:0">Entre com a mesma conta no celular e no computador para ver os mesmos dados.</p>
      <label class="field"><span>E-mail</span><input class="input" type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>Senha</span><input class="input" type="password" name="senha" autocomplete="current-password" minlength="6" required></label>
      <button class="btn primary block" data-act="entrar">Entrar</button>
      <div class="grid2" style="margin-top:10px">
        <button class="btn ghost block" type="button" data-act="criar">Criar conta</button>
        <button class="btn ghost block" type="button" data-act="esqueci">Esqueci a senha</button>
      </div></form>
      <p class="tiny muted" style="margin:10px 4px">No primeiro acesso, os dados deste aparelho são enviados para a nuvem. No segundo aparelho, eles são baixados automaticamente.</p>`;
    const f = root.querySelector('[data-f]');
    const val = (n) => f.querySelector(`[name=${n}]`).value;
    const run = async (act) => {
      try {
        if (!val('email')) return toast('Informe o e-mail.', true);
        if (act === 'esqueci') { await Sync.resetPassword(val('email')); return toast('Enviamos um link de redefinição para o seu e-mail.'); }
        if (val('senha').length < 6) return toast('A senha precisa ter pelo menos 6 caracteres.', true);
        if (act === 'criar') {
          const r = await Sync.signUp(val('email'), val('senha'));
          toast(r.precisaConfirmar ? 'Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.' : 'Conta criada.');
        } else { await Sync.signIn(val('email'), val('senha')); toast('Conectado.'); }
      } catch (err) { toast(err.message, true); }
    };
    f.addEventListener('submit', (e) => { e.preventDefault(); run('entrar'); });
    f.querySelectorAll('[type=button][data-act]').forEach(b => b.addEventListener('click', () => run(b.dataset.act)));
    return;
  }
  root.innerHTML = `<div class="card">
      <div class="sync-status" data-st="${st.status}"><i class="dot"></i>${ST_TXT[st.status] || st.status}</div>
      ${st.error ? `<div class="banner danger" style="margin-top:10px">${esc(st.error)}</div>` : ''}
      <p class="small" style="margin-bottom:4px">Conta: <b>${esc(u.email)}</b></p>
      <p class="small muted" style="margin:0">Última sincronização: ${fmtTs(st.lastSync)}<br>Alterações aguardando envio: ${st.pendentes}</p>
      <button class="btn primary block" data-sync style="margin-top:14px" ${st.status === 'syncing' ? 'disabled' : ''}>Sincronizar agora</button>
    </div>
    <div class="list" style="margin-top:14px">
      <button class="li" data-senha><div class="grow"><div class="title">Trocar senha</div></div>${icon('chev')}</button>
      <button class="li" data-sair><div class="grow"><div class="title" style="color:var(--danger)">Sair da conta neste aparelho</div><div class="meta">Os dados continuam no aparelho, mas param de sincronizar.</div></div></button>
    </div>
    <p class="tiny muted" style="margin:10px 4px">Sem internet o app funciona normalmente; as alterações ficam guardadas e sobem sozinhas quando a conexão voltar.</p>`;
  root.querySelector('[data-sync]').addEventListener('click', () => Sync.syncNow().then(() => toast('Sincronizado.')).catch(e => toast(e.message, true)));
  root.querySelector('[data-sair]').addEventListener('click', async () => {
    const r = await confirmSheet({ title: 'Sair da conta', text: 'Este aparelho deixará de sincronizar. Nenhum dado é apagado.', confirmLabel: 'Sair', askReason: false });
    if (r) { await Sync.signOut(); toast('Desconectado.'); }
  });
  root.querySelector('[data-senha]').addEventListener('click', () => {
    sheet('Trocar senha', `<label class="field"><span>Nova senha (mín. 6)</span><input class="input" type="password" name="s" autocomplete="new-password"></label>
      <div class="sheet-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Salvar</button></div>`, (el, close) => {
      el.querySelector('[data-ok]').addEventListener('click', async () => {
        try { await Sync.updatePassword(el.querySelector('[name=s]').value); close(); toast('Senha alterada.'); } catch (e) { toast(e.message, true); }
      });
    });
  });
}

// ---------------------------------------------------------- obra
async function obra(root, ctx) {
  const o = ctx.settings.obra || {};
  root.innerHTML = `<form class="card" data-f>
    <label class="field"><span>Nome da obra</span><input class="input" name="nome" value="${esc(o.nome)}" placeholder="ex.: Residência João Paulo"></label>
    <label class="field"><span>Proprietário</span><input class="input" name="proprietario" value="${esc(o.proprietario)}"></label>
    <label class="field"><span>Endereço</span><input class="input" name="endereco" value="${esc(o.endereco)}"></label>
    <label class="field"><span>Data de início (opcional)</span><input class="input" type="date" name="inicio" value="${esc(o.inicio)}"></label>
    <button class="btn primary block">Salvar</button></form>
    <p class="tiny muted" style="margin:10px 4px">Esses dados aparecem no topo do app e no cabeçalho dos relatórios em PDF.</p>`;
  root.querySelector('[data-f]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    await S.setSetting('obra', fd); toast('Dados da obra salvos.'); location.hash = '#/inicio';
  });
}

// ---------------------------------------------------------- listas editáveis
function entrySheet(store, entry, parentId, after) {
  sheet(entry ? 'Renomear' : (parentId ? 'Nova subcategoria' : store === 'stages' ? 'Nova etapa' : 'Nova categoria'), `
    <label class="field"><span>Nome</span><input class="input" name="nome" value="${esc(entry?.nome || '')}" autofocus></label>
    <div class="sheet-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Salvar</button></div>`,
  (el, close) => {
    const go = async () => {
      try {
        await S.saveListEntry(store, entry ? { ...entry, nome: el.querySelector('[name=nome]').value } : { nome: el.querySelector('[name=nome]').value, parentId: parentId || null, ordem: Date.now() });
        close(); after();
      } catch (e) { handleError(e); }
    };
    el.querySelector('[data-ok]').addEventListener('click', go);
    el.querySelector('[name=nome]').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

function usage(ctx, id) { return ctx.items.filter(i => i.categoriaId === id || i.subcategoriaId === id || i.etapaId === id).length; }

function mgrRow(store, e, ctx, isSub = false) {
  const n = usage(ctx, e.id);
  return `<div class="mgr-row ${isSub ? 'sub' : ''} ${e.ativo ? '' : 'off'}" data-id="${e.id}">
    <div class="name"><div class="ellipsis">${esc(e.nome)}</div><div class="tiny muted">${n} lançamento(s)${e.ativo ? '' : ' · inativa'}</div></div>
    ${!isSub && store === 'categories' ? `<button class="btn ghost sm" data-addsub="${e.id}" title="Nova subcategoria">+ Sub</button>` : ''}
    <button class="icon-btn" data-ren="${e.id}" title="Renomear">✎</button>
    <button class="btn ${e.ativo ? 'ghost' : 'primary'} sm" data-tog="${e.id}">${e.ativo ? 'Desativar' : 'Ativar'}</button>
  </div>`;
}

async function categorias(root, ctx) {
  const pais = ctx.categories.filter(c => !c.parentId).sort((a, b) => a.ordem - b.ordem);
  root.innerHTML = `<p class="small muted" style="margin:0 4px 12px">Desativar não apaga lançamentos antigos — apenas oculta a opção em novos lançamentos.</p>
    <button class="btn primary block" data-new style="margin-bottom:12px">+ Nova categoria</button>
    <div class="list">${pais.map(c => mgrRow('categories', c, ctx) + ctx.categories.filter(s => s.parentId === c.id).sort((a, b) => a.ordem - b.ordem).map(s => mgrRow('categories', s, ctx, true)).join('')).join('')}</div>`;
  bindMgr(root, ctx, 'categories', ctx.categories);
}

async function etapas(root, ctx) {
  root.innerHTML = `<p class="small muted" style="margin:0 4px 12px">Desativar não apaga lançamentos antigos — apenas oculta a opção em novos lançamentos.</p>
    <button class="btn primary block" data-new style="margin-bottom:12px">+ Nova etapa</button>
    <div class="list">${ctx.stages.sort((a, b) => a.ordem - b.ordem).map(s => mgrRow('stages', s, ctx)).join('')}</div>`;
  bindMgr(root, ctx, 'stages', ctx.stages);
}

function bindMgr(root, ctx, store, list) {
  const find = (id) => list.find(x => x.id === id);
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-new')) return entrySheet(store, null, null, refresh);
    if (t.dataset.addsub) return entrySheet(store, null, t.dataset.addsub, refresh);
    if (t.dataset.ren) return entrySheet(store, find(t.dataset.ren), null, refresh);
    if (t.dataset.tog) { const x = find(t.dataset.tog); await S.saveListEntry(store, { ...x, ativo: !x.ativo }); refresh(); }
  });
}

// ---------------------------------------------------------- fornecedores
async function fornecedores(root, ctx) {
  const tot = (id) => ctx.rows.filter(r => r.item.fornecedorId === id && r.status !== 'Cancelado').reduce((s, r) => s + r.totals.atualizado, 0);
  root.innerHTML = `<button class="btn primary block" data-new style="margin-bottom:12px">+ Novo fornecedor</button>
    <div class="list">${ctx.suppliers.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(s => `
      <button class="li" data-ed="${s.id}"><div class="grow"><div class="title">${esc(s.nome)}</div><div class="meta">${esc([s.tipo, s.telefone].filter(Boolean).join(' · ') || 'sem detalhes')}</div></div><div class="amount num">${money(tot(s.id))}</div></button>`).join('') || '<div class="empty">Nenhum fornecedor. Eles também podem ser criados digitando o nome no lançamento.</div>'}</div>`;
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-new],[data-ed]'); if (!t) return;
    const s = t.dataset.ed ? ctx.suppliers.find(x => x.id === t.dataset.ed) : {};
    sheet(s.id ? 'Editar fornecedor' : 'Novo fornecedor', `
      <label class="field"><span>Nome <em>*</em></span><input class="input" name="nome" value="${esc(s.nome)}" autofocus></label>
      <label class="field"><span>Tipo</span><select class="input" name="tipo"><option value="">—</option>${['Empresa', 'Autônomo', 'Pessoa física', 'Loja'].map(x => `<option ${x === s.tipo ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <div class="grid2"><label class="field"><span>Telefone</span><input class="input" name="telefone" inputmode="tel" value="${esc(s.telefone)}"></label>
      <label class="field"><span>CPF/CNPJ</span><input class="input" name="documento" inputmode="numeric" value="${esc(s.documento)}"></label></div>
      <label class="field"><span>Observações</span><textarea class="input" name="obs">${esc(s.obs)}</textarea></label>
      ${s.id ? `<a class="btn ghost block sm" href="#/itens?forn=${s.id}" data-close style="margin-bottom:6px">Ver itens deste fornecedor</a>` : ''}
      <div class="sheet-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Salvar</button></div>`,
    (el, close) => el.querySelector('[data-ok]').addEventListener('click', async () => {
      const v = (n) => el.querySelector(`[name=${n}]`).value;
      try { await S.saveSupplier({ ...s, nome: v('nome'), tipo: v('tipo'), telefone: v('telefone'), documento: v('documento'), obs: v('obs') }); close(); toast('Fornecedor salvo.'); refresh(); }
      catch (err) { handleError(err); }
    }));
  });
}

// ---------------------------------------------------------- avisos
async function avisos(root, ctx) {
  const cur = ctx.settings.avisoDias ?? 3;
  const notif = 'Notification' in globalThis ? Notification.permission : 'indisponível';
  root.innerHTML = `<div class="card">
    <div class="field"><span>Avisar sobre pagamentos programados com antecedência de</span>
    <div class="seg" data-seg>${[[0, 'No dia'], [1, '1 dia'], [3, '3 dias'], [5, '5 dias'], [7, '7 dias']].map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <p class="small muted" style="margin-bottom:0">Os avisos aparecem ao abrir o app: destaque no Início e contador no ícone da aba. Atrasados e "vence hoje" são sempre mostrados.</p></div>
    <div class="card"><b>Notificações do sistema</b>
    <p class="small muted">Sem servidor, o celular não consegue disparar notificações com o app fechado. Se permitido, o app mostra uma notificação ao ser aberto quando houver vencimentos — o controle principal continua sendo o painel do Início.</p>
    <p class="small">Situação: <b>${notif === 'granted' ? 'permitidas' : notif === 'denied' ? 'bloqueadas' : notif === 'default' ? 'não solicitadas' : 'indisponíveis neste navegador'}</b></p>
    ${notif === 'default' ? '<button class="btn ghost sm" data-perm>Permitir notificações</button>' : ''}</div>`;
  root.querySelector('[data-seg]').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    await S.setSetting('avisoDias', +b.dataset.v); toast('Antecedência salva.'); refresh();
  });
  root.querySelector('[data-perm]')?.addEventListener('click', async () => { await Notification.requestPermission(); refresh(); });
}

// ---------------------------------------------------------- backup
async function shareOrDownload(obj, nome) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const file = new File([blob], nome, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Backup da obra' }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}

export async function doBackup() {
  const obj = await S.exportBackup();
  const ok = await shareOrDownload(obj, `backup-obra-${todayISO()}.json`);
  if (ok) { await S.markBackupDone(); toast('Backup gerado. Guarde o arquivo no Drive, e-mail ou computador.'); }
  return ok;
}

async function backup(root, ctx) {
  const ub = ctx.settings.ultimoBackup;
  root.innerHTML = `
    <div class="card"><b>Fazer backup</b>
      <p class="small muted">Gera um arquivo único com todos os dados. No celular, abre o menu de compartilhar para salvar no Google Drive, enviar por e-mail etc.</p>
      <p class="small">Último backup: <b>${ub ? dateTimeBR(ub) : 'nunca'}</b>${ctx.settings.lancamentosDesdeBackup ? ` · ${ctx.settings.lancamentosDesdeBackup} lançamento(s) desde então` : ''}</p>
      <button class="btn primary block" data-bk>Fazer backup agora</button></div>
    <div class="card"><b>Restaurar backup</b>
      <p class="small muted">Substitui <b>todos</b> os dados atuais pelo conteúdo do arquivo.</p>
      <input type="file" accept="application/json,.json" data-file class="hidden">
      <button class="btn ghost block" data-rs>Escolher arquivo de backup</button></div>
    <p class="tiny muted" style="margin:10px 4px">Como não há servidor, o backup é a única proteção contra perda ou troca do celular. Exportação para Excel chega na fase de relatórios.</p>`;
  root.querySelector('[data-bk]').addEventListener('click', async () => { if (await doBackup()) refresh(); });
  const inp = root.querySelector('[data-file]');
  root.querySelector('[data-rs]').addEventListener('click', () => inp.click());
  inp.addEventListener('change', async () => {
    const file = inp.files[0]; if (!file) return;
    let obj, info;
    try { obj = JSON.parse(await file.text()); info = S.validateBackup(obj); }
    catch (e) { inp.value = ''; return handleError(e.name === 'ValidationError' ? e : { name: 'ValidationError', message: 'Arquivo inválido ou corrompido.' }); }
    sheet('Restaurar backup', `
      <p class="small">Arquivo de <b>${dateTimeBR(info.data)}</b> com <b>${info.itens}</b> item(ns) e <b>${info.pagamentos}</b> pagamento(s).</p>
      <div class="banner danger">Os dados atuais deste aparelho (${ctx.items.length} itens) serão substituídos.</div>
      <label class="check"><input type="checkbox" name="antes" checked> Baixar backup dos dados atuais antes de restaurar</label>
      <div class="sheet-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn danger" data-ok>Restaurar</button></div>`,
    (el, close) => el.querySelector('[data-ok]').addEventListener('click', async () => {
      try {
        if (el.querySelector('[name=antes]').checked) {
          const atual = await S.exportBackup();
          await shareOrDownload(atual, `backup-antes-restaurar-${todayISO()}.json`);
        }
        await S.restoreBackup(obj);
        close(); toast('Backup restaurado.'); location.hash = '#/inicio'; refresh();
      } catch (e) { handleError(e); }
    }));
    inp.value = '';
  });
}

// ---------------------------------------------------------- histórico
async function historico(root, ctx) {
  const all = await S.allHistory();
  const nome = (h) => h.itemId ? (ctx.items.find(i => i.id === h.itemId)?.descricao || '') : '';
  root.innerHTML = `<p class="small muted" style="margin:0 4px 10px">${all.length} registro(s). Exibindo os 300 mais recentes.</p>
    <div class="list">${all.slice(0, 300).map(h => `
      <${h.itemId ? `a href="#/item/${h.itemId}"` : 'div'} class="hist" style="display:block;color:inherit;text-decoration:none">
        <div class="when">${dateTimeBR(h.ts)} · ${esc(h.entity)}${nome(h) ? ' · ' + esc(nome(h)) : ''}</div>
        <div><b>${esc(h.acao)}</b>${h.campo ? ` — ${esc(h.campo)}` : ''}</div>
        ${h.anterior || h.novo ? `<div class="chg">${h.anterior ? esc(h.anterior) + ' → ' : ''}${esc(h.novo || '')}</div>` : ''}
        ${h.motivo ? `<div class="tiny muted">Motivo: ${esc(h.motivo)}</div>` : ''}
      </${h.itemId ? 'a' : 'div'}>`).join('') || '<div class="empty">Sem registros.</div>'}</div>`;
}

// ---------------------------------------------------------- instalar
async function instalar(root) {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  root.innerHTML = `
    ${standalone ? '<div class="banner info">✅ O app já está instalado e rodando em tela cheia.</div>' : ''}
    ${deferredInstall ? '<button class="btn accent block" data-inst style="margin-bottom:12px">Instalar agora</button>' : ''}
    <div class="card"><b>Android (Chrome)</b><div style="margin-top:12px">
      <div class="step"><b class="n">1</b><div>Abra o endereço do app no Chrome.</div></div>
      <div class="step"><b class="n">2</b><div>Toque no menu <b>⋮</b> (canto superior direito).</div></div>
      <div class="step"><b class="n">3</b><div>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</div></div></div></div>
    <div class="card"><b>iPhone (Safari)</b><div style="margin-top:12px">
      <div class="step"><b class="n">1</b><div>Abra o endereço do app no <b>Safari</b>.</div></div>
      <div class="step"><b class="n">2</b><div>Toque em <b>Compartilhar</b> (quadrado com seta para cima).</div></div>
      <div class="step"><b class="n">3</b><div>Escolha <b>Adicionar à Tela de Início</b> e confirme.</div></div></div></div>
    <p class="tiny muted" style="margin:10px 4px">Depois de instalado, o app abre sem a barra do navegador e funciona sem internet. Atualizações do app não apagam seus dados.</p>`;
  root.querySelector('[data-inst]')?.addEventListener('click', async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; refresh(); });
}

void confirmSheet;
