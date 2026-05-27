// src/database.js
// ═════════════════════════════════════════════════════════════════
// DATABASE LAYER — Supabase via API REST direta (axios)
// ═════════════════════════════════════════════════════════════════

const axios = require('axios');
const logger = require('./logger');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Configuração base do Axios para o Supabase
const supaApi = axios.create({
    baseURL: `${URL}/rest/v1`,
    headers: {
        'apikey': KEY,
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json'
    }
});

/**
 * Busca o cliente pelo telefone.
 * @param {string} companyId - ID ou string da empresa.
 * @param {string} phone - Telefone remoto no formato JID.
 */
async function getCustomerByPhone(companyId, phone) {
    if (!URL || !KEY) return null;
    const cleanPhone = phone.replace('@s.whatsapp.net', '');

    try {
        const response = await supaApi.get(`/customers`, {
            params: {
                company_id: `eq.${companyId}`,
                phone: `eq.${cleanPhone}`,
                select: '*'
            }
        });

        if (response.data && response.data.length > 0) {
            return response.data[0];
        }
        return null;
    } catch (err) {
        logger.debug('database.error', { action: 'getCustomer', error: err.message });
        return null;
    }
}

/**
 * Atualiza ou insere (Upsert) os dados de um cliente.
 */
async function saveCustomer(companyId, phone, name) {
    if (!URL || !KEY) return null;
    const cleanPhone = phone.replace('@s.whatsapp.net', '');

    try {
        // Supabase REST UPSERT exige on_conflict e prefer=return=representation
        const response = await supaApi.post(
            `/customers`,
            {
                company_id: companyId,
                phone: cleanPhone,
                name: name,
                updated_at: new Date().toISOString()
            },
            {
                headers: {
                    'Prefer': 'resolution=merge-duplicates,return=representation'
                },
                params: {
                    on_conflict: 'company_id,phone'
                }
            }
        );
        return response.data;
    } catch (err) {
        logger.debug('database.error', { action: 'saveCustomer', error: err.message });
        return null;
    }
}

/**
 * Salva a última marmita pedida pelo cliente para a skill de memória.
 */
async function saveLastOrder(companyId, phone, items) {
    if (!URL || !KEY) return null;
    const cleanPhone = phone.replace('@s.whatsapp.net', '');

    // Extrai só as marmitas (ignora extras/bebidas para a refação de marmita)
    const marmitas = items.filter(i => i.tipo === 'marmita');
    if (marmitas.length === 0) return null;

    try {
        const response = await supaApi.post(
            `/customers`,
            {
                company_id: companyId,
                phone: cleanPhone,
                last_order: marmitas // Save JSONB
            },
            {
                headers: {
                    'Prefer': 'resolution=merge-duplicates,return=representation'
                },
                params: {
                    on_conflict: 'company_id,phone'
                }
            }
        );

        logger.info('database.saved_last_order', { phone });
        return response.data;
    } catch (err) {
        logger.debug('database.error', { action: 'saveLastOrder', error: err.message });
        return null;
    }
}

/**
 * Busca a empresa pela instância/telefone da Evolution API.
 * @param {string} instancePhone - ID da instância ou telefone da empresa.
 */
async function getCompanyByPhone(instancePhone) {
    if (!URL || !KEY) return null;
    try {
        const response = await supaApi.get('/companies', {
            params: {
                phone: `eq.${instancePhone}`,
                select: '*',
                limit: 1
            }
        });
        return response.data?.[0] || null;
    } catch (err) {
        logger.debug('database.error', { action: 'getCompanyByPhone', error: err.message });
        return null;
    }
}

/**
 * Busca produtos ativos de uma empresa.
 * @param {string} companyId - ID da empresa.
 */
async function getProducts(companyId) {
    if (!URL || !KEY) return [];
    try {
        const response = await supaApi.get('/products', {
            params: {
                company_id: `eq.${companyId}`,
                active: 'eq.true',
                select: '*'
            }
        });
        return response.data || [];
    } catch (err) {
        logger.debug('database.error', { action: 'getProducts', error: err.message });
        return [];
    }
}

/**
 * Constrói preferências atualizadas (função pura, sem acesso ao banco).
 */
