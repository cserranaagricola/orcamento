import { firebaseConfig, ADMIN_EMAIL, EMPRESA, DIAS_OFFLINE } from './config.js';
import { lerTabelaPdf } from './tabela-pdf.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
const DIA = 86400000;
const $ = id => document.getElementById(id);
const brl = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dataBR = iso => iso ? iso.split('-').reverse().join('/') : '';
const admin = ADMIN_EMAIL.toLowerCase();

// ---------- armazenamento local ----------
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
// cache: {email, nome, admin, podeTabela, verificadoEm, tabela:{atualizado, produtos, publicadoPor, publicadoEm}}
let cache = ls.get('orc.cache', null);
let st = Object.assign({ cliente: '', prazo: 30, itens: [], obs: '' }, ls.get('orc.rascunho', {}));
const salvarRascunho = () => ls.set('orc.rascunho', st);

let fb = null;            // {auth, db, mod...}
let usuario = null;       // {email, nome, admin, podeTabela}
let produtos = [], porCod = {}, tabela = null;
let cat = 'Todos', busca = '';

function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2200); }
function tela(id) { ['telaCarregando', 'telaLogin', 'telaBloqueio', 'telaApp'].forEach(t => $(t).classList.toggle('hidden', t !== id)); $('sair').classList.toggle('hidden', id !== 'telaApp'); }
function bloquear(titulo, texto) { $('bloqTitulo').textContent = titulo; $('bloqTexto').textContent = texto; tela('telaBloqueio'); }
const comTempo = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('tempo')), ms))]);

// ---------- início ----------
async function iniciar() {
  if (firebaseConfig.apiKey === 'COLE_AQUI') {
    $('tabinfo').textContent = 'Falta configurar o Firebase';
    return bloquear('Configuração pendente', 'Os dados do Firebase ainda não foram colocados no arquivo config.js.');
  }
  try {
    const [app, auth, fs] = await Promise.all([
      import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')
    ]);
    const a = app.initializeApp(firebaseConfig);
    fb = { auth: auth.getAuth(a), db: fs.getFirestore(a), A: auth, F: fs };
  } catch (e) {
    // Sem internet e sem os arquivos do Firebase guardados: usa o que está no aparelho
    return usarCache('Sem internet. Usando a tabela guardada no aparelho.');
  }
  fb.A.onAuthStateChanged(fb.auth, async u => {
    if (!u) {
      if (!navigator.onLine && cacheValido()) return usarCache('Sem internet. Usando a tabela guardada no aparelho.');
      return tela('telaLogin');
    }
    await verificar(u);
  });
}

function cacheValido() { return cache && cache.tabela && (Date.now() - (cache.verificadoEm || 0)) < DIAS_OFFLINE * DIA; }

function usarCache(msg) {
  if (!cacheValido()) {
    if (cache) { ls.del('orc.cache'); cache = null; }
    return bloquear('Conecte à internet', `Faz mais de ${DIAS_OFFLINE} dias sem conexão, ou este aparelho ainda não entrou no app. Conecte à internet para continuar.`);
  }
  usuario = { email: cache.email, nome: cache.nome, admin: cache.admin, podeTabela: cache.podeTabela };
  const restam = Math.ceil((cache.verificadoEm + DIAS_OFFLINE * DIA - Date.now()) / DIA);
  abrirApp(cache.tabela, msg ? `${msg} Conecte em até ${restam} dia(s) para continuar liberado.` : '');
}

