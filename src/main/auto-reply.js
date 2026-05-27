// ============================================================
// Auto-Reply Agent — Responde automaticamente novas conversas
// Usa Store API (WhatsApp Web interno): Store.Msg.on("add")
// Captura de mensagens: 100% local via BrowserView injetada
// Impressão: via servidor VPS (api.anafood.vip) + fallback local
// Armazena dados dos clientes em clients.json
// ============================================================
const fs = require("fs");
const path = require("path");
const stateMachine = require("../chatbot/stateMachine");
const stateManager = require("../chatbot/stateManager");
const db = require("../chatbot/database");
const templates = require("../chatbot/templates");
const axios = require("axios");
const vpsPrintService = require("./vps-print-service");

class AutoReplyAgent {
  constructor(whatsappView, settings) {
    this.whatsappView = whatsappView;
    this.settings = settings;
    this.running = false;
    this.paused = false;
    this.processing = false;
    this.pollInterval = null;
    this.reinjectInterval = null;
    this.storeInitInterval = null;
    this.clientsFilePath = null;
    this.clients = {}; // chatId -> { name, phone, chatId, firstContact, lastContact, messagesReceived }
  }

  pause() { this.paused = true; console.log("[AutoReply] Pausado (modal aberto)"); }
  resume() { this.paused = false; console.log("[AutoReply] Retomado (modal fechou)"); }

  init(userDataPath) {
    this.clientsFilePath = path.join(userDataPath, "clients.json");
    this.loadClients();
  }

  // ================================================================
  // Base de clientes: armazena nome, telefone, preferências
  // ================================================================
  loadClients() {
    try {
      if (this.clientsFilePath && fs.existsSync(this.clientsFilePath)) {
        this.clients = JSON.parse(fs.readFileSync(this.clientsFilePath, "utf-8"));
        console.log(`[AutoReply] Clientes carregados: ${Object.keys(this.clients).length}`);
      }
    } catch (e) {
      this.clients = {};
    }
  }

  saveClients() {
    try {
      if (this.clientsFilePath) {
        const dir = path.dirname(this.clientsFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.clientsFilePath, JSON.stringify(this.clients, null, 2), "utf-8");
      }
    } catch (e) {
      console.error("[AutoReply] Erro ao salvar clientes:", e.message);
    }
  }

  // Registrar/atualizar dados do cliente
  registerClient(msg) {
    const chatId = msg.chatId;
    const now = new Date().toISOString();

    // Extrair número de telefone: preferir msg.phone (extraído do Store), senão do chatId
    let phone = msg.phone || "";
    if (!phone && chatId && chatId.includes("@c.us")) {
      phone = chatId.replace("@c.us", "");
    } else if (!phone && chatId && chatId.includes("@s.whatsapp.net")) {
      phone = chatId.replace("@s.whatsapp.net", "");
    }

    if (!this.clients[chatId]) {
      // Novo cliente
      this.clients[chatId] = {
        name: msg.name || "",
        phone: phone,
        chatId: chatId,
        firstContact: now,
        lastContact: now,
        messagesReceived: 1,
        lastMessage: (msg.body || "").substring(0, 200),
      };
      console.log(`[AutoReply] Novo cliente registrado: ${msg.name} (${phone || chatId})`);
    } else {
      // Atualizar cliente existente
      this.clients[chatId].lastContact = now;
      this.clients[chatId].messagesReceived = (this.clients[chatId].messagesReceived || 0) + 1;
      this.clients[chatId].lastMessage = (msg.body || "").substring(0, 200);
      if (msg.name) this.clients[chatId].name = msg.name;
      if (phone && !this.clients[chatId].phone) this.clients[chatId].phone = phone;
    }

    this.saveClients();
    return this.clients[chatId];
  }

  // ================================================================
  // Start/Stop
  // ================================================================
  start() {
    if (this.running) {
      console.log("[AutoReply] Já rodando — forçando re-injeção");
      this.startListening();
      return;
    }
    this.running = true;
    console.log("[AutoReply] Agente iniciado");
    this.startListening();
  }

