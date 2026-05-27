// src/intentRouter.js
// ═════════════════════════════════════════════════════════════════
// INTENT ROUTER — Classificação global de intenção ANTES do state switch.
// Toda mensagem passa por aqui primeiro. Se for intenção global (FAQ,
// reclamação de fluxo, falar com humano), resolve aqui.
// Se não, devolve null e o handler de etapa cuida.
// ═════════════════════════════════════════════════════════════════

const { normalizar, interpretQuantity, interpretTamanho } = require('./aiInterpreter');
const ragFAQ = require('./ragFAQ');
const T = require('./templates');

// ─── UTILITÁRIO: Variação aleatória de respostas ─────────────────────────────
function _pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Etapas onde texto sobre endereço/rua faz parte do fluxo (NÃO é FAQ)
const ETAPAS_BLOQUEIAM_FAQ_ENDERECO = ['AGUARDANDO_ENDERECO', 'CONFIRMANDO', 'AGUARDANDO_NOME'];

// Etapas onde "pix" faz parte do fluxo de pagamento
const ETAPAS_BLOQUEIAM_FAQ_PIX = ['AGUARDANDO_PAGAMENTO', 'CONFIRMANDO'];

/**
 * Classifica a intenção global de uma mensagem.
 *
 * @param {string} text - Mensagem do cliente
 * @param {object} state - Estado atual da sessão
 * @param {object} company - Objeto company do banco
 * @returns {{ intent: string, response: string|string[], _skipHumanize?: boolean, _internalNote?: string, _flagHumano?: boolean, _redirectTo?: string } | null}
 *   Retorna objeto se a intenção foi tratada globalmente.
 *   Retorna null se deve ir para o handler da etapa.
 */
function classify(text, state, company) {
  const lower = normalizar(text);
  const etapa = state.etapa;

  // ─── 0. CANCELAMENTO ─────────────────────────────────────────────
  // Detecta PRIMEIRO: "cancela", "cancelar", "desisti", "para"
  const cancelIntent = detectCancel(lower, state);
  if (cancelIntent) return cancelIntent;

  // ─── 0b. FRUSTRAÇÃO ─────────────────────────────────────────────
  // "aff que chato", "que chato", "irritado", "impossível"
  const frustrationIntent = detectFrustration(lower, state);
  if (frustrationIntent) return frustrationIntent;

  // ─── 0c. RESTART / DESISTÊNCIA SUAVE ───────────────────────────
  // "deixa quieto", "esquece", "começa de novo"
  const restartIntent = detectRestart(lower, state);
  if (restartIntent) return restartIntent;

  // ─── 1. RECLAMAÇÃO DE FLUXO ────────────────────────────────────────
  // "sim mas eu não falei o troco", "ok mas não disse o endereço"
  // Detecta ANTES do FAQ para não confundir com pergunta genérica
  const flowComplaint = detectFlowComplaint(lower, state);
  if (flowComplaint) return flowComplaint;

  // ─── 1a. REMOÇÃO GERAL DE ITENS ─────────────────────────────────────
  // "remove um suco", "tira a marmita", "exclui o refrigerante"
  const itemRemoval = detectItemRemoval(lower, state);
  if (itemRemoval) return itemRemoval;

  // ─── 1b. CORREÇÃO DE BEBIDAS ───────────────────────────────────────
  // "faltou as 3 cocas", "minhas bebidas", "pedi 3 refris"
  const drinkCorrection = detectDrinkCorrection(lower, state);
  if (drinkCorrection) return drinkCorrection;

  // ─── 1b. CORREÇÃO DE QUANTIDADE DE MARMITAS ────────────────────────
  // "são 3 marmitas", "falei que são 3 grandes" — só fora da montagem
  const qtCorrection = detectQuantityCorrection(lower, state);
  if (qtCorrection) return qtCorrection;

  // ─── 2. FALAR COM HUMANO ───────────────────────────────────────────
  if (/falar com (alguem|atendente|humano|pessoa|gente)|atendimento humano|chamar (gerente|dono)|quero falar com|me passa pra (alguem|uma? pessoa|gente|atendente|pessoa real)/.test(lower)) {
    return {
      intent: 'FALAR_HUMANO',
      response: 'Vou chamar um atendente para te ajudar! Aguarde um momento. 😊',
      _skipHumanize: true,
      _flagHumano: true
    };
  }

  // ─── 2b. MOSTRAR RESUMO DO PEDIDO ──────────────────────────────────
  // "mostra o resumo", "o que eu pedi", "qual meu pedido", "ver meu pedido"
  const askSummary = detectAskSummary(lower, state);
  if (askSummary) return askSummary;

  // ─── 3. FAQ (via RAG) ─────────────────────────────────────────────
  const faqAnswer = ragFAQ.answer(text, company, etapa);
  if (faqAnswer) {
    const contexto = T.contextoEtapa(etapa);
    return {
      intent: 'FAQ',
      response: [faqAnswer, contexto].filter(Boolean),
      _skipHumanize: true,
      _isFAQ: true
    };
  }

  // ─── Não é intenção global ────────────────────────────────────────
  return null;
}

