/* =============================================
   lote.js — gerenciamento de lotes
   ============================================= */

let loteAtivoNome = null; // lote selecionado para continuar

// -----------------------------------------------
// IndexedDB helpers
// -----------------------------------------------
function openOrUpgradeDB() {
  return new Promise((resolve, reject) => {
    let req = indexedDB.open("InventarioDB");

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("lotes")) {
        db.createObjectStore("lotes", { keyPath: "nome" });
      }
      if (!db.objectStoreNames.contains("contagens")) {
        db.createObjectStore("contagens", {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };

    req.onsuccess = (e) => {
      const db = e.target.result;
      const precisaUpgrade =
        !db.objectStoreNames.contains("lotes") ||
        !db.objectStoreNames.contains("contagens");

      if (precisaUpgrade) {
        const v = db.version + 1;
        db.close();
        const up = indexedDB.open("InventarioDB", v);
        up.onupgradeneeded = (ev) => {
          const d = ev.target.result;
          if (!d.objectStoreNames.contains("lotes"))
            d.createObjectStore("lotes", { keyPath: "nome" });
          if (!d.objectStoreNames.contains("contagens"))
            d.createObjectStore("contagens", {
              keyPath: "id",
              autoIncrement: true,
            });
        };
        up.onsuccess = (ev) => resolve(ev.target.result);
        up.onerror = (ev) => reject(ev.target.error);
      } else {
        resolve(db);
      }
    };

    req.onerror = (e) => reject(e.target.error);
  });
}

// Busca todos os lotes
async function getLotes() {
  const db = await openOrUpgradeDB();
  return new Promise((resolve) => {
    const tx = db.transaction(["lotes"], "readonly");
    const store = tx.objectStore("lotes");
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      resolve(req.result || []);
    };
    req.onerror = () => {
      db.close();
      resolve([]);
    };
  });
}

// Busca contagens de um lote
async function getContagensDoLote(loteNome) {
  const db = await openOrUpgradeDB();
  if (!db.objectStoreNames.contains("contagens")) {
    db.close();
    return [];
  }
  return new Promise((resolve) => {
    const tx = db.transaction(["contagens"], "readonly");
    const store = tx.objectStore("contagens");
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      const todos = req.result || [];
      resolve(todos.filter((r) => r.loteNome === loteNome));
    };
    req.onerror = () => {
      db.close();
      resolve([]);
    };
  });
}

