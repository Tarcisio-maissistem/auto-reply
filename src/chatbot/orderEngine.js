// orderEngine.js
// ═══════════════════════════════════════════════════════════════
// Lógica de pedido centralizada.
// Interface:
//   addItem(order, item)       → { order, event }
//   removeItem(order, index)   → { order, event }
//   calculateTotal(order)      → number
//   validateOrder(order)       → { valid, errors }
// ═══════════════════════════════════════════════════════════════

/**
 * Adiciona item ao pedido. Retorna pedido atualizado + evento.
 */
function addItem(order, item) {
  if (!item || !item.tipo) {
    return { order, event: 'invalid_item' };
  }

  // Garante quantity mínima
  if (!item.quantity || item.quantity < 1) item.quantity = 1;

  // Garante price não-negativo
  if (item.price == null || item.price < 0) {
    return { order, event: 'invalid_price' };
  }

  order.items.push(item);
  return { order, event: 'item_added' };
}

/**
 * Remove item por índice. Retorna pedido atualizado + evento.
 */
function removeItem(order, index) {
  if (index < 0 || index >= order.items.length) {
    return { order, event: 'invalid_index' };
  }

  order.items.splice(index, 1);
  return { order, event: 'item_removed' };
}

/**
 * Calcula total de um item individual.
 * Suporta açougue (estimated_price, quantity objeto) e padrão (price * quantity inteiro).
 */
function calculateItemTotal(item) {
  // Açougue: usa estimated_price se existir
  if (item.estimated_price !== undefined) {
    return item.estimated_price;
  }

  const unitPrice = item.base_price ?? item.price ?? 0;
  const qty = typeof item.quantity === 'object'
    ? (item.quantity.value || 1)
    : (item.quantity || 1);

  // Soma extras embutidos no item (se houver)
  let extrasTotal = 0;
  if (item.extras && Array.isArray(item.extras)) {
    for (const extra of item.extras) {
      extrasTotal += (extra.price || 0) * (extra.quantity || 1);
    }
  }

  return (unitPrice + extrasTotal) * qty;
}

/**
 * Calcula total do pedido (itens + taxa de entrega).
 * Usa base_price se disponível, soma extras embutidos.
 * Suporta quantity decimal (açougue) via estimated_price ou quantity.value.
 */
function calculateTotal(order) {
  let subtotal = 0;

  for (const item of order.items) {
    subtotal += calculateItemTotal(item);
  }

  const deliveryFee = Number(order.deliveryFee) || 0;
  return subtotal + deliveryFee;
}

/**
 * Valida pedido antes de enviar para confirmação.
 * Retorna { valid: true } ou { valid: false, errors: [...] }
 */
function validateOrder(order) {
  const errors = [];

  if (!order.items || order.items.length === 0) {
    errors.push('Pedido sem itens');
  }

  // Precisa de pelo menos uma marmita
  const marmitas = (order.items || []).filter(i => i.tipo === 'marmita');
  if (marmitas.length === 0) {
    errors.push('Pedido precisa de pelo menos uma marmita');
  }

  // Valida que cada marmita tem pelo menos uma proteína
  for (const m of marmitas) {
    if (!m.proteinas || m.proteinas.length === 0) {
      errors.push(`Marmita ${m.tamanho || '?'} sem proteína`);
    }
  }

  if (!order.type) {
    errors.push('Tipo de pedido não definido (delivery/pickup)');
  }

  if (order.type === 'delivery' && !order.address) {
    errors.push('Endereço não informado para delivery');
  }

  if (!order.paymentMethod) {
    errors.push('Forma de pagamento não definida');
  }

  // Valida preços
  for (const item of (order.items || [])) {
    const price = item.base_price ?? item.price;
    if (price == null || price <= 0) {
      errors.push(`Item "${item.name || item.tamanho || '?'}" com preço inválido`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  addItem,
  removeItem,
  calculateItemTotal,
  calculateTotal,
  validateOrder
};