function _buildPreferences(currentPrefs, orderData) {
    const prefs = JSON.parse(JSON.stringify(currentPrefs || {}));

    prefs.total_orders = (prefs.total_orders || 0) + 1;
    prefs.last_order_time = new Date().toISOString();

    if (orderData.type) {
        prefs.last_order_type = orderData.type;
    }

    if (orderData.paymentMethod) {
        prefs.last_payment = orderData.paymentMethod;
        const counts = prefs._payment_counts || {};
        counts[orderData.paymentMethod] = (counts[orderData.paymentMethod] || 0) + 1;
        prefs._payment_counts = counts;
        prefs.favorite_payment = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])[0][0];
    }

    if (orderData.address) {
        prefs.last_address = orderData.address;
        const addrs = prefs.saved_addresses || [];
        const existing = addrs.find(a => a.address === orderData.address);
        if (existing) {
            existing.uses = (existing.uses || 0) + 1;
        } else {
            addrs.push({ address: orderData.address, uses: 1 });
        }
        if (addrs.length > 5) {
            addrs.sort((a, b) => b.uses - a.uses);
            addrs.length = 5;
        }
        prefs.saved_addresses = addrs;
    }

    if (orderData.items && orderData.items.length > 0) {
        const topItems = prefs.top_items || [];
        for (const item of orderData.items) {
            // Defensivo: suporta todos os tipos de plugin
            const itemName = item.tipo === 'marmita'
                ? `Marmita ${item.tamanho || '?'}`
                : (item.name || item.produto || item.product || 'Item sem nome');
            const itemTipo = item.tipo || 'produto';
            const existing = topItems.find(t => t.name === itemName && t.tipo === itemTipo);
            if (existing) {
                existing.count = (existing.count || 0) + 1;
            } else {
                topItems.push({ name: itemName, tipo: itemTipo, count: 1 });
            }
        }
        topItems.sort((a, b) => b.count - a.count);
        if (topItems.length > 10) topItems.length = 10;
        prefs.top_items = topItems;
    }

    return prefs;
}

/**
 * Salva/atualiza preferências do cliente após pedido finalizado.
 */
async function saveCustomerPreferences(companyId, phone, orderData) {
    if (!URL || !KEY) return null;
    const cleanPhone = phone.replace('@s.whatsapp.net', '');

    const customer = await getCustomerByPhone(companyId, phone);
    const currentPrefs = (customer && customer.preferences) || {};
    const prefs = _buildPreferences(currentPrefs, orderData);

    try {
        const response = await supaApi.post(
            `/customers`,
            {
                company_id: companyId,
                phone: cleanPhone,
                preferences: prefs
            },
            {
                headers: {
                    'Prefer': 'resolution=merge-duplicates,return=representation'
                },
                params: {
                    on_conflict: 'company_id,phone'
                }
            }
        );
        logger.info('database.saved_preferences', { phone });
        return response.data;
    } catch (err) {
        logger.debug('database.error', { action: 'saveCustomerPreferences', error: err.message });
        return null;
    }
}

/**
 * Invalida cache do cardápio de uma empresa no Redis.
 * Deve ser chamada quando produtos forem criados, atualizados ou desativados.
 */
async function invalidateCardapioCache(companyId) {
    const { cacheDel } = require('./stateManager');
    const key = `cardapio:${companyId}`;
    await cacheDel(key);
    logger.debug('cardapio.cache_invalidated', { companyId });
}

/**
 * Realiza login via Supabase Auth.
 */
async function loginUser(email, password) {
    if (!URL || !KEY) return null;
    try {
        const response = await axios.post(`${URL}/auth/v1/token?grant_type=password`, {
            email,
            password
        }, {
            headers: {
                'apikey': KEY,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (err) {
        logger.debug('database.error', { action: 'loginUser', error: err.response ? err.response.data : err.message });
        throw new Error(err.response && err.response.data && err.response.data.error_description 
            ? err.response.data.error_description 
            : err.message);
    }
}

/**
 * Busca empresa pelo ID do proprietário (owner_id).
 */
async function getCompanyByOwner(ownerId) {
    if (!URL || !KEY) return null;
    try {
        const response = await supaApi.get('/companies', {
            params: {
                owner_id: `eq.${ownerId}`,
                select: '*',
                limit: 1
            }
        });
        return response.data?.[0] || null;
    } catch (err) {
        logger.debug('database.error', { action: 'getCompanyByOwner', error: err.message });
        return null;
    }
}

/**
 * Busca empresa pelo ID da empresa.
 */
async function getCompanyById(companyId) {
    if (!URL || !KEY) return null;
    try {
        const response = await supaApi.get('/companies', {
            params: {
                id: `eq.${companyId}`,
                select: '*',
                limit: 1
            }
        });
        return response.data?.[0] || null;
    } catch (err) {
        logger.debug('database.error', { action: 'getCompanyById', error: err.message });
        return null;
    }
}

module.exports = {
    getCustomerByPhone,
    saveCustomer,
    saveLastOrder,
    saveCustomerPreferences,
    _buildPreferences,
    getCompanyByPhone,
    getProducts,
    invalidateCardapioCache,
    loginUser,
    getCompanyByOwner,
    getCompanyById,
    CARDAPIO_CACHE_PREFIX: 'cardapio:'
};
