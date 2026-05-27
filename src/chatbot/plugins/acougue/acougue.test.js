// plugins/acougue/acougue.test.js
// ═══════════════════════════════════════════════════════════════
// Sessão A — Cardápio + Parser Determinístico
// 24 testes: parseQuantidade (12), splitPedidoMultiplo (4), parseDeterministico (8)
// ═══════════════════════════════════════════════════════════════

const { parseQuantidade, splitPedidoMultiplo, parseDeterministico, matchCorte } = require('./parser');
const { DEFAULT_CARDAPIO, BOVINOS, FRANGO, SUINO, UNIT_MAP } = require('./cardapio');

// ═══════════════════════════════════════════════════════════════
// CARDÁPIO — Sessão A: campos novos
// ═══════════════════════════════════════════════════════════════

describe('Cardápio Sessão A', () => {
  test('todos os cortes possuem id, price_per_kg, price_per_unit, unidades_aceitas, preparos_comuns', () => {
    for (const c of DEFAULT_CARDAPIO.cortes) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.price_per_kg).toBe('number');
      expect(c.price_per_kg).toBeGreaterThan(0);
      expect(c).toHaveProperty('price_per_unit');
      expect(Array.isArray(c.unidades_aceitas)).toBe(true);
      expect(c.unidades_aceitas.length).toBeGreaterThan(0);
      expect(Array.isArray(c.preparos_comuns)).toBe(true);
    }
  });

  test('25 bovinos com id snake_case', () => {
    expect(BOVINOS.length).toBe(25);
    for (const b of BOVINOS) {
      expect(b.id).toMatch(/^[a-z_]+$/);
      expect(b.animal).toBe('bovino');
    }
  });

  test('11 frangos', () => {
    expect(FRANGO.length).toBe(11);
    for (const f of FRANGO) expect(f.animal).toBe('frango');
  });

  test('5 suínos', () => {
    expect(SUINO.length).toBe(5);
    for (const s of SUINO) expect(s.animal).toBe('suino');
  });

  test('UNIT_MAP normaliza todas as variantes', () => {
    expect(UNIT_MAP['kl']).toBe('kg');
    expect(UNIT_MAP['quilos']).toBe('kg');
    expect(UNIT_MAP['kgs']).toBe('kg');
    expect(UNIT_MAP['gramas']).toBe('g');
    expect(UNIT_MAP['reais']).toBe('BRL');
    expect(UNIT_MAP['pacote']).toBe('pct');
    expect(UNIT_MAP['peça']).toBe('pcs');
    expect(UNIT_MAP['bandeja']).toBe('bnd');
  });
});

// ═══════════════════════════════════════════════════════════════
// parseQuantidade (12 testes)
// ═══════════════════════════════════════════════════════════════

describe('parseQuantidade', () => {
  test('"1 kg" → 1, kg', () => {
    const r = parseQuantidade('1 kg');
    expect(r.value).toBe(1);
    expect(r.unit).toBe('kg');
  });

  test('"500g" → 0.5, kg', () => {
    const r = parseQuantidade('500g');
    expect(r.value).toBe(0.5);
    expect(r.unit).toBe('kg');
  });

  test('"meio kilo" → 0.5, kg', () => {
    const r = parseQuantidade('meio kilo');
    expect(r.value).toBe(0.5);
    expect(r.unit).toBe('kg');
  });

  test('"1 kl e meio" → 1.5, kg', () => {
    const r = parseQuantidade('1 kl e meio');
    expect(r.value).toBe(1.5);
    expect(r.unit).toBe('kg');
  });

  test('"1,5 kg" → 1.5, kg', () => {
    const r = parseQuantidade('1,5 kg');
    expect(r.value).toBe(1.5);
    expect(r.unit).toBe('kg');
  });

  test('"2x pacote de 500g" → 2, pct, package_size:500', () => {
    const r = parseQuantidade('2x pacote de 500g');
    expect(r.value).toBe(2);
    expect(r.unit).toBe('pct');
    expect(r.package_size).toBe(500);
  });

  test('"20 reais" → 20, BRL', () => {
    const r = parseQuantidade('20 reais');
    expect(r.value).toBe(20);
    expect(r.unit).toBe('BRL');
  });

  test('"01 kilo" → 1, kg', () => {
    const r = parseQuantidade('01 kilo');
    expect(r.value).toBe(1);
    expect(r.unit).toBe('kg');
  });

  test('"250 gramas" → 0.25, kg', () => {
    const r = parseQuantidade('250 gramas');
    expect(r.value).toBe(0.25);
    expect(r.unit).toBe('kg');
  });

  test('"1 quilo e meio" → 1.5, kg', () => {
    const r = parseQuantidade('1 quilo e meio');
    expect(r.value).toBe(1.5);
    expect(r.unit).toBe('kg');
  });

  test('"2 kl" → 2, kg', () => {
    const r = parseQuantidade('2 kl');
    expect(r.value).toBe(2);
    expect(r.unit).toBe('kg');
  });

  test('"3 quilos" → 3, kg', () => {
    const r = parseQuantidade('3 quilos');
    expect(r.value).toBe(3);
    expect(r.unit).toBe('kg');
  });
});

