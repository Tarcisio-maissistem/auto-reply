// plugins/marmitaria/context.js
// ═══════════════════════════════════════════════════════════════
// Detector de contexto do cliente — adapta o fluxo
// Baseado no playbook: "pressa → direto", "indeciso → ajuda"
// ═══════════════════════════════════════════════════════════════

const ai = require('../../aiInterpreter');

function detectarContexto(text, state) {
  const lower = ai.normalizar(text || '');

  return {
    // Cliente quer ser rápido
    temPressa: /pressa|rapido|rápido|logo|urgente|agora|so um segundo/.test(lower),

    // Cliente está indeciso
    indeciso: /nao sei|o que voce recomenda|o que tem|me sugere|o que e bom|sugestao/.test(lower),

    // Cliente quer repetir
    querRepetir: /mesmo|igual|ultima vez|repete|de sempre/.test(lower),

    // Pedido completo na primeira mensagem (fast track)
    pedidoCompleto: text.length > 30 && (
      /\b(frango|carne|churrasco|costela|linguica)\b/.test(lower) &&
      /\b(arroz|feijao|macarrao|pure|tropeiro)\b/.test(lower)
    ),

    // Horário do pedido (influencia upsell)
    periodo: _detectarPeriodo(),

    // Pedido para mais de uma pessoa
    multiplas: (state._pendingMarmitas || 0) > 1 ||
      /\b(duas|dois|2|tres|3)\b.*marmita/.test(lower)
  };
}

function _detectarPeriodo() {
  const h = new Date().getHours();
  if (h >= 11 && h <= 14) return 'almoco';
  if (h >= 18 && h <= 21) return 'jantar';
  return 'outro';
}

/**
 * Verifica se o texto indica intenção de pular/negar uma etapa opcional.
 */
function isSkipIntent(text) {
  const lower = ai.normalizar(text || '');
  return /\b(nao|nada|pula|pular|sem|so isso|nenhum|nenhuma|n)\b/.test(lower);
}

module.exports = { detectarContexto, isSkipIntent, _detectarPeriodo };
