const { ipcRenderer } = require("electron");

// ============================================================
// Titlebar Controls
// ============================================================

document.getElementById("btn-minimize").addEventListener("click", () => {
  ipcRenderer.send("minimize");
});

document.getElementById("btn-maximize").addEventListener("click", () => {
  ipcRenderer.send("maximize");
});

document.getElementById("btn-close").addEventListener("click", () => {
  ipcRenderer.send("close");
});

// ============================================================
// Sidebar Controls
// ============================================================

document.getElementById("btn-reload").addEventListener("click", () => {
  ipcRenderer.send("reload-whatsapp");
});

document.getElementById("btn-logout").addEventListener("click", () => {
  if (confirm("Desconectar WhatsApp? A sessão será limpa e você precisará escanear o QR code novamente.")) {
    ipcRenderer.send("clear-whatsapp-session");
  }
});

// ============================================================
// Modal Helpers
// ============================================================

function showModal(id) {
  ipcRenderer.send("modal-open");
  document.getElementById(id).style.display = "flex";
}

function hideModal(id) {
  document.getElementById(id).style.display = "none";
  ipcRenderer.send("modal-close");
}

// Close modals when clicking overlay
document.querySelectorAll(".modal-overlay").forEach((el) => {
  el.addEventListener("click", () => {
    el.closest(".modal").style.display = "none";
    ipcRenderer.send("modal-close");
  });
});

// ============================================================
// Export Conversations
// ============================================================

document.getElementById("btn-export").addEventListener("click", () => {
  showModal("modal-export");
  // Reset progress
  document.getElementById("export-progress").style.display = "none";
  document.getElementById("btn-export-start").disabled = false;
});

document.getElementById("btn-export-cancel").addEventListener("click", () => {
  hideModal("modal-export");
});

document.getElementById("btn-export-start").addEventListener("click", async () => {
  const limit = parseInt(document.querySelector('input[name="export-limit"]:checked').value);
  const format = document.querySelector('input[name="export-format"]:checked').value;

  // Show progress
  document.getElementById("export-progress").style.display = "block";
  document.getElementById("btn-export-start").disabled = true;
  document.getElementById("progress-fill").style.width = "0%";
  document.getElementById("progress-text").textContent = "Iniciando extração...";

  try {
    const result = await ipcRenderer.invoke("extract-conversations", { limit });

    if (result && result.success && result.data && result.data.length > 0) {
      const data = result.data;
      document.getElementById("progress-text").textContent = `Extraídas ${data.length} conversas. Salvando...`;
      const saveResult = await ipcRenderer.invoke("export-conversations", { data, format });
      if (saveResult && saveResult.success) {
        document.getElementById("progress-text").textContent = `Exportado com sucesso! ${data.length} conversas salvas.`;
      } else if (saveResult && saveResult.cancelled) {
        document.getElementById("progress-text").textContent = "Exportação cancelada.";
      } else {
        document.getElementById("progress-text").textContent = "Erro ao salvar arquivo.";
      }
    } else {
      document.getElementById("progress-text").textContent = result && result.error ? "Erro: " + result.error : "Nenhuma conversa encontrada.";
    }
  } catch (err) {
    document.getElementById("progress-text").textContent = "Erro: " + err.message;
  }

  document.getElementById("btn-export-start").disabled = false;
});

ipcRenderer.on("extract-progress", (event, info) => {
  const pct = Math.round((info.current / info.total) * 100);
  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("progress-text").textContent = `Extraindo conversa ${info.current} de ${info.total}...`;
});

// ============================================================
// Settings
// ============================================================

