// src/ragFAQ.js
// ═════════════════════════════════════════════════════════════════
// RAG FAQ — Respostas usando dados reais do objeto company.
// Substitui o interceptFAQ hardcoded.
// Cada empresa tem seus próprios dados (horário, endereço, taxa etc.)
// ═════════════════════════════════════════════════════════════════

const { normalizar } = require('./aiInterpreter');

// Etapas onde "rua", "endereço" faz parte do fluxo (NÃO é FAQ)
const ETAPAS_ENDERECO = ['AGUARDANDO_ENDERECO', 'CONFIRMANDO', 'AGUARDANDO_NOME'];
// Etapas onde "pix" faz parte do pagamento
const ETAPAS_PAGAMENTO = ['AGUARDANDO_PAGAMENTO', 'CONFIRMANDO'];

/**
 * Constrói base de conhecimento dinâmica a partir do company.
 * Retorna array de { pattern, answer, blockedStages? }
 */
function buildKB(company) {
  const kb = [];

  // ─── Horário ───────────────────────────────────────────────
  if (company.opening_hours) {
    kb.push({
      id: 'horario',
      patterns: [/funcionando|aberto|horario|relogio|fecha|fecham|que horas|abre|abrem/],
      answer: `Nosso horário: ${company.opening_hours}. 😊`
    });
  }

  // ─── Localização ───────────────────────────────────────────
  if (company.address) {
    kb.push({
      id: 'localizacao',
      patterns: [/onde.+fica|localizacao|endereco da loja|rua da loja|como chego/],
      blockedStages: ETAPAS_ENDERECO,
      // Não ativa se text contém "entrega" (é endereço de entrega, não pergunta)
      blockedWords: ['entrega'],
      answer: `Estamos na ${company.address}. 😊`
    });
  }

  // ─── Formas de pagamento ───────────────────────────────────
  kb.push({
    id: 'cartao',
    patterns: [/aceita.*cartao|maquininha|passa.*cartao|credito|debito|cartao.*credito|cartao.*debito/],
    answer: `Sim! Aceitamos débito e crédito na entrega. 😊`
  });

  // ─── Taxa de entrega ──────────────────────────────────────
  if (company.delivery_fee != null) {
    kb.push({
      id: 'taxa',
      patterns: [/valor da entrega|frete|taxa/],
      answer: `A taxa de entrega é de R$ ${_fmt(company.delivery_fee)}. 😊`
    });
  }

  // ─── Pix ──────────────────────────────────────────────────
  kb.push({
    id: 'pix',
    patterns: [/aceita pix|tem pix|chave pix/],
    blockedStages: ETAPAS_PAGAMENTO,
    blockedWords: ['pagar'],
    answer: company.pix_key
      ? `Sim, aceitamos Pix! Chave: ${company.pix_key} 😊`
      : `Sim, aceitamos Pix! 😊`
  });

  // ─── Tempo de entrega ─────────────────────────────────────
  if (company.estimated_time_default) {
    kb.push({
      id: 'tempo',
      patterns: [/quanto tempo|demora|tempo de entrega|prazo|previsao/],
      answer: `O tempo estimado de entrega é de ${company.estimated_time_default} minutos. 😊`
    });
  }

  // ─── Cardápio / o que tem ─────────────────────────────────
  kb.push({
    id: 'cardapio',
    patterns: [/cardapio|o que tem|quais opcoes|menu|o que voces tem/],
    // Não ativa durante montagem (já estamos mostrando opções)
    blockedStages: ['MONTANDO_PROTEINA', 'MONTANDO_ACOMPANHAMENTO', 'MONTANDO_SALADA', 'OFERECENDO_UPSELL'],
    answer: `Temos marmitas:\n• *Pequena* — *R$ 20,00*\n• *Grande* — *R$ 22,00*\n\nPode escolher o tamanho para começar! 😊`
  });

  // ─── Entrega / Retirada ───────────────────────────────────
  kb.push({
    id: 'entrega_retirada',
    patterns: [/faz entrega|tem entrega|so delivery|pode retirar|retirar pessoalmente|buscar pessoalmente|entregam|posso retirar|posso buscar|so retirada/],
    blockedStages: ['AGUARDANDO_TIPO', 'FINALIZADO'],
    answer: company.delivery_fee != null
      ? `Sim! Fazemos entrega (taxa R$ ${_fmt(company.delivery_fee)}) e também aceitamos retirada no balcão. 😊`
      : `Sim! Fazemos entrega e também aceitamos retirada no balcão. 😊`
  });

  // ─── Fix 5: Novas FAQs — Pagamento dividido ───────────────
  kb.push({
    id: 'pagamento_dividido',
    patterns: [/dividir.*pagamento|metade.*pix.*metade|metade.*dinheiro|metade.*cartao|pagar.*duas.*formas|dividir.*pagar|dois.*pagamentos/],
    blockedStages: ETAPAS_PAGAMENTO,
    answer: 'No momento aceitamos apenas uma forma de pagamento por pedido: Pix, Cartão ou Dinheiro. 😊'
  });

  // ─── Fix 5: Vegetariano/Vegano ────────────────────────────
  kb.push({
    id: 'vegetariano',
    patterns: [/vegetarian|vegano|vegana|sem carne|opcao.*sem.*carne|so.*legume|so.*verdura/],
    answer: 'Você pode montar sua marmita com acompanhamentos e salada sem proteína! É só pedir "sem proteína" quando perguntar. 😊🌿'
  });

  // ─── Fix 5: Pedido mínimo ─────────────────────────────────
  kb.push({
    id: 'pedido_minimo',
    patterns: [/pedido.*minimo|minimo.*entrega|valor.*minimo|tem.*minimo/],
    answer: 'Não temos pedido mínimo! Pode pedir a partir de 1 marmita. 😊'
  });

  // ─── Fix 5: Agendamento ───────────────────────────────────
  kb.push({
    id: 'agendamento',
    patterns: [/agendar|agendamento|amanha|programar|para.*depois|encomenda|reservar/],
    answer: 'No momento atendemos somente pedidos para entrega imediata. Mas pode nos chamar quando estiver pronto para pedir! 😊'
  });

  // ─── Fix 5: Promoção ──────────────────────────────────────
  kb.push({
    id: 'promocao',
    patterns: [/promocao|promo|desconto|cupom|oferta|tem.*promocao|alguma.*promocao/],
    answer: 'No momento não temos promoções ativas. Mas fica de olho nas nossas redes sociais! 😊📱'
  });

  // ─── Fix 5: Embalagem ─────────────────────────────────────
  kb.push({
    id: 'embalagem',
    patterns: [/embalagem|descartavel|recipiente|marmitex|pote|isopor|aluminio/],
    answer: 'Nossas marmitas vão em embalagens descartáveis de alumínio, perfeitas para manter a comida quentinha! 😊♨️'
  });

  return kb;
}

/**
 * Tenta responder uma pergunta FAQ usando dados reais da empresa.
 * 
 * @param {string} text - Mensagem do cliente
 * @param {object} company - Objeto company do banco
 * @param {string} etapa - Etapa atual do fluxo
 * @returns {string|null} Resposta FAQ ou null se não for FAQ
 */
function answer(text, company, etapa) {
  if (!company) return null;

  const lower = normalizar(text);
  const kb = buildKB(company);

  for (const entry of kb) {
    // Verifica se a etapa bloqueia esta FAQ
    if (entry.blockedStages && entry.blockedStages.includes(etapa)) continue;

    // Verifica palavras bloqueantes no texto
    if (entry.blockedWords && entry.blockedWords.some(w => lower.includes(w))) continue;

    // Testa cada padrão
    for (const pattern of entry.patterns) {
      if (pattern.test(lower)) {
        return entry.answer;
      }
    }
  }

  return null;
}

function _fmt(value) {
  return Number(value || 0).toFixed(2).replace('.', ',');
}

module.exports = { answer, buildKB };
