const express = require("express");
const multer  = require("multer");
const cors    = require("cors");
const fs      = require("fs");
const path    = require("path");
const { v4: uuidv4 } = require("uuid");
const pdfParse    = require("pdf-parse");
const dicomParser = require("dicom-parser");

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());


// ── Funções de leitura de PDF ──────────────────────────────────────────────────

async function extrairTextoPdf(buffer) {
  const data = await pdfParse(buffer);
  return data.text;
}

function limparTexto(texto) {
  return texto
    .replace(/\xa0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function extrairDadosBasicos(texto) {
  const padroes = {
    paciente:          /Paciente:\s*(.+)/i,
    sexo:              /Sexo:\s*(Masculino|Feminino|M|F)/i,
    idade:             /Idade:\s*(\d+)/i,
    data_coleta:       /Data da coleta:\s*(\d{2}\/\d{2}\/\d{4})/i,
    data_emissao:      /Data de emissão:\s*(\d{2}\/\d{2}\/\d{4})/i,
    medico_solicitante:/Médico solicitante:\s*(.+)/i,
    protocolo:         /Protocolo:\s*([A-Z0-9\-]+)/i,
    convenio:          /Convênio:\s*(.+)/i,
  };

  const dados = {};
  for (const [campo, padrao] of Object.entries(padroes)) {
    const match = texto.match(padrao);
    dados[campo] = match ? match[1].split("\n")[0].trim() : null;
  }
  return dados;
}

function extrairResultadosLaboratoriais(texto) {
  const resultados = [];
  const linhas = texto.split("\n");

  let inicioTabela = null;
  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i].includes("Exame") && linhas[i].includes("Resultado") && linhas[i].includes("Unidade")) {
      inicioTabela = i + 1;
      break;
    }
  }

  if (inicioTabela === null) return resultados;

  const buffer = [];
  for (let i = inicioTabela; i < linhas.length; i++) {
    const linha = linhas[i].trim();
    if (!linha) continue;
    if (linha.includes("Observações")) break;
    buffer.push(linha);
  }

  for (let i = 0; i < buffer.length; i += 4) {
    const bloco = buffer.slice(i, i + 4);
    if (bloco.length === 4) {
      const [exame, resultado, unidade, referencia] = bloco;
      if (!["exame", "resultado", "unidade", "referência"].includes(exame.toLowerCase())) {
        resultados.push({ exame, resultado, unidade, referencia });
      }
    }
  }

  return resultados;
}

async function processarExamePdf(buffer) {
  const textoLimpo = limparTexto(await extrairTextoPdf(buffer));
  return {
    tipo: "pdf",
    dados_basicos: extrairDadosBasicos(textoLimpo),
    exames: extrairResultadosLaboratoriais(textoLimpo),
  };
}


// ── Funções de leitura de DICOM ────────────────────────────────────────────────

function processarExameDicom(buffer) {
  const byteArray = new Uint8Array(buffer);
  const dataSet   = dicomParser.parseDicom(byteArray);

  const ler = (tag) => { try { return dataSet.string(tag) || null; } catch { return null; } };

  return {
    tipo: "dicom",
    dados_basicos: {
      paciente:          ler("x00100010"),
      data_nascimento:   ler("x00100030"),
      sexo:              ler("x00100040"),
      id_paciente:       ler("x00100020"),
      data_exame:        ler("x00080020"),
      hora_exame:        ler("x00080030"),
      descricao_estudo:  ler("x00081030"),
      modalidade:        ler("x00080060"),
      instituicao:       ler("x00080080"),
      medico_solicitante:ler("x00080090"),
      descricao_serie:   ler("x0008103e"),
      fabricante:        ler("x00080070"),
      modelo_equipamento:ler("x00081090"),
    },
    exames: [],
  };
}


// ── Classe de Triagem ──────────────────────────────────────────────────────────

class TriagemMedica {
  static CONDUTAS = {
    ALTO:  "EMERGÊNCIA: Procure pronto-socorro IMEDIATAMENTE",
    BAIXO: "Monitore sintomas, procure médico se piorarem",
  };

  static RED_FLAGS_PERGUNTAS = [
    ["dor_peito",            "Você está sentindo dor no peito?"],
    ["dificuldade_respirar", "Está com dificuldade para respirar ou falta de ar?"],
    ["confusao_mental",      "Está com confusão mental ou tontura intensa?"],
    ["sangramento",          "Há algum sangramento?"],
    ["febre_alta",           "Está com febre muito alta (acima de 39 °C)?"],
  ];

