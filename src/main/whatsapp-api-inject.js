// ============================================================
// WhatsApp Store API — Injetado via executeJavaScript
// Usa módulos internos do WhatsApp Web (mesma abordagem do Anota AI)
// Store.Msg.on("add") para detectar + Store.SendTextMsgChatAction para enviar
// ============================================================

(function () {
  if (window.__storeInjected) return "ALREADY_INJECTED";
  window.__storeInjected = true;

  // Fila de mensagens recebidas (consumida pelo auto-reply via polling)
  window.__newMessageQueue = window.__newMessageQueue || [];

  // ================================================================
  // STEP 1: Injetar Store (módulos internos do WhatsApp Web)
  // Mesma técnica do Anota AI: window.require() para novo Store
  // ================================================================
  let storeReady = false;

  function injectStore() {
    try {
      if (typeof window.require !== "function") {
        console.warn("[WPAPI] window.require não disponível ainda — tentando moduleRaid...");
        return injectStoreViaModuleRaid();
      }

      console.log("[WPAPI] Tentando injetar Store via window.require()...");

      window.Store = Object.assign({}, window.require("WAWebCollections"));

      // DEBUG: verificar o que WAWebCollections retornou
      var storeKeys = Object.keys(window.Store);
      console.log("[WPAPI] WAWebCollections keys (" + storeKeys.length + "):", storeKeys.slice(0, 15).join(", "));
      console.log("[WPAPI] Store.Msg existe:", !!window.Store.Msg, "| Store.Chat existe:", !!window.Store.Chat);

      if (!window.Store.Msg) {
        console.error("[WPAPI] CRÍTICO: Store.Msg não existe em WAWebCollections!");
        console.log("[WPAPI] Todas as keys:", storeKeys.join(", "));
        return false;
      }

      // Verificar se Store.Msg tem .on()
      if (typeof window.Store.Msg.on !== "function") {
        console.error("[WPAPI] CRÍTICO: Store.Msg.on() não é uma função! Tipo:", typeof window.Store.Msg.on);
        console.log("[WPAPI] Store.Msg keys:", Object.keys(window.Store.Msg).slice(0, 20).join(", "));
        console.log("[WPAPI] Store.Msg proto:", Object.getOwnPropertyNames(Object.getPrototypeOf(window.Store.Msg)).slice(0, 20).join(", "));
        return false;
      }

      window.Store.AppState = window.require("WAWebSocketModel")?.Socket;
      window.Store.Cmd = window.require("WAWebCmd")?.Cmd;
      window.Store.SendTextMsgChatAction = window.require("WAWebSendTextMsgChatAction");
      window.Store.SendMessage = window.require("WAWebSendMsgChatAction");
      window.Store.ChatState = window.require("WAWebChatStateBridge");
      window.Store.SendSeen = window.require("WAWebUpdateUnreadChatAction");
      window.Store.WidFactory = window.require("WAWebWidFactory");
      window.Store.User = window.require("WAWebUserPrefsMeUser");
      window.Store.MsgKey = window.require("WAWebMsgKey");
      window.Store.FindOrCreateChat = window.require("WAWebFindChatAction");
      window.Store.EphemeralFields = window.require("WAWebGetEphemeralFieldsMsgActionsUtils");
      window.Store.ContactMethods = {
        ...window.require("WAWebContactGetters"),
        ...window.require("WAWebFrontendContactGetters"),
      };
      window.Store.QueryExist = window.require("WAWebQueryExistsJob")?.queryWidExists;
      window.Store.LidUtils = window.require("WAWebApiContact");

      // DEBUG: verificar módulos críticos
      console.log("[WPAPI] SendTextMsgChatAction:", !!window.Store.SendTextMsgChatAction);
      console.log("[WPAPI] ChatState:", !!window.Store.ChatState);
      console.log("[WPAPI] WidFactory:", !!window.Store.WidFactory);
      console.log("[WPAPI] Cmd:", !!window.Store.Cmd);

      // Garantir Chat.find funciona
      if (!window.Store.Chat._find && !window.Store.Chat.findImpl) {
        window.Store.Chat._find = function(e) {
          var t = window.Store.Chat.get(e);
          return t ? Promise.resolve(t) : Promise.resolve({ id: e });
        };
        window.Store.Chat.findImpl = window.Store.Chat._find;
      }

      storeReady = true;
      console.log("[WPAPI] ✓ Store injetado com sucesso via require()");
      return true;
    } catch (e) {
      console.error("[WPAPI] Erro ao injetar Store via require():", e.message);
      console.log("[WPAPI] Tentando fallback moduleRaid...");
      return injectStoreViaModuleRaid();
    }
  }

  // ================================================================
  // Fallback: moduleRaid (como Anota AI para versões antigas)
  // Busca módulos via webpack chunks
  // ================================================================
  function injectStoreViaModuleRaid() {
    try {
      var mID = Math.random().toString(36).substring(7);
      var mObj = {};
      var chunkName = window.webpackChunkbuild || window.webpackChunkwhatsapp_web_client;
      if (!chunkName) {
        console.warn("[WPAPI] Webpack chunks não encontrados — moduleRaid falhou");
        return false;
      }

      console.log("[WPAPI] moduleRaid: buscando módulos via webpack...");

      chunkName.push([[mID], {}, function(e) {
        Object.keys(e.m).forEach(function(t) {
          try { mObj[t] = e(t); } catch(err) {}
        });
      }]);

      // Buscar módulo com Msg e Chat
      var collections = null;
      for (var key in mObj) {
        var mod = mObj[key];
        if (mod && mod.Msg && mod.Chat && typeof mod.Msg.on === "function") {
          collections = mod;
          break;
        }
        if (mod && mod.default && mod.default.Msg && mod.default.Chat) {
          collections = mod.default;
          break;
        }
      }

      if (!collections) {
        console.warn("[WPAPI] moduleRaid: Msg/Chat não encontrados");
        return false;
      }

      window.Store = Object.assign({}, collections);
      console.log("[WPAPI] moduleRaid: Store.Msg encontrado! Keys:", Object.keys(window.Store).slice(0, 15).join(", "));

      // Buscar módulos adicionais
      for (var k in mObj) {
        var m = mObj[k];
        if (!m) continue;
        if (m.sendTextMsgToChat && !window.Store.SendTextMsgChatAction) {
          window.Store.SendTextMsgChatAction = m;
        }
        if (m.sendChatStateComposing && !window.Store.ChatState) {
          window.Store.ChatState = m;
        }
        if (m.createWid && !window.Store.WidFactory) {
          window.Store.WidFactory = m;
        }
        if (m.Cmd && m.Cmd.openChatBottom && !window.Store.Cmd) {
          window.Store.Cmd = m.Cmd;
        }
        if (m.sendSeen && !window.Store.SendSeen) {
          window.Store.SendSeen = m;
        }
      }

      storeReady = true;
      console.log("[WPAPI] ✓ Store injetado via moduleRaid (fallback)");
      return true;
    } catch (e) {
      console.error("[WPAPI] moduleRaid falhou:", e.message);
      return false;
    }
  }

  // ================================================================
  // STEP 2: Listener de novas mensagens via Store.Msg.on("add")
  // Mesma técnica do Anota AI: escuta msgs novas no modelo interno
  // ================================================================
  // Processar uma mensagem e adicionar à fila (chamado pelo listener ou pelo handler de ciphertext)
  function processIncomingMessage(msg) {
    try {
      var type = msg.type;

      // Ignorar notificações do sistema
      var ignoredTypes = ["e2e_notification", "notification_template", "notification", "gp2", "protocol", "revoked"];
      if (ignoredTypes.includes(type)) {
        console.log("[WPAPI] Ignorado (tipo sistema):", type);
        return;
      }

      // Extrair chatId (tratar LID — WhatsApp novo usa Linked Identity)
      var from = typeof msg.from === "object" ? msg.from._serialized : msg.from;
      var to = typeof msg.to === "object" ? msg.to._serialized : msg.to;
      var phone = "";

      // Conversão de LID para número real (como Anota AI)
      if (msg.from && msg.from.server === "lid") {
        console.log("[WPAPI] Mensagem via LID:", from);
        // Tentar obter número real via remote
        var remote = msg.id && msg.id.remote;
        if (remote) {
          var remoteSerialized = typeof remote === "object" ? remote._serialized : remote;
          // Se remote contém @c.us ou @s.whatsapp.net, é o número real
          if (remoteSerialized && (remoteSerialized.includes("@c.us") || remoteSerialized.includes("@s.whatsapp.net"))) {
            phone = remoteSerialized.replace(/@.+/, "");
            console.log("[WPAPI] Telefone real extraído do remote:", phone);
          }
        }
        // Tentar via participante
        if (!phone && msg.author) {
          var author = typeof msg.author === "object" ? msg.author._serialized : msg.author;
          if (author && (author.includes("@c.us") || author.includes("@s.whatsapp.net"))) {
            phone = author.replace(/@.+/, "");
          }
        }
      } else if (from && (from.includes("@c.us") || from.includes("@s.whatsapp.net"))) {
        phone = from.replace(/@.+/, "");
      }

      var isGroup = !!(from && from.includes("@g.us")) || !!(to && to.includes("@g.us"));
      var isStatus = msg.isStatusV3 || (msg.id && msg.id.remote === "status@broadcast");
      var isBroadcast = !!msg.broadcast;

      // Ignorar grupos, status e broadcasts
      if (isGroup) { console.log("[WPAPI] Ignorado (grupo):", from); return; }
      if (isStatus) { console.log("[WPAPI] Ignorado (status)"); return; }
      if (isBroadcast) { console.log("[WPAPI] Ignorado (broadcast)"); return; }

      // Só processar tipos relevantes
      var validTypes = ["chat", "image", "ptt", "video", "document", "audio", "location", "sticker"];
      if (!validTypes.includes(type)) {
        console.log("[WPAPI] Ignorado (tipo não suportado):", type);
        return;
      }

      var body = msg.body || msg.caption || "";
      var name = msg.notifyName || "";
      var chatId = from;

      // Evitar duplicatas na fila
      var msgId = msg.id._serialized || msg.id.id;
      if (window.__newMessageQueue.some(function(m) { return m.msgId === msgId; })) {
        console.log("[WPAPI] Duplicata ignorada:", msgId);
        return;
      }

      console.log("[WPAPI] ★ NOVA MSG RECEBIDA:", name, "(" + chatId + ") tel=" + phone + " tipo=" + type + ":", body.substring(0, 80));

      window.__newMessageQueue.push({
        msgId: msgId,
        chatId: chatId,
        name: name,
        phone: phone,
        body: body.substring(0, 2000),
        type: type,
        timestamp: msg.t || Math.floor(Date.now() / 1000),
        isGroup: isGroup,
      });

      console.log("[WPAPI] Fila atual:", window.__newMessageQueue.length, "mensagens");
    } catch (e) {
      console.error("[WPAPI] Erro ao processar msg:", e.message, e.stack);
    }
  }

  function setupMessageListener() {
    if (!storeReady || !window.Store || !window.Store.Msg) {
      console.warn("[WPAPI] Store.Msg não disponível para listener");
      // DEBUG: verificar o que existe no Store
      console.log("[WPAPI] DEBUG Store existe:", !!window.Store);
      if (window.Store) {
        console.log("[WPAPI] DEBUG Store.Msg existe:", !!window.Store.Msg);
        console.log("[WPAPI] DEBUG Store.Chat existe:", !!window.Store.Chat);
        console.log("[WPAPI] DEBUG Store keys:", Object.keys(window.Store).slice(0, 20).join(", "));
      }
      return false;
    }

    // Remover listener anterior se existir
    if (window.__wpMsgListener) {
      try { window.Store.Msg.off("add", window.__wpMsgListener); } catch (e) {}
    }

    // DEBUG: verificar se Msg tem o método .on()
    console.log("[WPAPI] DEBUG Store.Msg tipo:", typeof window.Store.Msg);
    console.log("[WPAPI] DEBUG Store.Msg.on existe:", typeof window.Store.Msg.on);
    console.log("[WPAPI] DEBUG Store.Msg.length:", window.Store.Msg.length || window.Store.Msg.getLength?.() || "N/A");

    window.__wpMsgListener = function (msg) {
      try {
        console.log("[WPAPI] ► Msg.on('add') disparou! isNewMsg=" + msg.isNewMsg +
          " fromMe=" + (msg.id && msg.id.fromMe) +
          " type=" + msg.type +
          " from=" + (msg.from ? (typeof msg.from === "object" ? msg.from._serialized : msg.from) : "null"));

        // Só processar mensagens novas recebidas (não enviadas por nós)
        if (!msg.isNewMsg) {
          console.log("[WPAPI] Ignorado (não é nova)");
          return;
        }
        if (msg.id && msg.id.fromMe) {
          console.log("[WPAPI] Ignorado (fromMe)");
          return;
        }

        var type = msg.type;

        // ★ CRÍTICO (como Anota AI): mensagens chegam como "ciphertext" antes da descriptografia
        // Precisamos esperar o tipo mudar após descriptografia
        if (type === "ciphertext") {
          console.log("[WPAPI] Ciphertext detectado — aguardando descriptografia...");
          msg.once("change:type", function(decryptedMsg) {
            console.log("[WPAPI] Ciphertext descriptografado → tipo:", decryptedMsg.type);
            processIncomingMessage(decryptedMsg);
          });
          return;
        }

        processIncomingMessage(msg);
      } catch (e) {
        console.error("[WPAPI] Erro no msg listener:", e.message, e.stack);
      }
    };

    window.Store.Msg.on("add", window.__wpMsgListener);
    console.log("[WPAPI] ✓ Listener Store.Msg.on('add') ATIVO — aguardando mensagens...");

    // DEBUG: Verificar se o listener foi registrado
    try {
      var listenerCount = window.Store.Msg._events ?
        (window.Store.Msg._events.add ? window.Store.Msg._events.add.length || 1 : 0) : "N/A";
      console.log("[WPAPI] DEBUG listeners 'add' registrados:", listenerCount);
    } catch (e) {}

    return true;
  }

  // ================================================================
  // STEP 3: Funções helper
  // ================================================================

  // Obter chat pelo ID (usando Store)
  async function getChatByIdStore(chatId) {
    if (!storeReady) return null;
    try {
      var wid = window.Store.WidFactory.createWid(chatId);
      var chat = window.Store.Chat.get(wid);
      if (!chat) {
        var result = await window.Store.FindOrCreateChat.findOrCreateLatestChat(wid);
        chat = result ? result.chat : null;
      }
      return chat;
    } catch (e) {
      console.error("[WPAPI] getChatById erro:", e.message);
      return null;
    }
  }

  // Enviar typing state (como Anota AI)
  async function sendTypingState(chatId) {
    if (!storeReady) return;
    try {
      await window.Store.ChatState.sendChatStateComposing(
        window.Store.WidFactory.createWid(chatId)
      );
    } catch (e) {
      console.warn("[WPAPI] Typing state erro:", e.message);
    }
  }

  // Limpar typing state
  async function clearTypingState(chatId) {
    if (!storeReady) return;
    try {
      await window.Store.ChatState.sendChatStatePaused(
        window.Store.WidFactory.createWid(chatId)
      );
    } catch (e) { /* ignorar */ }
  }

  // Enviar "visto" (seen) — como Anota AI
  async function sendSeen(chatId) {
    if (!storeReady) return;
    try {
      var chat = await getChatByIdStore(chatId);
      if (chat) {
        await window.Store.SendSeen.sendSeen({ chat: chat, afterAvailable: false });
      }
    } catch (e) {
      console.warn("[WPAPI] sendSeen erro:", e.message);
    }
  }

  // Simular clique real (fallback para DOM)
  function realClick(el) {
    var rect = el.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  }

  // ================================================================
  // STEP 4: API pública consumida pelo auto-reply
  // ================================================================
  window.__WPAPI = {

    // Verificar se Store está pronto
    isStoreReady: function () { return storeReady; },

    // Verificar conexão
    isConnected: function () {
      if (storeReady && window.Store.AppState) {
        try { return window.Store.AppState.state === "CONNECTED"; } catch (e) {}
      }
      return !!document.querySelector("#pane-side");
    },

    // Inicializar Store (chamado após WhatsApp carregar)
    initStore: function () {
      if (storeReady) {
        // Verificar se listener está realmente ativo
        var hasListener = !!window.__wpMsgListener;
        console.log("[WPAPI] initStore: Store já injetado, listener=" + hasListener);
        if (!hasListener) {
          console.log("[WPAPI] initStore: Re-configurando listener...");
          setupMessageListener();
        }
        return { success: true, message: "Store já injetado" };
      }
      var ok = injectStore();
      if (ok) {
        var listenerOk = setupMessageListener();
        console.log("[WPAPI] initStore: Store injetado, listener=" + listenerOk);
        return { success: true, message: "Store injetado + listener ativo" };
      }
      return { success: false, message: "Falha ao injetar Store" };
    },

    // Enviar mensagem via Store (como Anota AI)
    sendMessage: async function (chatId, text) {
      if (!storeReady) return { success: false, error: "Store não injetado" };
      try {
        var chat = await getChatByIdStore(chatId);
        if (!chat) return { success: false, error: "Chat não encontrado: " + chatId };

        // 1. Marcar como visto (sendSeen)
        await sendSeen(chatId);

        // 2. Typing state (como Anota AI)
        await sendTypingState(chatId);

        // 3. Delay proporcional ao tamanho da mensagem (comportamento humano)
        var typingDelay = Math.min(2000 + text.length * 50, 6000);
        await new Promise(function(r) { setTimeout(r, typingDelay); });

        // 4. Enviar mensagem via Store.SendTextMsgChatAction (mesmo método do Anota AI)
        await window.Store.SendTextMsgChatAction.sendTextMsgToChat(chat, text);

        // 5. Limpar typing state
        await clearTypingState(chatId);

        console.log("[WPAPI] Mensagem enviada via Store para:", chatId);
        return { success: true, method: "store" };
      } catch (e) {
        console.error("[WPAPI] sendMessage Store erro:", e.message, "- tentando fallback DOM");
        // Fallback: tentar via DOM se Store falhar
        try {
          await clearTypingState(chatId);
        } catch (e2) {}
        return await window.__WPAPI.sendMessageDOM(text);
      }
    },

    // Fallback: enviar via manipulação DOM (caso Store falhe)
    sendMessageDOM: function (text) {
      return new Promise(function(resolve) {
        try {
          var textbox = document.querySelector('#main footer [role="textbox"]') ||
                        document.querySelector('#main [contenteditable="true"]') ||
                        document.querySelector('[data-testid="conversation-compose-box-input"]');
          if (!textbox) return resolve({ success: false, error: "Textbox não encontrado" });

          textbox.focus();
          textbox.textContent = "";
          textbox.innerHTML = "";

          var inserted = false;
          try { inserted = document.execCommand("insertText", false, text); } catch (e) {}

          if (!inserted || textbox.textContent.trim() === "") {
            var dt = new DataTransfer();
            dt.setData("text/plain", text);
            textbox.dispatchEvent(new ClipboardEvent("paste", {
              bubbles: true, cancelable: true, clipboardData: dt,
            }));
          }

          setTimeout(function() {
            if (textbox.textContent.trim() === "") {
              return resolve({ success: false, error: "Texto não inserido" });
            }
            var sendBtn = document.querySelector('[data-testid="send"]') ||
                          document.querySelector('#main footer span[data-icon="send"]');
            if (sendBtn) {
              var btn = sendBtn.closest("button") || sendBtn;
              realClick(btn);
              setTimeout(function() { resolve({ success: true, method: "dom-button" }); }, 500);
            } else {
              var enterOpts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
              textbox.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
              textbox.dispatchEvent(new KeyboardEvent("keypress", enterOpts));
              textbox.dispatchEvent(new KeyboardEvent("keyup", enterOpts));
              setTimeout(function() { resolve({ success: true, method: "dom-enter" }); }, 500);
            }
          }, 500);
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    },

    // Abrir chat pelo chatId via Store (como Anota AI: openChatWindow)
    openChat: async function (chatId) {
      if (!storeReady) return false;
      try {
        var chat = await getChatByIdStore(chatId);
        if (!chat) return false;
        await window.Store.Cmd.openChatBottom({ chat: chat, chatEntryPoint: undefined });
        return true;
      } catch (e) {
        console.error("[WPAPI] openChat erro:", e.message);
        return false;
      }
    },

    // Extrair lista de conversas do sidebar (sem grupos)
    getChatsFromDOM: function (limit) {
      var rows = document.querySelectorAll('#pane-side [role="row"]');
      var chats = [];
      var count = 0;
      for (var i = 0; i < rows.length; i++) {
        if (count >= limit) break;
        var row = rows[i];
        var titleEl = row.querySelector("span[title]");
        if (!titleEl) continue;
        var isGroup = !!row.querySelector('[data-icon="group"]') ||
                      !!row.querySelector('[data-icon="community"]') ||
                      !!row.querySelector('[data-icon="default-group"]');
        if (isGroup) continue;
        var name = titleEl.getAttribute("title") || titleEl.textContent;
        var timeDiv = row.querySelector("div > div > div:last-child > div:first-child");
        chats.push({ name: name, time: timeDiv ? timeDiv.textContent.trim() : "", index: count, rowIndex: i });
        count++;
      }
      return chats;
    },

    // Clicar em conversa pelo ÍNDICE na lista filtrada
    clickChat: function (index) {
      var chats = window.__WPAPI.getChatsFromDOM(index + 1);
      if (!chats || index >= chats.length) return false;
      var chat = chats[index];
      return window.__WPAPI.clickChatByName(chat.name);
    },

    // Clicar em conversa pelo NOME (fallback DOM)
    clickChatByName: function (targetName) {
      var rows = document.querySelectorAll('#pane-side [role="row"]');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var isGroup = !!row.querySelector('[data-icon="group"]') ||
                      !!row.querySelector('[data-icon="community"]') ||
                      !!row.querySelector('[data-icon="default-group"]');
        if (isGroup) continue;
        var titleEl = row.querySelector("span[title]");
        if (!titleEl) continue;
        var name = titleEl.getAttribute("title") || titleEl.textContent;
        if (name === targetName) {
          var cell = row.querySelector('[role="gridcell"]') || row.querySelector("a") || row;
          realClick(cell);
          return true;
        }
      }
      return false;
    },

    // Esperar até chat abrir
    waitForChatOpen: function (timeoutMs) {
      return new Promise(function(resolve) {
        var start = Date.now();
        var check = function() {
          var h = document.querySelector("#main header span[title]");
          if (h) return resolve(true);
          if (Date.now() - start > (timeoutMs || 8000)) return resolve(false);
          setTimeout(check, 300);
        };
        check();
      });
    },

    // Info da conversa aberta
    getOpenChatInfo: function () {
      var header = document.querySelector("#main header");
      if (!header) return null;
      var nameEl = header.querySelector("span[title]") || header.querySelector('span[dir="auto"]');
      var name = nameEl ? nameEl.getAttribute("title") || nameEl.textContent : "Desconhecido";
      var isGroup = !!header.querySelector('[data-icon="group"]') ||
                    !!header.querySelector('[data-icon="community"]') ||
                    !!header.querySelector('[data-icon="default-group"]');
      var spans = header.querySelectorAll("span");
      var subText = "";
      for (var i = 0; i < spans.length; i++) subText += spans[i].textContent + " ";
      var isGroupByText = /participante|member|participant/i.test(subText);
      return { name: name, isGroup: isGroup || isGroupByText };
    },

    // Scrollar lista de conversas (sidebar)
    scrollChatList: function (times) {
      return new Promise(function(resolve) {
        var panel = document.querySelector("#pane-side");
        if (!panel) return resolve(false);
        var count = 0;
        var iv = setInterval(function() {
          panel.scrollTop += panel.clientHeight;
          count++;
          if (count >= times) { clearInterval(iv); setTimeout(function() { resolve(true); }, 1000); }
        }, 500);
      });
    },

    // Extrair mensagens visíveis do DOM
    getMessagesFromOpenChat: function () {
      var main = document.querySelector("#main");
      if (!main) return [];
      var messages = [];
      var msgEls = main.querySelectorAll(".message-in, .message-out");
      for (var i = 0; i < msgEls.length; i++) {
        var el = msgEls[i];
        var dataId = el.closest("[data-id]");
        var id = dataId ? dataId.getAttribute("data-id") : null;
        var isOut = el.classList.contains("message-out");
        var textEl = el.querySelector(".selectable-text") || el.querySelector("span[dir]");
        var text = textEl ? textEl.textContent : "";
        var ppt = el.querySelector("[data-pre-plain-text]");
        var timestamp = ppt ? ppt.getAttribute("data-pre-plain-text") : "";
        if (text || timestamp) {
          messages.push({ id: id, direction: isOut ? "sent" : "received", text: text.substring(0, 1000), timestamp: timestamp });
        }
      }
      return messages;
    },

    // FULL HISTORY: Scroll up para carregar mensagens
    getFullChatHistory: function (maxScrolls) {
      return new Promise(async function(resolve) {
        var main = document.querySelector("#main");
        if (!main) return resolve({ messages: [], scrolled: 0 });

        // Encontrar scroll container
        var sc = null;
        var divs = main.querySelectorAll("div");
        for (var i = 0; i < divs.length; i++) {
          var s = window.getComputedStyle(divs[i]);
          if ((s.overflowY === "auto" || s.overflowY === "scroll") && divs[i].scrollHeight > divs[i].clientHeight + 50) {
            sc = divs[i]; break;
          }
        }
        if (!sc) return resolve({ messages: window.__WPAPI.getMessagesFromOpenChat(), scrolled: 0 });

        var allMessages = new Map();
        var scrollCount = 0;
        var prevScrollH = 0;
        var noChangeCount = 0;
        var maxS = maxScrolls || 50;

        // Capturar mensagens atuais
        var current = window.__WPAPI.getMessagesFromOpenChat();
        for (var j = 0; j < current.length; j++) {
          var m = current[j];
          allMessages.set(m.id || (m.text + m.timestamp), m);
        }

        while (scrollCount < maxS && noChangeCount < 3) {
          sc.scrollTop = 0;
          await new Promise(function(r) { setTimeout(r, 1500); });
          var newMsgs = window.__WPAPI.getMessagesFromOpenChat();
          var addedNew = false;
          for (var k = 0; k < newMsgs.length; k++) {
            var nm = newMsgs[k];
            var key = nm.id || (nm.text + nm.timestamp);
            if (!allMessages.has(key)) { allMessages.set(key, nm); addedNew = true; }
          }
          if (sc.scrollHeight === prevScrollH && !addedNew) noChangeCount++;
          else noChangeCount = 0;
          prevScrollH = sc.scrollHeight;
          scrollCount++;
        }

        sc.scrollTop = sc.scrollHeight;
        resolve({ messages: Array.from(allMessages.values()), scrolled: scrollCount, total: allMessages.size });
      });
    },

    // ================================================================
    // STORE-BASED EXTRACTION: Extrair chats e mensagens sem DOM
    // Funciona mesmo com BrowserView escondida
    // ================================================================

    // Listar todos os chats individuais via Store (ignora grupos)
    getChatsFromStore: function (limit) {
      if (!storeReady || !window.Store || !window.Store.Chat) return [];
      try {
        var chats = [];
        var all = window.Store.Chat.getModelsArray();
        for (var i = 0; i < all.length && chats.length < limit; i++) {
          var c = all[i];
          if (!c || !c.id) continue;
          var id = c.id._serialized || c.id.toString();

          // Ignorar grupos, status, broadcasts
          if (id.includes("@g.us")) continue;
          if (id.includes("@broadcast")) continue;
          if (id === "status@broadcast") continue;
          if (c.isGroup) continue;

          var name = c.name || c.formattedTitle || c.contact?.pushname || c.contact?.name || id;
          var phone = "";
          if (id.includes("@c.us")) phone = id.replace("@c.us", "");
          else if (id.includes("@s.whatsapp.net")) phone = id.replace("@s.whatsapp.net", "");

          var lastMsgTime = "";
          try { lastMsgTime = c.t ? new Date(c.t * 1000).toISOString() : ""; } catch(e) {}

          var unreadCount = c.unreadCount || 0;

          chats.push({
            chatId: id,
            name: name,
            phone: phone,
            lastActivity: lastMsgTime,
            unreadCount: unreadCount,
            muteExpiration: c.muteExpiration || 0,
          });
        }
        console.log("[WPAPI] getChatsFromStore: " + chats.length + " chats individuais (de " + all.length + " totais)");
        return chats;
      } catch (e) {
        console.error("[WPAPI] getChatsFromStore erro:", e.message);
        return [];
      }
    },

    // Extrair mensagens de um chat específico via Store (sem abrir/clicar)
    getMessagesFromStore: function (chatId, maxMessages) {
      if (!storeReady || !window.Store || !window.Store.Chat) return [];
      try {
        var max = maxMessages || 100;
        var wid = window.Store.WidFactory.createWid(chatId);
        var chat = window.Store.Chat.get(wid);
        if (!chat) {
          console.log("[WPAPI] getMessagesFromStore: chat não encontrado:", chatId);
          return [];
        }

        // Acessar coleção de mensagens do chat
        var msgCollection = chat.msgs;
        if (!msgCollection) {
          console.log("[WPAPI] getMessagesFromStore: sem msgs para:", chatId);
          return [];
        }

        var models = msgCollection.getModelsArray ? msgCollection.getModelsArray() : [];
        var messages = [];

        for (var i = Math.max(0, models.length - max); i < models.length; i++) {
          var m = models[i];
          if (!m) continue;

          var type = m.type;
          // Pular msgs de sistema
          if (type === "e2e_notification" || type === "notification_template" ||
              type === "notification" || type === "gp2" || type === "protocol") continue;

          var text = m.body || m.caption || "";
          var direction = m.id && m.id.fromMe ? "sent" : "received";
          var timestamp = "";
          try { timestamp = m.t ? new Date(m.t * 1000).toISOString() : ""; } catch(e) {}

          messages.push({
            id: m.id ? (m.id._serialized || m.id.id) : null,
            direction: direction,
            text: text.substring(0, 2000),
            type: type,
            timestamp: timestamp,
          });
        }

        return messages;
      } catch (e) {
        console.error("[WPAPI] getMessagesFromStore erro:", e.message);
        return [];
      }
    },

    // Carregar mais mensagens de um chat via Store (loadEarlierMsgs)
    loadMoreMessages: async function (chatId) {
      if (!storeReady) return false;
      try {
        var wid = window.Store.WidFactory.createWid(chatId);
        var chat = window.Store.Chat.get(wid);
        if (!chat || !chat.msgs) return false;
        await chat.msgs.loadEarlierMsgs();
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  // ================================================================
  // STEP 5: Tentar injetar Store imediatamente
  // Se falhar, retry a cada 2s (WhatsApp pode não ter carregado ainda)
  // ================================================================
  var storeRetries = 0;
  var maxRetries = 30; // 60 segundos máximo

  function tryInjectStore() {
    if (storeReady) return;
    console.log("[WPAPI] Tentativa " + (storeRetries + 1) + "/" + maxRetries + " de injetar Store...");
    if (injectStore()) {
      var listenerOk = setupMessageListener();
      console.log("[WPAPI] ✓ Store pronto após " + storeRetries + " tentativas, listener=" + listenerOk);
    } else {
      storeRetries++;
      if (storeRetries < maxRetries) {
        setTimeout(tryInjectStore, 2000);
      } else {
        console.warn("[WPAPI] ✗ Store não injetado após " + maxRetries + " tentativas — usando DOM fallback");
      }
    }
  }

  tryInjectStore();

  return "INJECTED_OK";
})();
