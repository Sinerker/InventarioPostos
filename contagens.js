/* =============================================
   contagens.js — estado, foco e scroll
   ============================================= */

document.addEventListener("DOMContentLoaded", () => {

  // -----------------------------------------------
  // Salvar / restaurar estado dos campos de posição
  // -----------------------------------------------
  function salvarEstado() {
    const estado = {
      corredor: document.getElementById("corredor")?.value || "",
      coluna:   document.getElementById("coluna")?.value   || "",
      andar:    document.getElementById("andar")?.value    || "",
      radio:    document.querySelector('input[name="tipo-contagem"]:checked')?.value || "",
    };
    localStorage.setItem("estadoContagem", JSON.stringify(estado));
  }

  function restaurarEstado() {
    try {
      const raw = localStorage.getItem("estadoContagem");
      if (!raw) return;
      const { corredor, coluna, andar, radio } = JSON.parse(raw);
      if (corredor) document.getElementById("corredor").value = corredor;
      if (coluna)   document.getElementById("coluna").value   = coluna;
      if (andar)    document.getElementById("andar").value    = andar;
      if (radio) {
        const r = document.querySelector(`input[name="tipo-contagem"][value="${radio}"]`);
        if (r) r.checked = true;
      }
    } catch {}
  }

  restaurarEstado();

  ["corredor", "coluna", "andar"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", salvarEstado);
  });
  document.querySelectorAll('input[name="tipo-contagem"]').forEach((r) => {
    r.addEventListener("change", salvarEstado);
  });

  // -----------------------------------------------
  // Tela cheia
  // -----------------------------------------------
  document.getElementById("fullscreen-btn")?.addEventListener("click", async () => {
    try { await document.documentElement.requestFullscreen(); } catch {}
  });
  document.addEventListener("fullscreenchange", () => {
    const btn = document.getElementById("fullscreen-btn");
    if (!btn) return;
    btn.style.opacity = document.fullscreenElement ? "0" : "1";
  });

  // -----------------------------------------------
  // FOCO TRAVADO
  // Quando o usuário está digitando num input/select,
  // tocar em qualquer área fora não remove o foco.
  // -----------------------------------------------
  let focoAtivo = null;

  const inputsInterativos = ["codigo", "quantidade", "corredor", "coluna", "andar"];

  function isInterativo(el) {
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "SELECT" ||
      tag === "BUTTON" ||
      tag === "LABEL" ||
      el.classList.contains("cnt-result-item") ||
      el.classList.contains("cnt-radio-pill") ||
      el.classList.contains("cnt-radio-label") ||
      el.classList.contains("cnt-toggle") ||
      el.closest(".cnt-result-item") ||
      el.closest(".cnt-radio-label") ||
      el.closest(".cnt-toggle") ||
      el.closest(".cnt-header") ||
      el.closest(".modal-overlay") ||
      el.closest(".fora-lote-overlay")
    );
  }

  document.addEventListener("touchstart", (e) => {
    if (focoAtivo && !isInterativo(e.target)) {
      e.preventDefault();
      focoAtivo.focus();
    }
  }, { passive: false });

  document.addEventListener("mousedown", (e) => {
    if (focoAtivo && !isInterativo(e.target)) {
      e.preventDefault();
      focoAtivo.focus();
    }
  });

  inputsInterativos.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("focus", () => { focoAtivo = el; });
  });

  // Reseta foco ativo ao clicar em botões de ação
  document.querySelectorAll(".cnt-icon-btn, .cnt-export-btn, .cnt-radio-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      focoAtivo = null;
    });
  });

  // -----------------------------------------------
  // Scroll ao focar campos
  // -----------------------------------------------
  function scrollParaElemento(el) {
    if (!el) return;
    setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }

  document.getElementById("codigo")?.addEventListener("focus", () => {
    scrollParaElemento(document.getElementById("codigo"));
  });

  document.getElementById("quantidade")?.addEventListener("focus", () => {
    scrollParaElemento(document.getElementById("resultado"));
  });

});
