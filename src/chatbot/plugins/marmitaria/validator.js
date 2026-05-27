// plugins/marmitaria/validator.js
// ═══════════════════════════════════════════════════════════════
// Regras de negócio — limites por tamanho, preço, validação
// ═══════════════════════════════════════════════════════════════

const T = require('../../templates');
const { DEFAULT_CARDAPIO } = require('./cardapio');
const tpl = require('./templates');

/**
 * Valida um item de marmita contra as regras do cardápio.
 * Retorna { valid: boolean, errors: { code, message }[] }
 */
function validateItem(item, cardapio) {
  const errors = [];
  const c = cardapio || DEFAULT_CARDAPIO;

  if (item.tipo !== 'marmita') return { valid: true, errors: [] };

  // Busca tamanho no cardápio
  const tamanhos = c.tamanhos || DEFAULT_CARDAPIO.tamanhos;
  const tamanhoObj = tamanhos.find(t =>
    t.name === item.tamanho || t.id === (item.tamanho || '').toLowerCase()
  );

  if (!tamanhoObj) {
    errors.push({ code: 'INVALID_SIZE', message: 'Tamanho inválido' });
    return { valid: false, errors };
  }

  // Proteínas obrigatórias (mín 1)
  if (!item.proteinas || item.proteinas.length === 0) {
    errors.push({ code: 'NO_PROTEINAS', message: 'Marmita precisa de pelo menos uma proteína' });
  }

  // Máximo de proteínas por tamanho
  if (item.proteinas && item.proteinas.length > tamanhoObj.max_proteinas) {
    errors.push({
      code: 'TOO_MANY_PROTEINAS',
      message: `Marmita ${tamanhoObj.name} aceita até ${tamanhoObj.max_proteinas} proteína(s)`
    });
  }

  // Proteínas devem existir no cardápio
  if (item.proteinas) {
    const proteinasDisponiveis = c.proteinas || DEFAULT_CARDAPIO.proteinas;
    for (const p of item.proteinas) {
      const nome = p.name || p;
      const existe = proteinasDisponiveis.some(cp =>
        cp.name === nome || (cp.apelidos && cp.apelidos.some(a => a.toLowerCase() === nome.toLowerCase()))
      );
      if (!existe) {
        errors.push({ code: 'INVALID_PROTEINA', message: `${nome} não está disponível` });
      }
    }
  }

  // Máximo de acompanhamentos
  if (item.acompanhamentos && item.acompanhamentos.length > tamanhoObj.max_acompanhamentos) {
    errors.push({
      code: 'TOO_MANY_ACOMPS',
      message: `Máximo ${tamanhoObj.max_acompanhamentos} acompanhamentos`
    });
  }

  // Máximo de saladas
  if (item.saladas && item.saladas.length > tamanhoObj.max_saladas) {
    errors.push({
      code: 'TOO_MANY_SALADAS',
      message: `Máximo ${tamanhoObj.max_saladas} salada(s)`
    });
  }

  // Preço deve estar correto
  const price = item.base_price ?? item.price;
  if (!price || price <= 0) {
    errors.push({ code: 'INVALID_PRICE', message: 'Preço inválido' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Calcula preço do item baseado no tamanho (cardápio-driven).
 */
function calculateItemPrice(item, cardapio) {
  if (item.tipo !== 'marmita') return item.price || 0;

  const c = cardapio || DEFAULT_CARDAPIO;
  const tamanhos = c.tamanhos || DEFAULT_CARDAPIO.tamanhos;
  const tamanhoObj = tamanhos.find(t =>
    t.name === item.tamanho || t.id === (item.tamanho || '').toLowerCase()
  );

  return tamanhoObj ? tamanhoObj.price : (item.tamanho === 'Grande' ? 22 : 20);
}

/**
 * Formata item para resumo de pedido.
 */
function formatItemForSummary(item) {
  if (item.tipo === 'marmita') {
    return tpl.resumoFinalMarmita(item);
  }
  return `• ${item.quantity || 1}x ${item.name} — R$ ${T.fmt(item.price * (item.quantity || 1))}`;
}

module.exports = {
  validateItem,
  calculateItemPrice,
  formatItemForSummary
};
