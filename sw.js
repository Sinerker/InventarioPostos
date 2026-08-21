/* =============================================
   sw.js — Service Worker do app Inventário
   =============================================
   Estratégia:
   - App shell (HTML/CSS/JS/ícones): stale-while-revalidate.
     Entrega o que está em cache na hora (app abre instantâneo,
     funciona offline) e busca a versão nova em paralelo, que
     passa a valer na próxima abertura. Assim, mesmo que você
     esqueça de subir o CACHE_VERSION, a correção chega sozinha.
   - CSV de produtos: NÃO passa mais por aqui. Quem cuida dele
     é o script.js, que guarda o cadastro já convertido dentro
     do IndexedDB. Antes o mesmo cadastro ocupava espaço duas
     vezes (19 MB de texto no cache + os dados na memória) e só
     atualizava na segunda abertura.
   - skipWaiting + clients.claim: a versão nova assume o controle
     imediatamente, sem precisar fechar todas as abas.
   ============================================= */

// Suba este número quando quiser forçar a troca imediata em
// todo mundo. Com stale-while-revalidate isso virou opcional.
const CACHE_VERSION = "v2";
const CACHE_NAME = `inventario-shell-${CACHE_VERSION}`;

// Arquivos do "esqueleto" do app — baixados e cacheados
// na instalação, para o app abrir mesmo sem internet.
const APP_SHELL = [
  "./",
  "./index.html",
  "./contagens.html",
  "./manual.html",
  "./script.js",
  "./cadastro-worker.js",
  "./lote.js",
  "./contagens.js",
  "./contagens-salvar.js",
  "./contagens-exportar.js",
  "./pwa-registro.js",
  "./style.css",
  "./style-contagens.css",
  "./manifest.json",
  "./iconInventario.png",
  "./iconInventario.webp",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// O cadastro é grande e tem cache próprio no IndexedDB.
// Se aparecer aqui, é para deixar passar direto para a rede.
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
// Activate: apaga caches de versões antigas (inclusive o
// antigo cache do CSV, liberando ~19 MB no aparelho) e
// assume o controle das páginas já abertas
// -----------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(
          nomes.filter((nome) => nome !== CACHE_NAME).map((nome) => caches.delete(nome))
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

  // Outra origem (raw do GitHub, por exemplo): não é problema nosso
  if (url.origin !== self.location.origin) return;

  // O cadastro vai direto para a rede — o app tem cache próprio dele
  if (decodeURIComponent(url.pathname).includes(CSV_FILENAME)) return;

  event.respondWith(staleWhileRevalidate(req));
});

// -----------------------------------------------
// Entrega o cache na hora e renova por baixo
// -----------------------------------------------
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const daRede = fetch(req)
    .then((resp) => {
      if (resp && resp.ok && resp.type === "basic") {
        cache.put(req, resp.clone());
      }
      return resp;
    })
    .catch(() => null);

  if (cached) {
    daRede; // renova em segundo plano, sem segurar a resposta
    return cached;
  }

  const resp = await daRede;
  if (resp) return resp;

  // Sem cache e sem rede: se for navegação, cai na tela inicial
  if (req.mode === "navigate") {
    const inicio = await cache.match("./index.html");
    if (inicio) return inicio;
  }

  return new Response("Conteúdo indisponível offline.", {
    status: 503,
    statusText: "Service Unavailable",
  });
}
