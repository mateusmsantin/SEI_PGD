// Fila do dia -> UM lançamento no Cobalto. Único "escritor" do armazenamento (serializado).
importScripts('common.js');

let chain = Promise.resolve();
function serial(fn) {
  const p = chain.catch(() => {}).then(fn);
  chain = p;
  return p;
}

const get = keys => chrome.storage.local.get(keys);
const URL_SALVAR = 'https://cobalto.ufpel.edu.br/prgrh/teletrabalho/planoTrabalhoContribuicao/salvar';
const MAX_DESC = 256;
const brData = iso => iso.split('-').reverse().join('/');
const dataIso = s => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : (String(s || '').match(/\d{4}-\d{2}-\d{2}/) || [null])[0]; };
const semPonto = s => String(s || '').replace(/[.\s]+$/, '');

// ---------- texto do lançamento ----------
// Despachos do mesmo processo ficam juntos e o número do processo aparece uma vez:
//   "Elaboração de Despacho 1, Despacho 2 no processo A, Despacho 3 no processo B; Análise dos processos C, D; <manual>."
function textoDe({ docs, procs, manuais }) {
  const porProc = new Map();
  for (const d of docs) { if (!porProc.has(d.numero)) porProc.set(d.numero, []); porProc.get(d.numero).push(d.nome); }
  const partes = [];
  if (porProc.size) partes.push('Elaboração de ' + [...porProc].map(([n, nomes]) => `${nomes.join(', ')} no processo ${n}`).join(', '));
  if (procs.length) partes.push((procs.length > 1 ? 'Análise dos processos ' : 'Análise do processo ') + procs.join(', '));
  manuais.forEach(m => partes.push(semPonto(m)));
  return partes.join('; ') + '.';
}

function montarDescricoes(items) {
  const rotuloDoc = i => `${i.docNome}${i.sei ? ` (SEI nº ${i.sei})` : ''}`;
  const docs = items.filter(i => i.tipo === 'documento');
  const comDoc = new Set(docs.map(i => i.numero));
  const vistos = new Set();
  const toks = [
    ...docs.map(i => ({ k: i.key, campo: 'docs', v: { numero: i.numero, nome: rotuloDoc(i) } })),
    ...items.filter(i => i.tipo === 'processo' && !comDoc.has(i.numero) && !vistos.has(i.numero) && vistos.add(i.numero))
      .map(i => ({ k: i.key, campo: 'procs', v: i.numero })),
    ...items.filter(i => i.tipo === 'manual').map(i => ({ k: i.key, campo: 'manuais', v: i.texto }))
  ];
  const novo = () => ({ docs: [], procs: [], manuais: [], keys: [] });
  const chunks = []; let cur = novo();
  for (const t of toks) {
    const teste = { docs: [...cur.docs], procs: [...cur.procs], manuais: [...cur.manuais] };
    teste[t.campo].push(t.v);
    if (cur.keys.length && textoDe(teste).length > MAX_DESC) { chunks.push(cur); cur = novo(); }
    cur[t.campo].push(t.v); cur.keys.push(t.k);
  }
  if (cur.keys.length) chunks.push(cur);
  // processos já cobertos por um despacho saem junto com o primeiro bloco
  const extra = items.filter(i => !chunks.some(c => c.keys.includes(i.key))).map(i => i.key);
  return chunks.map((c, n) => ({ texto: textoDe(c).slice(0, MAX_DESC), keys: n === 0 ? [...c.keys, ...extra] : c.keys }));
}

function dividirHoras(total, n) {
  const base = Math.floor((total / n) * 2) / 2;
  const out = Array(n).fill(base);
  let resto = Math.round((total - base * n) * 2) / 2;
  for (let i = 0; resto > 0 && i < n; i++) { out[i] += 0.5; resto -= 0.5; }
  return out;
}

async function atualizarBadge() {
  const { fila = {}, ultimoErro } = await get(['fila', 'ultimoErro']);
  const n = Object.values(fila).reduce((s, v) => s + v.length, 0);
  await chrome.action.setBadgeBackgroundColor({ color: ultimoErro ? '#b3261e' : '#1f4e79' });
  await chrome.action.setBadgeText({ text: ultimoErro ? '!' : n ? String(n) : '' });
}

