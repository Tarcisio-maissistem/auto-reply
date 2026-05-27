// plugins/marmitaria/index.js
// ═══════════════════════════════════════════════════════════════
// Plugin Marmitaria v2 — Fluxo inteligente com contexto
// Melhoria: detecta contexto, salada opcional, upsell contextual,
// proteína + acompanhamento juntos na mesma mensagem
// ═══════════════════════════════════════════════════════════════

const ai = require('../../aiInterpreter');
const T = require('../../templates');
const actionProcessor = require('../../actionProcessor');
const { DEFAULT_CARDAPIO, COMBOS } = require('./cardapio');
const { detectarContexto, isSkipIntent } = require('./context');
const { selecionarMelhorBebida, deveOfereceUpsell, gerarMensagemUpsell } = require('./upsell');
const { validateItem, calculateItemPrice, formatItemForSummary } = require('./validator');
const tpl = require('./templates');

const business_type = 'marmitaria';

const FLOW_STEPS = [
  'MONTANDO_TAMANHO',
  'MONTANDO_PROTEINA',
  'MONTANDO_ACOMPANHAMENTO',
  'MONTANDO_SALADA',
  'OFERECENDO_UPSELL'
];

function getFlowSteps() { return FLOW_STEPS; }
function getDefaultCardapio() { return DEFAULT_CARDAPIO; }

// ─── HANDLERS ─────────────────────────────────────────────────

function handleStep(etapa, text, state, cardapio) {
  // Se estamos em modo de grupos, delega ao stateMachine
  // O plugin não suporta grupos (usa _marmitaAtual)
  if (state._grupos && state._grupos.length > 0) {
    return null;
  }
  
  const c = cardapio || DEFAULT_CARDAPIO;
  const ctx = detectarContexto(text, state);

  switch (etapa) {
    case 'MONTANDO_TAMANHO':
      return handleTamanho(text, state, ctx, c);
    case 'MONTANDO_PROTEINA':
      return handleProteina(text, state, ctx, c);
    case 'MONTANDO_ACOMPANHAMENTO':
      return handleAcompanhamento(text, state, ctx, c);
    case 'MONTANDO_SALADA':
      return handleSalada(text, state, ctx, c);
    case 'OFERECENDO_UPSELL':
      return handleUpsell(text, state, ctx, c);
    default:
      return null;
  }
}

// ─── TAMANHO ──────────────────────────────────────────────────

function handleTamanho(text, state, ctx, cardapio) {
  // Detecta combo (indeciso que quer sugestão rápida)
  if (ctx.indeciso) {
    const combo = matchCombo(text, cardapio);
    if (combo) {
      return montarCombo(combo, state, ctx, cardapio);
    }
    // Oferece combo padrão
    const combos = cardapio.combos || COMBOS;
    if (combos.length > 0) {
      return { state, response: tpl.recomendarCombo(combos[0]) };
    }
  }

  const tamanho = interpretTamanhoPlugin(text, cardapio);
  const qty = ai.interpretQuantity(text) || 1;

  if (!tamanho) {
    const tamanhos = cardapio.tamanhos || DEFAULT_CARDAPIO.tamanhos;
    return { state, response: tpl.tamanhoNaoEntendido(tamanhos) };
  }

  const tamanhoObj = (cardapio.tamanhos || DEFAULT_CARDAPIO.tamanhos)
    .find(t => t.name === tamanho || t.id === tamanho.toLowerCase());

  state._pendingMarmitas = qty;
  state._currentMarmitaNumber = 1;
  state._tamanhoAtual = tamanhoObj || null;
  iniciarNovaMarmita(tamanhoObj || { name: tamanho, price: tamanho === 'Grande' ? 22 : 20 }, state);
  state.etapa = 'MONTANDO_PROTEINA';

  const msg = ctx.temPressa
    ? tpl.pedirProteinaRapido(tamanhoObj, qty)
    : tpl.pedirProteina(tamanhoObj, qty);

  return { state, response: msg };
}

// ─── PROTEÍNA ─────────────────────────────────────────────────

