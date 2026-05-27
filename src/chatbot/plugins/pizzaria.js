// plugins/pizzaria.js
// ═══════════════════════════════════════════════════════════════
// Plugin Pizzaria — Fluxo: Tamanho → Sabor(es) → Borda → Upsell
// ═══════════════════════════════════════════════════════════════

const ai = require('../aiInterpreter');
const T = require('../templates');
const actionProcessor = require('../actionProcessor');

const business_type = 'pizzaria';

const FLOW_STEPS = [
  'MONTANDO_TAMANHO',
  'MONTANDO_SABOR',
  'MONTANDO_BORDA',
  'OFERECENDO_UPSELL'
];

const DEFAULT_CARDAPIO = {
  tamanhos: [
    { name: 'Brotinho', fatias: 4 },
    { name: 'Média', fatias: 6 },
    { name: 'Grande', fatias: 8 },
    { name: 'Gigante', fatias: 12 }
  ],
  sabores: [
    { name: 'Calabresa', apelidos: ['cala'] },
    { name: 'Marguerita', apelidos: ['margherita', 'margarita'] },
    { name: 'Portuguesa' },
    { name: 'Frango com Catupiry', apelidos: ['frango', 'catupiry'] },
    { name: 'Quatro Queijos', apelidos: ['4 queijos', '4queijos'] },
    { name: 'Pepperoni' },
    { name: 'Mussarela', apelidos: ['muçarela', 'muzarela'] },
    { name: 'Napolitana', apelidos: ['napo'] }
  ],
  bordas: [
    { name: 'Sem borda', price: 0 },
    { name: 'Catupiry', price: 8, apelidos: ['recheada'] },
    { name: 'Cheddar', price: 8 },
    { name: 'Chocolate', price: 10 }
  ],
  upsellsBebida: [
    { name: 'Refrigerante 2L', price: 12, apelidos: ['refri', 'coca', '2l'] },
    { name: 'Refrigerante Lata', price: 6, apelidos: ['lata'] },
    { name: 'Suco 1L', price: 10, apelidos: ['suco'] }
  ],
  upsellsSobremesa: [
    { name: 'Pizza Doce Brotinho', price: 18, apelidos: ['doce', 'chocolate'] }
  ],
  // Preços por tamanho
  precos: {
    'Brotinho': 25, 'Média': 38, 'Grande': 50, 'Gigante': 65
  },
  maxSabores: { 'Brotinho': 1, 'Média': 2, 'Grande': 3, 'Gigante': 4 }
};

function getFlowSteps() { return FLOW_STEPS; }
function getDefaultCardapio() { return DEFAULT_CARDAPIO; }

// ─── HANDLERS ─────────────────────────────────────────────────

function handleStep(etapa, text, state, cardapio) {
  switch (etapa) {
    case 'MONTANDO_TAMANHO': return handleTamanho(text, state, cardapio);
    case 'MONTANDO_SABOR': return handleSabor(text, state, cardapio);
    case 'MONTANDO_BORDA': return handleBorda(text, state, cardapio);
    case 'OFERECENDO_UPSELL': return handleUpsell(text, state, cardapio);
    default: return null;
  }
}

function handleTamanho(text, state, cardapio) {
  const lower = ai.normalizar(text);
  const tamanhos = cardapio.tamanhos || DEFAULT_CARDAPIO.tamanhos;
  const match = tamanhos.find(t =>
    ai.normalizar(t.name) === lower ||
    (t.apelidos && t.apelidos.some(a => ai.normalizar(a) === lower))
  );

  if (!match) {
    const opcoes = tamanhos.map(t => `• *${t.name}* (${t.fatias} fatias)`).join('\n');
    return { state, response: `Qual tamanho da pizza?\n${opcoes}` };
  }

  const precos = cardapio.precos || DEFAULT_CARDAPIO.precos;
  const maxSab = (cardapio.maxSabores || DEFAULT_CARDAPIO.maxSabores)[match.name] || 2;

  state._pizzaAtual = {
    tipo: 'pizza',
    tamanho: match.name,
    price: precos[match.name] || 40,
    quantity: 1,
    sabores: [],
    borda: null,
    _maxSabores: maxSab
  };

  state.etapa = 'MONTANDO_SABOR';
  const sabList = (cardapio.sabores || DEFAULT_CARDAPIO.sabores).map(s => s.name).join(', ');
  return { state, response: `Pizza *${match.name}*! Escolha até *${maxSab} sabor(es)*:\n🍕 ${sabList}` };
}

