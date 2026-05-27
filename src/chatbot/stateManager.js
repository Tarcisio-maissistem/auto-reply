// src/chatbot/stateManager.js
// ═════════════════════════════════════════════════════════════════
// GERÊNCIA DE ESTADO E CACHE LOCAL (Sem Redis)
// Armazena sessões em memória e cache em NodeCache
// ═════════════════════════════════════════════════════════════════

const NodeCache = require('node-cache');
const appCache = new NodeCache({ stdTTL: 1800 }); // Cache de 30min para cardápio

const sessionStore = new Map();

function defaultState() {
  return {
    etapa: 'INICIO',
    pedidoAtual: {
      items: [],
      type: null,
      address: null,
      paymentMethod: null,
      deliveryFee: 0,
      trocoPara: null
    },
    _marmitaAtual: null,
    _pendingMarmitas: 1,
    _currentMarmitaNumber: 1,
    _upsellPhase: null,
    _confirmingAddress: false,
    _askedTroco: false,
    _history: '',
    aguardandoResposta: false,
    lastInteraction: Date.now()
  };
}

/**
 * Carrega estado em memória.
 */
async function getState(companyId, phone) {
  const key = `session:${companyId}:${phone}`;
  if (!sessionStore.has(key)) {
    sessionStore.set(key, defaultState());
  }
  // Clonar objeto para evitar problemas de referência mutável direta
  return JSON.parse(JSON.stringify(sessionStore.get(key)));
}

/**
 * Salva estado em memória.
 */
async function setState(companyId, phone, state) {
  const key = `session:${companyId}:${phone}`;
  state.lastInteraction = Date.now();
  sessionStore.set(key, JSON.parse(JSON.stringify(state)));
}

/**
 * Reseta o estado do cliente (fim de sessão).
 */
async function resetState(companyId, phone) {
  const key = `session:${companyId}:${phone}`;
  sessionStore.delete(key);
}

/**
 * Busca do cache local.
 */
async function cacheGet(key) {
  const val = appCache.get(key);
  return val !== undefined ? val : null;
}

/**
 * Grava no cache local.
 */
async function cacheSet(key, value) {
  appCache.set(key, value);
}

/**
 * Invalida cache local.
 */
async function cacheDel(key) {
  appCache.del(key);
}

module.exports = {
  getState,
  setState,
  resetState,
  cacheGet,
  cacheSet,
  cacheDel
};
