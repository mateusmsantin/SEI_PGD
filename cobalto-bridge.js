// Mundo isolado: o script da página (MAIN world) não acessa chrome.*, então conversa por postMessage.
window.addEventListener('message', async e => {
  const d = e.data;
  if (e.source !== window || !d || d.vc !== 'req' || d.op !== 'plano') return;
  try { await chrome.runtime.sendMessage({ op: 'savePlano', planoId: d.planoId, acoes: d.acoes, contribs: d.contribs }); } catch (_) {}
  window.postMessage({ vc: 'res', id: d.id, data: {} }, location.origin);
});

// Popup -> "Atualizar do Cobalto": pede à página para reler a grade de ações.
chrome.runtime.onMessage.addListener((m, _sender, send) => {
  if (m?.type !== 'reler') return;
  const id = Math.random().toString(36).slice(2);
  const fim = r => { window.removeEventListener('message', h); clearTimeout(t); send(r); };
  const h = async e => {
    const d = e.data;
    if (e.source !== window || !d || d.vc !== 'cmdres' || d.id !== id) return;
    if (!d.data || !d.data.acoes?.length) return fim({ ok: false, msg: 'Não achei linhas na grade de ações desta aba (aguarde carregar).' });
    const r = await chrome.runtime.sendMessage({ op: 'savePlano', planoId: d.data.planoId, acoes: d.data.acoes, contribs: d.data.contribs });
    fim(r?.ok ? { ok: true, msg: `${d.data.acoes.length} ação(ões) lida(s).` } : { ok: false, msg: r?.error || 'Falha ao salvar o plano.' });
  };
  const t = setTimeout(() => fim({ ok: false, msg: 'A página não respondeu.' }), 4000);
  window.addEventListener('message', h);
  window.postMessage({ vc: 'cmd', id, op: 'reler' }, location.origin);
  return true;
});
