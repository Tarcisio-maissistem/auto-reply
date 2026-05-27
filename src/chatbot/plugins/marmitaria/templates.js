// plugins/marmitaria/templates.js
// ═══════════════════════════════════════════════════════════════
// Templates adaptativos — versões por contexto (pressa/normal/indeciso)
// ═══════════════════════════════════════════════════════════════

const T = require('../../templates');

// ─── SAUDAÇÃO ─────────────────────────────────────────────────

function saudacao(companyName, periodo) {
  const p = periodo || 'outro';
  const msgs = {
    almoco: `Olá! 😊 Bora almoçar? Vai querer marmita *Pequena (R$ 20)* ou *Grande (R$ 22)*?`,
    jantar: `Boa noite! 😊 Vai querer marmita *Pequena (R$ 20)* ou *Grande (R$ 22)*?`,
    outro:  `Olá! Bem-vindo à *${companyName}* 👋\nPequena (R$ 20) ou Grande (R$ 22)?`
  };
  return msgs[p] || msgs.outro;
}

function saudacaoCliente(nome, companyName, periodo) {
  const p = periodo || 'outro';
  const msgs = {
    almoco: `Oi, *${nome}*! Bora almoçar? 😊\nPequena (R$ 20) ou Grande (R$ 22)?`,
    jantar: `Boa noite, *${nome}*! 😊\nPequena (R$ 20) ou Grande (R$ 22)?`,
    outro:  `Olá, *${nome}*! Bem-vindo de volta à *${companyName}*! 👋\nPequena (R$ 20) ou Grande (R$ 22)?`
  };
  return msgs[p] || msgs.outro;
}

// ─── TAMANHO ──────────────────────────────────────────────────

function tamanhoNaoEntendido(tamanhos) {
  if (tamanhos && tamanhos.length > 0) {
    return tamanhos.map((t, i) =>
      `${i + 1}️⃣ *${t.name}* — R$ ${t.price},00 (${t.serve})`
    ).join('\n') + '\n\nQual você prefere?';
  }
  return `Não entendi o tamanho. Temos marmita *Pequena* ou *Grande*. Qual você prefere? 😊`;
}

// ─── PROTEÍNA ─────────────────────────────────────────────────

function pedirProteina(tamanhoObj, qty) {
  const prefixo = qty > 1 ? `Marmita 1 de ${qty} 👇\n` : '';
  const max = tamanhoObj ? tamanhoObj.max_proteinas : 2;
  return `${prefixo}Qual proteína?\n` +
    `🍗 Frango  🥩 Churrasco  🍖 Costela\n` +
    `🌭 Linguiça  🥩 Carne Cozida` +
    (max > 1 ? `\n_(escolha até ${max})_` : '');
}

function pedirProteinaRapido(tamanhoObj, qty) {
  return `Proteína? Frango, Churrasco, Costela, Linguiça ou Carne`;
}

function proteinaNaoEntendida(proteinas) {
  if (proteinas && proteinas.length > 0) {
    return `Não entendi 😅 Escolha entre:\n` +
      proteinas.map(p => `• ${p.name}`).join('\n');
  }
  return `Opção inválida. Escolha até *2 proteínas* entre: Frango, Churrasco, Costela, Linguiça ou Carne Cozida.`;
}

// ─── ACOMPANHAMENTO ───────────────────────────────────────────

function pedirAcompanhamento(cardapio) {
  if (cardapio && cardapio.acompanhamentos && cardapio.acompanhamentos.length > 0) {
    return [
      `Ótima escolha! 😋`,
      `Acompanhamentos:\n` +
      cardapio.acompanhamentos.map(a => `• ${a.name}`).join('\n')
    ];
  }
  return [
    `Ótima combinação 😋`,
    `Agora escolha os *acompanhamentos*:\n🍚 Arroz\n🍲 Feijão\n🍝 Macarrão\n🥔 Purê\n🥓 Tropeiro`
  ];
}

function acompanhamentoNaoEntendido() {
  return `Por favor, escolha entre: Arroz, Feijão, Macarrão, Purê ou Tropeiro.`;
}

// ─── SALADA ───────────────────────────────────────────────────

function pedirSalada(cardapio) {
  if (cardapio && cardapio.saladas && cardapio.saladas.length > 0) {
    return `Salada?\n` +
      cardapio.saladas.map(s => `• ${s.name}`).join('  ');
  }
  return `Salada?\n🥗 Maionese  🥗 Beterraba  🥗 Alface  🥗 Repolho  🥒 Pepino`;
}

function saladaNaoEntendida() {
  return `Por favor, escolha entre: Maionese, Beterraba, Alface, Repolho ou Pepino.`;
}

// ─── MÚLTIPLAS MARMITAS ───────────────────────────────────────

function proximaMarmita(numero, total) {
  return `Marmita ${numero - 1} anotada ✅\n\nAgora a ${numero}ª — qual o tamanho?`;
}

// ─── UPSELL ───────────────────────────────────────────────────

function oferecerUpsellBebida(resumoCurto) {
  return [
    resumoCurto,
    `Quer adicionar *Suco Natural* (R$ 8) ou *Refrigerante Lata* (R$ 6)? 🥤\n_(Digite "não" para pular)_`
  ];
}

// ─── COMBOS (indeciso) ───────────────────────────────────────

function recomendarCombo(combo) {
  return `Posso sugerir nosso *${combo.name}*? 😊\n` +
    `🥩 ${combo.proteinas.join(' + ')}\n` +
    `🍚 ${combo.acompanhamentos.join(' + ')}\n` +
    `Por R$ 22,00 — quer esse?`;
}

// ─── RESUMO DE MARMITA ───────────────────────────────────────

function resumoFinalMarmita(item) {
  if (!item) return '';
  let txt = `🍱 *Marmita ${item.tamanho}* — R$ ${T.fmt(item.price)}\n`;
  if (item.proteinas?.length)       txt += `🥩 ${item.proteinas.map(p => p.name).join(' + ')}\n`;
  if (item.acompanhamentos?.length) txt += `🍚 ${item.acompanhamentos.map(a => a.name).join(' + ')}\n`;
  if (item.saladas?.length)         txt += `🥗 ${item.saladas.map(s => s.name).join(' + ')}\n`;
  return txt.trim();
}

function formatarResumoMarmitas(items) {
  return items
    .filter(i => i.tipo === 'marmita')
    .map(i => resumoFinalMarmita(i))
    .join('\n\n');
}

module.exports = {
  saudacao,
  saudacaoCliente,
  tamanhoNaoEntendido,
  pedirProteina,
  pedirProteinaRapido,
  proteinaNaoEntendida,
  pedirAcompanhamento,
  acompanhamentoNaoEntendido,
  pedirSalada,
  saladaNaoEntendida,
  proximaMarmita,
  oferecerUpsellBebida,
  recomendarCombo,
  resumoFinalMarmita,
  formatarResumoMarmitas
};