  constructor() {
    this.sessao    = {};
    this.etapa     = "inicio";
    this.flagIndex = 0;
  }

  iniciar() {
    this.sessao = {
      dados:            {},
      queixaPrincipal:  "",
      redFlags:         [],
      exame:            null,
      timestamp:        new Date().toISOString(),
    };
    this.flagIndex = 0;
    this.etapa     = "nome";
    return "Olá! Sou seu assistente de triagem médica. Qual é o seu nome?";
  }

  processar(mensagem) {
    const msg = mensagem.trim().replace(/[<>]/g, "");

    if (this.etapa === "nome") {
      this.sessao.dados.nome = msg;
      this.etapa = "idade";
      return `Prazer, ${msg}! Qual sua idade?`;
    }

    if (this.etapa === "idade") {
      const match = msg.match(/\d+/);
      if (!match) return "Por favor, informe apenas sua idade em números.";
      this.sessao.dados.idade = parseInt(match[0], 10);
      this.etapa = "queixa";
      return "Qual o principal problema que está sentindo?";
    }

    if (this.etapa === "queixa") {
      this.sessao.queixaPrincipal = msg;
      this.flagIndex = 0;
      this.etapa = "red_flag";
      return (
        "Preciso verificar alguns sinais importantes. " +
        "Responda SIM ou NÃO para cada pergunta.\n\n" +
        TriagemMedica.RED_FLAGS_PERGUNTAS[0][1]
      );
    }

    if (this.etapa === "red_flag") {
      const resposta = msg.toLowerCase().trim();
      if (!["sim", "não", "nao", "s", "n"].includes(resposta)) {
        return (
          "Por favor, responda apenas SIM ou NÃO.\n" +
          TriagemMedica.RED_FLAGS_PERGUNTAS[this.flagIndex][1]
        );
      }

      const [flagNome] = TriagemMedica.RED_FLAGS_PERGUNTAS[this.flagIndex];
      if (["sim", "s"].includes(resposta)) {
        this.sessao.redFlags.push(flagNome);
      }

      this.flagIndex++;

      if (this.flagIndex < TriagemMedica.RED_FLAGS_PERGUNTAS.length) {
        return TriagemMedica.RED_FLAGS_PERGUNTAS[this.flagIndex][1];
      }

      const resultado = this._calcularResultado();
      this._salvarTriagem(resultado);
      this.etapa = "perguntar_exame";
      return (
        this._formatarResultado(resultado) +
        "\nVocê possui algum exame para anexar? (PDF ou DICOM)\nResponda SIM ou NÃO."
      );
    }

    if (this.etapa === "perguntar_exame") {
      if (["sim", "s"].includes(msg.toLowerCase())) {
        this.etapa = "aguardar_exame";
        return "AGUARDANDO_EXAME";
      }
      this.etapa = "fim";
      return "Triagem encerrada. Obrigado!";
    }

    return "Erro no processamento.";
  }

  registrarExame(dadosExame) {
    this.sessao.exame = dadosExame;
    this._atualizarLogComExame(dadosExame);
    this.etapa = "fim";

    const basicos = dadosExame.dados_basicos;
    const exames  = dadosExame.exames;
    const tipo    = dadosExame.tipo.toUpperCase();

    const linhas = [`Exame ${tipo} recebido e processado com sucesso!`];

    if (basicos.paciente)          linhas.push(`Paciente: ${basicos.paciente}`);
    if (basicos.data_coleta)       linhas.push(`Data da coleta: ${basicos.data_coleta}`);
    if (basicos.data_exame)        linhas.push(`Data do exame: ${basicos.data_exame}`);
    if (basicos.medico_solicitante)linhas.push(`Médico solicitante: ${basicos.medico_solicitante}`);
    if (basicos.modalidade)        linhas.push(`Modalidade: ${basicos.modalidade}`);
    if (basicos.descricao_estudo)  linhas.push(`Estudo: ${basicos.descricao_estudo}`);
    if (basicos.instituicao)       linhas.push(`Instituição: ${basicos.instituicao}`);

    if (exames.length > 0) {
      linhas.push("\nResultados:");
      exames.forEach((e) => {
        linhas.push(`• ${e.exame}: ${e.resultado} ${e.unidade} (ref: ${e.referencia})`);
      });
    }

    linhas.push("\nTriagem encerrada. Obrigado!");
    return linhas.join("\n");
  }

