/* =============================================
   contagens-exportar.js — exportação CSV + TXT
   ============================================= */

function abrirDBExport() {
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

async function exportarContagens() {
  const db = await abrirDBExport();

  if (!db.objectStoreNames.contains("contagens")) {
    alert("Nenhuma contagem encontrada para exportar.");
    db.close();
    return;
  }

  const loteNome = sessionStorage.getItem("loteAtivo");

  const tx = db.transaction(["contagens"], "readonly");
  // Usa índice se tiver lote ativo, senão pega tudo
  const req = loteNome
    ? tx.objectStore("contagens").index("loteNome").getAll(loteNome)
    : tx.objectStore("contagens").getAll();

  req.onsuccess = () => {
    const contagens = req.result || [];
    db.close();

    if (contagens.length === 0) {
      alert("Nenhuma contagem registrada.");
      return;
    }

    const usuario = (contagens[0].usuario || "USUARIO").toUpperCase();
    const loja    = (contagens[0].loja    || "LOJA").toUpperCase();
    const data    = new Date().toISOString().split("T")[0];

    /* ---- 1. CSV detalhado (com BOM UTF-8 para Excel) ---- */
    const cabecalho =
      "DATA;HORA;USUARIO;TIPO-CONTAGEM;CORREDOR;COLUNA;ANDAR;SEQPRODUTO;CODACESSO;DESCCOMPLETA;QTDEMBALAGEM;QUANTIDADE;";

    const linhas = contagens.map((r) => {
      let dStr = "", hStr = "";
      if (r.dataHora) {
        const dt = new Date(r.dataHora);
        const pad = (n) => String(n).padStart(2, "0");
        dStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        hStr = `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
      }
      return [
        dStr, hStr,
        (r.usuario      || "").toUpperCase(),
        (r.tipoContagem || "").toUpperCase(),
        (r.corredor     || "").toUpperCase(),
        (r.coluna       || "").toUpperCase(),
        (r.andar        || "").toUpperCase(),
        (r.seqproduto   || "").toString().toUpperCase(),
        (r.codacesso    || "").toString().toUpperCase(),
        (r.desccompleta || "").toString().toUpperCase(),
        (r.qtdeembalagem|| "").toString().toUpperCase(),
        (r.quantidade   || "").toString().toUpperCase(),
      ].join(";");
    });

    // Fix: ﻿ = BOM UTF-8 — garante que o Excel leia acentos corretamente
    const csv = "﻿" + [cabecalho, ...linhas].join("\n");
    baixarArquivo(csv, `${usuario}_${loja}_${data}.csv`, "text/csv;charset=utf-8;");

    /* ---- 2. TXT concatenado ---- */
    const agrupado = {};
    contagens.forEach((r) => {
      const cod = String(r.codacesso || "").trim();
      const qtd = parseFloat(r.quantidade) || 0;
      if (cod) agrupado[cod] = (agrupado[cod] || 0) + qtd;
    });

    const linhasConcat = Object.entries(agrupado)
      .filter(([, qtd]) => qtd > 0)
      .map(([cod, qtd]) => {
        const p1 = "000000";
        const p2 = cod.padStart(14, "0");
        const p3 = Math.round(qtd).toString().padStart(7, "0");
        return p1 + p2 + p3;
      });

    baixarArquivo(
      linhasConcat.join("\n"),
      `${usuario}_${loja}_${data}_CONCATENADO.txt`,
      "text/plain;charset=utf-8;"
    );
  };

  req.onerror = (e) => {
    db.close();
    console.error("Erro ao exportar:", e.target.error);
  };
}

function baixarArquivo(conteudo, nomeArquivo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("exportar-contagens")?.addEventListener("click", exportarContagens);
});
