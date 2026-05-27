// plugins/acougue/templates.js
// ═══════════════════════════════════════════════════════════════
// Templates de mensagem para o açougue — Sessão B
// ═══════════════════════════════════════════════════════════════

const T = require('../../templates');

// ─── SAUDAÇÃO ──────────────────────────────────────────────────

function saudacao(companyName) {
  return [
    `Olá! Bem-vindo ao *${companyName}*! 🥩`,
    `O que vai querer hoje? Pode mandar tudo de uma vez!\n_(Ex: "2 kg de alcatra em bife + 1 kg de patinho moído")_`
  ];
}

function saudacaoCliente(nome, companyName) {
  return [
    `Olá, *${nome}*! Bem-vindo de volta ao *${companyName}*! 🥩`,
    `O que vai levar hoje? Manda o pedido completo! 😊`
  ];
}

function abertura() {
  return `Pode mandar seu pedido! 🥩\n_(Ex: "2 kg de alcatra em bife + 1 kg de patinho moído")_`;
}

// ─── ERROS E AVISOS ────────────────────────────────────────────

function pedidoNaoEntendido() {
  return `Não encontrei nenhum corte no seu pedido. 🤔\nPode repetir? Exemplo:\n_"1 kg de picanha fatiada + 2 kg de patinho moído"_`;
}

function avisoPrecoVariavel() {
  return `⚠️ O preço final pode variar conforme o peso exato na balança.`;
}

function corteNaoEncontrado(texto) {
  return `Não encontrei "${texto}" no nosso cardápio. 🤔\nPode verificar o nome do corte?`;
}

function quantidadeInvalida() {
  return `A quantidade informada não é válida. Pode repetir?\n_(Ex: "2 kg", "500g", "R$ 30")_`;
}

// ─── FORMATAÇÃO ────────────────────────────────────────────────

function formatQuantity(qty) {
  if (!qty) return '1 kg';
  if (qty.unit === 'BRL') return `R$ ${T.fmt(qty.value)} de`;
  if (qty.unit === 'pct') return `${qty.value} pacote(s) de`;
  if (qty.unit === 'un' || qty.unit === 'pcs' || qty.unit === 'bnd') return `${qty.value}x`;
  // kg
  return `${qty.value} kg`;
}

function resumoItem(item) {
  if (!item) return '';
  if (item.tipo !== 'corte' && item.tipo !== 'carne') {
    return `• ${item.quantity || 1}x ${item.name} — R$ ${T.fmt(item.price * (item.quantity || 1))}`;
  }

  const qtyStr = formatQuantity(item.quantity);
  let txt = `🥩 ${qtyStr} *${item.name || item.produto}*`;

  if (item.preparation) {
    let prepStr = item.preparation.style;
    if (item.preparation.times) prepStr += ` ${item.preparation.times}x`;
    if (item.preparation.thickness) prepStr += ` (${item.preparation.thickness})`;
    if (item.preparation.extra) prepStr += `, ${item.preparation.extra}`;
    txt += ` — ${prepStr}`;
  }

  if (item.packaging && item.packaging.divide) {
    let pkgStr = '\n   📦 Embalagem:';
    if (item.packaging.packages_count) pkgStr += ` ${item.packaging.packages_count} pacotes`;
    if (item.packaging.package_size) pkgStr += ` de ${item.packaging.package_size}`;
    txt += pkgStr;
  }

  txt += `\n   Est.: R$ ${T.fmt(item.estimated_price || item.price || 0)}`;

  return txt;
}

/**
 * Backward-compat wrapper: delegates to resumoItem for cortes,
 * keeps old format for extras.
 */
function formatItemForSummary(item) {
  if (!item) return '';
  if (item.tipo !== 'corte' && item.tipo !== 'carne') {
    return `• ${item.quantity || 1}x ${item.name} — R$ ${T.fmt(item.price * (item.quantity || 1))}`;
  }

  const qtyStr = formatQuantity(item.quantity);
  let txt = `🥩 *${item.name}* — ${qtyStr}\n`;
  txt += `   R$ ${T.fmt(item.estimated_price || item.price)}`;

  if (item.preparation) {
    let prepStr = item.preparation.style;
    if (item.preparation.times) prepStr += ` ${item.preparation.times}x`;
    txt += ` (${prepStr})`;
  }

  return txt;
}