function handleProteina(text, state, ctx, cardapio) {
  const proteinas = ai.interpretItensMultiplos(text, cardapio.proteinas || DEFAULT_CARDAPIO.proteinas);
  const tamanhoObj = state._tamanhoAtual;
  const maxProteinas = tamanhoObj ? tamanhoObj.max_proteinas : 2;

  if (proteinas.length === 0) {
    const lower = ai.normalizar(text);
    if (isSkipIntent(text)) {
      state.etapa = 'MONTANDO_ACOMPANHAMENTO';
      return { state, response: tpl.pedirAcompanhamento(cardapio) };
    }
    if (/sim|pode|quero|ok|claro/.test(lower)) {
      return { state, response: tpl.pedirProteina(tamanhoObj, state._pendingMarmitas || 1) };
    }
    return { state, response: tpl.proteinaNaoEntendida(cardapio.proteinas) };
  }

  state._marmitaAtual.proteinas.push(...proteinas.slice(0, maxProteinas));

  // OTIMIZAÇÃO: se o cliente mandou acompanhamentos na mesma mensagem
  const acomps = ai.interpretItensMultiplos(text, cardapio.acompanhamentos || DEFAULT_CARDAPIO.acompanhamentos);
  if (acomps.length > 0) {
    const maxAcomps = tamanhoObj ? tamanhoObj.max_acompanhamentos : 2;
    state._marmitaAtual.acompanhamentos.push(...acomps.slice(0, maxAcomps));

    // Verifica também saladas
    const saladas = ai.interpretItensMultiplos(text, cardapio.saladas || DEFAULT_CARDAPIO.saladas);
    if (saladas.length > 0) {
      const maxSaladas = tamanhoObj ? tamanhoObj.max_saladas : 2;
      state._marmitaAtual.saladas.push(...saladas.slice(0, maxSaladas));
    }

    // Proteína + acompanhamento juntos → finaliza (salada já capturada ou vazia)
    finalizarMarmitaAtual(state);
    return avancarAposUltimaMarmita(state, ctx, cardapio);
  }

  state.etapa = 'MONTANDO_ACOMPANHAMENTO';
  return { state, response: tpl.pedirAcompanhamento(cardapio) };
}

// ─── ACOMPANHAMENTO ───────────────────────────────────────────

function handleAcompanhamento(text, state, ctx, cardapio) {
  const selecionados = ai.interpretItensMultiplos(text, cardapio.acompanhamentos || DEFAULT_CARDAPIO.acompanhamentos);

  if (selecionados.length === 0 && text.length > 2) {
    const lower = ai.normalizar(text);
    if (!isSkipIntent(text) && !/sim|pode|quero|ok|claro/.test(lower)) {
      return { state, response: tpl.acompanhamentoNaoEntendido() };
    }
    if (/sim|pode|quero|ok|claro/.test(lower)) {
      return { state, response: tpl.pedirAcompanhamento(cardapio) };
    }
  }

  const maxAcomps = state._tamanhoAtual ? state._tamanhoAtual.max_acompanhamentos : 2;
  state._marmitaAtual.acompanhamentos.push(...selecionados.slice(0, maxAcomps));

  // Tenta capturar saladas na mesma mensagem
  const saladas = ai.interpretItensMultiplos(text, cardapio.saladas || DEFAULT_CARDAPIO.saladas);
  if (saladas.length > 0) {
    const maxSaladas = state._tamanhoAtual ? state._tamanhoAtual.max_saladas : 2;
    state._marmitaAtual.saladas.push(...saladas.slice(0, maxSaladas));
  }
  
  finalizarMarmitaAtual(state);
  return avancarAposUltimaMarmita(state, ctx, cardapio);
}

// ─── SALADA (OPCIONAL) ────────────────────────────────────────

