// ============================================================
// ROTA DE IA — Proxy para OpenAI via api.anafood.vip
// ============================================================
// DEPLOY: Copiar para /home/claude/Ana-Food/src/routes/ai.js
// Em app.js adicionar: app.use('/ai', require('./routes/ai'));
// ============================================================

const router = require('express').Router();
const axios = require('axios');

// Rate limiting simples por companyId (em memória)
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX = 60; // 60 requests por minuto por empresa

function checkRateLimit(companyId) {
  const key = companyId || 'anonymous';
  const now = Date.now();
  
  if (!rateLimits.has(key)) {
    rateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }
  
  const limit = rateLimits.get(key);
  if (now - limit.windowStart > RATE_LIMIT_WINDOW) {
    // Reset janela
    rateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }
  
  if (limit.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  limit.count++;
  return true;
}

// Limpa rate limits antigos a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimits.entries()) {
    if (now - val.windowStart > RATE_LIMIT_WINDOW * 2) {
      rateLimits.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * POST /ai/chat
 * 
 * Body: { messages, model, temperature, max_tokens }
 * Headers: X-Company-Id (opcional, para logging/billing)
 * 
 * Retorna: resposta completa da OpenAI
 */
router.post('/chat', async (req, res) => {
  try {
    const { messages, model, temperature, max_tokens } = req.body;
    const companyId = req.headers['x-company-id'] || '';

    // Validação básica
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Campo "messages" é obrigatório e deve ser um array.' });
    }

    // Rate limiting
    if (!checkRateLimit(companyId)) {
      console.log(`[AI] Rate limit excedido para empresa: ${companyId}`);
      return res.status(429).json({ error: 'Limite de requisições excedido. Tente novamente em 1 minuto.' });
    }

    // Verificar API key do servidor
    if (!process.env.OPENAI_API_KEY) {
      console.error('[AI] OPENAI_API_KEY não configurada no servidor');
      return res.status(500).json({ error: 'Serviço de IA não configurado no servidor.' });
    }

    console.log(`[AI] Requisição de ${companyId || 'anonymous'} | model: ${model || 'gpt-4o-mini'} | msgs: ${messages.length}`);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: model || 'gpt-4o-mini',
        messages,
        temperature: temperature !== undefined ? temperature : 0.3,
        max_tokens: max_tokens || 500,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 segundos
      }
    );

    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    const errMsg = error.response?.data?.error?.message || error.message;
    
    console.error(`[AI] Erro: ${status} - ${errMsg}`);

    if (status === 429) {
      res.status(429).json({ error: 'Limite da OpenAI excedido. Tente novamente mais tarde.' });
    } else if (status === 401) {
      res.status(500).json({ error: 'Chave da OpenAI inválida no servidor.' });
    } else {
      res.status(status).json({ error: errMsg || 'Erro interno no servidor de IA.' });
    }
  }
});

/**
 * GET /ai/health
 * Verifica se o serviço de IA está operacional
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.OPENAI_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