// ---------- operações ----------
async function adicionar({ item }) {
  const cfg = await VC.getConfig();
  const { fila = {}, procMap = {} } = await get(['fila', 'procMap']);
  const dia = VC.hoje();
  const lista = fila[dia] || [];
  let novo;
  if (item.tipo === 'manual') {
    const texto = String(item.texto || '').trim().slice(0, 200);
    if (!texto) return { ok: false, error: 'Escreva a atividade.' };
    novo = { key: `manual|${Date.now()}`, tipo: 'manual', texto, ts: Date.now() };
  } else {
    const numero = item.numero || procMap[item.idProc]?.numero;
    if (!numero) return { ok: false, error: 'Não consegui identificar o número do processo.' };
    novo = { key: `${item.tipo}|${item.idProc}|${item.docId || ''}`, tipo: item.tipo, idProc: item.idProc, numero, docNome: item.docNome, sei: item.sei, docId: item.docId, ts: Date.now() };
  }
  const repetido = lista.some(i => i.key === novo.key);
  if (!repetido) lista.push(novo);
  fila[dia] = lista;
  await chrome.storage.local.set({ fila });
  await atualizarBadge();
  const quando = cfg.envio.auto ? ` Envio automático às ${cfg.envio.horario}.` : '';
  return { ok: true, dia, total: lista.length, msg: `${repetido ? 'Já estava na fila' : 'Adicionado'} (${lista.length} ${lista.length === 1 ? 'item' : 'itens'} hoje).${quando}` };
}

