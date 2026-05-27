// ruleEngine.js
// ═══════════════════════════════════════════════════════════════
// Motor de regras centralizado.
// Toda validação de negócio passa por aqui — nada espalhado.
// Retorna mensagens prontas para o cliente quando regra viola.
// ═══════════════════════════════════════════════════════════════

const MAX_PROTEINAS = 2;
const MAX_ACOMPANHAMENTOS = 2;
const MAX_SALADAS = 2;

// ─── VALIDAÇÃO DE COMPONENTES DA MARMITA ────────────────────────────────────

/**
 * Valida proteínas: obrigatório ao menos 1, máximo MAX_PROTEINAS.
 * Retorna { valid, error } onde error é mensagem pronta pro cliente.
 */
function validateProteinas(proteinas) {
  if (!proteinas || proteinas.length === 0) {
    return {
      valid: false,
      error: `Você precisa escolher pelo menos 1 proteína.\nOpções: Frango, Churrasco, Costela, Linguiça ou Carne Cozida.`
    };
  }
  if (proteinas.length > MAX_PROTEINAS) {
    const excesso = proteinas.length - MAX_PROTEINAS;
    const listagem = proteinas.map(p => p.name || p).join(', ');
    return {
      valid: false,
      error: `Você escolheu ${proteinas.length} proteínas (${listagem}), mas o máximo é ${MAX_PROTEINAS}.\nQual você prefere retirar?`
    };
  }
  return { valid: true };
}

/**
 * Valida acompanhamentos: opcional, máximo MAX_ACOMPANHAMENTOS.
 */
function validateAcompanhamentos(acompanhamentos) {
  if (acompanhamentos && acompanhamentos.length > MAX_ACOMPANHAMENTOS) {
    return {
      valid: false,
      error: `Máximo ${MAX_ACOMPANHAMENTOS} acompanhamentos. Você escolheu ${acompanhamentos.length}.\nQual você prefere retirar?`
    };
  }
  return { valid: true };
}

/**
 * Valida saladas: opcional, máximo MAX_SALADAS.
 */
function validateSaladas(saladas) {
  if (saladas && saladas.length > MAX_SALADAS) {
    return {
      valid: false,
      error: `Máximo ${MAX_SALADAS} saladas. Você escolheu ${saladas.length}.\nQual você prefere retirar?`
    };
  }
  return { valid: true };
}

/**
 * Valida uma marmita individualmente (proteínas, acomp, saladas, preço).
 * Retorna { valid, errors[] }.
 */
