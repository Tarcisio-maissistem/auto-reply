// plugins/acougue/validator.js
// ═══════════════════════════════════════════════════════════════
// Validação de itens de açougue — Sessão B
// ═══════════════════════════════════════════════════════════════

const { DEFAULT_CARDAPIO, UNIT_MAP } = require('./cardapio');
const ai = require('../../aiInterpreter');
const tpl = require('./templates');

/**
 * Valida se um corte existe no cardápio.
 */
function corteExiste(name, cardapio) {
  const cortes = (cardapio || DEFAULT_CARDAPIO).cortes;
  const lower = ai.normalizar(name);
  return cortes.some(c =>
    ai.normalizar(c.name) === lower ||
    (c.apelidos && c.apelidos.some(a => ai.normalizar(a) === lower))
  );
}

/**
 * Valida uma unidade de medida.
 */
function unitReconhecida(unit) {
  if (!unit) return false;
  const lower = unit.toLowerCase();
  return !!UNIT_MAP[lower] || ['kg', 'g', 'brl', 'pct', 'pcs', 'bnd', 'un'].includes(lower) || unit === 'BRL';
}

/**
 * Valida um item de pedido de açougue.
 * Retorna { valid: boolean, errors: string[], errorCodes: string[] }
 */
function validateItem(item, cardapio) {
  const errors = [];
  const errorCodes = [];

  if (item.tipo !== 'corte' && item.tipo !== 'carne') {
    return { valid: true, errors: [], errorCodes: [] };
  }

  if (!item.name && !item.produto) {
    errors.push('Corte não definido');
    errorCodes.push('INVALID_CORTE');
  }

  // Verifica quantity
  if (item.quantity) {
    if (typeof item.quantity === 'object') {
      if (!item.quantity.value || item.quantity.value <= 0) {
        errors.push('Quantidade inválida');
        errorCodes.push('INVALID_QUANTITY');
      }
      if (item.quantity.value > 50) {
        errors.push('Quantidade muito alta (máx 50kg)');
        errorCodes.push('INVALID_QUANTITY');
      }
    } else if (typeof item.quantity === 'number') {
      if (item.quantity <= 0) {
        errors.push('Quantidade inválida');
        errorCodes.push('INVALID_QUANTITY');
      }
    }
  }

  // Preço
  if (item.estimated_price != null && item.estimated_price < 0) {
    errors.push('Preço estimado negativo');
  }

  // Peso legado
  if (item.peso != null && item.peso <= 0) {
    errors.push('Peso inválido');
    errorCodes.push('INVALID_QUANTITY');
  }

  return { valid: errors.length === 0, errors, errorCodes };
}

/**
 * Calcula preço do item.
 * Suporta: kg, g, BRL, pct (com package_size), legado (peso).
 */
function calculateItemPrice(item) {
  if (item.tipo !== 'corte' && item.tipo !== 'carne') {
    return item.price || 0;
  }

  const pricePerKg = item.price_per_kg || item.pricePerKg || 0;

  // Novo formato (quantity object)
  if (item.quantity && typeof item.quantity === 'object') {
    const unit = item.quantity.unit;
    const value = item.quantity.value || 0;

    // kg / weight
    if (unit === 'kg' || item.quantity.type === 'weight') {
      return Math.round(pricePerKg * value * 100) / 100;
    }

    // gramas
    if (unit === 'g') {
      return Math.round(pricePerKg * (value / 1000) * 100) / 100;
    }

    // valor em reais
    if (unit === 'BRL' || item.quantity.type === 'value') {
      return value;
    }

    // pacote
    if (unit === 'pct' || item.quantity.type === 'package') {
      const pkgSize = item.quantity.package_size || 500;
      return Math.round(pricePerKg * (pkgSize / 1000) * value * 100) / 100;
    }
  }

  // Formato legado (peso direto)
  if (item.peso) {
    return Math.round(pricePerKg * item.peso * 100) / 100;
  }

  return item.estimated_price || item.price || 0;
}

/**
 * Formata item para resumo. Delega para templates.resumoItem.
 */
function formatItemForSummary(item) {
  return tpl.resumoItem(item);
}

module.exports = {
  corteExiste,
  unitReconhecida,
  validateItem,
  calculateItemPrice,
  formatItemForSummary
};