// ═══════════════════════════════════════════════════════════════
// splitPedidoMultiplo (4 testes)
// ═══════════════════════════════════════════════════════════════

describe('splitPedidoMultiplo', () => {
  test('"1 kg patinho + 2 kg alcatra" → 2 itens', () => {
    expect(splitPedidoMultiplo('1 kg patinho + 2 kg alcatra').length).toBe(2);
  });

  test('"1 kg patinho\\n2 kg costela" → 2 itens', () => {
    expect(splitPedidoMultiplo('1 kg patinho\n2 kg costela').length).toBe(2);
  });

  test('"1 patinho" → 1 item', () => {
    expect(splitPedidoMultiplo('1 patinho').length).toBe(1);
  });

  test('"1 lagarto + 2 kg coxão + 1 frango" → 3 itens', () => {
    expect(splitPedidoMultiplo('1 lagarto + 2 kg coxão + 1 frango').length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// parseDeterministico (8 testes)
// ═══════════════════════════════════════════════════════════════

describe('parseDeterministico', () => {
  test('"1 kg patinho moído" → confidence >= 0.85', () => {
    const r = parseDeterministico('1 kg patinho moído', DEFAULT_CARDAPIO);
    expect(r.items.length).toBe(1);
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    expect(r.items[0].name).toBe('Patinho');
    expect(r.items[0].quantity.value).toBe(1);
    expect(r.items[0].preparation.style).toContain('Moído');
  });

  test('"500g de alcatra em bife" → confidence >= 0.85', () => {
    const r = parseDeterministico('500g de alcatra em bife', DEFAULT_CARDAPIO);
    expect(r.items.length).toBe(1);
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    expect(r.items[0].name).toBe('Alcatra');
    expect(r.items[0].quantity.value).toBe(0.5);
    expect(r.items[0].preparation.style).toContain('bife');
  });

  test('"patinho moído duas vezes" → times: 2', () => {
    const r = parseDeterministico('patinho moído duas vezes', DEFAULT_CARDAPIO);
    expect(r.items.length).toBe(1);
    expect(r.items[0].preparation.times).toBe(2);
  });

  test('"1 kg patinho dividir em pacotes de 500g" → packaging detectado', () => {
    const r = parseDeterministico('1 kg patinho dividir em pacotes de 500g', DEFAULT_CARDAPIO);
    expect(r.items.length).toBe(1);
    expect(r.items[0].packaging).not.toBeNull();
    expect(r.items[0].packaging.divide).toBe(true);
    expect(r.items[0].packaging.package_size).toBe('500g');
  });

  test('"texto sem sentido nenhum" → confidence < 0.5', () => {
    const r = parseDeterministico('texto sem sentido nenhum', DEFAULT_CARDAPIO);
    expect(r.confidence).toBeLessThan(0.5);
  });

  test('"1,5 kg de patinho moído 2x" → value: 1.5, times: 2', () => {
    const r = parseDeterministico('1,5 kg de patinho moído 2x', DEFAULT_CARDAPIO);
    expect(r.items.length).toBe(1);
    expect(r.items[0].quantity.value).toBe(1.5);
    expect(r.items[0].preparation.times).toBe(2);
  });

  test('"20 reais de patinho" → unit: BRL', () => {
    const r = parseDeterministico('20 reais de patinho', DEFAULT_CARDAPIO);
    expect(r.items.length).toBe(1);
    expect(r.items[0].quantity.unit).toBe('BRL');
    expect(r.items[0].quantity.value).toBe(20);
  });

  test('pedido múltiplo → 2 itens no array', () => {
    const r = parseDeterministico('1 kg patinho + 2 kg alcatra', DEFAULT_CARDAPIO);
    expect(r.items.length).toBe(2);
    expect(r.items[0].name).toBe('Patinho');
    expect(r.items[1].name).toBe('Alcatra');
  });
});

// ═══════════════════════════════════════════════════════════════
// Sessão B — Validator (8 testes)
// ═══════════════════════════════════════════════════════════════

const { validateItem, calculateItemPrice, corteExiste, formatItemForSummary } = require('./validator');

describe('Sessão B — validateItem errorCodes', () => {
  test('item sem nome → INVALID_CORTE', () => {
    const v = validateItem({ tipo: 'corte', quantity: { value: 1, unit: 'kg' } });
    expect(v.valid).toBe(false);
    expect(v.errorCodes).toContain('INVALID_CORTE');
    expect(v.errors).toContain('Corte não definido');
  });

  test('quantidade 0 → INVALID_QUANTITY', () => {
    const v = validateItem({ tipo: 'corte', name: 'Picanha', quantity: { value: 0, unit: 'kg' } });
    expect(v.valid).toBe(false);
    expect(v.errorCodes).toContain('INVALID_QUANTITY');
  });

  test('quantidade > 50 → INVALID_QUANTITY', () => {
    const v = validateItem({ tipo: 'corte', name: 'Picanha', quantity: { value: 55, unit: 'kg' } });
    expect(v.valid).toBe(false);
    expect(v.errorCodes).toContain('INVALID_QUANTITY');
  });

  test('item válido → errorCodes vazio', () => {
    const v = validateItem({ tipo: 'corte', name: 'Picanha', quantity: { value: 2, unit: 'kg' } });
    expect(v.valid).toBe(true);
    expect(v.errorCodes).toEqual([]);
  });
});

describe('Sessão B — calculateItemPrice avançado', () => {
  test('BRL → retorna valor direto', () => {
    const p = calculateItemPrice({
      tipo: 'corte', price_per_kg: 69.90,
      quantity: { value: 30, unit: 'BRL', type: 'value' }
    });
    expect(p).toBe(30);
  });

  test('pct com package_size → preço por pacote', () => {
    const p = calculateItemPrice({
      tipo: 'corte', price_per_kg: 42.90,
      quantity: { value: 2, unit: 'pct', type: 'package', package_size: 500 }
    });
    // 42.90 × (500/1000) × 2 = 42.90
    expect(p).toBe(42.90);
  });

  test('g unit → converte para kg', () => {
    const p = calculateItemPrice({
      tipo: 'corte', price_per_kg: 69.90,
      quantity: { value: 500, unit: 'g' }
    });
    // 69.90 × (500/1000) = 34.95
    expect(p).toBe(34.95);
  });

  test('pct sem package_size → default 500g', () => {
    const p = calculateItemPrice({
      tipo: 'corte', price_per_kg: 42.90,
      quantity: { value: 1, unit: 'pct', type: 'package' }
    });
    // 42.90 × 0.5 × 1 = 21.45
    expect(p).toBe(21.45);
  });
});

// ═══════════════════════════════════════════════════════════════
// Sessão B — Templates (6 testes)
// ═══════════════════════════════════════════════════════════════

const tpl = require('./templates');

describe('Sessão B — Templates novas', () => {
  test('abertura() contém emoji e exemplo', () => {
    const msg = tpl.abertura();
    expect(msg).toContain('🥩');
    expect(msg).toContain('Ex:');
  });

  test('avisoPrecoVariavel() contém balança', () => {
    const msg = tpl.avisoPrecoVariavel();
    expect(msg).toContain('balança');
    expect(msg).toContain('⚠️');
  });

  test('corteNaoEncontrado("salmão") contém o texto', () => {
    const msg = tpl.corteNaoEncontrado('salmão');
    expect(msg).toContain('salmão');
    expect(msg).toContain('cardápio');
  });

  test('quantidadeInvalida() contém exemplos', () => {
    const msg = tpl.quantidadeInvalida();
    expect(msg).toContain('kg');
    expect(msg).toContain('500g');
  });

  test('resumoItem() formata corte individual', () => {
    const txt = tpl.resumoItem({
      tipo: 'corte', name: 'Picanha',
      quantity: { value: 2, unit: 'kg' },
      estimated_price: 139.80,
      preparation: { style: 'Fatiado' }
    });
    expect(txt).toContain('Picanha');
    expect(txt).toContain('2 kg');
    expect(txt).toContain('139,80');
    expect(txt).toContain('Fatiado');
  });

  test('resumoPedido completo com entrega', () => {
    const items = [{
      tipo: 'corte', name: 'Alcatra',
      quantity: { value: 1, unit: 'kg' },
      estimated_price: 54.90,
      preparation: { style: 'Moído' }
    }];
    const txt = tpl.resumoPedido(items, 8.00, 'Pix', 'Rua Teste, 123', 'entrega');
    expect(txt).toContain('Alcatra');
    expect(txt).toContain('Entrega');
    expect(txt).toContain('Rua Teste');
    expect(txt).toContain('Pix');
    expect(txt).toContain('Taxa');
  });
});

// ═══════════════════════════════════════════════════════════════
// Sessão B — Interface plugin (5 testes)
// ═══════════════════════════════════════════════════════════════

const plugin = require('./index');

describe('Sessão B — Interface plugin', () => {
  test('FLOW_STEPS inclui AGUARDANDO_PEDIDO_ACOUGUE', () => {
    const steps = plugin.getFlowSteps();
    expect(steps).toContain('AGUARDANDO_PEDIDO_ACOUGUE');
    expect(steps).toContain('PEDIDO_LIVRE_ACOUGUE');
    expect(steps).toContain('REVISANDO_PEDIDO_ACOUGUE');
  });

  test('AGUARDANDO_PEDIDO_ACOUGUE funciona como PEDIDO_LIVRE', () => {
    const state = { etapa: 'AGUARDANDO_PEDIDO_ACOUGUE', pedidoAtual: { items: [] } };
    const result = plugin.handleStep('AGUARDANDO_PEDIDO_ACOUGUE', '2 kg de picanha', state, DEFAULT_CARDAPIO);
    expect(result).not.toBeNull();
    expect(state.etapa).toBe('REVISANDO_PEDIDO_ACOUGUE');
    expect(state.pedidoAtual.items.length).toBe(1);
  });

  test('handleStep aceita 5º param company', () => {
    const state = { etapa: 'PEDIDO_LIVRE_ACOUGUE', pedidoAtual: { items: [] } };
    const result = plugin.handleStep('PEDIDO_LIVRE_ACOUGUE', '1 kg de alcatra', state, DEFAULT_CARDAPIO, { name: 'Teste' });
    expect(result).not.toBeNull();
    expect(state.pedidoAtual.items.length).toBe(1);
  });

  test('perguntarTipo exportada em templates', () => {
    expect(typeof tpl.perguntarTipo).toBe('function');
    const msgs = tpl.perguntarTipo('Picanha 2kg');
    expect(Array.isArray(msgs)).toBe(true);
    expect(msgs[1]).toContain('Entrega');
  });

  test('formatItemForSummary via validator delega para resumoItem', () => {
    const txt = formatItemForSummary({
      tipo: 'corte', name: 'Patinho',
      quantity: { value: 1, unit: 'kg' },
      estimated_price: 42.90
    });
    expect(txt).toContain('Patinho');
    expect(txt).toContain('42,90');
  });
});

// ═══════════════════════════════════════════════════════════════
// Sessão C — Integração: pluginManager + fluxo completo (4 testes)
// ═══════════════════════════════════════════════════════════════

const pluginManager = require('../../pluginManager');

describe('Sessão C — pluginManager integração', () => {
  beforeEach(() => pluginManager.clearCache());

  test('loadPlugin("acougue") retorna plugin válido com interface completa', () => {
    const p = pluginManager.loadPlugin('acougue');
    expect(p).not.toBeNull();
    expect(p.business_type).toBe('acougue');
    for (const method of pluginManager.REQUIRED_INTERFACE) {
      expect(p).toHaveProperty(method);
    }
  });

  test('getFlowSteps inclui etapas açougue registradas', () => {
    const p = pluginManager.loadPlugin('acougue');
    const steps = p.getFlowSteps();
    expect(steps).toContain('AGUARDANDO_PEDIDO_ACOUGUE');
    expect(steps).toContain('REVISANDO_PEDIDO_ACOUGUE');
    expect(steps).toContain('PEDIDO_LIVRE_ACOUGUE');
  });
});

describe('Sessão C — Fluxo completo simulado', () => {
  function makeState(etapa) {
    return {
      etapa: etapa || 'AGUARDANDO_PEDIDO_ACOUGUE',
      pedidoAtual: { items: [], type: null, address: null, paymentMethod: null, deliveryFee: 0 },
      _marmitaAtual: null,
      _pendingMarmitas: 1,
      _currentMarmitaNumber: 1,
      _upsellPhase: null,
      aguardandoResposta: false,
      _history: ''
    };
  }

  test('Teste 1 — pedido simples com raw_text preservado', () => {
    const state = makeState();
    // Pedido livre
    const r1 = plugin.handleStep('AGUARDANDO_PEDIDO_ACOUGUE', '1 kg de patinho moído', state, DEFAULT_CARDAPIO);
    expect(state.etapa).toBe('REVISANDO_PEDIDO_ACOUGUE');
    expect(state.pedidoAtual.items.length).toBe(1);
    expect(state.pedidoAtual.items[0].raw_text).toBe('1 kg de patinho moído');
    expect(state.pedidoAtual.items[0].name).toBe('Patinho');
    expect(state.pedidoAtual.items[0].estimated_price).toBeGreaterThan(0);

    // Confirma → upsell
    const r2 = plugin.handleStep('REVISANDO_PEDIDO_ACOUGUE', 'sim', state, DEFAULT_CARDAPIO);
    expect(state.etapa).toBe('OFERECENDO_UPSELL');
  });

  test('Teste 2 — pedido múltiplo: 2 itens com estimated_price', () => {
    const state = makeState();
    const r = plugin.handleStep('AGUARDANDO_PEDIDO_ACOUGUE', '1 kg patinho moído + 2 kg costela', state, DEFAULT_CARDAPIO);
    expect(state.etapa).toBe('REVISANDO_PEDIDO_ACOUGUE');
    expect(state.pedidoAtual.items.length).toBe(2);
    expect(state.pedidoAtual.items[0].name).toBe('Patinho');
    expect(state.pedidoAtual.items[0].estimated_price).toBeGreaterThan(0);
    expect(state.pedidoAtual.items[1].name).toContain('Costela');
    expect(state.pedidoAtual.items[1].estimated_price).toBeGreaterThan(0);
    // resumo contém ambos os itens
    const resumo = Array.isArray(r.response) ? r.response.join('\n') : r.response;
    expect(resumo).toContain('Patinho');
  });

  test('Teste 3 — corte não reconhecido → pedidoNaoEntendido', () => {
    const state = makeState();
    const r = plugin.handleStep('AGUARDANDO_PEDIDO_ACOUGUE', '1 kg de salmão', state, DEFAULT_CARDAPIO);
    expect(state.etapa).toBe('PEDIDO_LIVRE_ACOUGUE');
    expect(r.response).toContain('Não encontrei');
  });

  test('Teste 4 — correção durante revisão adiciona novo item', () => {
    const state = makeState();
    // Pedido inicial
    plugin.handleStep('AGUARDANDO_PEDIDO_ACOUGUE', '1 kg de alcatra', state, DEFAULT_CARDAPIO);
    expect(state.etapa).toBe('REVISANDO_PEDIDO_ACOUGUE');
    expect(state.pedidoAtual.items.length).toBe(1);

    // Na revisão, cliente manda mais carne → interpreta como adição
    plugin.handleStep('REVISANDO_PEDIDO_ACOUGUE', '2 kg de picanha fatiada', state, DEFAULT_CARDAPIO);
    expect(state.pedidoAtual.items.length).toBe(2);
    expect(state.pedidoAtual.items[1].name).toBe('Picanha');
    expect(state.pedidoAtual.items[1].quantity.value).toBe(2);
    expect(state.etapa).toBe('REVISANDO_PEDIDO_ACOUGUE');
  });
});