function validateMarmita(marmita) {
  const errors = [];

  const protResult = validateProteinas(marmita.proteinas);
  if (!protResult.valid) errors.push(protResult.error);

  const acompResult = validateAcompanhamentos(marmita.acompanhamentos);
  if (!acompResult.valid) errors.push(acompResult.error);

  const saladaResult = validateSaladas(marmita.saladas);
  if (!saladaResult.valid) errors.push(saladaResult.error);

  const price = marmita.base_price ?? marmita.price;
  if (price == null || price <= 0) {
    errors.push(`Preço da marmita ${marmita.tamanho || '?'} é inválido.`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── VALIDAÇÃO DO PEDIDO COMPLETO ────────────────────────────────────────────

/**
 * Valida o pedido inteiro antes de ir para confirmação.
 * Retorna { valid, errors[], firstError } onde firstError é a mensagem
 * mais urgente para mostrar ao cliente.
 */
function validateOrder(order) {
  const errors = [];

  if (!order || !order.items || order.items.length === 0) {
    return { valid: false, errors: ['Pedido sem itens.'], firstError: 'Pedido sem itens.' };
  }

  const marmitas = order.items.filter(i => i.tipo === 'marmita');

  if (marmitas.length === 0) {
    const err = 'Pedido precisa de pelo menos uma marmita.';
    return { valid: false, errors: [err], firstError: err };
  }

  for (const m of marmitas) {
    const result = validateMarmita(m);
    if (!result.valid) errors.push(...result.errors);
  }

  if (!order.type) {
    errors.push('Tipo de pedido não definido (entrega ou retirada).');
  }

  if (order.type === 'delivery' && !order.address) {
    errors.push('Endereço não informado para entrega.');
  }

  if (!order.paymentMethod) {
    errors.push('Forma de pagamento não definida.');
  }

  // Dinheiro precisa de troco definido (0 = sem troco, > 0 = com troco, null = não perguntou)
  if (order.paymentMethod === 'Dinheiro' && order.trocoPara === null) {
    errors.push('Precisa confirmar o troco para pagamento em dinheiro.');
  }

  // Valida preços dos extras
  for (const item of order.items) {
    if (item.tipo === 'extra') {
      const price = item.base_price ?? item.price;
      if (price == null || price < 0) {
        errors.push(`Item "${item.name || '?'}" com preço inválido.`);
      }
      if (!item.quantity || item.quantity < 1) {
        errors.push(`Item "${item.name || '?'}" com quantidade inválida.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    firstError: errors[0] || null
  };
}

// ─── HELPERS PARA O FLUXO ────────────────────────────────────────────────────

/**
 * Retorna mensagem de erro mais urgente de forma amigável, ou null se válido.
 * Usado pelo stateMachine para dar feedback inline.
 */
function getFirstViolation(order) {
  const result = validateOrder(order);
  return result.valid ? null : result.firstError;
}

/**
 * Verifica se o estado atual tem proteínas válidas para a marmita em montagem.
 * Usado pelo handleProteina antes de avançar.
 */
function canAdvanceFromProteina(marmitaAtual) {
  if (!marmitaAtual) return { can: false, error: 'Marmita não iniciada.' };
  const result = validateProteinas(marmitaAtual.proteinas);
  return { can: result.valid, error: result.error || null };
}

/**
 * Verifica se uma sugestão de proteínas excede o limite antes de aplicar.
 * Retorna { accepted[], rejected[], message } onde accepted são as aceitas.
 */
function enforceProteinaLimit(existentes, novas) {
  const combinadas = [...(existentes || []), ...novas];
  if (combinadas.length <= MAX_PROTEINAS) {
    return { accepted: novas, rejected: [], message: null };
  }

  // Aceita apenas o que cabe
  const espacoDisponivel = Math.max(0, MAX_PROTEINAS - (existentes || []).length);
  const aceitas = novas.slice(0, espacoDisponivel);
  const rejeitadas = novas.slice(espacoDisponivel);

  let message = null;
  if (rejeitadas.length > 0) {
    const nomes = rejeitadas.map(p => p.name || p).join(', ');
    message = `Limite de ${MAX_PROTEINAS} proteínas atingido. Não adicionei: ${nomes}.`;
  }

  return { accepted: aceitas, rejected: rejeitadas, message };
}

/**
 * Verifica se uma sugestão de acompanhamentos excede o limite.
 */
function enforceAcompanhamentoLimit(existentes, novos) {
  const combinados = [...(existentes || []), ...novos];
  if (combinados.length <= MAX_ACOMPANHAMENTOS) {
    return { accepted: novos, rejected: [], message: null };
  }

  const espacoDisponivel = Math.max(0, MAX_ACOMPANHAMENTOS - (existentes || []).length);
  const aceitos = novos.slice(0, espacoDisponivel);
  const rejeitados = novos.slice(espacoDisponivel);

  let message = null;
  if (rejeitados.length > 0) {
    const nomes = rejeitados.map(a => a.name || a).join(', ');
    message = `Limite de ${MAX_ACOMPANHAMENTOS} acompanhamentos atingido. Não adicionei: ${nomes}.`;
  }

  return { accepted: aceitos, rejected: rejeitados, message };
}

/**
 * Verifica se uma sugestão de saladas excede o limite.
 */
function enforceSaladaLimit(existentes, novas) {
  const combinadas = [...(existentes || []), ...novas];
  if (combinadas.length <= MAX_SALADAS) {
    return { accepted: novas, rejected: [], message: null };
  }

  const espacoDisponivel = Math.max(0, MAX_SALADAS - (existentes || []).length);
  const aceitas = novas.slice(0, espacoDisponivel);
  const rejeitadas = novas.slice(espacoDisponivel);

  let message = null;
  if (rejeitadas.length > 0) {
    const nomes = rejeitadas.map(s => s.name || s).join(', ');
    message = `Limite de ${MAX_SALADAS} saladas atingido. Não adicionei: ${nomes}.`;
  }

  return { accepted: aceitas, rejected: rejeitadas, message };
}

module.exports = {
  // Constantes expostas para referência
  MAX_PROTEINAS,
  MAX_ACOMPANHAMENTOS,
  MAX_SALADAS,
  // Validadores de componentes
  validateProteinas,
  validateAcompanhamentos,
  validateSaladas,
  validateMarmita,
  // Validador do pedido completo
  validateOrder,
  getFirstViolation,
  // Helpers de limite (retornam o que foi aceito/rejeitado)
  canAdvanceFromProteina,
  enforceProteinaLimit,
  enforceAcompanhamentoLimit,
  enforceSaladaLimit
};
