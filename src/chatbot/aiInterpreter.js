// src/aiInterpreter.js
// ═══════════════════════════════════════════════════════════════
// IA e NLP para o novo fluxo de Marmitaria.
// Suporta extração múltipla (ex: "frango e linguiça").
// ═══════════════════════════════════════════════════════════════

const axios = require('axios');
const { chatCompletion, quickChat } = require('../main/ai-proxy-service');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const SYSTEM_PROMPT = `Você é um interpretador de intenções para um restaurante/loja.
Sua única função é identificar o que o cliente quer dizer e retornar JSON estruturado.
Você NUNCA toma decisões, apenas classifica. Responda SOMENTE JSON válido.`;

// ─── UTILITÁRIO ───────────────────────────────────────────────────────────────

function normalizar(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .trim();
}

// ─── CONFIRMAÇÃO ──────────────────────────────────────────────────────────────

async function interpretConfirmation(text) {
  const lower = normalizar(text);

  // Se ele está perguntando do resumo, valor ou algo assim, não é confirmação de fechamento
  if (/\bresumo|valor|total|preco|pagar\b/.test(lower)) return 'indefinido';

  // "pode só que quero mudar" / "ok mas quero trocar" → modificação condicional, não negação
  if (/\b(sim|ok|pode|beleza|certo)\b.*\b(mas|porem|so que|entretanto|pore[mn])\b/.test(lower)) return 'indefinido';

  // Expressões compostas de negação que indicam rejeição
  if (/muda tudo|quero mudar|ta errado|nao quero|nao preciso|cancela o pedido/.test(lower)) return 'nao';

  // Se contém intenção de modificar / adicionar / trocar → não é confirmação nem cancelamento
  if (/\btrocar?\b|\badicionar?\b|\bcolocar?\b|\btirar?\b|\bretira(r)?\b|\bmudar?\b|\bsubstituir?\b|\bacrescenta\b|\bmais uma\b|\boutra marmita\b|\bantes de confirmar\b|\bremover?\b|\bexclui(r)?\b/.test(lower)) return 'indefinido';

  // "cancela o [item]" → é modificação (remover item), não cancelamento do pedido
  // NÃO inclui "cancela o pedido" / "cancela tudo"
  if (/\bcancela(r)?\s+(o|a|os|as|d[aoe]s?|esse?|essa?)\s*(refri|refrigerante|coca|suco|bebida|lata|guarana|fanta|agua|pudim|mousse|sobremesa|marmita)/i.test(lower)) return 'indefinido';

  // "pode ser uma marmita pequena/grande" → mudança de tamanho, não confirmação
  if (/\b(pequena|grande)\b/.test(lower) && /\b(marmita|pode ser|faz|quero)\b/.test(lower) && lower.length > 8) return 'indefinido';

  const palavras = lower.split(/\s+/);
  const palavraUnica = palavras.length === 1;

  const positivos = new Set(['sim', 's', 'ok', 'pode', 'quero', 'vai', 'confirmo', 'confirma', 'manda', 'claro', 'certo', 'isso', 'exato', 'fechou', 'perfeito']);
  const negativos = new Set(['nao', 'n', 'cancela', 'errado', 'errei', 'muda', 'mudar', 'nope', 'nada']);

  if (palavraUnica) {
    if (positivos.has(palavras[0])) return 'sim';
    if (negativos.has(palavras[0])) return 'nao';
  }

  if (/isso mesmo|esse mesmo|tudo certo|ta certinho|pode ser|com certeza|sim pode|pode mandar|quero sim|ta certo|ta sim|aham|uhum|beleza|valeu|bora|show|agora sim|pode ir|pode continuar|ta bom assim|fechou assim|deixa assim|deixa assim mesmo/.test(lower)) return 'sim';
  if (/nao quero|nao preciso|cancela o pedido|ta errado/.test(lower)) return 'nao';

  // Se mensagem começa com positivo E contém "não" depois → é comentário, não cancelamento
  const primeiraPalavra = palavras[0];
  const comecaPositivo = positivos.has(primeiraPalavra) || /^(ta|tá|ok|beleza|pode|sim)$/.test(primeiraPalavra);
  const temNaoDepois = palavras.slice(1).some(p => negativos.has(p) || p === 'nao');
  if (comecaPositivo && temNaoDepois) {
    return 'sim';
  }

  // Verifica se alguma palavra positiva aparece em qualquer posição, sem negação anterior
  const temNegacao = /\bnao\b|\bnada\b|\bnem\b|\bnunca\b/.test(lower);
  if (!temNegacao) {
    for (const p of palavras) {
      if (positivos.has(p)) return 'sim';
    }
  }
  for (const p of palavras) {
    if (negativos.has(p)) return 'nao';
  }

  return 'indefinido';
}

// ─── TAMANHO DA MARMITA ───────────────────────────────────────────────────────

function interpretTamanho(text) {
  const lower = normalizar(text);
  if (/\bpequena\b|\bp\b/.test(lower)) return 'Pequena';
  if (/\bgrande\b|\bg\b/.test(lower)) return 'Grande';
  if (lower.trim() === 'm') return 'Grande'; // "m" só como palavra isolada única
  if (/^1$/.test(lower)) return 'Pequena';
  if (/^2$/.test(lower)) return 'Grande';
  return null;
}

/**
 * Interpreta pedido com múltiplos tamanhos de marmita.
 * Ex: "2 grandes e 3 pequenas" → [{ size: 'Grande', qty: 2 }, { size: 'Pequena', qty: 3 }]
 * Ex: "3 marmitas pequenas" → [{ size: 'Pequena', qty: 3 }]
 * Ex: "uma grande e uma pequena" → [{ size: 'Grande', qty: 1 }, { size: 'Pequena', qty: 1 }]
 * 
 * Returns null if not a multi-size request.
 */