document.getElementById("btn-settings").addEventListener("click", async () => {
  const settings = await ipcRenderer.invoke("get-settings");
  
  // Buscar impressoras do sistema
  const printerSelect = document.getElementById("setting-printer-name");
  printerSelect.innerHTML = '<option value="">Impressora Padrão (Silenciosa)</option>';
  
  try {
    const printers = await ipcRenderer.invoke("get-printers");
    if (printers && printers.length > 0) {
      printers.forEach(p => {
        const option = document.createElement("option");
        option.value = p.name;
        option.textContent = p.name + (p.isDefault ? " (Padrão)" : "");
        printerSelect.appendChild(option);
      });
    }
  } catch (err) {
    console.error("Erro ao carregar impressoras:", err);
  }

  if (settings) {
    document.getElementById("setting-auto-reply-enabled").checked = settings.autoReplyEnabled;
    document.getElementById("setting-auto-reply-message").value = settings.autoReplyMessage || "";
    document.getElementById("setting-auto-reply-delay").value = settings.autoReplyDelay || 3000;
    document.getElementById("setting-auto-reply-only-new").checked = settings.autoReplyOnlyNewChats !== false;
    printerSelect.value = settings.printerName || "";
  }
  showModal("modal-settings");
});

document.getElementById("btn-settings-cancel").addEventListener("click", () => {
  hideModal("modal-settings");
});

document.getElementById("btn-settings-save").addEventListener("click", async () => {
  const settings = {
    autoReplyEnabled: document.getElementById("setting-auto-reply-enabled").checked,
    autoReplyMessage: document.getElementById("setting-auto-reply-message").value,
    autoReplyDelay: parseInt(document.getElementById("setting-auto-reply-delay").value) || 3000,
    autoReplyOnlyNewChats: document.getElementById("setting-auto-reply-only-new").checked,
    autoReplyIgnoreGroups: true,
    printerName: document.getElementById("setting-printer-name").value,
  };

  await ipcRenderer.invoke("save-settings", settings);
  hideModal("modal-settings");
});

// ============================================================
// WhatsApp Status
// ============================================================

function hideLoadingScreen() {
  const loadingScreen = document.getElementById("loading-screen");
  if (loadingScreen && loadingScreen.style.display !== "none") {
    loadingScreen.style.opacity = "0";
    setTimeout(() => {
      loadingScreen.style.display = "none";
    }, 300);
  }
}

ipcRenderer.on("whatsapp-ready", () => {
  hideLoadingScreen();
});

// Timeout de segurança: se após 15 segundos o loading ainda estiver visível, remover
setTimeout(() => {
  hideLoadingScreen();
}, 15000);

ipcRenderer.on("whats-status-update", (event, status) => {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const badge = document.getElementById("whats-badge");
  const indicator = document.getElementById("status-indicator");

  if (status.connected) {
    dot.className = "status-dot connected";
    text.textContent = "Online";
    indicator.title = "Status: Conectado";
    badge.style.display = "none";
  } else {
    dot.className = "status-dot disconnected";
    text.textContent = "Offline";
    indicator.title = "Status: Desconectado";
    badge.style.display = "flex";
  }
});

// ============================================================
// Lojista Login / Logout Interface
// ============================================================

const btnMerchantLogout = document.getElementById("btn-merchant-logout");

// Logout da empresa
btnMerchantLogout.addEventListener("click", async () => {
  if (confirm("Deseja sair da conta do lojista? O bot de auto-resposta ficará pausado até um novo login.")) {
    await ipcRenderer.invoke("logout-merchant");
    btnMerchantLogout.style.display = "none";
  }
});

// Recebe confirmação de login vinda do main process após autenticação na tela dedicada
ipcRenderer.on("merchant-logged-in", (event, data) => {
  btnMerchantLogout.style.display = "flex";
  console.log(`[Renderer] Lojista logado via tela dedicada: ${data.companyName || data.name || ""}`);
});

// Verificar status inicial
async function checkLoginStatus() {
  const s = await ipcRenderer.invoke("get-settings");
  if (s && s.companyId) {
    btnMerchantLogout.style.display = "flex";
  } else {
    btnMerchantLogout.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", checkLoginStatus);
checkLoginStatus();

