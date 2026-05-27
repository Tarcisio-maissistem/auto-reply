// src/main/print-service.js
// ═════════════════════════════════════════════════════════════════
// SERVIÇO DE IMPRESSÃO TÉRMICA SILENCIOSA (ELECTRON NATIVO)
// ═════════════════════════════════════════════════════════════════

const { BrowserWindow } = require('electron');

/**
 * Gera o layout HTML formatado para impressora térmica de bobina (58mm/80mm).
 */
function generateReceiptHtml(order, company, clientName) {
  const dateStr = new Date().toLocaleString('pt-BR');
  
  // Calcular totais
  let subtotal = 0;
  const itemsList = order.items.map(item => {
    if (item.tipo === 'marmita') {
      const preco = item.price || (item.tamanho === 'Grande' ? 22 : 20);
      subtotal += preco * (item.quantity || 1);
      
      const proteinas = (item.proteinas || []).map(p => p.name || p.produto || p.product).join(', ');
      const acomps = (item.acompanhamentos || []).map(a => a.name || a.produto || a.product).join(', ');
      const saladas = (item.saladas || []).map(s => s.name || s.produto || s.product).join(', ');
      
      return `
        <div class="item">
          <b>${item.quantity || 1}x Marmita ${item.tamanho}</b> - R$ ${preco.toFixed(2)}
          ${proteinas ? `<div class="sub-item">🥩 Proteínas: ${proteinas}</div>` : ''}
          ${acomps ? `<div class="sub-item">🍚 Acompanhamentos: ${acomps}</div>` : ''}
          ${saladas ? `<div class="sub-item">🥗 Salada: ${saladas}</div>` : ''}
        </div>
      `;
    } else {
      const preco = item.price || 0;
      const qtd = item.quantity || 1;
      subtotal += preco * qtd;
      return `
        <div class="item">
          <b>${qtd}x ${item.name}</b> - R$ ${(preco * qtd).toFixed(2)}
        </div>
      `;
    }
  }).join('');

  const taxa = order.type === 'delivery' ? (order.deliveryFee || 5) : 0;
  const total = subtotal + taxa;
  const troco = order.paymentMethod === 'Dinheiro' && order.trocoPara ? (order.trocoPara - total) : 0;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: 'Courier New', Courier, monospace;
          font-size: 12px;
          margin: 0;
          padding: 5px;
          width: 280px; /* Largura padrão de impressoras térmicas */
          color: #000;
        }
        .text-center { text-align: center; }
        .bold { font-weight: bold; }
        .header { font-size: 16px; margin-bottom: 2px; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .item { margin-bottom: 8px; line-height: 1.2; }
        .sub-item { margin-left: 10px; font-size: 11px; color: #333; }
        .total-row { display: flex; justifyContent: space-between; font-size: 13px; margin: 3px 0; }
        .footer { font-size: 10px; margin-top: 15px; }
      </style>
    </head>
    <body>
      <div class="text-center bold header">${company.name || 'Caribe Restaurante'}</div>
      <div class="text-center">${company.address || 'Atendimento Automático'}</div>
      <div class="text-center">${company.phone || ''}</div>
      
      <div class="divider"></div>
      
      <div><b>Data:</b> ${dateStr}</div>
      <div><b>Cliente:</b> ${clientName || 'Cliente'}</div>
      <div><b>Telefone:</b> ${order.phone || ''}</div>
      <div><b>Tipo:</b> ${order.type === 'delivery' ? '🛵 ENTREGA' : '📍 RETIRADA NO BALCÃO'}</div>
      
      ${order.type === 'delivery' && order.address ? `<div><b>Endereço:</b> ${order.address}</div>` : ''}
      
      <div class="divider"></div>
      <div class="bold text-center">ITENS DO PEDIDO</div>
      <div class="divider"></div>
      
      ${itemsList}
      
      <div class="divider"></div>
      
      <div class="total-row"><span>Subtotal:</span> <span>R$ ${subtotal.toFixed(2)}</span></div>
      ${order.type === 'delivery' ? `<div class="total-row"><span>Taxa Entrega:</span> <span>R$ ${taxa.toFixed(2)}</span></div>` : ''}
      <div class="total-row bold"><span>TOTAL:</span> <span>R$ ${total.toFixed(2)}</span></div>
      
      <div class="divider"></div>
      
      <div><b>Pagamento:</b> ${order.paymentMethod}</div>
      ${order.trocoPara ? `<div><b>Troco Para:</b> R$ ${order.trocoPara.toFixed(2)}</div>` : ''}
      ${troco > 0 ? `<div><b>Troco a devolver:</b> R$ ${troco.toFixed(2)}</div>` : ''}
      
      <div class="divider"></div>
      <div class="text-center footer">
        Obrigado pela preferência!<br>
        Ana Food Delivery Desktop
      </div>
    </body>
    </html>
  `;
}

/**
 * Dispara a impressão silenciosa.
 * Se deviceName for vazio, usa a impressora padrão do sistema operacional.
 */
function printOrder(order, company, clientName, printerName = '') {
  return new Promise((resolve, reject) => {
    try {
      const html = generateReceiptHtml(order, company, clientName);
      let win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      
      win.webContents.on('did-finish-load', () => {
        win.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: printerName || '' // Vazio = Impressora Padrão
        }, (success, errorType) => {
          win.close();
          if (success) {
            console.log('[PrintService] Impressão enviada com sucesso');
            resolve(true);
          } else {
            console.error('[PrintService] Falha na impressão:', errorType);
            reject(new Error(errorType));
          }
        });
      });
    } catch (e) {
      console.error('[PrintService] Erro ao imprimir:', e.message);
      reject(e);
    }
  });
}

module.exports = {
  printOrder
};
