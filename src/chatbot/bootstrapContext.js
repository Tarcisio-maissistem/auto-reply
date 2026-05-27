// src/bootstrapContext.js
// ═════════════════════════════════════════════════════════════════
// BOOTSTRAP CONTEXT — Pré-processador de contexto antes de responder.
// Monta dados do cliente, último pedido e produtos top ANTES do fluxo.
// ═════════════════════════════════════════════════════════════════

const db = require('./database');
const logger = require('./logger');

/**
 * Extrai nome do cliente da mensagem inicial.
 * Exemplos detectados:
 *   "Oi, aqui é o Carlos" → Carlos
 *   "Olá sou a Maria" → Maria
 *   "Bom dia, meu nome é João Silva" → João Silva
 *   "oi" → null
 */
function extractNameFromMessage(text) {
  if (!text || text.length < 3) return null;

  const lower = text.toLowerCase();

  // Padrão para nomes em português (inclui acentos)
  const NAME_CHARS = '[a-zA-ZÀ-ÿ]+';
  const NAME_PATTERN = `(${NAME_CHARS}(?:\\s+${NAME_CHARS})?)`;
  const SINGLE_NAME = `(${NAME_CHARS})`;

  // Padrões comuns de apresentação
  const patterns = [
    new RegExp(`(?:aqui\\s+[eé]\\s+(?:o|a)\\s*)${NAME_PATTERN}`, 'i'),           // "aqui é o Carlos"
    new RegExp(`(?:sou\\s+(?:o|a)\\s*)${NAME_PATTERN}`, 'i'),                     // "sou a Maria"
    new RegExp(`(?:meu\\s+nome\\s+[eé]\\s*)${NAME_PATTERN}`, 'i'),                // "meu nome é João"
    new RegExp(`(?:me\\s+chamo\\s*)${NAME_PATTERN}`, 'i'),                        // "me chamo Pedro"
    new RegExp(`(?:pode\\s+me\\s+chamar\\s+de\\s*)${SINGLE_NAME}`, 'i'),          // "pode me chamar de Ana"
    new RegExp(`(?:fala\\s+(?:o|a)\\s*)${SINGLE_NAME}`, 'i'),                     // "fala o Ricardo"
    new RegExp(`(?:^(?:oi|ola|bom\\s+dia|boa\\s+tarde|boa\\s+noite)[,!]?\\s*)${SINGLE_NAME}(?:\\s+aqui)?$`, 'i')  // "Oi Carlos" ou "Oi Carlos aqui"
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Filtra palavras comuns que não são nomes
      const blacklist = ['eu', 'voce', 'vc', 'gente', 'pessoal', 'marmita', 'pedido', 'quero'];
      if (!blacklist.includes(name.toLowerCase()) && name.length >= 2 && name.length <= 30) {
        // Capitaliza primeira letra
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
    }
  }

  return null;
}

/**
 * Valida se os itens do último pedido ainda estão disponíveis.
 * Recalcula preços atuais e remove itens desativados.
 */
function validateLastOrder(lastOrder, cardapio) {
  if (!lastOrder || !Array.isArray(lastOrder) || lastOrder.length === 0) return [];

  const validated = [];

  for (const item of lastOrder) {
    if (item.tipo === 'marmita') {
      // Marmita: valida proteínas e acompanhamentos contra cardápio
      const tamanho = item.tamanho || 'Grande';
      const currentPrice = tamanho === 'Grande' ? 22 : 20;

      // Valida proteínas
      const validProteinas = (item.proteinas || []).filter(p => 
        cardapio.proteinas.some(cp => cp.name.toLowerCase() === (p.name || p).toLowerCase())
      );

      // Valida acompanhamentos
      const validAcomp = (item.acompanhamentos || []).filter(a =>
        cardapio.acompanhamentos.some(ca => ca.name.toLowerCase() === (a.name || a).toLowerCase())
      );

      // Valida saladas
      const validSaladas = (item.saladas || []).filter(s =>
        cardapio.saladas.some(cs => cs.name.toLowerCase() === (s.name || s).toLowerCase())
      );

      // Se tem pelo menos proteína, considera válido
      if (validProteinas.length > 0) {
        validated.push({
          tipo: 'marmita',
          tamanho,
          price: currentPrice,
          quantity: item.quantity || 1,
          proteinas: validProteinas,
          acompanhamentos: validAcomp,
          saladas: validSaladas
        });
      }
    } else if (item.tipo === 'extra') {
      // Extra: valida contra upsells
      const found = cardapio.upsellsBebida?.find(u => 
        u.name.toLowerCase() === (item.name || '').toLowerCase()
      );
      if (found) {
        validated.push({
          tipo: 'extra',
          name: found.name,
          price: found.price,
          quantity: item.quantity || 1
        });
      }
    }
  }

  return validated;
}

/**
 * Formata o último pedido para exibição na sugestão.
 */
