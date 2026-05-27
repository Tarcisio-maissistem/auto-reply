// src/templates.js
// ═══════════════════════════════════════════════════════════════
// Templates para o Agente Marmitaria — Respostas Curtas e Diretas
// ═══════════════════════════════════════════════════════════════

// ─── HELPER: FORMATAR PREÇO ──────────────────────────────────────────────────
function fmt(val) {
  return Number(val || 0).toFixed(2).replace('.', ',');
}

// ─── HELPER: AGRUPAR MARMITAS IDÊNTICAS ───────────────────────────────────────
function _marmitasIdenticas(a, b) {
  if (a.tipo !== 'marmita' || b.tipo !== 'marmita') return false;
  if (a.tamanho !== b.tamanho) return false;
  if (a.price !== b.price) return false;

  const protA = (a.proteinas || []).map(p => p.name).sort().join(',');
  const protB = (b.proteinas || []).map(p => p.name).sort().join(',');
  if (protA !== protB) return false;

  const acompA = (a.acompanhamentos || []).map(p => p.name).sort().join(',');
  const acompB = (b.acompanhamentos || []).map(p => p.name).sort().join(',');
  if (acompA !== acompB) return false;

  const salA = (a.saladas || []).map(p => p.name).sort().join(',');
  const salB = (b.saladas || []).map(p => p.name).sort().join(',');
  return salA === salB;
}

function agruparItensPedido(items) {
  const grupos = [];
  const vistos = new Set();

  for (let i = 0; i < items.length; i++) {
    if (vistos.has(i)) continue;
    const item = items[i];

    if (item.tipo !== 'marmita') {
      grupos.push({ ...item, _count: item.quantity || 1 });
      vistos.add(i);
      continue;
    }

    // Para marmitas: verificar se as próximas são idênticas
    let count = 1;
    for (let j = i + 1; j < items.length; j++) {
      if (vistos.has(j)) continue;
      if (_marmitasIdenticas(item, items[j])) {
        count++;
        vistos.add(j);
      }
    }

    grupos.push({ ...item, _count: count });
    vistos.add(i);
  }

  return grupos;
}

// ─── SAUDAÇÃO E TAMANHO ──────────────────────────────────────────────────────

function saudacaoTamanho(companyName) {
  return [
    `Olá! Seja bem-vindo à *${companyName}*! 👋`,
    `Temos marmitas:\n• *Pequena* — *R$ 20,00*\n• *Grande* — *R$ 22,00*\n\nQual tamanho você prefere?`
  ];
}

function saudacaoTamanhoCliente(nome, companyName) {
  return [
    `Olá, *${nome}*! Bem-vindo de volta à *${companyName}*! 👋`,
    `Temos marmitas:\n• *Pequena* — *R$ 20,00*\n• *Grande* — *R$ 22,00*\n\nQual você vai querer hoje?`
  ];
}

function saudacaoActiveOrder(nome, activeOrder) {
  const isDelivery = activeOrder.type === 'delivery';
  const statusMsg = isDelivery ? 'logo será entregue 🛵' : 'logo estará pronto para retirada 🏠';
  return [
    `Olá, *${nome}*! O seu pedido anterior já está em produção e ${statusMsg}!`,
    `Caso queira fazer um *NOVO* pedido, pode me passar o tamanho: *Pequena* ou *Grande*?`
  ];
}

function tamanhoNaoEntendido() {
  return `Não entendi o tamanho. Temos marmita *Pequena* ou *Grande*. Qual você prefere? 😊`;
}

// ─── MONTAGEM DA MARMITA ──────────────────────────────────────────────────────

