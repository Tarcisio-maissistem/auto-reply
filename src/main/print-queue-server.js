// src/main/print-queue-server.js
// ═══════════════════════════════════════════════════════════════════════════════
// SERVIDOR LOCAL DE FILA DE IMPRESSÃO (WebSocket)
// ───────────────────────────────────────────────────────────────────────────────
// Este módulo expõe um servidor WebSocket local (porta 18765) que o agente
// externo "Ana Food Print" (app standalone) pode conectar para receber jobs de
// impressão. Assim, o fluxo é:
//
//   1. Bot finaliza pedido  →  handleFinishedOrder()
//   2. handleFinishedOrder  →  printQueueServer.enqueue(job)
//   3. printQueueServer     →  tenta imprimir localmente via print-service.js
//                              E envia job ao agente externo se conectado
//   4. Agente Ana Food Print →  recebe job e imprime via ESC/POS direto
//
// O agente externo se identifica com um token de 6 dígitos que o operador
// digita no app de impressão (gerado aqui e exibido no painel).
// ═══════════════════════════════════════════════════════════════════════════════

const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PRINT_SERVER_PORT = 18765;

class PrintQueueServer {
  constructor() {
    this._wss = null;
    this._clients = new Map(); // token → ws
    this._pairingCode = this._generateCode();
    this._queue = []; // jobs pendentes
    this._onStatusChange = null; // callback para notificar UI
    this._mainWindow = null;
  }

  // ────────────────────────────────────────────
  // Gerar código de pareamento de 6 dígitos
  // ────────────────────────────────────────────
  _generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  getPairingCode() {
    return this._pairingCode;
  }

  regeneratePairingCode() {
    this._pairingCode = this._generateCode();
    this._notifyUI();
    return this._pairingCode;
  }

  getConnectedAgents() {
    return this._clients.size;
  }

  // ────────────────────────────────────────────
  // Iniciar servidor WebSocket
  // ────────────────────────────────────────────
  start(mainWindow) {
    this._mainWindow = mainWindow;

    if (this._wss) {
      console.log('[PrintQueue] Servidor já iniciado.');
      return;
    }

    try {
      this._wss = new WebSocketServer({ port: PRINT_SERVER_PORT });
      console.log(`[PrintQueue] Servidor WebSocket iniciado na porta ${PRINT_SERVER_PORT}`);

      this._wss.on('connection', (ws, req) => {
        console.log('[PrintQueue] Nova conexão de agente de impressão:', req.socket.remoteAddress);

        ws.on('message', (rawData) => {
          try {
            const msg = JSON.parse(rawData.toString());
            this._handleClientMessage(ws, msg);
          } catch (e) {
            console.error('[PrintQueue] Mensagem inválida do agente:', e.message);
          }
        });

        ws.on('close', () => {
          // Remover cliente da lista
          for (const [token, client] of this._clients.entries()) {
            if (client === ws) {
              this._clients.delete(token);
              console.log(`[PrintQueue] Agente desconectado (token: ${token})`);
              this._notifyUI();
              break;
            }
          }
        });

        ws.on('error', (err) => {
          console.error('[PrintQueue] Erro no WebSocket do agente:', err.message);
        });

        // Enviar mensagem de boas-vindas
        ws.send(JSON.stringify({ type: 'hello', server: 'ana-food-print-queue', version: '1.0' }));
      });

      this._wss.on('error', (err) => {
        console.error('[PrintQueue] Erro no servidor WebSocket:', err.message);
        if (err.code === 'EADDRINUSE') {
          console.log('[PrintQueue] Porta já em uso. O servidor pode já estar rodando.');
        }
      });
    } catch (e) {
      console.error('[PrintQueue] Falha ao iniciar servidor:', e.message);
    }
  }

  stop() {
    if (this._wss) {
      this._wss.close();
      this._wss = null;
      console.log('[PrintQueue] Servidor WebSocket parado.');
    }
  }