/**
 * Detecta reclamações sobre etapas faltantes no fluxo.
 * Ex: "sim mas eu não falei o troco" → volta para coletar troco.
 */
function detectFlowComplaint(lower, state) {
  // Padrão: positivo + "mas" + negação + referência a dado faltante
  const isComplaint = /mas\s+(eu\s+)?(nao|n)\s+(falei|disse|informei|coloquei|digitei|mandei|escolhi|pedi)/.test(lower);
  if (!isComplaint) return null;

  // Identifica O QUE está faltando
  const pedido = state.pedidoAtual || {};

  // Troco faltando
  if (/troco/.test(lower) && pedido.paymentMethod === 'Dinheiro' && pedido.trocoPara == null) {
    state._askedTroco = true;
    state.etapa = 'AGUARDANDO_PAGAMENTO';
    return {
      intent: 'RECLAMACAO_FLUXO',
      response: 'Tem razão! Vai precisar de troco? Se sim: "troco pra 50". Se não: "sem troco".',
      _skipHumanize: true
    };
  }

  // Endereço faltando/errado
  if (/endereco|endereço|rua/.test(lower) && pedido.type === 'delivery') {
    state._confirmingAddress = false;
    state.etapa = 'AGUARDANDO_ENDERECO';
    return {
      intent: 'RECLAMACAO_FLUXO',
      response: 'Tem razão! Pode me informar o endereço completo?\n_(Rua, número, bairro e complemento)_',
      _skipHumanize: true
    };
  }

  // Pagamento faltando
  if (/pagamento|pagar|forma/.test(lower) && !pedido.paymentMethod) {
    state.etapa = 'AGUARDANDO_PAGAMENTO';
    return {
      intent: 'RECLAMACAO_FLUXO',
      response: 'Tem razão! Vai ser no *Pix, Cartão ou Dinheiro*?',
      _skipHumanize: true
    };
  }

  // Reclamação genérica (não conseguiu mapear o dado faltante)
  return {
    intent: 'RECLAMACAO_FLUXO',
    response: null,
    _internalNote: 'O cliente reclamou que algo não foi coletado. Cheque se falta troco, endereço ou pagamento.',
    _isFlowComplaint: true
  };
}

/**
 * Detecta reclamação/correção sobre bebidas faltando ou solicitação para remover.
 * Ex: "faltou as 3 cocas", "remove um suco", "tira o refrigerante"
 * Ativa em etapas pós-upsell (AGUARDANDO_TIPO, CONFIRMANDO, etc.)
 */
