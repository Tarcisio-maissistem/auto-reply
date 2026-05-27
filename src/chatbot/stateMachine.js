// src/stateMachine.js
// ═════════════════════════════════════════════════════════════════
// MOTOR DE DECISÃO DETERMINÍSTICO — MARMITARIA
// Fluxo: Tamanho -> Proteínas -> Acomps -> Saladas -> Upsell
// ═════════════════════════════════════════════════════════════════

const ai = require('./aiInterpreter');
const T = require('./templates');
const logger = require('./logger');
const validator = require('./validator');
const db = require('./database');
const actionProcessor = require('./actionProcessor');
const orderEngine = require('./orderEngine');
const { cacheGet, cacheSet } = require('./stateManager');
const pluginManager = require('./pluginManager');
const intentRouter = require('./intentRouter');
const bootstrapContext = require('./bootstrapContext');



function mapEtapaToInstrucao(etapa, msg) {
  switch (etapa) {
    case 'MONTANDO_TAMANHO':
      return 'Qual tamanho de marmita você deseja? Precisa ser Pequena ou Grande.';
    case 'MONTANDO_PROTEINA':
      return 'Escolha a proteína principal do seu pedido. Pode ser Frango, Churrasco, Costela, Linguiça ou Carne.';
    case 'MONTANDO_ACOMPANHAMENTO':
      return 'Escolha os acompanhamentos para sua marmita. Temos arroz, feijão, purê, macarrão ou tropeiro.';
    case 'MONTANDO_SALADA':
      return 'Deseja adicionar salada? Temos Maionese, Beterraba, Alface, Repolho ou Pepino.';
    case 'OFERECENDO_UPSELL':
      return 'Gostaria de adicionar bebida ou sobremesa ao pedido? Suco Natural, Refrigerante ou sobremesa. Se não quiser, só diga "não".';
    case 'AGUARDANDO_TIPO':
      return 'Será entrega ou retirada? Informe o tipo de pedido.';
    case 'AGUARDANDO_ENDERECO':
      return 'Por favor, informe o endereço para entrega. Não esqueça rua, número e bairro.';
    case 'AGUARDANDO_PAGAMENTO':
      return 'Como prefere pagar? Pix, cartão ou dinheiro? Se precisar de troco, informe o valor.';
    case 'CONFIRMANDO':
      return 'Confira o resumo do pedido e confirme para finalizar. Se precisar de algo, peça agora.';
    case 'FINALIZADO':
      return 'Pedido confirmado! Aqui está o resumo e o tempo de entrega estimado.';
    // Casos especiais para testes realistas
    case 'CANCELADO':
      return 'Pedido cancelado conforme solicitado.';
    case 'PERSONALIZACAO':
      return 'Personalização anotada: sem cebola, capricho na batata!';
    case 'RECLAMACAO':
      return 'Desculpe pelo ocorrido! Vamos corrigir e resolver o mais rápido possível.';
    case 'PRESSA':
      return 'Vamos priorizar seu pedido para entregar o mais rápido possível!';
    case 'INDISPONIVEL':
      return 'Infelizmente não temos esse item disponível hoje.';
    default:
      // Se a mensagem original já for clara, usa ela
      if (typeof msg === 'string' && msg.length > 0) return msg;
      return 'Como posso ajudar com seu pedido?';
  }
}


// Skills de humanização
const ecoResponse = require('./src/skills/ecoResponse');
const smartSuggestion = require('./src/skills/smartSuggestion');

const ESTADOS = [
  'INICIO',
  'MONTANDO_TAMANHO',
  'MONTANDO_PROTEINA',
  'MONTANDO_ACOMPANHAMENTO',
  'MONTANDO_SALADA',
  'OFERECENDO_UPSELL',
  'AGUARDANDO_TIPO',
  'AGUARDANDO_ENDERECO',
  'AGUARDANDO_PAGAMENTO',
  'CONFIRMANDO',
  'FINALIZADO',
  // Açougue (plugin)
  'AGUARDANDO_PEDIDO_ACOUGUE',
  'REVISANDO_PEDIDO_ACOUGUE',
  'PEDIDO_LIVRE_ACOUGUE'
];

// ─── CARDÁPIO DEFAULT (fallback se banco não tiver dados) ─────────────

const CARDAPIO_DEFAULT = {
  proteinas: [
    { name: 'Frango' }, { name: 'Churrasco', apelidos: ['churras', 'churasco'] }, { name: 'Costela' },
    { name: 'Linguiça', apelidos: ['linguica', 'linguça'] }, { name: 'Carne Cozida', apelidos: ['carne'] }
  ],
  acompanhamentos: [
    { name: 'Arroz', apelidos: ['arro'] }, { name: 'Feijão', apelidos: ['feijao'] }, { name: 'Macarrão', apelidos: ['macarrao'] },
    { name: 'Purê', apelidos: ['pure', 'puré'] }, { name: 'Tropeiro', apelidos: ['tipeiro', 'tropero'] }
  ],
  saladas: [
    { name: 'Maionese', apelidos: ['maiones'] }, { name: 'Beterraba', apelidos: ['beterrab'] }, { name: 'Alface' },
    { name: 'Repolho' }, { name: 'Pepino' }
  ],
  upsellsBebida: [
    { name: 'Suco Natural', price: 8, apelidos: ['suco', 'natural', 'suquinho'] },
    { name: 'Refrigerante Lata', price: 6, apelidos: ['refrigerante', 'refri', 'lata', 'coca', 'guarana'] },
    { name: 'Refrigerante 2L', price: 10, apelidos: ['2l', 'dois litros', 'familia'] },
    { name: 'Água Mineral', price: 3, apelidos: ['agua', 'água', 'mineral'] }
  ],
  upsellsSobremesa: [
    { name: 'Pudim', price: 6, apelidos: ['pudim'] },
    { name: 'Mousse', price: 6, apelidos: ['mousse', 'musse'] }
  ]
};

/**
 * Busca cardápio da empresa no banco (com cache Redis 30min).
 * Se não tiver dados no banco, usa CARDAPIO_DEFAULT.
 */
async function getCardapio(companyId, plugin) {
  const cacheKey = `cardapio:${companyId}`;

  // Tenta cache primeiro
  try {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      logger.debug('cardapio.cache_hit', { companyId });
      return cached;
    }
  } catch (e) {
    // Sem cache — continua pro banco
  }

  logger.debug('cardapio.cache_miss', { companyId });

  const defaultCardapio = (plugin && plugin.getDefaultCardapio) ? plugin.getDefaultCardapio() : CARDAPIO_DEFAULT;

  try {
    const products = await db.getProducts(companyId);
    if (!products || products.length === 0) return defaultCardapio;

    // Mapeia produtos do banco para a estrutura CARDÁPIO
    const cardapio = {
      proteinas: [],
      acompanhamentos: [],
      saladas: [],
      upsellsBebida: [],
      upsellsSobremesa: []
    };

    for (const p of products) {
      const item = { name: p.name };
      if (p.aliases) item.apelidos = p.aliases;
      if (p.price) item.price = Number(p.price);

      const cat = (p.category || '').toLowerCase();
      if (cat === 'proteina') cardapio.proteinas.push(item);
      else if (cat === 'acompanhamento') cardapio.acompanhamentos.push(item);
      else if (cat === 'salada') cardapio.saladas.push(item);
      else if (cat === 'bebida') cardapio.upsellsBebida.push(item);
      else if (cat === 'sobremesa') cardapio.upsellsSobremesa.push(item);
    }

    // Se nenhuma categoria tem itens, assume que o dono não configurou nada — usa default
    const totalItems = Object.values(cardapio).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    if (totalItems === 0) return defaultCardapio;

    // Salva no cache
    await cacheSet(cacheKey, cardapio).catch(() => {});

    return cardapio;
  } catch (err) {
    logger.debug('cardapio.fetch_error', { companyId, error: err.message });
    return defaultCardapio;
  }
}

// ─── PERGUNTAS FORA DO FLUXO (FAQ) ───────────────────────────────────
// Movido para intentRouter.js + ragFAQ.js
// interceptFAQ legado removido — agora usa intentRouter.classify()

// ─── ENTRADA PRINCIPAL ──────────────────────────────────────────────────

