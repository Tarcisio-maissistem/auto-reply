// plugins/acougue/index.js
// ═══════════════════════════════════════════════════════════════
// Plugin Açougue v2 — Sessão B
// Fluxo: INICIO → PEDIDO_LIVRE/AGUARDANDO → REVISANDO → Upsell → Tipo/Pagamento
// ═══════════════════════════════════════════════════════════════

const ai = require('../../aiInterpreter');
const T = require('../../templates');
const { DEFAULT_CARDAPIO } = require('./cardapio');
const { parsePedidoAcougue, parseDeterministico } = require('./parser');
const { validateItem, calculateItemPrice } = require('./validator');
const tpl = require('./templates');

const business_type = 'acougue';

const FLOW_STEPS = [
  'MONTANDO_CORTE',              // compat legacy
  'PEDIDO_LIVRE_ACOUGUE',        // aguardando texto livre do cliente
  'AGUARDANDO_PEDIDO_ACOUGUE',   // alias para PEDIDO_LIVRE (Sessão B)
  'REVISANDO_PEDIDO_ACOUGUE',    // mostrando resumo, aguardando confirmação
  'OFERECENDO_UPSELL'
];

function getFlowSteps() { return FLOW_STEPS; }
function getDefaultCardapio() { return DEFAULT_CARDAPIO; }

// ─── HANDLERS ─────────────────────────────────────────────────

function handleStep(etapa, text, state, cardapio, company) {
  switch (etapa) {
    case 'MONTANDO_CORTE':
      return handlePedidoLivre(text, state, cardapio);

    case 'PEDIDO_LIVRE_ACOUGUE':
    case 'AGUARDANDO_PEDIDO_ACOUGUE':
      return handlePedidoLivre(text, state, cardapio);

    case 'REVISANDO_PEDIDO_ACOUGUE':
      return handleRevisao(text, state, cardapio);

    case 'OFERECENDO_UPSELL':
      return handleUpsell(text, state, cardapio);

    default:
      return null;
  }
}

/**
 * Recebe texto livre do cliente, faz parse e mostra resumo.
 */
function handlePedidoLivre(text, state, cardapio) {
  const c = cardapio || DEFAULT_CARDAPIO;

  const result = parseDeterministico(text, c);

  if (result.items.length === 0) {
    state.etapa = 'PEDIDO_LIVRE_ACOUGUE';
    return { state, response: tpl.pedidoNaoEntendido() };
  }

  // Calcula preço e adiciona itens
  for (const item of result.items) {
    item.estimated_price = calculateItemPrice(item);
    item.price = item.estimated_price;
    state.pedidoAtual.items.push(item);
  }

  // Calcula total estimado
  const totalEstimado = state.pedidoAtual.items
    .filter(i => i.tipo === 'corte')
    .reduce((sum, i) => sum + (i.estimated_price || 0), 0);

  state.etapa = 'REVISANDO_PEDIDO_ACOUGUE';
  const resumo = tpl.resumoPedido(
    state.pedidoAtual.items.filter(i => i.tipo === 'corte'),
    totalEstimado
  );

  return {
    state,
    response: [resumo, tpl.confirmarRevisao()]
  };
}

/**
 * Lida com a revisão: sim, não, corrigir, ou adicionar mais.
 */
function handleRevisao(text, state, cardapio) {
  const lower = ai.normalizar(text);
  const c = cardapio || DEFAULT_CARDAPIO;

  // Confirma
  if (/^(?:sim|ok|isso|confirma|certo|ta bom|blz|beleza)\b/.test(lower)) {
    state.etapa = 'OFERECENDO_UPSELL';
    state._upsellPhase = 'bebida';
    const upsells = c.upsellsBebida || DEFAULT_CARDAPIO.upsellsBebida;
    return {
      state,
      response: tpl.upsellAcougue(upsells)
    };
  }

  // Corrigir / mudar
  if (/^(?:nao|corrigir|mudar|trocar|tirar|errado)\b/.test(lower)) {
    if (/^nao$/.test(lower)) {
      state.pedidoAtual.items = state.pedidoAtual.items.filter(i => i.tipo !== 'corte');
      state.etapa = 'PEDIDO_LIVRE_ACOUGUE';
      return { state, response: `Ok, vamos recomeçar! O que vai querer? 🥩` };
    }
    state.etapa = 'PEDIDO_LIVRE_ACOUGUE';
    return { state, response: tpl.pedidoCorrigir() };
  }

  // Adicionar mais itens
  if (/^(?:adiciona|mais|tambem|e\s+mais|quero\s+mais)\b/.test(lower)) {
    const withoutPrefix = text.replace(/^(?:adiciona|mais|tambem|e\s+mais|quero\s+mais)\s*/i, '');
    if (withoutPrefix.length > 2) {
      return handlePedidoLivre(withoutPrefix, state, c);
    }
    state.etapa = 'PEDIDO_LIVRE_ACOUGUE';
    return { state, response: `O que mais vai querer? 🥩` };
  }

  // Tenta interpretar como novo pedido
  const tentativa = parseDeterministico(text, c);
  if (tentativa.items.length > 0) {
    return handlePedidoLivre(text, state, c);
  }

  return { state, response: `Pode confirmar com *sim*, dizer *não* para recomeçar, ou mandar mais itens. 😊` };
}

/**
 * Upsell (carvão, sal, farofa, etc)
 */
function handleUpsell(text, state, cardapio) {
  const c = cardapio || DEFAULT_CARDAPIO;
  const extras = ai.interpretUpsell(text, c.upsellsBebida || DEFAULT_CARDAPIO.upsellsBebida);
  if (extras && extras.length > 0) {
    extras.forEach(e => {
      state.pedidoAtual.items.push({
        tipo: 'extra', name: e.name, price: e.price, quantity: 1
      });
    });
  }

  state.etapa = 'AGUARDANDO_TIPO';
  const ultimoCorte = [...state.pedidoAtual.items].reverse().find(i => i.tipo === 'corte');
  return { state, response: tpl.perguntarTipo(tpl.formatItemForSummary(ultimoCorte)) };
}

// ─── INTERFACE OBRIGATÓRIA ────────────────────────────────────

function buildFastTrackItem() { return null; }

function formatItemForSummary(item) {
  return tpl.formatItemForSummary(item);
}

const templates = {
  saudacao: tpl.saudacao,
  saudacaoCliente: tpl.saudacaoCliente
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