function detectDrinkCorrection(lower, state) {
  // Só ativa em etapas pós-upsell
  const etapasAtivas = ['AGUARDANDO_TIPO', 'AGUARDANDO_ENDERECO', 'AGUARDANDO_PAGAMENTO', 'CONFIRMANDO'];
  if (!etapasAtivas.includes(state.etapa)) return null;

  // Se é um comando de modificação (adiciona/troca/retira/coloca), deixa o handler processar
  if (/\b(adiciona|adicionar|troca|trocar|retira|retirar|remove|remover|tira|tirar|coloca|colocar|substitui|substituir|sem|exclui|excluir|cancela|cancelar)\b/.test(lower)) return null;

  // Detecta menção a bebidas
  const bebidaRegex = /coca|refri|refrigerante|suco|lata|guarana|fanta|bebida/;
  if (!bebidaRegex.test(lower)) return null;

  const isRemoval = /remove(r)?|tira(r)?|exclui(r)?|cancela(r)?|men(os)/.test(lower);
  const reclamacaoRegex = /faltou|faltando|minhas?|pedi|cadê|cade|nao veio|sumiu|esqueceu/;
  const quantidadeRegex = /(\d+)\s*(coca|refri|refrigerante|suco|lata|guarana|fanta|bebida)/;
  const quantidadeExtensoRegex = /(uma?|dois|duas|tr[eê]s|quatro|cinco|seis)\s*(coca|refri|refrigerante|suco|lata|guarana|fanta|bebida)/;

  if (!reclamacaoRegex.test(lower) && !quantidadeRegex.test(lower) && !quantidadeExtensoRegex.test(lower) && !isRemoval) {
    return null;
  }

  // Extrai quantidade
  const PALAVRAS_NUM = {
    'um': 1, 'uma': 1, 'dois': 2, 'duas': 2,
    'tres': 3, 'três': 3, 'quatro': 4, 'cinco': 5, 'seis': 6
  };

  let quantidade = 1;
  const matchDigito = lower.match(/(\d+)\s*(coca|refri|refrigerante|suco|lata|guarana|fanta|bebida)/);
  const matchExtenso = lower.match(/(uma?|dois|duas|tr[eê]s|quatro|cinco|seis)\s*(coca|refri|refrigerante|suco|lata|guarana|fanta|bebida)/);
  
  if (matchDigito) {
    quantidade = parseInt(matchDigito[1]);
  } else if (matchExtenso) {
    quantidade = PALAVRAS_NUM[matchExtenso[1]] || 1;
  }

  // Determina tipo de bebida
  let tipoFalado = 'Refrigerante Lata';
  let preco = 6;
  if (/suco/.test(lower)) {
    tipoFalado = 'Suco Natural';
    preco = 8;
  }

  // Atualiza o pedido
  const extras = state.pedidoAtual.items.filter(i => i.tipo === 'extra');
  const extraExistente = extras.find(e => normalizar(e.name).includes(normalizar(tipoFalado).split(' ')[0].toLowerCase()));

  let confirmacoes = [];

  if (isRemoval) {
    if (extraExistente) {
      if (extraExistente.quantity > quantidade) {
        extraExistente.quantity -= quantidade;
        confirmacoes = [
          `Removido! O pedido agora tem ${extraExistente.quantity}x ${tipoFalado}. 👍`,
          `Pronto, retirei ${quantidade}x ${tipoFalado} e ficaram ${extraExistente.quantity}x. ✅`
        ];
      } else {
        // Remover completamente
        const index = state.pedidoAtual.items.indexOf(extraExistente);
        if (index !== -1) state.pedidoAtual.items.splice(index, 1);
        confirmacoes = [
          `Removido! Tirei ${tipoFalado} do seu pedido. 👍`,
          `Pronto, excluí ${tipoFalado} do carrinho. ✅`
        ];
      }
    } else {
      confirmacoes = [
        `Eu nem havia colocado ${tipoFalado} no pedido ainda! 😂 Tudo certinho.`,
        `Você não adicionou ${tipoFalado} neste pedido, então seguimos em frente! 👍`
      ];
    }
  } else {
    // Adição/Correção
    if (extraExistente) {
      extraExistente.quantity = quantidade;
    } else {
      state.pedidoAtual.items.push({
        tipo: 'extra',
        name: tipoFalado,
        price: preco,
        quantity: quantidade
      });
    }
    confirmacoes = [
      `Anotado! ${quantidade}x ${tipoFalado}. 👍`,
      `Feito! ${quantidade}x ${tipoFalado} no pedido. ✅`,
      `Pronto! Adicionei ${quantidade}x ${tipoFalado}. 🥤`
    ];
  }

  return {
    intent: 'CORRECAO_BEBIDAS',
    response: _pick(confirmacoes),
    _skipHumanize: true,
    _reaskEtapa: true
  };
}

/**
 * Detecta correção de quantidade de marmitas fora do fluxo de montagem.
 * Ex: "são 3 marmitas", "falei que são 3 grandes"
 * Só ativa em etapas pós-montagem (AGUARDANDO_TIPO, CONFIRMANDO, etc.)
 */
