// ============================================================
// Login Preload — Injetado em https://anafood.vip/login
// Expõe window.electronBridge para a página web se comunicar
// com o processo principal do Electron via IPC.
// ============================================================
const { ipcRenderer } = require("electron");

window.electronBridge = {
  /** Flag para a página web detectar que está rodando dentro do Electron */
  isElectron: true,

  /** Versão do app desktop */
  version: require("../../package.json").version,

  /**
   * Chamado pelo Login.tsx após autenticação bem-sucedida.
   * Payload esperado:
   * {
   *   userId, email, accessToken, refreshToken,
   *   companyId, companyName, role,
   *   supabaseUrl, supabaseAnonKey
   * }
   */
  loginSuccess: (data) => {
    ipcRenderer.send("web-login-success", data);
  },

  /** Chamado pela página web para deslogar e voltar à tela de login */
  logout: () => {
    ipcRenderer.send("logout-merchant-from-sidebar");
  },

  /**
   * Recebe eventos do Electron main process.
   * Uso: window.electronBridge.on("merchant-logged-out", () => { ... })
   */
  on: (channel, callback) => {
    const validChannels = [
      "merchant-logged-out",
      "bot-status-changed",
      "whats-status-update",
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
};

console.log("[LoginPreload] electronBridge exposto com sucesso. Versão:", window.electronBridge.version);
