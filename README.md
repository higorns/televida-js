# Bot Chat - Triagem Medica

API de triagem medica com chatbot que coleta dados do paciente e classifica o nivel de risco.

## Pre-requisitos

- [Node.js 22 LTS](https://nodejs.org/)
- Conta AWS com acesso ao App Runner

## Rodar local

```bash
# Instalar dependencias
npm install

# Iniciar o servidor
npm start
```

O servidor sobe em `http://localhost:8080`.

## Endpoints

| Metodo | Rota       | Descricao                  |
|--------|------------|----------------------------|
| POST   | /iniciar   | Inicia uma nova triagem    |
| POST   | /triagem   | Envia resposta do paciente |
| GET    | /health    | Health check               |

### POST /iniciar

Inicia uma sessao de triagem e retorna o `sessionId`.

```bash
curl -X POST http://localhost:8080/iniciar
```

Resposta:

```json
{
  "status": "ok",
  "sessionId": "s_1712000000000_abc123",
  "resposta": "Ola! Sou seu assistente de triagem medica..."
}
```

### POST /triagem

Envia a resposta do paciente. Usar o `sessionId` retornado pelo `/iniciar`.

```bash
curl -X POST http://localhost:8080/triagem \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "s_1712000000000_abc123", "mensagem": "Joao"}'
```

Resposta:

```json
{
  "status": "ok",
  "etapa": "idade",
  "resposta": "Prazer, Joao! Qual sua idade?",
  "sessao": { "dados": { "nome": "Joao" }, "sintomas": [], "redFlags": [] }
}
```

### GET /health

```bash
curl http://localhost:8080/health
```

Resposta:

```json
{ "status": "running" }
```

## Deploy no AWS App Runner

O projeto inclui o arquivo `apprunner.yaml` que configura build e runtime automaticamente.

### 1. Conectar o GitHub na AWS

1. Acesse o console AWS e va em **App Runner**
2. Clique em **GitHub connections** no menu lateral
3. Clique em **Add new** e autorize o acesso ao seu repositorio GitHub
4. Aguarde o status da conexao ficar como **Available**

### 2. Criar o servico

1. No App Runner, clique em **Create service**
2. Em **Source**, selecione **Source code repository**
3. Selecione a conexao GitHub criada no passo anterior
4. Escolha o repositorio `bot_chat` e a branch `main`
5. Marque **Automatic** em deployment trigger (deploy automatico a cada push)
6. Em **Configuration**, selecione **Use a configuration file** — o App Runner vai ler o `apprunner.yaml` do repositorio
7. Clique em **Next**

### 3. Configurar o servico

1. De um nome ao servico (ex: `bot-chat-triagem`)
2. Em **Instance configuration**, selecione:
   - CPU: **0.25 vCPU**
   - Memory: **0.5 GB**
3. Em **Health check**, configure:
   - Protocol: **HTTP**
   - Path: `/health`
   - Interval: **10s**
4. Clique em **Next**, revise e clique em **Create & deploy**

### 4. Acessar o servico

1. Aguarde o status mudar para **Running** (leva alguns minutos)
2. A URL publica aparece no topo da pagina do servico (ex: `https://xxxxx.us-east-1.awsapprunner.com`)
3. Teste com: `curl https://xxxxx.us-east-1.awsapprunner.com/health`

### 5. Novos deploys

Com o deployment automatico ativado, basta fazer push na branch `main` e o App Runner faz o deploy sozinho. O status do deploy pode ser acompanhado na aba **Deployments** do servico.

## Estrutura do projeto

```
bot_chat/
  index.js          # API + logica de triagem
  package.json      # Dependencias
  apprunner.yaml    # Configuracao do App Runner
```