function detectQuantityCorrection(lower, state) {
  // Só ativa em etapas pós-montagem
  const etapasAtivas = ['AGUARDANDO_TIPO', 'AGUARDANDO_ENDERECO', 'AGUARDANDO_PAGAMENTO', 'CONFIRMANDO'];
  if (!etapasAtivas.includes(state.etapa)) return null;

  // Ignora se estiver falando de bebidas (tratado por detectDrinkCorrection)
  if (/coca|refri|refrigerante|suco|lata|guarana|fanta|bebida/.test(lower)) return null;

  // Padrões: "são 3 marmitas", "falei 3 grandes", "pedi 3 marmitas", "quero 3 grandes"
  if (!/marmita|grande|pequena|\bsao\b|\bpedi\b|\bfalei\b|\bquero\b/.test(lower)) return null;

  const qty = interpretQuantity(lower);
  if (!qty || qty <= 1) return null;

  // Verifica se realmente está falando de marmitas (não de sucos, etc.)
  if (!/marmita|grande|pequena/.test(lower) && !/\bsao\b.*\d|\bpedi\b.*\d|\bfalei\b.*\d/.test(lower)) return null;

  const marmitasAtuais = (state.pedidoAtual.items || []).filter(i => i.tipo === 'marmita');
  if (marmitasAtuais.length === 0) return null;

  // Se já tem a quantidade certa, ignora
  if (marmitasAtuais.length === qty) return null;

  // Detecta tamanho se mencionado
  const tamanho = interpretTamanho(lower) || marmitasAtuais[0].tamanho;

  // Modelo base: primeira marmita existente
  const modelo = marmitasAtuais[0];
  const faltam = qty - marmitasAtuais.length;

  if (faltam > 0) {
    // Adicionar marmitas faltantes baseadas no modelo
    for (let i = 0; i < faltam; i++) {
      const nova = JSON.parse(JSON.stringify(modelo));
      nova.tamanho = tamanho;
      nova.price = tamanho === 'Grande' ? 22 : 20;
      state.pedidoAtual.items.push(nova);
    }
  } else {
    // Se pediu menos do que tem, remove as excedentes (do fim)
    const extras = state.pedidoAtual.items.filter(i => i.tipo !== 'marmita');
    const marmitasAjustadas = marmitasAtuais.slice(0, qty);
    state.pedidoAtual.items = [...marmitasAjustadas, ...extras];
  }

  const totalMarmitas = state.pedidoAtual.items.filter(i => i.tipo === 'marmita').length;

  // Retorna para a etapa anterior com confirmação
  const confirmacoes = [
    `Anotado! ${totalMarmitas} marmita(s) ${tamanho}. 👍`,
    `Feito! Ajustei pra ${totalMarmitas} marmita(s) ${tamanho}. ✅`,
    `Pronto! ${totalMarmitas}x ${tamanho} anotado. 📝`
  ];

  return {
    intent: 'CORRECAO_QUANTIDADE',
    response: _pick(confirmacoes),
    _skipHumanize: true,
    _reaskEtapa: true
  };
}

/**
 * Detecta intenção de CANCELAR o pedido.
 * "cancela", "cancelar", "desisti", "não quero mais", "para"
 */
function detectCancel(lower, state) {
  // Em FINALIZADO, cancelamento pós-pedido é tratado pelo handlePosPedido
  if (state && state.etapa === 'FINALIZADO') return null;

  // Se já estava aguardando confirmação de cancelamento
  if (state._confirmandoCancelamento) {
    // Verifica se o usuário disse SIM (confirma cancelamento)
    const isConfirm = /^(sim|s|cancela|cancelar|pode|ok|claro|quero|manda)$/.test(lower.trim()) ||
      /sim.*cancela|pode.*cancelar|quero.*cancelar/.test(lower);
    if (isConfirm) {
      state._confirmandoCancelamento = false;
      // Salva backup antes de cancelar (permite retomar com "continuar")
      if (state.pedidoAtual && state.pedidoAtual.items && state.pedidoAtual.items.length > 0) {
        state._pedidoBackup = JSON.parse(JSON.stringify(state.pedidoAtual));
      }
      state.etapa = 'INICIO';
      state.pedidoAtual = { items: [], type: null, address: null, paymentMethod: null, deliveryFee: 0, trocoPara: null };
      state._marmitaAtual = null;
      state._loopCount = 0;
      return {
        intent: 'CANCEL_CONFIRMED',
        response: 'Pedido cancelado. Se quiser pedir de novo, é só chamar! 😊',
        _skipHumanize: true
      };
    }
    // Qualquer outra coisa (não, outra frase, modificação) → limpa flag e deixa handler processar
    state._confirmandoCancelamento = false;
    return null;
  }

  if (!/\bcancela(r)?\b|^para$|nao quero mais|desisti(r)?|desisto|quero cancelar|pode cancelar|cancela isso|cancela tudo|nao quero mais nada/.test(lower)) return null;

  // Se "cancela" é seguido de item específico → é modificação, não cancelamento do pedido
  const cancelaItem = /\bcancela(r)?\s+(o|a|os|as|d[aoe]s?|esse?|essa?)?\s*(refri|refrigerante|coca|suco|bebida|lata|guarana|fanta|agua|pudim|mousse|sobremesa)/i;
  if (cancelaItem.test(lower)) return null;

  // Primeira vez: pede confirmação
  state._confirmandoCancelamento = true;
  return {
    intent: 'CANCEL_PENDING',
    response: 'Quer cancelar o pedido? Confirme com *sim* ou continue com *não*.',
    _skipHumanize: true
  };
}

