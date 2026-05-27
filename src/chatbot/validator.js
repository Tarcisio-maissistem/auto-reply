// src/validator.js
// ═══════════════════════════════════════════════════════════════
// Valida TUDO que entra antes de chegar na stateMachine.
// Retorna { valid: bool, reason: string }
// ═══════════════════════════════════════════════════════════════

const MAX_TEXT_LENGTH = 500;
const MIN_TEXT_LENGTH = 1;
const PHONE_REGEX     = /^\d{10,15}$/;

// ─── VALIDAÇÃO DO WEBHOOK ─────────────────────────────────────────────────────

function validateWebhookPayload(body) {
  if (!body || typeof body !== 'object') {
    return fail('payload_missing');
  }
  if (body.event !== 'messages.upsert') {
    return fail('event_not_message');    // ignora silenciosamente
  }
  if (!body.data?.key) {
    return fail('missing_key');
  }
  if (body.data.key.fromMe === true) {
    return fail('own_message');          // ignora mensagem do próprio bot
  }
  if (!body.instance) {
    return fail('missing_instance');
  }
  return ok();
}

// ─── VALIDAÇÃO DE MENSAGEM ────────────────────────────────────────────────────

function validateMessage(text) {
  if (text === null || text === undefined || text === '') {
    return fail('empty_text');
  }

  const trimmed = text.trim();

  if (trimmed.length < MIN_TEXT_LENGTH) {
    return fail('text_too_short');
  }

  if (trimmed.length > MAX_TEXT_LENGTH) {
    return fail('text_too_long');
  }

  // Rejeita texto composto apenas de emojis/símbolos sem letras ou números
  if (!/[a-zA-ZÀ-ÿ0-9]/.test(trimmed)) {
    return fail('no_alphanumeric');
  }

  return ok(trimmed); // retorna texto sanitizado
}

// ─── VALIDAÇÃO DE TELEFONE ────────────────────────────────────────────────────

function validatePhone(phone) {
  if (!phone) return fail('phone_missing');

  const clean = phone.replace(/\D/g, '');
  if (!PHONE_REGEX.test(clean)) {
    return fail('phone_invalid');
  }

  return ok(clean);
}

// ─── VALIDAÇÃO DE ESTADO ──────────────────────────────────────────────────────

const ESTADOS_VALIDOS = [
  'INICIO',
  'OFERECER_REPETICAO',
  'ENVIANDO_CARDAPIO',
  'MONTANDO_PEDIDO',
  'AGUARDANDO_TIPO',
  'AGUARDANDO_ENDERECO',
  'AGUARDANDO_PAGAMENTO',
  'AGUARDANDO_NOME',
  'CONFIRMANDO',
  'FINALIZADO'
];

function validateEstado(etapa) {
  if (!etapa || !ESTADOS_VALIDOS.includes(etapa)) {
    return fail('estado_invalido');
  }
  return ok();
}

// ─── VALIDAÇÃO DE NOME DO CLIENTE ─────────────────────────────────────────────

function validateNome(nome) {
  if (!nome || typeof nome !== 'string') return fail('nome_missing');

  const trimmed = nome.trim();
  if (trimmed.length < 2) return fail('nome_too_short');
  if (trimmed.length > 100) return fail('nome_too_long');
  if (!/[a-zA-ZÀ-ÿ]/.test(trimmed)) return fail('nome_no_letters');

  return ok(trimmed);
}

// ─── VALIDAÇÃO DE ENDERECO ────────────────────────────────────────────────────

function validateEndereco(endereco) {
  if (!endereco || typeof endereco !== 'string') return fail('endereco_missing');

  const trimmed = endereco.trim();
  if (trimmed.length < 10) return fail('endereco_too_short');
  if (trimmed.length > 300) return fail('endereco_too_long');
  if (!/\d/.test(trimmed)) return fail('endereco_no_number'); // deve ter ao menos um número

  return ok(trimmed);
}

// ─── VALIDAÇÃO DE QUANTIDADE ──────────────────────────────────────────────────

function validateQuantity(qty) {
  if (qty === null || qty === undefined) return fail('qty_null');
  if (!Number.isInteger(qty)) return fail('qty_not_integer');
  if (qty < 1) return fail('qty_below_one');
  if (qty > 50) return fail('qty_too_high'); // limite razoável para restaurante
  return ok(qty);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function ok(value) {
  return { valid: true, value };
}

function fail(reason) {
  return { valid: false, reason };
}

module.exports = {
  validateWebhookPayload,
  validateMessage,
  validatePhone,
  validateEstado,
  validateNome,
  validateEndereco,
  validateQuantity,
  ESTADOS_VALIDOS
};
