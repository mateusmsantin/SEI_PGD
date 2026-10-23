const KEY = "seiPgdItems";
const SETTINGS_KEY = "seiPgdSettings";
const DEFAULT_SETTINGS = { dateMode: "periodo", dateStart: "2026-10-01", dateEnd: "2026-10-31" };
const itemsEl = document.getElementById("items");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const dateStartEl = document.getElementById("dateStart");
const dateEndEl = document.getElementById("dateEnd");
const dateErrorEl = document.getElementById("dateError");
const settingsStatusEl = document.getElementById("settingsStatus");
const actionsListEl = document.getElementById("actionsList");
const actionsCountEl = document.getElementById("actionsCount");
const actionsUpdatedEl = document.getElementById("actionsUpdated");
async function getItems() { const data = await chrome.storage.local.get(KEY); return Array.isArray(data[KEY]) ? data[KEY] : []; }
async function saveItems(items) { await chrome.storage.local.set({ [KEY]: items }); render(); }
async function getSettings() { const data = await chrome.storage.local.get(SETTINGS_KEY); return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) }; }
async function getActions() { const data = await chrome.storage.local.get(["seiPgdActions", "seiPgdActionsUpdatedAt"]); return { actions: Array.isArray(data.seiPgdActions) ? data.seiPgdActions : [], updatedAt: data.seiPgdActionsUpdatedAt || "" }; }
function safeText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function brDate(iso) { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso || ""; const [y,m,d] = iso.split("-"); return `${d}/${m}/${y}`; }
function validPeriod(start,end) { return Boolean(start && end && start <= end); }
async function loadSettings() { const s = await getSettings(); dateStartEl.value = s.dateStart; dateEndEl.value = s.dateEnd; updatePeriodStatus(s); }
function updatePeriodStatus(s) { settingsStatusEl.textContent = `Período configurado: ${brDate(s.dateStart)} a ${brDate(s.dateEnd)}`; }
async function saveSettings() {
  const dateStart = dateStartEl.value, dateEnd = dateEndEl.value;
  const valid = validPeriod(dateStart,dateEnd); dateErrorEl.hidden = valid;
  if (!valid) return;
  const settings = { dateMode: "periodo", dateStart, dateEnd };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings }); updatePeriodStatus(settings); settingsStatusEl.textContent += " — salvo";
}

async function renderActions() {
  const { actions, updatedAt } = await getActions();
  actionsCountEl.textContent = String(actions.length);
  actionsListEl.replaceChildren();
  if (!actions.length) {
    const empty = document.createElement("div"); empty.className = "actions-empty";
    empty.textContent = "Nenhuma ação importada. Abra o plano no Cobalto e use o botão Atualizar ações dentro do menu PGD.";
    actionsListEl.append(empty);
  } else {
    for (const action of actions) {
      const card = document.createElement("div"); card.className = "action-item";
      const title = document.createElement("div"); title.className = "action-title"; title.textContent = safeText(action.descricao || "Ação sem descrição");
      const meta = document.createElement("div"); meta.className = "action-meta";
      const carga = Number(action.carga_horaria || 0), usada = Number(action.horas_utilizadas || 0), saldo = Number(action.saldo ?? (carga-usada));
      meta.textContent = `Modalidade: ${safeText(action.modalidade || "Modalidade não informada")} · Carga horária: ${carga}h · Horas utilizadas: ${usada}h · Saldo: ${saldo}h`;
      card.append(title, meta); actionsListEl.append(card);
    }
  }
  actionsUpdatedEl.textContent = updatedAt ? `Importadas do Cobalto em ${new Date(updatedAt).toLocaleString("pt-BR")}.` : "A lista ainda não foi importada do Cobalto.";
}