/**
 * Detecta intenção de VER O RESUMO do pedido atual.
 * "mostra o resumo", "o que eu pedi", "qual meu pedido", "ver pedido"
 */
function detectAskSummary(lower, state) {
  // No estado FINALIZADO, deixa o handlePosPedido responder sobre status
  if (state.etapa === 'FINALIZADO') return null;

  // Padrões expandidos para capturar variações
  // NOTA: Cada pattern deve exigir contexto de "resumo" ou "pedido" para evitar falsos positivos
  // Ex: "não mostrou as saladas pq?" NÃO deve disparar (é pergunta sobre opções, não resumo)
  const patterns = /mostra.*resumo|ver.*resumo|resumo.*pedido|o\s+que\s+eu\s+pedi|qual\s+meu\s+pedido|ver\s+o\s+que\s+pedi|cade\s+o?\s*resumo|cadê\s+o?\s*resumo|conferir.*pedido|mostrar\s+tudo|mostra\s+tudo|pedido\s+completo|quero.*pedido\s+completo|nao\s+(?:esta|está)\s+completo|não\s+(?:esta|está)\s+completo|cade\s+as?\s+quantidades?|cadê\s+as?\s+quantidades?|falt(?:ou|ando)\s+(?:item|marmita|bebida)|(?:esta|está)\s+faltando|nao\s+mostrou\s+o?\s*resumo|não\s+mostrou\s+o?\s*resumo|meu\s+pedido\s+completo|mostra\s+meu\s+pedido|ver\s+meu\s+pedido|meu\s+pedido$/;
  if (!patterns.test(lower)) return null;

  const items = state.pedidoAtual?.items || [];
  if (items.length === 0) {
    return {
      intent: 'ASK_SUMMARY',
      response: 'Você ainda não tem itens no pedido. Vamos montar? Qual tamanho de marmita: *Pequena* ou *Grande*?',
      _skipHumanize: true
    };
  }

  // Usa formatação do templates que já agrupa marmitas idênticas
  const resumoFormatado = T._formatarItensPedido(items);
  const subtotal = T.calcTotal(items, 0);

  return {
    intent: 'ASK_SUMMARY',
    response: `📋 *Seu pedido até agora:*\n\n${resumoFormatado}\n\n*Subtotal: R$ ${T.fmt(subtotal)}*`,
    _skipHumanize: true,
    _reaskEtapa: true
  };
}

/**
 * Detecta sinais de FRUSTRAÇÃO do cliente.
 * Agora é CONTEXTUAL: oferece ajuda específica baseada na etapa atual.
 */