async function verificar(u) {
  const email = (u.email || '').toLowerCase();
  if (!navigator.onLine && cache && cache.email === email) return usarCache('Sem internet. Usando a tabela guardada no aparelho.');
  try {
    let perfil;
    if (email === admin) perfil = { nome: u.displayName || 'Administrador', ativo: true, podeTabela: true, admin: true };
    else {
      const d = await comTempo(fb.F.getDoc(fb.F.doc(fb.db, 'usuarios', email)), 10000);
      if (!d.exists() || !d.data().ativo) {
        ls.del('orc.cache'); cache = null;
        $('tabinfo').textContent = email;
        return bloquear(d.exists() ? 'Acesso bloqueado' : 'Acesso não liberado',
          `A conta ${email} não está liberada. Peça ao administrador para liberar este e-mail.`);
      }
      perfil = Object.assign({ admin: false }, d.data());
    }
    const t = await comTempo(fb.F.getDoc(fb.F.doc(fb.db, 'tabela', 'atual')), 10000);
    let tab = null;
    if (t.exists()) { const x = t.data(); tab = { atualizado: x.atualizado, produtos: JSON.parse(x.produtos), publicadoPor: x.publicadoPor || '', publicadoEm: x.publicadoEm ? x.publicadoEm.toMillis() : null }; }
    usuario = { email, nome: perfil.nome || u.displayName || email, admin: !!perfil.admin, podeTabela: !!perfil.podeTabela || !!perfil.admin };
    cache = { email, nome: usuario.nome, admin: usuario.admin, podeTabela: usuario.podeTabela, verificadoEm: Date.now(), tabela: tab };
    ls.set('orc.cache', cache);
    abrirApp(tab, '');
  } catch (e) {
    if (cache && cache.email === email) return usarCache('Sem conexão com o servidor. Usando a tabela guardada no aparelho.');
    bloquear('Sem conexão', 'Não foi possível verificar seu acesso. Conecte à internet e abra o app de novo.');
  }
}

// ---------- app ----------
function abrirApp(tab, aviso) {
  tela('telaApp');
  $('avisoOffline').classList.toggle('hidden', !aviso);
  $('avisoOffline').textContent = aviso;
  $('tabPainel').classList.toggle('hidden', !usuario.podeTabela);
  $('cardPessoas').classList.toggle('hidden', !usuario.admin);
  carregarTabela(tab);
  $('cliente').value = st.cliente;
  document.querySelectorAll('#prazo button').forEach(b => b.classList.toggle('on', +b.dataset.p === st.prazo));
  renderLista(); renderOrc(); renderStatusTabela();
}

