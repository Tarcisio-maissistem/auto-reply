// plugins/acougue/parser.js
// ═══════════════════════════════════════════════════════════════
// Parser de pedido livre para açougue
// Estratégia: determinístico primeiro, LLM fallback para complexos
// ═══════════════════════════════════════════════════════════════

const ai = require('../../aiInterpreter');
const logger = require('../../logger');
const { UNIT_MAP, DEFAULT_CARDAPIO, PREPAROS } = require('./cardapio');

// ─── NORMALIZAÇÃO DE UNIDADE ───────────────────────────────────

function normalizeUnit(raw) {
  const lower = (raw || '').toLowerCase().trim();
  return UNIT_MAP[lower] || null;
}

/**
 * Extrai quantidade + unidade de texto livre.
 * Retorna { value, unit, type, original }
 */
function parseQuantity(text) {
  const lower = ai.normalizar(text);

  // "N e meio" (kg implícito) — "1 e meio", "2 e meio kg" — MUST be before "meio kg"
  const eMeio = lower.match(/(\d+(?:[.,]\d+)?)\s+e\s+meio\s*(?:kg|kl|kilo|quilo)?s?\b/);
  if (eMeio) {
    const val = parseFloat(eMeio[1].replace(',', '.')) + 0.5;
    return { value: val, unit: 'kg', type: 'weight', original: eMeio[0] };
  }

  // "N unit e meio" — "1 kl e meio", "1 quilo e meio"
  const unitEMeio = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:kg|kl|kilo|quilo)s?\s+e\s+meio\b/);
  if (unitEMeio) {
    const val = parseFloat(unitEMeio[1].replace(',', '.')) + 0.5;
    return { value: val, unit: 'kg', type: 'weight', original: unitEMeio[0] };
  }

  // "meio kg" / "meio kilo" / "meio quilo"
  const meioKg = lower.match(/\bmeio\s+(?:kg|kl|kilo|quilo)s?\b/);
  if (meioKg) return { value: 0.5, unit: 'kg', type: 'weight', original: meioKg[0] };

  // "N,N kg" / "N.N kg" / "N kg"
  const kgMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:kg|kl|kilo|quilo)s?\b/);
  if (kgMatch) {
    const val = parseFloat(kgMatch[1].replace(',', '.'));
    return { value: val, unit: 'kg', type: 'weight', original: kgMatch[0] };
  }

  // "N pacotes de Xg" / "Nx pacote de Xg" / "N pacotes" — BEFORE grams to avoid "500g" conflict
  const pctSizeMatch = lower.match(/(\d+)\s*(?:x\s*)?(?:pacotes?|pct)\s+de\s+(\d+)\s*g/);
  if (pctSizeMatch) {
    return { value: parseInt(pctSizeMatch[1]), unit: 'pct', type: 'package', package_size: parseInt(pctSizeMatch[2]), original: pctSizeMatch[0] };
  }
  const pctMatch = lower.match(/(\d+)\s*(?:x\s*)?(?:pacotes?|pct)/);
  if (pctMatch) {
    const count = parseInt(pctMatch[1]);
    return { value: count, unit: 'pct', type: 'package', original: pctMatch[0] };
  }

  // "Ng" / "N gramas" / "N grama"
  const gMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:g|gramas?|grm)\b/);
  if (gMatch) {
    const grams = parseFloat(gMatch[1].replace(',', '.'));
    return { value: grams / 1000, unit: 'kg', type: 'weight', original: gMatch[0] };
  }

  // "N reais" / "R$ N"
  const brlMatch = lower.match(/(?:r\$\s*)?(\d+(?:[.,]\d+)?)\s*(?:reais|real)\b/);
  const brlMatch2 = lower.match(/r\$\s*(\d+(?:[.,]\d+)?)/);
  const brlFinal = brlMatch || brlMatch2;
  if (brlFinal) {
    const val = parseFloat(brlFinal[1].replace(',', '.'));
    return { value: val, unit: 'BRL', type: 'value', original: brlFinal[0] };
  }

  // "N peças" / "N unidades" / "N bandejas"
  const countMatch = lower.match(/(\d+)\s*(?:pecas?|peças?|unidades?|bandejas?|pcs|un|bnd)/);
  if (countMatch) {
    const normalized = normalizeUnit(countMatch[0].replace(/\d+\s*/, '').trim()) || 'un';
    return { value: parseInt(countMatch[1]), unit: normalized, type: 'count', original: countMatch[0] };
  }

  // Número solto — "2" (assume kg) / "500" (assume gramas)
  const numMatch = lower.match(/\b(\d+(?:[.,]\d+)?)\b/);
  if (numMatch) {
    const num = parseFloat(numMatch[1].replace(',', '.'));
    if (num >= 100) {
      // 500 → 0.5 kg (assume gramas)
      return { value: num / 1000, unit: 'kg', type: 'weight', original: numMatch[0] };
    }
    return { value: num, unit: 'kg', type: 'weight', original: numMatch[0] };
  }

  return null;
}

// ─── MATCH DE CORTE ────────────────────────────────────────────