function handleSalada(text, state, ctx, cardapio) {
  const saladas = ai.interpretItensMultiplos(text, cardapio.saladas || DEFAULT_CARDAPIO.saladas);

  if (saladas.length === 0) {
    // Salada é sempre opcional — qualquer negação ou não reconhecer avança
    const lower = ai.normalizar(text);
    if (!isSkipIntent(text) && !/sim|pode|quero|ok|claro/.test(lower) && text.length > 2) {
      // Tenta mais uma vez se não é pular nem confirmação vazia
      return { state, response: tpl.saladaNaoEntendida() };
    }
    if (/sim|pode|quero|ok|claro/.test(lower)) {
      return { state, response: tpl.pedirSalada(cardapio) };
    }
    // Skip — avança sem salada sem perguntar de novo
    finalizarMarmitaAtual(state);
    return avancarAposUltimaMarmita(state, ctx, cardapio);
  }

  const maxSaladas = state._tamanhoAtual ? state._tamanhoAtual.max_saladas : 2;
  state._marmitaAtual.saladas.push(...saladas.slice(0, maxSaladas));
  finalizarMarmitaAtual(state);
  return avancarAposUltimaMarmita(state, ctx, cardapio);
}

// ─── UPSELL ───────────────────────────────────────────────────

function handleUpsell(text, state, ctx, cardapio) {
  if (state._upsellPhase === 'bebida') {
    const bebidas = ai.interpretUpsell(text, cardapio.upsellsBebida || DEFAULT_CARDAPIO.upsellsBebida);
    if (bebidas && bebidas.length > 0) {
      bebidas.forEach(bebida => {
        state.pedidoAtual.items.push({
          tipo: 'extra',
          name: bebida.name,
          price: bebida.price,
          quantity: bebida.quantity || 1
        });
      });
    }

    state._upsellDone = true;

    // Se tipo e pagamento já foram capturados (via fast track), pula direto
    if (state.pedidoAtual.type && state.pedidoAtual.paymentMethod) {
      const temEndereco = state.pedidoAtual.type === 'pickup' || !!state.pedidoAtual.address;
      if (temEndereco) {
        state.etapa = 'CONFIRMANDO';
        return null; // Delega buildConfirmation ao stateMachine
      }
      if (state.pedidoAtual.type === 'delivery' && !state.pedidoAtual.address) {
        state.etapa = 'AGUARDANDO_ENDERECO';
        return { state, response: T.pedirEndereco() };
      }
    }

    if (state.pedidoAtual.type) {
      if (state.pedidoAtual.type === 'pickup') {
        state.etapa = 'AGUARDANDO_PAGAMENTO';
        return { state, response: T.pedirPagamento() };
      }
      state.etapa = 'AGUARDANDO_ENDERECO';
      return { state, response: T.pedirEndereco() };
    }

    state.etapa = 'AGUARDANDO_TIPO';
    const ultimaMarmita = [...state.pedidoAtual.items].reverse().find(i => i.tipo === 'marmita');
    return { state, response: T.perguntarTipo(T._formatarMarmita(ultimaMarmita)) };
  }

  state.etapa = 'AGUARDANDO_TIPO';
  return { state, response: T.perguntarTipo('') };
}

// ─── LÓGICA PÓS-MARMITA ──────────────────────────────────────

function avancarAposUltimaMarmita(state, ctx, cardapio) {
  // Tem mais marmitas?
  if (state._currentMarmitaNumber < state._pendingMarmitas) {
    state._currentMarmitaNumber++;
    state.etapa = 'MONTANDO_TAMANHO';
    return {
      state,
      response: tpl.proximaMarmita(state._currentMarmitaNumber, state._pendingMarmitas)
    };
  }

  // Última marmita — decidir sobre upsell
  if (deveOfereceUpsell(state, ctx)) {
    const bebida = selecionarMelhorBebida(ctx, state.pedidoAtual.items, cardapio);
    if (bebida) {
      state.etapa = 'OFERECENDO_UPSELL';
      state._upsellPhase = 'bebida';
      state._upsellSugerido = bebida;
      const resumoCurto = tpl.formatarResumoMarmitas(state.pedidoAtual.items);
      return {
        state,
        response: [resumoCurto || T.itemMontado(), gerarMensagemUpsell(bebida, ctx)]
      };
    }
  }

  // Sem upsell (pressa ou já tem bebida) → direto para upsell genérico
  state.etapa = 'OFERECENDO_UPSELL';
  state._upsellPhase = 'bebida';
  return {
    state,
    response: tpl.oferecerUpsellBebida(T.itemMontado())
  };
}

