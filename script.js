/* =============================================
   script.js — carga do cadastro e árvore de categorias
   =============================================
   Como funciona (tela inicial):

   1. Lê o cadastro JÁ CONVERTIDO do IndexedDB e monta a
      árvore na hora. Da segunda vez em diante o app abre
      sem baixar e sem processar nada.
   2. Em paralelo pergunta ao servidor (requisição HEAD,
      alguns bytes) se o CSV mudou. Se mudou, baixa e
      converte num worker, sem travar a tela.
   3. Sem internet, segue com o que está guardado.

   Diferente da versão anterior, o cadastro novo aparece
   já na PRIMEIRA abertura depois que você sobe o arquivo,
   não na segunda.
   ============================================= */

// Mesma origem primeiro: é o próprio GitHub Pages servindo o
// arquivo, sem CORS, sem segundo CDN e com cabeçalho de versão
// legível. O raw do GitHub fica como reserva.
const csvCandidates = [
  "embalagens com categorias.csv",
  "https://raw.githubusercontent.com/Sinerker/InventarioPostos/main/embalagens%20com%20categorias.csv",
];

const DB_CADASTRO = "InventarioCadastroDB";
const STORE_CADASTRO = "cadastro";
const CHAVE_CADASTRO = "atual";

// -----------------------------------------------
// O cadastro em memória — formato compacto
// -----------------------------------------------
const cadastro = {
  pronto: false,
  total: 0,
  versao: null,
  dataISO: null,
  caminhos: [], // caminhos de categoria únicos
  niveisPorCat: [], // os mesmos caminhos, quebrados por nível
  blob: null, // Uint8Array: "SEQ\tDESC\tCOD\tQTD" por produto
  offsets: null, // Int32Array: início de cada produto no blob
  cats: null, // Int32Array: categoria de cada produto

  // Limites de um campo (0=SEQ, 1=DESC, 2=COD, 3=QTD) dentro do blob
  _limites(i, n) {
    const fim = this.offsets[i + 1];
    let a = this.offsets[i];
    for (let k = 0; k < n && a < fim; k++) {
      while (a < fim && this.blob[a] !== 9) a++;
      if (a < fim) a++;
    }
    let b = a;
    while (b < fim && this.blob[b] !== 9) b++;
    return [a, b];
  },

  campo(i, n) {
    const [a, b] = this._limites(i, n);
    return b <= a ? "" : _decoder.decode(this.blob.subarray(a, b));
  },

  // Só o código de barras — usado em varredura, evita
  // decodificar a linha inteira 148 mil vezes.
  codigo(i) {
    return this.campo(i, 2);
  },

  produto(i) {
    const p = _decoder.decode(this.blob.subarray(this.offsets[i], this.offsets[i + 1])).split("\t");
    return {
      SEQPRODUTO: p[0] || "",
      DESCCOMPLETA: p[1] || "",
      CODACESSO: p[2] || "",
      QTDEMBALAGEM: p[3] || "",
    };
  },

  // Marca quais categorias entram, dado o que foi escolhido na árvore.
  // Compara nó a nó (não por texto solto), então "USO EMBALAGENS"
  // não arrasta mais "USO EMBALAGENS FLOR" junto.
  categoriasSelecionadas(caminhosEscolhidos) {
    const escolhidos = new Set(caminhosEscolhidos);
    const marcadas = new Uint8Array(this.caminhos.length);
    for (let c = 0; c < this.caminhos.length; c++) {
      const niveis = this.niveisPorCat[c];
      let acc = "";
      for (let k = 0; k < niveis.length; k++) {
        acc = k === 0 ? niveis[0] : acc + " > " + niveis[k];
        if (escolhidos.has(acc)) {
          marcadas[c] = 1;
          break;
        }
      }
    }
    return marcadas;
  },

  aplicar(dados) {
    this.total = dados.total;
    this.versao = dados.versao;
    this.dataISO = dados.dataISO;
    this.caminhos = dados.caminhos;
    this.niveisPorCat = dados.niveisPorCat;
    this.blob = new Uint8Array(dados.blob);
    this.offsets = new Int32Array(dados.offsets);
    this.cats = new Int32Array(dados.cats);
    this.pronto = this.total > 0;
  },
};

const _decoder = new TextDecoder("utf-8");

// Mantido por compatibilidade com trechos antigos que
// checavam dadosCSV.length antes de criar lote.
let dadosCSV = { get length() { return cadastro.total; } };