function carregarTabela(tab) {
  tabela = tab;
  produtos = (tab ? tab.produtos : []).map(a => ({ c: a[0], n: a[1], cat: a[2], p30: a[3], p60: a[4], dm: a[5], k: norm(a[0] + ' ' + a[1]) }));
  porCod = {}; produtos.forEach(p => porCod[p.c] = p);
  st.itens = st.itens.filter(i => porCod[i.c]);
  $('tabinfo').textContent = tab ? `Tabela de ${dataBR(tab.atualizado)} · ${produtos.length} produtos` : 'Nenhuma tabela publicada ainda';
  const cats = ['Todos', ...new Set(produtos.map(p => p.cat))];
  if (!cats.includes(cat)) cat = 'Todos';
  $('cats').innerHTML = cats.map(c => `<button class="chip${c === cat ? ' on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
}

const preco = p => st.prazo === 60 ? p.p60 : p.p30;

function renderLista() {
  if (!produtos.length) { $('lista').innerHTML = `<div class="empty">Nenhuma tabela de preços publicada ainda.${usuario && usuario.podeTabela ? '<br>Vá em <b>Painel</b> e suba a tabela.' : ''}</div>`; return; }
  const q = norm(busca.trim()).split(/\s+/).filter(Boolean);
  let res = produtos.filter(p => (cat === 'Todos' || p.cat === cat) && q.every(t => p.k.includes(t)));
  const total = res.length, lim = 80;
  res = res.slice(0, lim);
  $('lista').innerHTML = res.length ? res.map(p => {
    const it = st.itens.find(i => i.c === p.c);
    return `<div class="item"><div class="pinfo"><div class="name">${esc(p.n)}</div><div class="meta">${p.c} · ${esc(p.cat)}</div>${p.dm ? `<div class="dsc">Desc. até ${brl(p.dm)}</div>` : ''}</div>
      <div class="price">${brl(preco(p))}</div>
      <button class="add${it ? ' in' : ''}" data-add="${p.c}" aria-label="Adicionar">${it ? it.q + '×' : '+'}</button></div>`;
  }).join('') + (total > lim ? `<div class="more">Mostrando ${lim} de ${total}. Digite para refinar a busca.</div>` : '')
    : `<div class="empty">Nenhum produto encontrado.</div>`;
}

function calc() {
  let bruto = 0, desc = 0;
  st.itens.forEach(i => { const p = porCod[i.c]; bruto += preco(p) * i.q; desc += (i.d || 0) * i.q; });
  return { bruto, desc, total: bruto - desc };
}

function renderOrc() {
  const t = calc();
  $('nItens').textContent = st.itens.length;
  $('barQ').textContent = st.itens.length ? `${st.itens.length} produto(s) · ${st.prazo} dias` : 'Nenhum item';
  $('barT').textContent = brl(t.total);
  if (!st.itens.length) { $('orc').innerHTML = `<div class="empty">O orçamento está vazio.<br>Vá em <b>Produtos</b> e toque em + para adicionar.</div>`; return; }
  $('orc').innerHTML = st.itens.map((i, ix) => {
    const p = porCod[i.c], pu = preco(p), d = i.d || 0, over = d > p.dm;
    const sub = (pu - d) * i.q;
    return `<div class="card qi"><div class="hd"><div class="name">${esc(p.n)}<div class="small">${p.c} · ${brl(pu)} un.</div></div>
      <button class="x" data-rm="${ix}" aria-label="Remover">×</button></div>
      <div class="ctl"><span class="small">Qtd.</span>
        <div><div class="stepper"><button data-dec="${ix}">−</button><input type="number" min="1" inputmode="numeric" data-q="${ix}" value="${i.q}"><button data-inc="${ix}">+</button></div></div>
        <span class="small">Desc./un.</span>
        <div class="desc"><input type="number" min="0" step="0.01" inputmode="decimal" data-d="${ix}" value="${d || ''}" placeholder="0,00">
          <span class="small${over ? ' warn' : ''}">tabela: ${brl(p.dm)}${over ? ' (acima)' : ''}</span></div></div>
      <div class="sub"><span class="small">Subtotal</span><b>${brl(sub)}</b></div></div>`;
  }).join('') + `
    <div class="card totals">
      <div><span>Subtotal (${st.prazo} dias)</span><span>${brl(t.bruto)}</span></div>
      ${t.desc ? `<div><span>Descontos</span><span>− ${brl(t.desc)}</span></div>` : ''}
      <div class="big"><span>Total</span><span>${brl(t.total)}</span></div></div>
    <label class="f" for="obs">Observações</label>
    <textarea id="obs" placeholder="Ex.: entrega, forma de pagamento…">${esc(st.obs || '')}</textarea>
    <div class="actions" style="margin-top:12px">
      <a class="btn pri full" id="wpp" target="_blank" rel="noopener" href="${wppLink()}">Enviar no WhatsApp</a>
      <button class="btn sec" id="copiar">Copiar texto</button>
      <button class="btn danger" id="limpar">Novo orçamento</button>
    </div>
    <div id="confirma" class="card hidden" style="margin-top:10px">Apagar todos os itens deste orçamento?
      <div class="actions" style="margin-top:8px"><button class="btn danger" id="simLimpar">Apagar</button><button class="btn sec" id="naoLimpar">Cancelar</button></div></div>`;
}

function texto() {
  const t = calc();
  let s = `*ORÇAMENTO – ${EMPRESA}*\n`;
  if (st.cliente) s += `Cliente: ${st.cliente}\n`;
  s += `Data: ${new Date().toLocaleDateString('pt-BR')} · Prazo: ${st.prazo} dias\n`;
  if (usuario && usuario.nome) s += `Vendedor: ${usuario.nome}\n`;
  s += `\n`;
  st.itens.forEach(i => { const p = porCod[i.c], pu = preco(p) - (i.d || 0); s += `• ${i.q}x ${p.n}\n   ${brl(pu)} un. = ${brl(pu * i.q)}\n`; });
  s += `\n`;
  if (t.desc) s += `Subtotal: ${brl(t.bruto)}\nDesconto: − ${brl(t.desc)}\n`;
  s += `*TOTAL: ${brl(t.total)}*\n`;
  if (st.obs && st.obs.trim()) s += `\nObs.: ${st.obs.trim()}\n`;
  if (tabela) s += `\nPreços da tabela de ${dataBR(tabela.atualizado)}, sujeitos a alteração.`;
  return s;
}
const wppLink = () => 'https://wa.me/?text=' + encodeURIComponent(texto());
const atualizaWpp = () => { const a = $('wpp'); if (a) a.href = wppLink(); };
function mudou(lista = true) { salvarRascunho(); renderOrc(); if (lista) renderLista(); }

let abaAtual = 'prod';
function aba(n) {
  abaAtual = n;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === n));
  $('vProd').classList.toggle('hidden', n !== 'prod'); $('vOrc').classList.toggle('hidden', n !== 'orc'); $('vPainel').classList.toggle('hidden', n !== 'painel');
  $('bar').classList.toggle('hidden', n === 'painel');
  $('barBtn').textContent = n === 'orc' ? 'Adicionar produtos' : 'Ver orçamento';
  if (n === 'painel') { renderStatusTabela(); if (usuario.admin) carregarPessoas(); }
  window.scrollTo(0, 0);
}

// ---------- eventos do orçamento ----------
document.querySelector('.tabs').onclick = e => { const b = e.target.closest('button[data-tab]'); if (b) aba(b.dataset.tab); };
$('barBtn').onclick = () => aba(abaAtual === 'orc' ? 'prod' : 'orc');
$('busca').oninput = e => { busca = e.target.value; renderLista(); };
$('cliente').oninput = e => { st.cliente = e.target.value; salvarRascunho(); atualizaWpp(); };
$('prazo').onclick = e => { const b = e.target.closest('button'); if (!b) return; st.prazo = +b.dataset.p; document.querySelectorAll('#prazo button').forEach(x => x.classList.toggle('on', x === b)); mudou(); };
$('cats').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; cat = b.dataset.c; document.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); renderLista(); };
$('lista').onclick = e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  const c = b.dataset.add, it = st.itens.find(i => i.c === c);
  if (it) it.q++; else st.itens.push({ c, q: 1, d: 0 });
  mudou(); toast('Adicionado: ' + porCod[c].n);
};
$('orc').addEventListener('click', e => {
  const t = e.target, ds = t.dataset;
  if (ds.rm !== undefined) { st.itens.splice(+ds.rm, 1); mudou(); }
  else if (ds.inc !== undefined) { st.itens[+ds.inc].q++; mudou(); }
  else if (ds.dec !== undefined) { const i = st.itens[+ds.dec]; if (i.q > 1) { i.q--; mudou(); } }
  else if (t.id === 'copiar') navigator.clipboard.writeText(texto()).then(() => toast('Orçamento copiado'), () => toast('Não foi possível copiar'));
  else if (t.id === 'limpar') $('confirma').classList.remove('hidden');
  else if (t.id === 'naoLimpar') $('confirma').classList.add('hidden');
  else if (t.id === 'simLimpar') { st.itens = []; st.obs = ''; st.cliente = ''; $('cliente').value = ''; mudou(); aba('prod'); }
});
$('orc').addEventListener('change', e => {
  const ds = e.target.dataset;
  if (ds.q !== undefined) { st.itens[+ds.q].q = Math.max(1, Math.round(+e.target.value || 1)); mudou(); }
  if (ds.d !== undefined) { st.itens[+ds.d].d = Math.max(0, +String(e.target.value).replace(',', '.') || 0); mudou(false); }
});
$('orc').addEventListener('input', e => { if (e.target.id === 'obs') { st.obs = e.target.value; salvarRascunho(); atualizaWpp(); } });

// ---------- login ----------
$('entrar').onclick = async () => {
  $('loginErro').textContent = '';
  if (!fb) return;
  const prov = new fb.A.GoogleAuthProvider();
  prov.setCustomParameters({ prompt: 'select_account' });
  try { await fb.A.signInWithPopup(fb.auth, prov); }
  catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      try { await fb.A.signInWithRedirect(fb.auth, prov); } catch (e2) { $('loginErro').textContent = 'Não foi possível entrar: ' + e2.code; }
    } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      $('loginErro').textContent = navigator.onLine ? 'Não foi possível entrar: ' + e.code : 'Sem internet. Conecte para entrar.';
    }
  }
};
async function sairConta() {
  ls.del('orc.cache'); cache = null; usuario = null;
  if (fb) { try { await fb.A.signOut(fb.auth); } catch (e) {} }
  tela('telaLogin');
}
$('sair').onclick = sairConta;
$('bloqSair').onclick = sairConta;

// ---------- painel: tabela ----------
function renderStatusTabela() {
  if (!usuario || !usuario.podeTabela) return;
  $('tabStatus').innerHTML = tabela
    ? `Tabela atual: <b>${dataBR(tabela.atualizado)}</b>, ${tabela.produtos.length} produtos.` +
      (tabela.publicadoPor ? `<br>Publicada por ${esc(tabela.publicadoPor)}${tabela.publicadoEm ? ' em ' + new Date(tabela.publicadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}.` : '')
    : 'Nenhuma tabela publicada ainda.';
}

let novaTabela = null;
let pdfjsMod = null;
async function carregarPdfjs() {
  if (pdfjsMod) return pdfjsMod;
  pdfjsMod = await import(PDFJS + 'pdf.min.mjs');
  pdfjsMod.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  return pdfjsMod;
}

$('arqTabela').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const box = $('preTabela');
  box.classList.remove('hidden');
  box.innerHTML = '<div class="info">Lendo a tabela…</div>';
  try {
    let r;
    const buf = new Uint8Array(await f.arrayBuffer());
    if (/\.json$/i.test(f.name)) {
      const j = JSON.parse(new TextDecoder().decode(buf));
      r = { data: j.atualizado, produtos: j.produtos.map(a => [String(a[0]).replace(/^'/, ''), a[1], a[2], a[3], a[4], a[5]]), esperado: j.produtos.length };
    } else {
      if (!navigator.onLine) throw new Error('Para ler o PDF é preciso estar com internet.');
      r = await lerTabelaPdf(await carregarPdfjs(), buf);
    }
    if (!r.data) throw new Error('Não encontrei a data da tabela no arquivo.');
    if (r.produtos.length < 50) throw new Error(`Só consegui ler ${r.produtos.length} produtos. O formato do PDF pode ter mudado.`);
    if (r.esperado && r.esperado !== r.produtos.length) throw new Error(`O PDF diz ${r.esperado} produtos, mas consegui ler ${r.produtos.length}. O formato pode ter mudado.`);
    novaTabela = { atualizado: r.data, produtos: r.produtos };
    mostrarDiferencas();
  } catch (err) {
    novaTabela = null;
    box.innerHTML = `<div class="aviso" style="margin:0">${esc(err.message || 'Não consegui ler esse arquivo.')}</div>`;
  }
};

function mostrarDiferencas() {
  const antigo = new Map((tabela ? tabela.produtos : []).map(p => [p[0], p]));
  const novo = new Map(novaTabela.produtos.map(p => [p[0], p]));
  const novos = [], saiu = [], mudou = [];
  novo.forEach((p, c) => { const a = antigo.get(c); if (!a) novos.push(p); else if (a[3] !== p[3] || a[4] !== p[4] || a[5] !== p[5] || a[1] !== p[1]) mudou.push([a, p]); });
  antigo.forEach((a, c) => { if (!novo.has(c)) saiu.push(a); });
  const seta = (x, y) => y > x ? `<span class="up">${brl(x)} → ${brl(y)}</span>` : `<span class="down">${brl(x)} → ${brl(y)}</span>`;
  const velha = tabela && novaTabela.atualizado < tabela.atualizado;
  $('preTabela').innerHTML = `
    <div class="info"><b>Tabela de ${dataBR(novaTabela.atualizado)}</b> · ${novaTabela.produtos.length} produtos<br>
      ${novos.length} novo(s) · ${saiu.length} saiu(saíram) · ${mudou.length} com preço ou nome alterado</div>
    ${velha ? `<div class="aviso" style="margin:8px 0 0">Atenção: esta tabela é mais antiga que a atual (${dataBR(tabela.atualizado)}).</div>` : ''}
    ${(novos.length + saiu.length + mudou.length) ? `<div class="diff">
      ${novos.length ? `<h4>Novos</h4>${novos.map(p => `<div>${p[0]} · ${esc(p[1])} · ${brl(p[3])}</div>`).join('')}` : ''}
      ${saiu.length ? `<h4>Saíram</h4>${saiu.map(p => `<div>${p[0]} · ${esc(p[1])}</div>`).join('')}` : ''}
      ${mudou.length ? `<h4>Alterados (preço 30 dias)</h4>${mudou.map(([a, p]) => `<div>${p[0]} · ${esc(p[1])}<br>${a[3] !== p[3] ? seta(a[3], p[3]) : '<span class="small">mudou nome, 60 dias ou desconto</span>'}</div>`).join('')}` : ''}
    </div>` : '<div class="small" style="margin:8px 0">Nenhuma diferença em relação à tabela atual.</div>'}
    <div class="actions"><button class="btn pri" id="publicar">Publicar</button><button class="btn sec" id="cancelarTab">Cancelar</button></div>`;
  $('cancelarTab').onclick = () => { novaTabela = null; $('preTabela').classList.add('hidden'); };
  $('publicar').onclick = publicarTabela;
}

async function publicarTabela() {
  if (!novaTabela || !fb) return;
  if (!navigator.onLine) return toast('Sem internet. Conecte para publicar.');
  const b = $('publicar'); b.disabled = true; b.textContent = 'Publicando…';
  try {
    await comTempo(fb.F.setDoc(fb.F.doc(fb.db, 'tabela', 'atual'), {
      atualizado: novaTabela.atualizado,
      produtos: JSON.stringify(novaTabela.produtos),
      total: novaTabela.produtos.length,
      publicadoPor: usuario.nome,
      publicadoEmail: usuario.email,
      publicadoEm: fb.F.serverTimestamp()
    }), 20000);
    const tab = { atualizado: novaTabela.atualizado, produtos: novaTabela.produtos, publicadoPor: usuario.nome, publicadoEm: Date.now() };
    cache.tabela = tab; cache.verificadoEm = Date.now(); ls.set('orc.cache', cache);
    carregarTabela(tab); renderLista(); renderOrc(); renderStatusTabela();
    novaTabela = null; $('preTabela').classList.add('hidden');
    toast('Tabela publicada para todos');
  } catch (e) {
    b.disabled = false; b.textContent = 'Publicar';
    toast(e.code === 'permission-denied' ? 'Você não tem permissão para publicar tabela.' : 'Não foi possível publicar. Tente de novo.');
  }
}

// ---------- painel: pessoas (só administrador) ----------
let pessoas = [];
const confirmando = {};
async function carregarPessoas() {
  if (!fb || !usuario.admin) return;
  if (!navigator.onLine) { $('pessoas').textContent = 'Sem internet. Conecte para ver as pessoas.'; return; }
  try {
    const snap = await comTempo(fb.F.getDocs(fb.F.collection(fb.db, 'usuarios')), 10000);
    pessoas = snap.docs.map(d => Object.assign({ email: d.id }, d.data())).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    renderPessoas();
  } catch (e) { $('pessoas').textContent = 'Não foi possível carregar as pessoas.'; }
}
function renderPessoas() {
  if (!pessoas.length) { $('pessoas').textContent = 'Ninguém liberado ainda.'; return; }
  $('pessoas').innerHTML = pessoas.map((p, i) => `<div class="pessoa"><div class="info2">
      <div class="name" style="font-size:14px;color:var(--ink)">${esc(p.nome || p.email)}</div><div>${esc(p.email)}</div>
      <div style="margin-top:3px">${p.ativo ? '<span class="tag">Ativo</span>' : '<span class="tag off">Bloqueado</span>'}${p.podeTabela ? '<span class="tag">Sobe tabela</span>' : ''}</div></div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <button class="mini" data-ed="${i}">Editar</button>
        <button class="mini" data-bl="${i}">${p.ativo ? 'Bloquear' : 'Ativar'}</button>
        <button class="mini red" data-rm="${i}">${confirmando[p.email] ? 'Confirmar' : 'Remover'}</button></div></div>`).join('');
}
$('pessoas').onclick = async e => {
  const ds = e.target.dataset;
  if (ds.ed !== undefined) {
    const p = pessoas[+ds.ed];
    $('pEmail').value = p.email; $('pNome').value = p.nome || ''; $('pAtivo').checked = !!p.ativo; $('pTabela').checked = !!p.podeTabela;
    $('cardPessoas').scrollIntoView({ behavior: 'smooth' });
  } else if (ds.bl !== undefined) {
    const p = pessoas[+ds.bl];
    await gravarPessoa(p.email, { nome: p.nome || '', ativo: !p.ativo, podeTabela: !!p.podeTabela });
  } else if (ds.rm !== undefined) {
    const p = pessoas[+ds.rm];
    if (!confirmando[p.email]) { confirmando[p.email] = true; renderPessoas(); setTimeout(() => { delete confirmando[p.email]; renderPessoas(); }, 4000); return; }
    try { await fb.F.deleteDoc(fb.F.doc(fb.db, 'usuarios', p.email)); toast('Acesso removido'); carregarPessoas(); }
    catch (err) { toast('Não foi possível remover.'); }
  }
};
async function gravarPessoa(email, dados) {
  try {
    await comTempo(fb.F.setDoc(fb.F.doc(fb.db, 'usuarios', email), Object.assign(dados, { atualizadoEm: fb.F.serverTimestamp() })), 10000);
    toast('Acesso salvo'); carregarPessoas(); return true;
  } catch (e) { toast(navigator.onLine ? 'Não foi possível salvar.' : 'Sem internet. Conecte para salvar.'); return false; }
}
$('pSalvar').onclick = async () => {
  const email = $('pEmail').value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Digite um e-mail válido.');
  if (email === admin) return toast('Essa é a conta administradora.');
  const ok = await gravarPessoa(email, { nome: $('pNome').value.trim(), ativo: $('pAtivo').checked, podeTabela: $('pTabela').checked });
  if (ok) { $('pEmail').value = ''; $('pNome').value = ''; $('pAtivo').checked = true; $('pTabela').checked = false; }
};

// Ao voltar a internet, confere o acesso e a tabela de novo
window.addEventListener('online', () => { if (fb && fb.auth.currentUser) verificar(fb.auth.currentUser); });

iniciar();
