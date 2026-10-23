(() => {
  "use strict";
  if (window.__seiPgdCobaltoLoaded) return;
  window.__seiPgdCobaltoLoaded = true;

  const ITEMS_KEY = "seiPgdItems";
  const SETTINGS_KEY = "seiPgdSettings";
  const DEFAULT_SETTINGS = { dateMode: "periodo", dateStart: "2026-10-01", dateEnd: "2026-10-31" };
  const $ = (sel, root=document) => root.querySelector(sel);
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const clean = s => String(s || "").replace(/\s+/g, " ").trim();
  const number = v => Number.parseFloat(String(v ?? "").replace(",", ".")) || 0;
  const isoToBr = iso => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
  const parseDate = s => { let m=String(s||"").match(/(\d{2})\/(\d{2})\/(\d{4})/); if(m) return `${m[3]}-${m[2]}-${m[1]}`; m=String(s||"").match(/(\d{4})-(\d{2})-(\d{2})/); return m?m[0]:null; };
  const safe = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  function getGridRows() {
    const table = document.querySelector("#gridAcoes");
    if (!table) return [];
    // jqGrid expõe getRowData na instância, não necessariamente em $.fn.getRowData.
    try {
      const jq = window.jQuery || window.$;
      if (jq) {
        const grid = jq("#gridAcoes");
        if (grid && typeof grid.getRowData === "function") {
          const rows = grid.getRowData();
          if (Array.isArray(rows) && rows.length) return rows;
        }
      }
    } catch (e) { console.warn("[PGD] jqGrid getRowData falhou; tentando ler as linhas HTML", e); }

    // Fallback para tabelas jqGrid com valores nos atributos aria-describedby.
    const rows = Array.from(table.querySelectorAll("tr.jqgrow, tbody tr")).filter(tr => tr.querySelectorAll("td").length);
    return rows.map((tr, rowIndex) => {
      const row = { id: tr.id || String(rowIndex) };
      for (const td of tr.querySelectorAll("td")) {
        const key = (td.getAttribute("aria-describedby") || "").replace(/^.*?_/, "");
        if (key) row[key] = clean(td.innerText || td.textContent || "");
      }
      return row;
    }).filter(row => Object.keys(row).some(k => /descricao|acao|nome/i.test(k)));
  }
  function getPlanId() {
    const el = $("#id");
    return el?.value || el?.getAttribute("value") || "";
  }
  function getContributions() {
    try {
      if (window.jQuery && window.jQuery.fn && window.jQuery.fn.getRowData && window.jQuery("#gridContribuicoes").length) return window.jQuery("#gridContribuicoes").getRowData();
      if (window.$ && window.$.fn && window.$.fn.getRowData && window.$("#gridContribuicoes").length) return window.$("#gridContribuicoes").getRowData();
    } catch (_) {}
    return [];
  }
  async function storageGet(key) { const r = await chrome.storage.local.get(key); return r[key]; }
  async function storageSet(values) { await chrome.storage.local.set(values); }

  function collectProcessNumbers(items) {
    const seen = new Set();
    return items.filter(x => x.type === "processo" && clean(x.number)).map(x => clean(x.number)).filter(n => !seen.has(n) && seen.add(n));
  }

  function getWeeks(start, end) {
    const parse = s => { const [y,m,d]=s.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); };
    const fmt = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
    const plus = (d,n) => { const x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; };
    const first=parse(start), last=parse(end), weeks=[];
    if (first>last) return weeks;
    let cursor=new Date(first);
    while(cursor<=last) {
      // Semanas de segunda a domingo, limitadas ao intervalo escolhido.
      const dow=cursor.getUTCDay();
      const daysUntilSunday = dow===0 ? 0 : 7-dow;
      const weekEnd=plus(cursor,daysUntilSunday);
      const clippedEnd=weekEnd>last?last:weekEnd;
      weeks.push({start:fmt(cursor),end:fmt(clippedEnd)});
      cursor=plus(clippedEnd,1);
    }
    return weeks;
  }

  function insertPanel() {
    if ($("#sei-pgd-cobalto-panel")) return;
    if (!$("#gridAcoes")) return;
    const anchor = $("#gridAcoes").closest(".ui-jqgrid, .ui-jqgrid-bdiv, table") || $("#gridAcoes").parentElement;
    if (!anchor) return;
    const panel=document.createElement("section"); panel.id="sei-pgd-cobalto-panel";
    panel.innerHTML = `
      <div class="pgd-header"><div><h2>PGD — SEI → Cobalto</h2><div class="pgd-subtitle">Prepare contribuições semanais usando os processos selecionados no SEI.</div></div><button type="button" id="pgdRefreshActions">Atualizar ações</button></div>
      <div class="pgd-grid">
        <div class="pgd-field"><label for="pgdAction">Ação do plano de trabalho</label><select id="pgdAction"><option value="">Carregando ações…</option></select><div class="pgd-note" id="pgdActionInfo">A lista é lida da grade de ações desta página.</div></div>
        <div class="pgd-field"><label for="pgdHours">Horas por semana para esta ação</label><input id="pgdHours" type="number" min="0.25" max="24" step="0.25" value="8"><div class="pgd-note">Será criada uma contribuição para cada semana ou fração de semana do período.</div></div>
        <div class="pgd-field"><label for="pgdStart">Data inicial</label><input id="pgdStart" type="date" value="2026-10-01"></div>
        <div class="pgd-field"><label for="pgdEnd">Data final</label><input id="pgdEnd" type="date" value="2026-10-31"></div>
      </div>
      <div class="pgd-field"><label for="pgdDescription">Descrição da contribuição (editável)</label><textarea id="pgdDescription">Documentos SEI trabalhados no período:</textarea><div class="pgd-note" id="pgdProcessInfo">Lendo processos selecionados na extensão…</div></div>
      <div class="pgd-actions"><button type="button" class="pgd-primary" id="pgdPreview">Gerar prévia semanal</button><button type="button" id="pgdSaveSettings">Salvar configuração</button><button type="button" id="pgdRefreshProcesses">Atualizar processos do SEI</button><button type="button" class="pgd-primary" id="pgdSubmit" disabled>Confirmar e gravar no Cobalto</button></div>
      <div class="pgd-status" id="pgdStatus" role="status">Pronto para configurar. Nenhuma contribuição será gravada sem confirmação.</div>
      <div class="pgd-preview" id="pgdPreviewArea" hidden></div>`;
    anchor.insertAdjacentElement("beforebegin", panel);
    bindPanel(panel);
    loadSettingsAndItems(panel).then(() => refreshActions(panel));
  }

  async function loadSettingsAndItems(panel) {
    const settings={...DEFAULT_SETTINGS,...((await storageGet(SETTINGS_KEY))||{})};
    $("#pgdStart",panel).value=settings.dateStart || DEFAULT_SETTINGS.dateStart;
    $("#pgdEnd",panel).value=settings.dateEnd || DEFAULT_SETTINGS.dateEnd;
    const items=await storageGet(ITEMS_KEY) || [];
    renderProcesses(panel, items);
  }

  function renderProcesses(panel, items) {
    const numbers=collectProcessNumbers(items);
    const description=$("#pgdDescription",panel);
    const header="Documentos SEI trabalhados no período:";
    const existing=description.value.split("\n").filter(line => !/^\s*[-•]?\s*\d{5}\.\d{6}\/\d{4}-\d{2}\s*$/.test(line));
    let text=existing.join("\n").trim();
    if (!text) text=header;
    if (!text.toLowerCase().includes(header.toLowerCase())) text=header+"\n"+text;
    const cleaned=text.split("\n").filter(line => !/^\s*[-•]?\s*\d{5}\.\d{6}\/\d{4}-\d{2}\s*$/.test(line));
    description.value=cleaned.join("\n").trim();
    if (numbers.length) description.value += "\n" + numbers.map(n=>`- ${n}`).join("\n");
    $("#pgdProcessInfo",panel).textContent=`${numbers.length} processo(s) do SEI na lista da extensão. A descrição pode ser editada antes de gerar a prévia.`;
    panel.dataset.processNumbers=JSON.stringify(numbers);
    $("#pgdSubmit",panel).disabled=true;
    $("#pgdPreviewArea",panel).hidden=true;
  }

  function normalizeActions(rows) {
    return rows.map((row, index) => {
      const carga = number(row.carga_horaria ?? row.cargaHoraria ?? row.carga);
      const used = number(row.horas_utilizadas ?? row.horasUtilizadas ?? row.horas_usadas ?? row.horas);
      return {
        id: String(row.id ?? row.plano_entrega_unidade_ocorrencia_id ?? index),
        descricao: clean(row.descricao || row.acao || row.nome || row.atividade || `Ação ${index + 1}`),
        modalidade: clean(row.modalidade || row.tipo_modalidade || "Modalidade não informada"),
        carga_horaria: carga,
        horas_utilizadas: used,
        saldo: carga - used,
        raw: row
      };
    });
  }

  async function importActionsFromGrid() {
    const rows = getGridRows();
    if (!rows.length) return { ok: false, count: 0, message: "Não encontrei linhas em #gridAcoes. Abra a página do plano de trabalho e aguarde a grade carregar." };
    const actions = normalizeActions(rows);
    await chrome.storage.local.set({ seiPgdActions: actions, seiPgdActionsUpdatedAt: new Date().toISOString() });
    return { ok: true, count: actions.length, message: `${actions.length} ação(ões) importada(s) da grade #gridAcoes.` };
  }

  function refreshActions(panel) {
    const select = $("#pgdAction", panel), info = $("#pgdActionInfo", panel);
    const rows = getGridRows();
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = rows.length ? "Selecione uma ação…" : "Não encontrei ações na grade";
    select.append(placeholder);
    rows.forEach((row, index) => {
      const action = normalizeActions([row])[0];
      const opt = document.createElement("option");
      opt.value = String(index);
      opt.textContent = `${action.descricao} — ${action.modalidade} | Carga ${action.carga_horaria}h · Utilizadas ${action.horas_utilizadas}h · Saldo ${action.saldo}h`;
      opt.dataset.actionId = action.id;
      opt.dataset.description = action.descricao;
      opt.dataset.modality = action.modalidade;
      opt.dataset.balance = String(action.saldo);
      opt.dataset.row = JSON.stringify(row);
      select.append(opt);
    });
    info.textContent = rows.length ? `${rows.length} ação(ões) encontradas na grade. Carga horária, horas utilizadas e saldo são exibidos na lista.` : "Abra o plano de trabalho do Cobalto que contenha a grade #gridAcoes e clique em Atualizar ações.";
    panel.dataset.actions = JSON.stringify(rows);
    importActionsFromGrid().catch(e => console.warn("[PGD] Não foi possível importar ações para o popup", e));
    $("#pgdSubmit", panel).disabled = true;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "PGD_IMPORT_COBALTO_ACTIONS") return;
    importActionsFromGrid().then(sendResponse).catch(error => sendResponse({ ok: false, count: 0, message: error.message || "Falha ao importar ações." }));
    return true;
  });

  async function saveSettings(panel) {
    const dateStart=$("#pgdStart",panel).value, dateEnd=$("#pgdEnd",panel).value;
    if (!dateStart || !dateEnd || dateEnd<dateStart) throw new Error("Informe um período válido: a data final deve ser igual ou posterior à inicial.");
    const settings={dateMode:"periodo",dateStart,dateEnd,weekly:true};
    await storageSet({[SETTINGS_KEY]:settings});
    return settings;
  }

  function selectedAction(panel) {
    const select=$("#pgdAction",panel), opt=select.selectedOptions[0];
    if (!opt || !opt.value) throw new Error("Selecione uma ação do plano de trabalho.");
    const rows=JSON.parse(panel.dataset.actions||"[]");
    const row=rows[Number(opt.value)];
    if (!row) throw new Error("Não foi possível identificar a ação selecionada. Atualize a lista.");
    return row;
  }

  function buildPlan(panel) {
    const start=$("#pgdStart",panel).value, end=$("#pgdEnd",panel).value;
    if (!start || !end || end<start) throw new Error("Período inválido.");
    const hours=number($("#pgdHours",panel).value);
    if (!(hours>0 && hours<=24)) throw new Error("Informe um número de horas por semana maior que zero e até 24.");
    const row=selectedAction(panel);
    const actionId=String(row.id ?? row.plano_entrega_unidade_ocorrencia_id ?? "");
    if (!actionId) throw new Error("A ação selecionada não possui ID reconhecível.");
    const balance=number(row.carga_horaria)-number(row.horas_utilizadas);
    const weeks=getWeeks(start,end);
    if (!weeks.length) throw new Error("Não há semanas no período escolhido.");
    const total=hours*weeks.length;
    if (balance>=0 && total>balance) throw new Error(`O total previsto (${total}h) supera o saldo informado da ação (${balance}h). Ajuste as horas ou o período.`);
    const description=$("#pgdDescription",panel).value.trim();
    if (!description) throw new Error("Preencha a descrição da contribuição.");
    const planId=getPlanId();
    if (!planId) throw new Error("Não encontrei o ID do plano (#id). Confirme se a página principal do plano está aberta.");
    return {row,actionId,planId,start,end,hours,total,weeks,description};
  }

  function showStatus(panel,message,isError=false) {
    const el=$("#pgdStatus",panel); el.textContent=message; el.classList.toggle("error",isError);
  }
  function makePreview(panel) {
    const plan=buildPlan(panel);
    const preview=$("#pgdPreviewArea",panel);
    preview.hidden=false;
    preview.innerHTML=`<strong>Prévia — ${plan.weeks.length} contribuição(ões), ${plan.total} horas no total</strong><div class="pgd-note">Ação: ${safe(plan.row.descricao||plan.row.acao||plan.row.nome)} · ${safe(plan.row.modalidade||"")}</div><table><thead><tr><th>Semana / período</th><th>Horas</th><th>Descrição</th></tr></thead><tbody>${plan.weeks.map(w=>`<tr><td>${safe(isoToBr(w.start))} a ${safe(isoToBr(w.end))}</td><td>${plan.hours}h</td><td>${safe(plan.description).replace(/\n/g,"<br>")}</td></tr>`).join("")}</tbody></table><p class="pgd-note">As semanas são divididas de segunda a domingo e limitadas às datas escolhidas. A gravação usa o intervalo semanal (dt_inicio/dt_fim) no Cobalto.</p>`;
    $("#pgdSubmit",panel).disabled=false;
    panel.dataset.pendingPlan=JSON.stringify({...plan,row:plan.row});
    showStatus(panel,"Prévia pronta. Revise a ação, as datas, as horas e a descrição. Nada foi gravado ainda.");
  }

  async function submitPlan(panel) {
    const plan=buildPlan(panel);
    if (!confirm(`Confirma gravar ${plan.weeks.length} contribuição(ões) semanais, totalizando ${plan.total} horas, no Cobalto? Esta operação enviará dados ao sistema.`)) return;
    const endpoint="https://cobalto.ufpel.edu.br/prgrh/teletrabalho/planoTrabalhoContribuicao/salvar";
    const btn=$("#pgdSubmit",panel); btn.disabled=true; btn.textContent="Gravando…";
    let success=0, errors=[];
    try {
      for (const week of plan.weeks) {
        const fd=new FormData();
        fd.append("plano_trabalho_2025_ocorrencia_id",plan.actionId);
        fd.append("plano_id",plan.planId);
        fd.append("id","");
        fd.append("horas_atual","");
        fd.append("horas",String(plan.hours));
        fd.append("dt_inicio",isoToBr(week.start));
        fd.append("dt_fim",isoToBr(week.end));
        fd.append("descricao",plan.description.slice(0,256));
        try {
          const response=await fetch(endpoint,{method:"POST",body:fd,credentials:"same-origin",headers:{"X-Requested-With":"XMLHttpRequest"}});
          const body=(await response.text()).slice(0,350);
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${body}`);
          success++;
          showStatus(panel,`Gravando contribuições: ${success}/${plan.weeks.length} concluída(s)…`);
          await new Promise(resolve=>setTimeout(resolve,600));
        } catch (e) { errors.push(`${isoToBr(week.start)}–${isoToBr(week.end)}: ${e.message}`); break; }
      }
      if (success) showStatus(panel,`${success} contribuição(ões) enviada(s). ${errors.length?"Houve erro: "+errors.join(" | "):"Recarregue a página e confira a grade de contribuições antes de encerrar."}`,Boolean(errors.length));
      else showStatus(panel,`Nenhuma contribuição foi confirmada. ${errors.join(" | ")||"Verifique o console do navegador."}`,true);
    } finally { btn.textContent="Confirmar e gravar no Cobalto"; btn.disabled=false; }
  }

  function bindPanel(panel) {
    $("#pgdRefreshActions",panel).addEventListener("click",()=>{refreshActions(panel);showStatus(panel,"Lista de ações atualizada a partir da grade do Cobalto.");});
    $("#pgdRefreshProcesses",panel).addEventListener("click",async()=>{renderProcesses(panel,await storageGet(ITEMS_KEY)||[]);showStatus(panel,"Lista de processos do SEI atualizada.");});
    $("#pgdSaveSettings",panel).addEventListener("click",async()=>{try{const s=await saveSettings(panel);showStatus(panel,`Configuração salva: ${isoToBr(s.dateStart)} a ${isoToBr(s.dateEnd)}.`);}catch(e){showStatus(panel,e.message,true);}});
    $("#pgdPreview",panel).addEventListener("click",()=>{try{makePreview(panel);}catch(e){showStatus(panel,e.message,true);$("#pgdSubmit",panel).disabled=true;}});
    $("#pgdSubmit",panel).addEventListener("click",async()=>{try{await submitPlan(panel);}catch(e){showStatus(panel,e.message,true);}});
    $("#pgdAction",panel).addEventListener("change",()=>{$("#pgdSubmit",panel).disabled=true;$("#pgdPreviewArea",panel).hidden=true;});
    for (const id of ["pgdStart","pgdEnd","pgdHours","pgdDescription"]) $("#"+id,panel).addEventListener("input",()=>{$("#pgdSubmit",panel).disabled=true;$("#pgdPreviewArea",panel).hidden=true;});
    chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local" && changes[ITEMS_KEY]) renderProcesses(panel,changes[ITEMS_KEY].newValue||[]);});
  }

  // jqGrid puede terminar de cargar después do document_idle; tenta por alguns segundos.
  let attempts=0;
  const timer=setInterval(()=>{attempts++;insertPanel();if($("#sei-pgd-cobalto-panel")||attempts>=30)clearInterval(timer);},500);
  insertPanel();
})();