function detectFrustration(lower, state) {
  if (!/aff|que chato|chateado|irritad|nossa|absurdo|impossivel|horrivel|voce nao entende|nao entende|vc nao (ta|entende)|\?{3,}/.test(lower)) return null;

  const etapa = state.etapa;
  const items = state.pedidoAtual?.items || [];
  const marmitas = items.filter(i => i.tipo === 'marmita');

  // Respostas contextuais por etapa
  const desculpas = [
    'Desculpa por complicar! 😅',
    'Peço desculpas! Vou simplificar. 😊',
    'Opa, foi mal! Vamos facilitar. 🙏'
  ];

  let ajudaEspecifica;

  if (['MONTANDO_PROTEINA', 'MONTANDO_ACOMPANHAMENTO', 'MONTANDO_SALADA'].includes(etapa)) {
    // Frustrado durante montagem: sugere os mais populares
    ajudaEspecifica = _pick([
      'Quer que eu sugira os mais pedidos? Frango com Arroz e Feijão é o campeão! 🏆',
      'Posso sugerir o combo mais popular? Frango + Arroz + Feijão nunca falha! 😋',
      'Se quiser, posso montar com os favoritos dos clientes. É só dizer "pode ser"! 👍'
    ]);
  } else if (etapa === 'CONFIRMANDO' && marmitas.length > 0) {
    // Frustrado na confirmação: mostra o que pode mudar
    ajudaEspecifica = _pick([
      'Quer que eu mostre o resumo pra você conferir? Qualquer coisa a gente ajusta! 📋',
      'Posso mostrar tudo que anotei. Me diz o que quer mudar que eu corrijo na hora! ✏️'
    ]);
  } else if (etapa === 'AGUARDANDO_ENDERECO') {
    ajudaEspecifica = 'Só preciso da rua, número e bairro. Pode mandar do jeito que preferir! 📍';
  } else {
    // Frustração genérica: oferece opções claras
    ajudaEspecifica = _pick([
      'Quer continuar o pedido, recomeçar ou falar com um atendente?',
      'Me diz: quer continuar, começar de novo ou chamar um atendente? 💬',
      'Posso continuar, recomeçar ou chamar alguém pra te ajudar. O que prefere?'
    ]);
  }

  const contextoResumo = _contextoEtapa(state.etapa);
  const responseArray = [
    _pick(desculpas),
    ajudaEspecifica
  ];
  if (contextoResumo) responseArray.push(contextoResumo);

  const respostas = [
    'Desculpa, tô aqui para facilitar! Vamos resolver isso rapidinho 😊',
    'Opa, me desculpa pela confusão! Bora do começo 🙏',
    'Xiii, me perdoa! Deixa eu te ajudar de um jeito mais simples 😊'
  ];
  const resposta = respostas[Math.floor(Math.random() * respostas.length)];

  return {
    intent: 'FRUSTRATION',
    response: responseArray,
    _skipHumanize: false
  };
}

/**
 * Detecta intenção de RESTART / desistência suave.
 * "deixa quieto", "esquece", "começa de novo", "novo pedido"
 */
function detectRestart(lower, state) {
  if (!/deixa quieto|esquece|esqueca|comeca de novo|recomecar|novo pedido|reset/.test(lower)) return null;

  // Reset completo — inclui flags de upsell, grupos e montagem
  state.etapa = 'MONTANDO_TAMANHO';
  state.pedidoAtual = { items: [], type: null, address: null, paymentMethod: null, deliveryFee: 0, trocoPara: null };
  state._marmitaAtual = null;
  state._loopCount = 0;
  state._confirmandoCancelamento = false;
  state._upsellDone = false;
  state._upsellPhase = null;
  state._grupos = null;
  state._currentGrupoIndex = 0;
  state._pendingMarmitas = 1;
  state._currentMarmitaNumber = 1;

  return {
    intent: 'RESTART',
    response: 'Tudo bem! Começando do zero 😊\nQual tamanho de marmita: *Pequena* — *R$ 20,00* ou *Grande* — *R$ 22,00*?',
    _skipHumanize: true
  };
}

/**
 * Retorna mensagem de retomada baseada na etapa atual.
 * Agora com VARIAÇÕES para evitar repetição mecânica.
 * Se state passado, considera o que o cliente já escolheu.
 */