function pedirProteina(qteMarmitas = 1, proteinas = null) {
  const prefixo = qteMarmitas > 1 ? `Vamos montar a primeira 👇\n\n` : `Perfeito 👍\n\n`;
  if (proteinas && proteinas.length > 0) {
    const lista = proteinas.map(p => `• ${p.name}`).join('\n');
    return `${prefixo}Escolha até *2 proteínas*:\n${lista}`;
  }
  return `${prefixo}Escolha até *2 proteínas*:\n🍗 Frango\n🥩 Churrasco\n🍖 Costela\n🌭 Linguiça\n🍖 Carne Cozida`;
}

function proteinaNaoEntendida() {
  return `Opção inválida. Escolha até *2 proteínas* entre: Frango, Churrasco, Costela, Linguiça ou Carne Cozida.`;
}

function pedirAcompanhamento() {
  return [
    `Ótima combinação 😋`,
    `Agora escolha até *2 acompanhamentos*:\n🍚 Arroz\n🍲 Feijão\n🍝 Macarrão\n🥔 Purê\n🥓 Tropeiro`
  ];
}

function pedirAcompanhamentoESalada() {
  return `🍚 Acompanhamento: Arroz, Feijão, Macarrão, Purê ou Tropeiro\n🥗 Salada: Maionese, Beterraba, Alface, Repolho ou Pepino`;
}

function acompanhamentoNaoEntendido() {
  return `Por favor, escolha entre: Arroz, Feijão, Macarrão, Purê ou Tropeiro.`;
}

function pedirSalada(saladas = null) {
  if (saladas && saladas.length > 0) {
    const lista = saladas.map(s => `• ${s.name}`).join('\n');
    return `Quer adicionar salada? _(até 2 — pode pular)_\n${lista}`;
  }
  return `Quer adicionar salada? _(até 2 — pode pular)_\n🥗 Maionese\n🥗 Beterraba\n🥗 Alface\n🥗 Repolho\n🥒 Pepino`;
}

function saladaNaoEntendida() {
  return `Por favor, escolha entre: Maionese, Beterraba, Alface, Repolho ou Pepino.`;
}

// ─── UPSELL E RESUMOS PARCIAIS ────────────────────────────────────────────────

function oferecerUpsellBebida(marmitaResumo) {
  return [
    marmitaResumo,
    `Bebida? *Suco Natural* R$ 8,00 ou *Refrigerante Lata* R$ 6,00 🥤`
  ];
}

function oferecerUpsellSobremesa(marmitaResumo) {
  return [
    marmitaResumo,
    `Sobremesa? *Pudim* ou *Mousse* R$ 6,00 🍮`
  ];
}

function perguntarProximaMarmita() {
  return `Marmita anotada! ✅\n\nVamos montar a próxima? Escolha *2 proteínas* para ela:`;
}

// ─── TIPO (ENTREGA/RETIRADA) ──────────────────────────────────────────────────

function perguntarTipo(itemsOuResumo) {
  let resumo;
  if (Array.isArray(itemsOuResumo)) {
    // Usa agrupamento para mostrar marmitas idênticas juntas
    resumo = _formatarItensPedido(itemsOuResumo);
  } else {
    resumo = itemsOuResumo;
  }
  return [
    `Pedido montado 🍱\n${resumo}`,
    `Vai ser *Entrega* ou *Retirada* no balcão?`
  ];
}

function tipoNaoIdentificado() {
  return `Por favor, escolha:\n1️⃣ Entrega\n2️⃣ Retirada no balcão`;
}

// ─── ENDEREÇO E PAGAMENTO ─────────────────────────────────────────────────────

function pedirEndereco() {
  return `Me passa o endereço de entrega! Rua, número e bairro 😊`;
}

function confirmarEndereco(endereco, taxa) {
  return [
    `Entrega para:\n*${endereco}*`,
    `Taxa de entrega: *R$ ${fmt(taxa)}*\n\nEstá correto?`
  ];
}

function resumoEnderecoTaxa(endereco, taxa) {
  return `Entrega para:\n*${endereco}*\nTaxa de entrega: *R$ ${fmt(taxa)}*`;
}

function pedirPagamento(formasAceitas) {
  return `Perfeito. Vai ser no *Pix, Cartão ou Dinheiro*?`;
}

