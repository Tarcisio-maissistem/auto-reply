// plugins/lanchonete.js
// ═══════════════════════════════════════════════════════════════
// Plugin Lanchonete — Fluxo: Lanche → Adicionais → Upsell
// ═══════════════════════════════════════════════════════════════

const ai = require('../aiInterpreter');
const T = require('../templates');

const business_type = 'lanchonete';

const FLOW_STEPS = [
  'MONTANDO_LANCHE',
  'MONTANDO_ADICIONAIS',
  'OFERECENDO_UPSELL'
];

const DEFAULT_CARDAPIO = {
  lanches: [
    { name: 'X-Burger', price: 18, apelidos: ['xburger', 'cheese', 'hamburguer'] },
    { name: 'X-Salada', price: 20, apelidos: ['xsalada'] },
    { name: 'X-Bacon', price: 22, apelidos: ['xbacon'] },
    { name: 'X-Tudo', price: 25, apelidos: ['xtudo', 'completo'] },
    { name: 'X-Egg', price: 19, apelidos: ['xegg', 'ovo'] },
    { name: 'Hot Dog Simples', price: 12, apelidos: ['hotdog', 'cachorro quente'] },
    { name: 'Hot Dog Completo', price: 16, apelidos: ['dog completo'] },
    { name: 'Misto Quente', price: 10, apelidos: ['misto'] }
  ],
  adicionais: [
    { name: 'Bacon Extra', price: 4, apelidos: ['bacon'] },
    { name: 'Queijo Extra', price: 3, apelidos: ['queijo'] },
    { name: 'Ovo', price: 2 },
    { name: 'Cheddar', price: 4, apelidos: ['cheddar'] },
    { name: 'Calabresa', price: 4 },
    { name: 'Milho', price: 2 },
    { name: 'Catupiry', price: 3 }
  ],
  upsellsBebida: [
    { name: 'Refrigerante Lata', price: 6, apelidos: ['refrigerante', 'refri', 'lata', 'coca'] },
    { name: 'Refrigerante 2L', price: 10, apelidos: ['2l'] },
    { name: 'Suco Natural', price: 8, apelidos: ['suco'] },
    { name: 'Água', price: 3, apelidos: ['agua'] }
  ],
  upsellsSobremesa: [],
  // Mantém compatibilidade com estrutura genérica
  proteinas: [],
  acompanhamentos: [],
  saladas: []
};

function getFlowSteps() { return FLOW_STEPS; }
function getDefaultCardapio() { return DEFAULT_CARDAPIO; }

// ─── HANDLERS ─────────────────────────────────────────────────

function handleStep(etapa, text, state, cardapio) {
  switch (etapa) {
    case 'MONTANDO_LANCHE': return handleLanche(text, state, cardapio);
    case 'MONTANDO_ADICIONAIS': return handleAdicionais(text, state, cardapio);
    case 'OFERECENDO_UPSELL': return handleUpsell(text, state, cardapio);
    default: return null;
  }
}

function handleLanche(text, state, cardapio) {
  const lanches = cardapio.lanches || DEFAULT_CARDAPIO.lanches;
  const selecionados = ai.interpretItensMultiplos(text, lanches);

  if (selecionados.length === 0) {
    const lista = lanches.map(l => `• *${l.name}* — R$ ${T.fmt(l.price)}`).join('\n');
    return { state, response: `Qual lanche você quer?\n${lista}` };
  }

  const qty = ai.interpretQuantity(text) || 1;
  const lanche = selecionados[0];

  state._lancheAtual = {
    tipo: 'lanche',
    name: lanche.name,
    price: lanche.price,
    quantity: qty,
    adicionais: []
  };

  state.etapa = 'MONTANDO_ADICIONAIS';
  const adicList = (cardapio.adicionais || DEFAULT_CARDAPIO.adicionais)
    .map(a => `• ${a.name} (+R$ ${T.fmt(a.price)})`).join('\n');
  return { state, response: `*${qty}x ${lanche.name}* — R$ ${T.fmt(lanche.price)}\n\nQuer adicionar algo?\n${adicList}\n_(ou "não" para pular)_` };
}

