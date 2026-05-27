const { ipcRenderer } = require("electron");

// ============================================================
// WhatsApp Preload Script
// Bridge entre a página do WhatsApp Web e o processo principal
// ============================================================

let isConnected = false;
let statusCheckInterval = null;

// Detectar quando o WhatsApp está autenticado
// Usa MutationObserver + polling para detectar transições QR → chat
function checkWhatsAppStatus() {
  if (statusCheckInterval) clearInterval(statusCheckInterval);

  statusCheckInterval = setInterval(() => {
    try {
      // Múltiplos seletores para detectar estado logado
      // WhatsApp muda sua estrutura DOM frequentemente, então testamos vários
      const chatList = document.querySelector('[data-testid="chat-list"]');
      const sidePanel = document.querySelector('#pane-side');
      const mainApp = document.querySelector('[data-testid="default-user"]');
      const introScreen = document.querySelector('[data-testid="intro-md-beta-message"]');

      const isLoggedIn = !!(chatList || sidePanel || mainApp || introScreen);

      if (isLoggedIn && !isConnected) {
        isConnected = true;
        ipcRenderer.send("whats-status", { connected: true });
        console.log("[Preload] WhatsApp conectado - sessão ativa");
      } else if (!isLoggedIn && isConnected) {
        isConnected = false;
        ipcRenderer.send("whats-status", { connected: false });
        console.log("[Preload] WhatsApp desconectado");
      }
    } catch (e) {
      console.error("[Preload] Erro ao verificar status:", e);
    }
  }, 2000);
}

