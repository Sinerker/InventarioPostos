/* =============================================
   contagens-salvar.js — busca, salvar, sons, modal
   ============================================= */

let produtosLote = [];
let codigosNoLoteSet = new Set(); // códigos dentro do lote
let loteAtual = null;
let produtoSelecionado = null; // produto atualmente exibido na tela

// -----------------------------------------------
// Sons via Web Audio API
// -----------------------------------------------
const audioCtx = (() => {
  try { return new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
})();

function tocarSom(tipo) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  if (tipo === "sucesso") {
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.25);
  } else {
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, audioCtx.currentTime);
    osc.frequency.setValueAtTime(180, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.3);
  }
}

// -----------------------------------------------
// IndexedDB — versão 2 com índice em loteNome
// Compatível com lote.js que também abre versão 2
// -----------------------------------------------
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("InventarioDB", 2);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains("lotes")) {
        db.createObjectStore("lotes", { keyPath: "nome" });
      }

      if (!db.objectStoreNames.contains("contagens")) {
        const store = db.createObjectStore("contagens", { keyPath: "id", autoIncrement: true });
        store.createIndex("loteNome", "loteNome", { unique: false });
      } else if (e.oldVersion < 2) {
        // Migração v1 → v2: adiciona índice na store existente
        const store = e.target.transaction.objectStore("contagens");
        if (!store.indexNames.contains("loteNome")) {
          store.createIndex("loteNome", "loteNome", { unique: false });
        }
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// -----------------------------------------------
// Carrega produtos do lote ativo
// -----------------------------------------------
async function carregarProdutosDoLote() {
  const loteNome = sessionStorage.getItem("loteAtivo");
  const db = await abrirDB();
  if (!db.objectStoreNames.contains("lotes")) { db.close(); return; }

  return new Promise((resolve) => {
    const tx = db.transaction(["lotes"], "readonly");
    const req = tx.objectStore("lotes").getAll();
    req.onsuccess = () => {
      db.close();
      const lotes = req.result || [];
      let lote = loteNome ? lotes.find((l) => l.nome === loteNome) : null;
      if (!lote && lotes.length > 0) lote = lotes[lotes.length - 1]; // fallback: último lote
      if (!lote) { resolve(); return; }

      loteAtual = { nome: lote.nome, usuario: lote.usuario, loja: lote.loja };
      produtosLote = lote.produtos || [];
      codigosNoLoteSet = new Set((lote.codigosNoLote || produtosLote.map((p) => String(p.CODACESSO).trim())));

      const headerNome = document.getElementById("lote-nome-header");
      if (headerNome) headerNome.textContent = lote.nome;

      atualizarContagensHeader();
      resolve();
    };
    req.onerror = () => { db.close(); resolve(); };
  });
}

async function atualizarContagensHeader() {
  if (!loteAtual) return;
  try {
    const db = await abrirDB();
    if (!db.objectStoreNames.contains("contagens")) { db.close(); return; }
    const tx = db.transaction(["contagens"], "readonly");
    const store = tx.objectStore("contagens");
    // Usa índice para contar só as contagens do lote atual
    const req = store.index("loteNome").count(loteAtual.nome);
    req.onsuccess = () => {
      db.close();
      const total = req.result || 0;
      const el = document.getElementById("lote-contagens-header");
      if (el) el.textContent = `${total} contagem${total !== 1 ? "s" : ""}`;
      const badge = document.getElementById("total-contagens-badge");
      if (badge) badge.textContent = total;
    };
    req.onerror = () => db.close();
  } catch {}
}

// -----------------------------------------------
// Toast / feedback
// -----------------------------------------------
function toast(msg, tipo = "erro") {
  const old = document.querySelector(".cnt-toast");
  if (old) old.remove();

  const div = document.createElement("div");
  div.className = "cnt-toast";
  div.style.cssText = `
    position:fixed; top:70px; left:50%; transform:translateX(-50%);
    background:${tipo === "erro" ? "#d93025" : "#1e8c45"};
    color:#fff; padding:10px 16px; border-radius:10px;
    font-weight:700; font-size:.9rem;
    box-shadow:0 4px 12px rgba(0,0,0,.25); z-index:9999;
    animation: toastIn .2s ease;
    white-space:nowrap;
  `;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => { div.style.opacity = "0"; div.style.transition = "opacity .3s"; }, 1700);
  setTimeout(() => div.remove(), 2100);
}

