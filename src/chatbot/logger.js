// src/logger.js
// ═══════════════════════════════════════════════════════════════
// Logs estruturados em JSON.
// Cada log tem: timestamp, level, event, companyId, phone, data.
// Em produção: redirecione stdout para seu sistema de observabilidade.
// ═══════════════════════════════════════════════════════════════

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 99 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'];

function log(level, event, data = {}) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...data
  };

  // Sanitiza: nunca loga mensagem completa em produção (LGPD)
  if (entry.message && process.env.NODE_ENV === 'production') {
    entry.message = entry.message.slice(0, 20) + '…';
  }

  process.stdout.write(JSON.stringify(entry) + '\n');
}

// ─── API PÚBLICA ──────────────────────────────────────────────────────────────

const logger = {
  // Mensagem recebida do cliente
  messageReceived({ companyId, phone, etapa, messageLength }) {
    log('info', 'message.received', { companyId, phone, etapa, messageLength });
  },

  // Transição de estado
  stateTransition({ companyId, phone, from, to }) {
    log('info', 'state.transition', { companyId, phone, from, to });
  },

  // Produto escolhido
  productSelected({ companyId, phone, productId, productName, quantity }) {
    log('info', 'product.selected', { companyId, phone, productId, productName, quantity });
  },

  // Extra adicionado
  extraAdded({ companyId, phone, extraId, extraName }) {
    log('info', 'extra.added', { companyId, phone, extraId, extraName });
  },

  // Pedido criado com sucesso
  orderCreated({ companyId, phone, orderId, total, type, itemCount }) {
    log('info', 'order.created', { companyId, phone, orderId, total, type, itemCount });
  },

  // Pedido cancelado por inatividade
  orderCancelledByTimeout({ companyId, phone, etapa, elapsedMs }) {
    log('warn', 'order.cancelled.timeout', { companyId, phone, etapa, elapsedMs });
  },

  // Lembrete enviado
  reminderSent({ companyId, phone }) {
    log('info', 'reminder.sent', { companyId, phone });
  },

  // Validação falhou
  validationFailed({ companyId, phone, reason }) {
    log('warn', 'validation.failed', { companyId, phone, reason });
  },

  // IA acionada (para monitorar custo)
  aiCalled({ companyId, phone, purpose, fallback }) {
    log('info', 'ai.called', { companyId, phone, purpose, fallback });
  },

  // Erro de banco de dados
  dbError({ companyId, phone, operation, error }) {
    log('error', 'db.error', { companyId, phone, operation, error: error?.message });
  },

  // Erro de Redis
  redisError({ operation, error }) {
    log('error', 'redis.error', { operation, error: error?.message });
  },

  // Erro de Evolution API
  evolutionError({ phone, error }) {
    log('error', 'evolution.error', { phone, error: error?.message });
  },

  // Erro não tratado no webhook
  webhookError({ phone, error, stack }) {
    log('error', 'webhook.error', {
      phone,
      error: error?.message,
      stack: process.env.NODE_ENV !== 'production' ? stack : undefined
    });
  },

  // Debug genérico (só aparece com LOG_LEVEL=debug)
  debug(event, data) {
    log('debug', event, data);
  }
};

module.exports = logger;