// Monitorar mudanças no DOM para detectar transição mais rápido
function observeDOMChanges() {
  const observer = new MutationObserver(() => {
    try {
      const chatList = document.querySelector('[data-testid="chat-list"]');
      const sidePanel = document.querySelector('#pane-side');

      if ((chatList || sidePanel) && !isConnected) {
        isConnected = true;
        ipcRenderer.send("whats-status", { connected: true });
        console.log("[Preload] WhatsApp conectado (detectado via MutationObserver)");
      }
    } catch (e) {
      // Silenciar
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Abrir chat por ID
function openChatById(chatId) {
  try {
    const url = `https://web.whatsapp.com/send?phone=${chatId}`;
    window.location.href = url;
  } catch (error) {
    console.error("[Preload] Erro ao abrir chat:", error);
  }
}

// ============================================================
// IPC Listeners - Recebe comandos do main process
// ============================================================

ipcRenderer.on("open-chat", (event, data) => {
  if (data && data.phone) {
    openChatById(data.phone);
  }
});

ipcRenderer.on("reload-page", () => {
  window.location.reload();
});

// ============================================================
// Teste de manipulação DOM — executa diagnóstico completo
// ============================================================
ipcRenderer.on("test-dom-manipulation", () => {
  console.log("[Preload] === TESTE DE MANIPULAÇÃO DOM ===");
  const results = {};

  // 1. Explorar DOM real — descobrir seletores disponíveis
  // Listar data-testid existentes na página
  const allTestIds = [...document.querySelectorAll("[data-testid]")]
    .map(el => el.getAttribute("data-testid"))
    .filter((v, i, a) => a.indexOf(v) === i) // unique
    .slice(0, 30);
  console.log("[Preload] data-testid encontrados:", JSON.stringify(allTestIds));

  // Listar roles existentes
  const allRoles = [...document.querySelectorAll("[role]")]
    .map(el => el.getAttribute("role"))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 20);
  console.log("[Preload] roles encontrados:", JSON.stringify(allRoles));

  // 2. Leitura do DOM — seletores amplos para encontrar elementos-chave
  results.sidePanel = !!document.querySelector("#pane-side");
  results.chatList = !!document.querySelector('[data-testid="chat-list"]') ||
                     !!document.querySelector('[aria-label*="Chat list"]') ||
                     !!document.querySelector('[aria-label*="Lista de conversas"]') ||
                     !!document.querySelector('#pane-side [role="list"]') ||
                     !!document.querySelector('#pane-side [role="grid"]') ||
                     !!document.querySelector('#pane-side [role="listbox"]');
  results.searchBox = !!document.querySelector('[data-testid="chat-list-search"]') ||
                      !!document.querySelector('[contenteditable="true"][data-tab="3"]') ||
                      !!document.querySelector('[role="textbox"][data-tab="3"]') ||
                      !!document.querySelector('#side [role="textbox"]') ||
                      !!document.querySelector('div[contenteditable="true"][title]');
  results.header = !!document.querySelector("header");
  results.conversations = document.querySelectorAll('[data-testid="cell-frame-container"]').length ||
                          document.querySelectorAll('#pane-side [role="listitem"]').length ||
                          document.querySelectorAll('#pane-side [role="row"]').length ||
                          document.querySelectorAll('#pane-side [role="option"]').length ||
                          document.querySelectorAll('#pane-side > div > div > div').length;

  // 3. Injeção de CSS
  try {
    const style = document.createElement("style");
    style.id = "test-inject-css";
    style.textContent = "/* CSS injection test — will be removed */";
    document.head.appendChild(style);
    results.cssInjection = !!document.getElementById("test-inject-css");
    document.getElementById("test-inject-css").remove();
  } catch (e) {
    results.cssInjection = false;
  }

  // 4. Criação de elementos DOM
  try {
    const testDiv = document.createElement("div");
    testDiv.id = "test-dom-create";
    testDiv.style.display = "none";
    document.body.appendChild(testDiv);
    results.domCreation = !!document.getElementById("test-dom-create");
    document.getElementById("test-dom-create").remove();
  } catch (e) {
    results.domCreation = false;
  }

  // 5. Acesso a inputs/editáveis
  const editables = document.querySelectorAll('[contenteditable="true"]');
  results.editableFields = editables.length;

  // 6. Textboxes (role)
  const searchInputs = document.querySelectorAll('[role="textbox"]');
  results.textboxes = searchInputs.length;

  // 7. Simular eventos
  try { results.eventCreation = !!new MouseEvent("click", { bubbles: true }); } catch (e) { results.eventCreation = false; }
  try { results.inputEventCreation = !!new InputEvent("input", { bubbles: true, data: "test" }); } catch (e) { results.inputEventCreation = false; }
  try { results.keyEventCreation = !!new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }); } catch (e) { results.keyEventCreation = false; }

  // 8. Teste: Simular clique real num elemento (sem efeito)
  try {
    const header = document.querySelector("header");
    if (header) {
      const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      results.realClickDispatch = header.dispatchEvent(clickEvent);
    } else {
      results.realClickDispatch = false;
    }
  } catch (e) { results.realClickDispatch = false; }

  // 9. Teste: Escrever num textbox (testar e limpar)
  try {
    const textbox = document.querySelector('[role="textbox"]');
    if (textbox) {
      // Simular texto via execCommand (método do WhatsApp Web)
      textbox.focus();
      document.execCommand("insertText", false, "TESTE_AUTO");
      const written = textbox.textContent.includes("TESTE_AUTO");
      // Limpar
      document.execCommand("selectAll");
      document.execCommand("delete");
      results.textboxWrite = written;
    } else {
      results.textboxWrite = false;
    }
  } catch (e) { results.textboxWrite = false; }

  // 10. Fetch cross-origin
  fetch("https://httpbin.org/get", { method: "GET" })
    .then(r => {
      results.crossOriginFetch = r.ok;
      reportResults(results);
    })
    .catch(() => {
      results.crossOriginFetch = false;
      reportResults(results);
    });

  function reportResults(r) {
    console.log("[Preload] --- Resultados DOM Manipulation ---");
    for (const [key, val] of Object.entries(r)) {
      const icon = val === true || (typeof val === "number" && val > 0) ? "✓" : "✗";
      console.log(`[Preload]   ${icon} ${key}: ${val}`);
    }
    console.log("[Preload] === FIM DO TESTE DOM ===");
    ipcRenderer.send("dom-test-results", r);
  }
});

// ============================================================
// DOM Ready
// ============================================================

window.addEventListener("DOMContentLoaded", () => {
  console.log("[Preload] WhatsApp Web DOM carregado, URL:", window.location.href);
  checkWhatsAppStatus();
  observeDOMChanges();
});
