// Tenta carregar o CSV com o nome correto (com espaço ou underscore)
const csvCandidates = ["embalagens com categorias.csv"];
let dadosCSV = [];
let todosCodigosCSV = new Set();

async function carregarCSV() {
  let texto = null;

  for (const nome of csvCandidates) {
    try {
      const resp = await fetch(nome);
      if (resp.ok) {
        texto = await resp.text();
        console.log(`CSV carregado: "${nome}"`);
        break;
      }
    } catch (e) {
      // tenta o próximo
    }
  }

  if (!texto) {
    console.error("CSV não encontrado. Nomes tentados:", csvCandidates);
    document.getElementById("tree-container").innerHTML =
      `<h2>Selecione as categorias</h2>
       <p style="color:var(--clr-danger);font-size:.95rem;margin-top:.5rem">
         ⚠️ Arquivo CSV não encontrado.<br>
         Coloque o arquivo <strong>embalagens com categorias.csv</strong> na mesma pasta do index.html.
       </p>`;
    return;
  }

  const linhas = texto.split("\n").filter((l) => l.trim() !== "");
  const cabecalho = linhas[0].split(";").map((c) => c.trim());

  dadosCSV = linhas.slice(1).map((linha) => {
    const valores = linha.split(";").map((v) => v.trim());
    const item = {};
    cabecalho.forEach((chave, i) => (item[chave] = valores[i] || ""));
    return item;
  });

  dadosCSV.forEach((p) => {
    if (p.CODACESSO) todosCodigosCSV.add(String(p.CODACESSO).trim());
  });

  console.log(`CSV: ${dadosCSV.length} produtos carregados.`);
  criarArvoreCategorias();
}

function criarEstruturaHierarquica(dados) {
  const arvore = {};
  dados.forEach((item) => {
    let nivelAtual = arvore;
    for (let i = 0; i <= 7; i++) {
      const chave = item[`NIVEL ${i}`]?.trim();
      if (!chave) break;
      if (!nivelAtual[chave]) nivelAtual[chave] = {};
      nivelAtual = nivelAtual[chave];
    }
  });
  return arvore;
}

function gerarHTMLArvore(obj, caminhoAtual = "") {
  const ul = document.createElement("ul");

  for (const chave in obj) {
    const li = document.createElement("li");
    li.classList.add("tree-node");

    const caminhoCompleto = caminhoAtual ? `${caminhoAtual} > ${chave}` : chave;
    const temFilhos = Object.keys(obj[chave]).length > 0;

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
      const subUl = gerarHTMLArvore(obj[chave], caminhoCompleto);
      subUl.classList.add("tree-children");
      li.appendChild(subUl);

      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const aberto = subUl.classList.toggle("open");
        toggle.classList.toggle("open", aberto);
        toggle.textContent = aberto ? "▼" : "▶";
      });
    }

    ul.appendChild(li);
  }

  return ul;
}

function criarArvoreCategorias() {
  const estrutura = criarEstruturaHierarquica(dadosCSV);
  const container = document.getElementById("tree-container");
  container.innerHTML = "<h2>Selecione as categorias</h2>";
  container.appendChild(gerarHTMLArvore(estrutura));
}

// Propaga check para filhos
document.addEventListener("change", function (e) {
  if (!e.target.classList.contains("tree-checkbox")) return;
  const li = e.target.closest("li");
  if (!li) return;
  li.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    cb.checked = e.target.checked;
  });
});

document.addEventListener("DOMContentLoaded", carregarCSV);