function handleAdicionais(text, state, cardapio) {
  const lower = ai.normalizar(text);
  const adicionais = cardapio.adicionais || DEFAULT_CARDAPIO.adicionais;

  if (!/nao|nada|pula|sem|n\b/.test(lower)) {
    const selecionados = ai.interpretItensMultiplos(text, adicionais);
    if (selecionados.length > 0) {
      for (const adic of selecionados) {
        state._lancheAtual.adicionais.push({ name: adic.name, price: adic.price });
      }
    }
  }

  // Finaliza lanche
  const lanche = state._lancheAtual;
  // Calcula preço total incluindo adicionais
  const adicTotal = lanche.adicionais.reduce((s, a) => s + (a.price || 0), 0);
  lanche.price = lanche.price + adicTotal;
  state.pedidoAtual.items.push(lanche);
  state._lancheAtual = null;

  state.etapa = 'OFERECENDO_UPSELL';
  state._upsellPhase = 'bebida';
  return {
    state,
    response: [
      `🍔 *Anotado!*\n${formatItemForSummary(lanche)}`,
      `Quer uma bebida? 🥤\n${(cardapio.upsellsBebida || DEFAULT_CARDAPIO.upsellsBebida).map(b => `• ${b.name} (R$ ${T.fmt(b.price)})`).join('\n')}\n_(ou "não")_`
    ]
  };
}

function handleUpsell(text, state, cardapio) {
  const bebidas = ai.interpretUpsell(text, cardapio.upsellsBebida || DEFAULT_CARDAPIO.upsellsBebida);
  if (bebidas && bebidas.length > 0) {
    bebidas.forEach(b => {
      state.pedidoAtual.items.push({
        tipo: 'extra', name: b.name, price: b.price, quantity: 1
      });
    });
  }

  state.etapa = 'AGUARDANDO_TIPO';
  const ultimoLanche = [...state.pedidoAtual.items].reverse().find(i => i.tipo === 'lanche');
  return { state, response: T.perguntarTipo(formatItemForSummary(ultimoLanche)) };
}

// ─── INTERFACE ───────────────────────────────────────────────

function buildFastTrackItem() { return null; }

function validateItem(item) {
  const errors = [];
  if (item.tipo !== 'lanche') return { valid: true, errors: [] };
  if (!item.name) errors.push('Lanche não definido');
  const price = item.base_price ?? item.price;
  if (!price || price <= 0) errors.push('Preço inválido');
  return { valid: errors.length === 0, errors };
}

function calculateItemPrice(item) {
  if (item.tipo !== 'lanche') return item.price || 0;
  const base = item.price || 0;
  const adics = (item.adicionais || []).reduce((s, a) => s + (a.price || 0), 0);
  return (base + adics) * (item.quantity || 1);
}

function formatItemForSummary(item) {
  if (!item || item.tipo !== 'lanche') {
    if (item) return `• ${item.quantity || 1}x ${item.name} — R$ ${T.fmt(item.price * (item.quantity || 1))}`;
    return '';
  }
  let txt = `🍔 *${item.quantity || 1}x ${item.name}* — R$ ${T.fmt(item.price * (item.quantity || 1))}\n`;
  if (item.adicionais?.length) {
    txt += `  + ${item.adicionais.map(a => a.name).join(', ')}\n`;
  }
  return txt;
}

const templates = {
  saudacao: (companyName) => [
    `Olá! Bem-vindo à *${companyName}*! 🍔`,
    `O que vai ser hoje? Confira nosso cardápio!`
  ],
  saudacaoCliente: (nome, companyName) => [
    `Olá, *${nome}*!  Bem-vindo de volta à *${companyName}*! 🍔`,
    `O que vai pedir hoje?`
  ]
};

module.exports = {
  business_type,
  getFlowSteps,
  getDefaultCardapio,
  handleStep,
  buildFastTrackItem,
  validateItem,
  calculateItemPrice,
  formatItemForSummary,
  templates
};