  // ────────────────────────────────────────────
  // Processar mensagens dos agentes conectados
  // ────────────────────────────────────────────
  _handleClientMessage(ws, msg) {
    switch (msg.type) {
      case 'pair': {
        // Agente tenta se parear com código de 6 dígitos
        const { code, agentName } = msg;
        if (code === this._pairingCode) {
          const token = crypto.randomBytes(16).toString('hex');
          this._clients.set(token, ws);
          ws.agentToken = token;
          ws.agentName = agentName || 'Ana Food Print';
          console.log(`[PrintQueue] Agente pareado com sucesso: ${ws.agentName} (token: ${token})`);
          ws.send(JSON.stringify({ type: 'paired', token, message: 'Pareamento realizado com sucesso!' }));
          // Renovar código após pareamento para segurança
          this._pairingCode = this._generateCode();
          this._notifyUI();
          // Enviar jobs pendentes
          this._flushQueueToClient(ws);
        } else {
          console.log(`[PrintQueue] Código de pareamento inválido: ${code}`);
          ws.send(JSON.stringify({ type: 'pair_error', message: 'Código inválido. Verifique o código no painel.' }));
        }
        break;
      }

      case 'reconnect': {
        // Agente já pareado reconectando com token salvo
        const { token } = msg;
        if (token) {
          // Aceitar reconexão por token (mesmo sem código)
          this._clients.set(token, ws);
          ws.agentToken = token;
          ws.agentName = msg.agentName || 'Ana Food Print';
          console.log(`[PrintQueue] Agente reconectado: ${ws.agentName}`);
          ws.send(JSON.stringify({ type: 'reconnected', message: 'Reconectado com sucesso!' }));
          this._notifyUI();
          // Enviar jobs pendentes
          this._flushQueueToClient(ws);
        } else {
          ws.send(JSON.stringify({ type: 'reconnect_error', message: 'Token inválido.' }));
        }
        break;
      }

      case 'print_result': {
        // Agente confirmando que imprimiu (ou falhou)
        const { jobId, success, error } = msg;
        console.log(`[PrintQueue] Job ${jobId}: ${success ? '✓ Impresso' : '✗ Falhou'} ${error || ''}`);
        // Notificar UI
        if (this._mainWindow && !this._mainWindow.isDestroyed()) {
          this._mainWindow.webContents.send('print-job-result', { jobId, success, error });
        }
        break;
      }

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      default:
        console.log('[PrintQueue] Mensagem desconhecida do agente:', msg.type);
    }
  }

  // ────────────────────────────────────────────
  // Enfileirar e despachar job de impressão
  // ────────────────────────────────────────────
  enqueue(job) {
    const printJob = {
      jobId: crypto.randomBytes(8).toString('hex'),
      timestamp: new Date().toISOString(),
      ...job
    };

    console.log(`[PrintQueue] Novo job de impressão: ${printJob.jobId} para ${printJob.customerName || '?'}`);

    // Tentar enviar para agentes conectados
    const sent = this._broadcastJob(printJob);

    if (!sent) {
      // Nenhum agente conectado — enfileirar para envio posterior
      this._queue.push(printJob);
      console.log(`[PrintQueue] Job enfileirado (sem agente conectado). Fila: ${this._queue.length}`);
    }

    return printJob.jobId;
  }

  _broadcastJob(job) {
    if (this._clients.size === 0) return false;

    const payload = JSON.stringify({ type: 'print_job', job });
    let sent = false;

    for (const [token, ws] of this._clients.entries()) {
      if (ws.readyState === 1) { // OPEN
        try {
          ws.send(payload);
          sent = true;
          console.log(`[PrintQueue] Job ${job.jobId} enviado para ${ws.agentName || token}`);
        } catch (e) {
          console.error(`[PrintQueue] Falha ao enviar job para agente:`, e.message);
        }
      }
    }

    return sent;
  }

  _flushQueueToClient(ws) {
    if (this._queue.length === 0) return;

    console.log(`[PrintQueue] Enviando ${this._queue.length} jobs pendentes para o agente...`);
    for (const job of this._queue) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'print_job', job }));
      }
    }
    this._queue = [];
  }

  // ────────────────────────────────────────────
  // Notificar UI (React) sobre mudanças de status
  // ────────────────────────────────────────────
  _notifyUI() {
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send('print-agent-status', {
        connected: this._clients.size > 0,
        agentCount: this._clients.size,
        pairingCode: this._pairingCode,
        port: PRINT_SERVER_PORT
      });
    }
  }

  getStatus() {
    return {
      running: !!this._wss,
      connected: this._clients.size > 0,
      agentCount: this._clients.size,
      pairingCode: this._pairingCode,
      port: PRINT_SERVER_PORT,
      queueSize: this._queue.length
    };
  }
}

// Singleton
const printQueueServer = new PrintQueueServer();

module.exports = printQueueServer;