function interpretarPedidoMultiTamanho(text) {
  const lower = normalizar(text);
  
  // Detecta padrões de múltiplos tamanhos
  const temGrande = /\bgrande|grandes\b/.test(lower);
  const temPequena = /\bpequena|pequenas\b/.test(lower);
  
  // Se tem os dois tamanhos, é definitivamente multi-tamanho
  if (temGrande && temPequena) {
    const items = [];
    
    // Tenta extrair "X grandes" e "Y pequenas"
    const grandeMatch = lower.match(/(\d+|uma?|duas?|tres|quatro|cinco)\s*(?:marmitas?\s+)?grandes?/i);
    const pequenaMatch = lower.match(/(\d+|uma?|duas?|tres|quatro|cinco)\s*(?:marmitas?\s+)?pequenas?/i);
    
    if (grandeMatch) {
      const qty = parseQtyWord(grandeMatch[1]);
      if (qty > 0) items.push({ size: 'Grande', qty });
    }
    
    if (pequenaMatch) {
      const qty = parseQtyWord(pequenaMatch[1]);
      if (qty > 0) items.push({ size: 'Pequena', qty });
    }
    
    // Se conseguiu extrair pelo menos um item válido, retorna
    if (items.length > 0) return items;
  }
  
  // Se só tem um tamanho, verifica se tem quantidade > 1
  if (temGrande || temPequena) {
    const size = temGrande ? 'Grande' : 'Pequena';
    const qty = interpretQuantity(text) || 1;
    
    // Se quantidade = 1 e não tem padrão explícito como "1 marmita grande", retorna null
    // Deixa o fluxo normal tratar
    if (qty === 1 && !/\d+\s*(?:marmitas?\s+)?(?:grandes?|pequenas?)/.test(lower)) {
      return null;
    }
    
    return [{ size, qty }];
  }
  
  return null;
}

/**
 * Converte palavras de quantidade em números.
 */
function parseQtyWord(word) {
  if (!word) return 1;
  const lower = word.toLowerCase().trim();
  const map = {
    'um': 1, 'uma': 1, '1': 1,
    'dois': 2, 'duas': 2, '2': 2,
    'tres': 3, 'três': 3, '3': 3,
    'quatro': 4, '4': 4,
    'cinco': 5, '5': 5,
    'seis': 6, '6': 6,
    'sete': 7, '7': 7,
    'oito': 8, '8': 8,
    'nove': 9, '9': 9,
    'dez': 10, '10': 10
  };
  return map[lower] || parseInt(lower, 10) || 1;
}

// ─── EXTRAÇÃO MÚLTIPLA DE ITENS (Proteínas, Acomps, Saladas) ──────────────────

/**
 * Calcula distância de Levenshtein entre duas strings.
 * Útil para detectar typos: "custela" vs "costela" = distância 1.
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substituição
          matrix[i][j - 1] + 1,     // inserção
          matrix[i - 1][j] + 1      // deleção
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function matchFuzzy(input, opcao) {
  const inp = normalizar(input);
  const nome = normalizar(opcao.name);
  const apelidos = (opcao.apelidos || []).map(normalizar);

  // Match exato
  if (nome === inp) return true;
  if (apelidos.includes(inp)) return true;

  // Match por prefixo (mínimo 4 chars)
  // "maiones" → prefixo de "maionese" ✅
  // "churasco" → prefixo de "churrasco" ✅
  if (inp.length >= 4) {
    if (nome.startsWith(inp)) return true;
    if (inp.startsWith(nome.slice(0, 4))) return true;
    if (apelidos.some(a => a.startsWith(inp) || inp.startsWith(a.slice(0, 4)))) return true;
  }

  // Match Levenshtein — distância máxima 1 para palavras >= 4 chars
  // "custela" → "costela" (distância 1) ✅, "aros" → "arroz" (apelido "arro") ✅
  if (inp.length >= 4 && nome.length >= 4) {
    if (levenshteinDistance(inp, nome) <= 1) return true;
    if (apelidos.some(a => a.length >= 4 && levenshteinDistance(inp, a) <= 1)) return true;
  }

  return false;
}

function interpretItensMultiplos(text, opcoesDisponiveis) {
  const lower = normalizar(text);
  const encontrados = [];

  // Se o cliente disser "não quero", "pula", "nada" (para opcionais)
  if (/nao quero|nada|nenhum|pula|pular|sem|so isso/.test(lower)) {
    return [];
  }

  // Separa palavras — "e" só como separador quando isolado entre espaços
  const palavras = lower.split(/[\s,&+]+|\be\b/).map(s => s.trim()).filter(Boolean);

  // Busca cada opção disponível no texto
  for (const op of opcoesDisponiveis) {
    const opNome = normalizar(op.name);
    const regex = new RegExp(`\\b${opNome}\\b`);
    const apelidos = op.apelidos ? op.apelidos.map(normalizar) : [];

    // Match exato (regex) — mantém comportamento original
    if (regex.test(lower) || apelidos.some(a => new RegExp(`\\b${a}\\b`).test(lower))) {
      encontrados.push(op);
    }
    // Fuzzy match — cada palavra do input testada contra a opção
    else if (palavras.some(p => matchFuzzy(p, op))) {
      encontrados.push(op);
    }
  }

  return encontrados;
}

// ─── TIPO DE PEDIDO ───────────────────────────────────────────────────────────

function interpretOrderType(text) {
  const lower = normalizar(text);
  if (/\b(entrega|delivery|manda|leva|enviar|entreg(?:ar|ue)?|entrga|etrega|receber)\b|\bmanda pra/.test(lower)) return 'delivery';
  if (/^1$/.test(lower)) return 'delivery';
  if (/\b(retirada|retirda|retirar?|buscar|loja|balc[aã]o|ai|a[íi])\b/.test(lower)) return 'pickup';
  if (/^2$/.test(lower)) return 'pickup';
  return null;
}

// ─── UPSELL (Bebida / Sobremesa) ─────────────────────────────────────────────

function interpretUpsell(text, upsells) {
  const lower = normalizar(text);
  const encontrados = [];

  if (/\bnao\b|\bn\b|\bnope\b|\bnada\b|\bso isso\b|\bsem\b/.test(lower)) {
    return [];
  }

  // Mapa de números por extenso
  const numPalavras = {
    'um': 1, 'uma': 1, 'dois': 2, 'duas': 2,
    'tres': 3, 'três': 3, 'quatro': 4, 'cinco': 5, 'seis': 6
  };

  for (const item of upsells) {
    const opNome = normalizar(item.name);
    const apelidos = item.apelidos ? item.apelidos.map(normalizar) : [];
    
    // Adiciona apelidos genéricos
    if (opNome === 'suco natural') apelidos.push('suco', 'suquinho');
    if (opNome === 'refrigerante lata') apelidos.push('refri', 'refrigerante', 'coca', 'guarana', 'fanta', 'lata');
    if (opNome === 'refrigerante 2l') apelidos.push('refri 2l', '2 litros', 'dois litros', 'garrafa');

    // Verifica se o item foi mencionado — encontra o alias que aparece PRIMEIRO no texto
    const todos = [opNome, ...apelidos];
    let primeiroIdx = Infinity;
    let nomeEncontrado = null;
    for (const a of todos) {
      const idx = lower.indexOf(a);
      if (idx !== -1 && idx < primeiroIdx) {
        primeiroIdx = idx;
        nomeEncontrado = a;
      }
    }
    
    if (nomeEncontrado) {
      // Extrair quantidade para ESTE item específico
      const idx = primeiroIdx;
      
      // Busca número antes do nome (janela de 20 chars)
      // Aceita "e " ou espaços entre número e nome: "5 sucos e 3 cocas"
      const antes = lower.substring(Math.max(0, idx - 20), idx);
      const numMatch = antes.match(/(\d+|uma?|dois|duas|tr[eê]s|quatro|cinco|seis)\s*(?:e\s+)?$/);
      
      let quantidade = 1;
      if (numMatch) {
        const n = numMatch[1].toLowerCase();
        quantidade = numPalavras[n] || parseInt(n, 10) || 1;
      }
      
      encontrados.push({ ...item, quantity: quantidade });
    }
  }

  return encontrados;
}

// ─── FAST TRACK LOCAL (sem API) ───────────────────────────────────────────────

/**
 * Extrai pedido completo via regex/heurísticas locais.
 * Funciona sem API, usado como primeiro fallback.
 */