function matchCorte(text, cortes) {
  const lower = ai.normalizar(text);
  let best = null;
  let bestLen = 0;

  for (const corte of cortes) {
    const corteLower = ai.normalizar(corte.name);
    if (lower.includes(corteLower) && corteLower.length > bestLen) {
      best = corte;
      bestLen = corteLower.length;
    }
    if (corte.apelidos) {
      for (const apelido of corte.apelidos) {
        const apelidoLower = ai.normalizar(apelido);
        if (lower.includes(apelidoLower) && apelidoLower.length > bestLen) {
          best = corte;
          bestLen = apelidoLower.length;
        }
      }
    }
  }

  return best;
}

// ─── MATCH DE PREPARO ──────────────────────────────────────────

function matchPreparo(text) {
  const lower = ai.normalizar(text);
  const matched = [];

  for (const prep of PREPAROS) {
    const prepLower = ai.normalizar(prep.name);
    if (lower.includes(prepLower)) {
      matched.push(prep.name);
      continue;
    }
    if (prep.apelidos) {
      for (const apelido of prep.apelidos) {
        if (lower.includes(ai.normalizar(apelido))) {
          matched.push(prep.name);
          break;
        }
      }
    }
  }

  // Detecta "moído 2x" / "moer duas vezes"
  if (matched.includes('Moído 2x')) {
    // Remove "Moído" simples se "Moído 2x" foi encontrado
    const idx = matched.indexOf('Moído');
    if (idx !== -1) matched.splice(idx, 1);
  }

  return matched;
}

// ─── PARSE DE EMBALAGEM ────────────────────────────────────────

function parsePackaging(text) {
  const lower = ai.normalizar(text);

  // "dividir em N pacotes de Xg"
  const divMatch = lower.match(/(?:dividir|separar|embalar)\s+(?:em\s+)?(\d+)\s+(?:pacotes?|partes?)\s+(?:de\s+)?(\d+)\s*g/);
  if (divMatch) {
    return { divide: true, packages_count: parseInt(divMatch[1]), package_size: `${divMatch[2]}g` };
  }

  // "pacotes de Xg"
  const pctMatch = lower.match(/pacotes?\s+de\s+(\d+)\s*g/);
  if (pctMatch) {
    return { divide: true, package_size: `${pctMatch[1]}g`, packages_count: null };
  }

  // "em N pacotes"
  const nPctMatch = lower.match(/(?:em|dividir)\s+(\d+)\s+(?:pacotes?|partes?)/);
  if (nPctMatch) {
    return { divide: true, packages_count: parseInt(nPctMatch[1]), package_size: null };
  }

  return null;
}

// ─── PARSER DETERMINÍSTICO ─────────────────────────────────────

/**
 * Separa texto em múltiplos itens usando "+" ou "\n".
 */
