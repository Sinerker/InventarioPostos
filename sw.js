/* =============================================
   sw.js — Service Worker do app Inventário
   =============================================
   Estratégia:
   - App shell (HTML/CSS/JS/ícones): cache-first,
     com nome de cache versionado. Suba CACHE_VERSION
     a cada deploy para forçar todo mundo a atualizar.
   - CSV de produtos: stale-while-revalidate — serve
     o que já está em cache na hora (rápido, funciona
     offline) e, em paralelo, busca a versão nova na
     rede para deixar pronta na próxima abertura.
   - skipWaiting + clients.claim: garante que a versão
     nova assume o controle imediatamente, sem precisar
     fechar todas as abas antes de atualizar.
   ============================================= */

// IMPORTANTE: mude este número a cada deploy novo.
// Isso invalida o cache antigo e força o app a buscar
// os arquivos atualizados.
const CACHE_VERSION = "v1";
const CACHE_NAME = `inventario-shell-${CACHE_VERSION}`;
const CSV_CACHE_NAME = `inventario-csv-${CACHE_VERSION}`;

// Arquivos do "esqueleto" do app — baixados e cacheados
// na instalação, para o app abrir mesmo sem internet.
const APP_SHELL = [
  "./",
  "./index.html",
  "./contagens.html",
  "./manual.html",
  "./script.js",
  "./lote.js",
  "./contagens.js",
  "./contagens-salvar.js",
  "./contagens-exportar.js",
  "./style.css",
  "./style-contagens.css",
  "./manifest.json",
  "./iconInventario.png",
  "./iconInventario.webp",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// Nome do arquivo do CSV — usado para identificar
// a requisição independente de vir local ou do GitHub raw.
const CSV_FILENAME = "embalagens com categorias.csv";

// -----------------------------------------------
// Install: baixa e cacheia o app shell
// -----------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.error("[SW] Falha ao cachear app shell:", err))
  );
});

// -----------------------------------------------
// Activate: apaga caches de versões antigas e
// assume o controle das páginas já abertas
// -----------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(
          nomes
            .filter(
              (nome) => nome !== CACHE_NAME && nome !== CSV_CACHE_NAME
            )
            .map((nome) => caches.delete(nome))
        )
      )
      .then(() => self.clients.claim())
  );
});

// -----------------------------------------------
// Fetch
// -----------------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Só intercepta GET — deixa outros métodos passarem direto
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const ehCSV = decodeURIComponent(url.pathname).includes(CSV_FILENAME);

  if (ehCSV) {
    event.respondWith(staleWhileRevalidateCSV(req));
    return;
  }

  // App shell: cache-first, com fallback pra rede
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).catch(() => cached);
    })
  );
});

// -----------------------------------------------
// Estratégia stale-while-revalidate para o CSV
// -----------------------------------------------
async function staleWhileRevalidateCSV(req) {
  const cache = await caches.open(CSV_CACHE_NAME);
  const cached = await cache.match(req);

  const buscarNaRede = fetch(req)
    .then((resp) => {
      // Só atualiza o cache se a resposta for válida
      if (resp && resp.ok) {
        cache.put(req, resp.clone());
      }
      return resp;
    })
    .catch(() => null);

  // Se já tem em cache, responde na hora e atualiza em segundo plano.
  if (cached) {
    buscarNaRede; // dispara sem esperar (atualiza pra próxima vez)
    return cached;
  }

  // Sem cache ainda (primeira vez): espera a rede.
  const resp = await buscarNaRede;
  if (resp) return resp;

  // Sem cache e sem rede: não tem o que responder.
  return new Response("CSV indisponível offline e sem conexão.", {
    status: 503,
    statusText: "Service Unavailable",
  });
}