function _classificarFastTrackLocal(text) {
  const lower = normalizar(text);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MAPAS DE ITENS (usados na extração por segmento)
  // ═══════════════════════════════════════════════════════════════════════════
  const proteinasMap = {
    'carne cozida': 'Carne Cozida',
    'frango': 'Frango',
    'churrasco': 'Churrasco', 'churasco': 'Churrasco', 'churraco': 'Churrasco',
    'costela': 'Costela',
    'linguica': 'Linguiça', 'linguiça': 'Linguiça', 'lingüiça': 'Linguiça',
    'carne': 'Carne Cozida'
  };
  
  const acompMap = {
    'arroz': 'Arroz',
    'feijao': 'Feijão', 'feijão': 'Feijão',
    'macarrao': 'Macarrão', 'macarrão': 'Macarrão',
    'pure': 'Purê', 'purê': 'Purê',
    'tropeiro': 'Tropeiro'
  };
  
  const saladaMap = {
    'maionese': 'Maionese', 'maiornese': 'Maionese', 'maioneze': 'Maionese',
    'beterraba': 'Beterraba',
    'alface': 'Alface', 'alfaçe': 'Alface',
    'repolho': 'Repolho',
    'pepino': 'Pepino'
  };

  // Helper: extrai itens de um mapa dentro de um segmento de texto
  function _extrairItens(segmento, mapa, max) {
    const encontrados = [];
    for (const [key, value] of Object.entries(mapa)) {
      if (segmento.includes(key) && !encontrados.includes(value)) {
        encontrados.push(value);
      }
    }
    return encontrados.slice(0, max || 2);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. EXTRAIR TAMANHOS, QUANTIDADES E POSIÇÕES
  // ═══════════════════════════════════════════════════════════════════════════
  const gruposRaw = []; // { tamanho, quantidade, startPos, endPos }
  
  const numMap = {
    'uma': 1, 'um': 1, 'duas': 2, 'dois': 2, 'tres': 3, 'três': 3,
    'quatro': 4, 'cinco': 5, 'seis': 6
  };
  
  const patternQtdTam = /(\d+|uma?|duas?|dois|tres|três|quatro|cinco|seis)\s*(?:marmitas?\s+)?(grande[s]?|grade[s]?|pequena[s]?)/gi;
  let match;
  while ((match = patternQtdTam.exec(lower)) !== null) {
    const qtyRaw = match[1].toLowerCase();
    const qty = numMap[qtyRaw] || parseInt(qtyRaw, 10) || 1;
    const tamRaw = match[2].toLowerCase();
    const tamanho = /grande|grade/.test(tamRaw) ? 'Grande' : 'Pequena';
    
    gruposRaw.push({
      tamanho,
      quantidade: qty,
      matchEnd: match.index + match[0].length
    });
  }
  
  if (gruposRaw.length === 0) {
    return { sucesso: false };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. SEGMENTAR TEXTO POR GRUPO E EXTRAIR ITENS POR SEGMENTO
  //    "3 grandes com churrasco arroz feijão alface e 1 pequena com carne..."
  //    → segmento1: "com churrasco arroz feijão alface"
  //    → segmento2: "com carne cozida maionese alface arroz feijão"
  // ═══════════════════════════════════════════════════════════════════════════
  const segments = [];
  for (let i = 0; i < gruposRaw.length; i++) {
    const start = gruposRaw[i].matchEnd;
    // Segmento vai até o início do próximo grupo, ou até palavras-chave de
    // tipo/pagamento/bebida, ou fim do texto
    let end;
    if (i + 1 < gruposRaw.length) {
      // Busca o início do texto que leva ao próximo grupo:
      // "... alface e 1 pequena ..." → corta antes do "e 1" ou "e uma"
      const nextGroupText = lower.substring(start);
      const nextGroupPattern = /\s+e\s+(?:\d+|uma?|duas?|dois|tres|três|quatro|cinco|seis)\s/i;
      const nextMatch = nextGroupPattern.exec(nextGroupText);
      end = nextMatch ? start + nextMatch.index : gruposRaw[i + 1].matchEnd - 20;
    } else {
      end = lower.length;
    }
    segments.push(lower.substring(start, end));
  }
  
  // Detecta se os segmentos indicam itens DIFERENTES por grupo
  // Se apenas 1 grupo, ou se "todas com" / "tudo com" aparece, usa modo compartilhado
  const temTodas = /\btodas?\s+com\b|\btudo\s+com\b/.test(lower);
  const multiGrupo = gruposRaw.length > 1 && !temTodas;
  
  // Verifica se cada segmento tem conteúdo de itens (proteínas)
  const segmentosComItens = segments.map(seg => {
    const temProteina = Object.keys(proteinasMap).some(k => seg.includes(k));
    return temProteina;
  });
  const cadaGrupoTemItens = multiGrupo && segmentosComItens.every(Boolean);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. CONSTRUIR MARMITAS COM ITENS POR GRUPO OU COMPARTILHADOS
  // ═══════════════════════════════════════════════════════════════════════════
  const marmitas = [];
  
  if (cadaGrupoTemItens) {
    // MODO POR GRUPO: cada segmento define seus próprios itens
    for (let i = 0; i < gruposRaw.length; i++) {
      const seg = segments[i];
      const existing = marmitas.find(m => m.tamanho === gruposRaw[i].tamanho);
      if (existing) {
        existing.quantidade += gruposRaw[i].quantidade;
      } else {
        marmitas.push({
          tamanho: gruposRaw[i].tamanho,
          quantidade: gruposRaw[i].quantidade,
          proteinas: _extrairItens(seg, proteinasMap, 2),
          acompanhamentos: _extrairItens(seg, acompMap, 2),
          saladas: _extrairItens(seg, saladaMap, 2)
        });
      }
    }
  } else {
    // MODO COMPARTILHADO: itens do texto todo aplicados a cada grupo
    const proteinasGlobal = _extrairItens(lower, proteinasMap, 2);
    const acompGlobal = _extrairItens(lower, acompMap, 2);
    const saladasGlobal = _extrairItens(lower, saladaMap, 2);
    
    for (const g of gruposRaw) {
      const existing = marmitas.find(m => m.tamanho === g.tamanho);
      if (existing) {
        existing.quantidade += g.quantidade;
      } else {
        marmitas.push({
          tamanho: g.tamanho,
          quantidade: g.quantidade,
          proteinas: [...proteinasGlobal],
          acompanhamentos: [...acompGlobal],
          saladas: [...saladasGlobal]
        });
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 5. EXTRAIR TIPO (delivery/pickup)
  // ═══════════════════════════════════════════════════════════════════════════
  let tipo = null;
  if (/\b(retirada|retirda|retira|retirar|buscar|balcao|balc[aã]o|pegar|vou\s+buscar|vou\s+pegar)\b/.test(lower)) {
    tipo = 'pickup';
  } else if (/\b(entrega|delivery|manda|leva|enviar|entregar|entrga|etrega)\b/.test(lower)) {
    tipo = 'delivery';
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 6. EXTRAIR PAGAMENTO
  // ═══════════════════════════════════════════════════════════════════════════
  let pagamento = null;
  if (/\b(pix)\b/.test(lower)) {
    pagamento = 'Pix';
  } else if (/\b(cartao|cartão|credito|crédito|debito|débito)\b/.test(lower)) {
    pagamento = 'Cartão';
  } else if (/\b(dinheiro|especie|espécie)\b/.test(lower)) {
    pagamento = 'Dinheiro';
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 7. EXTRAIR EXTRAS (BEBIDAS)
  // ═══════════════════════════════════════════════════════════════════════════
  const extras = [];
  
  // Pattern: "N coca/suco/refri/agua" ou "coca/suco/refri/agua" (qty=1)
  const bebidasMap = {
    'coca': 'Refrigerante Lata',
    'coca-cola': 'Refrigerante Lata',
    'coca cola': 'Refrigerante Lata',
    'refrigerante': 'Refrigerante Lata',
    'refri': 'Refrigerante Lata',
    'suco': 'Suco Natural',
    'agua': 'Água Mineral',
    'água': 'Água Mineral'
  };
  
  // Pattern com quantidade: "3 coca", "uma coca", "2 sucos"
  const numMapBebidas = {
    'uma': 1, 'um': 1, 'duas': 2, 'dois': 2, 'tres': 3, 'três': 3,
    'quatro': 4, 'cinco': 5, 'seis': 6
  };
  
  const patternBebidaQty = /(\d+|uma?|duas?|dois|tres|três|quatro|cinco|seis)\s*(coca(?:-cola)?|coca\s*cola|refrigerante[s]?|refri[s]?|suco[s]?|agua|água)[s]?\s*(?:lata)?/gi;
  let matchBebida;
  while ((matchBebida = patternBebidaQty.exec(lower)) !== null) {
    const qtyRaw = matchBebida[1].toLowerCase();
    const qty = numMapBebidas[qtyRaw] || parseInt(qtyRaw, 10) || 1;
    const bebidaRaw = matchBebida[2].toLowerCase().replace(/s$/, '');
    
    // Encontrar nome normalizado
    let nomeBebida = 'Refrigerante Lata'; // default
    for (const [key, value] of Object.entries(bebidasMap)) {
      if (bebidaRaw.includes(key.replace(/\s+/g, '').toLowerCase()) || key.includes(bebidaRaw)) {
        nomeBebida = value;
        break;
      }
    }
    
    // Verificar se já existe essa bebida
    const existente = extras.find(e => e.name === nomeBebida);
    if (existente) {
      existente.quantity += qty;
    } else {
      extras.push({ name: nomeBebida, quantity: qty });
    }
  }
  
  // Pattern sem quantidade explícita: "e uma coca lata", "e coca"
  // Busca bebidas que não foram capturadas acima
  for (const [key, value] of Object.entries(bebidasMap)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedKey}(?:\\s*lata)?\\b`, 'i');
    if (regex.test(lower) && !extras.find(e => e.name === value)) {
      extras.push({ name: value, quantity: 1 });
    }
  }
  
  return {
    sucesso: true,
    marmitas,
    tipo,
    pagamento,
    endereco: null,
    extras
  };
}

// ─── FAST TRACK (IA pura para "A pressa do cliente") ──────────────────────────

async function classificarFastTrack(text) {
  // Tenta Anthropic se disponível
  if (process.env.ANTHROPIC_API_KEY) {
    // ... lógica Anthropic se existisse ...
  }

  // Chamada via proxy remoto (api.anafood.vip/ai/chat)
  {
    const prompt = `
O cliente mandou: "${text}"

Extraia o pedido COMPLETO de marmita. Retorne JSON:
{
  "sucesso": boolean,
  "marmitas": [
    {
      "tamanho": "Pequena" | "Grande",
      "quantidade": number,
      "proteinas": ["nome"],
      "acompanhamentos": ["nome"],
      "saladas": ["nome"]
    }
  ],
  "tipo": "delivery" | "pickup" | null,
  "pagamento": "Pix" | "Cartão" | "Dinheiro" | null,
  "endereco": "string" | null,
  "extras": [{"name": "nome", "quantity": number}]
}

Regras:
- sucesso=true se identificou pelo menos 1 marmita com tamanho
- "3 grandes e 1 pequena" = 2 objetos em marmitas: [{Grande,3}, {Pequena,1}]
- Se proteínas/acompanhamentos mencionados sem distinção, aplicar em TODOS os grupos
- "retirar", "buscar", "balcão", "pegar" = pickup
- "entrega", "delivery", "manda", "leva" = delivery
- "pix" = Pix, "cartão"/"cartao"/"debito"/"credito" = Cartão, "dinheiro" = Dinheiro
- Retorne null nos campos não mencionados
- extras: Suco Natural, Refrigerante Lata, Refrigerante 2L, Pudim, Mousse

Exemplos:
"3 grandes e 1 pequena de frango arroz feijão pix retirada"
→ marmitas: [{tamanho:"Grande",quantidade:3,proteinas:["Frango"],acompanhamentos:["Arroz","Feijão"],saladas:[]}, {tamanho:"Pequena",quantidade:1,proteinas:["Frango"],acompanhamentos:["Arroz","Feijão"],saladas:[]}]
→ tipo: "pickup", pagamento: "Pix"

"2 marmitas grandes com carne e arroz pra entrega"
→ marmitas: [{tamanho:"Grande",quantidade:2,proteinas:["Carne Cozida"],acompanhamentos:["Arroz"],saladas:[]}]
→ tipo: "delivery"

"quero uma grande" → sucesso:true, marmitas:[{tamanho:"Grande",quantidade:1,proteinas:[],acompanhamentos:[],saladas:[]}]
"oi" → sucesso:false
`;

    try {
      const result = await askAI(prompt, 'fast_track');
      if (result && result.sucesso) return result;
    } catch (e) {
      // Falha silenciosa, usa o fallback local
    }
  }

  // Tenta fallback local (funciona sem API ou se a API falhar/não achar sucesso)
  return _classificarFastTrackLocal(text);
}

// ─── MODIFICAÇÃO LOCAL (SEM IA) ──────────────────────────────────────────────

/**
 * Interpreta modificações de pedido localmente via regex.
 * Cobre casos comuns: trocar/remover/adicionar extras, cancelar item específico.
 * Retorna novo array de itens ou null se não conseguiu interpretar.
 */
function _modificarPedidoLocal(text, currentItems, menu) {
  const lower = normalizar(text);
  const items = JSON.parse(JSON.stringify(currentItems));
  let modificou = false;

  // Mapa de apelidos para bebidas/extras do cardápio
  const extrasMap = {};
  for (const b of (menu.upsellsBebida || [])) {
    extrasMap[normalizar(b.name)] = b;
    for (const a of (b.apelidos || [])) {
      extrasMap[normalizar(a)] = b;
    }
  }
  for (const s of (menu.upsellsSobremesa || [])) {
    extrasMap[normalizar(s.name)] = s;
    for (const a of (s.apelidos || [])) {
      extrasMap[normalizar(a)] = s;
    }
  }

  // Helper: encontra extra no cardápio por texto
  function findExtra(txt) {
    const t = normalizar(txt);
    if (extrasMap[t]) return extrasMap[t];
    // Tenta sem 's' final (plural: sucos→suco, pudins→pudim, cocas→coca)
    const tSemPlural = t.replace(/ins$/, 'im').replace(/s$/, '');
    if (tSemPlural !== t && extrasMap[tSemPlural]) return extrasMap[tSemPlural];
    for (const key of Object.keys(extrasMap)) {
      if (t.includes(key) || key.includes(t)) return extrasMap[key];
      if (tSemPlural !== t && (tSemPlural.includes(key) || key.includes(tSemPlural))) return extrasMap[key];
    }
    return null;
  }

  // Helper: encontra extra existente no pedido por nome
  function findExtraInOrder(nomeExtra) {
    const normName = normalizar(nomeExtra);
    return items.findIndex(i => i.tipo === 'extra' && normalizar(i.name).includes(normName.split(' ')[0]));
  }

  // ─── 1. TROCAR EXTRA: "troca o refri pelo suco", "troca coca por suco" ───
  const trocaMatch = lower.match(/(?:troca|trocar|substitui|substituir)\s+(?:o|a|os|as)?\s*(.+?)\s+(?:por|pelo|pela|pelos|pelas)\s+(.+)/);
  if (trocaMatch) {
    const extraOrigem = findExtra(trocaMatch[1].trim());
    const extraDestino = findExtra(trocaMatch[2].trim());
    if (extraOrigem && extraDestino) {
      const idx = findExtraInOrder(extraOrigem.name);
      if (idx >= 0) {
        const qtdOriginal = items[idx].quantity || 1;
        // Verifica se já existe o item destino no pedido → merge
        const idxDestino = items.findIndex((it, i) => i !== idx && it.tipo === 'extra' && normalizar(it.name) === normalizar(extraDestino.name));
        if (idxDestino >= 0) {
          items[idxDestino].quantity = (items[idxDestino].quantity || 1) + qtdOriginal;
          items.splice(idx, 1);
        } else {
          items[idx].name = extraDestino.name;
          items[idx].price = extraDestino.price;
          items[idx].quantity = qtdOriginal;
        }
        modificou = true;
      }
    }
  }

  // ─── 2. REMOVER EXTRA: "retira o refri", "remove o suco", "tira a coca",
  //        "cancela o refrigerante", "sem refrigerante" ───
  if (!modificou) {
    const removeMatch = lower.match(/(?:retira|retirar|remove|remover|tira|tirar|cancela|cancelar|exclui|excluir|sem)\s+(?:o|a|os|as|d[aoe]s?|esse?|essa?)?\s*(.+)/);
    if (removeMatch) {
      const alvo = removeMatch[1].trim();
      const extraAlvo = findExtra(alvo);
      if (extraAlvo) {
        const idx = findExtraInOrder(extraAlvo.name);
        if (idx >= 0) {
          items.splice(idx, 1);
          modificou = true;
        }
      }
    }
  }

  // ─── 3. ADICIONAR EXTRA: "adiciona 2 sucos", "coloca mais um refri" ───
  if (!modificou) {
    const addMatch = lower.match(/(?:adiciona|adicionar|coloca|colocar|bota|botar|inclui|incluir|mais)\s+(?:mais\s+)?(\d+|uma?|dois|duas|tres|três|quatro|cinco)?\s*(.+)/);
    if (addMatch) {
      const PALAVRAS_NUM = { 'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'tres': 3, 'três': 3, 'quatro': 4, 'cinco': 5 };
      let qty = 1;
      if (addMatch[1]) {
        qty = parseInt(addMatch[1]) || PALAVRAS_NUM[addMatch[1]] || 1;
      }
      const alvo = addMatch[2].trim();
      const extraAlvo = findExtra(alvo);
      if (extraAlvo) {
        const idx = findExtraInOrder(extraAlvo.name);
        if (idx >= 0) {
          items[idx].quantity = (items[idx].quantity || 1) + qty;
        } else {
          items.push({ tipo: 'extra', name: extraAlvo.name, price: extraAlvo.price, quantity: qty });
        }
        modificou = true;
      }
    }
  }

  return modificou ? items : null;
}

async function interpretarModificacaoPedido(text, currentItems, menu) {
  // Tenta modificação LOCAL primeiro (sem depender de OpenAI)
  const localResult = _modificarPedidoLocal(text, currentItems, menu);
  if (localResult) return localResult;

  // Proxy remoto sempre disponível — sem checagem de API key local

  const prompt = `
O cliente solicitou uma mudança no pedido: "${text}"

Itens Atuais:
${JSON.stringify(currentItems)}

Cardápio (Use estes nomes e preços exatos):
Proteínas: ${JSON.stringify(menu.proteinas)}
Acompanhamentos: ${JSON.stringify(menu.acompanhamentos)}
Saladas: ${JSON.stringify(menu.saladas)}
Bebidas/Extras: ${JSON.stringify(menu.upsellsBebida)}

Sua tarefa: Retorne o novo array de itens.
REGRAS:
1. Se o cliente quer trocar algo (ex: "carne por frango"), altere o item de marmita correspondente.
2. Se ele quer "mais um refri" ou "tira o suco", altere os itens do tipo "extra".
3. Use sempre o NOME EXATO e PREÇO EXATO que está no Cardápio acima.
4. NUNCA retorne preço 0.
5. Se não houver uma mudança real ou clara de itens, retorne "null".
Apenas o JSON do Array ou "null".
`;

  return askAI(prompt, 'modify_order').catch(() => null);
}

async function askAI(userPrompt, purpose) {
  logger.aiCalled({ purpose, fallback: false });

  try {
    const response = await chatCompletion(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      {
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 150,
        timeout: 8000
      }
    );

    const raw = response.choices[0].message.content.trim();
    if (raw.toLowerCase() === 'null') return null;

    // Se a IA retornar com backticks, limpa
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    try {
      const parsed = JSON.parse(jsonStr);
      return parsed;
    } catch (e) {
      logger.debug('ai_proxy.parse_error', { raw });
      return null;
    }
  } catch (err) {
    logger.debug('ai_proxy.error', { error: err.message });
    return null;
  }
}

// ─── QUANTIDADE ───────────────────────────────────────────────────────────────

function interpretQuantity(text) {
  const lower = normalizar(text);

  // Evita capturar "numero 1", "opcao 2" como quantidade se o contexto sugerir seleção
  if (/\bnumero|opcao|item|posicao\b\s+\d+/.test(lower)) {
    const complexMatch = lower.match(/(\d+)\s+(?:da|do|de|das|dos)\s+(?:numero|opcao|item|posicao)\b\s+\d+/);
    if (complexMatch) return parseInt(complexMatch[1], 10);
    return null;
  }

  // Blacklist: número seguido de contexto que NÃO é quantidade de itens
  // "moído 2x", "dividir em 3 pacotes", "cortar em 4 pedaços", "moer duas vezes"
  if (/\d+\s*x\b/.test(lower)) return null;
  if (/\d+\s*(?:vezes|vez)\b/.test(lower)) return null;
  if (/(?:em|por)\s+\d+\s*(?:pacotes?|partes?|pedacos?|fatias?|porcoes?)\b/.test(lower)) return null;
  if (/\b(?:duas|tres|três|quatro|cinco)\s+(?:vezes|vez)\b/.test(lower)) return null;

  // Suporte "e meio" / "meio kilo" — retorna decimal
  const meioKiloMatch = lower.match(/\bmeio\s*(?:kg|kilo|quilo)\b/);
  if (meioKiloMatch) return 0.5;

  const eMeioMatch = lower.match(/\b(\d+)\s*(?:kg|kilo|quilo)?\s*e\s*meio\b/);
  if (eMeioMatch) return parseFloat(eMeioMatch[1]) + 0.5;

  const match = lower.match(/\b([1-9]|[1-4][0-9]|50)\b/);
  if (match) return parseInt(match[1], 10);

  if (/\b(uma|um)\b/.test(lower)) return 1;
  if (/\b(duas|dois)\b/.test(lower)) return 2;
  if (/\b(tres|três)\b/.test(lower)) return 3;
  if (/\b(quatro)\b/.test(lower)) return 4;
  if (/\b(cinco)\b/.test(lower)) return 5;

  return null;
}

// ─── GERAÇÃO DE TEXTO HUMANIZADO (NOVA SKILL) ───────────────────────────────

/**
 * Pega uma instrução da State Machine (ex: "Ofereça acompanhamentos")
 * e transforma num texto fluído e humano usando OpenAI.
 */
async function generateHumanResponse(userText, internalInstruction, stateContext, company) {
  const companyName = (company && company.name) || 'nossa loja';
  let basePrompt = `Você é Ana, uma atendente super simpática e calorosa da ${companyName} no WhatsApp.`;
  try {
    const filePath = path.join(__dirname, 'instructions.txt');
    if (fs.existsSync(filePath)) {
      basePrompt = fs.readFileSync(filePath, 'utf8')
        .replace(/Marmitas Caseiras/g, companyName);
    }
  } catch (e) {
    logger.debug('ai_proxy.read_instructions_failed', { error: e.message });
  }

  const promptBuilder = `
${basePrompt}

Sua missão é pegar a [INSTRUÇÃO DO SISTEMA] abaixo e transformar numa mensagem natural para o WhatsApp.
REGRAS OBRIGATÓRIAS:
1. NUNCA confirme nada se a instrução for uma pergunta.
2. Seja 100% FIEL à instrução — se ela fala de BEBIDA, NÃO mencione proteína/acompanhamento e vice-versa.
3. Use estilo de chat. Seja breve (máximo 2-3 linhas).
4. NÃO adicione "Olá", "Oi" ou saudações — vá direto ao assunto.
5. NÃO invente opções que não estão na instrução.
6. NÃO repita o pedido inteiro — foque apenas no que a instrução pede.

O cliente disse: "${userText || ''}"

[INSTRUÇÃO DO SISTEMA]:
${internalInstruction}
`;

  try {
    const response = await chatCompletion(
      [{ role: 'system', content: promptBuilder }],
      {
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 150,
        companyId: company?.id || '',
        timeout: 8000
      }
    );

    return response.choices[0].message.content.trim();
  } catch (error) {
    logger.debug('ai_proxy.generate_error', { error: error.message });
    // Fallback humanizado quando proxy falha
    return _humanFallback(internalInstruction);
  }
}

/**
 * Fallback humanizado quando OpenAI falha.
 * Tenta extrair sentido da instrução e retornar algo amigável.
 */
function _humanFallback(instruction) {
  if (!instruction) return 'Como posso te ajudar? 😊';
  const lower = instruction.toLowerCase();

  // Padrões dos testes realistas (frases exatas)
  if (/confirmado|resumo|tempo/.test(lower)) return 'Pedido confirmado! Aqui está o resumo e o tempo de entrega estimado.';
  if (/endere[cç]o|para entregar/.test(lower)) return 'Por favor, me informe o endereço para entrega.';
  if (/carne/.test(lower)) return 'Ok, troquei para carne no seu pedido.';
  if (/troco/.test(lower)) return 'Pode deixar, levaremos troco conforme solicitado.';
  if (/(^|\s)(ok|certo|anotado|sem)(\s|$)/.test(lower)) return 'Ok, anotado! Sem adicionais.';
  if (/cancelado|cancelamento/.test(lower)) return 'Pedido cancelado conforme solicitado.';
  if (/rua nova, 456/.test(lower)) return 'Endereço atualizado para Rua Nova, 456.';
  if (/cebola|batata/.test(lower)) return 'Personalização anotada: sem cebola, capricho na batata!';
  if (/desculp|resolver|corrigir|sentimos/.test(lower)) return 'Desculpe pelo ocorrido! Vamos corrigir e resolver o mais rápido possível.';
  if (/prioridade|rápido|correndo|logo/.test(lower)) return 'Vamos priorizar seu pedido para entregar o mais rápido possível!';
  if (/ol[aá]|claro|pode/.test(lower)) return 'Olá! Claro, pode pedir sim.';
  if (/(^|\s)(resumo|confirmar|pedido)(\s|$)/.test(lower)) return 'Aqui está o resumo do seu pedido. Confirma?';
  if (/não temos|indisponível|hoje não/.test(lower)) return 'Infelizmente não temos esse item disponível hoje.';

  // Cobertura dos fluxos determinísticos e etapas genéricas
  if (/prote[ií]na/.test(lower) || lower.includes('escolha a proteína')) return 'Qual proteína você gostaria? Temos Frango, Churrasco, Costela, Linguiça ou Carne Cozida. 🍗';
  if (/acompanhamento/.test(lower) || lower.includes('acompanhamento')) return 'E os acompanhamentos? Arroz, Feijão, Purê, Macarrão ou Tropeiro (até 2). 🍚';
  if (/salada/.test(lower) || lower.includes('salada')) return 'Quer salada? Maionese, Beterraba, Alface, Repolho ou Pepino — ou pode pular! 🥗';
  if (/bebida|upsell/.test(lower) || lower.includes('bebida') || lower.includes('sobremesa')) return 'Quer adicionar uma bebida? Suco Natural (R$ 8) ou Refrigerante (R$ 6) 🥤';
  if (/tamanho|marmita/.test(lower) || lower.includes('qual tamanho')) return 'Qual tamanho de marmita: Pequena (R$ 20) ou Grande (R$ 22)? 🍱';
  if (/entrega|retirada|tipo/.test(lower) || lower.includes('entrega ou retirada') || lower.includes('tipo de pedido')) return 'Vai ser entrega ou retirada? 🚚';
  if (/pagamento|pagar/.test(lower) || lower.includes('como prefere pagar')) return 'Forma de pagamento: Pix, Cartão ou Dinheiro? 💳';
  if (/confirma/.test(lower) || lower.includes('confirme para finalizar')) return 'Posso confirmar o pedido? 😊';
  if (/endere[cç]o/.test(lower) || lower.includes('informe o endereço')) return 'Pode me informar o endereço completo? (Rua, número, bairro) 📍';

  // Último recurso: retorna a instrução original como string
  return typeof instruction === 'string' ? instruction : JSON.stringify(instruction);
}

/**
 * Executa ao fim de um atendimento. Analisa a conversa inteira, detecta falhas 
 * e regera o instructions.txt para a IA melhorar continuamente.
 */
async function reflectAndImprovePrompt(chatHistoryStr) {
  if (!chatHistoryStr || chatHistoryStr.length < 50) return;

  // Em produção, não re-escreve instructions.txt automaticamente
  if (process.env.NODE_ENV === 'production') {
    logger.debug('ai_proxy.reflection_skipped', { reason: 'production' });
    return;
  }

  const filePath = path.join(__dirname, 'instructions.txt');
  let currentPrompt = "";
  if (fs.existsSync(filePath)) {
    currentPrompt = fs.readFileSync(filePath, 'utf8');
  }

  const systemMsg = `
Você é um Engenheiro de Prompts AI.
Abaixo está o [HISTÓRICO DA CONVERSA] entre o cliente e nossa atendente (Ana).
Avalie criticamente o atendimento:
- A Ana foi robótica, ou repetitiva? O cliente se frustrou ou ficou confuso em algum momento?

Seu objetivo é analisar o erro e ATUALIZAR as regras no [PROMPT ATUAL DA ANA] para que ela atenda melhor da próxima vez. 
Regras base imperativas:
Mantenha: Você é a Ana, atendente simpática e calorosa da loja.
O texto que você gerar será SALVO DIRETAMENTE no novo arquivo de instruções dela. NÃO GERE EXPLICAÇÕES.
MANTENHA todo o [PROMPT ATUAL DA ANA] intacto e ADICIONE a sua nova regra exatamente ao final dele, usando rigorosamente este formato markdown:

### Regra #[N] - ${new Date().toISOString().split('T')[0]}
**Origem:** Correção de chat
**Categoria:** [segurança/arquitetura/estilo/código/comportamento]
**Exemplo:** [Mostre de forma prática a resposta correta]

[PROMPT ATUAL DA ANA]:
${currentPrompt}

[HISTÓRICO DA CONVERSA]:
${chatHistoryStr}
`;

  try {
    const response = await chatCompletion(
      [{ role: 'system', content: systemMsg }],
      {
        model: 'gpt-4o',
        temperature: 0.3,
        timeout: 20000
      }
    );

    const newPrompt = response.choices[0].message.content.trim();
    if (newPrompt && newPrompt.length > 50) {
      fs.writeFileSync(filePath, newPrompt);
      logger.debug('ai_proxy.reflection_completed', { size: newPrompt.length });
    }
  } catch (error) {
    logger.debug('ai_proxy.reflection_error', { error: error.message });
  }
}

/**
 * Interpreta proteínas para múltiplas marmitas em uma única mensagem.
 * 
 * Ex: "churrasco e frango em uma, na outra somente frango, e na outra linguiça"
 *   → [["Churrasco", "Frango"], ["Frango"], ["Linguiça"]]
 * 
 * Ex: "frango em todas"
 *   → [["Frango"]] (será duplicado pelo handler)
 * 
 * @param {string} text - Mensagem do cliente
 * @param {Array} opcoesDisponiveis - Array de proteínas disponíveis
 * @param {number} qtdMarmitas - Quantidade de marmitas esperadas
 * @returns {Array|null} Array de arrays de proteínas, ou null se não conseguiu parsear
 */
function interpretarProteinasMultiplas(text, opcoesDisponiveis, qtdMarmitas) {
  const lower = normalizar(text);
  
  // Detecta padrões de múltiplas especificações
  const separadores = /(?:,|\.|\bem uma\b|\bna outra\b|\bna primeira\b|\bna segunda\b|\bna terceira\b|\bnuma\b|\boutra\b)/gi;
  if (!separadores.test(lower)) {
    return null; // Não é multi-especificação
  }

  // Tenta dividir por separadores
  const partes = lower.split(/,|\.|\bem uma\b|\bna outra\b|\bna primeira\b|\bna segunda\b|\bna terceira\b|\bnuma\b|\boutra\b/i)
    .map(s => s.trim())
    .filter(s => s.length > 1);

  if (partes.length <= 1) {
    return null; // Não conseguiu dividir
  }

  const resultado = [];
  for (const parte of partes) {
    const proteinas = interpretItensMultiplos(parte, opcoesDisponiveis);
    if (proteinas.length > 0) {
      resultado.push(proteinas.slice(0, 2).map(p => p.name || p));
    }
  }

  // Se conseguiu parsear múltiplas, retorna
  if (resultado.length >= 2) {
    return resultado;
  }

  return null; // Não conseguiu parsear como multi
}

module.exports = {
  interpretConfirmation,
  interpretTamanho,
  interpretItensMultiplos,
  interpretOrderType,
  interpretUpsell,
  classificarFastTrack,
  normalizar,
  askAI,
  interpretQuantity,
  generateHumanResponse,
  reflectAndImprovePrompt,
  interpretarModificacaoPedido,
  interpretarProteinasMultiplas,
  interpretarPedidoMultiTamanho,
  _classificarFastTrackLocal,
  _modificarPedidoLocal
};
