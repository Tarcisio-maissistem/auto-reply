console.log("[Main] main.js starting execution...");
require("dotenv").config();
const { app, BrowserWindow, BrowserView, ipcMain, Tray, Menu, nativeImage, globalShortcut, session, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const SettingsManager = require("./settings");
const AutoReplyAgent = require("./auto-reply");
const db = require("../chatbot/database");
const vpsPrintService = require("./vps-print-service");

// Configurações
const configs = {
  titlebarHeight: 0,  // Menu nativo do Windows — sem titlebar customizada
  sidebarWidth: 60,
  defaultWidth: 1280,
  defaultHeight: 768,
  minWidth: 800,
  minHeight: 600,
  whatsappUrl: "https://web.whatsapp.com",
};

let mainWindow = null;
let whatsappView = null;
let loginView = null;
let systemView = null;   // React app (ana-food-Suitable)
let sidebarView = null;  // 3-icon Electron sidebar
let titlebarView = null;
let tray = null;
let settings = null;
let autoReply = null;
let apiInjected = false;
let whatsappActive = false;
let whatsappBounds = { x: 0, y: 0, width: 0, height: 0 };
let activeView = 'conta'; // 'conta' | 'whatsapp' | 'sistema'
let botEnabled = true; // Estado do robô (Pausar/Ativar)

// ====================================================================
// TÉCNICAS EXATAS DO ANOTA AI — Switches do Chromium ANTES de tudo
// ====================================================================
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-site-isolation-trials");
app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors");
process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

// Não alterar userAgentFallback globalmente — apenas definir no BrowserView do WhatsApp

// ====================================================================
// Single Instance Lock (como Anota AI)
// ====================================================================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log("[Main] Another instance is already running. Quitting.");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  // ================================================================
  // App Ready — como Anota AI: app.on("ready", createWindow)
  // ================================================================
  app.on("ready", () => {
    // Inicializar settings
    settings = new SettingsManager(app.getPath("userData"));
    createWindow();
  });
}

// ====================================================================
// Criar janela principal + BrowserViews (EXATO como Anota AI)
// ====================================================================
async function createWindow() {
  // 1. BrowserWindow carrega apenas um fundo escuro — views são BrowserViews
  mainWindow = new BrowserWindow({
    // frame: true (padrão) — mostra barra de título nativa do Windows + menu
    show: false,
    width: configs.defaultWidth,
    height: configs.defaultHeight,
    minWidth: configs.minWidth,
    minHeight: configs.minHeight,
    icon: path.join(__dirname, "..", "renderer", "icons", "icon.png"),
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  await mainWindow.loadFile(path.join(__dirname, "..", "renderer", "shell.html"));

  // 2. WhatsApp BrowserView — adicionado primeiro (z-order mais baixo)
  whatsappView = new BrowserView({
    webPreferences: {
      webSecurity: false,
      nodeIntegration: false,
      contextIsolation: false,
      preload: path.join(__dirname, "whatsapp-preload.js"),
    },
  });
  whatsappView.webContents.setWindowOpenHandler(({ url }) => {
    setImmediate(() => { require("electron").shell.openExternal(url); });
    return { action: "deny" };
  });
  const chromeUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
  whatsappView.webContents.setUserAgent(chromeUA);
  whatsappView.webContents.loadURL(configs.whatsappUrl);
  mainWindow.addBrowserView(whatsappView);

  // 3. System BrowserView — carrega o React app (ana-food-Suitable)
  const reactIndexPath = path.join(__dirname, "..", "..", "..", "ana-food-Suitable", "dist", "index.html");
  systemView = new BrowserView({
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, "system-preload.js"),
    },
  });
  if (fs.existsSync(reactIndexPath)) {
    await systemView.webContents.loadFile(reactIndexPath);
  } else {
    console.log("[Main] React build not found. Falling back to old renderer.");
    await systemView.webContents.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }
  mainWindow.addBrowserView(systemView);

  // 4. Login BrowserView — carrega anafood.vip/login
  createLoginView();

  // 5. Resize handlers
  mainWindow.on("resize", () => { resizeAllViews(); setBoundsIfValid(); });
  mainWindow.on("maximize", () => { resizeAllViews(); setBoundsIfValid(); });
  mainWindow.on("unmaximize", () => { resizeAllViews(); setBoundsIfValid(); });

  // 6. Maximizar e mostrar
  mainWindow.maximize();
  mainWindow.show();

  // 7. Criar sidebar (menu nativo já aparece na barra de título do Windows)
  createSidebarView();

  // 8. Mostrar tela de login na inicialização
  showView('conta');

  // 10. Eventos do WhatsApp
  whatsappView.webContents.on("dom-ready", () => {
    console.log("[Main] WhatsApp DOM ready");
    sendToViews("whatsapp-ready");
    apiInjected = false; // Reset para re-injetar
    injectAPI();
  });

  // Reset apiInjected quando a página navega (WhatsApp pode recarregar internamente)
  whatsappView.webContents.on("did-navigate", (event, url) => {
    console.log("[Main] WhatsApp navegou para:", url);
    apiInjected = false;
    injectAPI();
  });

  whatsappView.webContents.on("did-finish-load", () => {
    console.log("[Main] WhatsApp finished loading:", whatsappView.webContents.getURL());
  });

  whatsappView.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    console.error("[Main] WhatsApp FAILED:", errorCode, errorDescription, validatedURL);
    if (errorCode !== -3) {
      setTimeout(() => {
        if (whatsappView && !whatsappView.webContents.isDestroyed()) {
          whatsappView.webContents.loadURL(configs.whatsappUrl);
        }
      }, 5000);
    }
  });

  whatsappView.webContents.on("page-title-updated", (event, title) => {
    console.log("[Main] WhatsApp title:", title);
  });

  // 10b. Polling de conexão direto do main process (backup do preload)
  let mainPollConnected = false;
  const mainConnectionPoll = setInterval(async () => {
    if (mainPollConnected) return;
    if (!whatsappView || whatsappView.webContents.isDestroyed()) return;
    try {
      const connected = await whatsappView.webContents.executeJavaScript(
        "(function(){ return !!(document.querySelector('#pane-side') || document.querySelector('[data-testid=\"chat-list\"]')); })()"
      );
      if (connected && !mainPollConnected) {
        mainPollConnected = true;
        console.log("[Main] WhatsApp CONNECTED (detectado via polling do main)");
        clearInterval(mainConnectionPoll);

        // Iniciar auto-reply
        if (!autoReply && whatsappView) {
          autoReply = new AutoReplyAgent(whatsappView, settings);
          autoReply.init(app.getPath("userData"));
        }
        if (settings.get("autoReplyEnabled") && autoReply) {
          autoReply.start();
          console.log("[Main] AutoReply INICIADO (autoReplyEnabled=true)");
        } else {
          console.log("[Main] AutoReply NÃO iniciado (autoReplyEnabled=" + settings.get("autoReplyEnabled") + ")");
        }

        // Enviar settings para o renderer
        sendToViews("settings-loaded", settings.getAll());
        sendToViews("whats-status-update", { connected: true });
        sendToSidebar("whats-status-update", { connected: true });
      }
    } catch (e) { /* ignore */ }
  }, 3000);

  // 11. Zoom (como Anota AI: eventEmmiter zoom-in/zoom-out/reset-zoom)
  whatsappView.webContents.on("did-finish-load", () => {
    // Registrar zoom handlers uma vez
  });

  // 12. Fechar para tray
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // 13. Interceptar response headers — substituir por valores permissivos
  // Em vez de REMOVER headers (quebra Workers), SUBSTITUIR por valores abertos
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };

    // Substituir headers restritivos por versões permissivas
    // Isso permite que Web Workers façam importScripts cross-origin
    const overrides = {
      "cross-origin-opener-policy": "same-origin-allow-popups",
      "cross-origin-embedder-policy": "unsafe-none",
      "cross-origin-resource-policy": "cross-origin",
    };

    for (const [header, value] of Object.entries(overrides)) {
      // Remover qualquer variação de case
      for (const key of Object.keys(responseHeaders)) {
        if (key.toLowerCase() === header) {
          delete responseHeaders[key];
        }
      }
      // Definir o valor permissivo
      responseHeaders[header] = [value];
    }

    // Remover CSP e X-Frame-Options completamente
    for (const key of Object.keys(responseHeaders)) {
      const lower = key.toLowerCase();
      if (lower === "content-security-policy" || lower === "x-frame-options") {
        delete responseHeaders[key];
      }
    }

    callback({ responseHeaders });
  });

  // 15. Permissões de mídia
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  // 16. Tray + Shortcuts + Menu Nativo
  createTray();
  registerShortcuts();
  createNativeMenu();
}

