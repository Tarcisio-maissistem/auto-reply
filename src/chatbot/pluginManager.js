// pluginManager.js
// ═══════════════════════════════════════════════════════════════
// Gerenciador de Plugins — Carrega plugin por business_type
// ═══════════════════════════════════════════════════════════════

const logger = require('./logger');
const path = require('path');

// Cache de plugins carregados (evita require repetido)
const _pluginCache = {};

/**
 * Interface obrigatória de todo plugin:
 *   business_type: string
 *   getFlowSteps(): string[]
 *   handleStep(etapa, text, state, cardapio, deps): { state, response, ... }
 *   getDefaultCardapio(): object
 *   buildFastTrackItem(ftResult, cardapio): object | null
 *   validateItem(item): { valid, errors }
 *   calculateItemPrice(item): number
 *   formatItemForSummary(item): string
 *   templates: object
 */

const REQUIRED_INTERFACE = [
  'business_type',
  'getFlowSteps',
  'handleStep',
  'getDefaultCardapio',
  'buildFastTrackItem',
  'validateItem',
  'calculateItemPrice',
  'formatItemForSummary',
  'templates'
];

/**
 * Carrega plugin por business_type.
 * Busca em ./plugins/{type}.js
 * Retorna null se não encontrar.
 */
function loadPlugin(businessType) {
  if (!businessType) return null;

  const key = businessType.toLowerCase().trim();

  if (_pluginCache[key]) return _pluginCache[key];

  try {
    // Tenta carregar: primeiro como diretório (./plugins/{key}/index.js), depois como arquivo (./plugins/{key}.js)
    let plugin;
    const dirPath = path.join(__dirname, 'plugins', key);
    const filePath = path.join(__dirname, 'plugins', `${key}.js`);

    try {
      plugin = require(dirPath);
    } catch (dirErr) {
      if (dirErr.code === 'MODULE_NOT_FOUND') {
        plugin = require(filePath);
      } else {
        throw dirErr;
      }
    }

    // Valida interface obrigatória
    const missing = REQUIRED_INTERFACE.filter(m => !(m in plugin));
    if (missing.length > 0) {
      logger.debug('plugin.invalid_interface', {
        type: key,
        missing
      });
      return null;
    }

    _pluginCache[key] = plugin;
    logger.debug('plugin.loaded', { type: key });
    return plugin;
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      logger.debug('plugin.not_found', { type: key });
    } else {
      logger.debug('plugin.load_error', { type: key, error: err.message });
    }
    return null;
  }
}

/**
 * Lista todos os business_types disponíveis (baseado nos arquivos em ./plugins/).
 */
function listAvailablePlugins() {
  try {
    const fs = require('fs');
    const pluginsDir = path.join(__dirname, 'plugins');
    if (!fs.existsSync(pluginsDir)) return [];
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    const plugins = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.js')) {
        plugins.push(entry.name.replace('.js', ''));
      } else if (entry.isDirectory()) {
        // Diretório com index.js conta como plugin
        const indexPath = path.join(pluginsDir, entry.name, 'index.js');
        if (fs.existsSync(indexPath)) {
          plugins.push(entry.name);
        }
      }
    }
    return plugins;
  } catch {
    return [];
  }
}

/**
 * Limpa cache de plugins (útil para testes).
 */
function clearCache() {
  for (const key of Object.keys(_pluginCache)) {
    delete _pluginCache[key];
  }
}

module.exports = {
  loadPlugin,
  listAvailablePlugins,
  clearCache,
  REQUIRED_INTERFACE
};
