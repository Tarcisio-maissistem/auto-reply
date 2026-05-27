/**
 * EcoResponse — Confirmação em uma linha antes de cada pergunta
 * 
 * Muda a conversa de formulário para atendente real.
 * Antes de perguntar o próximo item, confirma o que entendeu.
 * 
 * Exemplo:
 *   User: "frango e churrasco"
 *   Bot: "Frango + Churrasco 👍"  ← eco
 *        "Acompanhamentos?"        ← próxima pergunta
 */

/**
 * Gera uma linha de confirmação (eco) para itens selecionados
 * @param {Array|string} itens - items selecionados (objetos com .name ou strings)
 * @param {string} tipo - tipo do item: proteina, acompanhamento, salada, tamanho
 * @returns {string} - linha de confirmação curta
 */
function gerarEco(itens, tipo) {
  if (!itens) return '';
  
  // Normaliza para array
  const arr = Array.isArray(itens) ? itens : [itens];
  if (arr.length === 0) return '';
  
  // Extrai nomes
  const nomes = arr.map(i => typeof i === 'string' ? i : (i.name || i)).join(' + ');
  
  // Ecos específicos por tipo
  const ecos = {
    proteina:       `${nomes} 👍`,
    acompanhamento: `${nomes} ✅`,
    salada:         `${nomes} 🥗`,
    tamanho:        `Marmita ${nomes}! 😊`,
    bebida:         `${nomes} 🍹`,
    tipo_pedido:    nomes === 'pickup' ? 'Retirada ✅' : 'Entrega ✅',
    pagamento:      `${nomes} 💳`,
    endereco:       `Endereço anotado 📍`
  };
  
  return ecos[tipo] || `${nomes} ✅`;
}

/**
 * Gera eco para quantidade + tamanho de marmitas
 * @param {number} qty - quantidade
 * @param {string} tamanho - Pequena ou Grande
 * @returns {string}
 */
function gerarEcoQuantidade(qty, tamanho) {
  if (qty === 1) {
    return `1 ${tamanho} 👍`;
  }
  return `${qty} ${tamanho}s 👍`;
}

/**
 * Gera eco para grupos de marmitas
 * @param {Array} grupos - array de { tamanho, qty }
 * @returns {string}
 */
function gerarEcoGrupos(grupos) {
  if (!grupos || grupos.length === 0) return '';
  
  const partes = grupos.map(g => {
    const tam = g.tamanho === 'Grande' ? 'Grande' : 'Pequena';
    return g.qty === 1 ? `1 ${tam}` : `${g.qty} ${tam}s`;
  });
  
  const total = grupos.reduce((sum, g) => sum + g.qty, 0);
  return `✅ ${partes.join(' + ')} = ${total} marmita(s)`;
}

/**
 * Gera eco para pular/sem item
 * @param {string} tipo - tipo do item pulado
 * @returns {string}
 */
function gerarEcoPular(tipo) {
  const ecos = {
    salada:         'Sem salada 👍',
    acompanhamento: 'Sem acompanhamento 👍',
    bebida:         'Sem bebida 👍'
  };
  return ecos[tipo] || '👍';
}

/**
 * Combina eco + próxima pergunta em uma resposta formatada
 * @param {string} eco - linha de eco
 * @param {string} proximaPergunta - próxima pergunta do fluxo
 * @returns {string}
 */
function combinarEcoEPergunta(eco, proximaPergunta) {
  if (!eco) return proximaPergunta;
  if (!proximaPergunta) return eco;
  return `${eco}\n\n${proximaPergunta}`;
}

module.exports = {
  gerarEco,
  gerarEcoQuantidade,
  gerarEcoGrupos,
  gerarEcoPular,
  combinarEcoEPergunta
};
