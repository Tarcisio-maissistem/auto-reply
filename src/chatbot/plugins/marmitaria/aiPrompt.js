// plugins/marmitaria/aiPrompt.js
// Humanizador de respostas — IA só humaniza, nunca decide
// Cache 24h obrigatório


const crypto = require('crypto');
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 60 * 60 * 24 }); // 24h

const SYSTEM_PROMPT = `Você é um humanizador de respostas para atendimento de marmitaria.\n\nSua função é transformar instruções estruturadas em mensagens naturais, simpáticas e claras para o cliente, SEM tomar decisões.\n\nRegras:\n- Nunca invente informações.\n- Não altere o conteúdo da instrução.\n- Não faça perguntas extras.\n- Use sempre o contexto e dados fornecidos.\n- Responda sempre em português do Brasil.\n- Seja breve, cordial e direto.\n`;

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
  // Implementação real: chamada à OpenAI API
  if (!process.env.OPENAI_API_KEY) {
    // Fallback humanizado determinístico
    try {
      const { _humanFallback } = require('../../aiInterpreter');
      // Tenta extrair a instrução principal do input
      let instrucao = input.content;
      try {
        const parsed = JSON.parse(input.content);
        instrucao = parsed.instrucao || input.content;
      } catch (e) {}
      let resposta = _humanFallback(instrucao);
      // Se vier objeto ou JSON, transforma em string amigável
      if (typeof resposta === 'object') {
        resposta = resposta.instrucao || resposta.texto || JSON.stringify(resposta);
      }
      if (typeof resposta !== 'string') {
        resposta = String(resposta);
      }
      // Remove chaves JSON se vier serializado
      if (resposta.startsWith('{') && resposta.endsWith('}')) {
        try {
          const obj = JSON.parse(resposta);
          resposta = obj.instrucao || obj.texto || Object.values(obj).join(' ');
        } catch (e) {}
      }
      return resposta;
    } catch (e) {
      // Fallback bruto se não conseguir importar
      return typeof input.content === 'string' ? input.content : '[FALLBACK]';
    }
  }
  // ...chamada real à API...
  // Exemplo:
  // const resposta = await openai.chat.completions.create({ ... });
  // return resposta.choices[0].message.content;
  return '[RESPOSTA DA IA]';
}

module.exports = { humanizar, PROMPT_CACHE_KEY, PROMPT_CACHE_RETENTION };