function pagamentoComTroco(total) {
  if (total != null) {
    const totalFmt = fmt(total);
    return `Total do pedido: *R$ ${totalFmt}*\n\nVai precisar de troco? Se sim: "troco pra 50"\nSe não: "sem troco"`;
  }
  return `Total R$ ${fmt(total)}. Precisa de troco?`;
}

// ─── RESUMO FINAL E CONFIRMAÇÃO ────────────────────────────────────────────────

// Formata uma marmita (com _count de agrupamento ou quantity)
function _formatarMarmita(m) {
  const count = m._count || m.quantity || 1;
  const prefixo = count > 1 ? `${count}x ` : '';
  const precoLinha = fmt(m.price * count);
  let txt = `🍱 ${prefixo}*Marmita ${m.tamanho}* — R$ ${precoLinha}\n`;
  if (m.proteinas?.length) txt += `   🥩 ${m.proteinas.map(p => p.name).join(' + ')}\n`;
  if (m.acompanhamentos?.length) txt += `   🍚 ${m.acompanhamentos.map(a => a.name).join(' + ')}\n`;
  if (m.saladas?.length) txt += `   🥗 ${m.saladas.map(s => s.name).join(' + ')}\n`;
  return txt.trim();
}

function _formatarItensPedido(items) {
  // Agrupa marmitas idênticas antes de formatar
  const grupos = agruparItensPedido(items);
  
  return grupos.map(item => {
    if (item.tipo === 'marmita') {
      return _formatarMarmita(item);
    } else {
      // Bebidas, Sobremesas, Extras (Upsells)
      const qty = item._count || item.quantity || 1;
      return `• ${qty}x ${item.name} — R$ ${fmt(item.price * qty)}`;
    }
  }).join('\n\n');
}

function confirmacaoFinal({ items, type, address, deliveryFee, paymentMethod, estimatedTime, trocoPara }) {
  const itensFmt = _formatarItensPedido(items);
  const total = calcTotal(items, deliveryFee);

  let msg = `📋 *RESUMO FINAL*\n\n${itensFmt}\n`;

  if (type === 'delivery') {
    msg += `\n🛵 *Entrega*`;
    msg += `\nEndereço: ${address}`;
    msg += `\nTaxa: R$ ${fmt(deliveryFee)}`;
  } else {
    msg += `\n🏠 *Retirada no balcão*`;
  }

  msg += `\n💳 Pagamento: ${paymentMethod}`;
  if (trocoPara) msg += ` (Troco para R$ ${fmt(trocoPara)})`;

  msg += `\n⏱ Tempo estimado: ${estimatedTime} minutos`;
  msg += `\n\n*Total: R$ ${fmt(total)}*`;

  return [
    msg,
    `Posso confirmar? 👨‍🍳`
  ];
}

// ─── PÓS-CONFIRMAÇÃO ──────────────────────────────────────────────────────────

function pedidoConfirmadoPix(total, chavePix) {
  return [
    `Total R$ ${fmt(total)}. Vou enviar a chave Pix.`,
    `${chavePix}`,
    `Assim que confirmar o pagamento, já colocamos na rota 🚀`
  ];
}

function pedidoConfirmado(nome, orderId, expectedTime, type) {
  const base = type === 'delivery'
    ? `Pedido já está em preparo e sai em até ${expectedTime} minutos. 🚀`
    : `Seu pedido ficará pronto na loja em aproximadamente ${expectedTime} minutos 👍`;

  return `✅ *Pedido confirmado!*\n\n${base}\n\nQualquer dúvida, é só me chamar. 😊`;
}

function pedidoCancelado() {
  return `Ok! Pedido cancelado.\nSe quiser fazer um novo pedido, é só me chamar. 😊`;
}

// ─── ERROS E INATIVIDADE ──────────────────────────────────────────────────────