function splitItems(text) {
  // Normaliza quebras de linha + "+" como separadores
  return text
    .split(/\s*\+\s*|\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Faz parse determinístico de uma linha de pedido.
 * Retorna { item, confidence } ou null.
 */
function parseSingleItem(text, cortes) {
  const corte = matchCorte(text, cortes);
  if (!corte) return null;

  const quantity = parseQuantity(text);
  const preparoList = matchPreparo(text);
  const packaging = parsePackaging(text);

  // Monta preparo combinado
  let preparation = null;
  if (preparoList.length > 0) {
    const lowerText = ai.normalizar(text);
    const style = preparoList[0];
    const times = /2x|duas vezes|2 vezes/.test(lowerText) ? 2 : null;
    // Detecta espessura: "bife fino", "bife grosso"
    const thicknessMatch = lowerText.match(/bife\s+(fino|grosso|medio)/);
    const thickness = thicknessMatch ? thicknessMatch[1] : null;
    const extra = preparoList.slice(1).join(', ') || null;
    preparation = { style };
    if (times) preparation.times = times;
    if (thickness) preparation.thickness = thickness;
    if (extra) preparation.extra = extra;
  }

  const qty = quantity || { value: 1, unit: 'kg', type: 'weight', original: '' };

  // Estimativa de preço
  let estimated_price = 0;
  if (qty.type === 'weight') {
    estimated_price = Math.round(corte.price * qty.value * 100) / 100;
  } else if (qty.type === 'value') {
    estimated_price = qty.value;
  }

  const item = {
    tipo: 'corte',
    animal: corte.animal,
    produto: corte.name,
    name: corte.name,
    quantity: qty,
    price_per_kg: corte.price,
    estimated_price,
    price: estimated_price,
    preparation: preparation,
    packaging: packaging,
    raw_text: text.trim()
  };

  // Confidence: corte + qty = 0.9, corte sozinho = 0.6
  const confidence = quantity ? 0.9 : 0.6;

  return { item, confidence };
}

/**
 * Parser determinístico para pedido completo.
 * Retorna { items: [...], confidence: number }
 */
function parseDeterministico(text, cardapio) {
  const cortes = cardapio.cortes || DEFAULT_CARDAPIO.cortes;
  const parts = splitItems(text);
  const items = [];
  let totalConfidence = 0;

  for (const part of parts) {
    const result = parseSingleItem(part, cortes);
    if (result) {
      items.push(result.item);
      totalConfidence += result.confidence;
    }
  }

  const confidence = parts.length > 0 ? totalConfidence / parts.length : 0;
  return { items, confidence };
}

// ─── PARSER LLM (FALLBACK) ────────────────────────────────────

const axios = require('axios');

/**
 * Usa LLM para estruturar pedido complexo.
 * Chamado apenas quando o parser determinístico falha (confidence < 0.85).
 * Temperature 0.1 para máxima consistência, timeout 5000ms.
 */
async function parseLLM(text, cardapio) {
  const cortes = cardapio.cortes || DEFAULT_CARDAPIO.cortes;
  const cortesInfo = cortes.map(c => `${c.name} (${c.animal}, R$${c.price_per_kg || c.price}/kg)`).join(', ');
  const preparosNomes = PREPAROS.map(p => p.name).join(', ');

  const systemPrompt = `Você é um parser de pedidos de açougue. Extraia os itens do texto do cliente.

CORTES DISPONÍVEIS: ${cortesInfo}
PREPAROS DISPONÍVEIS: ${preparosNomes}

Retorne APENAS um JSON no formato:
{
  "items": [
    {
      "producto": "nome exato do cardápio",
      "animal": "bovino|frango|suino",
      "quantity": { "value": number, "unit": "kg|g|BRL|pct|un" },
      "preparation": "preparo ou null",
      "packaging": "embalagem ou null",
      "raw_text": "trecho original do cliente"
    }
  ]
}

Se não encontrar corte no cardápio, use o nome mais próximo. Responda APENAS o JSON.`;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.1,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    const raw = response.data.choices[0].message.content.trim();
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const itemsArr = Array.isArray(parsed) ? parsed : (parsed.items || []);
    if (!Array.isArray(itemsArr) || itemsArr.length === 0) {
      return { items: [], confidence: 0 };
    }

    const items = itemsArr.map(p => {
      const corteMatch = matchCorte(p.producto || p.corte || '', cortes);
      if (!corteMatch) return null;

      let unit = 'kg';
      let value = 1;
      let type = 'weight';

      if (p.quantity && typeof p.quantity === 'object') {
        unit = normalizeUnit(p.quantity.unit) || 'kg';
        value = p.quantity.value || 1;
      } else if (p.quantidade) {
        value = p.quantidade;
        unit = normalizeUnit(p.unidade) || 'kg';
      }

      // Normaliza gramas para kg
      if (unit === 'g') {
        value = value / 1000;
        unit = 'kg';
        type = 'weight';
      } else if (unit === 'BRL') {
        type = 'value';
      } else if (unit === 'pct' || unit === 'un') {
        type = 'count';
      }

      const qty = { value, unit, type, original: `${p.quantity?.value || value} ${p.quantity?.unit || unit}` };

      let estimated_price = 0;
      if (type === 'weight') {
        estimated_price = Math.round(corteMatch.price * value * 100) / 100;
      } else if (type === 'value') {
        estimated_price = value;
      }

      let preparation = null;
      const prepText = p.preparation || p.preparo;
      if (prepText) {
        preparation = { style: prepText };
      }

      let packaging = null;
      const pkgText = p.packaging || p.embalagem;
      if (pkgText) {
        packaging = parsePackaging(pkgText);
      }

      return {
        tipo: 'corte',
        animal: corteMatch.animal,
        produto: corteMatch.name,
        name: corteMatch.name,
        quantity: qty,
        price_per_kg: corteMatch.price,
        estimated_price,
        price: estimated_price,
        preparation,
        packaging,
        raw_text: (p.raw_text || text).trim()
      };
    }).filter(Boolean);

    return { items, confidence: items.length > 0 ? 0.85 : 0 };
  } catch (err) {
    logger.debug('acougue.parser_llm_error', { error: err.message });
    return { items: [], confidence: 0 };
  }
}

// ─── ENTRADA PRINCIPAL ─────────────────────────────────────────

/**
 * Parse de pedido livre de açougue.
 * Estratégia: determinístico primeiro, LLM se confiança < 0.85.
 */
async function parsePedidoAcougue(text, cardapio) {
  const det = parseDeterministico(text, cardapio || DEFAULT_CARDAPIO);
  if (det.items.length > 0 && det.confidence >= 0.85) {
    return det;
  }

  // Se determinístico encontrou algo mas com baixa confiança,
  // tenta LLM para melhorar
  if (global.process.env.OPENAI_API_KEY) {
    const llm = await parseLLM(text, cardapio || DEFAULT_CARDAPIO);
    if (llm.items.length > 0) return llm;
  }

  // Retorna o que o determinístico encontrou (mesmo com baixa confiança)
  return det;
}

// ─── ALIASES SESSÃO A ──────────────────────────────────────────
const parseQuantidade = parseQuantity;
const splitPedidoMultiplo = splitItems;

module.exports = {
  parsePedidoAcougue,
  parseDeterministico,
  parseSingleItem,
  parseQuantity,
  parseQuantidade,
  parsePackaging,
  matchCorte,
  matchPreparo,
  splitItems,
  splitPedidoMultiplo,
  normalizeUnit
};
