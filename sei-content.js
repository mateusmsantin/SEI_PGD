// Roda em todos os frames do SEI.
//  1) Controle de Processos (acao=procedimento_controlar): aprende id -> número/tipo e põe o botão "→ Cobalto" em cada processo.
//  2) Árvore do processo (acao=procedimento_visualizar): põe o botão "→ Cobalto" no processo e em cada documento monitorado
//     (ex.: Despachos).
(() => {
  const RE_NUM = /\d{5}\.\d{6}\/\d{4}-\d{2}/;
  const BTN = 'vc-sei-btn';
  const url = new URL(location.href);
  const acao = url.searchParams.get('acao');
  const idProc = url.searchParams.get('id_procedimento');
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  async function enviar(msg) {
    try { return await chrome.runtime.sendMessage(msg); } catch (_) { return null; } // extensão recarregada
  }

  // ---------- aviso na tela ----------
  function toast(texto, erro, acao) {
    let doc = document;
    try { doc = window.top.document; } catch (_) {}
    const el = doc.createElement('div');
    el.style.cssText = `position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:380px;padding:10px 14px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;color:#fff;background:${erro ? '#b3261e' : '#1f7a3d'};box-shadow:0 4px 16px rgba(0,0,0,.3)`;
    el.textContent = texto;
    if (acao) {
      const b = doc.createElement('button');
      b.textContent = acao.rotulo;
      b.style.cssText = 'display:block;margin-top:6px;padding:2px 8px;border:0;border-radius:4px;cursor:pointer;font:12px system-ui,sans-serif';
      b.onclick = () => { b.disabled = true; el.remove(); acao.fn(); };
      el.appendChild(b);
    }
    doc.body.appendChild(el);
    setTimeout(() => el.remove(), erro ? 8000 : acao ? 9000 : 4500);
  }

  // ---------- botão "→ Cobalto" ----------
  function criarBotao(item) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = BTN;
    b.textContent = '→ Cobalto';
    b.title = 'Adicionar à fila do dia (vai ao Cobalto no horário configurado ou ao clicar em "Enviar agora")';
    b.style.cssText = 'margin-left:6px;padding:0 6px;font:11px system-ui,sans-serif;line-height:16px;border:1px solid #1f4e79;color:#1f4e79;background:#fff;border-radius:3px;cursor:pointer;vertical-align:middle';
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); adicionar(item, b); });
    return b;
  }

  async function enviarAgora(dia) {
    toast('Enviando ao Cobalto…');
    const r = await enviar({ op: 'enviarDia', dia });
    if (r?.ok) toast('✓ ' + r.msg); else toast('✗ ' + (r?.error || 'Falha ao enviar.'), true);
  }

  async function adicionar(item, b) {
    const antes = b.textContent;
    b.disabled = true; b.textContent = '…';
    const r = await enviar({ op: 'adicionar', item });
    b.disabled = false;
    if (r?.ok) {
      b.textContent = '✓'; b.style.background = '#d9f2e0';
      setTimeout(() => { b.textContent = antes; b.style.background = '#fff'; }, 2500);
      toast('✓ ' + r.msg, false, { rotulo: 'Enviar agora', fn: () => enviarAgora(r.dia) });
    } else {
      b.textContent = antes;
      toast('✗ ' + (r?.error || 'Falha. Recarregue a página do SEI e tente de novo.'), true);
    }
  }

  function inserirBotao(alvo, item) {
    if (!alvo || alvo.nextElementSibling?.classList.contains(BTN)) return;
    alvo.insertAdjacentElement('afterend', criarBotao(item));
  }

  // ---------- 1) lista de processos ----------
  function lerControle() {
    const itens = [];
    document.querySelectorAll('table.tabelaControle input.infraCheckbox[type="checkbox"]').forEach(cb => {
      const id = cb.value;
      const numero = (cb.getAttribute('title') || '').match(RE_NUM)?.[0];
      if (!id || !numero) return;
      const link = document.querySelector(`#P${CSS.escape(id)} a[class*="processo"]`);
      let tipo = '', espec = '';
      const tip = link?.getAttribute('onmouseover') || '';
      const m = tip.match(/infraTooltipMostrar\('((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/);
      if (m) { espec = m[1]; tipo = m[2]; }
      itens.push({ id, numero, tipo, espec });
      inserirBotao(link, { tipo: 'processo', idProc: id, numero, tipoProc: tipo });
    });
    if (itens.length) enviar({ op: 'procMap', items: itens });
  }

  // ---------- 2/3) processo e árvore ----------
  function numeroDoProcesso() {
    const t = document.title.match(RE_NUM);
    if (t) return t[0];
    for (const a of document.querySelectorAll('a[id^="anchor"]')) {
      const m = a.textContent.match(RE_NUM);
      if (m) return m[0];
    }
    return (document.body?.innerText || '').match(RE_NUM)?.[0] || null;
  }

  function lerDocumentos(tipos) {
    const alvo = tipos.map(norm).filter(Boolean);
    const vistos = new Map();
    document.querySelectorAll('a[id^="anchor"], span[id^="span"], span.infraArvoreNo').forEach(el => {
      const docId = (el.id || '').replace(/\D/g, '');
      if (!docId || docId === idProc || vistos.has(docId)) return;
      const texto = el.textContent.replace(/\s+/g, ' ').trim();
      if (!texto) return;
      const m = texto.match(/^(.*?)\s*\((\d{4,})\)\s*$/);
      const nome = m ? m[1].trim() : texto;
      if (!alvo.some(t => norm(nome).startsWith(t))) return;
      vistos.set(docId, { id: docId, nome, sei: m ? m[2] : '', el });
    });
    return [...vistos.values()];
  }

  async function escanearArvore() {
    const cfg = (await enviar({ op: 'getConfig' }))?.config;
    if (!cfg) return;
    const numero = numeroDoProcesso();
    const docs = lerDocumentos(cfg.sei.tiposDocumento);

    // botões (a árvore pode ser redesenhada pelo SEI, então reinserimos sempre)
    const raiz = [...document.querySelectorAll('a[id^="anchor"]')].find(a => RE_NUM.test(a.textContent));
    if (raiz && numero) inserirBotao(raiz, { tipo: 'processo', idProc, numero });
    for (const d of docs) inserirBotao(d.el, { tipo: 'documento', idProc, numero, docId: d.id, docNome: d.nome, sei: d.sei });

  }

  function aguardarArvore() {
    const iniciar = debounce(escanearArvore, 1200);
    const tentar = () => document.querySelector('a[id^="anchor"], span.infraArvoreNo');
    new MutationObserver(() => { if (tentar()) iniciar(); }).observe(document.documentElement, { childList: true, subtree: true });
    if (tentar()) iniciar();
  }

  if (acao === 'procedimento_controlar') {
    lerControle();
    new MutationObserver(debounce(lerControle, 1000)).observe(document.body, { childList: true, subtree: true });
  } else if (acao === 'procedimento_visualizar' && idProc) {
    aguardarArvore();
  }
})();
