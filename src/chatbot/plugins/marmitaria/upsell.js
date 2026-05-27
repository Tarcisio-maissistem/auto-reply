// plugins/marmitaria/upsell.js
// ═══════════════════════════════════════════════════════════════
// Motor de upsell inteligente — momento certo, produto certo
// ═══════════════════════════════════════════════════════════════

const { DEFAULT_CARDAPIO } = require('./cardapio');

/**
 * Calcula score de relevância de um item de upsell dado o contexto.
 */
function calcularUpsellScore(item, contexto) {
  let score = 0;

  if (contexto.periodo === 'almoco') score += item.score_almoco || 0;
  if (contexto.periodo === 'jantar') score += item.score_jantar || 0;
  if (contexto.multiplas)            score += item.score_multiplas || 0;

  // Bebidas sem score específico ficam com score base
  if (score === 0 && item.price) score = 0.3;

  return score;
}

/**
 * Seleciona a melhor bebida para oferecer ao cliente baseado no contexto.
 * Retorna null se o cliente já tem bebida no pedido.
 */
function selecionarMelhorBebida(contexto, itensPedido, cardapio) {
  const bebidas = (cardapio || DEFAULT_CARDAPIO).upsellsBebida || DEFAULT_CARDAPIO.upsellsBebida;

  // Remove bebidas já no pedido
  const jaTemBebida = (itensPedido || []).some(i => i.tipo === 'extra');
  if (jaTemBebida) return null;

  // Ordena por score de contexto
  const rankeadas = bebidas
    .filter(b => b.price)
    .map(b => ({ ...b, score: calcularUpsellScore(b, contexto) }))
    .sort((a, b) => b.score - a.score);

  return rankeadas[0] || null;
}

/**
 * Determina se deve oferecer upsell neste momento.
 */
function deveOfereceUpsell(state, contexto) {
  if (contexto.temPressa) return false;
  if ((state.pedidoAtual.items || []).some(i => i.tipo === 'extra')) return false;
  return true;
}

/**
 * Gera mensagem de upsell adaptada ao contexto.
 */
function gerarMensagemUpsell(bebida, contexto) {
  if (!bebida) return null;

  if (contexto.multiplas) {
    return `Quer um *${bebida.name}* (R$ ${bebida.price}) para acompanhar? 🥤`;
  }

  if (contexto.periodo === 'almoco') {
    return `Vai querer uma bebida? Temos *${bebida.name}* por R$ ${bebida.price} 🥤`;
  }

  return `Deseja adicionar uma bebida? *${bebida.name}* – R$ ${bebida.price} 🥤`;
}

module.exports = {
  calcularUpsellScore,
  selecionarMelhorBebida,
  deveOfereceUpsell,
  gerarMensagemUpsell
};