// ====================================================================
// Login BrowserView — carrega https://anafood.vip/login
// ====================================================================
function createLoginView() {
  if (loginView) return; // já existe
  loginView = new BrowserView({
    webPreferences: {
      webSecurity: false,
      nodeIntegration: false,
      contextIsolation: false,
      preload: path.join(__dirname, "login-preload.js"),
    },
  });
  loginView.webContents.loadURL("https://anafood.vip/login");
  mainWindow.addBrowserView(loginView);
  // Bounds definidos por showView() — inicialmente zero
  loginView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  console.log("[Main] Login view criada: https://anafood.vip/login");
}

// ====================================================================
// Menu Nativo do Electron (como AnotaAI: Menu.buildFromTemplate)
// ====================================================================
function createNativeMenu() {
  // Todas as opções dentro de um único menu "Opções"
  const opcoesSubmenu = [
    {
      label: `Versão: ${app.getVersion()}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Whatsapp",
      submenu: [
        {
          label: "Recarregar WhatsApp",
          click() {
            if (whatsappView && !whatsappView.webContents.isDestroyed()) {
              apiInjected = false;
              whatsappView.webContents.reload();
            }
          },
        },
        {
          label: "Configurações",
          click() {
            showView('sistema');
          },
        },
      ],
    },
    {
      label: botEnabled ? "⏸ Pausar Robô" : "▶ Ativar Robô",
      click() {
        botEnabled = !botEnabled;
        if (botEnabled && autoReply) {
          autoReply.start();
          console.log("[Menu] Robô ATIVADO");
        } else if (!botEnabled && autoReply) {
          autoReply.stop();
          console.log("[Menu] Robô PAUSADO");
        }
        settings.update({ autoReplyEnabled: botEnabled });
        sendToViews("bot-status-changed", { enabled: botEnabled });
        sendToSidebar("bot-status-changed", { enabled: botEnabled });
        createNativeMenu();
      },
    },
    { type: "separator" },
    {
      label: "Zoom",
      submenu: [
        {
          label: "Aumentar",
          accelerator: "CommandOrControl+=",
          click() {
            if (whatsappView && !whatsappView.webContents.isDestroyed()) {
              const z = whatsappView.webContents.getZoomFactor();
              if (z < 2) whatsappView.webContents.setZoomFactor(z + 0.1);
            }
            if (systemView && !systemView.webContents.isDestroyed()) {
              const z = systemView.webContents.getZoomFactor();
              if (z < 2) systemView.webContents.setZoomFactor(z + 0.1);
            }
          },
        },
        {
          label: "Diminuir",
          accelerator: "CommandOrControl+-",
          click() {
            if (whatsappView && !whatsappView.webContents.isDestroyed()) {
              const z = whatsappView.webContents.getZoomFactor();
              if (z > 0.3) whatsappView.webContents.setZoomFactor(z - 0.1);
            }
            if (systemView && !systemView.webContents.isDestroyed()) {
              const z = systemView.webContents.getZoomFactor();
              if (z > 0.3) systemView.webContents.setZoomFactor(z - 0.1);
            }
          },
        },
        {
          label: "Resetar",
          accelerator: "CommandOrControl+0",
          click() {
            if (whatsappView && !whatsappView.webContents.isDestroyed()) whatsappView.webContents.setZoomFactor(1);
            if (systemView && !systemView.webContents.isDestroyed()) systemView.webContents.setZoomFactor(1);
          },
        },
      ],
    },
    {
      label: "Atualizar Gestor",
      click() {
        if (systemView && !systemView.webContents.isDestroyed()) systemView.webContents.reloadIgnoringCache();
        if (loginView && !loginView.webContents.isDestroyed()) loginView.webContents.reloadIgnoringCache();
        console.log("[Menu] Gestor atualizado");
      },
    },
    { type: "separator" },
    {
      label: "Reiniciar",
      click() {
        console.log("[Menu] Reiniciando aplicação...");
        app.relaunch();
        app.quit();
      },
    },
    {
      label: "Sair",
      click() {
        app.isQuitting = true;
        app.quit();
      },
    },
  ];

  // DevTools em modo dev
  if (process.argv.includes("--dev") || process.env.NODE_ENV === "development") {
    opcoesSubmenu.push(
      { type: "separator" },
      {
        label: "DevTools",
        submenu: [
          {
            label: "Inspecionar WhatsApp",
            click() { if (whatsappView) whatsappView.webContents.openDevTools({ mode: "detach" }); },
          },
          {
            label: "Inspecionar Sistema",
            click() { if (systemView) systemView.webContents.openDevTools({ mode: "detach" }); },
          },
          {
            label: "Inspecionar Login",
            click() { if (loginView) loginView.webContents.openDevTools({ mode: "detach" }); },
          },
          {
            label: "Inspecionar Janela Principal",
            click() { if (mainWindow) mainWindow.webContents.openDevTools({ mode: "detach" }); },
          },
          {
            label: "Limpar Cache",
            click() {
              session.defaultSession.clearStorageData();
              app.relaunch();
              app.quit();
            },
          },
        ],
      }
    );
  }

  const template = [
    {
      label: "Opções",
      submenu: opcoesSubmenu,
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  console.log("[Main] Menu nativo criado");
}

function destroyLoginView() {
  if (!loginView) return;
  try {
    mainWindow.removeBrowserView(loginView);
    loginView.webContents.destroy();
  } catch (e) {}
  loginView = null;
  console.log("[Main] Login view destruída");
}

// ====================================================================
// Titlebar BrowserView — sempre visível em cima de tudo
// ====================================================================
function createTitlebarView() {
  if (titlebarView) return; // já existe
  titlebarView = new BrowserView({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  titlebarView.webContents.loadFile(path.join(__dirname, "..", "renderer", "titlebar.html"));
  mainWindow.addBrowserView(titlebarView);
  mainWindow.setTopBrowserView(titlebarView);
  const [w] = mainWindow.getSize();
  titlebarView.setBounds({ x: 0, y: 0, width: w, height: configs.titlebarHeight });
  console.log("[Main] Titlebar view criada");
}

function resizeTitlebar() {
  if (!titlebarView || titlebarView.webContents.isDestroyed()) return;
  const [w] = mainWindow.getSize();
  titlebarView.setBounds({ x: 0, y: 0, width: w, height: configs.titlebarHeight });
  mainWindow.setTopBrowserView(titlebarView);
}

function destroyTitlebarView() {
  if (!titlebarView) return;
  try {
    mainWindow.removeBrowserView(titlebarView);
    titlebarView.webContents.destroy();
  } catch (e) {}
  titlebarView = null;
  console.log("[Main] Titlebar view destruída");
}

// ====================================================================
// Sidebar BrowserView — 3 ícones (conta, whatsapp, sistema)
// ====================================================================
function createSidebarView() {
  if (sidebarView) return;
  sidebarView = new BrowserView({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  sidebarView.webContents.loadFile(path.join(__dirname, "..", "renderer", "sidebar.html"));
  mainWindow.addBrowserView(sidebarView);
  const [, h] = mainWindow.getSize();
  sidebarView.setBounds({ x: 0, y: configs.titlebarHeight, width: configs.sidebarWidth, height: h - configs.titlebarHeight });
  console.log("[Main] Sidebar view criada");
}

// ====================================================================
// Bounds helpers
// ====================================================================
function getContentBounds() {
  // Bounds com offset da sidebar Electron (para conta e whatsapp standalone)
  const [w, h] = mainWindow.getSize();
  return {
    x: configs.sidebarWidth,
    y: configs.titlebarHeight,
    width: w - configs.sidebarWidth,
    height: h - configs.titlebarHeight,
  };
}

function getFullContentBounds() {
  // Bounds sem sidebar — usado para systemView (React cuida da própria nav)
  const [w, h] = mainWindow.getSize();
  return {
    x: 0,
    y: configs.titlebarHeight,
    width: w,
    height: h - configs.titlebarHeight,
  };
}

// ====================================================================
// showView — alterna qual view ocupa a área de conteúdo
// ====================================================================
function showView(name) {
  activeView = name;
  const [w, h] = mainWindow.getSize();
  const cb      = getContentBounds();
  const fullCb  = getFullContentBounds();
  const zero    = { x: 0, y: 0, width: 0, height: 0 };

  // Esconder todas as views de conteúdo
  if (loginView    && !loginView.webContents.isDestroyed())    loginView.setBounds(zero);
  if (whatsappView && !whatsappView.webContents.isDestroyed()) whatsappView.setBounds(zero);
  if (systemView   && !systemView.webContents.isDestroyed())   systemView.setBounds(zero);

  if (name === 'conta' && loginView && !loginView.webContents.isDestroyed()) {
    loginView.setBounds(cb);
  } else if (name === 'whatsapp' && whatsappView && !whatsappView.webContents.isDestroyed()) {
    whatsappView.setBounds(cb);
  } else if (name === 'sistema' && systemView && !systemView.webContents.isDestroyed()) {
    systemView.setBounds(cb);
  }

  // Sidebar Electron: sempre visível (logout acessível em todas as views)
  if (sidebarView && !sidebarView.webContents.isDestroyed()) {
    sidebarView.setBounds({ x: 0, y: configs.titlebarHeight, width: configs.sidebarWidth, height: h - configs.titlebarHeight });
    mainWindow.setTopBrowserView(sidebarView);
  }

  // Titlebar sempre no topo
  if (titlebarView && !titlebarView.webContents.isDestroyed()) {
    mainWindow.setTopBrowserView(titlebarView);
  }

  sendToSidebar('sidebar-set-active', name);
  console.log("[Main] showView:", name);
}

// ====================================================================
// resizeAllViews — redimensiona todas as views após resize da janela
// ====================================================================
function resizeAllViews() {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getSize();
  const cb      = getContentBounds();
  const fullCb  = getFullContentBounds();
  const zero    = { x: 0, y: 0, width: 0, height: 0 };

  if (titlebarView && !titlebarView.webContents.isDestroyed()) {
    titlebarView.setBounds({ x: 0, y: 0, width: w, height: configs.titlebarHeight });
  }

  // Sidebar sempre visível
  if (sidebarView && !sidebarView.webContents.isDestroyed()) {
    sidebarView.setBounds({ x: 0, y: configs.titlebarHeight, width: configs.sidebarWidth, height: h - configs.titlebarHeight });
  }

  if (loginView && !loginView.webContents.isDestroyed())
    loginView.setBounds(activeView === 'conta' ? cb : zero);
  if (systemView && !systemView.webContents.isDestroyed())
    systemView.setBounds(activeView === 'sistema' ? cb : zero);
  // whatsappView gerido por setBoundsIfValid()
}

// ====================================================================
// IPC helpers — broadcast para views relevantes
// ====================================================================
function sendToViews(channel, ...args) {
  if (systemView && !systemView.webContents.isDestroyed()) {
    systemView.webContents.send(channel, ...args);
  }
}

function sendToSidebar(channel, ...args) {
  if (sidebarView && !sidebarView.webContents.isDestroyed()) {
    sidebarView.webContents.send(channel, ...args);
  }
}

// IPC: Login recebido da página https://anafood.vip/login
// Payload: { userId, email, accessToken, refreshToken, companyId, companyName, role, supabaseUrl, supabaseAnonKey }
ipcMain.on("web-login-success", (event, data) => {
  console.log("[Main] Login web recebido:", data.email, "| Empresa:", data.companyName, "| Role:", data.role);

  settings.update({
    companyId: data.companyId || "",
    companyName: data.companyName || "",
    companyEmail: data.email || "",
    companyPhone: data.companyPhone || "",
    companyTenantId: data.companyId || "",
    companySubdomain: data.companySubdomain || "",
    userId: data.userId || "",
    userRole: data.role || "",
    accessToken: data.accessToken || "",
    refreshToken: data.refreshToken || "",
    supabaseUrl: data.supabaseUrl || "",
    supabaseAnonKey: data.supabaseAnonKey || "",
  });

  // Esconder login, mostrar sistema
  showView('sistema');

  if (autoReply) autoReply.settings = settings;
  setBoundsIfValid();

  sendToViews("merchant-logged-in", data);
  sendToSidebar("merchant-logged-in", data);

  // Atualizar menu com estado do robô
  botEnabled = settings.get("autoReplyEnabled") !== false;
  createNativeMenu();
});

// ====================================================================
// Set Bounds (como Anota AI: utils.setBounds — só se dimensões > 0)
// ====================================================================
function setBoundsIfValid() {
  if (!whatsappView || !mainWindow) return;

  // Sidebar clicou em WhatsApp → full content area
  if (activeView === 'whatsapp') {
    whatsappView.setBounds(getContentBounds());
    return;
  }

  // Fora da view sistema → esconder
  if (activeView !== 'sistema') {
    whatsappView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return;
  }

  // React app na rota /whatsapp controla os bounds via IPC
  const companyId = settings.get("companyId");
  if (!companyId || !whatsappActive) {
    whatsappView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return;
  }

  if (whatsappBounds && whatsappBounds.width > 0 && whatsappBounds.height > 0) {
    // systemView começa em x=sidebarWidth — adicionar offset ao x dos bounds
    whatsappView.setBounds({
      x: (whatsappBounds.x || 0) + configs.sidebarWidth,
      y: (whatsappBounds.y || 0) + configs.titlebarHeight,
      width: whatsappBounds.width,
      height: whatsappBounds.height,
    });
  }
}

// IPC Layout Overlay synchronization listeners
ipcMain.on("whatsapp-view-status", (event, { active }) => {
  whatsappActive = !!active;
  setBoundsIfValid();
});

ipcMain.on("whatsapp-view-bounds", (event, bounds) => {
  if (bounds) {
    whatsappBounds = bounds;
    setBoundsIfValid();
  }
});

ipcMain.on("sidebar-toggled", (event, nextState) => {
  sendToViews("sidebar-width-updated", nextState);
});

ipcMain.on("route-changed", (event, pathname) => {
  if (pathname !== "/whatsapp") {
    whatsappActive = false;
    setBoundsIfValid();
  } else {
    whatsappActive = true;
  }
});

// ====================================================================
// Tray
// ====================================================================
function createTray() {
  const iconPath = path.join(__dirname, "..", "renderer", "icons", "icon.png");
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Abrir Painel",
      click: () => { mainWindow.show(); mainWindow.focus(); },
    },
    {
      label: "Recarregar WhatsApp",
      click: () => { if (whatsappView) whatsappView.webContents.reload(); },
    },
    { type: "separator" },
    {
      label: "Reiniciar",
      click: () => { app.relaunch(); app.quit(); },
    },
    {
      label: "Sair",
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);

  tray.setToolTip("Ana Food Delivery");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.isVisible()
        ? mainWindow.isMinimized() ? mainWindow.restore() : null
        : mainWindow.show();
    }
  });
}

// ====================================================================
// API Injection (como Anota AI: injector.js + executeJavaScript)
// ====================================================================
async function injectAPI() {
  if (apiInjected || !whatsappView || whatsappView.webContents.isDestroyed()) return;

  try {
    const apiScript = fs.readFileSync(path.join(__dirname, "whatsapp-api-inject.js"), "utf-8");
    const result = await whatsappView.webContents.executeJavaScript(apiScript);
    console.log("[Main] API injection:", result);
    apiInjected = true;
  } catch (e) {
    console.error("[Main] API injection error:", e.message);
  }
}

// ====================================================================
// IPC: Extração de conversas
// ====================================================================
ipcMain.handle("extract-conversations", async (event, { limit }) => {
  if (!whatsappView || whatsappView.webContents.isDestroyed()) {
    return { success: false, error: "WhatsApp não conectado" };
  }

  try {
    await injectAPI();

    // Verificar se Store está pronto
    const storeOk = await whatsappView.webContents.executeJavaScript(
      "(window.__WPAPI && window.__WPAPI.isStoreReady())"
    );

    if (!storeOk) {
      return { success: false, error: "Store não disponível. Aguarde o WhatsApp carregar completamente." };
    }

    // Extrair lista de chats via Store (sem DOM, ignora grupos automaticamente)
    const chats = await whatsappView.webContents.executeJavaScript(
      `window.__WPAPI.getChatsFromStore(${limit})`
    );

    console.log(`[Main] Store: ${chats.length} chats individuais (limite: ${limit})`);

    if (!chats || chats.length === 0) {
      return { success: false, error: "Nenhuma conversa individual encontrada." };
    }

    const result = [];

    for (let i = 0; i < chats.length; i++) {
      try {
        const chat = chats[i];
        const safeChatId = JSON.stringify(chat.chatId);

        // Carregar mais mensagens via Store (equivalente a scroll up)
        await whatsappView.webContents.executeJavaScript(
          `window.__WPAPI.loadMoreMessages(${safeChatId})`
        );

        // Extrair mensagens via Store (sem abrir chat, sem clicar)
        const msgs = await whatsappView.webContents.executeJavaScript(
          `window.__WPAPI.getMessagesFromStore(${safeChatId}, 200)`
        );

        console.log(`[Main] Chat ${i} (${chat.name}): ${msgs.length} msgs via Store`);

        result.push({
          contact: chat.name,
          phone: chat.phone || "",
          chatId: chat.chatId,
          lastActivity: chat.lastActivity,
          messageCount: msgs.length,
          messages: msgs,
        });

        // Informar progresso
        sendToViews("extract-progress", { current: i + 1, total: chats.length, contact: chat.name });
      } catch (chatErr) {
        console.error(`[Main] Erro no chat ${i}:`, chatErr.message);
        continue;
      }
    }

    return { success: true, data: result, total: result.length };
  } catch (e) {
    console.error("[Main] Erro na extração:", e.message);
    return { success: false, error: e.message };
  }
});

// IPC: Exportar conversas para arquivo
ipcMain.handle("export-conversations", async (event, { data, format }) => {
  try {
    const ext = format === "csv" ? "csv" : "json";
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Exportar Conversas",
      defaultPath: `conversas_whatsapp_${Date.now()}.${ext}`,
      filters: [
        format === "csv"
          ? { name: "CSV", extensions: ["csv"] }
          : { name: "JSON", extensions: ["json"] },
      ],
    });

    if (!filePath) return { success: false, cancelled: true };

    let content;
    if (format === "csv") {
      // CSV
      const lines = ["Contato,Direção,Mensagem,Timestamp"];
      for (const chat of data) {
        for (const msg of chat.messages) {
          const text = msg.text.replace(/"/g, '""').replace(/\n/g, " ");
          lines.push(`"${chat.contact}","${msg.direction}","${text}","${msg.timestamp}"`);
        }
      }
      content = lines.join("\n");
    } else {
      content = JSON.stringify(data, null, 2);
    }

    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`[Main] Exportado: ${filePath} (${data.length} conversas)`);
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ====================================================================
// IPC: Settings
// ====================================================================
ipcMain.handle("get-settings", () => {
  return settings.getAll();
});

ipcMain.handle("sync-merchant-session", async (event, sessionData) => {
  try {
    console.log("[Main] Sincronizando sessão do lojista:", sessionData);
    settings.update({
      companyId: sessionData.companyId,
      companyName: sessionData.companyName,
      companyEmail: sessionData.companyEmail,
      companyPhone: sessionData.companyPhone,
      companyTenantId: sessionData.companyId,
      companySubdomain: sessionData.companySubdomain || "",
    });
    
    // Update auto-reply agent's settings reference if it exists
    if (autoReply) {
      autoReply.settings = settings;
    }

    // Refresh WhatsApp view bounds
    setBoundsIfValid();

    return { success: true };
  } catch (err) {
    console.error("[Main] Erro ao sincronizar sessão:", err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("save-settings", (event, newSettings) => {
  settings.update(newSettings);
  console.log("[Main] Settings atualizadas");

  // Atualizar estado do auto-reply
  if (newSettings.autoReplyEnabled !== undefined) {
    if (newSettings.autoReplyEnabled && autoReply) {
      autoReply.start();
    } else if (!newSettings.autoReplyEnabled && autoReply) {
      autoReply.stop();
    }
  }

  return { success: true };
});

// ====================================================================
// IPC: Merchant Login / Logout
// ====================================================================
ipcMain.handle("login-merchant", async (event, { email, password, companyId }) => {
  try {
    let company = null;
    if (email && password) {
      console.log(`[Main] Tentando login para email: ${email}`);
      const authData = await db.loginUser(email, password);
      if (!authData || !authData.user) {
        throw new Error("Erro de autenticação: resposta de login inválida");
      }
      const ownerId = authData.user.id;
      console.log(`[Main] Autenticado no Supabase com sucesso. Owner ID: ${ownerId}. Buscando empresa correspondente...`);
      company = await db.getCompanyByOwner(ownerId);
      if (!company) {
        throw new Error("Nenhuma empresa vinculada a esta conta de proprietário no Supabase.");
      }
    } else if (companyId) {
      console.log(`[Main] Buscando empresa diretamente pelo ID: ${companyId}`);
      company = await db.getCompanyById(companyId);
      if (!company) {
        throw new Error("Empresa não encontrada com o ID fornecido.");
      }
    } else {
      throw new Error("Por favor, preencha o e-mail e senha ou digite um ID de empresa válido.");
    }

    // Salvar configurações no settings.json local
    settings.update({
      companyId: company.id,
      companyName: company.fantasy_name || company.name || "Sem Nome",
      companyEmail: company.email || email || "",
      companyPhone: company.whatsapp || company.phone || "",
      companyTenantId: company.id,
      companySubdomain: company.subdomain || "",
    });

    console.log(`[Main] Lojista logado com sucesso: ${company.name || company.subdomain} (ID: ${company.id})`);

    // Atualizar bounds do WhatsApp Web para mostrá-lo na tela
    setBoundsIfValid();

    return { success: true, company };
  } catch (err) {
    console.error("[Main] Erro no login do lojista:", err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("logout-merchant", async () => {
  console.log("[Main] Deslogando lojista...");
  settings.update({
    companyId: "",
    companyName: "",
    companyEmail: "",
    companyPhone: "",
    companyTenantId: "",
    companySubdomain: "",
  });

  if (autoReply) autoReply.stop();
  showView('conta');
  sendToSidebar("merchant-logged-out");

  return { success: true };
});

// IPC: Navegação pela sidebar Electron
ipcMain.on("sidebar-nav", (event, viewName) => {
  showView(viewName);
});

// IPC: Logout disparado pelo botão da sidebar
ipcMain.on("logout-merchant-from-sidebar", async () => {
  settings.update({
    companyId: "",
    companyName: "",
    companyEmail: "",
    companyPhone: "",
    companyTenantId: "",
    companySubdomain: "",
  });
  if (autoReply) autoReply.stop();
  sendToViews("merchant-logged-out");
  sendToSidebar("merchant-logged-out");
  showView('conta');
});

ipcMain.handle("get-printers", async () => {
  if (!mainWindow) return [];
  try {
    return await mainWindow.webContents.getPrintersAsync();
  } catch (e) {
    console.error("[Main] Erro ao buscar impressoras:", e);
    return [];
  }
});

// IPC: Verificar status do agente Ana Food Print (VPS)
ipcMain.handle("get-print-agent-status", async () => {
  try {
    const companyId = settings.get("companyId");
    const authToken = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!companyId || !authToken) {
      return { connected: false, devices: [], error: "Empresa não configurada" };
    }
    const status = await vpsPrintService.checkPrintAgentStatus(authToken, companyId);
    return status;
  } catch (e) {
    console.error("[Main] Erro ao verificar agente de impressão:", e.message);
    return { connected: false, devices: [], error: e.message };
  }
});

// IPC: Enviar job de impressão de teste
ipcMain.handle("test-print", async (event, { printerName }) => {
  if (!mainWindow) return { success: false, error: "Janela não disponível" };
  try {
    const printService = require("./print-service");
    const companyId = settings.get("companyId");
    const testOrder = {
      orderId: 'TEST-' + Date.now(),
      items: [{ tipo: 'marmita', tamanho: 'Grande', quantity: 1, proteinas: [{name:'Frango'}], acompanhamentos: [{name:'Arroz'}, {name:'Feijão'}], saladas: [] }],
      type: 'delivery',
      deliveryFee: 5,
      total: 27,
      paymentMethod: 'Pix',
      phone: '99999999999',
      address: 'Rua Teste, 123'
    };
    const company = {
      name: settings.get("companyName") || 'Ana Food',
      address: '',
      phone: settings.get("companyPhone") || ''
    };
    await printService.printOrder(testOrder, company, 'Teste de Impressão', printerName || '');
    console.log('[Main] Impressão de teste enviada com sucesso');
    return { success: true };
  } catch (e) {
    console.error('[Main] Erro na impressão de teste:', e.message);
    return { success: false, error: e.message };
  }
});

// ====================================================================
// IPC: Auto-Reply control
// ====================================================================
ipcMain.on("whats-status", (event, status) => {
  console.log("[Main] WhatsApp status:", status.connected ? "CONNECTED" : "DISCONNECTED");
  sendToViews("whats-status-update", status);
  sendToSidebar("whats-status-update", status);

  if (status.connected) {
    if (!autoReply && whatsappView) {
      autoReply = new AutoReplyAgent(whatsappView, settings);
      autoReply.init(app.getPath("userData"));
    }
    if (settings.get("autoReplyEnabled") && autoReply) {
      autoReply.start();
    }
    sendToViews("settings-loaded", settings.getAll());
  } else {
    if (autoReply) autoReply.stop();
  }

  // Auto-teste
  if (status.connected && process.env.AUTO_TEST === "1") {
    runAutoTest();
  }

  // Diagnóstico automático
  if (status.connected && process.env.RUN_DIAG === "1") {
    runDiagnostic();
  }
});

// ====================================================================
// IPC: Basic controls
// ====================================================================
ipcMain.on("minimize", () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on("maximize", () => {
  if (mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on("close", () => { if (mainWindow) mainWindow.hide(); });
ipcMain.on("reload-whatsapp", () => {
  if (whatsappView) { apiInjected = false; whatsappView.webContents.reload(); }
});
ipcMain.on("clear-whatsapp-session", async () => {
  try {
    await session.defaultSession.clearStorageData();
    await session.defaultSession.clearCache();
    apiInjected = false;
    if (autoReply) autoReply.stop();
    console.log("[Main] Session cleared");
    if (whatsappView) whatsappView.webContents.loadURL(configs.whatsappUrl);
  } catch (e) {
    console.error("[Main] Error clearing session:", e);
  }
});
ipcMain.on("zoom-in", () => {
  if (whatsappView) { const z = whatsappView.webContents.getZoomFactor(); if (z < 2) whatsappView.webContents.setZoomFactor(z + 0.1); }
});
ipcMain.on("zoom-out", () => {
  if (whatsappView) { const z = whatsappView.webContents.getZoomFactor(); if (z > 0.3) whatsappView.webContents.setZoomFactor(z - 0.1); }
});
ipcMain.on("reset-zoom", () => { if (whatsappView) whatsappView.webContents.setZoomFactor(1); });

// IPC: Obter lista de clientes registrados
ipcMain.handle("get-clients", () => {
  if (autoReply && autoReply.clients) {
    return { success: true, data: autoReply.clients };
  }
  // Tentar carregar do arquivo
  try {
    const clientsPath = path.join(app.getPath("userData"), "clients.json");
    if (fs.existsSync(clientsPath)) {
      return { success: true, data: JSON.parse(fs.readFileSync(clientsPath, "utf-8")) };
    }
  } catch (e) {}
  return { success: true, data: {} };
});

// Modal: esconder/mostrar BrowserView para que o modal fique visível
ipcMain.on("modal-open", () => {
  if (whatsappView && mainWindow) {
    // Mover a BrowserView para fora da tela (não remover, para manter sessão)
    whatsappView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
  // NÃO pausar auto-reply — Store funciona com view oculta
});
ipcMain.on("modal-close", () => {
  setBoundsIfValid();
});

// ====================================================================
// Diagnostic (RUN_DIAG=1)
// ====================================================================
async function runDiagnostic() {
  if (!whatsappView || whatsappView.webContents.isDestroyed()) return;
  const outFile = path.join(__dirname, "..", "..", "diagnostic-results.json");
  const r = {};
  const save = () => fs.writeFileSync(outFile, JSON.stringify(r, null, 2), "utf-8");

  try {
    console.log("[DIAG] Starting...");
    await new Promise(res => setTimeout(res, 3000));

    // Step 1: sidebar
    r.sidebar = await whatsappView.webContents.executeJavaScript(`(function(){
      const rows = document.querySelectorAll('#pane-side [role="row"]');
      const info = { total: rows.length, chats: [] };
      let c = 0;
      for (const row of rows) {
        if (c >= 3) break;
        const t = row.querySelector('span[title]');
        const isG = !!row.querySelector('[data-icon="group"]')||!!row.querySelector('[data-icon="community"]')||!!row.querySelector('[data-icon="default-group"]');
        if (isG) continue;
        info.chats.push({ name: t?t.getAttribute('title'):'?', icons: Array.from(row.querySelectorAll('[data-icon]')).map(e=>e.getAttribute('data-icon')) });
        c++;
      }
      return info;
    })()`);
    save(); console.log("[DIAG] Step 1:", r.sidebar.total, "rows");

    // Step 2: click first individual chat
    r.click = await whatsappView.webContents.executeJavaScript(`(function(){
      const rows = document.querySelectorAll('#pane-side [role="row"]');
      for (const row of rows) {
        const isG = !!row.querySelector('[data-icon="group"]')||!!row.querySelector('[data-icon="community"]')||!!row.querySelector('[data-icon="default-group"]');
        if (isG) continue;
        const t = row.querySelector('span[title]');
        row.click();
        return { clicked: true, name: t?t.getAttribute('title'):'?' };
      }
      return { clicked: false };
    })()`);
    save(); console.log("[DIAG] Step 2:", r.click);

    await new Promise(res => setTimeout(res, 3000));

    // Step 3: analyze #main
    r.main = await whatsappView.webContents.executeJavaScript(`(function(){
      const m = document.querySelector('#main');
      if (!m) return { exists: false };
      const h = m.querySelector('header');
      const ht = h?(h.querySelector('span[title]')||h.querySelector('span[dir="auto"]')):null;
      return {
        exists: true,
        header: !!h,
        headerTitle: ht?ht.textContent:null,
        msgIn: m.querySelectorAll('.message-in').length,
        msgOut: m.querySelectorAll('.message-out').length,
        dataId: m.querySelectorAll('[data-id]').length,
        selectableText: m.querySelectorAll('.selectable-text').length,
        prePlainText: m.querySelectorAll('[data-pre-plain-text]').length,
        focusable: m.querySelectorAll('.focusable-list-item').length,
        rowsInMain: m.querySelectorAll('[role="row"]').length,
      };
    })()`);
    save(); console.log("[DIAG] Step 3:", JSON.stringify(r.main));

    // Step 4: message samples
    r.msgSamples = await whatsappView.webContents.executeJavaScript(`(function(){
      const m = document.querySelector('#main');
      if (!m) return [];
      const msgs = m.querySelectorAll('.message-in, .message-out');
      const samples = [];
      for (let i = 0; i < Math.min(5, msgs.length); i++) {
        const el = msgs[i];
        const txt = el.querySelector('.selectable-text');
        const ppt = el.querySelector('[data-pre-plain-text]');
        samples.push({
          isOut: el.classList.contains('message-out'),
          text: txt?txt.textContent.substring(0,150):'',
          prePlainText: ppt?ppt.getAttribute('data-pre-plain-text'):'',
          classes: el.className.substring(0,120),
          parentDataId: el.closest('[data-id]')?el.closest('[data-id]').getAttribute('data-id'):'',
        });
      }
      return samples;
    })()`);
    save(); console.log("[DIAG] Step 4:", r.msgSamples.length, "samples");

    // Step 5: find scroll container and scroll up
    r.scroll = await whatsappView.webContents.executeJavaScript(`(function(){
      const m = document.querySelector('#main');
      if (!m) return { error: 'no main' };
      let sc = null;
      for (const div of m.querySelectorAll('div')) {
        const s = window.getComputedStyle(div);
        if ((s.overflowY==='auto'||s.overflowY==='scroll')&&div.scrollHeight>div.clientHeight+50) { sc=div; break; }
      }
      if (!sc) return { error: 'no scrollable' };
      return {
        scrollHeight: sc.scrollHeight,
        clientHeight: sc.clientHeight,
        scrollTop: sc.scrollTop,
        role: sc.getAttribute('role'),
        classes: sc.className.substring(0,80),
      };
    })()`);
    save(); console.log("[DIAG] Step 5:", JSON.stringify(r.scroll));

    // Step 6: scroll up 5 times & measure message count
    r.scrollTest = await whatsappView.webContents.executeJavaScript(`(async function(){
      const m = document.querySelector('#main');
      if (!m) return { error: 'no main' };
      let sc = null;
      for (const div of m.querySelectorAll('div')) {
        const s = window.getComputedStyle(div);
        if ((s.overflowY==='auto'||s.overflowY==='scroll')&&div.scrollHeight>div.clientHeight+50) { sc=div; break; }
      }
      if (!sc) return { error: 'no scrollable' };
      const snaps = [];
      for (let i = 0; i < 5; i++) {
        sc.scrollTop = 0;
        await new Promise(r=>setTimeout(r,2000));
        const c = m.querySelectorAll('.message-in,.message-out').length || m.querySelectorAll('[data-id]').length;
        snaps.push({ i, msgs: c, scrollH: sc.scrollHeight });
      }
      return snaps;
    })()`);
    save(); console.log("[DIAG] Step 6:", JSON.stringify(r.scrollTest));

    // Step 7: textbox check
    r.textbox = await whatsappView.webContents.executeJavaScript(`(function(){
      const sels = ['#main footer [role="textbox"]','#main [contenteditable="true"]','footer [role="textbox"]','[role="textbox"]'];
      const res = {};
      for (const s of sels) { const e = document.querySelector(s); res[s]=e?{tag:e.tagName,role:e.getAttribute('role')}:null; }
      return res;
    })()`);
    save(); console.log("[DIAG] Step 7:", JSON.stringify(r.textbox));

    console.log("[DIAG] DONE! File:", outFile);
  } catch(e) {
    console.error("[DIAG] ERROR:", e.message);
    r.error = e.message;
    save();
  }
}

// ====================================================================
// Auto Test (AUTO_TEST=1)
// ====================================================================
function runAutoTest() {
  console.log("[Main] Iniciando auto-teste...");
  if (whatsappView && !whatsappView.webContents.isDestroyed()) {
    whatsappView.webContents.send("test-dom-manipulation");
  }
}

// ====================================================================
// Keyboard Shortcuts
// ====================================================================
function registerShortcuts() {
  mainWindow.on("focus", () => {
    globalShortcut.register("CommandOrControl+=", () => ipcMain.emit("zoom-in"));
    globalShortcut.register("CommandOrControl+-", () => ipcMain.emit("zoom-out"));
    globalShortcut.register("CommandOrControl+0", () => ipcMain.emit("reset-zoom"));
    globalShortcut.register("CommandOrControl+R", () => {
      if (whatsappView) whatsappView.webContents.reload();
    });
    globalShortcut.register("CommandOrControl+Shift+I", () => {
      if (whatsappView) whatsappView.webContents.toggleDevTools();
    });
    globalShortcut.register("CommandOrControl+Shift+D", () => {
      console.log("[Main] Running diagnostic via shortcut...");
      runDiagnostic();
    });
  });
  mainWindow.on("blur", () => globalShortcut.unregisterAll());
}

// ====================================================================
// App Lifecycle
// ====================================================================
app.on("before-quit", () => { app.isQuitting = true; });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("activate", () => {
  if (mainWindow === null) createWindow();
  else mainWindow.show();
});