  stop() {
    this.running = false;
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    if (this.reinjectInterval) { clearInterval(this.reinjectInterval); this.reinjectInterval = null; }
    if (this.storeInitInterval) { clearInterval(this.storeInitInterval); this.storeInitInterval = null; }
    console.log("[AutoReply] Agente parado");
  }

  // ================================================================
  // Injetar API e inicializar Store
  // ================================================================
  async ensureAPIInjected() {
    if (!this.whatsappView || this.whatsappView.webContents.isDestroyed()) return;
    try {
      const exists = await this.whatsappView.webContents.executeJavaScript(
        "(typeof window.__WPAPI !== 'undefined' && typeof window.__WPAPI.sendMessage === 'function')"
      );
      if (!exists) {
        console.log("[AutoReply] __WPAPI ausente — re-injetando...");
        const apiScript = fs.readFileSync(path.join(__dirname, "whatsapp-api-inject.js"), "utf-8");
        const result = await this.whatsappView.webContents.executeJavaScript(apiScript);
        console.log("[AutoReply] __WPAPI re-injetado:", result);
      }
    } catch (e) {
      console.error("[AutoReply] Erro ao garantir __WPAPI:", e.message);
    }
  }

  async tryInitStore() {
    if (!this.whatsappView || this.whatsappView.webContents.isDestroyed()) return;
    try {
      const result = await this.whatsappView.webContents.executeJavaScript(
        `(function(){
          if(!window.__WPAPI) return 'NO_API';
          if(window.__WPAPI.isStoreReady()) {
            var hasListener = !!window.__wpMsgListener;
            var queueLen = (window.__newMessageQueue || []).length;
            return 'READY|listener=' + hasListener + '|queue=' + queueLen;
          }
          var r = window.__WPAPI.initStore();
          return r.message;
        })()`
      );
      if (result.startsWith("READY")) {
        console.log("[AutoReply] Store:", result);
        if (this.storeInitInterval) {
          clearInterval(this.storeInitInterval);
          this.storeInitInterval = null;
        }
      } else {
        console.log("[AutoReply] Store não pronto:", result);
      }
    } catch (e) {
      console.error("[AutoReply] tryInitStore erro:", e.message);
    }
  }

  // ================================================================
  // Listener: Store.Msg.on("add") popula __newMessageQueue
  // Auto-reply consome essa fila via polling
  // ================================================================
  async startListening() {
    if (!this.whatsappView || this.whatsappView.webContents.isDestroyed()) return;

    // Limpar intervals existentes
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    if (this.reinjectInterval) { clearInterval(this.reinjectInterval); this.reinjectInterval = null; }
    if (this.storeInitInterval) { clearInterval(this.storeInitInterval); this.storeInitInterval = null; }

    // Garantir API injetada
    await this.ensureAPIInjected();

    // Tentar inicializar Store
    await this.tryInitStore();

    // Retry Store init a cada 5s (caso WhatsApp ainda esteja carregando)
    this.storeInitInterval = setInterval(() => this.tryInitStore(), 5000);

    // Polling: consumir fila de mensagens a cada 3s
    this.pollInterval = setInterval(() => this.processQueue(), 3000);

    // Re-injetar API/Store a cada 30s se morreu
    this.reinjectInterval = setInterval(async () => {
      if (!this.running || !this.whatsappView || this.whatsappView.webContents.isDestroyed()) return;
      try {
        const alive = await this.whatsappView.webContents.executeJavaScript(
          "(typeof window.__WPAPI !== 'undefined' && typeof window.__WPAPI.isConnected === 'function')"
        );
        if (!alive) {
          console.log("[AutoReply] API morreu — re-injetando...");
          await this.ensureAPIInjected();
          await this.tryInitStore();
        }
      } catch (e) { /* ignore */ }
    }, 30000);

    console.log("[AutoReply] Listening ativo (Store.Msg.on + polling)");
  }