// -----------------------------------------------
// Modal: produto fora do lote
// -----------------------------------------------
let foraLoteTimer = null;

function mostrarForaLote(prod) {
  const overlay = document.getElementById("fora-lote-modal");
  const sub = document.getElementById("fora-lote-desc");
  if (!overlay) return;

  sub.textContent = prod ? prod.DESCCOMPLETA || "" : "";
  overlay.style.display = "block";

  if (foraLoteTimer) clearTimeout(foraLoteTimer);
  foraLoteTimer = setTimeout(() => {
    overlay.style.display = "none";
  }, 2000);
}

// -----------------------------------------------
// Modal: ver contagens do lote
// -----------------------------------------------
async function abrirModalContagens() {
  if (!loteAtual) return;
  const db = await abrirDB();
  if (!db.objectStoreNames.contains("contagens")) { db.close(); return; }

  const tx = db.transaction(["contagens"], "readonly");
  // Usa índice para buscar só as contagens do lote atual
  const req = tx.objectStore("contagens").index("loteNome").getAll(loteAtual.nome);
  req.onsuccess = () => {
    db.close();
    const todas = (req.result || []).sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora));

    const lista = document.getElementById("contagens-modal-lista");
    const badge = document.getElementById("total-contagens-badge");
    if (badge) badge.textContent = todas.length;

    if (todas.length === 0) {
      lista.innerHTML = `<p style="color:var(--clr-text-secondary);font-size:.9rem">Nenhuma contagem registrada ainda.</p>`;
    } else {
      lista.innerHTML = todas.map((r) => {
        const hora = r.dataHora ? new Date(r.dataHora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
        const local = [r.corredor, r.coluna, r.andar].filter(Boolean).join("-");
        return `
          <div class="cnt-log-item">
            <div class="cnt-log-desc">${r.desccompleta || r.codacesso}</div>
            <div class="cnt-log-info">
              COD: ${r.codacesso} · EMB: ${r.qtdeembalagem}
              ${local ? ` · ${local}` : ""} · ${hora}
            </div>
            <div class="cnt-log-qty">Qtd: ${r.quantidade}</div>
          </div>`;
      }).join("");
    }

    document.getElementById("contagens-modal").style.display = "flex";
  };
  req.onerror = () => db.close();
}

// -----------------------------------------------
// UI helpers: exibir produto
// -----------------------------------------------
function exibirProduto(prod) {
  produtoSelecionado = prod; // armazena referência segura ao objeto
  document.getElementById("resultado").innerHTML = `
    <div class="cnt-produto-card">
      <div class="cnt-produto-seq">SEQ: ${prod.SEQPRODUTO}</div>
      <div class="cnt-produto-desc">${prod.DESCCOMPLETA}</div>
      <div class="cnt-produto-cod">Cód: ${prod.CODACESSO}</div>
      <div class="cnt-produto-emb">Emb.: ${prod.QTDEMBALAGEM}</div>
    </div>`;
}