// Deleta um lote e suas contagens
async function deletarLote(loteNome) {
  const db = await openOrUpgradeDB();
  return new Promise((resolve) => {
    const tx = db.transaction(["lotes", "contagens"], "readwrite");

    // Remove o lote
    tx.objectStore("lotes").delete(loteNome);

    // Remove contagens vinculadas
    const storeC = tx.objectStore("contagens");
    const reqAll = storeC.getAll();
    reqAll.onsuccess = () => {
      const ids = (reqAll.result || [])
        .filter((r) => r.loteNome === loteNome)
        .map((r) => r.id);
      ids.forEach((id) => storeC.delete(id));
    };

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}

// -----------------------------------------------
// Renderiza a lista de lotes
// -----------------------------------------------
async function renderizarLotes() {
  const lotes = await getLotes();
  const section = document.getElementById("lotes-section");
  const lista = document.getElementById("lotes-lista");
  const btnLimpar = document.getElementById("limpar-banco");

  lista.innerHTML = "";

  if (lotes.length === 0) {
    section.style.display = "none";
    btnLimpar.style.display = "none";
    return;
  }

  section.style.display = "flex";
  btnLimpar.style.display = "flex";

  // Ordena por data de criação, mais recente primeiro
  lotes.sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));

  for (const lote of lotes) {
    const contagensDoLote = await getContagensDoLote(lote.nome);
    const qtdContados = new Set(contagensDoLote.map((c) => c.codacesso)).size;
    const totalNoLote = (lote.produtos || []).length;
    const totalForaLote = (lote.totalCSV || 0) - totalNoLote;

    const dataFormatada = lote.dataCriacao
      ? new Date(lote.dataCriacao).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    const isAtivo = lote.nome === loteAtivoNome;

    const card = document.createElement("div");
    card.className = "lote-card" + (isAtivo ? " lote-ativo" : "");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("data-nome", lote.nome);
    card.setAttribute("title", "Clique para continuar este lote");
    card.innerHTML = `
      <div class="lote-card-header">
        <div class="lote-info">
          <div class="lote-nome">${lote.nome}</div>
          ${lote.descricao ? `<div class="lote-descricao">${lote.descricao}</div>` : ""}
          <div class="lote-data">Criado em ${dataFormatada}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.5rem;flex-shrink:0">
          ${isAtivo ? '<span class="lote-badge-ativo">Ativo</span>' : ""}
          <button class="btn-excluir-icon" data-nome="${lote.nome}" title="Excluir lote" aria-label="Excluir lote ${lote.nome}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M5 6l1-3h12l1 3"/></svg>
          </button>
        </div>
      </div>
      <div class="lote-stats">
        <button class="stat-pill stat-pill--blue btn-ver-produtos" data-lote='${JSON.stringify({ nome: lote.nome, tipo: "dentro" })}'>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          ${totalNoLote} no lote
        </button>
        <button class="stat-pill stat-pill--gray btn-ver-produtos" data-lote='${JSON.stringify({ nome: lote.nome, tipo: "fora" })}'>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          ${totalForaLote > 0 ? totalForaLote : "?"} fora
        </button>
        <button class="stat-pill stat-pill--blue btn-ver-produtos" style="margin-left:auto" data-lote='${JSON.stringify({ nome: lote.nome, tipo: "contados" })}'>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>
          ${qtdContados} contados
        </button>
      </div>
      <div class="lote-continuar-hint">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Toque no card para continuar as contagens
      </div>
    `;

    lista.appendChild(card);
  }

  // Card inteiro → continuar (exceto clicks em botões internos)
  lista.querySelectorAll(".lote-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      // Ignora se clicou num botão interno
      if (
        e.target.closest(".btn-excluir-icon") ||
        e.target.closest(".btn-ver-produtos")
      )
        return;
      const nome = card.dataset.nome;
      loteAtivoNome = nome;
      sessionStorage.setItem("loteAtivo", nome);
      window.location.href = "contagens.html";
    });

    // Acessibilidade: Enter/Space também ativa
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        card.click();
      }
    });
  });

  // Botão excluir (ícone lixeira)
  lista.querySelectorAll(".btn-excluir-icon").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const nome = btn.dataset.nome;
      const ok = await exibirConfirmacao(
        "Excluir Lote",
        `Deseja excluir o lote "${nome}" e todas as suas contagens?`,
      );
      if (!ok) return;
      await deletarLote(nome);
      if (loteAtivoNome === nome) {
        loteAtivoNome = null;
        sessionStorage.removeItem("loteAtivo");
      }
      await renderizarLotes();
    });
  });

  // Pills de produtos
  lista.querySelectorAll(".btn-ver-produtos").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const dados = JSON.parse(btn.dataset.lote);
      await abrirModalProdutos(dados.nome, dados.tipo);
    });
  });
}