async function refreshCobaltoActions() {
  const button = document.getElementById("refreshCobaltoActions");
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = "Buscando grade…";
  actionsUpdatedEl.textContent = "Procurando uma aba aberta do Cobalto com a grade #gridAcoes…";
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    let response;
    if (activeTab?.id) {
      try { response = await chrome.tabs.sendMessage(activeTab.id, { type: "PGD_IMPORT_COBALTO_ACTIONS" }); } catch (_) {}
    }
    if (!response?.ok) {
      const allTabs = await chrome.tabs.query({});
      for (const tab of allTabs) {
        if (!tab.id || tab.id === activeTab?.id) continue;
        try {
          response = await chrome.tabs.sendMessage(tab.id, { type: "PGD_IMPORT_COBALTO_ACTIONS" });
          if (response?.ok) break;
        } catch (_) {}
      }
    }
    if (!response?.ok) {
      actionsUpdatedEl.textContent = response?.message || "Não encontrei uma aba do Cobalto com a extensão ativa e a grade #gridAcoes. Abra o plano de trabalho, recarregue a página e tente novamente.";
      return;
    }
    await renderActions();
    actionsUpdatedEl.textContent = response.message + " Atualização concluída.";
  } catch (error) {
    actionsUpdatedEl.textContent = `Falha ao atualizar: ${error.message || error}`;
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}
document.getElementById("refreshCobaltoActions").addEventListener("click", refreshCobaltoActions);

async function render() {
  const items = await getItems(); countEl.textContent = items.length; itemsEl.replaceChildren(); emptyEl.hidden = items.length > 0;
  for (const item of items) {
    const card = document.createElement("div"); card.className = "item";
    const info = document.createElement("div"), kind = document.createElement("div"); kind.className = "kind"; kind.textContent = item.type === "processo" ? "Processo" : "Despacho";
    const title = document.createElement("div"); title.className = "title"; title.textContent = safeText(item.title || item.number || "Item PGD");
    const number = document.createElement("div"); number.className = "number"; number.textContent = safeText(item.number); info.append(kind,title,number);
    if (item.url) { const link = document.createElement("a"); link.href = item.url; link.target = "_blank"; link.rel = "noopener"; link.textContent = "Abrir no SEI"; info.append(link); }
    const remove = document.createElement("button"); remove.className = "remove"; remove.textContent = "Remover";
    remove.addEventListener("click", async () => { const current = await getItems(); await saveItems(current.filter(x => !(x.type === item.type && x.id === item.id && x.url === item.url))); });
    card.append(info,remove); itemsEl.append(card);
  }
}
function exportText(items,settings) {
  const processes = items.filter(x => x.type === "processo");
  return [`Período das entregas: ${brDate(settings.dateStart)} a ${brDate(settings.dateEnd)}`,`Processos selecionados: ${processes.length}`,"",...processes.map((x,i) => `${i+1}. ${safeText(x.number)}${x.url ? `\nLink SEI: ${x.url}` : ""}`),items.some(x => x.type === "despacho") ? `\nDespachos selecionados (não incluídos na lista de números de processos): ${items.filter(x => x.type === "despacho").length}` : ""].filter(Boolean).join("\n");
}
function downloadFile(filename,contents,type) { const blob = new Blob([contents],{type}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
document.getElementById("saveSettings").addEventListener("click",saveSettings);
document.getElementById("exportTxt").addEventListener("click",async () => { const settings = await getSettings(); downloadFile("lista-pgd-sei.txt",exportText(await getItems(),settings),"text/plain;charset=utf-8"); });
document.getElementById("exportJson").addEventListener("click",async () => {
  const settings = await getSettings(), items = await getItems();
  if (!validPeriod(settings.dateStart,settings.dateEnd)) { alert("Configure um período válido antes de preparar os dados."); return; }
  const processos = items.filter(x => x.type === "processo").map(x => ({ numero: safeText(x.number), url: x.url || "" }));
  const payload = { formato: "pgd-sei-cobalto-v1", periodo: { modo: "periodo", data_inicial: settings.dateStart, data_final: settings.dateEnd }, processos };
  downloadFile("pgd-cobalto-importacao.json",JSON.stringify(payload,null,2),"application/json;charset=utf-8");
});
document.getElementById("copy").addEventListener("click",async () => {
  const settings = await getSettings(), text = exportText(await getItems(),settings);
  try { await navigator.clipboard.writeText(text); document.getElementById("copy").textContent = "Copiado!"; setTimeout(() => document.getElementById("copy").textContent = "Copiar lista",1400); }
  catch { const area = document.createElement("textarea"); area.value = text; document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); }
});
document.getElementById("clear").addEventListener("click",async () => { if (!confirm("Remover todos os itens acumulados?")) return; await chrome.storage.local.set({ [KEY]: [] }); render(); });
loadSettings(); render(); renderActions();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.seiPgdActions || changes.seiPgdActionsUpdatedAt)) renderActions();
});
