// plugins/acougue/cardapio.js
// ═══════════════════════════════════════════════════════════════
// Cardápio real — 41 cortes + UNIT_MAP + preparos
// Baseado em 231 pedidos reais
// Sessão A: id, price_per_kg, price_per_unit, unidades_aceitas, preparos_comuns
// ═══════════════════════════════════════════════════════════════

const BOVINOS = [
  { id: 'alcatra',           name: 'Alcatra',           animal: 'bovino', apelidos: ['alcatra'],                                          price_per_kg: 42.90, price: 42.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['bife', 'moído', 'grelha', 'tiras'] },
  { id: 'patinho',           name: 'Patinho',           animal: 'bovino', apelidos: ['patinho'],                                          price_per_kg: 32.90, price: 32.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['moído', 'bife', 'cubos', 'tiras', 'strogonoff'] },
  { id: 'contra_file',       name: 'Contra Filé',       animal: 'bovino', apelidos: ['contra file', 'contrafile', 'contrafilé'],           price_per_kg: 39.90, price: 39.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['bife', 'grelha', 'tiras'] },
  { id: 'file_mignon',       name: 'Filé Mignon',       animal: 'bovino', apelidos: ['file mignon', 'file', 'mignon'],                    price_per_kg: 79.90, price: 79.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['bife', 'grelha', 'cubos', 'strogonoff'] },
  { id: 'coxao_mole',        name: 'Coxão Mole',        animal: 'bovino', apelidos: ['colchao mole', 'coxao mole'],                       price_per_kg: 36.90, price: 36.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['moído', 'bife', 'cubos', 'strogonoff'] },
  { id: 'coxao_duro',        name: 'Coxão Duro',        animal: 'bovino', apelidos: ['colchao duro', 'coxao duro'],                       price_per_kg: 34.90, price: 34.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['moído', 'cubos', 'cozida'] },
  { id: 'costela',           name: 'Costela',           animal: 'bovino', apelidos: ['costela', 'costela bovina'],                        price_per_kg: 34.90, price: 34.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['grelha', 'inteiro'] },
  { id: 'fraldinha',         name: 'Fraldinha',         animal: 'bovino', apelidos: ['fraldinha', 'fraudinha'],                            price_per_kg: 44.90, price: 44.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['grelha', 'bife', 'tiras'] },
  { id: 'picanha',           name: 'Picanha',           animal: 'bovino', apelidos: ['picanha'],                                          price_per_kg: 69.90, price: 69.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['grelha', 'bife', 'fatiado'] },
  { id: 'acem',              name: 'Açém',              animal: 'bovino', apelidos: ['acem'],                                             price_per_kg: 29.90, price: 29.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['moído', 'cubos', 'cozida'] },
  { id: 'maminha',           name: 'Maminha',           animal: 'bovino', apelidos: ['maminha'],                                          price_per_kg: 49.90, price: 49.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['grelha', 'bife', 'fatiado'] },
  { id: 'musculo',           name: 'Músculo',           animal: 'bovino', apelidos: ['musculo'],                                          price_per_kg: 31.90, price: 31.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['cubos', 'cozida', 'moído'] },
  { id: 'paleta',            name: 'Paleta',            animal: 'bovino', apelidos: ['paleta', 'paloma'],                                 price_per_kg: 28.90, price: 28.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['moído', 'cubos', 'cozida'] },
  { id: 'lagarto',           name: 'Lagarto',           animal: 'bovino', apelidos: ['lagarto'],                                          price_per_kg: 36.90, price: 36.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['fatiado', 'inteiro', 'cozida'] },
  { id: 'peixinho',          name: 'Peixinho',          animal: 'bovino', apelidos: ['peixinho'],                                         price_per_kg: 38.90, price: 38.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['bife', 'grelha', 'cubos'] },
  { id: 'figado',            name: 'Fígado',            animal: 'bovino', apelidos: ['figado', 'figado bovino'],                           price_per_kg: 19.90, price: 19.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['bife', 'fatiado'] },
  { id: 'carne_de_sol',      name: 'Carne de Sol',      animal: 'bovino', apelidos: ['carne de sol', 'charque'],                          price_per_kg: 52.90, price: 52.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['fatiado', 'cubos'] },
  { id: 'capa_do_contra',    name: 'Capa do Contra',    animal: 'bovino', apelidos: ['capa do contra'],                                   price_per_kg: 37.90, price: 37.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['bife', 'grelha'] },
  { id: 'ponta_de_peito',    name: 'Ponta de Peito',    animal: 'bovino', apelidos: ['ponta de peito', 'peito'],                          price_per_kg: 33.90, price: 33.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['cozida', 'grelha'] },
  { id: 'rabada',            name: 'Rabada',            animal: 'bovino', apelidos: ['rabada'],                                           price_per_kg: 39.90, price: 39.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['cozida'] },
  { id: 'bacon',             name: 'Bacon',             animal: 'bovino', apelidos: ['bacon'],                                            price_per_kg: 44.90, price: 44.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['fatiado', 'cubos', 'inteiro'] },
  { id: 'panceta',           name: 'Panceta',           animal: 'bovino', apelidos: ['panceta'],                                          price_per_kg: 29.90, price: 29.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['fatiado', 'grelha'] },
  { id: 'acem_com_osso',     name: 'Acém com Osso',     animal: 'bovino', apelidos: ['acem com osso'],                                    price_per_kg: 26.90, price: 26.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['cozida'] },
  { id: 'hamburguer_bovino', name: 'Hambúrguer Bovino', animal: 'bovino', apelidos: ['hamburguer bovino', 'hamburger', 'hamburguer'],     price_per_kg: 34.90, price: 34.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct', 'pcs'], preparos_comuns: [] },
  { id: 'almondega_bovina',  name: 'Almôndega Bovina',  animal: 'bovino', apelidos: ['almondega bovina', 'almondega'],                    price_per_kg: 29.90, price: 29.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct', 'pcs'], preparos_comuns: [] }
];

const FRANGO = [
  { id: 'peito_frango',      name: 'Peito de Frango',      animal: 'frango', apelidos: ['peito de frango', 'peito'],                      price_per_kg: 21.90, price: 21.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['bife', 'fatiado', 'cubos', 'grelha'] },
  { id: 'file_frango',       name: 'Filé de Frango',       animal: 'frango', apelidos: ['file de frango'],                                price_per_kg: 24.90, price: 24.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['bife', 'grelha', 'tiras', 'strogonoff'] },
  { id: 'sobrecoxa',         name: 'Sobrecoxa',            animal: 'frango', apelidos: ['sobrecoxa'],                                     price_per_kg: 16.90, price: 16.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pcs'],        preparos_comuns: ['grelha', 'desossado'] },
  { id: 'coxa_sobrecoxa',    name: 'Coxa e Sobrecoxa',     animal: 'frango', apelidos: ['coxa e sobrecoxa', 'coxa sobrecoxa'],             price_per_kg: 14.90, price: 14.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['grelha', 'inteiro'] },
  { id: 'coxinha_asa',       name: 'Coxinha da Asa',       animal: 'frango', apelidos: ['coxinha da asa', 'tulipa'],                      price_per_kg: 18.90, price: 18.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pcs'],        preparos_comuns: ['grelha', 'frito'] },
  { id: 'medalha_frango',    name: 'Medalhão de Frango',   animal: 'frango', apelidos: ['medalhao de frango', 'medalhao'],                price_per_kg: 26.90, price: 26.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pcs'],        preparos_comuns: ['grelha'] },
  { id: 'asinha',            name: 'Asinha',               animal: 'frango', apelidos: ['asinha', 'asa'],                                 price_per_kg: 15.90, price: 15.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pcs'],        preparos_comuns: ['grelha', 'a passarinho'] },
  { id: 'linguica_frango',   name: 'Linguiça de Frango',   animal: 'frango', apelidos: ['linguica de frango'],                            price_per_kg: 19.90, price: 19.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'],        preparos_comuns: ['grelha'] },
  { id: 'hamburguer_frango', name: 'Hambúrguer de Frango', animal: 'frango', apelidos: ['hamburguer de frango'],                          price_per_kg: 28.90, price: 28.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct', 'pcs'], preparos_comuns: [] },
  { id: 'frango_inteiro',    name: 'Frango Inteiro',       animal: 'frango', apelidos: ['frango inteiro'],                                price_per_kg: 12.90, price: 12.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pcs'],        preparos_comuns: ['inteiro', 'temperado'] },
  { id: 'almondega_frango',  name: 'Almôndega de Frango',  animal: 'frango', apelidos: ['almondega de frango'],                           price_per_kg: 25.90, price: 25.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct', 'pcs'], preparos_comuns: [] }
];

const SUINO = [
  { id: 'costelinha_porco', name: 'Costelinha de Porco', animal: 'suino', apelidos: ['costelinha', 'costelinha de porco'],                price_per_kg: 32.90, price: 32.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['grelha', 'inteiro'] },
  { id: 'pernil',           name: 'Pernil Suíno',        animal: 'suino', apelidos: ['pernil', 'pernil suino'],                          price_per_kg: 22.90, price: 22.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['fatiado', 'inteiro', 'desossado'] },
  { id: 'panceta_porco',    name: 'Panceta Suína',       animal: 'suino', apelidos: ['panceta suina'],                                   price_per_kg: 27.90, price: 27.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['fatiado', 'grelha'] },
  { id: 'linguica_porco',   name: 'Linguiça de Porco',   animal: 'suino', apelidos: ['linguica de porco', 'linguica fina', 'linguica', 'toscana'], price_per_kg: 19.90, price: 19.90, price_per_unit: null, unidades_aceitas: ['kg', 'g', 'pct'], preparos_comuns: ['grelha'] },
  { id: 'costela_gaucha',   name: 'Costela Gaúcha',      animal: 'suino', apelidos: ['costela gaucha', 'gaucha'],                        price_per_kg: 36.90, price: 36.90, price_per_unit: null, unidades_aceitas: ['kg', 'g'],               preparos_comuns: ['grelha', 'inteiro'] }
];

const PREPAROS = [
  { name: 'Inteiro', apelidos: ['inteiro', 'inteira', 'peca'] },
  { name: 'Fatiado', apelidos: ['fatiado', 'fatiar', 'cortado', 'fatias', 'fatiada'] },
  { name: 'Moído', apelidos: ['moido', 'moer', 'moida'] },
  { name: 'Moído 2x', apelidos: ['moido duas vezes', 'moer duas vezes', 'moido 2x', 'moido 2 vezes'] },
  { name: 'Em cubos', apelidos: ['cubo', 'cubos', 'em cubos', 'cubinhos'] },
  { name: 'Em bife', apelidos: ['bife', 'bifes', 'em bife'] },
  { name: 'Em tiras', apelidos: ['tiras', 'em tiras', 'tirinhas'] },
  { name: 'Picado', apelidos: ['picado', 'picadinho'] },
  { name: 'Temperado', apelidos: ['temperado', 'temperada', 'tempero', 'com tempero'] },
  { name: 'Sem gordura', apelidos: ['sem gordura', 'limpo', 'limpa'] },
  { name: 'Desossado', apelidos: ['desossado', 'desossada', 'sem osso'] },
  { name: 'Sem pele', apelidos: ['sem pele'] },
  { name: 'Passado na máquina', apelidos: ['passado na maquina', 'maquina'] },
  { name: 'Para grelha', apelidos: ['grelha', 'pra grelha', 'para grelha', 'churrasco'] },
  { name: 'Para strogonoff', apelidos: ['strogonoff', 'stroganoff', 'estrogonofe'] },
  { name: 'A passarinho', apelidos: ['passarinho', 'a passarinho'] }
];

const UPSELLS = [
  { name: 'Carvão 5kg', price: 18, apelidos: ['carvao', 'carvão'] },
  { name: 'Sal Grosso 1kg', price: 8, apelidos: ['sal', 'sal grosso'] },
  { name: 'Farofa Pronta', price: 10, apelidos: ['farofa'] },
  { name: 'Vinagrete', price: 8, apelidos: ['vinagrete'] },
  { name: 'Pão de Alho', price: 15, apelidos: ['pao de alho'] }
];

// ─── UNIT MAP ──────────────────────────────────────────────────

const UNIT_MAP = {
  // peso
  'kg': 'kg', 'kl': 'kg', 'quilo': 'kg', 'quilos': 'kg',
  'kilo': 'kg', 'kilos': 'kg', 'kgs': 'kg', 'kls': 'kg',
  'gramas': 'g', 'grama': 'g', 'grm': 'g', 'g': 'g',
  // valor
  'reais': 'BRL', 'real': 'BRL', 'r$': 'BRL',
  // contagem
  'pacote': 'pct', 'pacotes': 'pct', 'pct': 'pct',
  'peca': 'pcs', 'peça': 'pcs', 'pecas': 'pcs', 'peças': 'pcs', 'pcs': 'pcs',
  'bandeja': 'bnd', 'bandejas': 'bnd',
  'unidade': 'un', 'unidades': 'un', 'un': 'un'
};

// ─── CARDÁPIO CONSOLIDADO ──────────────────────────────────────

const DEFAULT_CARDAPIO = {
  cortes: [...BOVINOS, ...FRANGO, ...SUINO],
  preparos: PREPAROS,
  upsellsBebida: UPSELLS,
  upsellsSobremesa: []
};

module.exports = {
  BOVINOS,
  FRANGO,
  SUINO,
  PREPAROS,
  UPSELLS,
  UNIT_MAP,
  DEFAULT_CARDAPIO
};