  // ================================================================
  // Processar fila de mensagens (populada pelo Store.Msg.on("add"))
  // ================================================================
  async processQueue() {
    if (!this.running || !this.settings.get("autoReplyEnabled")) return;
    if (this.paused || this.processing) return;
    if (!this.whatsappView || this.whatsappView.webContents.isDestroyed()) return;

    const companyId = this.settings.get("companyId");
    if (!companyId) {
      // Ignorar se não houver lojista logado no painel
      return;
    }

    this.processing = true;

    try {
      // Consumir fila do __newMessageQueue (populada pelo Store listener)
      const queue = await this.whatsappView.webContents.executeJavaScript(
        `(function(){
          var q = window.__newMessageQueue || [];
          window.__newMessageQueue = [];
          if (q.length > 0) console.log('[WPAPI] Entregando ' + q.length + ' msgs para auto-reply');
          return JSON.parse(JSON.stringify(q));
        })()`
      );
      if (!queue || queue.length === 0) {
        this.processing = false;
        return;
      }

      console.log(`[AutoReply] Fila: ${queue.length} novas mensagens:`, queue.map(m => m.name || m.chatId).join(", "));

      for (const msg of queue) {
        if (this.paused) {
          // Devolver mensagens não processadas
          const remaining = queue.slice(queue.indexOf(msg));
          if (remaining.length > 0) {
            await this.whatsappView.webContents.executeJavaScript(
              `(function(){ window.__newMessageQueue = (window.__newMessageQueue || []).concat(${JSON.stringify(remaining)}); })()`
            );
          }
          break;
        }

        // Ignorar grupos (dupla verificação)
        if (msg.isGroup) {
          console.log(`[AutoReply] Grupo ignorado: ${msg.name || msg.chatId}`);
          continue;
        }

        // Registrar dados do cliente localmente
        const clientInfo = this.registerClient(msg);
        
        // ─── LÓGICA DO CHATBOT INTEGRADO ───
        const phone = msg.phone || msg.chatId;
        const cleanPhone = phone.replace('@s.whatsapp.net', '').replace('@c.us', '');
        
        console.log(`[AutoReply] Processando chatbot para: ${msg.name} (${cleanPhone}) | texto: "${msg.body}"`);

        // 1. Carregar perfil da empresa (com cache local)
        let company = null;
        try {
          const cacheKey = `company_profile:${companyId}`;
          const cachedCompany = await stateManager.cacheGet(cacheKey);
          if (cachedCompany) {
            company = cachedCompany;
          } else {
            company = await db.getCompanyById(companyId);
            if (company) {
              await stateManager.cacheSet(cacheKey, company);
            }
          }
        } catch (e) {
          console.error("[AutoReply] Erro ao buscar empresa do banco:", e.message);
        }

        if (!company) {
          company = {
            id: companyId,
            name: this.settings.get("companyName"),
            fantasy_name: this.settings.get("companyName"),
            whatsapp: this.settings.get("companyPhone"),
            email: this.settings.get("companyEmail"),
            subdomain: this.settings.get("companySubdomain"),
            business_type: 'marmitaria'
          };
        }

        // 2. Carregar estado da conversa
        let state = await stateManager.getState(companyId, cleanPhone);

        // 3. Processar no motor determinístico do chatbot
        let resultado;
        try {
          resultado = await stateMachine.process(companyId, cleanPhone, msg.body, state, company);
        } catch (err) {
          console.error("[AutoReply] Erro ao processar na stateMachine:", err.message, err.stack);
          await this.sendRawReply(msg.chatId, templates.erroComunicacao(), msg.name);
          continue;
        }

        const newState = resultado.state;
        const response = resultado.response;

        // 4. Salvar estado atualizado na memória local
        await stateManager.setState(companyId, cleanPhone, newState);

        // 5. Enviar respostas geradas
        if (response) {
          const responses = Array.isArray(response) ? response : [response];
          
          // Delay configurável antes de responder (simulação de digitação)
          const baseDelay = this.settings.get("autoReplyDelay") || 3000;
          const randomExtra = Math.floor(Math.random() * 2000);
          await new Promise(r => setTimeout(r, baseDelay + randomExtra));

          for (const resp of responses) {
            if (!resp) continue;
            if (this.paused) break;

            const sent = await this.sendRawReply(msg.chatId, resp, msg.name);
            if (sent) {
              console.log(`[AutoReply] ✓ Resposta enviada para ${msg.name}: "${resp.substring(0, 40)}..."`);
            } else {
              console.log(`[AutoReply] ✗ Falha ao enviar para ${msg.name}`);
            }

            if (responses.length > 1) {
              await new Promise(r => setTimeout(r, 1500));
            }
          }
        }

        // 6. Se o pedido foi FINALIZADO, disparar o fluxo de gravação e impressão
        if (newState.etapa === 'FINALIZADO') {
          // Salva no banco de dados Supabase e imprime silenciosamente
          await this.handleFinishedOrder(companyId, cleanPhone, msg.name, newState.pedidoAtual, company);
          
          // Agendar a limpeza do estado após 5 minutos
          setTimeout(() => {
            stateManager.resetState(companyId, cleanPhone).catch(() => {});
            console.log(`[AutoReply] Sessão finalizada limpa para: ${msg.name} (${cleanPhone})`);
          }, 5 * 60 * 1000);
        }
      }
    } catch (e) {
      console.error("[AutoReply] Erro:", e.message, e.stack);
    } finally {
      this.processing = false;
    }
  }

