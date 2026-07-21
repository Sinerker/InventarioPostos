/* =============================================
   pwa-registro.js — registra o service worker
   ============================================= */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        console.log("[PWA] Service worker registrado:", reg.scope);

        // Se já existe um SW novo esperando (ex: acabou de atualizar
        // o repositório), ativa ele sem precisar fechar o app.
        reg.addEventListener("updatefound", () => {
          const novoWorker = reg.installing;
          if (!novoWorker) return;
          novoWorker.addEventListener("statechange", () => {
            if (
              novoWorker.state === "activated" &&
              navigator.serviceWorker.controller
            ) {
              console.log("[PWA] Nova versão ativada.");
            }
          });
        });
      })
      .catch((err) => {
        console.error("[PWA] Falha ao registrar service worker:", err);
      });
  });
}
