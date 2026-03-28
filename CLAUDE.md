# tradebot-ai — Documentação do Projeto

## Objetivo

Bot de trading automatizado para criptomoedas que usa **inteligência artificial (Claude/Anthropic)** para tomar decisões de compra e venda no mercado de futuros da Bybit. O bot combina análise técnica via Python (indicadores), contexto de mercado montado em TypeScript e raciocínio via LLM para gerar sinais de alta qualidade.

---

## Stack Tecnológica

| Camada | Tecnologia | Função |
|---|---|---|
| Runtime principal | **Node.js + TypeScript** | Loop principal, orquestração |
| IA / LLM | **Claude (Anthropic SDK)** | Decisão de trade |
| Indicadores técnicos | **Python + Flask** | TA-Lib, pandas, numpy |
| Exchange | **Bybit via CCXT** | Execução de ordens |
| Banco de dados | **SQLite (better-sqlite3)** | Histórico de trades e candles |
| Notificações | **Telegram Bot** | Alertas em tempo real |
| Containerização | **Docker Compose** | Orquestração dos serviços |
| Validação | **Zod** | Schemas e parsing seguro |

---

## Estrutura de Pastas

```
tradebot-ai/
├── src/
│   ├── core/
│   │   ├── candleStore.ts      # Armazena e gerencia candles históricos
│   │   ├── websocket.ts        # Conexão WebSocket com Bybit (candles em tempo real)
│   │   └── loop.ts             # Loop principal do bot (entry point)
│   ├── indicators/
│   │   └── client.ts           # Client HTTP que chama o servidor Python de indicadores
│   ├── ai/
│   │   ├── contextBuilder.ts   # Monta o contexto completo para o Claude (candles, indicadores, posição atual)
│   │   ├── claude.ts           # Chamada à API do Claude com prompt estruturado
│   │   └── parser.ts           # Parseia e valida a resposta JSON do Claude
│   ├── broker/
│   │   ├── bybit.ts            # Wrapper da API Bybit (CCXT) — saldo, posição, ordens
│   │   └── orderManager.ts     # Gerencia ciclo de vida das ordens (abrir, fechar, monitorar)
│   ├── risk/
│   │   └── sizer.ts            # Calcula tamanho de posição baseado em risco % por trade
│   ├── notifications/
│   │   └── telegram.ts         # Envia mensagens/alertas via Telegram Bot API
│   └── database/
│       └── db.ts               # Inicialização SQLite + funções de persistência
├── python-indicators/
│   ├── app.py                  # Flask API: recebe candles, retorna indicadores calculados
│   └── requirements.txt        # pandas, numpy, ta-lib, flask
├── backtest/
│   └── run.ts                  # Runner de backtest usando dados históricos do SQLite
├── docker-compose.yml          # Sobe Node.js bot + Python indicators como serviços
├── package.json
├── tsconfig.json
├── .env.example                # Template de variáveis de ambiente
└── CLAUDE.md                   # Este arquivo
```

---

## Fluxo de Funcionamento

```
1. WebSocket (websocket.ts)
   └── Recebe candles em tempo real da Bybit

2. CandleStore (candleStore.ts)
   └── Armazena últimos N candles em memória + persiste no SQLite

3. Loop principal (loop.ts) — executa a cada candle fechado
   │
   ├── 3a. Busca indicadores técnicos
   │    └── indicators/client.ts → POST /indicators no servidor Python
   │         └── Python calcula RSI, MACD, EMA, Bollinger, ATR, volume...
   │
   ├── 3b. Monta contexto para o Claude
   │    └── contextBuilder.ts — inclui:
   │         • Últimos 50 candles (OHLCV)
   │         • Todos os indicadores calculados
   │         • Posição atual aberta (se houver)
   │         • Saldo disponível
   │         • Histórico dos últimos 5 trades
   │         • Hora do dia, dia da semana
   │
   ├── 3c. Consulta o Claude (claude.ts)
   │    └── Envia contexto + prompt de sistema
   │         Claude responde em JSON:
   │         { action: "BUY"|"SELL"|"HOLD", confidence: 0-1,
   │           reasoning: "...", stopLoss: number, takeProfit: number }
   │
   ├── 3d. Valida resposta (parser.ts)
   │    └── Zod schema valida o JSON retornado
   │
   ├── 3e. Verifica regras de risco (sizer.ts)
   │    └── Calcula tamanho de posição (MAX_RISK_PER_TRADE % do saldo)
   │         Bloqueia se DAILY_LOSS_LIMIT atingido
   │         Exige confidence mínima de 0.7 para executar
   │
   └── 3f. Executa ordem (orderManager.ts + bybit.ts)
        └── Abre posição com SL e TP definidos pelo Claude
             Notifica via Telegram (telegram.ts)
```

---

## Risk Management

### Regras obrigatórias (hardcoded)

| Regra | Valor padrão | Descrição |
|---|---|---|
| `MAX_RISK_PER_TRADE` | 1% | Máximo do saldo arriscado por trade |
| `DAILY_LOSS_LIMIT` | 2% | Bot para de operar se atingir essa perda no dia |
| `MIN_CONFIDENCE` | 0.70 | Confiança mínima do Claude para abrir posição |
| `MAX_OPEN_POSITIONS` | 1 | Apenas uma posição aberta por vez |
| Stop Loss | Obrigatório | Toda ordem deve ter SL definido |
| Take Profit | Obrigatório | Toda ordem deve ter TP (mínimo 1:1.5 R/R) |

### Modo Paper Trading

Quando `PAPER_TRADING=true`, o bot simula todas as ordens sem executar na exchange real. Útil para validar estratégias sem risco financeiro.

### Modo Testnet

Quando `BYBIT_TESTNET=true`, conecta na rede de testes da Bybit com dinheiro fictício. Ideal para testes com WebSocket real.

---

## Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

| Variável | Descrição |
|---|---|
| `ANTHROPIC_API_KEY` | Chave da API Claude (obrigatório) |
| `BYBIT_API_KEY` | Chave da API Bybit |
| `BYBIT_API_SECRET` | Secret da API Bybit |
| `BYBIT_TESTNET` | `true` = testnet, `false` = produção |
| `TELEGRAM_BOT_TOKEN` | Token do bot Telegram |
| `TELEGRAM_CHAT_ID` | ID do chat para receber notificações |
| `TRADING_PAIR` | Par de trading (ex: BTCUSDT) |
| `TIMEFRAME` | Timeframe em minutos (ex: 15) |
| `MAX_RISK_PER_TRADE` | Risco por trade em decimal (0.01 = 1%) |
| `DAILY_LOSS_LIMIT` | Limite de perda diária em decimal (0.02 = 2%) |
| `PAPER_TRADING` | `true` = simulação, `false` = real |

---

## Como Rodar

### Com Docker (recomendado)
```bash
docker-compose up --build
```

### Manual
```bash
# Terminal 1 — Servidor Python de indicadores
cd python-indicators
pip install -r requirements.txt
python app.py

# Terminal 2 — Bot TypeScript
npm install
npm start
```

### Backtest
```bash
npm run backtest
```

---

## Notas Importantes

- **Nunca** commitar o arquivo `.env` com chaves reais
- O PRODUCT_ID e chaves da API são apenas para testnet — troque antes de ir para produção
- O Claude é consultado a cada candle fechado — monitore o custo de tokens
- Logs detalhados são salvos no SQLite para auditoria posterior
