// ============================================================
// AI Proxy Service — Chamadas de IA via servidor remoto
// NÃO usa OpenAI API key localmente. Tudo passa pelo proxy.
// Endpoint: https://api.anafood.vip/ai/chat
// ============================================================
const axios = require("axios");
const logger = require("../chatbot/logger");

const AI_PROXY_URL = "https://api.anafood.vip/ai/chat";
const DEFAULT_TIMEOUT = 15000; // 15 segundos

/**
 * Envia mensagens para o proxy de IA no servidor VPS.
 * Substitui chamadas diretas à OpenAI.
 *
 * @param {Array} messages - Array de mensagens OpenAI format [{role, content}]
 * @param {Object} options - Opções opcionais
 * @param {string} options.model - Modelo a usar (default: gpt-4o-mini)
 * @param {number} options.temperature - Temperatura (default: 0.3)
 * @param {number} options.max_tokens - Máximo de tokens (default: 500)
 * @param {string} options.companyId - ID da empresa para billing/logging
 * @param {number} options.timeout - Timeout em ms (default: 15000)
 * @returns {Object} Resposta da OpenAI (formato original)
 */
async function chatCompletion(messages, options = {}) {
  const {
    model = "gpt-4o-mini",
    temperature = 0.3,
    max_tokens = 500,
    companyId = "",
    timeout = DEFAULT_TIMEOUT,
  } = options;

  try {
    const response = await axios.post(
      AI_PROXY_URL,
      {
        messages,
        model,
        temperature,
        max_tokens,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Company-Id": companyId,
        },
        timeout,
      }
    );

    return response.data;
  } catch (error) {
    const status = error.response?.status;
    const errMsg = error.response?.data?.error || error.message;

    if (status === 429) {
      logger.debug("ai_proxy.rate_limited", { companyId });
    } else if (status === 401 || status === 403) {
      logger.debug("ai_proxy.auth_error", { companyId, status });
    } else {
      logger.debug("ai_proxy.request_error", { error: errMsg, status });
    }

    throw error;
  }
}

/**
 * Atalho para chamada simples de chat (sistema + usuário).
 * Retorna apenas o texto da resposta.
 *
 * @param {string} systemPrompt - Prompt do sistema
 * @param {string} userMessage - Mensagem do usuário
 * @param {Object} options - Opções (model, temperature, etc.)
 * @returns {string|null} Texto da resposta ou null em caso de erro
 */
async function quickChat(systemPrompt, userMessage, options = {}) {
  try {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const response = await chatCompletion(messages, options);
    return response.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    return null;
  }
}

module.exports = { chatCompletion, quickChat, AI_PROXY_URL };
