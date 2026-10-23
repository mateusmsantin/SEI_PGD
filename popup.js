const $ = s => document.querySelector(s);
const send = m => chrome.runtime.sendMessage(m);
const br = s => s.split('-').reverse().join('/');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('#f').onsubmit = async ev => {
  ev.preventDefault();
  const texto = $('#ft').value.trim(); if (!texto) return;
  const r = await send({ op: 'adicionar', item: { tipo: 'manual', texto } });
  if (r?.ok) $('#ft').value = ''; else $('#erro').textContent = r?.error || 'Falha ao adicionar.';
};
$('#reler').onclick = async () => {
  const b = $('#reler'); b.disabled = true; $('#dst').textContent = 'Procurando a aba do plano no Cobalto…';
  let msg = 'Não encontrei uma aba do Cobalto aberta. Abra o plano de trabalho e tente de novo.';
  try {
    const tabs = await chrome.tabs.query({ url: 'https://cobalto.ufpel.edu.br/*' });
    for (const t of tabs) {
      try { const r = await chrome.tabs.sendMessage(t.id, { type: 'reler' }); msg = r?.msg || msg; if (r?.ok) break; } catch (_) { msg = 'Recarregue a aba do Cobalto (F5) e tente de novo.'; }
    }
  } catch (e) { msg = 'Falha: ' + e.message; }
  $('#dst').textContent = msg; b.disabled = false;
};
$('#opt').onclick = e => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

async function renderDireto() {
  const { plano, sel = {}, ledger = [], fila = {}, ultimoErro } = await chrome.storage.local.get(['plano', 'sel', 'ledger', 'fila', 'ultimoErro']);
  const cfg = await VC.getConfig();
  const novos = (ledger || []).filter(l => l.ok && plano && l.ts > plano.ts);
  const sel$ = $('#acao');
  sel$.replaceChildren();
  if (!plano) {
    sel$.innerHTML = '<option value="">— abra o plano no Cobalto —</option>';
    $('#dst').textContent = 'Abra o plano de trabalho no Cobalto uma vez para a extensão ler as ações.';
  } else {
    sel$.innerHTML = '<option value="">Escolha a Ação…</option>' + plano.acoes.map(a => {
      const saldo = a.carga - a.usadas - novos.filter(l => l.acaoId === a.id).reduce((t, l) => t + l.horas, 0);
      return `<option value="${esc(a.id)}" ${a.id === sel.acaoId ? 'selected' : ''}>${esc(a.descricao.slice(0, 60))} — ${esc(a.modalidade.slice(0, 4))} (saldo ${saldo}h)</option>`;
    }).join('');
    $('#dst').textContent = `Plano ${plano.planoId} lido em ${new Date(plano.ts).toLocaleString('pt-BR')}.`;
  }
  $('#nAcoes').textContent = plano ? plano.acoes.length : 0;
  $('#listaAcoes').innerHTML = plano ? plano.acoes.map(a => {
    const saldo = a.carga - a.usadas - novos.filter(l => l.acaoId === a.id).reduce((t, l) => t + l.horas, 0);
    return `<div style="padding:4px 0;border-top:1px solid #eee"><b>${esc(a.descricao)}</b><br><span style="color:#555">${esc(a.modalidade)} · carga ${a.carga}h · utilizadas ${a.usadas}h · saldo ${saldo}h</span></div>`;
  }).join('') : '';
  $('#horas').value = sel.horas ?? 8;
  if (document.activeElement !== $('#hor')) $('#hor').value = cfg.envio.horario;
  $('#auto').checked = !!cfg.envio.auto;
  const hoje = VC.hoje();
  const dias = Object.keys(fila).sort();
  const total = dias.reduce((s, d) => s + fila[d].length, 0);
  $('#filaT').textContent = `Fila (${total} ${total === 1 ? 'item' : 'itens'})`;
  $('#enviar').disabled = !total;
  $('#fila').innerHTML = dias.map(d => `<div style="color:#555;margin-top:4px">${br(d)}${d === hoje ? ' (hoje)' : ''}</div>` + fila[d].map(i =>
    `<div style="display:flex;gap:4px"><span style="flex:1">${i.tipo === 'manual' ? '✍ ' + esc(i.texto) : (i.tipo === 'documento' ? '📄 ' + esc(i.docNome) + ' — ' : '📁 ') + esc(i.numero)}</span><button class="x" data-fd="${d}" data-fk="${esc(i.key)}">✕</button></div>`).join('')).join('') || '<i>Vazia.</i>';
  $('#erro').textContent = ultimoErro ? `Último envio automático falhou (${br(ultimoErro.dia)}): ${ultimoErro.erro}` : '';
  $('#hist').innerHTML = [...(ledger || [])].reverse().slice(0, 5).map(l =>
    `<div style="color:${l.ok ? '#1f7a3d' : '#b3261e'}">${l.ok ? '✓' : '✗'} ${br(l.dia)} ${new Date(l.ts).toLocaleTimeString('pt-BR')} · ${l.horas}h · ${esc(l.numero)}${l.ok ? '' : ' — ' + esc(l.resp)}</div>`).join('');
}
async function salvarSel() {
  await chrome.storage.local.set({ sel: { acaoId: $('#acao').value, horas: Number($('#horas').value) || 8 } });
}
async function salvarEnvio() {
  const { config = {} } = await chrome.storage.local.get('config');
  config.envio = { auto: $('#auto').checked, horario: $('#hor').value || '17:30' };
  await chrome.storage.local.set({ config });
}
['#acao', '#horas'].forEach(id => $(id).addEventListener('change', salvarSel));
['#auto', '#hor'].forEach(id => $(id).addEventListener('change', salvarEnvio));
$('#enviar').onclick = async () => {
  $('#enviar').disabled = true; $('#erro').textContent = 'Enviando…';
  const { fila = {} } = await chrome.storage.local.get('fila');
  for (const d of Object.keys(fila).sort()) {
    const r = await send({ op: 'enviarDia', dia: d });
    if (!r?.ok) { $('#erro').textContent = r?.error || 'Falha ao enviar.'; renderDireto(); return; }
  }
  await chrome.storage.local.remove('ultimoErro'); renderDireto();
};
document.addEventListener('click', async e => {
  if (e.target.dataset.fk) { await send({ op: 'filaRemover', dia: e.target.dataset.fd, key: e.target.dataset.fk }); renderDireto(); }
});

chrome.storage.onChanged.addListener((ch) => { if (ch.plano || ch.ledger || ch.fila || ch.config || ch.ultimoErro) renderDireto(); });
renderDireto();
