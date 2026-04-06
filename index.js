const express = require("express");

const app = express();
app.use(express.json());

// --- Classe TriagemMedica ---

class TriagemMedica {
  constructor() {
    this.sessao = {};
    this.etapa = "inicio";
    this.baseConhecimento = {
      redFlags: {
        dor_peito: "ALTO",
        dificuldade_respirar: "ALTO",
        confusao_mental: "ALTO",
        sangramento: "ALTO",
        febre_alta: "MODERADO",
      },
      condutas: {
        ALTO: "EMERGÊNCIA: Procure pronto-socorro IMEDIATAMENTE",
        MODERADO: "Procure atendimento médico em 2-4 horas",
        BAIXO: "Monitore sintomas, procure médico se piorarem",
      },
    };
  }

  iniciar() {
    this.sessao = {
      dados: {},
      sintomas: [],
      redFlags: [],
      timestamp: new Date().toISOString(),
    };
    this.etapa = "saudacao";
    return this.processar("");
  }

  processar(mensagem) {
    if (this.etapa === "saudacao") {
      this.etapa = "nome";
      return (
        "Olá! Sou seu assistente de triagem médica.\n\n" +
        "Vou avaliar sua situação com algumas perguntas.\n" +
        "Qual é o seu nome?"
      );
    }

    if (this.etapa === "nome") {
      this.sessao.dados.nome = mensagem.trim();
      this.etapa = "idade";
      return `Prazer, ${mensagem.trim()}! Qual sua idade?`;
    }

    if (this.etapa === "idade") {
      const match = mensagem.match(/\d+/);
      if (!match) {
        return "Por favor, informe apenas sua idade em números.";
      }
      this.sessao.dados.idade = parseInt(match[0], 10);
      this.etapa = "queixa";
      return "Qual o principal problema que está sentindo?";
    }

    if (this.etapa === "queixa") {
      this.sessao.queixaPrincipal = mensagem;
      this.etapa = "red_flags";
      return (
        "Preciso verificar alguns sinais importantes.\n\n" +
        "Responda SIM ou NÃO para cada item:\n" +
        "1. Dor no peito?\n" +
        "2. Dificuldade para respirar?\n" +
        "3. Confusão mental/tontura intensa?\n" +
        "4. Sangramento?\n" +
        "5. Febre muito alta (>39°C)?"
      );
    }

    if (this.etapa === "red_flags") {
      this._verificarRedFlags(mensagem);
      this.etapa = "resultado";
      return this._gerarResultado();
    }

    return "Erro no processamento. Inicie uma nova triagem.";
  }

  _verificarRedFlags(mensagem) {
    const texto = mensagem.toLowerCase();
    const flags = [];

    const checks = [
      ["dor_peito", ["peito"]],
      ["dificuldade_respirar", ["respirar", "falta de ar"]],
      ["confusao_mental", ["confus", "tont"]],
      ["sangramento", ["sangr"]],
      ["febre_alta", ["febre", "39"]],
    ];

    for (const [flag, palavras] of checks) {
      if (palavras.some((p) => texto.includes(p)) && texto.includes("sim")) {
        flags.push(flag);
      }
    }

    this.sessao.redFlags = flags;
  }

  _gerarResultado() {
    const redFlags = this.sessao.redFlags;
    let risco = "BAIXO";

    if (redFlags.some((f) => this.baseConhecimento.redFlags[f] === "ALTO")) {
      risco = "ALTO";
    } else if (
      redFlags.some((f) => this.baseConhecimento.redFlags[f] === "MODERADO")
    ) {
      risco = "MODERADO";
    }

    const resultado = {
      classificacao: risco,
      redFlags,
      conduta: this.baseConhecimento.condutas[risco],
    };

    const nome = this.sessao.dados.nome || "Paciente";

    return (
      `\nRESULTADO DA TRIAGEM - ${nome}\n` +
      `${"=".repeat(40)}\n\n` +
      `CLASSIFICAÇÃO: ${risco}\n\n` +
      `CONDUTA RECOMENDADA:\n` +
      `${resultado.conduta}\n\n` +
      `IMPORTANTE: Esta triagem não substitui consulta médica.`
    );
  }
}

// --- Sessões em memória (por sessionId) ---

const sessoes = new Map();

// --- Rotas da API ---

app.post("/iniciar", (req, res) => {
  const sessionId =
    req.body.sessionId || `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const triagem = new TriagemMedica();
  const resposta = triagem.iniciar();

  sessoes.set(sessionId, triagem);

  res.json({ status: "ok", sessionId, resposta });
});

app.post("/triagem", (req, res) => {
  const { sessionId, mensagem } = req.body;

  if (!sessionId || !sessoes.has(sessionId)) {
    return res.status(400).json({
      status: "erro",
      mensagem: "Sessão não encontrada. Use /iniciar primeiro.",
    });
  }

  const triagem = sessoes.get(sessionId);
  const resposta = triagem.processar(mensagem);

  if (triagem.etapa === "resultado") {
    sessoes.delete(sessionId);
  }

  res.json({
    status: "ok",
    etapa: triagem.etapa,
    resposta,
    sessao: triagem.sessao,
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "running" });
});

// --- Servidor ---

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API iniciada em http://0.0.0.0:${PORT}`);
});