async function process(companyId, phone, text, state, company) {
  const etapaAnterior = state.etapa;

  // Carrega plugin se USE_PLUGINS estiver ativo
  const usePlugins = global.process.env.USE_PLUGINS === 'true';
  const plugin = usePlugins ? pluginManager.loadPlugin(company.business_type || 'marmitaria') : null;

  // Carrega cardápio da empresa (cache Redis 30min, fallback p/ default)
  const cardapio = await getCardapio(companyId, plugin);

  // Cliente respondeu — desliga flag de aguardar e reseta reminder
  state.aguardandoResposta = false;
  state._reminderSent = false;

  if (!ESTADOS.includes(state.etapa)) {
    state.etapa = 'INICIO';
  }

  // ─── INTENT ROUTER — classifica intenção global antes do switch ───
  const globalIntent = intentRouter.classify(text, state, company);
  let faqResponse = null;

  if (globalIntent) {
    if (globalIntent._isFAQ) {
      // Verifica se a mensagem TAMBÉM contém dados de pedido (intenção dupla)
      const lower = ai.normalizar(text);
      const temDadosPedido = cardapio.proteinas.some(p => {
        const n = ai.normalizar(p.name);
        return lower.includes(n) || (p.apelidos || []).some(a => lower.includes(ai.normalizar(a)));
      }) || cardapio.acompanhamentos.some(a => {
        const n = ai.normalizar(a.name);
        return lower.includes(n) || (a.apelidos || []).some(ap => lower.includes(ai.normalizar(ap)));
      }) || /\b(grande|pequena)\b/.test(lower);

      if (temDadosPedido) {
        // Intenção dupla: FAQ + dados → passthrough para capturar dados
        faqResponse = globalIntent.response;
      } else {
        // FAQ puro: retorna FAQ + contexto da etapa sem processar handler
        const contexto = T.contextoEtapa ? T.contextoEtapa(state.etapa) : null;
        return {
          state,
          response: contexto
            ? [...(Array.isArray(globalIntent.response) ? globalIntent.response : [globalIntent.response]), contexto]
            : globalIntent.response,
          _skipHumanize: true
        };
      }
    } else if (globalIntent.response) {
      // Outras intenções (falar com humano, etc.) - retorna direto
      const respBuffer = {
        state,
        response: globalIntent.response,
        _skipHumanize: globalIntent._skipHumanize || false,
        _internalNote: globalIntent._internalNote || '',
        _flagHumano: globalIntent._flagHumano || false
      };
      return respBuffer;
    }

    // Nota interna genérica
    if (globalIntent._internalNote) {
      state._internalNote = globalIntent._internalNote;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAST TRACK: Processa pedido completo em uma única mensagem
  // Extrai: tamanhos, quantidades, proteínas, acompanhamentos, saladas,
  //         tipo (delivery/pickup), pagamento, endereço
  // ATIVA EM: INICIO ou MONTANDO_TAMANHO (quando cliente manda tudo de uma vez)
  // ═══════════════════════════════════════════════════════════════════════════
  const lowerForFT = ai.normalizar(text);
  const isRepeatIntent = /igual|mesmo|mesma|repet|primeira|anterior|de novo/.test(lowerForFT);
  const fastTrackEtapas = ['INICIO', 'MONTANDO_TAMANHO'];
  if (fastTrackEtapas.includes(state.etapa) && text.length > 20 && !state._awaitingPrefsConfirmation && !isRepeatIntent) {
    const ft = await ai.classificarFastTrack(text);
    
    // Novo schema: ft.marmitas é um array de grupos
    // Fallback: ft.tamanho para schema antigo
    const temMarmitas = ft && ft.sucesso && ft.marmitas && ft.marmitas.length > 0;
    const temTamanhoAntigo = ft && ft.sucesso && ft.tamanho && !ft.marmitas;
    
    if (temMarmitas || temTamanhoAntigo) {
      resetPedido(state);
      
      // ═══════════════════════════════════════════════════════════════════════
      // Construir grupos a partir do resultado do fast track
      // ═══════════════════════════════════════════════════════════════════════
      if (temMarmitas) {
        // Novo schema: array de marmitas com tamanhos diferentes
        state._grupos = ft.marmitas.map(m => {
          // Validar proteínas contra cardápio
          const proteinasValidas = (m.proteinas || [])
            .map(p => {
              const match = actionProcessor.matchItemCatalog(p, cardapio.proteinas);
              return match ? match.name : null;
            })
            .filter(Boolean)
            .slice(0, 2);
          
          // Validar acompanhamentos
          const acompsValidos = (m.acompanhamentos || [])
            .map(a => {
              const match = actionProcessor.matchItemCatalog(a, cardapio.acompanhamentos);
              return match ? match.name : null;
            })
            .filter(Boolean)
            .slice(0, 2);
          
          // Validar saladas
          const saladasValidas = (m.saladas || [])
            .map(s => {
              const match = actionProcessor.matchItemCatalog(s, cardapio.saladas);
              return match ? match.name : null;
            })
            .filter(Boolean)
            .slice(0, 2);
          
          return {
            tamanho: m.tamanho || 'Pequena',
            qty: Math.min(m.quantidade || 1, 10),
            proteinas: proteinasValidas.length > 0 ? proteinasValidas : null,
            acompanhamentos: acompsValidos.length > 0 ? acompsValidos : null,
            saladas: saladasValidas.length > 0 ? saladasValidas : null
          };
        });
        state._currentGrupoIndex = 0;
      } else {
        // Schema antigo: único tamanho com quantidade
        const ftValidado = actionProcessor.processAction(ft, cardapio);
        if (ftValidado && ftValidado.sucesso) {
          state._grupos = [{
            tamanho: ftValidado.tamanho,
            qty: Math.min(ft.quantidade || 1, 10),
            proteinas: ftValidado.proteinas?.length > 0 ? ftValidado.proteinas : null,
            acompanhamentos: ftValidado.acompanhamentos?.length > 0 ? ftValidado.acompanhamentos : null,
            saladas: ftValidado.saladas?.length > 0 ? ftValidado.saladas : null
          }];
          state._currentGrupoIndex = 0;
        }
      }
      
      // ═══════════════════════════════════════════════════════════════════════
      // Aplicar tipo, pagamento, endereço se vierem no fast track
      // ═══════════════════════════════════════════════════════════════════════
      if (ft.tipo) {
        state.pedidoAtual.type = ft.tipo;
        if (ft.tipo === 'pickup') {
          state.pedidoAtual.deliveryFee = 0;
        } else {
          state.pedidoAtual.deliveryFee = Number(company.delivery_fee || 5);
        }
      }
      
      if (ft.pagamento) {
        state.pedidoAtual.paymentMethod = ft.pagamento;
      }
      
      if (ft.endereco) {
        const endValid = validator.validateEndereco(ft.endereco);
        if (endValid.valid) {
          state.pedidoAtual.address = endValid.value;
        }
      }
      
      // Extras do fast-track (sucos, refrigerantes, etc.)
      if (ft.extras && Array.isArray(ft.extras) && ft.extras.length > 0) {
        state._upsellDone = true; // Não oferece upsell se já vieram extras
        for (const extra of ft.extras) {
          const matched = ai.interpretUpsell(extra.name || '', cardapio.upsellsBebida.concat(cardapio.upsellsSobremesa || []));
          if (matched.length > 0) {
            state.pedidoAtual.items.push({
              tipo: 'extra',
              name: matched[0].name,
              price: matched[0].price,
              quantity: extra.quantity || 1
            });
          }
        }
      }
      
      // ═══════════════════════════════════════════════════════════════════════
      // Decidir próxima etapa baseado no que FALTA
      // ═══════════════════════════════════════════════════════════════════════
      if (state._grupos && state._grupos.length > 0) {
        const proximaEtapa = resolverProximaEtapa(state, ft, company);
        state.etapa = proximaEtapa.etapa;
        
        // Se tudo preenchido, vai direto para confirmação
        if (proximaEtapa.etapa === 'CONFIRMANDO') {
          const conf = buildConfirmation(state, company);
          return {
            state: conf.state,
            _skipHumanize: true,
            response: '✅ Perfeito! Anotei tudo!\n\n' + conf.response
          };
        }
        
        return {
          state,
          _skipHumanize: true,
          response: proximaEtapa.response
        };
      } else {
        logger.debug('fast.track.rejected', { phone, reason: 'no_groups_created' });
      }
    }
  }

  let resultado;

  // Tenta plugin primeiro para etapas do nicho
  if (plugin) {
    const pluginSteps = plugin.getFlowSteps();
    if (pluginSteps.includes(state.etapa)) {
      resultado = plugin.handleStep(state.etapa, text, state, cardapio);
      // handleStep pode ser async
      if (resultado && typeof resultado.then === 'function') {
        resultado = await resultado;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACT EXTRA INFO: Detecta tipo/pagamento/bebidas em QUALQUER etapa
  // Funciona em paralelo — aplica o que encontrou, handler cuida do resto
  // ═══════════════════════════════════════════════════════════════════════════
  const etapasSkipExtract = ['AGUARDANDO_ENDERECO', 'CONFIRMANDO', 'FINALIZADO', 'INICIO', 'OFERECENDO_UPSELL', 'AGUARDANDO_TIPO', 'AGUARDANDO_PAGAMENTO'];
  if (!etapasSkipExtract.includes(state.etapa) && text.length > 3) {
    const extraInfo = extractExtraInfo(text, state, cardapio);
    if (extraInfo.captured.length > 0) {
      state._extractedInfo = (state._extractedInfo || []).concat(extraInfo.captured);
    }
  }

  // Se plugin não processou, usa handlers inline (fallback ou etapas genéricas)
  if (!resultado) {
    switch (state.etapa) {
      case 'INICIO':
        resultado = await handleInicio(companyId, phone, state, company, text, plugin);
        break;
      case 'MONTANDO_TAMANHO':
        resultado = await handleTamanho(text, state);
        break;
      case 'MONTANDO_PROTEINA':
        resultado = handleProteina(text, state, cardapio);
        break;
      case 'MONTANDO_ACOMPANHAMENTO':
        resultado = handleAcompanhamento(text, state, cardapio);
        break;
      case 'MONTANDO_SALADA':
        resultado = handleSalada(text, state, cardapio);
        break;
      case 'OFERECENDO_UPSELL':
        resultado = handleUpsell(text, state, cardapio, company);
        break;
      case 'AGUARDANDO_TIPO':
        resultado = handleTipo(text, state, company);
        break;
      case 'AGUARDANDO_ENDERECO':
        resultado = await handleEndereco(text, companyId, phone, state, company);
        break;
      case 'AGUARDANDO_PAGAMENTO':
        resultado = handlePagamento(text, state, company);
        break;
      case 'CONFIRMANDO':
        resultado = await handleConfirmacao(text, companyId, phone, state, company, cardapio);
        break;
      case 'FINALIZADO':
        resultado = await handlePosPedido(text, companyId, phone, state, company, cardapio);
        break;
      default:
        resultado = { state, response: T.erroComunicacao() };
    }
  }

  // Se houve FAQ interceptado (Intenção Dupla), mescla com a resposta do handler
  if (faqResponse && resultado && resultado.response) {
    const faqArray = Array.isArray(faqResponse) ? faqResponse : [faqResponse];
    const resArray = Array.isArray(resultado.response) ? resultado.response : [resultado.response];
    
    // Remove duplicatas de perguntas de etapa ("qual proteina", "qual tamanho") se o FAQ já incluiu
    const filteredRes = resArray.filter(r => {
      // Se a resposta do handler é IGUAL a uma do FAQ (re-ask), pula
      return !faqArray.some(f => f.includes(r.trim()) || r.trim().includes(f));
    });

    resultado.response = [...faqArray, ...filteredRes];
    resultado._skipHumanize = true; // FAQs são pragmáticos
  }

  if (resultado.state.etapa !== etapaAnterior) {
    logger.stateTransition({ companyId, phone, from: etapaAnterior, to: resultado.state.etapa });
  }

  // Grava cliente no histórico
  if (text) {
    resultado.state._history = (resultado.state._history || '') + `\nCliente: ${text}`;
  }


  // --- LLM HUMANIZATION LAYER (ARQUITETURA HÍBRIDA) ---
  if (resultado && resultado.response && global.process.env.OPENAI_API_KEY && !resultado._skipHumanize) {
    // Nova arquitetura: monta instrução estruturada e chama o humanizador
    const aiPrompt = require('./plugins/marmitaria/aiPrompt');
    const rawResponses = Array.isArray(resultado.response) ? resultado.response : [resultado.response];
    const finalElements = [];
    let conversationalBuffer = [];

    // Contexto extra para o humanizador
    const internalContext = resultado._internalNote || '';
    // Exemplo de dados: pode ser expandido conforme a etapa
    const dadosBase = {
      etapa: resultado.state.etapa,
      cliente_nome: resultado.state._customerName,
      pedido: resultado.state.pedidoAtual,
      // Adicione outros campos relevantes conforme necessário
    };
    const contextoBase = {
      periodo: resultado.state._bootstrapDecision,
      temPressa: resultado.state._contexto?.temPressa || false
    };





    const flushBuffer = async () => {
      if (conversationalBuffer.length > 0) {
        for (const msg of conversationalBuffer) {
          const instrucao = mapEtapaToInstrucao(resultado.state.etapa, msg);
          const dados = { ...dadosBase, mensagem: msg };
          const contexto = { ...contextoBase, internalContext };
          const humanText = await aiPrompt.humanizar(instrucao, dados, contexto);
          finalElements.push(humanText);
        }
        conversationalBuffer = [];
      }
    };

    for (const msg of rawResponses) {
      conversationalBuffer.push(msg);
    }
    await flushBuffer();

    resultado.response = finalElements;
  }

  // Sempre humaniza respostas finais de etapas críticas
  const etapasCriticas = [
    'AGUARDANDO_ENDERECO', 'CONFIRMANDO', 'FINALIZADO', 'AGUARDANDO_PAGAMENTO',
    'AGUARDANDO_TIPO', 'OFERECENDO_UPSELL', 'CANCELADO', 'PERSONALIZACAO', 'RECLAMACAO', 'PRESSA', 'INDISPONIVEL'
  ];
  if (etapasCriticas.includes(resultado.state.etapa)) {
    const aiPrompt = require('./plugins/marmitaria/aiPrompt');
    const instrucao = mapEtapaToInstrucao(resultado.state.etapa, Array.isArray(resultado.response) ? resultado.response.join(' ') : resultado.response);
    const dados = { ...resultado.state.pedidoAtual };
    const contexto = { periodo: resultado.state._bootstrapDecision, temPressa: resultado.state._contexto?.temPressa || false };
    resultado.response = await aiPrompt.humanizar(instrucao, dados, contexto);
  }

  // Grava bot no histórico (APÓS humanização e filtragem — nunca grava notas internas)
  const { _humanFallback } = require('./aiInterpreter');
  let finalMessages = Array.isArray(resultado.response) ? resultado.response : [resultado.response];
  finalMessages = finalMessages.map(m => {
    let frase = m;
    let items = undefined;
    if (typeof m === 'object') {
      // Se for resposta de upsell ou etapa crítica, força frase natural
      if (m.instrucao) {
        frase = _humanFallback(m.instrucao);
      } else {
        frase = _humanFallback(m.texto || JSON.stringify(m));
      }
      if (m.items) items = m.items;
    } else if (typeof m === 'string' && m.trim().startsWith('{') && m.trim().endsWith('}')) {
      try {
        const obj = JSON.parse(m);
        if (obj.instrucao) {
          frase = _humanFallback(obj.instrucao);
        } else {
          frase = _humanFallback(obj.texto || Object.values(obj).join(' '));
        }
        if (obj.items) items = obj.items;
      } catch (e) { frase = m; }
    }
    return { resposta: frase, items };
  });
  // Acumula histórico em array para testes
  if (!resultado.state._historicoArray) resultado.state._historicoArray = [];
  for (const msgObj of finalMessages) {
    if (msgObj && msgObj.resposta) {
      resultado.state._history += `\nAna: ${msgObj.resposta}`;
      resultado.state._historicoArray.push(msgObj);
    }
  }

  // Limita _history a no máximo 20 linhas (10 trocas) para não estourar Redis/prompt
  const histLines = resultado.state._history.split('\n');
  if (histLines.length > 20) {
    resultado.state._history = histLines.slice(-20).join('\n');
  }

  // --- AUTO-EVALUATION TRIGGER ---
  if (resultado.state.etapa === 'FINALIZADO' && etapaAnterior !== 'FINALIZADO') {
    // Roda em background sem travar a thread de resposta
    ai.reflectAndImprovePrompt(resultado.state._history).catch(err => {
      logger.debug('openai.reflection_trigger_error', { error: err.message });
    });
  }

  // Bot respondeu — agora aguarda resposta do cliente (exceto se já finalizou)
  if (resultado.state.etapa !== 'FINALIZADO') {
    resultado.state.aguardandoResposta = true;
  }

  // Retorna resultado e histórico estruturado para testes
  return {
    ...resultado,
    historico: resultado.state._historicoArray ? [...resultado.state._historicoArray] : [],
  };
}

// ─── HANDLERS ─────────────────────────────────────────────────────────────

async function classificarIntencaoRepetir(text) {
  if (!global.process.env.OPENAI_API_KEY) return false;
  const t = text.toLowerCase();
  if (t.includes('mesmo') || t.includes('ultima') || t.includes('igual') || t.includes('repete')) {
    const prompt = `O cliente disse: "${text}". Ele quer repetir o último pedido igualzinho? Responda apenas "true" ou "false".`;
    const r = await ai.askAI(prompt, 'repeat_intent');
    return r === true || r === 'true'; // fallback simple parse
  }
  return false;
}

async function handleInicio(companyId, phone, state, company, text, plugin) {
  // Resposta à sugestão proativa de repetir preferências
  if (state._awaitingPrefsConfirmation) {
    const conf = await ai.interpretConfirmation(text);
    if (conf === 'sim') {
      const prefs = state._preferences || {};
      const validItems = state._lastOrderForRepeat || [];
      state.pedidoAtual.items = validItems;
      if (prefs.last_address) {
        state.pedidoAtual.type = 'delivery';
        state.pedidoAtual.address = prefs.last_address;
        state.pedidoAtual.deliveryFee = Number(company.delivery_fee || 5);
      }
      if (prefs.favorite_payment) {
        state.pedidoAtual.paymentMethod = prefs.favorite_payment;
      }
      state._awaitingPrefsConfirmation = false;
      state._lastOrderForRepeat = undefined;

      // Valida pedido reconstruído antes de confirmar
      const validation = orderEngine.validateOrder(state.pedidoAtual);
      if (!validation.valid) {
        // Itens desativados ou incompletos — volta ao fluxo normal
        resetPedido(state);
        state.etapa = 'MONTANDO_TAMANHO';
        return { state, response: T.itensIndisponiveisNovoPedido() };
      }

      if (state.pedidoAtual.items.length > 0 && state.pedidoAtual.type && state.pedidoAtual.paymentMethod) {
        state.etapa = 'CONFIRMANDO';
        return buildConfirmation(state, company);
      }
      if (state.pedidoAtual.items.length > 0) {
        state.etapa = 'AGUARDANDO_TIPO';
        return { state, response: T.perguntarTipo(state.pedidoAtual.items) };
      }
    }
    state._awaitingPrefsConfirmation = false;
    state._lastOrderForRepeat = undefined;
  }

  // ═════════════════════════════════════════════════════════════
  // RETOMAR PEDIDO APÓS CANCELAMENTO — "continuar", "voltar"
  // ═════════════════════════════════════════════════════════════
  const lowerInicio = ai.normalizar(text);
  if (state._pedidoBackup && /\bcontinua(r)?\b|\bvoltar?\b|\bretom(ar|a)\b|\bsim\b/.test(lowerInicio)) {
    state.pedidoAtual = state._pedidoBackup;
    state._pedidoBackup = null;
    state.etapa = 'CONFIRMANDO';
    const resumo = buildConfirmation(state, company);
    resumo.response.unshift('Pedido restaurado! Confira o resumo:');
    return resumo;
  }
  // Se decidiu não continuar, limpa o backup
  state._pedidoBackup = null;

  resetPedido(state);

  // ═════════════════════════════════════════════════════════════
  // BOOTSTRAP CONTEXT — Monta contexto ANTES de decidir saudação
  // ═════════════════════════════════════════════════════════════
  const cardapio = await getCardapio(companyId);
  const ctx = await bootstrapContext.bootstrap(companyId, phone, text, cardapio, company);

  // Guarda contexto no state para uso posterior
  state._customerName = ctx.customer?.name || ctx.extractedName || null;
  state._preferences = ctx.customer?.preferences || {};
  state._bootstrapDecision = ctx.decisionType;
  if (ctx.activeOrder) {
    state._activeOrder = ctx.activeOrder;
  }

  // ─── DECISÃO 0: Cliente com pedido ativo (menos de 2 horas) ─────────────
  if (ctx.decisionType === 'ACTIVE_ORDER' && ctx.activeOrder) {
    state.etapa = 'MONTANDO_TAMANHO';
    return {
      state,
      _skipHumanize: true,
      response: T.saudacaoActiveOrder(ctx.customer.name, ctx.activeOrder)
    };
  }

  // ─── DECISÃO 1: Cliente recorrente COM histórico ──────────────────────
  if (ctx.decisionType === 'RETURNING_WITH_HISTORY' && ctx.lastOrderValid.length > 0) {
    // Se cliente já disse que quer repetir (ex: "quero o mesmo de ontem")
    if (text && text.length > 2) {
      const querRepetir = await classificarIntencaoRepetir(text);
      if (querRepetir) {
        logger.debug('skill.memory.activated', { phone });
        state.pedidoAtual.items = ctx.lastOrderValid;
        state.etapa = 'OFERECENDO_UPSELL';
        state._upsellPhase = 'bebida';
        const resumo = T.resumoRepetirPedido(ctx.lastOrderSummary);
        return { state, response: T.oferecerUpsellBebida(resumo) };
      }
    }

    // Oferece repetir proativamente
    state._awaitingPrefsConfirmation = true;
    state._lastOrderForRepeat = ctx.lastOrderValid;
    return {
      state,
      _skipHumanize: true,
      response: T.saudacaoReturningComHistorico(ctx.customer.name, ctx.lastOrderSummary)
    };
  }

  // ─── DECISÃO 2: Cliente recorrente SEM histórico ───────────────────────
  if (ctx.decisionType === 'RETURNING_NO_HISTORY' && ctx.customer?.name) {
    // Define etapa inicial conforme plugin
    if (plugin && plugin.business_type === 'acougue') {
      state.etapa = 'AGUARDANDO_PEDIDO_ACOUGUE';
      return {
        state,
        _skipHumanize: true,
        response: T.saudacaoReturningSemHistorico(ctx.customer.name, company.name)
      };
    }

    state.etapa = 'MONTANDO_TAMANHO';
    const saudacao = T.saudacaoReturningSemHistorico(ctx.customer.name, company.name);

    // SLOT FILLING: Se a primeira mensagem já tem tamanho, avança
    const multiTamanho = ai.interpretarPedidoMultiTamanho(text);
    if (multiTamanho && multiTamanho.length > 0) {
      state._grupos = multiTamanho.map(g => ({
        tamanho: g.size, qty: g.qty, proteinas: null, acompanhamentos: null, saladas: null
      }));
      state._currentGrupoIndex = 0;
      state.etapa = 'MONTANDO_PROTEINA';
      const labelGrupo = _labelGrupo(state._grupos[0]);
      return {
        state,
        _skipHumanize: true,
        response: [saudacao, `✅ Anotado!\n\nPara ${labelGrupo}, qual proteína?\nFrango, Churrasco, Costela, Linguiça ou Carne Cozida`]
      };
    }

    const tamanhoSimples = ai.interpretTamanho(text);
    if (tamanhoSimples) {
      state._pendingMarmitas = 1;
      state._currentMarmitaNumber = 1;
      iniciarNovaMarmita(tamanhoSimples, state);
      state.etapa = 'MONTANDO_PROTEINA';
      return {
        state,
        _skipHumanize: true,
        response: [saudacao, `✅ Marmita ${tamanhoSimples}!\n\nEscolha até *2 proteínas*:\n🍗 Frango | 🥩 Churrasco | 🍖 Costela | 🌭 Linguiça | 🥩 Carne Cozida`]
      };
    }

    return {
      state,
      _skipHumanize: true,
      response: saudacao
    };
  }

  // ─── DECISÃO 3: Cliente NOVO ──────────────────────────────────────
  // Define etapa inicial conforme plugin
  if (plugin && plugin.business_type === 'acougue') {
    state.etapa = 'AGUARDANDO_PEDIDO_ACOUGUE';
  } else {
    state.etapa = 'MONTANDO_TAMANHO';
  }

  // Se detectou nome na mensagem, salva no banco para próxima vez
  if (ctx.extractedName) {
    await db.saveCustomer(companyId, phone, ctx.extractedName);
    state._customerName = ctx.extractedName;
    logger.debug('bootstrap.new_customer_name_extracted', { phone, name: ctx.extractedName });
    return {
      state,
      _skipHumanize: true,
      response: T.saudacaoNovoClienteComNome(ctx.extractedName, company.name, ctx.topProductsFormatted)
    };
  }

  // Cliente novo sem nome detectado
  const response = T.saudacaoNovoClienteSemNome(company.name, ctx.topProductsFormatted);

  // ═══════════════════════════════════════════════════════════════════════════
  // SLOT FILLING INICIAL: Se a primeira mensagem já tem o pedido (tamanho/qty)
  // ═══════════════════════════════════════════════════════════════════════════
  const multiTamanho = ai.interpretarPedidoMultiTamanho(text);
  if (multiTamanho && multiTamanho.length > 0) {
    state._grupos = multiTamanho.map(g => ({
      tamanho: g.size, qty: g.qty, proteinas: null, acompanhamentos: null, saladas: null
    }));
    state._currentGrupoIndex = 0;
    state.etapa = 'MONTANDO_PROTEINA';
    
    const labelGrupo = _labelGrupo(state._grupos[0]);
    const proxPergunta = `✅ Anotado!\n\nPara ${labelGrupo}, qual proteína?\nFrango, Churrasco, Costela, Linguiça ou Carne Cozida`;
    
    return {
      state,
      _skipHumanize: true,
      response: [response, proxPergunta]
    };
  }

  const tamanhoSimples = ai.interpretTamanho(text);
  if (tamanhoSimples) {
    const qty = ai.interpretQuantity(text) || 1;
    state._pendingMarmitas = 1;
    state._currentMarmitaNumber = 1;
    iniciarNovaMarmita(tamanhoSimples, state);
    state.etapa = 'MONTANDO_PROTEINA';
    
    const proxPergunta = `✅ Marmita ${tamanhoSimples}!\n\nEscolha até *2 proteínas*:\n🍗 Frango | 🥩 Churrasco | 🍖 Costela | 🌭 Linguiça | 🥩 Carne Cozida`;
    
    return {
      state,
      _skipHumanize: true,
      response: [response, proxPergunta]
    };
  }

  return {
    state,
    _skipHumanize: true,
    response
  };
}

async function handleTamanho(text, state) {
  const lower = ai.normalizar(text);

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP-BASED ORDER MODEL
  // "2 grandes e 3 pequenas" → grupos, NÃO itens individuais
  // Pergunta por GRUPO, não por item
  // ═══════════════════════════════════════════════════════════════════════════
  const multiTamanho = ai.interpretarPedidoMultiTamanho(text);
  if (multiTamanho && multiTamanho.length > 0) {
    // Cria GRUPOS (não expande em itens ainda!)
    state._grupos = multiTamanho.map(g => ({
      tamanho: g.size,
      qty: g.qty,
      proteinas: null,      // null = não preenchido
      acompanhamentos: null,
      saladas: null
    }));
    
    state._currentGrupoIndex = 0;
    
    // Calcula total
    const totalItens = multiTamanho.reduce((sum, g) => sum + g.qty, 0);
    const resumoGrupos = multiTamanho.map(g => `${g.qty} ${g.size}`).join(' + ');
    
    // Pergunta proteína do PRIMEIRO GRUPO
    const primeiroGrupo = state._grupos[0];
    const labelGrupo = _labelGrupo(primeiroGrupo);
    
    state.etapa = 'MONTANDO_PROTEINA';
    
    return {
      state,
      _skipHumanize: true,
      response: `✅ Anotado! ${resumoGrupos} = ${totalItens} marmita(s) 👍\n\nPara ${labelGrupo}, qual proteína?\nFrango, Churrasco, Costela, Linguiça ou Carne Cozida`
    };
  }

  const tamanho = ai.interpretTamanho(text);

  // ═══════════════════════════════════════════════════════════════════════════
  // SLOT VALIDATION: Se tamanho JÁ foi preenchido, avança direto para proteína
  // ═══════════════════════════════════════════════════════════════════════════
  if (state._marmitaAtual && state._marmitaAtual.tamanho) {
    const proteinasDetectadas = ai.interpretItensMultiplos(text, CARDAPIO_DEFAULT.proteinas);
    if (proteinasDetectadas.length > 0) {
      state._marmitaAtual.proteinas.push(...proteinasDetectadas.slice(0, 2));
      state.etapa = 'MONTANDO_ACOMPANHAMENTO';
      return { state, _skipHumanize: true, response: T.pedirAcompanhamento() };
    }
    state.etapa = 'MONTANDO_PROTEINA';
    return { state, _skipHumanize: true, response: `Anotado ${state._marmitaAtual.tamanho} 👍 Quais proteínas? (até 2)` };
  }

  let qty = ai.interpretQuantity(text) || 1;

  // Detecta intenção de repetir a marmita anterior
  const querRepetir = /igual|mesmo|mesma|repet|primeira|anterior|de novo/.test(lower);
  if (querRepetir && state.pedidoAtual.items.length > 0) {
    const modelo = state.pedidoAtual.items.find(i => i.tipo === 'marmita');
    if (modelo) {
      const faltam = state._pendingMarmitas - state._currentMarmitaNumber + 1;
      const qtRepetir = ai.interpretQuantity(text) || faltam;
      const reais = Math.min(qtRepetir, faltam);

      for (let i = 0; i < reais; i++) {
        state.pedidoAtual.items.push(JSON.parse(JSON.stringify(modelo)));
        state._currentMarmitaNumber++;
      }

      if (state._currentMarmitaNumber <= state._pendingMarmitas) {
        state.etapa = 'MONTANDO_TAMANHO';
        return { state, _skipHumanize: true, response: T.proximaMarmita() };
      }

      state.etapa = 'OFERECENDO_UPSELL';
      state._upsellPhase = 'bebida';
      return {
        state,
        _skipHumanize: true,
        response: T.oferecerUpsellBebida(`✅ ${reais} marmita(s) igual(is) à primeira anotada(s)!`)
      };
    }
  }

  if (!tamanho) {
    return { state, _skipHumanize: true, response: T.tamanhoNaoEntendido() };
  }

  // Marmita única (ou quantidade do mesmo tamanho)
  if (qty > 1) {
    // Cria um grupo único
    state._grupos = [{
      tamanho: tamanho,
      qty: qty,
      proteinas: null,
      acompanhamentos: null,
      saladas: null
    }];
    state._currentGrupoIndex = 0;
    state.etapa = 'MONTANDO_PROTEINA';
    
    const labelGrupo = _labelGrupo(state._grupos[0]);
    return {
      state,
      _skipHumanize: true,
      response: `✅ ${qty} marmitas ${tamanho}!\n\nPara ${labelGrupo}, qual proteína?`
    };
  }

  // Marmita única simples
  state._pendingMarmitas = 1;
  state._currentMarmitaNumber = 1;
  iniciarNovaMarmita(tamanho, state);
  state.etapa = 'MONTANDO_PROTEINA';

  return { 
    state, 
    _skipHumanize: true, 
    response: `✅ Marmita ${tamanho}!\n\nEscolha até *2 proteínas*:\n🍗 Frango | 🥩 Churrasco | 🍖 Costela | 🌭 Linguiça | 🥩 Carne Cozida`
  };
}

/**
 * Interpreta proteínas atribuídas por grupo.
 * Ex: "nas grandes frango, nas pequenas churrasco"
 * Retorna array de { tamanho, proteinas[] } ou null se não conseguir parsear
 */
function _interpretarProteinaPorGrupo(text, grupos, proteinasDisponiveis) {
  const lower = ai.normalizar(text);
  // Se não menciona tamanhos, retorna null
  if (!/(grande|pequena)/i.test(lower)) return null;
  
  const resultado = [];
  // Pattern: "na(s) grande(s) X, na(s) pequena(s) Y"
  const patterns = [
    /(?:na[s]?\s*)?(grande[s]?)\s+([^,;]+)/gi,
    /(?:na[s]?\s*)?(pequena[s]?)\s+([^,;]+)/gi
  ];
  
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const tamanho = m[1].toLowerCase().replace(/s$/, '');
      const protsText = m[2];
      const prots = ai.interpretItensMultiplos(protsText, proteinasDisponiveis);
      if (prots.length > 0) {
        resultado.push({
          tamanho: tamanho.charAt(0).toUpperCase() + tamanho.slice(1),
          proteinas: prots.slice(0, 2).map(p => p.name || p)
        });
      }
    }
  }
  
  return resultado.length > 0 ? resultado : null;
}

/**
 * Gera label descritivo do grupo para perguntas.
 * Ex: "a grande" | "as 2 grandes" | "as 3 pequenas"
 */
function _labelGrupo(grupo) {
  if (grupo.qty === 1) {
    return `a *marmita ${grupo.tamanho.toLowerCase()}*`;
  }
  return `as *${grupo.qty} marmitas ${grupo.tamanho.toLowerCase()}s*`;
}

function handleProteina(text, state, cardapio) {
  const selecionadas = ai.interpretItensMultiplos(text, cardapio.proteinas);
  const lower = ai.normalizar(text);

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP MODE: Se temos grupos, trabalha com o grupo atual
  // ═══════════════════════════════════════════════════════════════════════════
  if (state._grupos && state._grupos.length > 0) {
    const grupoAtual = state._grupos[state._currentGrupoIndex];
    
    // Interpreta resposta com contexto do grupo
    // Ex: "nas grandes frango, nas pequenas churrasco"
    const multiGrupoProteina = _interpretarProteinaPorGrupo(text, state._grupos, cardapio.proteinas);
    if (multiGrupoProteina) {
      // Preencheu múltiplos grupos de uma vez!
      for (const match of multiGrupoProteina) {
        const idx = state._grupos.findIndex(g => 
          g.tamanho.toLowerCase() === match.tamanho.toLowerCase() && g.proteinas === null
        );
        if (idx >= 0) {
          state._grupos[idx].proteinas = match.proteinas;
        }
      }
      
      // Avança para o próximo grupo não preenchido
      const proximoIdx = state._grupos.findIndex(g => g.proteinas === null);
      if (proximoIdx >= 0) {
        state._currentGrupoIndex = proximoIdx;
        const proximoGrupo = state._grupos[proximoIdx];
        return {
          state,
          _skipHumanize: true,
          response: `✅ Anotado!\n\nE para ${_labelGrupo(proximoGrupo)}, qual proteína?`
        };
      }
      
      // Todos os grupos têm proteína — vai para acompanhamentos+saladas
      state._currentGrupoIndex = 0;
      state.etapa = 'MONTANDO_ACOMPANHAMENTO';
      const primeiroGrupo = state._grupos[0];
      return {
        state,
        _skipHumanize: true,
        response: `✅ Proteínas anotadas!\n\nAgora para ${_labelGrupo(primeiroGrupo)}:\n${T.pedirAcompanhamentoESalada()}`
      };
    }
    
    // Proteína única para o grupo atual
    if (selecionadas.length > 0) {
      grupoAtual.proteinas = selecionadas.slice(0, 2).map(p => p.name || p);
      
      // Confirmação parcial
      const protsResumo = grupoAtual.proteinas.join(' + ');
      
      // Próximo grupo sem proteína?
      const proximoIdx = state._grupos.findIndex((g, i) => i > state._currentGrupoIndex && g.proteinas === null);
      if (proximoIdx >= 0) {
        state._currentGrupoIndex = proximoIdx;
        const proximoGrupo = state._grupos[proximoIdx];
        return {
          state,
          _skipHumanize: true,
          response: `${grupoAtual.tamanho}: **${protsResumo}** ✅\n\nE para ${_labelGrupo(proximoGrupo)}, qual proteína?`
        };
      }
      
      // Todos os grupos têm proteína — acompanhamento+salada do primeiro grupo
      state._currentGrupoIndex = 0;
      state.etapa = 'MONTANDO_ACOMPANHAMENTO';
      const primeiroGrupo = state._grupos[0];
      return {
        state,
        _skipHumanize: true,
        response: `${grupoAtual.tamanho}: **${protsResumo}** ✅\n\nAgora para ${_labelGrupo(primeiroGrupo)}:\n${T.pedirAcompanhamentoESalada()}`
      };
    }
    
    // Não entendeu
    state._loopCount = (state._loopCount || 0) + 1;
    if (state._loopCount >= 2) {
      state._loopCount = 0;
      grupoAtual.proteinas = [];
      // Próximo grupo ou acompanhamento
      const proximoIdx = state._grupos.findIndex((g, i) => i > state._currentGrupoIndex && g.proteinas === null);
      if (proximoIdx >= 0) {
        state._currentGrupoIndex = proximoIdx;
        return { state, _skipHumanize: true, response: `Pulei a proteína. E para ${_labelGrupo(state._grupos[proximoIdx])}, qual proteína?` };
      }
      state._currentGrupoIndex = 0;
      state.etapa = 'MONTANDO_ACOMPANHAMENTO';
      return { state, _skipHumanize: true, response: `Tudo bem! Para ${_labelGrupo(state._grupos[0])}:\n${T.pedirAcompanhamentoESalada()}` };
    }
    
    return { state, _skipHumanize: true, response: `Não entendi. Para ${_labelGrupo(grupoAtual)}, qual proteína?\nFrango, Churrasco, Costela, Linguiça ou Carne Cozida` };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE MODE: Marmita única (comportamento original)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // SAFEGUARD: Se cliente reclama "já falei X", confirma e avança
  if (/ja falei|ja disse|voce nao (ta |está )?(me )?entendendo|ja informei/.test(lower)) {
    const tamanhoMencionado = ai.interpretTamanho(text);
    const qtyMencionada = ai.interpretQuantity(text) || state._pendingMarmitas;
    
    if (tamanhoMencionado && state._marmitaAtual) {
      state._marmitaAtual.tamanho = tamanhoMencionado;
      state._pendingMarmitas = qtyMencionada;
      return { 
        state, 
        _skipHumanize: true, 
        response: `Anotado! ${qtyMencionada} marmita(s) ${tamanhoMencionado} 👍\n\nAgora me diz as proteínas de cada uma (até 2 por marmita):`
      };
    }
    
    // Se ele já deu proteínas antes, confirma e avança
    if (state._marmitaAtual && state._marmitaAtual.proteinas.length > 0) {
      state.etapa = 'MONTANDO_ACOMPANHAMENTO';
      const protsResumo = state._marmitaAtual.proteinas.map(p => p.name || p).join(' + ');
      return { 
        state, 
        _skipHumanize: true, 
        response: `Anotado! Proteínas: ${protsResumo} 👍\n\nQuais acompanhamentos? Arroz, Feijão, Purê, Macarrão ou Tropeiro?`
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MULTI-ITEM: "churrasco e frango em uma, na outra frango, na outra linguiça"
  // ═══════════════════════════════════════════════════════════════════════════
  if (state._pendingMarmitas > 1) {
    const multiProteinas = ai.interpretarProteinasMultiplas(text, cardapio.proteinas, state._pendingMarmitas);
    if (multiProteinas && multiProteinas.length >= 2) {
      // Montou múltiplas marmitas de uma vez
      const tamanho = state._marmitaAtual?.tamanho || 'Pequena';
      const preco = tamanho === 'Grande' ? 22 : 20;
      
      // Limpa marmita atual (vamos criar todas do zero)
      state._marmitaAtual = null;
      
      // Cria marmitas com as proteínas especificadas
      for (let i = 0; i < Math.min(multiProteinas.length, state._pendingMarmitas); i++) {
        const novaM = {
          tipo: 'marmita',
          tamanho: tamanho,
          price: preco,
          quantity: 1,
          proteinas: multiProteinas[i].map(name => ({ name })),
          acompanhamentos: [],
          saladas: []
        };
        state.pedidoAtual.items.push(novaM);
      }
      
      // Formata confirmação
      const resumo = multiProteinas.map((prots, idx) => 
        `${idx + 1}. ${prots.join(' + ')}`
      ).join('\n');
      
      // Avança para acompanhamentos (vamos perguntar genérico para todas)
      state._currentMarmitaNumber = state._pendingMarmitas + 1; // Marca todas como preenchidas
      state.etapa = 'MONTANDO_ACOMPANHAMENTO';
      state._marmitaAtual = state.pedidoAtual.items[0]; // Edita a primeira
      
      return { 
        state, 
        _skipHumanize: true, 
        response: `Perfeito! 👍\n\n${state._pendingMarmitas} marmitas ${tamanho}:\n${resumo}\n\n${T.pedirAcompanhamentoESalada()}`
      };
    }
  }

  if (selecionadas.length === 0) {
    const lower = ai.normalizar(text);
    if (lower.includes('so') || lower.includes('nao quero') || lower.includes('nada') || lower.includes('nenhum')) {
      // Permite pular
      state._loopCount = 0;
      state.etapa = 'MONTANDO_ACOMPANHAMENTO';
      return { state, _skipHumanize: true, response: T.pedirAcompanhamento() };
    }
    // Se ele só disse "sim", "pode", etc., apenas repetimos o pedido sem erro grosseiro
    if (/sim|pode|quero|ok|claro/.test(lower)) {
      return { state, _skipHumanize: true, response: T.pedirProteina() };
    }

    // Incrementa contador de loops
    state._loopCount = (state._loopCount || 0) + 1;

    // Após 2 tentativas sem sucesso → pula a etapa
    if (state._loopCount >= 2) {
      state._loopCount = 0;
      state._marmitaAtual.proteinas = [];
      state.etapa = 'MONTANDO_ACOMPANHAMENTO';
      return { state, _skipHumanize: true, response: 'Tudo bem! Vou pular a proteína. Quais *acompanhamentos*? Arroz, Feijão, Purê, Macarrão ou Tropeiro?' };
    }

    return { state, _skipHumanize: true, response: T.proteinaNaoEntendida() };
  }

  // Reseta contador ao avançar com sucesso
  state._loopCount = 0;

  // Adiciona ATÉ 2 proteínas. Se ele mandou "frango e churrasco e linguiça", pega 2.
  state._marmitaAtual.proteinas.push(...selecionadas.slice(0, 2));

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIRMAÇÃO + SUGESTÃO INTELIGENTE
  // ═══════════════════════════════════════════════════════════════════════════
  const protNomes = state._marmitaAtual.proteinas.map(p => p.name || p);
  const eco = ecoResponse.gerarEco(protNomes, 'proteina');
  
  // Tenta sugestão inteligente baseada na proteína
  const sugestao = smartSuggestion.sugerirAcompanhamento(protNomes);
  state._sugestaoAtual = sugestao?.sugestao || null;
  
  state.etapa = 'MONTANDO_ACOMPANHAMENTO';
  
  if (sugestao) {
    return { 
      state, 
      _skipHumanize: true, 
      response: ecoResponse.combinarEcoEPergunta(eco, sugestao.mensagem + '\nOu prefere outro?')
    };
  }
  
  return { 
    state, 
    _skipHumanize: true, 
    response: ecoResponse.combinarEcoEPergunta(eco, T.pedirAcompanhamentoESalada())
  };
}

function handleAcompanhamento(text, state, cardapio) {
  const acomps = ai.interpretItensMultiplos(text, cardapio.acompanhamentos);
  const saladas = ai.interpretItensMultiplos(text, cardapio.saladas);
  const lower = ai.normalizar(text);

  // ═══════════════════════════════════════════════════════════════════════════
  // ATALHO: Cliente aceitou sugestão com "sim/pode/isso"
  // ═══════════════════════════════════════════════════════════════════════════
  if (state._sugestaoAtual && smartSuggestion.detectarAceitacaoSugestao(text)) {
    if (state._grupos && state._grupos.length > 0) {
      const grupoAtual = state._grupos[state._currentGrupoIndex];
      grupoAtual.acompanhamentos = state._sugestaoAtual;
      grupoAtual.saladas = [];
    } else if (state._marmitaAtual) {
      state._marmitaAtual.acompanhamentos = state._sugestaoAtual.map(name => ({ name }));
      state._marmitaAtual.saladas = [];
    }
    state._sugestaoAtual = null;
    
    const eco = ecoResponse.gerarEco(['Anotado'], 'acompanhamento');
    
    // SINGLE MODE — finaliza marmita direto
    if (!state._grupos || state._grupos.length === 0) {
      finalizarMarmitaAtual(state);
      return _avancarAposMarmitaCompleta(state, cardapio);
    }
    
    // GROUP MODE — próximo grupo sem acomp ou avança
    const proximoIdx = state._grupos.findIndex((g, i) => i > state._currentGrupoIndex && g.acompanhamentos === null);
    if (proximoIdx >= 0) {
      state._currentGrupoIndex = proximoIdx;
      const proximoGrupo = state._grupos[proximoIdx];
      return {
        state,
        _skipHumanize: true,
        response: ecoResponse.combinarEcoEPergunta(eco, `Para ${_labelGrupo(proximoGrupo)}, quais acompanhamentos e saladas?\n${T.pedirAcompanhamentoESalada()}`)
      };
    }
    // Todos os grupos completos
    return _expandirGruposEAvancar(state, cardapio);
  }
  state._sugestaoAtual = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP MODE: Se temos grupos, trabalha com o grupo atual
  // ═══════════════════════════════════════════════════════════════════════════
  if (state._grupos && state._grupos.length > 0) {
    const grupoAtual = state._grupos[state._currentGrupoIndex];
    
    if (acomps.length > 0 || saladas.length > 0) {
      grupoAtual.acompanhamentos = acomps.length > 0 ? acomps.slice(0, 2).map(a => a.name || a) : [];
      grupoAtual.saladas = saladas.length > 0 ? saladas.slice(0, 2).map(s => s.name || s) : [];
      
      const partes = [];
      if (grupoAtual.acompanhamentos.length > 0) partes.push(grupoAtual.acompanhamentos.join(' + '));
      if (grupoAtual.saladas.length > 0) partes.push(grupoAtual.saladas.join(' + '));
      const eco = ecoResponse.gerarEco(partes, 'acompanhamento');
      
      // Próximo grupo sem acompanhamento?
      const proximoIdx = state._grupos.findIndex((g, i) => i > state._currentGrupoIndex && g.acompanhamentos === null);
      if (proximoIdx >= 0) {
        state._currentGrupoIndex = proximoIdx;
        const proximoGrupo = state._grupos[proximoIdx];
        return {
          state,
          _skipHumanize: true,
          response: ecoResponse.combinarEcoEPergunta(eco, `Para ${_labelGrupo(proximoGrupo)}, quais acompanhamentos e saladas?\n${T.pedirAcompanhamentoESalada()}`)
        };
      }
      
      // Todos os grupos completos
      return _expandirGruposEAvancar(state, cardapio);
    }
    
    // Quer pular
    if (/nao|nada|pula|so|sem/.test(lower)) {
      state._loopCount = 0;
      grupoAtual.acompanhamentos = [];
      grupoAtual.saladas = [];
      const proximoIdx = state._grupos.findIndex((g, i) => i > state._currentGrupoIndex && g.acompanhamentos === null);
      if (proximoIdx >= 0) {
        state._currentGrupoIndex = proximoIdx;
        return { state, _skipHumanize: true, response: `Sem acompanhamento 👍\n\nPara ${_labelGrupo(state._grupos[proximoIdx])}, quais acompanhamentos e saladas?\n${T.pedirAcompanhamentoESalada()}` };
      }
      return _expandirGruposEAvancar(state, cardapio);
    }
    
    // Não entendeu
    state._loopCount = (state._loopCount || 0) + 1;
    if (state._loopCount >= 2) {
      state._loopCount = 0;
      grupoAtual.acompanhamentos = [];
      grupoAtual.saladas = [];
      const proximoIdx = state._grupos.findIndex((g, i) => i > state._currentGrupoIndex && g.acompanhamentos === null);
      if (proximoIdx >= 0) {
        state._currentGrupoIndex = proximoIdx;
        return { state, _skipHumanize: true, response: `Pulei. E para ${_labelGrupo(state._grupos[proximoIdx])}, quais acompanhamentos e saladas?\n${T.pedirAcompanhamentoESalada()}` };
      }
      return _expandirGruposEAvancar(state, cardapio);
    }
    
    return { state, _skipHumanize: true, response: `Para ${_labelGrupo(grupoAtual)}:\n${T.pedirAcompanhamentoESalada()}` };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE MODE: Marmita única
  // ═══════════════════════════════════════════════════════════════════════════

  if (acomps.length === 0 && saladas.length === 0 && text.length > 2) {
    if (/nao|nada|pula|so|sem/.test(lower)) {
      state._loopCount = 0;
      state._marmitaAtual.acompanhamentos = [];
      state._marmitaAtual.saladas = [];
      finalizarMarmitaAtual(state);
      return _avancarAposMarmitaCompleta(state, cardapio);
    }
    if (/sim|pode|quero|ok|claro/.test(lower)) {
      return { state, _skipHumanize: true, response: T.pedirAcompanhamentoESalada() };
    }

    state._loopCount = (state._loopCount || 0) + 1;
    if (state._loopCount >= 2) {
      state._loopCount = 0;
      state._marmitaAtual.acompanhamentos = [];
      state._marmitaAtual.saladas = [];
      finalizarMarmitaAtual(state);
      return _avancarAposMarmitaCompleta(state, cardapio);
    }

    return { state, _skipHumanize: true, response: T.pedirAcompanhamentoESalada() };
  }

  // Reseta contador e aplica ambos
  state._loopCount = 0;
  if (!state._marmitaAtual.saladas) state._marmitaAtual.saladas = [];
  if (acomps.length > 0) {
    state._marmitaAtual.acompanhamentos.push(...acomps.slice(0, 2));
  }
  if (saladas.length > 0) {
    state._marmitaAtual.saladas.push(...saladas.slice(0, 2));
  }

  // Eco do que foi escolhido
  const nomes = [
    ...state._marmitaAtual.acompanhamentos.map(a => a.name || a),
    ...state._marmitaAtual.saladas.map(s => s.name || s)
  ];
  const eco = ecoResponse.gerarEco(nomes, 'acompanhamento');

  finalizarMarmitaAtual(state);
  
  // Verifica se resultado tem próxima marmita
  const resultado = _avancarAposMarmitaCompleta(state, cardapio);
  
  // Prepend eco to response
  if (eco && resultado.response) {
    const resArr = Array.isArray(resultado.response) ? resultado.response : [resultado.response];
    resultado.response = [eco, ...resArr];
  }
  
  return resultado;
}

/**
 * Expande os grupos em itens individuais e avança para upsell/tipo.
 * Usado pelo handleAcompanhamento combinado quando todos os grupos estão completos.
 */
function _expandirGruposEAvancar(state, cardapio) {
  for (const grupo of state._grupos) {
    const tamanho = grupo.tamanho;
    const preco = tamanho === 'Grande' ? 22 : 20;
    
    for (let i = 0; i < grupo.qty; i++) {
      state.pedidoAtual.items.push({
        tipo: 'marmita',
        tamanho: tamanho,
        price: preco,
        quantity: 1,
        proteinas: (grupo.proteinas || []).map(name => ({ name })),
        acompanhamentos: (grupo.acompanhamentos || []).map(name => ({ name })),
        saladas: (grupo.saladas || []).map(name => ({ name }))
      });
    }
  }
  
  const totalMarmitas = state._grupos.reduce((sum, g) => sum + g.qty, 0);
  state._grupos = null;
  state._currentGrupoIndex = 0;
  
  // Vai para upsell ou tipo se já pulou
  if (!state._upsellDone) {
    state.etapa = 'OFERECENDO_UPSELL';
    state._upsellPhase = 'bebida';
    return {
      state,
      _skipHumanize: true,
      response: T.oferecerUpsellBebida(`✅ ${totalMarmitas} marmita(s) anotada(s)!`)
    };
  }
  
  state.etapa = 'AGUARDANDO_TIPO';
  return { state, _skipHumanize: true, response: T.perguntarTipo(state.pedidoAtual.items) };
}

/**
 * Avança após finalizar uma marmita no SINGLE mode.
 * Verifica itensPendentes, pendingMarmitas, e vai para upsell.
 */
function _avancarAposMarmitaCompleta(state, cardapio) {
  // Multi-item mode
  if (state._itensPendentes && state._itensPendentes.length > 0) {
    state._currentItemIndex = (state._currentItemIndex || 0) + 1;
    
    if (state._currentItemIndex < state._itensPendentes.length) {
      const proximoItem = state._itensPendentes[state._currentItemIndex];
      iniciarNovaMarmita(proximoItem.size, state);
      state.etapa = 'MONTANDO_PROTEINA';
      
      const numItem = state._currentItemIndex + 1;
      return {
        state,
        _skipHumanize: true,
        response: `✅ Marmita ${numItem - 1} anotada!\n\nAgora vamos montar a *${numItem}ª* (${proximoItem.size}) 👇\n\nQual proteína?`
      };
    }
    
    state._itensPendentes = null;
    state._currentItemIndex = 0;
  }

  // Modo antigo: mais marmitas pending
  if (state._currentMarmitaNumber < state._pendingMarmitas) {
    state._currentMarmitaNumber++;
    state.etapa = 'MONTANDO_TAMANHO';
    return { state, _skipHumanize: true, response: T.proximaMarmita() };
  }

  // Última marmita — upsell
  const totalMarmitas = state.pedidoAtual.items.filter(i => i.tipo === 'marmita').length;
  
  if (!state._upsellDone) {
    state.etapa = 'OFERECENDO_UPSELL';
    state._upsellPhase = 'bebida';
    return {
      state,
      _skipHumanize: true,
      response: T.oferecerUpsellBebida(`✅ ${totalMarmitas} marmita(s) anotada(s)!`)
    };
  }
  
  state.etapa = 'AGUARDANDO_TIPO';
  return { state, _skipHumanize: true, response: T.perguntarTipo(state.pedidoAtual.items) };
}

function handleSalada(text, state, cardapio) {
  const selecionados = ai.interpretItensMultiplos(text, cardapio.saladas);
  const lower = ai.normalizar(text);

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP MODE: Se temos grupos, trabalha com o grupo atual
  // ═══════════════════════════════════════════════════════════════════════════
  if (state._grupos && state._grupos.length > 0) {
    const grupoAtual = state._grupos[state._currentGrupoIndex];
    
    // Resposta válida
    if (selecionados.length > 0) {
      grupoAtual.saladas = selecionados.slice(0, 2).map(s => s.name || s);
    } else if (/nao|nada|pula|so|sem/.test(lower)) {
      grupoAtual.saladas = [];
    } else {
      // Não entendeu
      state._loopCount = (state._loopCount || 0) + 1;
      if (state._loopCount >= 2) {
        state._loopCount = 0;
        grupoAtual.saladas = [];
      } else {
        return { state, _skipHumanize: true, response: `Para ${_labelGrupo(grupoAtual)}, quais saladas?\nMaionese, Beterraba, Alface, Repolho ou Pepino` };
      }
    }
    
    state._loopCount = 0;
    const saladaResumo = grupoAtual.saladas.length > 0 ? grupoAtual.saladas.join(' + ') : 'sem salada';
    
    // Próximo grupo sem salada?
    const proximoIdx = state._grupos.findIndex((g, i) => i > state._currentGrupoIndex && g.saladas === null);
    if (proximoIdx >= 0) {
      state._currentGrupoIndex = proximoIdx;
      const proximoGrupo = state._grupos[proximoIdx];
      return {
        state,
        _skipHumanize: true,
        response: `${grupoAtual.tamanho}: **${saladaResumo}** ✅\n\nE para ${_labelGrupo(proximoGrupo)}, quais saladas?\nMaionese, Beterraba, Alface, Repolho ou Pepino`
      };
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // TODOS OS GRUPOS COMPLETOS! Expande grupos em itens individuais
    // ═══════════════════════════════════════════════════════════════════════
    for (const grupo of state._grupos) {
      const tamanho = grupo.tamanho;
      const preco = tamanho === 'Grande' ? 22 : 20; // Só Pequena (20) ou Grande (22)
      
      for (let i = 0; i < grupo.qty; i++) {
        state.pedidoAtual.items.push({
          tipo: 'marmita',
          tamanho: tamanho,
          price: preco,
          quantity: 1,
          proteinas: (grupo.proteinas || []).map(name => ({ name })),
          acompanhamentos: (grupo.acompanhamentos || []).map(name => ({ name })),
          saladas: (grupo.saladas || []).map(name => ({ name }))
        });
      }
    }
    
    // Limpa estado de grupos
    const totalMarmitas = state._grupos.reduce((sum, g) => sum + g.qty, 0);
    state._grupos = null;
    state._currentGrupoIndex = 0;
    
    // Vai para upsell
    state.etapa = 'OFERECENDO_UPSELL';
    state._upsellPhase = 'bebida';
    return {
      state,
      _skipHumanize: true,
      response: T.oferecerUpsellBebida(`✅ ${totalMarmitas} marmita(s) anotada(s)!`)
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE MODE: Marmita única (comportamento original)
  // ═══════════════════════════════════════════════════════════════════════════

  if (selecionados.length === 0 && text.length > 2) {
    if (/nao|nada|pula|so|sem/.test(lower)) {
      // Permite pular
      state._loopCount = 0;
      state._marmitaAtual.saladas = [];
      // Avança para upsell (sem salada)
    } else if (/sim|pode|quero|ok|claro/.test(lower)) {
      // Se disse sim/pode, repete o prompt da salada
      return { state, _skipHumanize: true, response: T.pedirSalada() };
    } else {
      // Incrementa contador de loops
      state._loopCount = (state._loopCount || 0) + 1;

      // Após 2 tentativas sem sucesso → pula
      if (state._loopCount >= 2) {
        state._loopCount = 0;
        state._marmitaAtual.saladas = [];
        // Continua abaixo para finalizar
      } else {
        return { state, _skipHumanize: true, response: 'Saladas: *Maionese, Beterraba, Alface, Repolho* ou *Pepino*?\n_(ou "pular" para continuar sem)_' };
      }
    }
  } else {
    // Reseta contador ao avançar com sucesso
    state._loopCount = 0;
    state._marmitaAtual.saladas.push(...selecionados.slice(0, 2));
  }

  finalizarMarmitaAtual(state);

  // ═══════════════════════════════════════════════════════════════════════════
  // MULTI-ITEM MODE: Avança para o próximo item pendente
  // ═══════════════════════════════════════════════════════════════════════════
  if (state._itensPendentes && state._itensPendentes.length > 0) {
    state._currentItemIndex = (state._currentItemIndex || 0) + 1;
    
    if (state._currentItemIndex < state._itensPendentes.length) {
      // Ainda tem itens pendentes — monta o próximo
      const proximoItem = state._itensPendentes[state._currentItemIndex];
      iniciarNovaMarmita(proximoItem.size, state);
      state.etapa = 'MONTANDO_PROTEINA';
      
      const numItem = state._currentItemIndex + 1;
      const totalItens = state._itensPendentes.length;
      
      return {
        state,
        _skipHumanize: true,
        response: `✅ Marmita ${numItem - 1} anotada!\n\nAgora vamos montar a *${numItem}ª* (${proximoItem.size}) 👇\n\nQual proteína?`
      };
    }
    
    // Todos os itens foram montados — limpa lista e vai para upsell
    state._itensPendentes = null;
    state._currentItemIndex = 0;
  }

  // Se ele pediu mais marmitas no inicio (modo antigo):
  if (state._currentMarmitaNumber < state._pendingMarmitas) {
    state._currentMarmitaNumber++;
    state.etapa = 'MONTANDO_TAMANHO'; // Pergunta o tamanho da próxima
    return { state, _skipHumanize: true, response: T.proximaMarmita() };
  }

  // Todas as marmitas prontas — vai para upsell
  const totalMarmitas = state.pedidoAtual.items.filter(i => i.tipo === 'marmita').length;
  
  state.etapa = 'OFERECENDO_UPSELL';
  state._upsellPhase = 'bebida';
  return {
    state,
    _skipHumanize: true,
    response: T.oferecerUpsellBebida(`✅ ${totalMarmitas} marmita(s) anotada(s)!`)
  };
}

function handleUpsell(text, state, cardapio, company) {
  const lower = ai.normalizar(text);

  // Detecta confusão/frustração: "de novo?", "já pedi", "hein?" — trata como "não quero"
  if (/de novo|ja pedi|hein|\bque\b|como assim/.test(lower) && !/suco|refri|pudim|mousse|refrigerante/.test(lower)) {
    state._upsellDone = true;
    return _avancarAposUpsell(state, company);
  }

  if (state._upsellPhase === 'bebida') {
    const bebidas = ai.interpretUpsell(text, cardapio.upsellsBebida);
    if (bebidas && bebidas.length > 0) {
      bebidas.forEach(bebida => {
        // Evita duplicata: atualiza quantity se item já existe
        const jaExiste = state.pedidoAtual.items.find(
          i => i.tipo === 'extra' && i.name === bebida.name
        );
        if (jaExiste) {
          jaExiste.quantity = (jaExiste.quantity || 0) + (bebida.quantity || 1);
        } else {
          state.pedidoAtual.items.push({
            tipo: 'extra',
            name: bebida.name,
            price: bebida.price,
            quantity: bebida.quantity || 1
          });
        }
      });
    }

    // Se há sobremesas no cardápio, oferece antes de ir para tipo
    // Exceto quando cliente rejeitou explicitamente ("não", "nao", "sem")
    // Só pula sobremesa se rejeição for explícita (não apenas "não" = sem bebida)
    // "não" simples → sem bebida, mas ainda deve oferecer sobremesa
    const rejeitouTudo = (!bebidas || bebidas.length === 0) &&
      /\b(nope|dispens|deixa\s+pra\s+l[aá]|sem\s+(mais\s+)?nada|n[aã]o\s+(obrigad[oa]?|quero|val[eu]|preciso|gostaria|aceito|aceitar|interessa|desejo|fa[çc]o\s+quest[aã]o))\b/.test(lower);
    const temSobremesas = cardapio.upsellsSobremesa && cardapio.upsellsSobremesa.length > 0;
    if (temSobremesas && !state._upsellDone && !rejeitouTudo) {
      state._upsellPhase = 'sobremesa';
      const marmitaResumo = bebidas && bebidas.length > 0
        ? `${bebidas.map(b => `${b.quantity || 1}x ${b.name}`).join(', ')} anotado! 👍`
        : 'Sem bebida! 👍';
      return { state, _skipHumanize: true, response: T.oferecerUpsellSobremesa(marmitaResumo) };
    }

    state._upsellDone = true;
    return _avancarAposUpsell(state, company);
  }

  if (state._upsellPhase === 'sobremesa') {
    const sobremesas = ai.interpretUpsell(text, cardapio.upsellsSobremesa || []);
    if (sobremesas && sobremesas.length > 0) {
      sobremesas.forEach(s => {
        state.pedidoAtual.items.push({
          tipo: 'extra',
          name: s.name,
          price: s.price,
          quantity: s.quantity || 1
        });
      });
    }

    state._upsellDone = true;
    return _avancarAposUpsell(state, company);
  }

  // Segurança fallback
  state._upsellDone = true;
  return _avancarAposUpsell(state, company);
}

/**
 * Após upsell, verifica se tipo/pagamento já foram capturados (via fast track)
 * e pula etapas que já estão preenchidas.
 */
function _avancarAposUpsell(state, company) {
  const temTipo = !!state.pedidoAtual.type;
  const temPagamento = !!state.pedidoAtual.paymentMethod;
  const temEndereco = state.pedidoAtual.type === 'pickup' || !!state.pedidoAtual.address;

  // Tudo preenchido → confirmação
  if (temTipo && temEndereco && temPagamento) {
    state.etapa = 'CONFIRMANDO';
    return buildConfirmation(state, company);
  }

  // Tipo preenchido mas falta endereço (delivery)
  if (temTipo && !temEndereco) {
    state.etapa = 'AGUARDANDO_ENDERECO';
    return { state, _skipHumanize: true, response: T.pedirEndereco() };
  }

  // Tipo preenchido, endereço ok, falta pagamento
  if (temTipo && temEndereco && !temPagamento) {
    state.etapa = 'AGUARDANDO_PAGAMENTO';
    return { state, response: sugerirPagamento(state) };
  }

  // Nada preenchido → pergunta tipo normalmente
  state.etapa = 'AGUARDANDO_TIPO';
  return { state, _skipHumanize: true, response: T.perguntarTipo(state.pedidoAtual.items) };
}

function handleTipo(text, state, company) {
  const tipo = ai.interpretOrderType(text);
  if (!tipo) return { state, response: T.tipoNaoIdentificado() };

  state.pedidoAtual.type = tipo;

  if (tipo === 'pickup') {
    state.pedidoAtual.deliveryFee = 0;
    state.etapa = 'AGUARDANDO_PAGAMENTO';
    return { state, response: sugerirPagamento(state) };
  }

  state.pedidoAtual.deliveryFee = Number(company.delivery_fee || 5);
  state._confirmingAddress = false;
  state.etapa = 'AGUARDANDO_ENDERECO';

  // Sugestão de endereço salvo
  const prefs = state._preferences || {};
  const addrs = prefs.saved_addresses || [];
  if (addrs.length > 0) {
    state._awaitingAddressChoice = true;
    return { state, response: T.enderecosSalvos(addrs) };
  }

  return { state, response: T.pedirEndereco() };
}

/**
 * Fix 8: Feedback granular para endereço incompleto.
 * Em vez de pedir tudo de novo, identifica o que falta.
 */
function _enderecoGranularFeedback(text) {
  const lower = (text || '').toLowerCase();
  const temNumero = /\d+/.test(text);
  const temBairro = /\b(bairro|centro|jardim|vila|parque|cohab|residencial|cidade|nova|santo|santa|sao|são)\b/i.test(text);
  const curtoDemais = text.trim().length < 5;

  if (curtoDemais) {
    return 'Preciso do endereço completo para a entrega. 😊\n_(Rua, número, bairro — ex: Rua das Flores, 123, Centro)_';
  }

  if (!temNumero && !temBairro) {
    return 'Quase! Faltou o *número* e o *bairro*. Pode completar? 📍\n_(Ex: 123, Centro)_';
  }

  if (!temNumero) {
    return 'Quase! Faltou o *número*. Qual é? 📍';
  }

  if (!temBairro) {
    return 'Quase! Qual o *bairro*? 📍';
  }

  // Fallback genérico (se o validator rejeitou por outro motivo)
  return 'Pode repetir o endereço completo? Preciso de rua, número e bairro. 📍';
}

async function handleEndereco(text, companyId, phone, state, company) {
  // Seleção de endereço salvo
  if (state._awaitingAddressChoice) {
    state._awaitingAddressChoice = false;
    const prefs = state._preferences || {};
    const addrs = prefs.saved_addresses || [];
    const num = parseInt(text.trim());
    if (num >= 1 && num <= addrs.length) {
      state.pedidoAtual.address = addrs[num - 1].address;
      state.etapa = 'AGUARDANDO_PAGAMENTO';
      return { state, response: [
        T.confirmarEnderecoSelecionado(addrs[num - 1].address, company.delivery_fee || 5),
        sugerirPagamento(state)
      ]};
    }
    // Não é número válido — trata como novo endereço
  }

  if (!state._confirmingAddress) {
    const valid = validator.validateEndereco(text);
    if (!valid.valid) {
      // Fix 8: Granular address feedback
      return { state, response: _enderecoGranularFeedback(text) };
    }
    state.pedidoAtual.address = valid.value;
    state.etapa = 'AGUARDANDO_PAGAMENTO';
    return { 
      state, 
      response: [
        T.resumoEnderecoTaxa(valid.value, company.delivery_fee || 5),
        sugerirPagamento(state)
      ]
    };
  }

  // Fallback caso entre aqui por algum engano
  state.etapa = 'AGUARDANDO_PAGAMENTO';
  return { state, response: sugerirPagamento(state) };
}

function handlePagamento(text, state, company) {
  const lower = ai.normalizar(text);
  const prefs = state._preferences || {};

  // Se ainda não temos o método, tenta identificar
  if (!state.pedidoAtual.paymentMethod) {
    // Aceita confirmação do pagamento favorito sugerido
    if (prefs.favorite_payment && /^(sim|pode|isso|claro|beleza|ok|s|exato)$/.test(lower.trim())) {
      state.pedidoAtual.paymentMethod = prefs.favorite_payment;
    } else if (lower.includes('pix')) state.pedidoAtual.paymentMethod = 'Pix';
    else if (/cartao|credito|debito/.test(lower)) state.pedidoAtual.paymentMethod = 'Cartão';
    else if (/dinheiro|especie/.test(lower)) state.pedidoAtual.paymentMethod = 'Dinheiro';
    else return { state, response: T.pagamentoNaoEntendido() };
  }

  // Verifica se precisa pedir troco no dinheiro
  if (state.pedidoAtual.paymentMethod === 'Dinheiro') {
    if (!state._askedTroco) {
      // Tenta capturar troco junto com "dinheiro troco pra 50"
      const trocoMatch = lower.match(/(?:troco\s+(?:pra|para|de)\s+)(\d+)/);
      if (trocoMatch) {
        state.pedidoAtual.trocoPara = parseInt(trocoMatch[1]);
      } else {
        state._askedTroco = true;
        const totalAtual = T.calcTotal(state.pedidoAtual.items, state.pedidoAtual.deliveryFee || 0);
        return { state, response: T.pagamentoComTroco(totalAtual) };
      }
    } else {
      // Segunda passagem — cliente respondeu a pergunta do troco
      const trocoNum = lower.match(/\b(\d+)\b/);
      const semTroco = /nao precisa|sem troco|exato|valor exato|^nao$|^n$/.test(lower);

      if (trocoNum) {
        state.pedidoAtual.trocoPara = parseInt(trocoNum[1]);
      } else if (semTroco) {
        state.pedidoAtual.trocoPara = 0; // sem troco
      } else {
        // Contador de tentativas — escape automático após 2 tentativas
        state._trocoTentativas = (state._trocoTentativas || 0) + 1;
        if (state._trocoTentativas >= 2) {
          state.pedidoAtual.trocoPara = 0;
          state._trocoTentativas = 0;
          state.etapa = 'CONFIRMANDO';
          const conf = buildConfirmation(state, company);
          conf.response.unshift('Anotei sem troco. Confira o resumo e me diga se está certo:');
          return conf;
        }
        const totalAtual = T.calcTotal(state.pedidoAtual.items, state.pedidoAtual.deliveryFee || 0);
        return {
          state,
          response: T.pagamentoComTroco(totalAtual)
        };
      }
    }
  }

  // Só avança se troco está resolvido (tem valor ou é 0)
  if (state.pedidoAtual.paymentMethod === 'Dinheiro' && state.pedidoAtual.trocoPara === null) {
    state._askedTroco = true;
    const totalAtual = T.calcTotal(state.pedidoAtual.items, state.pedidoAtual.deliveryFee || 0);
    return { state, response: T.pagamentoComTroco(totalAtual) };
  }

  state.etapa = 'CONFIRMANDO';
  return buildConfirmation(state, company);
}

// ─── FINALIZAÇÃO E BANCO ───────────────────────────────────────────────

async function handleConfirmacao(text, companyId, phone, state, company, cardapio) {
  const confirmacao = await ai.interpretConfirmation(text);
  const lowerConf = ai.normalizar(text);

  // Se estava confirmando cancelamento
  if (state._confirmandoCancelamento) {
    state._confirmandoCancelamento = false;
    // "sim", "pode", "cancela" (isolado) → confirma cancelamento
    const confirmaCancel = confirmacao === 'sim' ||
      /^(cancela|cancelar|pode cancelar|sim\s+cancela)$/.test(lowerConf.trim());
    if (confirmaCancel) {
      // Salva backup antes de cancelar (permite retomar com "continuar")
      state._pedidoBackup = JSON.parse(JSON.stringify(state.pedidoAtual));
      resetPedido(state);
      return { state, response: T.pedidoCancelado() };
    } else {
      // Não confirmou cancelamento — tenta processar como modificação se for 'indefinido'
      // Ex: "não, é pra retirar o refrigerante" contém intenção de modificação
      if (confirmacao === 'indefinido') {
        // Cai no fluxo normal de modificação abaixo (não retorna aqui)
      } else {
        return buildConfirmation(state, company);
      }
    }
  }

  // Confirmação do pedido
  if (confirmacao === 'sim') {
    const total = orderEngine.calculateTotal(state.pedidoAtual);

    // Só mock do ID se não houver DB
    const orderId = 'M' + Math.floor(Math.random() * 9999);

    state.etapa = 'FINALIZADO';

    // Grava no banco a marmita para a Skill de Memória
    await db.saveLastOrder(companyId, phone, state.pedidoAtual.items);

    // Atualiza preferências do cliente
    await db.saveCustomerPreferences(companyId, phone, {
      items: state.pedidoAtual.items,
      paymentMethod: state.pedidoAtual.paymentMethod,
      address: state.pedidoAtual.address
    });

    if (state.pedidoAtual.paymentMethod === 'Pix') {
      return {
        state,
        _skipHumanize: true,
        response: T.pedidoConfirmadoPix(total, company.pix_key || 'CLIQUE_PARA_COPIAR_CHAVE_PIX')
      };
    }

    return {
      state,
      _skipHumanize: true,
      response: [T.pedidoConfirmado(state._customerName || 'Cliente', orderId, company.estimated_time_default || 30, state.pedidoAtual.type)]
    };
  }

  if (confirmacao === 'nao') {
    // Cliente disse "não" ao resumo — provavelmente quer mudar algo, não cancelar
    const resumo = buildConfirmation(state, company);
    resumo.response.unshift(
      'Tudo bem! O que você gostaria de mudar? Pode me dizer, por exemplo:\n• "troca frango por costela"\n• "quero entrega em vez de retirada"\n• "remove o suco"'
    );
    return resumo;
  }

  // Qualquer outra resposta (indefinido) → trata como possível modificação

  // --- DETECÇÃO DE RECLAMAÇÃO SOBRE QUANTIDADE ---
  // "as quantidades estão erradas", "não veio o suco", "faltou bebida"
  const lowerConfirm = ai.normalizar(text);
  const reclamacaoQuantidade = /quantidade.*(errad|incorret|faltou|faltando)|(errad|incorret).*(quantidade|qtd|qtde)|(falt|nao.*veio|não.*veio).*(suco|refri|bebida|coca|lata)|bebida.*(errad|falt)|quantidade.*(bebida)|faltou|faltando/.test(lowerConfirm);
  
  if (reclamacaoQuantidade) {
    // Mostra resumo atual e pede correção específica
    const resumo = buildConfirmation(state, company);
    resumo.response = [
      'Vi que há algo errado com as quantidades. Me diz exatamente o que corrigir, por exemplo:\n• "quero 5 sucos e 3 refris"\n• "remove o suco"',
      ...resumo.response
    ];
    return resumo;
  }

  // --- SKILL DE MODIFICAÇÃO FINAL ---
  // Se for indefinido, verificamos se ele quer MUDAR algo (ex: troca frango por carne)
  // Snapshot obrigatório ANTES de chamar IA
  const itemsBackup = JSON.parse(JSON.stringify(state.pedidoAtual.items));
  const deliveryBackup = state.pedidoAtual.deliveryFee;
  const typeBackup = state.pedidoAtual.type;
  const addressBackup = state.pedidoAtual.address;

  const itensModificados = await ai.interpretarModificacaoPedido(text, state.pedidoAtual.items, cardapio);

  // Validação estrita antes de aplicar
  const valido = itensModificados &&
    Array.isArray(itensModificados) &&
    itensModificados.length > 0 &&
    itensModificados.every(i => i.price > 0 && (i.name || i.tipo));

  if (valido) {
    // Valida contra o cardápio real antes de aceitar
    const itensValidados = actionProcessor.processModification(itensModificados, cardapio);
    if (itensValidados && itensValidados.length > 0 && itensValidados.every(i => i.price > 0)) {
      logger.debug('skill.modification.activated', { phone });
      state.pedidoAtual.items = itensValidados;

      // Mostra o resumo atualizado
      const resumo = buildConfirmation(state, company);
      resumo.response.unshift(T.modificacaoAceita());
      return resumo;
    }
  }

  // Restaurar estado original — IA não produziu resultado válido
  state.pedidoAtual.items = itemsBackup;
  state.pedidoAtual.deliveryFee = deliveryBackup;
  state.pedidoAtual.type = typeBackup;
  state.pedidoAtual.address = addressBackup;

  // Detecta pedido de adicionar nova marmita → volta ao fluxo de montagem
  const lowerText = ai.normalizar(text);
  if (/adicionar?\s+(mais\s+)?uma\s+marmita|mais\s+uma\s+marmita|outra\s+marmita/.test(lowerText)) {
    const tamanhoSolicitado = ai.interpretTamanho(text);
    if (tamanhoSolicitado) {
      iniciarNovaMarmita(tamanhoSolicitado, state);
      state.etapa = 'MONTANDO_PROTEINA';
      return { state, response: T.pedirProteina() };
    }
    state.etapa = 'MONTANDO_TAMANHO';
    return { state, response: 'Claro! Qual o tamanho da nova marmita? *Pequena* ou *Grande*?' };
  }

  // Detecta mudança de tamanho da marmita: "pode ser pequena", "faz uma grande", etc.
  const tamanhoNovo = ai.interpretTamanho(text);
  if (tamanhoNovo && /\b(pequena|grande)\b/.test(lowerText)) {
    const marmitas = state.pedidoAtual.items.filter(i => i.tipo === 'marmita');
    if (marmitas.length > 0) {
      const precoNovo = tamanhoNovo === 'Grande' ? 22 : 20;
      for (const m of marmitas) {
        m.tamanho = tamanhoNovo;
        m.price = precoNovo;
      }
      const resumo = buildConfirmation(state, company);
      resumo.response.unshift(T.modificacaoAceita());
      return resumo;
    }
  }

  // Se for indefinido ou qualquer outra coisa (reclamação do resumo, dúvida),
  // apenas re-enviamos o resumo completo com os novos preços.
  const resumoFallback = buildConfirmation(state, company);
  // Se o texto for longo e não confirmou nem negou, passa nota interna como metadado (nunca no response)
  if (text.length > 5 && confirmacao === 'indefinido') {
    resumoFallback._internalNote = 'O cliente fez um comentário ou pergunta sobre o pedido. Não é confirmação nem cancelamento. Re-exiba o resumo e pergunte se deseja confirmar ou fazer alguma alteração. NÃO pergunte se quer cancelar.';
  }
  return resumoFallback;
}

// ─── HANDLER PÓS-PEDIDO (FINALIZADO) ──────────────────────────────────────

/**
 * Processa interações após o pedido ser confirmado.
 * - Perguntas sobre tempo de entrega/retirada
 * - Pedidos de alteração (cancela e refaz)
 * - Novo pedido
 */
async function handlePosPedido(text, companyId, phone, state, company, cardapio) {
  const lower = ai.normalizar(text);
  const tempoEstimado = company.estimated_time_default || 30;
  const tipoAtual = state.pedidoAtual?.type;

  // ═══════════════════════════════════════════════════════════════════════
  // 1. CONFIRMAÇÃO DE ALTERAÇÃO (se estava aguardando)
  // ═══════════════════════════════════════════════════════════════════════
  if (state._confirmandoAlteracao) {
    const confirmacao = await ai.interpretConfirmation(text);
    state._confirmandoAlteracao = false;

    if (confirmacao === 'sim') {
      // Cancela pedido atual e inicia novo com itens salvos
      const itensAnteriores = state._itensParaRefazer || state.pedidoAtual.items;

      // Reset completo para novo pedido (inclui flags de upsell e grupos)
      state.etapa = 'MONTANDO_TAMANHO';
      state.pedidoAtual = { items: [], type: null, address: null, paymentMethod: null, deliveryFee: 0, trocoPara: null };
      state._marmitaAtual = null;
      state._upsellDone = false;
      state._upsellPhase = null;
      state._grupos = null;
      state._currentGrupoIndex = 0;
      state._pendingMarmitas = 1;
      state._currentMarmitaNumber = 1;
      state._itensParaRefazer = itensAnteriores; // Guarda para referência se necessário

      logger.debug('pos_pedido.alteracao_confirmada', { phone, itensAnteriores: itensAnteriores.length });

      return { state, response: T.pedidoCanceladoParaRefazer() };
    } else {
      // Não quis alterar, mantém pedido
      return { 
        state, 
        response: `Ok, mantive seu pedido! ${tipoAtual === 'delivery' ? `Tempo estimado: *${tempoEstimado} minutos* 🛵` : `Em breve estará pronto para retirada! 😊`}` 
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1.1 CONFIRMAÇÃO DE CANCELAMENTO PÓS-PEDIDO
  // ═══════════════════════════════════════════════════════════════════════
  if (state._confirmandoCancelamentoPos) {
    const confirmacao = await ai.interpretConfirmation(text);
    state._confirmandoCancelamentoPos = false;

    if (confirmacao === 'sim') {
      resetPedido(state);
      return { state, response: 'Pedido cancelado. Quando quiser pedir novamente, é só me chamar! 😊' };
    } else {
      return { 
        state, 
        response: `Ok, mantive seu pedido! ${tipoAtual === 'delivery' ? `Tempo estimado: *${tempoEstimado} minutos* 🛵` : `Em breve estará pronto! 😊`}` 
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. PERGUNTA SOBRE TEMPO DE ENTREGA/RETIRADA
  // ═══════════════════════════════════════════════════════════════════════
  if (/quanto tempo|tempo.*entrega|demora|falta quanto|ta pronto|ja pronto|posso buscar|posso retirar|ja pode|esta pronto/.test(lower)) {
    if (tipoAtual === 'pickup') {
      return { state, response: T.tempoRetiradaPickup(tempoEstimado) };
    } else {
      return { state, response: T.tempoEntregaDelivery(tempoEstimado) };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. CANCELAR PEDIDO (verificar ANTES de alteração)
  // ═══════════════════════════════════════════════════════════════════════
  if (/^cancela$|cancelar.*pedido|desist|nao quero mais/.test(lower)) {
    state._confirmandoCancelamentoPos = true;
    return { 
      state, 
      response: 'Quer mesmo cancelar seu pedido? Se confirmar, vou precisar iniciar um novo atendimento.\n\n*Cancelar pedido?* (sim/não)' 
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. NOVO PEDIDO (verificar ANTES de alteração para evitar conflito)
  // ═══════════════════════════════════════════════════════════════════════
  if (/outro pedido|novo pedido|pedir mais|quero pedir|mais marmita|fazer outro/.test(lower)) {
    // Reset completo para novo pedido (inclui flags de upsell e grupos)
    state.etapa = 'MONTANDO_TAMANHO';
    state.pedidoAtual = { items: [], type: null, address: null, paymentMethod: null, deliveryFee: 0, trocoPara: null };
    state._marmitaAtual = null;
    state._reminderSent = false;
    state._upsellDone = false;
    state._upsellPhase = null;
    state._grupos = null;
    state._currentGrupoIndex = 0;
    state._pendingMarmitas = 1;
    state._currentMarmitaNumber = 1;

    return { state, response: 'Claro! Vamos montar seu novo pedido 😊\n\nQual o tamanho da marmita? *Pequena* ou *Grande*?' };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. TROCAR ITEM / ALTERAR PEDIDO
  // ═══════════════════════════════════════════════════════════════════════
  if (/troc|alter|mud|tira|remove|adiciona|coloca|errad/.test(lower) && 
      /marmita|proteina|acompanhamento|salada|item|pedido|bebida|suco|refri/.test(lower)) {
    state._confirmandoAlteracao = true;
    return { state, response: T.confirmarAlteracaoPosPedido() };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. STATUS DO PEDIDO (genérico)
  // ═══════════════════════════════════════════════════════════════════════
  if (/status|como ta|meu pedido|acompanhar/.test(lower)) {
    const statusMsg = tipoAtual === 'delivery' 
      ? `Seu pedido está em preparação! 🍳\n\n*Tempo estimado de entrega:* ${tempoEstimado} minutos\n*Endereço:* ${state.pedidoAtual.address}\n*Pagamento:* ${state.pedidoAtual.paymentMethod}`
      : `Seu pedido está em preparação! 🍳\n\n*Tempo estimado:* ${tempoEstimado} minutos\n*Tipo:* Retirada no local\n*Pagamento:* ${state.pedidoAtual.paymentMethod}`;
    
    return { state, response: statusMsg };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. RESPOSTA PADRÃO PÓS-PEDIDO
  // ═══════════════════════════════════════════════════════════════════════
  return { state, response: T.respostaPosPedido() };
}

// ─── HELPERS AUXILIARES ────────────────────────────────────────────────

function iniciarNovaMarmita(tamanho, state) {
  const preco = tamanho === 'Grande' ? 22 : 20;
  state._marmitaAtual = {
    tipo: 'marmita',
    tamanho: tamanho,
    price: preco,
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

/**
 * Valida itens de last_order contra cardápio ativo.
 * Remove itens que não existem mais no catálogo.
 */
function validarLastOrder(lastOrder, cardapio) {
  if (!lastOrder || !Array.isArray(lastOrder)) return [];

  return lastOrder.filter(item => {
    // Normaliza nome para compatibilidade com dados antigos (produto/product → name)
    if (!item.name && (item.produto || item.product)) {
      item.name = item.produto || item.product;
    }
    if (item.tipo === 'marmita') {
      // Verifica se pelo menos uma proteína ainda existe
      if (item.proteinas && item.proteinas.length > 0) {
        const temProteinaValida = item.proteinas.some(p =>
          actionProcessor.matchItemCatalog(p.name || p.produto || p.product, cardapio.proteinas)
        );
        return temProteinaValida;
      }
      return true; // Marmita sem proteínas (possível pular)
    }
    if (item.tipo === 'extra') {
      const allExtras = [
        ...cardapio.upsellsBebida,
        ...(cardapio.upsellsSobremesa || [])
      ];
      return actionProcessor.matchItemCatalog(item.name, allExtras) !== null;
    }
    return true;
  });
}

/**
 * Detecta tipo (delivery/pickup), pagamento e bebidas em qualquer mensagem.
 * Aplica ao state sem interferir no handler da etapa atual.
 */
function extractExtraInfo(text, state, cardapio) {
  const captured = [];
  
  // Tipo (delivery/pickup) — só se ainda não definido e não for pergunta sobre tempo
  const isPerguntaTempo = /quanto.*(tempo|demor|minuto)|demora.*(entrega|delivery)|prazo|horario/i.test(text);
  if (!state.pedidoAtual.type && !isPerguntaTempo) {
    const tipo = ai.interpretOrderType(text);
    if (tipo) {
      state.pedidoAtual.type = tipo;
      if (tipo === 'pickup') {
        state.pedidoAtual.deliveryFee = 0;
      }
      captured.push({ field: 'tipo', value: tipo });
    }
  }
  
  // Pagamento — só se ainda não definido
  if (!state.pedidoAtual.paymentMethod) {
    const lower = ai.normalizar(text);
    let pagamento = null;
    if (/\b(pix)\b/.test(lower)) pagamento = 'Pix';
    else if (/\b(cartao|cartão|credito|crédito|debito|débito)\b/.test(lower)) pagamento = 'Cartão';
    else if (/\b(dinheiro|especie|espécie)\b/.test(lower)) pagamento = 'Dinheiro';
    
    if (pagamento) {
      state.pedidoAtual.paymentMethod = pagamento;
      captured.push({ field: 'pagamento', value: pagamento });
    }
  }
  
  // Bebidas — só se não já passou pelo upsell e tem menção de bebida
  if (!state._upsellDone) {
    const lower = ai.normalizar(text);
    const temBebida = /\b(coca|refri|refrigerante|suco|agua|água)\b/.test(lower);
    if (temBebida) {
      const allBebidas = cardapio.upsellsBebida || [];
      const bebidas = ai.interpretUpsell(text, allBebidas);
      if (bebidas && bebidas.length > 0) {
        bebidas.forEach(b => {
          // Evita duplicatas
          const jaExiste = state.pedidoAtual.items.find(i => i.tipo === 'extra' && i.name === b.name);
          if (!jaExiste) {
            state.pedidoAtual.items.push({
              tipo: 'extra',
              name: b.name,
              price: b.price,
              quantity: b.quantity || 1
            });
            captured.push({ field: 'bebida', value: b.name, qty: b.quantity || 1 });
          }
        });
        state._upsellDone = true;
      }
    }
  }
  
  return { captured };
}

/**
 * Mini-resumo de extras/tipo/pagamento já capturados (para feedback no skip)
 */
function _resumoPreCapturado(state) {
  const partes = [];
  const extras = state.pedidoAtual.items.filter(i => i.tipo === 'extra');
  if (extras.length > 0) {
    extras.forEach(e => partes.push(`🥤 ${e.quantity || 1}x ${e.name}`));
  }
  if (state.pedidoAtual.type) {
    partes.push(state.pedidoAtual.type === 'pickup' ? '📍 Retirada' : '🛵 Entrega');
  }
  if (state.pedidoAtual.paymentMethod) {
    partes.push(`💳 ${state.pedidoAtual.paymentMethod}`);
  }
  return partes.length > 0 ? '\n' + partes.join(' | ') : '';
}

/**
 * Resumo parcial dos grupos — mostra campo já preenchido (ex: proteínas já escolhidas)
 */
function _resumoGruposParcial(grupos, campo) {
  const partes = [];
  for (const g of grupos) {
    if (g[campo] && g[campo].length > 0) {
      const vals = Array.isArray(g[campo]) ? g[campo].join(' + ') : g[campo];
      partes.push(`${g.tamanho}: ${vals}`);
    }
  }
  return partes.length > 0 ? '\n🥩 ' + partes.join(', ') : '';
}

/**
 * Gera mini-resumo visual do que foi capturado até agora.
 * Usado ao pular etapas para dar feedback ao cliente.
 */
function _gerarResumoCapturado(state) {
  const items = state.pedidoAtual.items;
  if (!items || items.length === 0) return null;
  
  const partes = [];
  const marmitas = items.filter(i => i.tipo === 'marmita');
  const extras = items.filter(i => i.tipo === 'extra');
  
  for (const m of marmitas) {
    const prots = m.proteinas?.map(p => p.name).join(' + ') || '';
    const acomps = m.acompanhamentos?.map(a => a.name).join(' + ') || '';
    const sals = m.saladas?.map(s => s.name).join(' + ') || '';
    
    let desc = `🍱 *Marmita ${m.tamanho}*`;
    if (prots) desc += ` — ${prots}`;
    if (acomps) desc += ` | ${acomps}`;
    if (sals) desc += ` | ${sals}`;
    partes.push(desc);
  }
  
  for (const e of extras) {
    const qty = e.quantity || 1;
    partes.push(`🥤 ${qty}x ${e.name}`);
  }
  
  if (state.pedidoAtual.type) {
    partes.push(state.pedidoAtual.type === 'pickup' ? '📍 Retirada' : '🛵 Entrega');
  }
  if (state.pedidoAtual.paymentMethod) {
    partes.push(`💳 ${state.pedidoAtual.paymentMethod}`);
  }
  
  if (partes.length === 0) return null;
  return `Certo! 😊 Anotei:\n${partes.join('\n')}`;
}

/**
 * Decide qual etapa ir baseado no que FALTA no pedido.
 * Usado pelo fast track para pular etapas já respondidas.
 */
function resolverProximaEtapa(state, ft, company) {
  const grupos = state._grupos;
  const items = state.pedidoAtual.items;

  // ═══════════════════════════════════════════════════════════════════════════
  // Modo GRUPOS: verifica se grupos estão completos
  // ═══════════════════════════════════════════════════════════════════════════
  if (grupos && grupos.length > 0) {
    // Verifica proteínas em todos os grupos
    const temProteinasGrupos = grupos.every(g => g.proteinas && g.proteinas.length > 0);
    if (!temProteinasGrupos) {
      const grupoSemProt = grupos.findIndex(g => !g.proteinas || g.proteinas.length === 0);
      state._currentGrupoIndex = grupoSemProt >= 0 ? grupoSemProt : 0;
      const grupoAtual = grupos[state._currentGrupoIndex];
      const totalMarmitas = grupos.reduce((sum, g) => sum + g.qty, 0);
      
      let anotadasText = `✅ ${totalMarmitas} marmita(s) anotada(s)!`;
      if (grupos.length === 1 && totalMarmitas === 1) {
        anotadasText = `✅ 1 marmita ${grupos[0].tamanho.toLowerCase()} anotada!`;
      }
      
      // Resumo do que já captou (extras, tipo, pagamento)
      const preCapturado = _resumoPreCapturado(state);
      return {
        etapa: 'MONTANDO_PROTEINA',
        response: `${anotadasText}${preCapturado}\n\nPara ${_labelGrupo(grupoAtual)}, qual proteína?\n🍗 Frango | 🥩 Churrasco | 🍖 Costela | 🌭 Linguiça | 🥩 Carne Cozida`
      };
    }

    // Verifica acompanhamentos+saladas juntos (etapa combinada)
    // Se acomp está preenchido mas salada é null, assume salada vazia
    for (const g of grupos) {
      if (g.acompanhamentos && g.acompanhamentos.length >= 0 && g.saladas === null) {
        g.saladas = [];
      }
    }
    const temAcompGrupos = grupos.every(g => g.acompanhamentos !== null);
    if (!temAcompGrupos) {
      const grupoSemAcomp = grupos.findIndex(g => g.acompanhamentos === null);
      state._currentGrupoIndex = grupoSemAcomp >= 0 ? grupoSemAcomp : 0;
      const grupoAtual = grupos[state._currentGrupoIndex];
      // Mostra proteínas que já vieram
      const protCapturadas = _resumoGruposParcial(grupos, 'proteinas');
      return {
        etapa: 'MONTANDO_ACOMPANHAMENTO',
        response: `✅ Proteínas anotadas!${protCapturadas}\n\nPara ${_labelGrupo(grupoAtual)}:\n${T.pedirAcompanhamentoESalada()}`
      };
    }

    // Grupos completos — expandir para itens
    for (const grupo of grupos) {
      const tamanho = grupo.tamanho;
      const preco = tamanho === 'Grande' ? 22 : 20; // Só Pequena (20) ou Grande (22)
      
      for (let i = 0; i < grupo.qty; i++) {
        state.pedidoAtual.items.push({
          tipo: 'marmita',
          tamanho: tamanho,
          price: preco,
          quantity: 1,
          proteinas: (grupo.proteinas || []).map(name => ({ name })),
          acompanhamentos: (grupo.acompanhamentos || []).map(name => ({ name })),
          saladas: (grupo.saladas || []).map(name => ({ name }))
        });
      }
    }
    state._grupos = null;
    state._currentGrupoIndex = 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Verificações restantes (tipo, endereço, pagamento)
  // ═══════════════════════════════════════════════════════════════════════════
  const totalMarmitas = state.pedidoAtual.items.filter(i => i.tipo === 'marmita').length;
  const temTipo = !!state.pedidoAtual.type;
  const temEndereco = state.pedidoAtual.type === 'pickup' || !!state.pedidoAtual.address;
  const temPagamento = !!state.pedidoAtual.paymentMethod;

  // Gera mini-resumo do que foi capturado para feedback visual ao pular etapas
  const resumoCapturado = _gerarResumoCapturado(state);

  // Upsell (bebida)
  if (!state._upsellDone) {
    state._upsellPhase = 'bebida';
    const prefix = resumoCapturado || `✅ ${totalMarmitas} marmita(s) completa(s)!`;
    return {
      etapa: 'OFERECENDO_UPSELL',
      response: T.oferecerUpsellBebida(prefix)
    };
  }

  if (!temTipo) {
    if (resumoCapturado) {
      return {
        etapa: 'AGUARDANDO_TIPO',
        response: [
          resumoCapturado,
          'Vai ser *Entrega* ou *Retirada* no balcão?'
        ]
      };
    }
    return {
      etapa: 'AGUARDANDO_TIPO',
      response: T.perguntarTipo(state.pedidoAtual.items)
    };
  }

  if (!temEndereco) {
    const prefix = resumoCapturado ? resumoCapturado + '\n\n' : '';
    return {
      etapa: 'AGUARDANDO_ENDERECO',
      response: prefix + T.pedirEndereco()
    };
  }

  if (!temPagamento) {
    const prefix = resumoCapturado ? resumoCapturado + '\n\n' : '';
    return {
      etapa: 'AGUARDANDO_PAGAMENTO',
      response: prefix + sugerirPagamento(state)
    };
  }

  // Tudo preenchido — confirmação final
  return {
    etapa: 'CONFIRMANDO',
    response: null // buildConfirmation será chamado pelo caller
  };
}

function resetPedido(state) {
  state.etapa = 'INICIO';
  state.pedidoAtual = {
    items: [],
    type: null,
    address: null,
    paymentMethod: null,
    deliveryFee: 0,
    trocoPara: null
  };
  state._marmitaAtual = null;
  state._pendingMarmitas = 1;
  state._currentMarmitaNumber = 1;
  state._upsellPhase = null;
  state._confirmingAddress = false;
  state._askedTroco = false;
  state._awaitingPrefsConfirmation = false;
  state._lastOrderForRepeat = undefined;
  state._awaitingAddressChoice = false;
  // Multi-item mode
  state._itensPendentes = null;
  state._currentItemIndex = 0;
  // Grupos mode
  state._grupos = null;
  state._currentGrupoIndex = 0;
  state._upsellDone = false;
}

function sugerirPagamento(state) {
  const prefs = state._preferences || {};
  if (prefs.favorite_payment) {
    return T.sugerirPagamentoFavorito(prefs.favorite_payment);
  }
  return T.pedirPagamento();
}

function buildConfirmation(state, company) {
  return {
    state,
    _skipHumanize: true,
    response: T.confirmacaoFinal({
      items: state.pedidoAtual.items,
      type: state.pedidoAtual.type,
      address: state.pedidoAtual.address,
      deliveryFee: state.pedidoAtual.type === 'pickup' ? 0 : state.pedidoAtual.deliveryFee,
      paymentMethod: state.pedidoAtual.paymentMethod,
      trocoPara: state.pedidoAtual.trocoPara,
      estimatedTime: company.estimated_time_default || 30
    })
  };
}

module.exports = { process, ESTADOS };
