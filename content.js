(() => {
  "use strict";

  const STORAGE_KEY = "seiPgdItems";
  const BUTTON_CLASS = "sei-pgd-add-button";
  const PROCESS_SELECTOR = 'a.processoVisualizado[href*="id_procedimento="]';
  const DOCUMENT_SELECTOR = 'a[href*="acao=documento_visualizar"][href*="id_documento="], a[href*="acao=documento_trabalhar"][href*="id_documento="]';

  function cleanText(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function getProcessNumber(row, anchor) {
    const checkbox = row?.querySelector('input.infraCheckbox[type="checkbox"][title]');
    if (checkbox?.title) return cleanText(checkbox.title);
    const match = cleanText(anchor.textContent).match(/\b\d{5}\.\d{6}\/\d{4}-\d{2}\b/);
    return match ? match[0] : cleanText(anchor.textContent);
  }

  function itemKey(item) {
    return `${item.type}|${item.id || item.url || item.title}`;
  }

  async function addItem(item, button) {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const items = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      const key = itemKey(item);
      const existing = items.find(x => itemKey(x) === key);
      if (existing) {
        button.textContent = "✓ PGD";
        button.classList.add("sei-pgd-added");
        button.title = "Este item já está na lista PGD";
        return;
      }
      items.push({ ...item, addedAt: new Date().toISOString() });
      await chrome.storage.local.set({ [STORAGE_KEY]: items });
      button.textContent = "✓ PGD";
      button.classList.add("sei-pgd-added");
      button.title = "Adicionado à lista PGD";
      window.dispatchEvent(new CustomEvent("sei-pgd-updated"));
    } catch (err) {
      console.error("[SEI PGD] Não foi possível salvar o item", err);
      button.textContent = "Erro";
    }
  }

  function makeButton(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.textContent = "PGD";
    button.title = "Adicionar à lista PGD";
    button.setAttribute("aria-label", `Adicionar ${item.type === "processo" ? "processo" : "despacho"} à lista PGD`);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      addItem(item, button);
    });
    return button;
  }

  function insertAfter(anchor, item) {
    if (!anchor || anchor.dataset.seiPgdProcessed === "1") return;
    anchor.dataset.seiPgdProcessed = "1";
    const button = makeButton(item);
    anchor.insertAdjacentElement("afterend", button);
  }

  function scanProcesses() {
    document.querySelectorAll(PROCESS_SELECTOR).forEach(anchor => {
      const row = anchor.closest("tr");
      const processId = new URL(anchor.href, location.href).searchParams.get("id_procedimento");
      const number = getProcessNumber(row, anchor);
      const title = cleanText(anchor.getAttribute("aria-label") || anchor.textContent);
      insertAfter(anchor, {
        type: "processo",
        id: processId || "",
        number,
        title,
        url: anchor.href,
        source: "Controle de Processos"
      });
    });
  }

  function isDespacho(anchor) {
    const text = cleanText([
      anchor.textContent,
      anchor.getAttribute("aria-label"),
      anchor.getAttribute("title"),
      anchor.querySelector("img")?.getAttribute("alt"),
      anchor.querySelector("img")?.getAttribute("title")
    ].filter(Boolean).join(" "));
    return /\bdespacho\b/i.test(text);
  }

  function scanDespachos() {
    document.querySelectorAll(DOCUMENT_SELECTOR).forEach(anchor => {
      if (!isDespacho(anchor)) return;
      const url = new URL(anchor.href, location.href);
      const documentId = url.searchParams.get("id_documento") || url.searchParams.get("id_procedimento") || "";
      const title = cleanText(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || anchor.textContent) || "Despacho";
      const number = cleanText(anchor.textContent) || title;
      insertAfter(anchor, {
        type: "despacho",
        id: documentId,
        number,
        title,
        url: anchor.href,
        source: "Documento SEI"
      });
    });
  }

  function scan() {
    scanProcesses();
    scanDespachos();
  }

  // O SEI pode atualizar a árvore de documentos ou a lista sem recarregar a página.
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  });

  scan();
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();