async function enviarDia({ dia }) {
  const cfg = await VC.getConfig();
  const { plano, sel = {}, ledger = [], fila = {} } = await get(['plano', 'sel', 'ledger', 'fila']);
  const itens = fila[dia] || [];
  if (!itens.length) return { ok: true, msg: 'Nada na fila deste dia.' };
  if (!plano?.planoId) return { ok: false, error: 'Abra o plano de trabalho no Cobalto uma vez, para a extensão ler o plano e as ações.' };
  const acao = plano.acoes.find(a => a.id === sel.acaoId);
  if (!acao) return { ok: false, error: 'Escolha a Ação no popup da extensão.' };

  const novos = ledger.filter(l => l.ok && l.ts > plano.ts);
  const jaNoDia = plano.contribs.filter(c => dataIso(c.dt_inicio) === dia && (dataIso(c.dt_fim) || dia) === dia).reduce((s, c) => s + c.horas, 0)
    + novos.filter(l => l.dia === dia).reduce((s, l) => s + l.horas, 0);
  const disponivel = cfg.horasDia - jaNoDia;
  if (disponivel <= 0) return { ok: false, error: `${brData(dia)} já tem ${jaNoDia}h lançadas (limite ${cfg.horasDia}h). Itens mantidos na fila.` };
  const horas = Math.min(Number(sel.horas) || 8, disponivel);
  const saldo = acao.carga - acao.usadas - novos.filter(l => l.acaoId === acao.id).reduce((s, l) => s + l.horas, 0);
  if (horas > saldo + 1e-9) return { ok: false, error: `Saldo da ação insuficiente (${saldo}h disponíveis, pedido ${horas}h).` };

  const blocos = montarDescricoes(itens);
  if (blocos.length * 0.5 > horas) return { ok: false, error: 'Itens demais para as horas do dia; aumente as horas ou envie antes.' };
  const partes = dividirHoras(horas, blocos.length);
  let erro = '';
  for (let i = 0; i < blocos.length; i++) {
    const fd = new FormData();
    fd.append('plano_trabalho_2025_ocorrencia_id', acao.id);
    fd.append('plano_id', plano.planoId);
    fd.append('id', '');
    fd.append('horas_atual', '');
    fd.append('horas', String(partes[i]));
    fd.append('dt_inicio', brData(dia));
    fd.append('dt_fim', brData(dia));
    fd.append('descricao', blocos[i].texto);
    let ok = false, resp = '';
    try {
      const r = await fetch(URL_SALVAR, { method: 'POST', body: fd, credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const txt = await r.text();
      resp = `${r.status} ${txt.replace(/\s+/g, ' ').slice(0, 140)}`;
      const login = /login|senha|password/i.test(r.url) || /<input[^>]+type=["']?password/i.test(txt);
      ok = r.ok && !login;
      if (login) resp = 'Sessão do Cobalto expirada: abra o Cobalto e faça login.';
    } catch (e) { resp = 'Erro de rede: ' + e.message; }
    ledger.push({ dia, horas: partes[i], acaoId: acao.id, acao: acao.descricao, numero: `${blocos[i].keys.length} item(ns)`, descricao: blocos[i].texto, ts: Date.now(), ok, resp });
    if (!ok) { erro = resp; break; }
    fila[dia] = (fila[dia] || []).filter(x => !blocos[i].keys.includes(x.key));
    await new Promise(r => setTimeout(r, 600));
  }
  if (!fila[dia]?.length) delete fila[dia];
  await chrome.storage.local.set({ ledger: ledger.slice(-300), fila });
  if (erro) return { ok: false, error: `Cobalto não confirmou: ${erro}` };
  return { ok: true, msg: `${horas}h lançadas em "${acao.descricao.slice(0, 40)}" (${brData(dia)}) com ${itens.length} item(ns).` };
}

async function envioAutomatico() {
  const cfg = await VC.getConfig();
  if (!cfg.envio.auto) return;
  const { fila = {} } = await get('fila');
  const hoje = VC.hoje(), agora = new Date().toTimeString().slice(0, 5);
  for (const dia of Object.keys(fila).sort()) {
    if (dia < hoje || agora >= cfg.envio.horario) {
      const r = await enviarDia({ dia });
      if (!r.ok) { await chrome.storage.local.set({ ultimoErro: { ts: Date.now(), dia, erro: r.error } }); break; }
      await chrome.storage.local.remove('ultimoErro');
    }
  }
  await atualizarBadge();
}

async function garantirAlarme() {
  if (!(await chrome.alarms.get('tick'))) chrome.alarms.create('tick', { periodInMinutes: 15, delayInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(() => { garantirAlarme(); atualizarBadge(); });
chrome.runtime.onStartup.addListener(() => { garantirAlarme(); atualizarBadge(); serial(envioAutomatico); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tick') serial(envioAutomatico); });
garantirAlarme();

async function handle(msg) {
  switch (msg.op) {
    case 'procMap': {
      const { procMap = {} } = await get('procMap');
      for (const it of msg.items || []) if (it.id && it.numero) procMap[it.id] = { numero: it.numero, tipo: it.tipo || '' };
      await chrome.storage.local.set({ procMap });
      return {};
    }
    case 'getConfig':
      return { config: await VC.getConfig() };

    case 'savePlano': {
      const n = v => parseFloat(String(v).replace(',', '.')) || 0;
      const acoes = (msg.acoes || []).map(r => ({
        id: String(r.id ?? ''),
        descricao: String(r.descricao || '').replace(/\s+/g, ' ').trim(),
        modalidade: String(r.modalidade || '').trim(),
        carga: n(r.carga_horaria), usadas: n(r.horas_utilizadas)
      })).filter(a => a.id);
      const contribs = (msg.contribs || []).map(c => ({ dt_inicio: c.dt_inicio, dt_fim: c.dt_fim, horas: n(c.horas) }));
      if (!msg.planoId || !acoes.length) return { ok: false, error: 'plano vazio' };
      await chrome.storage.local.set({ plano: { planoId: String(msg.planoId), acoes, contribs, ts: Date.now() } });
      return {};
    }
    case 'adicionar': return adicionar(msg);
    case 'enviarDia': {
      const r = await enviarDia(msg);
      if (r.ok) await chrome.storage.local.remove('ultimoErro');
      await atualizarBadge();
      return r;
    }
    case 'filaRemover': {
      const { fila = {} } = await get('fila');
      fila[msg.dia] = (fila[msg.dia] || []).filter(x => x.key !== msg.key);
      if (!fila[msg.dia].length) delete fila[msg.dia];
      await chrome.storage.local.set({ fila });
      await atualizarBadge();
      return {};
    }
  }
  return { error: 'op desconhecida' };
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  serial(() => handle(msg)).then(r => send({ ok: true, ...r }), e => send({ ok: false, error: String(e) }));
  return true;
});