// ─── FAST TRACK ──────────────────────────────────────────────

function buildFastTrackItem(ftResult, cardapio) {
  const ftValidado = actionProcessor.processAction(ftResult, cardapio);
  if (!ftValidado || !ftValidado.sucesso) return null;

  const c = cardapio || DEFAULT_CARDAPIO;
  const tamanhos = c.tamanhos || DEFAULT_CARDAPIO.tamanhos;
  const tamanhoObj = tamanhos.find(t => t.name === ftValidado.tamanho) ||
    tamanhos.find(t => t.id === (ftValidado.tamanho || '').toLowerCase());
  const preco = tamanhoObj ? tamanhoObj.price : (ftValidado.tamanho.toLowerCase() === 'grande' ? 22 : 20);

  return {
    tipo: 'marmita',
    tamanho: ftValidado.tamanho,
    price: preco,
    quantity: 1,
    proteinas: (ftValidado.proteinas || []).map(p => ({ name: p })),
    acompanhamentos: (ftValidado.acompanhamentos || []).map(a => ({ name: a })),
    saladas: (ftValidado.saladas || []).map(s => ({ name: s }))
  };
}

// ─── COMBOS ───────────────────────────────────────────────────

function matchCombo(text, cardapio) {
  const lower = ai.normalizar(text);
  const combos = cardapio.combos || COMBOS;
  for (const combo of combos) {
    if (combo.triggers.some(t => lower.includes(ai.normalizar(t)))) {
      return combo;
    }
  }
  return null;
}

function montarCombo(combo, state, ctx, cardapio) {
  const c = cardapio || DEFAULT_CARDAPIO;
  const tamanhos = c.tamanhos || DEFAULT_CARDAPIO.tamanhos;
  const tamanhoObj = tamanhos.find(t => t.name === combo.tamanho);
  const preco = tamanhoObj ? tamanhoObj.price : 22;

  state._pendingMarmitas = 1;
  state._currentMarmitaNumber = 1;
  state._tamanhoAtual = tamanhoObj;
  state._marmitaAtual = {
    tipo: 'marmita',
    tamanho: combo.tamanho,
    price: preco,
    quantity: 1,
    proteinas: combo.proteinas.map(p => ({ name: p })),
    acompanhamentos: combo.acompanhamentos.map(a => ({ name: a })),
    saladas: (combo.saladas || []).map(s => ({ name: s }))
  };

  finalizarMarmitaAtual(state);
  return avancarAposUltimaMarmita(state, ctx, cardapio);
}

// ─── HELPERS INTERNOS ────────────────────────────────────────

function interpretTamanhoPlugin(text, cardapio) {
  // Primeiro tenta interpretar usando apelidos do cardápio
  const lower = ai.normalizar(text);
  const tamanhos = (cardapio || DEFAULT_CARDAPIO).tamanhos || DEFAULT_CARDAPIO.tamanhos;
  for (const t of tamanhos) {
    if (t.apelidos && t.apelidos.some(a => new RegExp(`\\b${a}\\b`).test(lower))) {
      return t.name;
    }
  }
  // Fallback para o interpretador do aiInterpreter
  return ai.interpretTamanho(text);
}

function iniciarNovaMarmita(tamanhoObj, state) {
  state._marmitaAtual = {
    tipo: 'marmita',
    tamanho: tamanhoObj.name,
    price: tamanhoObj.price,
    quantity: 1,
    proteinas: [],
    acompanhamentos: [],
    saladas: []
  };
}

function finalizarMarmitaAtual(state) {
  if (state._marmitaAtual) {
    state.pedidoAtual.items.push(state._marmitaAtual);
    state._marmitaAtual = null;
  }
}

// ─── INTERFACE OBRIGATÓRIA ────────────────────────────────────

const templates = {
  saudacao: function(companyName) {
    return tpl.saudacao(companyName);
  },
  saudacaoCliente: function(nome, companyName) {
    return tpl.saudacaoCliente(nome, companyName);
  }
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