  _calcularResultado() {
    const risco = this.sessao.redFlags.length > 0 ? "ALTO" : "BAIXO";
    return {
      classificacao: risco,
      redFlags:      this.sessao.redFlags,
      conduta:       TriagemMedica.CONDUTAS[risco],
    };
  }

  _formatarResultado(resultado) {
    const nome = this.sessao.dados.nome || "Paciente";
    return (
      `RESULTADO DA TRIAGEM - ${nome}\n` +
      `${"=".repeat(40)}\n` +
      `CLASSIFICAÇÃO: ${resultado.classificacao}\n` +
      `CONDUTA: ${resultado.conduta}\n` +
      `Esta triagem não substitui consulta médica.\n`
    );
  }

  _salvarTriagem(resultado) {
    const log = {
      timestamp: new Date().toISOString(),
      sessao:    this.sessao,
      resultado,
    };
    try {
      fs.appendFileSync("triagem_logs.jsonl", JSON.stringify(log) + "\n", "utf-8");
    } catch (e) {
      console.error("Erro ao salvar log:", e.message);
    }
  }

  _atualizarLogComExame(dadosExame) {
    try {
      const conteudo = fs.readFileSync("triagem_logs.jsonl", "utf-8");
      const linhas   = conteudo.split("\n").filter(Boolean);
      if (linhas.length === 0) return;

      const ultimo      = JSON.parse(linhas[linhas.length - 1]);
      ultimo.exame      = dadosExame;
      linhas[linhas.length - 1] = JSON.stringify(ultimo);

      fs.writeFileSync("triagem_logs.jsonl", linhas.join("\n") + "\n", "utf-8");
    } catch (e) {
      console.error("Erro ao atualizar log com exame:", e.message);
    }
  }
}


// ── Sessões em memória ─────────────────────────────────────────────────────────

const sessoes = new Map();


// ── Rotas ──────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "running" });
});

app.post("/iniciar", (req, res) => {
  const sessionId = req.body.sessionId || uuidv4();
  const triagem   = new TriagemMedica();
  sessoes.set(sessionId, triagem);
  res.json({ status: "ok", sessionId, resposta: triagem.iniciar() });
});

app.post("/triagem", (req, res) => {
  const { sessionId, mensagem } = req.body;

  if (!sessionId || !sessoes.has(sessionId)) {
    return res.status(404).json({ status: "erro", mensagem: "Sessão não encontrada. Use /iniciar primeiro." });
  }

  const triagem  = sessoes.get(sessionId);
  let   resposta = triagem.processar(mensagem);

  const aguardandoExame = resposta === "AGUARDANDO_EXAME";
  if (aguardandoExame) {
    resposta = "Por favor, anexe seu exame clicando no botão abaixo. Aceitamos PDF e DICOM (.dcm).";
  }

  if (triagem.etapa === "fim") sessoes.delete(sessionId);

  res.json({
    status: "ok",
    sessionId,
    etapa:          triagem.etapa,
    resposta,
    aguardandoExame,
    sessao:         triagem.sessao,
  });
});

app.post("/upload-exame", upload.single("arquivo"), async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId || !sessoes.has(sessionId)) {
    return res.status(404).json({ status: "erro", mensagem: "Sessão não encontrada." });
  }

  if (!req.file) {
    return res.status(400).json({ status: "erro", mensagem: "Nenhum arquivo enviado." });
  }

  const nomeArquivo = req.file.originalname.toLowerCase();
  const buffer      = req.file.buffer;
  const triagem     = sessoes.get(sessionId);

  try {
    let dadosExame;

    if (nomeArquivo.endsWith(".pdf")) {
      dadosExame = await processarExamePdf(buffer);
    } else if (nomeArquivo.endsWith(".dcm") || nomeArquivo.endsWith(".dicom")) {
      dadosExame = processarExameDicom(buffer);
    } else {
      return res.status(400).json({ status: "erro", mensagem: "Formato não suportado. Envie um arquivo PDF ou DICOM (.dcm)." });
    }

    const resposta = triagem.registrarExame(dadosExame);
    sessoes.delete(sessionId);

    res.json({
      status: "ok",
      sessionId,
      etapa:   triagem.etapa,
      resposta,
      exame:   dadosExame,
    });

  } catch (e) {
    console.error("Erro ao processar exame:", e.message);
    res.status(500).json({ status: "erro", mensagem: `Erro ao processar arquivo: ${e.message}` });
  }
});


// ── Servidor ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API iniciada em http://0.0.0.0:${PORT}`);
});
