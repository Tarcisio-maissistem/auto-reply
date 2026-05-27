// plugins/marmitaria/cardapio.js
// ═══════════════════════════════════════════════════════════════
// Cardápio estruturado — tamanhos com limites, combos, upsells
// ═══════════════════════════════════════════════════════════════

const TAMANHOS = [
  {
    id: 'pequena',
    name: 'Pequena',
    price: 20,
    apelidos: ['p', 'pequena', 'menor', '1'],
    max_proteinas: 1,
    max_acompanhamentos: 2,
    max_saladas: 1,
    serve: '1 pessoa'
  },
  {
    id: 'grande',
    name: 'Grande',
    price: 22,
    apelidos: ['g', 'grande', 'maior', '2'],
    max_proteinas: 2,
    max_acompanhamentos: 2,
    max_saladas: 2,
    serve: '1-2 pessoas'
  }
];

const PROTEINAS = [
  { id: 'frango',       name: 'Frango Grelhado', apelidos: ['frango', 'galinha'] },
  { id: 'churrasco',    name: 'Churrasco',       apelidos: ['churras', 'churrasco', 'contrafile'] },
  { id: 'costela',      name: 'Costela',         apelidos: ['costelinha', 'costela'] },
  { id: 'linguica',     name: 'Linguiça',        apelidos: ['linguica', 'linguiça'] },
  { id: 'carne_cozida', name: 'Carne Cozida',    apelidos: ['carne', 'carne cozida', 'cozida'] },
  { id: 'peixe',        name: 'Peixe Grelhado',  apelidos: ['peixe', 'peixinho'], opcional: true }
];

const ACOMPANHAMENTOS = [
  { id: 'arroz',    name: 'Arroz',    apelidos: ['arro', 'arrozinho'],    padrao: true },
  { id: 'feijao',   name: 'Feijão',   apelidos: ['feijao', 'feijão'],     padrao: true },
  { id: 'macarrao', name: 'Macarrão', apelidos: ['macarrao', 'macarrão'] },
  { id: 'pure',     name: 'Purê',     apelidos: ['pure', 'purê'] },
  { id: 'tropeiro', name: 'Tropeiro', apelidos: ['tropeiro'] }
];

const SALADAS = [
  { id: 'maionese',  name: 'Maionese',  apelidos: ['maionese', 'mayo'] },
  { id: 'beterraba', name: 'Beterraba', apelidos: ['beterraba'] },
  { id: 'alface',    name: 'Alface',    apelidos: ['alface'] },
  { id: 'repolho',   name: 'Repolho',   apelidos: ['repolho'] },
  { id: 'pepino',    name: 'Pepino',    apelidos: ['pepino'] }
];

const BEBIDAS = [
  {
    id: 'suco',       name: 'Suco Natural',       price: 8,
    apelidos: ['suco', 'natural', 'suquinho'],
    score_almoco: 0.9,
    score_jantar: 0.6
  },
  {
    id: 'refri_lata', name: 'Refrigerante Lata',  price: 6,
    apelidos: ['refrigerante', 'refri', 'lata', 'coca', 'guarana'],
    score_almoco: 0.7,
    score_jantar: 0.8
  },
  {
    id: 'refri_2l',   name: 'Refrigerante 2L',    price: 10,
    apelidos: ['2l', 'dois litros', 'família'],
    score_multiplas: 0.95
  },
  {
    id: 'agua',       name: 'Água Mineral',        price: 3,
    apelidos: ['agua', 'água', 'mineral']
  }
];

const SOBREMESAS = [
  { id: 'pudim',  name: 'Pudim',  price: 6, apelidos: ['pudim'] },
  { id: 'mousse', name: 'Mousse', price: 6, apelidos: ['mousse', 'musse'] }
];

const COMBOS = [
  {
    id: 'combo_frango',
    name: 'Combo Frango',
    tamanho: 'Grande',
    proteinas: ['Frango Grelhado'],
    acompanhamentos: ['Arroz', 'Feijão'],
    saladas: ['Alface'],
    triggers: ['combo frango', 'frango com arroz e feijao', 'de sempre frango']
  },
  {
    id: 'combo_carne',
    name: 'Combo Carne',
    tamanho: 'Grande',
    proteinas: ['Carne Cozida'],
    acompanhamentos: ['Arroz', 'Feijão'],
    saladas: ['Maionese'],
    triggers: ['combo carne', 'carne com arroz']
  }
];

// Cardápio consolidado — compatível com interface do plugin system
const DEFAULT_CARDAPIO = {
  tamanhos: TAMANHOS,
  proteinas: PROTEINAS,
  acompanhamentos: ACOMPANHAMENTOS,
  saladas: SALADAS,
  bebidas: BEBIDAS,
  sobremesas: SOBREMESAS,
  combos: COMBOS,
  // Campos de compatibilidade com stateMachine (getCardapio espera estes nomes)
  upsellsBebida: BEBIDAS,
  upsellsSobremesa: SOBREMESAS
};

module.exports = {
  TAMANHOS,
  PROTEINAS,
  ACOMPANHAMENTOS,
  SALADAS,
  BEBIDAS,
  SOBREMESAS,
  COMBOS,
  DEFAULT_CARDAPIO
};
