// Roda na página do plano do Cobalto (MAIN world, para ler o jqGrid). Só LÊ o plano e as ações;
// nada é gravado aqui. Os lançamentos saem do botão "→ Cobalto" do SEI.
(() => {
  if (window.__vcSei) return;
  window.__vcSei = true;

  const pedir = (op, extra = {}) => new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const h = e => {
      if (e.source !== window || !e.data || e.data.vc !== 'res' || e.data.id !== id) return;
      window.removeEventListener('message', h); clearTimeout(t); resolve(e.data.data);
    };
    const t = setTimeout(() => { window.removeEventListener('message', h); reject(new Error('A extensão não respondeu.')); }, 5000);
    window.addEventListener('message', h);
    window.postMessage({ vc: 'req', id, op, ...extra }, location.origin);
  });

  const esperar = (cond, ms = 60000) => new Promise(res => {
    const t0 = Date.now();
    const i = setInterval(() => { if (cond()) { clearInterval(i); res(true); } else if (Date.now() - t0 > ms) { clearInterval(i); res(false); } }, 500);
  });

  const ler = () => ({
    planoId: $('#id').val(),
    acoes: $('#gridAcoes').getRowData(),
    contribs: $('#gridContribuicoes').length ? $('#gridContribuicoes').getRowData() : []
  });

  // Pedido de releitura vindo do popup (via ponte)
  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window || !d || d.vc !== 'cmd' || d.op !== 'reler') return;
    const ok = typeof $ !== 'undefined' && $('#gridAcoes').length;
    window.postMessage({ vc: 'cmdres', id: d.id, data: ok ? ler() : null }, location.origin);
  });

  (async () => {
    const pronto = await esperar(() => typeof $ !== 'undefined' && $('#gridAcoes').length);
    if (!pronto) return; // não é a página do plano
    await esperar(() => $('#gridAcoes').getRowData().length > 0, 20000); // jqGrid carrega por ajax
    pedir('plano', ler()).catch(() => {});
  })();
})();