function _contextoEtapa(etapa, state) {
  const retomadas = {
    'MONTANDO_TAMANHO': [
      'Voltando ao pedido — qual tamanho de marmita: *Pequena (R$ 20)* ou *Grande (R$ 22)*?',
      'Continuando! Vai ser marmita *Pequena (R$ 20)* ou *Grande (R$ 22)*? 🍱',
      'Bora montar! Qual o tamanho da marmita: *Pequena (R$ 20)* ou *Grande (R$ 22)*?'
    ],
    'MONTANDO_PROTEINA': [
      'E a proteína? Frango, Churrasco, Costela, Linguiça ou Carne Cozida 🥩',
      'Qual proteína você quer? Temos Frango, Churrasco, Costela, Linguiça e Carne Cozida',
      'Continuando — qual proteína? (pode escolher até 2) 🍗'
    ],
    'MONTANDO_ACOMPANHAMENTO': [
      'Agora os acompanhamentos! Arroz, Feijão, Purê, Macarrão ou Tropeiro (até 2) 🍚',
      'E pra acompanhar? Arroz, Feijão, Purê, Macarrão ou Tropeiro',
      'Escolha os acompanhamentos: Arroz, Feijão, Purê, Macarrão ou Tropeiro 🥘'
    ],
    'MONTANDO_SALADA': [
      'Quer salada? Maionese, Beterraba, Alface, Repolho ou Pepino (pode pular) 🥗',
      'Uma saladinha? Maionese, Beterraba, Alface, Repolho ou Pepino — ou "sem salada"',
      'Salada? Temos Maionese, Beterraba, Alface, Repolho e Pepino 🥬'
    ],
    'OFERECENDO_UPSELL': [
      'Quer uma bebida? Suco Natural (R$ 8) ou Refrigerante (R$ 6) 🥤',
      'Adicionar uma bebida? Suco (R$ 8) ou Refri (R$ 6)?',
      'Vai querer uma bebida junto? 🥤'
    ],
    'AGUARDANDO_TIPO': [
      'Vai ser *Entrega* ou *Retirada*? 🚚',
      '*Entrega* ou *Retirada no balcão*?',
      'E a entrega? Mando aí ou você vem buscar? 🏠'
    ],
    'AGUARDANDO_PAGAMENTO': [
      '*Pix*, *Cartão* ou *Dinheiro*? 💳',
      'Forma de pagamento: Pix, Cartão ou Dinheiro?',
      'Como vai pagar? *Pix*, *Cartão* ou *Dinheiro*? 💰'
    ],
    'CONFIRMANDO': [
      'Confirma o pedido? 😊',
      'Tudo certo? Posso confirmar?',
      'Posso confirmar o pedido? ✅'
    ]
  };

  const opcoes = retomadas[etapa];
  if (!opcoes) return null;
  return _pick(opcoes);
}

/**
 * Detecta intenção de REMOÇÃO de item do pedido.
 * "remove um suco", "tira a marmita", "exclui o refrigerante", "remove uma grande"
 * Suporta: bebidas, marmitas e quaisquer extras.
 */
function detectItemRemoval(lower, state) {
  // Só ativa em etapas pós-montagem
  const etapasAtivas = ['AGUARDANDO_TIPO', 'AGUARDANDO_ENDERECO', 'AGUARDANDO_PAGAMENTO', 'CONFIRMANDO'];
  if (!etapasAtivas.includes(state.etapa)) return null;

  // Deve conter verbo de remoção (excluindo clear pickup intents)
  const isPickupIntent = /(posso|pra|para|vou|ir|quero|agendar para|agendado para)\s+retirar/.test(lower) || 
                         /retirar\s+(no\s+|na\s+)?(local|balc|loja|aqui|ai|aí)/.test(lower) || 
                         /\bretirada\b/.test(lower);
  
  if (isPickupIntent) return null;
  if (!/remove(r)?|tira(r)?|exclui(r)?|retira(r)?/.test(lower)) return null;

  const items = state.pedidoAtual?.items || [];
  if (items.length === 0) {
    return {
      intent: 'REMOCAO_ITEM',
      response: 'Seu pedido ainda está vazio, não tem nada pra tirar! 😅',
      _skipHumanize: true,
      _reaskEtapa: true
    };
  }

  // Quantidade a remover (null = sem quantidade explícita → remove tudo)
  const PALAVRAS_NUM = {
    'um': 1, 'uma': 1, 'dois': 2, 'duas': 2,
    'tres': 3, 'três': 3, 'quatro': 4, 'cinco': 5, 'seis': 6
  };
  let qtdRemover = null;
  const matchDigito = lower.match(/(\d+)/);
  const matchExtenso = lower.match(/(uma?|dois|duas|tr[eê]s|quatro|cinco|seis)/);
  if (matchDigito) qtdRemover = parseInt(matchDigito[1]);
  else if (matchExtenso) qtdRemover = PALAVRAS_NUM[matchExtenso[1]] || 1;

  // Identifica QUAL item remover
  // Bebidas
  if (/suco/.test(lower)) {
    return _removeExtra(state, 'Suco Natural', qtdRemover);
  }
  if (/coca|refri|refrigerante|lata/.test(lower)) {
    return _removeExtra(state, 'Refrigerante Lata', qtdRemover);
  }

  // Marmitas
  if (/marmita|grande|pequena/.test(lower)) {
    return _removeMarmita(state, lower, qtdRemover);
  }

  // Tenta match genérico por nome parcial
  // \b garante que |o|a| não estraga nomes como "mousse" (m[o]usse) ou "torta" (tor[ta])
  const nomeItem = lower.replace(/\b(remove(r)?|tira(r)?|exclui(r)?|retira(r)?|o|a|um|uma|os|as)\b/g, '').trim();
  if (nomeItem.length > 2) {
    const found = items.find(i => normalizar(i.name || '').includes(nomeItem));
    if (found) {
      if (found.tipo === 'extra') {
        return _removeExtra(state, found.name, qtdRemover);
      }
      if (found.tipo === 'marmita') {
        return _removeMarmita(state, lower, qtdRemover);
      }
    }
  }

  // Se o match de "retirar" foi solto sem um item associável e tem tamanho considerável,
  // ou se é estritamente a palavra "retirar" ou "retirada" (que deveriam ir pro handler de pickup), não faz nada
  if (nomeItem.length === 0 || lower === 'retirar' || lower === 'retirada') {
    return null; // Deixa ir pro handler de etapa (possível pickup ou outra tratativa)
  }

  return {
    intent: 'REMOCAO_ITEM',
    response: 'Não encontrei esse item no seu pedido. Me diga o nome exato do que quer tirar? 🤔',
    _skipHumanize: true,
    _reaskEtapa: true
  };
}