// -----------------------------------------------
// Modal de produtos do lote
// -----------------------------------------------
async function abrirModalProdutos(loteNome, abaInicial = "dentro") {
  const db = await openOrUpgradeDB();
  const lote = await new Promise((resolve) => {
    const tx = db.transaction(["lotes"], "readonly");
    const req = tx.objectStore("lotes").get(loteNome);
    req.onsuccess = () => {
      db.close();
      resolve(req.result);
    };
    req.onerror = () => {
      db.close();
      resolve(null);
    };
  });

  if (!lote) return;

  const produtosDentro = lote.produtos || [];
  const codigosNoLote = new Set((lote.codigosNoLote || []).map(String));

  // Produtos fora = todos do CSV que não estão no lote
  // Como o CSV completo pode não estar disponível aqui, usamos o dadosCSV global se disponível
  let produtosFora = [];
  if (typeof dadosCSV !== "undefined" && dadosCSV.length > 0) {
    produtosFora = dadosCSV.filter(
      (p) => !codigosNoLote.has(String(p.CODACESSO).trim()),
    );
  }

  const modal = document.getElementById("produtos-modal");
  document.getElementById("produtos-modal-title").textContent = loteNome;
  document.getElementById("count-dentro").textContent = produtosDentro.length;
  document.getElementById("count-fora").textContent =
    produtosFora.length || "?";

  // Renderiza lista dentro
  const listaDentro = document.getElementById("lista-dentro");
  listaDentro.innerHTML =
    produtosDentro.length === 0
      ? "<p style='color:var(--clr-text-secondary);font-size:.9rem'>Nenhum produto</p>"
      : produtosDentro
          .map(
            (p) => `
        <div class="produto-item">
          <div class="produto-item-desc">${p.DESCCOMPLETA || ""}</div>
          <div class="produto-item-info">SEQ: ${p.SEQPRODUTO} · COD: ${p.CODACESSO} · EMB: ${p.QTDEMBALAGEM}</div>
        </div>`,
          )
          .join("");

  // Renderiza lista fora
  const listaFora = document.getElementById("lista-fora");
  if (produtosFora.length === 0) {
    listaFora.innerHTML =
      "<p style='color:var(--clr-text-secondary);font-size:.9rem'>Carregue o CSV na tela inicial para ver os produtos fora do lote.</p>";
  } else {
    listaFora.innerHTML = produtosFora
      .map(
        (p) => `
      <div class="produto-item">
        <div class="produto-item-desc">${p.DESCCOMPLETA || ""}</div>
        <div class="produto-item-info">SEQ: ${p.SEQPRODUTO} · COD: ${p.CODACESSO} · EMB: ${p.QTDEMBALAGEM}</div>
      </div>`,
      )
      .join("");
  }

  // Ativa aba correta
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === abaInicial);
  });
  document.querySelectorAll(".tab-content").forEach((div) => {
    div.classList.toggle("active", div.id === `tab-${abaInicial}`);
  });

  modal.style.display = "flex";
}

// -----------------------------------------------
// Modal de confirmação
// -----------------------------------------------
function exibirConfirmacao(titulo, mensagem) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    document.getElementById("modal-title").textContent = titulo;
    document.getElementById("modal-message").textContent = mensagem;
    modal.style.display = "flex";

    const yes = document.getElementById("confirm-yes");
    const no = document.getElementById("confirm-no");

    const cleanup = (result) => {
      modal.style.display = "none";
      yes.replaceWith(yes.cloneNode(true));
      no.replaceWith(no.cloneNode(true));
      resolve(result);
    };

    document
      .getElementById("confirm-yes")
      .addEventListener("click", () => cleanup(true), { once: true });
    document
      .getElementById("confirm-no")
      .addEventListener("click", () => cleanup(false), { once: true });
  });
}