  // ================================================================
  // Enviar resposta genérica via Store com fallback DOM
  // ================================================================
  async sendRawReply(chatId, message, name) {
    if (!message) return false;

    try {
      await this.ensureAPIInjected();

      const safeMsg = JSON.stringify(message);
      const safeChatId = JSON.stringify(chatId);

      // Verificar se Store está pronto
      const storeReady = await this.whatsappView.webContents.executeJavaScript(
        "(window.__WPAPI && window.__WPAPI.isStoreReady())"
      );

      if (storeReady) {
        // ====== VIA STORE (como Anota AI) ======
        console.log(`[AutoReply] Enviando via Store para: ${name}`);
        const result = await this.whatsappView.webContents.executeJavaScript(
          `window.__WPAPI.sendMessage(${safeChatId}, ${safeMsg})`
        );

        if (result && result.success) {
          console.log(`[AutoReply] ✓ Store: ${name} (método: ${result.method})`);
          return true;
        } else {
          console.log(`[AutoReply] ✗ Store falhou: ${result ? result.error : "sem resultado"} — tentando DOM fallback`);
        }
      }

      // ====== FALLBACK DOM (se Store não disponível) ======
      console.log(`[AutoReply] Fallback DOM para: ${name}`);

      // 1. Abrir chat via Store ou DOM
      let opened = false;
      if (storeReady) {
        opened = await this.whatsappView.webContents.executeJavaScript(
          `window.__WPAPI.openChat(${safeChatId})`
        );
      }
      if (!opened) {
        // Fallback: clicar pelo nome
        const safeName = JSON.stringify(name);
        await this.whatsappView.webContents.executeJavaScript(
          `window.__WPAPI.clickChatByName(${safeName})`
        );
      }

      // 2. Esperar chat abrir
      if (this.paused) return false;
      const chatOpened = await this.whatsappView.webContents.executeJavaScript(
        `window.__WPAPI.waitForChatOpen(10000)`
      );
      if (!chatOpened) return false;

      // 3. Verificar grupo
      if (this.paused) return false;
      const info = await this.whatsappView.webContents.executeJavaScript(
        `window.__WPAPI.getOpenChatInfo()`
      );
      if (!info || info.isGroup) return false;

      // 4. Enviar via DOM fallback
      if (this.paused) return false;
      const domResult = await this.whatsappView.webContents.executeJavaScript(
        `window.__WPAPI.sendMessageDOM(${safeMsg})`
      );

      if (domResult && domResult.success) {
        console.log(`[AutoReply] ✓ DOM: ${name} (método: ${domResult.method})`);
        return true;
      }

      console.log(`[AutoReply] ✗ DOM falhou: ${domResult ? domResult.error : "sem resultado"}`);
      return false;
    } catch (e) {
      console.error(`[AutoReply] Erro ao enviar para ${name}:`, e.message);
      return false;
    }
  }

  // Compatibilidade com código legado que chama sendReply
  async sendReply(msg) {
    const message = this.settings.get("autoReplyMessage");
    if (!message) return false;
    return this.sendRawReply(msg.chatId, message, msg.name);
  }