function formatLastOrderSummary(items) {
  if (!items || items.length === 0) return '';

  return items.map(item => {
    if (item.tipo === 'marmita') {
      const proteinas = (item.proteinas || []).map(p => p.name || p).join(' + ');
      const acomp = (item.acompanhamentos || []).map(a => a.name || a).join(' + ');
      const saladas = (item.saladas || []).map(s => s.name || s).join(' + ');
      
      let desc = `🍱 Marmita ${item.tamanho}`;
      if (proteinas) desc += ` — ${proteinas}`;
      if (acomp) desc += ` | ${acomp}`;
      if (saladas) desc += ` | ${saladas}`;
      return desc;
    }
    return `• ${item.quantity || 1}x ${item.name}`;
  }).join('\n');
}

/**
 * Formata lista de produtos top para exibição.
 */
function formatTopProducts(products) {
  if (!products || products.length === 0) return '';

  return products.slice(0, 5).map((p, i) => {
    const emoji = ['🥘', '🥩', '🍝', '🍗', '🥤'][i] || '•';
    return `${emoji} ${p.name} — *R$ ${Number(p.price || 0).toFixed(2).replace('.', ',')}*`;
  }).join('\n');
}

/**
 * Bootstrap principal — monta todo o contexto antes de responder.
 * 
 * @param {string} companyId - ID da empresa
 * @param {string} phone - Telefone do cliente
 * @param {string} text - Mensagem inicial do cliente
 * @param {object} cardapio - Cardápio da empresa
 * @param {object} company - Dados da empresa
 * @returns {object} Contexto completo para decisão
 */
async function bootstrap(companyId, phone, text, cardapio, company) {
  const context = {
    customer: null,
    isReturning: false,
    isNew: true,
    lastOrder: null,
    lastOrderValid: [],
    lastOrderSummary: '',
    topProducts: [],
    topProductsFormatted: '',
    extractedName: null,
    hasCompleteHistory: false,
    decisionType: 'NEW_CUSTOMER' // NEW_CUSTOMER | RETURNING_WITH_HISTORY | RETURNING_NO_HISTORY
  };

  try {
    // 1. Busca cliente existente
    const customer = await db.getCustomerByPhone(companyId, phone);
    
    if (customer) {
      context.customer = customer;
      context.isReturning = true;
      context.isNew = false;

      // 2. Valida último pedido
      if (customer.last_order && Array.isArray(customer.last_order) && customer.last_order.length > 0) {
        context.lastOrder = customer.last_order;
        context.lastOrderValid = validateLastOrder(customer.last_order, cardapio);
        context.lastOrderSummary = formatLastOrderSummary(context.lastOrderValid);

        // 3. Verifica se tem histórico completo (pagamento + endereço) e pedido ativo
        const prefs = customer.preferences || {};
        
        // Verifica pedido ativo (menos de 2 horas)
        if (prefs.last_order_time) {
          const diffMinutes = (new Date() - new Date(prefs.last_order_time)) / (1000 * 60);
          if (diffMinutes < 120) {
            context.activeOrder = {
              time: prefs.last_order_time,
              type: prefs.last_order_type || 'delivery',
              diffMinutes: Math.floor(diffMinutes)
            };
            context.decisionType = 'ACTIVE_ORDER';
          }
        }

        if (context.decisionType !== 'ACTIVE_ORDER') {
          if (context.lastOrderValid.length > 0 && prefs.favorite_payment) {
            context.hasCompleteHistory = true;
            context.decisionType = 'RETURNING_WITH_HISTORY';
          } else if (context.lastOrderValid.length > 0) {
            context.decisionType = 'RETURNING_WITH_HISTORY';
          } else {
            context.decisionType = 'RETURNING_NO_HISTORY';
          }
        }
      } else {
        context.decisionType = 'RETURNING_NO_HISTORY';
      }
    } else {
      // 4. Cliente novo — tenta extrair nome da mensagem
      context.extractedName = extractNameFromMessage(text);
      context.decisionType = 'NEW_CUSTOMER';
    }

    // 5. Busca top products (para cliente novo ou sem histórico)
    if (context.decisionType === 'NEW_CUSTOMER' || context.decisionType === 'RETURNING_NO_HISTORY') {
      context.topProducts = await getTopProducts(companyId, cardapio);
      context.topProductsFormatted = formatTopProducts(context.topProducts);
    }

    logger.debug('bootstrap.context', {
      phone,
      decisionType: context.decisionType,
      isReturning: context.isReturning,
      hasLastOrder: context.lastOrderValid.length > 0,
      extractedName: context.extractedName
    });

  } catch (err) {
    logger.error('bootstrap.error', { phone, error: err.message });
  }

  return context;
}

/**
 * Busca produtos mais vendidos da empresa.
 * Fallback: retorna itens do cardápio padrão.
 */
async function getTopProducts(companyId, cardapio) {
  // Por enquanto, retorna os itens fixos do cardápio marmitaria
  // TODO: Implementar query real quando tiver tabela de order_items
  const defaultProducts = [
    { name: 'Marmita Grande — Frango', price: 22 },
    { name: 'Marmita Grande — Churrasco', price: 22 },
    { name: 'Marmita Pequena — Frango', price: 20 },
    { name: 'Suco Natural', price: 8 },
    { name: 'Refrigerante Lata', price: 6 }
  ];

  return defaultProducts;
}

module.exports = {
  bootstrap,
  extractNameFromMessage,
  validateLastOrder,
  formatLastOrderSummary,
  formatTopProducts,
  getTopProducts
};
