// ============================================================
// Gerenciador de Configurações — salva em JSON local
// ============================================================
const fs = require("fs");
const path = require("path");

class SettingsManager {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, "settings.json");
    this.defaults = {
      // Auto-reply
      autoReplyEnabled: true,
      autoReplyMessage: "Seja Bem vindo ao Caribe Restaurante!\n\n🍛 Cardápio de hoje\n\n🍱 Marmitas: Pequena R$20 / Grande R$22\n🥩 Proteínas: Frango Grelhado, Churrasco, Costela, Linguiça, Carne Cozida, Peixe Grelhado\n🍚 Acompanhamentos: Arroz, Feijão, Macarrão, Purê, Tropeiro\n🥗 Saladas: Maionese, Beterraba, Alface, Repolho, Pepino\n\n✅ Itens do pedido\n✅ Endereço e localização\n✅ Forma de pagamento",
      autoReplyDelay: 3000, // ms antes de enviar
      autoReplyOnlyNewChats: true, // só responder conversas novas (primeira msg)
      autoReplyIgnoreGroups: true,

      // Extração
      exportFormat: "json", // json ou csv
      exportLimit: 100,

      // Geral
      minimizeToTray: true,

      // Empresa Logada
      companyId: "",
      companyName: "",
      companyEmail: "",
      companyPhone: "",
      companyTenantId: "",
      companySubdomain: "",

      // Impressora
      printerName: "",
    };
    this.data = { ...this.defaults };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw);
        this.data = { ...this.defaults, ...parsed };
      }
    } catch (e) {
      console.error("[Settings] Erro ao carregar:", e.message);
      this.data = { ...this.defaults };
    }
  }

  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (e) {
      console.error("[Settings] Erro ao salvar:", e.message);
    }
  }

  get(key) {
    return this.data[key] !== undefined ? this.data[key] : this.defaults[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  getAll() {
    return { ...this.data };
  }

  update(obj) {
    this.data = { ...this.data, ...obj };
    this.save();
  }
}

module.exports = SettingsManager;
