/**
 * SmartSuggestion — Sugestões contextuais baseadas no pedido
 * 
 * Usa o que já foi pedido para sugerir o próximo passo.
 * Parece um atendente que conhece o cardápio.
 * 
 * Exemplo:
 *   Proteína: Churrasco
 *   Bot: "Arroz e Feijão? (clássico com churrasco)"
 */

// Combinações populares por proteína
const COMBINACOES_PROTEINA = {
  'Churrasco': {
    acompanhamentos: ['Arroz', 'Feijão'],
    saladas: ['Maionese'],
    motivo: 'clássico com churrasco'
  },
  'Frango': {
    acompanhamentos: ['Arroz', 'Purê'],
    saladas: ['Alface'],
    motivo: 'leve e saboroso'
  },
  'Costela': {
    acompanhamentos: ['Arroz', 'Tropeiro'],
    saladas: ['Repolho'],
    motivo: 'tradicional mineiro'
  },
  'Linguiça': {
    acompanhamentos: ['Arroz', 'Feijão'],
    saladas: ['Maionese'],
    motivo: 'combo popular'
  },
  'Carne Cozida': {
    acompanhamentos: ['Arroz', 'Macarrão'],
    saladas: ['Beterraba'],
    motivo: 'caseiro e saboroso'
  }
};

// Combinações de bebidas por contexto
const SUGESTOES_BEBIDA = {
  almoco: { nome: 'Suco Natural', preco: 8, motivo: 'refrescante pro almoço' },
  jantar: { nome: 'Refrigerante Lata', preco: 6, motivo: 'gelado' },
  multiplas: { nome: 'Refrigerante 2L', preco: 10, motivo: 'pra dividir' }
};

/**
 * Sugere acompanhamentos baseado na proteína escolhida
 * @param {Array} proteinas - proteínas selecionadas (objetos com .name ou strings)
 * @returns {Object|null} - { sugestao: [], mensagem: string } ou null
 */
function sugerirAcompanhamento(proteinas) {
  if (!proteinas || proteinas.length === 0) return null;
  
  // Usa a primeira proteína para sugestão
  const primeiraProteina = typeof proteinas[0] === 'string' 
    ? proteinas[0] 
    : (proteinas[0].name || proteinas[0]);
  
  const combo = COMBINACOES_PROTEINA[primeiraProteina];
  if (!combo || !combo.acompanhamentos) return null;
  
  const sugestao = combo.acompanhamentos.slice(0, 2);
  
  return {
    sugestao,
    nomes: sugestao,
    mensagem: `${sugestao.join(' e ')}? _(${combo.motivo})_`
  };
}

/**
 * Sugere saladas baseado na proteína/acompanhamentos escolhidos
 * @param {Array} proteinas - proteínas selecionadas
 * @returns {Object|null}
 */
function sugerirSalada(proteinas) {
  if (!proteinas || proteinas.length === 0) return null;
  
  const primeiraProteina = typeof proteinas[0] === 'string' 
    ? proteinas[0] 
    : (proteinas[0].name || proteinas[0]);
  
  const combo = COMBINACOES_PROTEINA[primeiraProteina];
  if (!combo || !combo.saladas) return null;
  
  return {
    sugestao: combo.saladas,
    nomes: combo.saladas,
    mensagem: `${combo.saladas.join(' ou ')}? _(combina bem!)_`
  };
}

/**
 * Sugere bebida baseado no contexto
 * @param {Object} state - estado atual do pedido
 * @returns {Object|null}
 */
function sugerirBebida(state) {
  const items = state.pedidoAtual?.items || [];
  const marmitas = items.filter(i => i.tipo === 'marmita');
  
  // Já tem bebida?
  if (items.some(i => i.tipo === 'extra')) return null;
  
  // Múltiplas marmitas → sugere 2L
  if (marmitas.length > 2) {
    const sug = SUGESTOES_BEBIDA.multiplas;
    return {
      sugestao: sug,
      mensagem: `*${sug.nome}* (R$ ${sug.preco})? _(${sug.motivo})_ 🥤`
    };
  }
  
  // Horário do dia (simplificado)
  const hora = new Date().getHours();
  const periodo = hora >= 11 && hora <= 15 ? 'almoco' : 'jantar';
  
  const sug = SUGESTOES_BEBIDA[periodo];
  return {
    sugestao: sug,
    mensagem: `*${sug.nome}* (R$ ${sug.preco})? _(${sug.motivo})_ 🥤`
  };
}

/**
 * Detecta se cliente aceitou uma sugestão com resposta curta
 * @param {string} text - resposta do cliente
 * @returns {boolean}
 */
function detectarAceitacaoSugestao(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return /^(sim|pode|isso|manda|ok|claro|va|bora|beleza|perfeito|isso mesmo|esse|esses|boa|show|top)$/.test(lower);
}

/**
 * Detecta se cliente rejeitou uma sugestão
 * @param {string} text - resposta do cliente
 * @returns {boolean}
 */
function detectarRejeicaoSugestao(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return /^(nao|não|outro|outra|diferente|troca|muda|prefiro|quero outro)/.test(lower);
}

/**
 * Gera sugestão padrão (mais pedidos) quando não tem contexto
 * @param {string} tipo - acompanhamento, salada, bebida
 * @returns {Object}
 */
function sugerirMaisPedidos(tipo) {
  const sugestoes = {
    acompanhamento: {
      sugestao: ['Arroz', 'Feijão'],
      mensagem: 'Arroz e Feijão? _(os mais pedidos)_'
    },
    salada: {
      sugestao: ['Maionese'],
      mensagem: 'Maionese? _(a mais pedida)_'
    },
    bebida: {
      sugestao: { nome: 'Refrigerante Lata', preco: 6 },
      mensagem: 'Refrigerante? (R$ 6) 🥤'
    }
  };
  
  return sugestoes[tipo] || null;
}

module.exports = {
  sugerirAcompanhamento,
  sugerirSalada,
  sugerirBebida,
  sugerirMaisPedidos,
  detectarAceitacaoSugestao,
  detectarRejeicaoSugestao,
  COMBINACOES_PROTEINA
};
