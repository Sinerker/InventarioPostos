/* =============================================
   cadastro-worker.js — baixa e converte o CSV
   =============================================
   Roda FORA da thread principal, então a tela nunca
   trava enquanto o cadastro está sendo processado.

   Por que existe:
   O CSV tem ~148 mil linhas. Transformar isso em
   148 mil objetos JavaScript (um por produto, com 12
   campos cada) consome mais de 150 MB de memória —
   é o que derruba celular fraco.

   O que este worker devolve no lugar:
   - blob     : um único bloco de bytes com as 4 colunas
                que o app realmente usa (SEQ, DESC, COD, QTD),
                separadas por TAB. ~8 MB, sem objetos.
   - offsets  : onde cada linha começa dentro do blob.
   - cats     : o índice da categoria de cada produto (número).
   - caminhos : os ~3.000 caminhos de categoria que existem
                de verdade (em vez de repetir o texto da
                categoria 148 mil vezes).

   Os três primeiros voltam como ArrayBuffer transferível:
   passam para a thread principal sem cópia nenhuma.
   ============================================= */

const SEP = ";";
const TAB = "\t";

// Colunas que o app usa de fato
const COL_SEQ = "SEQPRODUTO";
const COL_DESC = "DESCCOMPLETA";
const COL_COD = "CODACESSO";
const COL_QTD = "QTDEMBALAGEM";
const NIVEIS_MAX = 8; // NIVEL 0 .. NIVEL 7

self.onmessage = async (e) => {
  const { urls } = e.data || {};
  try {
    const resultado = await baixarEConverter(urls || []);
    self.postMessage({ tipo: "pronto", ...resultado }, [
      resultado.blob,
      resultado.offsets,
      resultado.cats,
    ]);
  } catch (err) {
    self.postMessage({
      tipo: "erro",
      mensagem: (err && err.message) || String(err),
    });
  }
};

// -----------------------------------------------
// Buffer de bytes que cresce sozinho
// -----------------------------------------------
function criarBuffer(capacidadeInicial) {
  let buf = new Uint8Array(capacidadeInicial);
  let pos = 0;
  const enc = new TextEncoder();

  return {
    escrever(texto) {
      // pior caso em UTF-8: 3 bytes por unidade UTF-16
      const precisa = texto.length * 3;
      if (pos + precisa > buf.length) {
        let nova = buf.length * 2;
        while (pos + precisa > nova) nova *= 2;
        const novo = new Uint8Array(nova);
        novo.set(buf.subarray(0, pos));
        buf = novo;
      }
      const { written } = enc.encodeInto(texto, buf.subarray(pos));
      pos += written;
    },
    get posicao() {
      return pos;
    },
    finalizar() {
      // devolve só a parte usada, como ArrayBuffer transferível
      return buf.slice(0, pos).buffer;
    },
  };
}

// -----------------------------------------------
// Download em streaming + conversão linha a linha
// -----------------------------------------------
async function baixarEConverter(urls) {
  let resp = null;
  let urlUsada = null;

  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r && r.ok && r.body) {
        resp = r;
        urlUsada = url;
        break;
      }
    } catch (_) {
      // tenta a próxima
    }
  }

  if (!resp) {
    throw new Error("Não foi possível baixar o cadastro (sem conexão?).");
  }

  const versao =
    resp.headers.get("etag") || resp.headers.get("last-modified") || null;

  const leitor = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");

  const saida = criarBuffer(10 * 1024 * 1024);
  const offsets = [0];
  const cats = [];

  // Interna as categorias: cada caminho único vira um número
  const mapaCat = new Map();
  const caminhos = [];
  const niveisPorCat = [];

  let idx = null; // posição de cada coluna no cabeçalho
  let resto = "";
  let bytes = 0;
  let linhas = 0;
  let ultimoAviso = 0;

  const processarLinha = (linha) => {
    if (linha.charCodeAt(linha.length - 1) === 13) {
      linha = linha.slice(0, -1); // \r final (arquivo salvo no Windows)
    }
    if (linha.trim() === "") return;

    const v = linha.split(SEP);

    // Primeira linha não vazia = cabeçalho
    if (idx === null) {
      idx = {};
      for (let i = 0; i < v.length; i++) idx[v[i].trim()] = i;
      return;
    }

    const campo = (nome) => {
      const i = idx[nome];
      return i === undefined || i >= v.length ? "" : v[i].trim();
    };

    // ---- categoria ----
    const niveis = [];
    for (let i = 0; i < NIVEIS_MAX; i++) {
      const n = campo("NIVEL " + i);
      if (!n) break;
      niveis.push(n);
    }
    const caminho = niveis.join(" > ");

    let catId = mapaCat.get(caminho);
    if (catId === undefined) {
      catId = caminhos.length;
      caminhos.push(caminho);
      niveisPorCat.push(niveis);
      mapaCat.set(caminho, catId);
    }
    cats.push(catId);

    // ---- as 4 colunas usadas, separadas por TAB ----
    saida.escrever(
      campo(COL_SEQ) +
        TAB +
        campo(COL_DESC) +
        TAB +
        campo(COL_COD) +
        TAB +
        campo(COL_QTD)
    );
    offsets.push(saida.posicao);

    linhas++;
  };

  while (true) {
    const { done, value } = await leitor.read();

    if (value) {
      bytes += value.byteLength;
      resto += decoder.decode(value, { stream: true });

      // Percorre com ponteiro em vez de ir cortando o texto:
      // cortar a cada linha faria o navegador copiar o bloco
      // inteiro centenas de vezes por chunk.
      let inicio = 0;
      let corte = resto.indexOf("\n", inicio);
      while (corte !== -1) {
        processarLinha(resto.slice(inicio, corte));
        inicio = corte + 1;
        corte = resto.indexOf("\n", inicio);
      }
      if (inicio > 0) resto = resto.slice(inicio);

      if (linhas - ultimoAviso >= 20000) {
        ultimoAviso = linhas;
        self.postMessage({ tipo: "progresso", linhas, bytes });
      }
    }

    if (done) break;
  }

  resto += decoder.decode();
  if (resto) processarLinha(resto); // última linha sem quebra no final

  if (linhas === 0) {
    throw new Error("O cadastro baixado está vazio ou em formato inesperado.");
  }

  return {
    versao,
    urlUsada,
    dataISO: new Date().toISOString(),
    total: linhas,
    caminhos,
    niveisPorCat,
    blob: saida.finalizar(),
    offsets: Int32Array.from(offsets).buffer,
    cats: Int32Array.from(cats).buffer,
  };
}