function handleSabor(text, state, cardapio) {
  const sabores = cardapio.sabores || DEFAULT_CARDAPIO.sabores;
  const selecionados = ai.interpretItensMultiplos(text, sabores);

  if (selecionados.length === 0) {
    const lower = ai.normalizar(text);
    if (/sim|pode|quero|ok|claro/.test(lower)) {
      return { state, response: `Quais sabores você quer? 🍕` };
    }
    return { state, response: `Não encontrei esse sabor. Escolha entre: ${sabores.map(s => s.name).join(', ')}` };
  }

  const max = state._pizzaAtual._maxSabores || 2;
  state._pizzaAtual.sabores.push(...selecionados.slice(0, max));

  state.etapa = 'MONTANDO_BORDA';
  const bordas = (cardapio.bordas || DEFAULT_CARDAPIO.bordas);
  const bordaList = bordas.filter(b => b.price > 0).map(b => `• ${b.name} (+R$ ${T.fmt(b.price)})`).join('\n');
  return { state, response: `Quer borda recheada?\n${bordaList}\n_(ou "sem borda")_` };
}

function handleBorda(text, state, cardapio) {
  const lower = ai.normalizar(text);
  const bordas = cardapio.bordas || DEFAULT_CARDAPIO.bordas;

  if (/nao|sem|normal|simples/.test(lower)) {
    state._pizzaAtual.borda = { name: 'Sem borda', price: 0 };
  } else {
    const match = bordas.find(b =>
      b.price > 0 && (
        ai.normalizar(b.name) === lower ||
        lower.includes(ai.normalizar(b.name)) ||
        (b.apelidos && b.apelidos.some(a => lower.includes(ai.normalizar(a))))
      )
    );
    if (!match) {
      return { state, response: `Não entendi. Quer borda recheada? (Catupiry, Cheddar, Chocolate ou sem borda)` };
    }
    state._pizzaAtual.borda = { name: match.name, price: match.price };
  }

  finalizarPizza(state);

  state.etapa = 'OFERECENDO_UPSELL';
  state._upsellPhase = 'bebida';
  const resumo = formatItemForSummary(state.pedidoAtual.items[state.pedidoAtual.items.length - 1]);
  return {
    state,
    response: [
      `🍕 *Pizza montada!*\n${resumo}`,
      `Quer adicionar uma bebida? 🥤\n${(cardapio.upsellsBebida || DEFAULT_CARDAPIO.upsellsBebida).map(b => `• ${b.name} (R$ ${T.fmt(b.price)})`).join('\n')}\n_(ou "não")_`
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
  const ultimaPizza = [...state.pedidoAtual.items].reverse().find(i => i.tipo === 'pizza');
  return { state, response: T.perguntarTipo(formatItemForSummary(ultimaPizza)) };
}

// ─── FAST TRACK ──────────────────────────────────────────────

function buildFastTrackItem(ftResult, cardapio) {
  // Pizzaria não suporta fast track completo por enquanto
  return null;
}

// ─── VALIDAÇÃO E PREÇO ───────────────────────────────────────

function validateItem(item) {
  const errors = [];
  if (item.tipo !== 'pizza') return { valid: true, errors: [] };
  if (!item.tamanho) errors.push('Tamanho não definido');
  if (!item.sabores || item.sabores.length === 0) errors.push('Pizza precisa de pelo menos um sabor');
  const price = item.base_price ?? item.price;
  if (!price || price <= 0) errors.push('Preço inválido');
  return { valid: errors.length === 0, errors };
}

function calculateItemPrice(item) {
  if (item.tipo !== 'pizza') return item.price || 0;
  const base = DEFAULT_CARDAPIO.precos[item.tamanho] || 40;
  const borda = (item.borda && item.borda.price) || 0;
  return base + borda;
}

function formatItemForSummary(item) {
  if (!item || item.tipo !== 'pizza') {
    if (item) return `• ${item.quantity || 1}x ${item.name} — R$ ${T.fmt(item.price * (item.quantity || 1))}`;
    return '';
  }
  let txt = `🍕 *Pizza ${item.tamanho}* — R$ ${T.fmt(item.price + ((item.borda && item.borda.price) || 0))}\n`;
  if (item.sabores?.length) txt += `Sabores: ${item.sabores.map(s => s.name).join(' / ')}\n`;
  if (item.borda && item.borda.name !== 'Sem borda') txt += `Borda: ${item.borda.name} (+R$ ${T.fmt(item.borda.price)})\n`;
  return txt;
}

// ─── HELPERS ─────────────────────────────────────────────────

function finalizarPizza(state) {
  if (state._pizzaAtual) {
    const pizza = state._pizzaAtual;
    delete pizza._maxSabores;
    state.pedidoAtual.items.push(pizza);
    state._pizzaAtual = null;
  }
}

const templates = {
  saudacao: (companyName) => [
    `Olá! Seja bem-vindo à *${companyName}*! 🍕`,
    `Temos pizzas de vários tamanhos. Qual você prefere?\n• Brotinho • Média • Grande • Gigante`
  ],
  saudacaoCliente: (nome, companyName) => [
    `Olá, *${nome}*! Bem-vindo de volta à *${companyName}*! 🍕`,
    `Qual tamanho de pizza hoje?`
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