function exibirLista(lista) {
  const resultado = document.getElementById("resultado");
  resultado.innerHTML = "";
  produtoSelecionado = null;

  if (!lista || lista.length === 0) {
    resultado.innerHTML = `<div class="cnt-error-msg">Nenhum produto encontrado</div>`;
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "cnt-result-list";

  lista.forEach((prod) => {
    const li = document.createElement("li");
    li.className = "cnt-result-item";
    li.innerHTML = `
      <div class="cnt-result-item-desc">${prod.DESCCOMPLETA}</div>
      <div class="cnt-result-item-info">SEQ: ${prod.SEQPRODUTO} · COD: ${prod.CODACESSO} · EMB: ${prod.QTDEMBALAGEM}</div>`;

    li.addEventListener("click", async () => {
      const chk = document.getElementById("qtde1");
      exibirProduto(prod); // também seta produtoSelecionado
      if (chk && chk.checked) {
        document.getElementById("quantidade").value = 1;
        await onConfirmarQuantidade();
      } else {
        await preencherSoma(prod);
        focusQuantidade();
      }
    });

    ul.appendChild(li);
  });
  resultado.appendChild(ul);
}

function mostrarUltimoContado(r) {
  const container = document.getElementById("ultimo-contado");
  if (!container) return;
  container.innerHTML = `
    <div class="cnt-ultimo">
      <div class="cnt-ultimo-title">Último contado</div>
      <div class="cnt-ultimo-info">
        <strong>${r.desccompleta}</strong><br>
        COD: ${r.codacesso} · EMB: ${r.qtdeembalagem}
      </div>
      <div class="cnt-ultimo-qty">Qtd: ${r.quantidade}</div>
    </div>`;
}

// -----------------------------------------------
// Busca helpers
// -----------------------------------------------
function removerAcentos(txt) {
  return txt.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function isProbablyCode(txt) {
  return /^\d+$/.test(txt.trim());
}

function buscarPorCodigo(v) {
  return produtosLote.filter((p) => String(p.CODACESSO || "").trim() === v.trim());
}

function buscarPorNome(v) {
  const palavras = removerAcentos(v).trim().split(/\s+/).filter(Boolean);
  return produtosLote.filter((p) => {
    const nome = removerAcentos(p.DESCCOMPLETA || "");
    return palavras.every((w) => nome.includes(w));
  });
}

// -----------------------------------------------
// Soma contagens existentes (usa índice)
// -----------------------------------------------
async function somaExistentes(prod) {
  const db = await abrirDB();
  if (!db.objectStoreNames.contains("contagens")) { db.close(); return 0; }
  return new Promise((resolve) => {
    const tx = db.transaction(["contagens"], "readonly");
    const req = tx.objectStore("contagens").index("loteNome").getAll(loteAtual?.nome);
    req.onsuccess = () => {
      db.close();
      const soma = (req.result || []).reduce((acc, r) => {
        if (String(r.codacesso) === String(prod.CODACESSO)) acc += Number(r.quantidade) || 0;
        return acc;
      }, 0);
      resolve(soma);
    };
    req.onerror = () => { db.close(); resolve(0); };
  });
}

async function preencherSoma(prod) {
  const soma = await somaExistentes(prod);
  const q = document.getElementById("quantidade");
  q.value = soma || "";
  if (soma) focusQuantidade();
}

// -----------------------------------------------
// Salvar contagem
// -----------------------------------------------
async function salvarContagem(record) {
  const db = await abrirDB();
  const tx = db.transaction(["contagens"], "readwrite");
  tx.objectStore("contagens").add(record);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = (e) => { db.close(); reject(e.target.error); };
  });
}

// -----------------------------------------------
// Focus helpers
// -----------------------------------------------
function focusCodigo() {
  const c = document.getElementById("codigo");
  if (c) { c.focus(); c.select(); }
}

function focusQuantidade() {
  const q = document.getElementById("quantidade");
  if (!q) return;
  if (window.matchMedia("(pointer: coarse)").matches) {
    q.setAttribute("inputmode", "none");
    q.focus();
    q.select();
    q.addEventListener("click", function () {
      q.setAttribute("inputmode", "decimal");
      q.blur();
      q.focus();
    }, { once: true });
  } else {
    q.focus();
    q.select();
  }
}

// -----------------------------------------------
// Evento Enter no código
// -----------------------------------------------
async function onCodigoEnter(e) {
  if (e.key !== "Enter") return;
  const v = e.target.value.trim();
  if (!v) return focusCodigo();

  if (!produtosLote.length) {
    toast("Nenhum produto carregado no lote.");
    tocarSom("erro");
    return;
  }

  const chk = document.getElementById("qtde1");

  if (isProbablyCode(v)) {
    const r = buscarPorCodigo(v);

    if (r.length === 0) {
      if (!codigosNoLoteSet.has(v)) {
        mostrarForaLote({ DESCCOMPLETA: `Código ${v}` });
        tocarSom("erro");
        document.getElementById("resultado").innerHTML = "";
        produtoSelecionado = null;
        return focusCodigo();
      }
      document.getElementById("resultado").innerHTML = `<div class="cnt-error-msg">Nenhum produto encontrado</div>`;
      produtoSelecionado = null;
      tocarSom("erro");
      return focusCodigo();
    }

    const p = r[0];
    exibirProduto(p);

    if (chk && chk.checked) {
      document.getElementById("quantidade").value = 1;
      await onConfirmarQuantidade();
    } else {
      await preencherSoma(p);
      focusQuantidade();
    }

  } else {
    const r = buscarPorNome(v);

    if (r.length === 0) {
      document.getElementById("resultado").innerHTML = `<div class="cnt-error-msg">Nenhum produto encontrado</div>`;
      produtoSelecionado = null;
      tocarSom("erro");
      return focusCodigo();
    }

    if (chk && chk.checked && r.length === 1) {
      exibirProduto(r[0]);
      document.getElementById("quantidade").value = 1;
      await onConfirmarQuantidade();
    } else {
      exibirLista(r);
    }
  }
}

