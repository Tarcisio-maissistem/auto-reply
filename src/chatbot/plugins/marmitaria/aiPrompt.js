// plugins/marmitaria/aiPrompt.js
// Humanizador de respostas — IA só humaniza, nunca decide
// Cache 24h obrigatório

const crypto = require('crypto');
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 60 * 60 * 24 }); // 24h

const SYSTEM_PROMPT = `Você é Ana, atendente calorosa de uma marmitaria no WhatsApp.

Sua função é SOMENTE humanizar a instrução recebida — nunca tomar decisões, nunca inventar informações.

REGRAS OBRIGATÓRIAS:
1. Seja 100% fiel à instrução — não adicione nem remova conteúdo.
2. Estilo WhatsApp: curto (1-3 linhas), cordial, use emojis com moderação.
3. NÃO adicione saudações ("Olá", "Oi") — vá direto ao ponto.
4. NÃO faça perguntas extras além das que estão na instrução.
5. NÃO confirme nada além do que a instrução manda confirmar.
6. Se a instrução for uma pergunta, mantenha como pergunta (não responda você mesmo).
7. Responda APENAS o texto da mensagem — sem explicações, sem markdown, sem prefixos.
8. Português do Brasil, informal e acolhedor.

Contexto disponível em "dados" e "contexto": use para personalizar (nome do cliente, tipo de cliente, se tem pressa), mas nunca invente.`;


const MIN_TOKENS = 1024;
const PROMPT_CACHE_KEY = 'ana-food-v1';
const PROMPT_CACHE_RETENTION = '24h';

async function humanizar(instrucao, dados = {}, contexto = {}) {
  // Gera chave de cache baseada na instrução e dados, incluindo PROMPT_CACHE_KEY
  const cacheKey = gerarCacheKey(instrucao, dados, contexto);
  const cached = cache.get(cacheKey);
  if (cached) {
    logTokens('cache', cached.prompt_tokens_details);
    return cached.resposta;
  }

  // Monta prompt estruturado
  let prompt = SYSTEM_PROMPT;
  if (prompt.length / 4 < MIN_TOKENS) {
    prompt = prompt.padEnd(MIN_TOKENS * 4, ' ');
  }

  // Cardápio do dia deve ser injetado como user/assistant, nunca no system
  if (contexto.cardapioDia) {
    prompt += `\n[Cardápio do dia]\n${JSON.stringify(contexto.cardapioDia)}`;
  }

  const input = {
    role: 'user',
    content: JSON.stringify({ instrucao, dados, contexto })
  };

  // Chama a IA (OpenAI API)
  const resposta = await gerarComOpenAI(prompt, input);

  // Log detalhado de tokens
  const prompt_tokens_details = { cached_tokens: prompt.length / 4 };
  logTokens('gerado', prompt_tokens_details);

  // Salva no cache
  cache.set(cacheKey, { resposta, prompt_tokens_details });
  return resposta;
}

function gerarCacheKey(instrucao, dados, contexto) {
  const raw = JSON.stringify({ instrucao, dados, contexto, PROMPT_CACHE_KEY });
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function logTokens(tipo, details) {
  // Loga detalhes de cache e tokens
  console.log(`[aiPrompt][${tipo}] prompt_tokens_details:`, details);
}


async function gerarComOpenAI(prompt, input) {
  // Usa ai-proxy-service (chamadas via https://api.anafood.vip/ai/chat)
  const { chatCompletion } = require('../../main/ai-proxy-service');
  try {
    const response = await chatCompletion(
      [
        { role: 'system', content: prompt },
        input,
      ],
      {
        model: 'gpt-4o-mini',
        temperature: 0.6,
        max_tokens: 200,
        timeout: 10000,
      }
    );
    const text = response.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty_response');
    return text;
  } catch (e) {
    // Proxy falhou — fallback determinístico
    try {
      const { _humanFallback } = require('../../aiInterpreter');
      let instrucao = input.content;
      try {
        const parsed = JSON.parse(input.content);
        instrucao = parsed.instrucao || input.content;
      } catch (_) {}
      let resposta = _humanFallback(instrucao);
      if (typeof resposta === 'object') {
        resposta = resposta.instrucao || resposta.texto || JSON.stringify(resposta);
      }
      if (typeof resposta !== 'string') resposta = String(resposta);
      if (resposta.startsWith('{') && resposta.endsWith('}')) {
        try {
          const obj = JSON.parse(resposta);
          resposta = obj.instrucao || obj.texto || Object.values(obj).join(' ');
        } catch (_) {}
      }
      return resposta;
    } catch (_) {
      return typeof input.content === 'string' ? input.content : 'Como posso ajudar? 😊';
    }
  }
}

module.exports = { humanizar, PROMPT_CACHE_KEY, PROMPT_CACHE_RETENTION };