// ─── RESUMO DE PEDIDO ──────────────────────────────────────────

/**
 * resumoPedido — backward compatible.
 * Old: resumoPedido(items, totalEstimado)
 * New: resumoPedido(items, deliveryFee, paymentMethod, address, type)
 */
function resumoPedido(items, deliveryFeeOrTotal, paymentMethod, address, type) {
  if (paymentMethod === undefined && address === undefined && type === undefined) {
    return _resumoPedidoSimples(items, deliveryFeeOrTotal);
  }
  return _resumoPedidoCompleto(items, deliveryFeeOrTotal, paymentMethod, address, type);
}

function _resumoPedidoSimples(items, totalEstimado) {
  let msg = `📋 *SEU PEDIDO*\n\n`;

  for (const item of items) {
    const qtyStr = formatQuantity(item.quantity);
    msg += `🥩 ${qtyStr} *${item.name}*`;

    if (item.preparation) {
      let prepStr = item.preparation.style;
      if (item.preparation.times) prepStr += ` ${item.preparation.times}x`;
      if (item.preparation.extra) prepStr += `, ${item.preparation.extra}`;
      msg += ` — ${prepStr}`;
    }
    msg += `\n`;

    if (item.packaging && item.packaging.divide) {
      let pkgStr = '   Embalagem:';
      if (item.packaging.packages_count) pkgStr += ` ${item.packaging.packages_count} pacotes`;
      if (item.packaging.package_size) pkgStr += ` de ${item.packaging.package_size}`;
      msg += `${pkgStr}\n`;
    }

    msg += `   Est.: R$ ${T.fmt(item.estimated_price)}\n\n`;
  }

  msg += `━━━━━━━━━━━━━━\n`;
  msg += `💰 *Total estimado: R$ ${T.fmt(totalEstimado)}*\n`;
  msg += `⚠️ Preço final pode variar conforme peso exato na balança\n`;

  return msg;
}

function _resumoPedidoCompleto(items, deliveryFee, paymentMethod, address, type) {
  let msg = `📋 *SEU PEDIDO*\n\n`;

  let subtotal = 0;
  for (const item of items) {
    msg += resumoItem(item) + `\n\n`;
    subtotal += (item.estimated_price || item.price || 0);
  }

  msg += `━━━━━━━━━━━━━━\n`;

  if (type === 'entrega' && address) {
    msg += `📍 *Entrega:* ${address}\n`;
    if (deliveryFee) {
      msg += `🚗 Taxa: R$ ${T.fmt(deliveryFee)}\n`;
      subtotal += deliveryFee;
    }
  } else if (type === 'retirada') {
    msg += `🏪 *Retirada no balcão*\n`;
  }

  if (paymentMethod) {
    msg += `💳 *Pagamento:* ${paymentMethod}\n`;
  }

  msg += `\n💰 *Total: R$ ${T.fmt(subtotal)}*\n`;
  msg += `⚠️ Preço final pode variar conforme peso exato na balança\n`;

  return msg;
}

// ─── REVISÃO E UPSELL ──────────────────────────────────────────

function confirmarRevisao() {
  return `Está correto? _(sim / não / corrigir)_`;
}

function pedidoCorrigir() {
  return `Ok! O que quer mudar? Pode dizer:\n• _"trocar patinho por alcatra"_\n• _"tirar o último item"_\n• _"adicionar 1 kg de fraldinha"_\n\nOu mande o pedido todo de novo.`;
}

function upsellAcougue(upsells) {
  const list = upsells.map(u => `• ${u.name} (R$ ${T.fmt(u.price)})`).join('\n');
  return `Quer adicionar algo para o churrasco? 🔥\n${list}\n_(ou "não")_`;
}

// ─── TIPO / ENTREGA ────────────────────────────────────────────

function perguntarTipo(resumoCurto) {
  return [
    `Pedido montado! 🥩\n${resumoCurto || ''}`,
    `Vai ser *Entrega* ou *Retirada* no balcão?`
  ];
}

module.exports = {
  saudacao,
  saudacaoCliente,
  abertura,
  pedidoNaoEntendido,
  avisoPrecoVariavel,
  corteNaoEncontrado,
  quantidadeInvalida,
  resumoPedido,
  resumoItem,
  confirmarRevisao,
  pedidoCorrigir,
  upsellAcougue,
  formatQuantity,
  formatItemForSummary,
  perguntarTipo
};