// -----------------------------------------------
// Confirmar quantidade (Enter no campo qtd)
// -----------------------------------------------
async function onConfirmarQuantidade() {
  const qtdEl = document.getElementById("quantidade");
  const codigoEl = document.getElementById("codigo");
  const resultado = document.getElementById("resultado");

  const corredor = document.getElementById("corredor")?.value.trim();
  const coluna   = document.getElementById("coluna")?.value.trim();
  const andar    = document.getElementById("andar")?.value.trim();

  // Fix: removida verificação redundante (coluna === "" já coberta por !coluna)
  if (!corredor || !coluna || !andar) {
    toast("Preencha Corredor, Coluna e Andar antes de salvar!");
    tocarSom("erro");
    return;
  }

  const qtdRaw = qtdEl.value.trim();
  const qtd = qtdRaw === "" ? NaN : Number(qtdRaw);

  if (Number.isNaN(qtd) || Math.abs(qtd) > 999999) {
    toast("Quantidade inválida!");
    tocarSom("erro");
    return qtdEl.select();
  }

  // Fix: usa produtoSelecionado em vez de buscar pelo innerText do DOM
  if (!produtoSelecionado) {
    toast("Nenhum produto selecionado.");
    tocarSom("erro");
    return focusCodigo();
  }

  const prod = produtoSelecionado;

  if (qtd === 0) {
    codigoEl.value = "";
    qtdEl.value = "";
    resultado.innerHTML = "";
    produtoSelecionado = null;
    return focusCodigo();
  }

  const reg = {
    loteNome:      loteAtual?.nome || null,
    usuario:       loteAtual?.usuario || null,
    loja:          loteAtual?.loja || null,
    tipoContagem:  document.querySelector("input[name='tipo-contagem']:checked")?.value || "",
    corredor,
    coluna,
    andar,
    seqproduto:    prod.SEQPRODUTO,
    desccompleta:  prod.DESCCOMPLETA,
    codacesso:     prod.CODACESSO,
    qtdeembalagem: prod.QTDEMBALAGEM,
    quantidade:    qtd,
    dataHora: (() => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    })(),
  };

  try {
    await salvarContagem(reg);
    tocarSom("sucesso");
    mostrarUltimoContado(reg);
    atualizarContagensHeader();

    codigoEl.value = "";
    resultado.innerHTML = "";
    produtoSelecionado = null;

    const chk = document.getElementById("qtde1");
    qtdEl.value = (chk && chk.checked) ? "1" : "";
    focusCodigo();
  } catch (err) {
    console.error("Erro ao salvar:", err);
    toast("Erro ao salvar contagem!");
    tocarSom("erro");
  }
}

// -----------------------------------------------
// Toggle QTDE 1
// -----------------------------------------------
function setupCheckboxQtde1() {
  const chk = document.getElementById("qtde1");
  if (!chk) return;
  const qtdEl = document.getElementById("quantidade");

  chk.addEventListener("change", () => {
    if (chk.checked) {
      qtdEl.value = "1";
      qtdEl.readOnly = true;
      qtdEl.style.opacity = ".6";
    } else {
      qtdEl.readOnly = false;
      qtdEl.style.opacity = "1";
      qtdEl.value = "";
    }
  });
}

// -----------------------------------------------
// Init
// -----------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await carregarProdutosDoLote();
  setupCheckboxQtde1();

  const codigo = document.getElementById("codigo");
  const qtd    = document.getElementById("quantidade");

  if (codigo) codigo.addEventListener("keydown", onCodigoEnter);
  if (qtd)    qtd.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onConfirmarQuantidade(); }
  });

  document.getElementById("ver-contagens-btn")?.addEventListener("click", abrirModalContagens);

  document.getElementById("contagens-modal-close")?.addEventListener("click", () => {
    document.getElementById("contagens-modal").style.display = "none";
  });

  document.getElementById("contagens-modal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = "none";
  });

  document.addEventListener("touchstart", () => {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }, { once: true });
});
