// Helper: envia quit para a instância existente e sai
const { app } = require("electron");
app.on("ready", () => {
  // A segunda instância será rejeitada pelo single-instance lock
  // e isso vai focar a janela existente
  app.quit();
});
// Se não conseguiu o lock, o app.on("second-instance") vai triggerar na instância principal
// mas não vai fechar - precisamos que o user feche manualmente  
setTimeout(() => process.exit(0), 2000);