function _removeExtra(state, nomeItem, qtd) {
  const items = state.pedidoAtual.items;
  const idx = items.findIndex(i => i.tipo === 'extra' && normalizar(i.name).includes(normalizar(nomeItem).split(' ')[0]));

  if (idx === -1) {
    return {
      intent: 'REMOCAO_ITEM',
      response: `Não encontrei ${nomeItem} no seu pedido. 🤔`,
      _skipHumanize: true,
      _reaskEtapa: true
    };
  }

  const item = items[idx];
  // qtd null = sem quantidade explícita → remove todos
  if (qtd !== null && item.quantity > qtd) {
    item.quantity -= qtd;
    return {
      intent: 'REMOCAO_ITEM',
      response: `Pronto! Tirei ${qtd}x ${nomeItem}. Ficaram ${item.quantity}x no pedido. ✅`,
      _skipHumanize: true,
      _reaskEtapa: true
    };
  }

  items.splice(idx, 1);
  return {
    intent: 'REMOCAO_ITEM',
    response: `Pronto! Tirei ${nomeItem} do seu pedido. ✅`,
    _skipHumanize: true,
    _reaskEtapa: true
  };
}

function _removeMarmita(state, lower, qtd) {
  const items = state.pedidoAtual.items;
  const marmitas = items.filter(i => i.tipo === 'marmita');

  if (marmitas.length === 0) {
    return {
      intent: 'REMOCAO_ITEM',
      response: 'Não encontrei marmitas no seu pedido para remover. 🤔',
      _skipHumanize: true,
      _reaskEtapa: true
    };
  }

  // Remove do fim para preservar as primeiras montadas
  let removidas = 0;
  for (let i = items.length - 1; i >= 0 && removidas < qtd; i--) {
    if (items[i].tipo === 'marmita') {
      items.splice(i, 1);
      removidas++;
    }
  }

  const restantes = items.filter(i => i.tipo === 'marmita').length;
  if (restantes === 0) {
    return {
      intent: 'REMOCAO_ITEM',
      response: `Pronto! Tirei ${removidas} marmita(s). Seu pedido ficou sem marmitas. Quer adicionar uma nova? 🍱`,
      _skipHumanize: true,
      _reaskEtapa: true
    };
  }

  return {
    intent: 'REMOCAO_ITEM',
    response: `Ok, removi ${removidas} marmita(s). Ficaram ${restantes} no pedido. ✅`,
    _skipHumanize: true,
    _reaskEtapa: true
  };
}

module.exports = { classify, detectFlowComplaint, detectQuantityCorrection, detectDrinkCorrection, detectCancel, detectFrustration, detectRestart, detectItemRemoval, _pick, _contextoEtapa };
