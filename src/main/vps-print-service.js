// src/main/vps-print-service.js
// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRAÇÃO COM O SERVIDOR VPS PARA IMPRESSÃO (Ana Food Print)
// ───────────────────────────────────────────────────────────────────────────────
// Este módulo envia jobs de impressão para o servidor VPS (api.anafood.vip),
// que os despacha via WebSocket para os agentes "Ana Food Print" instalados nas
// máquinas das lojas.
//
// Fluxo correto:
//   1. Bot finaliza pedido → handleFinishedOrder()
//   2. handleFinishedOrder → vpsPrintService.sendPrintJob(order, ...)
//   3. vpsPrintService → POST api.anafood.vip/api/print/queue (com Supabase JWT)
//   4. VPS backend → WebSocket dispatch para Ana Food Print agent
//   5. Ana Food Print agent → ESC/POS via USB/TCP/Serial → Impressora Térmica
//
// Fallback: se o VPS não estiver disponível ou não houver agente conectado,
// usa o print-service.js local (Electron nativo via OS driver).
// ═══════════════════════════════════════════════════════════════════════════════

const axios = require('axios');

const VPS_API_BASE = 'https://api.anafood.vip';

/**
 * Formata um pedido do chatbot em texto ESC/POS para impressão térmica.
 * Compatible com o formato esperado pelo Ana Food Print e pelo servidor VPS.
 */
function formatReceiptText(order, company, customerName) {
  const lines = [];
  const dateStr = new Date().toLocaleString('pt-BR');

  const sep = '--------------------------------';
  const sepDouble = '================================';

  // Cabeçalho
  lines.push(sepDouble);
  lines.push(`<C><B>${(company.fantasy_name || company.name || 'Ana Food').toUpperCase()}</B></C>`);
  if (company.address) lines.push(`<C>${company.address}</C>`);
  if (company.whatsapp || company.phone) lines.push(`<C>${company.whatsapp || company.phone}</C>`);
  lines.push(sepDouble);

  // Dados do pedido
  lines.push(`Data: ${dateStr}`);
  lines.push(`Cliente: ${customerName || 'Cliente'}`);
  lines.push(`Tel: ${order.phone || ''}`);
  lines.push(`Tipo: ${order.type === 'delivery' ? 'ENTREGA' : 'RETIRADA'}`);
  if (order.type === 'delivery' && order.address) {
    lines.push(`Endereço: ${order.address}`);
  }
  lines.push(sep);

  // Itens
  lines.push('<B>ITENS DO PEDIDO</B>');
  lines.push(sep);

  let subtotal = 0;
  for (const item of (order.items || [])) {
    if (item.tipo === 'marmita') {
      const preco = item.price || (item.tamanho === 'Grande' ? 22 : 20);
      const qty = item.quantity || 1;
      subtotal += preco * qty;
      lines.push(`<B>${qty}x Marmita ${item.tamanho}</B> - R$ ${(preco * qty).toFixed(2)}`);
      const proteinas = (item.proteinas || []).map(p => p.name || p).join(', ');
      const acomps = (item.acompanhamentos || []).map(a => a.name || a).join(', ');
      const saladas = (item.saladas || []).map(s => s.name || s).join(', ');
      if (proteinas) lines.push(`  Proteinas: ${proteinas}`);
      if (acomps) lines.push(`  Acomp: ${acomps}`);
      if (saladas) lines.push(`  Salada: ${saladas}`);
    } else {
      const preco = item.price || 0;
      const qty = item.quantity || 1;
      subtotal += preco * qty;
      lines.push(`${qty}x ${item.name} - R$ ${(preco * qty).toFixed(2)}`);
    }
  }

  lines.push(sep);

  // Totais
  const taxaEntrega = order.type === 'delivery' ? (order.deliveryFee || 0) : 0;
  const total = subtotal + taxaEntrega;
  lines.push(`Subtotal: R$ ${subtotal.toFixed(2)}`);
  if (taxaEntrega > 0) lines.push(`Taxa Entrega: R$ ${taxaEntrega.toFixed(2)}`);
  lines.push(`<B>TOTAL: R$ ${total.toFixed(2)}</B>`);
  lines.push(sep);

  // Pagamento
  lines.push(`Pagamento: ${order.paymentMethod || 'Pix'}`);
  if (order.trocoPara) {
    lines.push(`Troco para: R$ ${parseFloat(order.trocoPara).toFixed(2)}`);
    const troco = parseFloat(order.trocoPara) - total;
    if (troco > 0) lines.push(`Troco a devolver: R$ ${troco.toFixed(2)}`);
  }
  lines.push(sep);

  // Rodapé
  lines.push('<C>Obrigado pela preferência!</C>');
  lines.push('<C>Ana Food Delivery</C>');
  lines.push(sepDouble);

  return lines.join('\n');
}

/**
 * Envia um job de impressão para o servidor VPS (api.anafood.vip).
 * O servidor despacha via WebSocket para o agente Ana Food Print conectado.
 *
 * @param {object} order - Dados do pedido
 * @param {object} company - Dados da empresa
 * @param {string} customerName - Nome do cliente
 * @param {string} supabaseJwt - Token JWT do Supabase para autenticação
 * @param {string} companyId - ID da empresa (tenant)
 * @returns {Promise<{success: boolean, jobId?: string, error?: string}>}
 */
async function sendPrintJob(order, company, customerName, supabaseJwt, companyId) {
  if (!supabaseJwt && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[VpsPrint] Sem token de autenticação — impressão VPS ignorada');
    return { success: false, error: 'Sem token de autenticação' };
  }

  const authToken = supabaseJwt || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const receiptText = formatReceiptText(order, company, customerName);

  const payload = {
    sector: 'caixa', // Setor padrão: caixa (pode ser configurável futuramente)
    payload: {
      text: receiptText,
      format: 'marked_text', // Formato com marcadores <B>, <C>, etc.
      order: {
        id: order.orderId,
        customerName,
        customerPhone: order.phone,
        type: order.type,
        address: order.address,
        total: order.total,
        paymentMethod: order.paymentMethod,
        items: order.items
      }
    },
    copies: 1
  };

  try {
    const response = await axios.post(
      `${VPS_API_BASE}/api/print/queue`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'X-Company-Id': companyId || ''
        },
        timeout: 10000 // 10s timeout
      }
    );

    console.log('[VpsPrint] Job de impressão enviado ao VPS com sucesso:', response.data);
    return { success: true, jobId: response.data?.jobId || response.data?.id };
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.message || err.message;
    console.error(`[VpsPrint] Falha ao enviar job ao VPS (${status || 'sem resposta'}): ${message}`);
    return { success: false, error: message, status };
  }
}

/**
 * Verifica se há agentes de impressão conectados ao VPS para esta empresa.
 * @param {string} authToken - Token de autenticação
 * @param {string} companyId - ID da empresa
 * @returns {Promise<{connected: boolean, devices: Array}>}
 */
async function checkPrintAgentStatus(authToken, companyId) {
  if (!authToken) return { connected: false, devices: [] };

  try {
    const response = await axios.get(
      `${VPS_API_BASE}/api/print/devices`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'X-Company-Id': companyId || ''
        },
        timeout: 5000
      }
    );

    const devices = response.data || [];
    const onlineDevices = devices.filter(d => d.status === 'online');
    return {
      connected: onlineDevices.length > 0,
      devices,
      onlineCount: onlineDevices.length
    };
  } catch (err) {
    return { connected: false, devices: [], error: err.message };
  }
}

module.exports = {
  sendPrintJob,
  checkPrintAgentStatus,
  formatReceiptText,
  VPS_API_BASE
};