function inputInvalido() {
  return `Não entendi. Pode responder novamente usando texto simples? 😊`;
}

function erroComunicacao() {
  return `Deu uma travadinha aqui no meu sistema 😅 Pode tentar mandar a mensagem de novo?`;
}

function cancelarPorInatividade() {
  return `Como passou um tempinho, cancelei a montagem do pedido. Quando quiser pedir, é só me chamar de novo! 🍱`;
}

function lembrete() {
  return `Oi! Ainda está por aí? Seu pedido está esperando 😊\nSe quiser continuar, é só responder!`;
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

function faqHorario(horario) {
  return `Sim 😊\nEstamos abertos ${horario}.`;
}

function faqLocalizacao(endereco) {
  return `Estamos na ${endereco} 😊`;
}

function faqCartao() {
  return `Sim 😊 Aceitamos débito e crédito na entrega.`;
}

function faqTaxa(taxa) {
  return `A nossa taxa de entrega padrão é de R$ ${fmt(taxa)} para a sua região. 😊`;
}

function faqPix() {
  return `Sim, aceitamos Pix! Facilitamos tudo para você. 😊`;
}

// ─── CONTEXTO FAQ (retomada de etapa) ──────────────────────────────────────────

function contextoEtapa(etapa) {
  const mapa = {
    'MONTANDO_TAMANHO': 'Qual tamanho prefere?',
    'MONTANDO_PROTEINA': 'Voltando ao pedido: quais as proteínas?',
    'MONTANDO_ACOMPANHAMENTO': 'E os acompanhamentos?',
    'MONTANDO_SALADA': 'E as saladas? _(pode pular)_',
    'OFERECENDO_UPSELL': 'Quer adicionar bebida ou sobremesa?',
    'AGUARDANDO_TIPO': 'Vai ser entrega ou retirada?',
    'AGUARDANDO_ENDERECO': 'Qual o endereço para entrega?',
    'AGUARDANDO_PAGAMENTO': 'Qual a forma de pagamento?',
    'CONFIRMANDO': 'Confirma o pedido? (sim/não)'
  };
  return mapa[etapa] || '';
}

// ─── ENDEREÇO E PAGAMENTO (frases avulsas) ────────────────────────────────────

function pedirEnderecoCorrecao() {
  return `Pode mandar rua, número e bairro por favor?`;
}

function confirmarEnderecoSimNao() {
  return `Está correto o endereço acima? Responda sim ou não.`;
}

function enderecoNegado() {
  return `Combinado. Qual o endereço correto?`;
}

function pagamentoNaoEntendido() {
  return `Vai ser no Pix, Cartão ou Dinheiro?`;
}

function pedirTroco() {
  return 'Pode digitar o valor para o troco ou "não" se for o valor exato.';
}

// ─── PÓS-FLUXO ───────────────────────────────────────────────────────────────

function pedidoJaFinalizado() {
  return `Seu pedido já foi gerado! Chame de novo se quiser outro 😊`;
}

/**
 * Resposta sobre tempo de entrega (delivery)
 * @param {number} tempoEstimado - Tempo estimado em minutos
 */
function tempoEntregaDelivery(tempoEstimado) {
  return `Seu pedido está sendo preparado! 🍳\nTempo estimado de entrega: *${tempoEstimado} minutos*.\n\nQualquer dúvida, estou aqui! 😊`;
}

/**
 * Resposta sobre retirada (pickup)
 * @param {number} tempoEstimado - Tempo estimado em minutos
 */
function tempoRetiradaPickup(tempoEstimado) {
  return `Seu pedido está sendo preparado! 🍳\nEm aproximadamente *${tempoEstimado} minutos* você já pode retirar.\n\nNosso endereço: te espero aqui! 😊`;
}

/**
 * Confirmação de cancelamento para refazer com alterações
 */
function confirmarAlteracaoPosPedido() {
  return `Entendi! Para alterar itens do pedido já confirmado, preciso *cancelar o atual* e fazer um novo.\n\nDeseja cancelar e refazer o pedido? (sim/não)`;
}

/**
 * Pedido cancelado para refazer
 */
function pedidoCanceladoParaRefazer() {
  return `Pedido anterior cancelado! Vamos montar o novo 😊\n\nQual o tamanho da marmita? *Pequena* ou *Grande*?`;
}

/**
 * Resposta genérica pós-pedido
 */
function respostaPosPedido() {
  return `Seu pedido já está em andamento! 🚀\n\nSe precisar de algo, pode perguntar:\n• "quanto tempo falta?"\n• "posso trocar um item?"\n• "quero fazer outro pedido"`;
}

function proximaMarmita() {
  return `Marmita anotada! Qual vai ser o tamanho da sua próxima marmita? (Pequena/Grande)`;
}

function itensIndisponiveisNovoPedido() {
  return `Alguns itens do seu pedido anterior não estão mais disponíveis. Vamos montar um novo? 😊\n\nQual tamanho: *Pequena* ou *Grande*?`;
}

function modificacaoAceita() {
  return `Com certeza! Já fiz a alteração para você. 😊`;
}

function resumoRepetirPedido(itemsFormatados) {
  return `Perfeito! A de ontem foi:\n${itemsFormatados}`;
}

// ─── PREFERÊNCIAS / SUGESTÃO PROATIVA ─────────────────────────────────────────

function sugestaoRepetirTudo(nome, items, endereco, pagamento) {
  let msg = `Olá, *${nome}*! Bem-vindo de volta! 👋\n\nDa última vez:\n`;
  msg += _formatarItensPedido(items);
  if (endereco) msg += `\n🛵 Entrega: ${endereco}`;
  msg += `\n💳 ${pagamento}`;
  msg += `\n\n*Quer repetir tudo?* _(sim / não)_`;
  return msg;
}

function enderecosSalvos(enderecos) {
  let msg = `📍 Endereços salvos:\n`;
  enderecos.forEach((a, i) => {
    msg += `${i + 1}️⃣ ${a.address}\n`;
  });
  msg += `\nResponda o *número* ou mande um *novo endereço*.`;
  return msg;
}

function confirmarEnderecoSelecionado(endereco, taxa) {
  return `Entrega para: *${endereco}*\nTaxa: R$ ${fmt(taxa)}`;
}

function sugerirPagamentoFavorito(metodo) {
  return `Vai ser no *${metodo}* como da última vez? 😊\n_(ou escolha: Pix, Cartão, Dinheiro)_`;
}

function itemMontado() {
  return `🍱 *Marmita montada!*`;
}

// ─── BOOTSTRAP CONTEXT — SAUDAÇÕES INTELIGENTES ──────────────────────────────

/**
 * Saudação para cliente recorrente COM histórico de pedido.
 * Oferece repetir o último pedido.
 */
function saudacaoReturningComHistorico(nome, ultimoPedidoFormatado) {
  return [
    `Olá, *${nome}*! 👋`,
    `Quer repetir seu último pedido?\n\n${ultimoPedidoFormatado}\n\n_Responda *sim* para repetir ou me diga o que deseja hoje!_`
  ];
}

/**
 * Saudação para cliente recorrente SEM histórico de pedido.
 */
function saudacaoReturningSemHistorico(nome, companyName) {
  return [
    `Olá, *${nome}*! Bem-vindo de volta à *${companyName}*! 👋`,
    `Temos marmitas:\n• *Pequena* — *R$ 20,00*\n• *Grande* — *R$ 22,00*\n\nQual você vai querer hoje?`
  ];
}

/**
 * Saudação para cliente NOVO com nome detectado.
 * Mostra top produtos.
 */
function saudacaoNovoClienteComNome(nome, companyName, topProductsFormatted) {
  return [
    `Olá, *${nome}*! Seja bem-vindo à *${companyName}*! 🎉`,
    `Aqui estão alguns dos nossos mais pedidos 👇\n\n${topProductsFormatted}\n\n_Se quiser ver o cardápio completo, me avisa! Ou já me diz o que deseja 😊_`
  ];
}

/**
 * Saudação para cliente NOVO sem nome detectado.
 * Mostra top produtos e tenta ser amigável.
 */
function saudacaoNovoClienteSemNome(companyName, topProductsFormatted) {
  return [
    `Olá! Seja bem-vindo à *${companyName}*! 🎉`,
    `Aqui estão alguns dos nossos mais pedidos 👇\n\n${topProductsFormatted}\n\n_Se quiser ver o cardápio completo, me avisa! Ou já me diz o que deseja 😊_`
  ];
}

// ─── CÁLCULOS ─────────────────────────────────────────────────────────────────

function calcTotal(items, deliveryFee = 0) {
  const sub = items.reduce((acc, item) => {
    // Usa base_price se existir (à prova de futuro); senão usa price
    const unitPrice = Number(item.base_price || item.price || 0);
    const qty = item.quantity || 1;
    // Sub-extras do item (add-ons): multiplica por quantity de cada extra
    const extrasTotal = (item.extras || []).reduce(
      (s, e) => s + Number(e.price || 0) * (e.quantity || 1),
      0
    );
    return acc + ((unitPrice + extrasTotal) * qty);
  }, 0);
  return sub + Number(deliveryFee);
}

module.exports = {
  // Inicial
  saudacaoTamanho,
  saudacaoTamanhoCliente,
  tamanhoNaoEntendido,
  // Montagem
  pedirProteina,
  proteinaNaoEntendida,
  pedirAcompanhamento,
  pedirAcompanhamentoESalada,
  acompanhamentoNaoEntendido,
  pedirSalada,
  saladaNaoEntendida,
  // Upsell
  oferecerUpsellBebida,
  oferecerUpsellSobremesa,
  perguntarProximaMarmita,
  // Tipo e Endereço
  perguntarTipo,
  tipoNaoIdentificado,
  pedirEndereco,
  confirmarEndereco,
  resumoEnderecoTaxa,
  // Pagamento
  pedirPagamento,
  pagamentoComTroco,
  // Confirmação
  confirmacaoFinal,
  pedidoConfirmado,
  pedidoConfirmadoPix,
  pedidoCancelado,
  // Helpers format / calculos
  _formatarMarmita,
  _formatarItensPedido,
  agruparItensPedido,
  calcTotal,
  fmt,
  // Genericos
  inputInvalido,
  erroComunicacao,
  cancelarPorInatividade,
  lembrete,
  // FAQ
  faqHorario,
  faqLocalizacao,
  faqCartao,
  faqTaxa,
  faqPix,
  contextoEtapa,
  // Endereço/Pagamento avulsos
  pedirEnderecoCorrecao,
  confirmarEnderecoSimNao,
  enderecoNegado,
  pagamentoNaoEntendido,
  pedirTroco,
  // Pós-fluxo
  pedidoJaFinalizado,
  tempoEntregaDelivery,
  tempoRetiradaPickup,
  confirmarAlteracaoPosPedido,
  pedidoCanceladoParaRefazer,
  respostaPosPedido,
  proximaMarmita,
  itensIndisponiveisNovoPedido,
  modificacaoAceita,
  resumoRepetirPedido,
  // Preferências / sugestão proativa
  sugestaoRepetirTudo,
  enderecosSalvos,
  confirmarEnderecoSelecionado,
  sugerirPagamentoFavorito,
  itemMontado,
  // Bootstrap Context — Saudações inteligentes
  saudacaoReturningComHistorico,
  saudacaoReturningSemHistorico,
  saudacaoNovoClienteComNome,
  saudacaoNovoClienteSemNome,
  saudacaoActiveOrder,
  // Helpers format (expostos para plugins)
  _formatarItensPedido
};