// -----------------------------------------------
// Banco só do cadastro — separado do InventarioDB
// para não mexer na versão do banco das contagens
// -----------------------------------------------
function abrirDBCadastro() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_CADASTRO, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_CADASTRO)) {
        db.createObjectStore(STORE_CADASTRO, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function lerCadastroSalvo() {
  try {
    const db = await abrirDBCadastro();
    return await new Promise((resolve) => {
      const tx = db.transaction([STORE_CADASTRO], "readonly");
      const req = tx.objectStore(STORE_CADASTRO).get(CHAVE_CADASTRO);
      req.onsuccess = () => {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch (_) {
    return null;
  }
}

async function salvarCadastro(dados) {
  try {
    const db = await abrirDBCadastro();
    await new Promise((resolve) => {
      const tx = db.transaction([STORE_CADASTRO], "readwrite");
      tx.objectStore(STORE_CADASTRO).put({
        id: CHAVE_CADASTRO,
        versao: dados.versao,
        dataISO: dados.dataISO,
        total: dados.total,
        caminhos: dados.caminhos,
        niveisPorCat: dados.niveisPorCat,
        blob: cadastro.blob.buffer,
        offsets: cadastro.offsets.buffer,
        cats: cadastro.cats.buffer,
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch (err) {
    console.warn("[cadastro] não consegui guardar em cache:", err);
  }
}

// -----------------------------------------------
// Linha de status do cadastro
// -----------------------------------------------
function status(texto, tipo) {
  const el = document.getElementById("cadastro-status");
  if (!el) return;
  el.textContent = texto;
  el.className = "cadastro-status" + (tipo ? " cadastro-status--" + tipo : "");
}

function statusCadastroAtual(sufixo) {
  const d = cadastro.dataISO ? new Date(cadastro.dataISO) : null;
  const quando = d
    ? d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  status(
    `Cadastro de ${quando} · ${cadastro.total.toLocaleString("pt-BR")} produtos${sufixo || ""}`
  );
}

// -----------------------------------------------
// Verifica no servidor se o CSV mudou (só cabeçalhos)
// -----------------------------------------------
async function versaoNoServidor() {
  for (const url of csvCandidates) {
    try {
      const r = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (r && r.ok) {
        return r.headers.get("etag") || r.headers.get("last-modified") || null;
      }
    } catch (_) {
      // tenta a próxima
    }
  }
  return null;
}

// -----------------------------------------------
// Baixa e converte no worker
// -----------------------------------------------
function baixarCadastro(aoProgredir) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker("./cadastro-worker.js");
    } catch (err) {
      return reject(err);
    }

    worker.onmessage = (e) => {
      const m = e.data;
      if (m.tipo === "progresso") {
        if (aoProgredir) aoProgredir(m);
        return;
      }
      worker.terminate();
      if (m.tipo === "erro") reject(new Error(m.mensagem));
      else resolve(m);
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || "Falha no processamento do cadastro."));
    };

    worker.postMessage({ urls: csvCandidates });
  });
}

// -----------------------------------------------
// Árvore de categorias
// -----------------------------------------------
// Os filhos de cada nó só viram HTML quando o nó é aberto.
// A árvore inteira tem ~8.100 nós; criar tudo de uma vez
// significa ~40 mil elementos na tela antes do primeiro toque.
const _filhosPendentes = new WeakMap();

function montarEstrutura(niveisPorCat) {
  const raiz = {};
  for (const niveis of niveisPorCat) {
    let atual = raiz;
    for (const chave of niveis) {
      if (!atual[chave]) atual[chave] = {};
      atual = atual[chave];
    }
  }
  return raiz;
}

function criarNo(chave, filhos, caminhoCompleto) {
  const li = document.createElement("li");
  li.classList.add("tree-node");

  const temFilhos = Object.keys(filhos).length > 0;

  const nodeHeader = document.createElement("div");
  nodeHeader.classList.add("tree-node-header");

  const toggle = document.createElement("button");
  toggle.classList.add("tree-toggle");
  toggle.setAttribute("aria-label", temFilhos ? "Expandir" : "");
  toggle.textContent = temFilhos ? "▶" : "";
  toggle.type = "button";

  const label = document.createElement("label");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.classList.add("tree-checkbox");
  cb.dataset.path = caminhoCompleto;

  label.appendChild(cb);
  label.appendChild(document.createTextNode(" " + chave));

  nodeHeader.appendChild(toggle);
  nodeHeader.appendChild(label);
  li.appendChild(nodeHeader);

  if (temFilhos) {
    const subUl = document.createElement("ul");
    subUl.classList.add("tree-children");
    li.appendChild(subUl);
    _filhosPendentes.set(subUl, { filhos, caminho: caminhoCompleto });

    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      materializarFilhos(subUl, cb.checked);
      const aberto = subUl.classList.toggle("open");
      toggle.classList.toggle("open", aberto);
      toggle.textContent = aberto ? "▼" : "▶";
    });
  }

  return li;
}

function materializarFilhos(subUl, herdarMarcado) {
  const pendente = _filhosPendentes.get(subUl);
  if (!pendente) return;
  _filhosPendentes.delete(subUl);

  const frag = document.createDocumentFragment();
  for (const chave in pendente.filhos) {
    const caminho = pendente.caminho ? `${pendente.caminho} > ${chave}` : chave;
    const li = criarNo(chave, pendente.filhos[chave], caminho);
    if (herdarMarcado) {
      li.querySelector("input[type='checkbox']").checked = true;
    }
    frag.appendChild(li);
  }
  subUl.appendChild(frag);
}

function criarArvoreCategorias() {
  const estrutura = montarEstrutura(cadastro.niveisPorCat);
  const container = document.getElementById("tree-container");
  container.innerHTML = "<h2>Selecione as categorias</h2>";

  const ul = document.createElement("ul");
  const frag = document.createDocumentFragment();
  for (const chave in estrutura) {
    frag.appendChild(criarNo(chave, estrutura[chave], chave));
  }
  ul.appendChild(frag);
  container.appendChild(ul);
}

function haCategoriaMarcada() {
  return !!document.querySelector("#tree-container input[type='checkbox']:checked");
}

// Propaga check para filhos e atualiza estado indeterminado dos pais
document.addEventListener("change", function (e) {
  if (!e.target.classList.contains("tree-checkbox")) return;

  // 1. Propaga para todos os filhos já visíveis.
  //    Os que ainda não foram criados nascem com o estado
  //    do pai quando o nó for aberto (ver materializarFilhos).
  const li = e.target.closest("li");
  if (!li) return;
  li.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    cb.checked = e.target.checked;
    cb.indeterminate = false;
  });

  // 2. Atualiza estado dos ancestrais (indeterminate / checked / unchecked)
  atualizarPais(e.target);
});

function atualizarPais(checkbox) {
  // Sobe na árvore atualizando cada <li> pai
  let liAtual = checkbox.closest("li");
  while (liAtual) {
    const liPai = liAtual.parentElement?.closest("li");
    if (!liPai) break;

    const cbPai = liPai.querySelector(":scope > .tree-node-header input[type='checkbox']");
    if (!cbPai) {
      liAtual = liPai;
      continue;
    }

    const todosFilhos = Array.from(
      liPai.querySelectorAll(".tree-children input[type='checkbox']")
    );
    const marcados = todosFilhos.filter((c) => c.checked).length;

    if (marcados === 0) {
      cbPai.checked = false;
      cbPai.indeterminate = false;
    } else if (marcados === todosFilhos.length) {
      cbPai.checked = true;
      cbPai.indeterminate = false;
    } else {
      cbPai.checked = false;
      cbPai.indeterminate = true;
    }

    liAtual = liPai;
  }
}

// -----------------------------------------------
// Erro sem cadastro nenhum
// -----------------------------------------------
function mostrarFalhaCadastro(msg) {
  document.getElementById("tree-container").innerHTML =
    `<h2>Selecione as categorias</h2>
     <p style="color:var(--clr-danger);font-size:.95rem;margin-top:.5rem">
       ⚠️ Não foi possível carregar o cadastro.<br>
       ${msg || "Conecte-se à internet e abra o app novamente."}
     </p>`;
}

// -----------------------------------------------
// Fluxo de carga
// -----------------------------------------------
async function carregarCadastro() {
  const t0 = performance.now();

  // 1. O que já está guardado no aparelho
  const salvo = await lerCadastroSalvo();
  if (salvo && salvo.total > 0) {
    cadastro.aplicar(salvo);
    criarArvoreCategorias();
    statusCadastroAtual();
    console.log(
      `[cadastro] ${cadastro.total} produtos do cache em ${Math.round(performance.now() - t0)}ms`
    );
    if (typeof window.aoCadastroPronto === "function") window.aoCadastroPronto();
  } else {
    status("Baixando cadastro pela primeira vez…");
  }

  // 2. Mudou no servidor?
  const versaoRemota = await versaoNoServidor();

  if (cadastro.pronto) {
    if (!versaoRemota) {
      statusCadastroAtual(" · sem conexão");
      return;
    }
    if (cadastro.versao && versaoRemota === cadastro.versao) {
      return; // já está em dia
    }
    if (haCategoriaMarcada()) {
      // Não derruba a seleção do usuário no meio do caminho
      status("Há um cadastro novo no servidor. Recarregue a página para atualizar.", "aviso");
      return;
    }
    status("Atualizando cadastro…");
  }

  // 3. Baixa e converte
  try {
    const dados = await baixarCadastro((p) => {
      status(
        `Baixando cadastro… ${p.linhas.toLocaleString("pt-BR")} produtos (${(p.bytes / 1048576).toFixed(1)} MB)`
      );
    });

    cadastro.aplicar(dados);
    criarArvoreCategorias();
    statusCadastroAtual();
    console.log(
      `[cadastro] ${cadastro.total} produtos baixados e convertidos em ${Math.round(performance.now() - t0)}ms`
    );
    if (typeof window.aoCadastroPronto === "function") window.aoCadastroPronto();

    await salvarCadastro(dados);
  } catch (err) {
    console.error("[cadastro] falha:", err);
    if (cadastro.pronto) {
      statusCadastroAtual(" · falha ao atualizar");
    } else {
      status("Falha ao carregar o cadastro.", "erro");
      mostrarFalhaCadastro(err.message);
    }
  }
}

document.addEventListener("DOMContentLoaded", carregarCadastro);