// -----------------------------------------------
// Init
// -----------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Tabs do modal de produtos
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".tab-btn")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(".tab-content")
        .forEach((d) => d.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });

  document
    .getElementById("produtos-modal-close")
    .addEventListener("click", () => {
      document.getElementById("produtos-modal").style.display = "none";
    });

  // Fecha modal clicando no overlay
  document.getElementById("produtos-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = "none";
  });

  // Botão limpar tudo
  document
    .getElementById("limpar-banco")
    .addEventListener("click", async () => {
      const ok1 = await exibirConfirmacao(
        "Apagar Todos os Dados",
        "Deseja limpar todos os lotes e contagens?",
      );
      if (!ok1) return;
      const ok2 = await exibirConfirmacao(
        "Confirmação Final",
        "⚠️ Esta ação é irreversível! Deseja realmente apagar tudo?",
      );
      if (!ok2) return;

      const dbs = await indexedDB.databases();
      for (const dbInfo of dbs) {
        await new Promise((res) => {
          const r = indexedDB.deleteDatabase(dbInfo.name);
          r.onsuccess = res;
          r.onerror = res;
        });
      }
      localStorage.removeItem("estadoContagem");
      sessionStorage.removeItem("loteAtivo");
      location.reload();
    });

  // Botão criar lote
  document.getElementById("criar-lote").addEventListener("click", async () => {
    // Verifica se o CSV foi carregado
    if (!dadosCSV || dadosCSV.length === 0) {
      alert(
        "O arquivo CSV ainda não foi carregado. Verifique se o arquivo 'embalagens com categorias.csv' está na pasta correta.",
      );
      return;
    }

    const usuario = document.getElementById("usuario").value.trim();
    const loja = document.getElementById("loja").value.trim();
    const descricao = document.getElementById("descricao")?.value.trim() || "";

    if (!usuario || !loja) {
      alert("Preencha o usuário e a loja antes de criar o lote!");
      return;
    }

    const checkboxes = document.querySelectorAll(
      "#tree-container input[type='checkbox']:checked",
    );
    const categoriasSelecionadas = Array.from(checkboxes).map(
      (cb) => cb.dataset.path,
    );

    if (categoriasSelecionadas.length === 0) {
      alert("Selecione pelo menos uma categoria antes de criar o lote.");
      return;
    }

    // Filtra e já extrai só os 4 campos necessários (sem os NIVEL 0..7)
    // Isso reduz o tamanho salvo no IndexedDB em ~60%
    const produtosFiltrados = [];
    const codigosNoLote = [];

    for (const produto of dadosCSV) {
      const niveis = [];
      for (let i = 0; i <= 7; i++) {
        const v = produto[`NIVEL ${i}`];
        if (!v) break;
        niveis.push(v);
      }
      const caminho = niveis.join(" > ");
      if (categoriasSelecionadas.some((cat) => caminho.startsWith(cat))) {
        const cod = String(produto.CODACESSO || "").trim();
        produtosFiltrados.push({
          SEQPRODUTO: produto.SEQPRODUTO,
          DESCCOMPLETA: produto.DESCCOMPLETA,
          CODACESSO: produto.CODACESSO,
          QTDEMBALAGEM: produto.QTDEMBALAGEM,
        });
        if (cod) codigosNoLote.push(cod);
      }
    }

    if (produtosFiltrados.length === 0) {
      alert("Nenhum produto encontrado nas categorias selecionadas.");
      return;
    }

    const nomeLote = `${usuario}_${loja}`;

    const btnCriar = document.getElementById("criar-lote");
    btnCriar.disabled = true;
    btnCriar.textContent = "Salvando...";

    try {
      const db = await openOrUpgradeDB();
      const tx = db.transaction(["lotes"], "readwrite");

      const reqPut = tx.objectStore("lotes").put({
        nome: nomeLote,
        usuario,
        loja,
        descricao,
        dataCriacao: new Date().toISOString(),
        produtos: produtosFiltrados,
        codigosNoLote,
        totalCSV: dadosCSV.length,
      });

      reqPut.onsuccess = () => {
        sessionStorage.setItem("loteAtivo", nomeLote);
      };

      tx.oncomplete = () => {
        db.close();
        window.location.href = "contagens.html";
      };

      tx.onerror = (err) => {
        db.close();
        console.error("Erro ao salvar lote:", err);
        btnCriar.disabled = false;
        btnCriar.textContent = "Criar Lote";
        alert("Erro ao salvar o lote: " + (err.target?.error?.message || err));
      };
    } catch (err) {
      console.error("Erro ao abrir IndexedDB:", err);
      btnCriar.disabled = false;
      btnCriar.textContent = "Criar Lote";
      alert("Erro ao abrir banco de dados: " + err.message);
    }
  });

  // Renderiza lotes existentes
  renderizarLotes();
});