  // ================================================================
  // Fluxo de Finalização de Pedido: Gravação no Supabase e Impressão
  // ================================================================
  async handleFinishedOrder(companyId, customerPhone, customerName, pedidoAtual, company) {
    try {
      console.log(`[AutoReply] Finalizando pedido para ${customerName} (${customerPhone}). Salvando no banco de dados Supabase...`);

      // 1. Garantir que o cliente existe na tabela customers
      let customerId = null;
      try {
        const cleanPhone = customerPhone.replace('@s.whatsapp.net', '').replace('@c.us', '');
        const resCustomer = await db.saveCustomer(companyId, cleanPhone, customerName);
        if (resCustomer && resCustomer.length > 0) {
          customerId = resCustomer[0].id;
        } else {
          // Tentar buscar por telefone caso o upsert não retorne
          const existing = await db.getCustomerByPhone(companyId, cleanPhone);
          if (existing) {
            customerId = existing.id;
          }
        }
      } catch (err) {
        console.error("[AutoReply] Erro ao salvar/buscar cliente no Supabase:", err.message);
      }

      // 2. Calcular totais do pedido
      const subtotal = templates.calcTotal(pedidoAtual.items, 0);
      const taxaEntrega = pedidoAtual.type === 'delivery' ? (pedidoAtual.deliveryFee || 5.00) : 0;
      const total = subtotal + taxaEntrega;

      // Mapear método de pagamento para os enumeradores do Supabase
      let formaPagamento = 'pix';
      const methodLower = (pedidoAtual.paymentMethod || '').toLowerCase();
      if (methodLower.includes('dinheiro')) {
        formaPagamento = 'dinheiro';
      } else if (methodLower.includes('cartao') || methodLower.includes('cartão') || methodLower.includes('credito') || methodLower.includes('debito') || methodLower.includes('crédito') || methodLower.includes('débito')) {
        formaPagamento = 'credito';
      } else if (methodLower.includes('vale') || methodLower.includes('refeicao')) {
        formaPagamento = 'vale';
      }

      // 3. Inserir na tabela pedidos do Supabase via Axios REST
      const supaUrl = process.env.SUPABASE_URL;
      const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      const pedidoInsert = {
        tenant_id: companyId,
        tipo: pedidoAtual.type === 'delivery' ? 'delivery' : 'retirada',
        status: 'novo',
        cliente_id: customerId,
        subtotal: subtotal,
        taxa_entrega: taxaEntrega,
        desconto: 0,
        total: total,
        forma_pagamento: formaPagamento,
        troco_para: formaPagamento === 'dinheiro' && pedidoAtual.trocoPara ? parseFloat(pedidoAtual.trocoPara) : null,
        observacao: `Endereço: ${pedidoAtual.address || 'N/A'}\nObservação: Pedido gerado via assistente de WhatsApp.`,
        origem: 'bot',
        created_at: new Date().toISOString()
      };

      console.log("[AutoReply] Inserindo pedido no Supabase:", JSON.stringify(pedidoInsert));
      const resPedido = await axios.post(`${supaUrl}/rest/v1/pedidos`, pedidoInsert, {
        headers: {
          'apikey': supaKey,
          'Authorization': `Bearer ${supaKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        }
      });

      const pedidoSalvo = resPedido.data && resPedido.data.length > 0 ? resPedido.data[0] : null;
      if (!pedidoSalvo) {
        throw new Error("Erro ao salvar pedido no Supabase: resposta vazia.");
      }

      console.log(`[AutoReply] Pedido salvo com sucesso! ID: ${pedidoSalvo.id}. Salvando itens...`);

      // 4. Inserir itens na tabela itens_pedido
      const products = await db.getProducts(companyId);
      const itensInsert = [];

      for (const item of pedidoAtual.items) {
        let produtoId = null;
        const itemName = item.tipo === 'marmita' ? `Marmita ${item.tamanho}` : (item.name || '');
        const matchedProduct = products.find(p => p.name.toLowerCase() === itemName.toLowerCase());
        if (matchedProduct) {
          produtoId = matchedProduct.id;
        }

        const unitPrice = item.price || (item.tamanho === 'Grande' ? 22 : 20);

        let obsItem = '';
        if (item.tipo === 'marmita') {
          const proteinas = (item.proteinas || []).map(p => p.name).join(', ');
          const acomps = (item.acompanhamentos || []).map(a => a.name).join(', ');
          const saladas = (item.saladas || []).map(s => s.name).join(', ');
          obsItem = `Proteínas: ${proteinas} | Acomp: ${acomps}`;
          if (saladas) obsItem += ` | Salada: ${saladas}`;
        }

        itensInsert.push({
          pedido_id: pedidoSalvo.id,
          produto_id: produtoId,
          nome_snapshot: itemName,
          preco_snapshot: unitPrice,
          quantidade: item.quantity || 1,
          observacao: obsItem
        });
      }

      console.log("[AutoReply] Inserindo itens do pedido no Supabase:", JSON.stringify(itensInsert));
      await axios.post(`${supaUrl}/rest/v1/itens_pedido`, itensInsert, {
        headers: {
          'apikey': supaKey,
          'Authorization': `Bearer ${supaKey}`,
          'Content-Type': 'application/json'
        }
      });

      console.log("[AutoReply] Itens do pedido salvos com sucesso!");

      // 5. Salvar preferências e última marmita do cliente
      await db.saveLastOrder(companyId, customerPhone, pedidoAtual.items).catch(err => {
        console.error("[AutoReply] Erro ao salvar última marmita:", err.message);
      });
      await db.saveCustomerPreferences(companyId, customerPhone, pedidoAtual).catch(err => {
        console.error("[AutoReply] Erro ao salvar preferências do cliente:", err.message);
      });

      // 6. ═══ IMPRESSÃO TÉRMICA ══════════════════════════════════════════════
      // Estratégia dupla:
      //   a) Enviar para o servidor VPS → despacha para o agente Ana Food Print
      //      (app standalone que conecta impressora via ESC/POS USB/TCP/Serial)
      //   b) Fallback: impressão local direta via Electron (print-service.js)
      //      para o caso de não haver agente ou servidor disponível
      // ═════════════════════════════════════════════════════════════════════════
      const orderPrint = {
        orderId: pedidoSalvo.id,
        items: pedidoAtual.items,
        type: pedidoAtual.type,
        deliveryFee: taxaEntrega,
        total: total,
        paymentMethod: pedidoAtual.paymentMethod || 'Pix',
        trocoPara: pedidoAtual.trocoPara ? parseFloat(pedidoAtual.trocoPara) : null,
        phone: customerPhone,
        address: pedidoAtual.address
      };

      // 6a. Tentar impressão via servidor VPS (Ana Food Print agent)
      let vpsSuccess = false;
      try {
        const vpsResult = await vpsPrintService.sendPrintJob(
          orderPrint,
          company,
          customerName,
          supaKey, // Usar service role key como token de autenticação
          companyId
        );
        vpsSuccess = vpsResult.success;
        if (vpsSuccess) {
          console.log(`[AutoReply] ✓ Job de impressão enviado ao servidor VPS (ID: ${vpsResult.jobId || 'N/A'})`);
        } else {
          console.warn(`[AutoReply] VPS indisponível: ${vpsResult.error}. Tentando impressão local...`);
        }
      } catch (vpsErr) {
        console.warn(`[AutoReply] Erro ao enviar ao VPS: ${vpsErr.message}. Tentando impressão local...`);
      }

      // 6b. Fallback: impressão local via Electron (se VPS falhou OU se há impressora local configurada)
      const selectedPrinter = this.settings.get("printerName") || "";
      const enableLocalPrint = this.settings.get("enableLocalPrint") !== false; // padrão: true

      if (!vpsSuccess || (selectedPrinter && enableLocalPrint)) {
        try {
          const printService = require("./print-service");
          const reason = !vpsSuccess ? 'fallback (VPS indisponível)' : 'impressão local adicional';
          console.log(`[AutoReply] Disparando impressão local (${reason}) na impressora: ${selectedPrinter || "Padrão"}...`);
          await printService.printOrder(orderPrint, company, customerName, selectedPrinter);
          console.log("[AutoReply] ✓ Impressão local finalizada!");
        } catch (printErr) {
          console.error("[AutoReply] ✗ Falha na impressão local:", printErr.message);
        }
      }

    } catch (err) {
      console.error("[AutoReply] Erro no fluxo de finalização do pedido:", err.message, err.stack);
    }
  }

  destroy() {
    this.stop();
  }
}

module.exports = AutoReplyAgent;
