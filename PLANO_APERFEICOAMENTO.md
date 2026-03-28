# Plano de Aperfeiçoamento — tradebot-ai
> Gerado em: 2026-03-24 | Análise de 3 agentes especialistas (Quant, Arquitetura, IA/LLM)

---

## Resumo Executivo

O bot funciona mas opera com uma base frágil em 3 frentes:

1. **Estratégia**: Toda a lógica de entrada depende exclusivamente de cruzamento de EMAs — sem confirmação de volume, sem ADX, sem horários filtrados
2. **Arquitetura**: Sem checkpoint de posição entre reinicios, sem transações no banco, reconexão frágil do WebSocket
3. **IA/LLM**: Claude está fazendo cálculos numéricos (SL/TP) que deveriam ser código determinístico. 75% dos tokens enviados são candles brutas desnecessárias. Há um bug real no parser.

---

## BUG CRÍTICO ENCONTRADO (corrigir imediatamente)

### Bug: `!decision.stopLoss` trata `stopLoss = 0` como ausente

**Arquivo:** `src/ai/parser.ts` linha 32

```typescript
// CÓDIGO ATUAL (bugado):
if (!decision.stopLoss || !decision.takeProfit) {

// CÓDIGO CORRETO:
if (decision.stopLoss == null || decision.takeProfit == null) {
```

**Por quê importa:** Em JavaScript, `!0` é `true`. Se Claude retornar `stopLoss: 0` (possível em altcoins baratas), a ordem é rejeitada como se os campos estivessem ausentes, mesmo estando presentes. Para BTC o risco é baixo, mas o fix leva 2 minutos.

---

## FASE 1 — Segurança e Estabilidade Crítica
> **Autorize esta fase primeiro. Risco de perda real se ignorada.**

### 1.1 — Bug no parser: `!stopLoss` (2 minutos)
Já descrito acima. Corrigir agora.

**Arquivo:** `src/ai/parser.ts` linha 32
**Esforço:** 2 min | **Risco se ignorado:** MÉDIO

---

### 1.2 — Verificar `.env` fora do git (5 minutos)
**Problema:** Se o arquivo `.env` está sendo rastreado pelo git, as chaves Bybit e Anthropic estão expostas.

**Ação:** Verificar se `.gitignore` contém `.env`. Se não, adicionar.

**Arquivo:** `.gitignore`
**Esforço:** 5 min | **Risco se ignorado:** CRÍTICO

---

### 1.3 — Validar SL/TP são lógicos em relação ao preço atual (30 min)
**Problema:** Claude pode retornar `BUY` com `stopLoss` acima do preço ou `takeProfit` abaixo. O parser aceita. A corretora rejeita com erro obscuro.

**Solução:** No parser ou no sizer, validar:
- Para BUY: `stopLoss < currentPrice < takeProfit`
- Para SELL: `takeProfit < currentPrice < stopLoss`

**Arquivo:** `src/ai/parser.ts` ou `src/risk/sizer.ts`
**Esforço:** 30 min | **Risco se ignorado:** MÉDIO

---

### 1.4 — Validação de tamanho de posição (mínimo e máximo) (30 min)
**Problema:** `calculatePositionSize` pode retornar valor abaixo do mínimo da Bybit (0.001 BTC). Ordens com qty muito pequena são rejeitadas silenciosamente ou executadas com arredondamento errado.

**Solução:** Adicionar `MIN_QTY = 0.001` e `MAX_QTY` configurável. Bloquear e logar se fora do range.

**Arquivo:** `src/risk/sizer.ts`
**Esforço:** 30 min | **Risco se ignorado:** MÉDIO

---

### 1.5 — Retry no parser quando Claude retorna JSON inválido (1h)
**Problema:** Claude Haiku às vezes responde com texto antes do JSON ou trunca a resposta (o `max_tokens: 256` pode cortar no meio). Quando isso acontece, o ciclo inteiro é abortado e o bot perde a oportunidade.

**Solução:** Uma segunda tentativa automática com prompt mais explícito: *"Sua resposta anterior não era JSON válido. Responda APENAS com o objeto JSON."*

**Arquivo:** `src/ai/claude.ts`
**Esforço:** 1h | **Risco se ignorado:** MÉDIO

---

### 1.6 — Proteção de posição entre reinicios (2-3h)
**Problema:** Se o bot reinicia com posição aberta, ele não sabe disso. Pode abrir ordem no sentido contrário ou não respeitar o SL/TP da posição existente.

**Solução:** Ao iniciar, consultar Bybit pela posição atual e comparar com o último estado salvo no banco. Criar registro retroativamente se necessário.

**Arquivo:** `src/core/loop.ts`, `src/database/db.ts`
**Esforço:** 2-3h | **Risco se ignorado:** ALTO

---

## FASE 2 — Otimização de IA e Custo
> **Maior impacto em custo e qualidade. Autorize após Fase 1.**

### 2.1 — Remover candles brutas do contexto enviado ao Claude (2h)
**Problema:** 75% dos tokens enviados a cada chamada são os 40 candles OHLCV (20 M15 + 10 H1 + 10 H4). Os indicadores já resumem essas informações. Claude não consegue "ler" 40 candles melhor do que os indicadores calculados.

**Estimativa atual:** ~4.800 tokens/chamada
**Após remoção:** ~1.200 tokens/chamada (economia de 75%)

**Solução:** No `contextBuilder.ts`, remover `candles` de cada timeframe. Se quiser contexto de price action, enviar apenas os últimos 5 fechamentos em uma linha: `"last_5_closes_m15": [84200, 84350, 84100, 84500, 84600]`.

**Arquivo:** `src/ai/contextBuilder.ts`
**Esforço:** 2h | **Impacto:** ALTO (custo e qualidade)

---

### 2.2 — Compactar JSON (sem pretty-print) (15 min)
**Problema:** `JSON.stringify(context, null, 2)` em `claude.ts` linha 37 usa identação com 2 espaços, dobrando o tamanho do JSON em tokens.

**Solução:** Mudar para `JSON.stringify(context)` (sem formatação).

**Arquivo:** `src/ai/claude.ts` linha 37
**Esforço:** 15 min | **Economia:** ~30% dos tokens

---

### 2.3 — Aumentar `max_tokens` de 256 para 512 (5 min)
**Problema:** Com 256 tokens máximos de resposta, Claude pode truncar o JSON no meio quando o `reasoning` é longo. Causa falha no parser.

**Solução:** Mudar `max_tokens: 256` para `max_tokens: 512` em `claude.ts` linha 41.
Custo adicional: ~$0.50/mês — completamente negligenciável.

**Arquivo:** `src/ai/claude.ts` linha 41
**Esforço:** 5 min

---

### 2.4 — Pre-computar sinais semânticos (ao invés de números brutos) (3h)
**Problema:** Claude recebe `rsi: 72.3`, `adx: 28.4`, etc. Ele precisa interpretar numericamente o que esses valores significam, o que introduz erros.

**Solução:** Calcular em código e enviar semântica:
- `rsi_zone: "overbought" | "oversold" | "neutral"`
- `macd_state: "bullish_crossover" | "bearish_crossover" | "bullish" | "bearish"`
- `bb_position: "above_upper" | "near_upper" | "middle" | "near_lower" | "below_lower"`
- `adx_strength: "strong_trend" | "weak_trend" | "no_trend"`
- `volume_vs_avg: "high" | "normal" | "low"`

Isso reduz tokens adicionalmente e elimina erros de interpretação numérica do LLM.

**Arquivo:** `src/ai/contextBuilder.ts`
**Esforço:** 3h

---

### 2.5 — Mover cálculo de SL/TP para código determinístico (5h)
**Problema central:** Claude está "chutando" o stop loss e take profit. O prompt diz para usar ATR, mas Claude faz isso mentalmente com números que leu de um JSON — e frequentemente erra. Isso é o principal vetor de alucinação.

**Solução arquitetural:** Remover `stopLoss` e `takeProfit` da resposta esperada de Claude. Claude só decide `action` e `confidence`. O código calcula:
```
stopLoss  = currentPrice - (atr * 1.5)   # para BUY
takeProfit = currentPrice + (atr * 1.5 * rewardRatio)  # para BUY
```

Isso é determinístico, auditável, e sempre consistente com o ATR real.

**Arquivo:** `src/ai/claude.ts`, `src/ai/parser.ts`, `src/risk/sizer.ts`
**Esforço:** 5h | **Impacto:** MUITO ALTO

---

### 2.6 — Adicionar exemplo (few-shot) no prompt (1h)
**Problema:** Claude não tem exemplo de resposta ideal. Sem exemplos, aumenta variação no formato de saída.

**Solução:** Adicionar ao system prompt 1-2 exemplos:
```
EXEMPLO:
Context: H4 bullish, H1 bullish, M15 bullish, RSI 58, ADX 35
Resposta: {"action":"BUY","confidence":0.82,"reasoning":"All timeframes aligned with strong ADX trend confirmation."}
```

**Arquivo:** `src/ai/claude.ts`
**Esforço:** 1h

---

### 2.7 — Validar Risco/Retorno em código (30 min)
**Problema:** O prompt instrui Claude a usar R/R mínimo de 1:1.5, mas isso nunca é verificado em código. Claude pode retornar um TP muito próximo e a ordem é executada assim mesmo.

**Solução:** Calcular em `sizer.ts`:
```typescript
const rr = Math.abs(takeProfit - currentPrice) / Math.abs(stopLoss - currentPrice);
if (rr < 1.5) return { allowed: false, reason: `R/R ${rr.toFixed(2)} abaixo do mínimo 1.5` };
```

**Arquivo:** `src/risk/sizer.ts`
**Esforço:** 30 min

---

## FASE 3 — Qualidade da Estratégia
> **Autorize após Fase 2. Foco em melhorar a taxa de acerto.**

### 3.1 — Filtro de ADX (força da tendência) (1h)
**Problema:** EMA alinhada não garante tendência forte. ADX já é calculado (disponível em `Indicators`), mas nunca é usado. Sem ADX forte, o mercado está lateral e EMAs dão sinais falsos.

**Solução:** Adicionar ao pre-filtro em `loop.ts`: só chamar Claude se H4 `adx > 20`.

**Arquivo:** `src/core/loop.ts`
**Esforço:** 1h

---

### 3.2 — Filtro de volume (anti-falso rompimento) (1-2h)
**Problema:** O bot entra em trades mesmo com volume abaixo da média. Rompimentos sem volume são frequentemente falsos.

**Solução:** No pre-filtro: só chamar Claude se volume da última candle M15 > `volumeSMA * 0.8`.

**Arquivo:** `src/core/loop.ts`
**Esforço:** 1-2h

---

### 3.3 — Horários bloqueados (1h)
**Problema:** Bot opera 24/7 incluindo madrugada UTC (baixa liquidez). O contexto já envia `hour` e `dayOfWeek`, mas o prompt não usa esse dado e o código não filtra.

**Solução:** Definir no `.env`: `BLOCKED_HOURS=0,1,2,3,4,5`. Verificar no início de `onCandleClose`.

**Arquivo:** `src/core/loop.ts`, `.env`
**Esforço:** 1h

---

### 3.4 — Trailing Stop (3-5h)
**Problema:** Posições não têm trailing stop. Uma operação que chega perto do TP pode reverter para o SL original, perdendo todo o ganho acumulado.

**Solução:** Trailing stop por software via WebSocket: ao atingir 50% do caminho ao TP, mover SL para breakeven. Ao atingir 75%, mover SL para 30% do TP.

**Arquivo:** Novo arquivo `src/risk/trailingStop.ts` + integração no websocket
**Esforço:** 3-5h

---

## FASE 4 — Observabilidade
> **Autorize por último. Permite saber se o bot está gerando lucro.**

### 4.1 — Dashboard de performance por condição (4-8h)
**Problema crítico:** Não há como saber se o bot está realmente ganhando dinheiro no paper trading. Não há win rate calculado, não há drawdown, não há Sharpe ratio.

**Solução:** Salvar no banco na hora do trade: `adx_at_entry`, `bb_position_at_entry`, `timeframe_alignment`, `confidence_reported`. Criar comando `npm run report` que exibe:
- Win rate total e por tipo de sinal
- Profit factor
- Drawdown máximo
- Performance por confidence tier (0.70-0.80, 0.80-0.90, 0.90+)

**Arquivo:** `src/database/db.ts`, novo script `scripts/report.ts`
**Esforço:** 4-8h | **Impacto:** ESSENCIAL para saber se vale continuar

---

### 4.2 — Notificações Telegram enriquecidas (2-3h)
**Adições:**
- Alerta quando circuit breaker é acionado
- Alerta quando R/R é rejeitado
- Resumo diário às 23h UTC (trades feitos, PnL, saldo)
- Alerta quando daily loss limit é atingido

**Arquivo:** `src/notifications/telegram.ts`, `src/core/loop.ts`
**Esforço:** 2-3h

---

## Tabela de Prioridade

| # | Item | Fase | Esforço | Impacto |
|---|------|------|---------|---------|
| 1 | Bug `!stopLoss` no parser | 1.1 | 2 min | MÉDIO |
| 2 | `.env` fora do git | 1.2 | 5 min | CRÍTICO |
| 3 | Compactar JSON (sem `null, 2`) | 2.2 | 15 min | MÉDIO |
| 4 | Aumentar `max_tokens` para 512 | 2.3 | 5 min | MÉDIO |
| 5 | Validar SL/TP lógicos vs preço | 1.3 | 30 min | MÉDIO |
| 6 | Validação R/R mínimo em código | 2.7 | 30 min | ALTO |
| 7 | Validar qty mínima/máxima | 1.4 | 30 min | MÉDIO |
| 8 | Few-shot no prompt | 2.6 | 1h | MÉDIO |
| 9 | Filtro ADX | 3.1 | 1h | MÉDIO |
| 10 | Filtro de volume | 3.2 | 1-2h | MÉDIO |
| 11 | Horários bloqueados | 3.3 | 1h | MÉDIO |
| 12 | Retry no parser JSON | 1.5 | 1h | MÉDIO |
| 13 | Remover candles brutas do contexto | 2.1 | 2h | ALTO |
| 14 | Sinais semânticos no contexto | 2.4 | 3h | ALTO |
| 15 | Proteção de posição no reinício | 1.6 | 2-3h | ALTO |
| 16 | Mover SL/TP para código | 2.5 | 5h | MUITO ALTO |
| 17 | Trailing stop | 3.4 | 3-5h | MÉDIO |
| 18 | Dashboard de performance | 4.1 | 4-8h | ESSENCIAL |
| 19 | Notificações Telegram enriquecidas | 4.2 | 2-3h | BAIXO |

---

## Como autorizar

Responda dizendo qual item quer executar. Exemplos:
- `"executa o item 1.2"` → verifico e corrijo o .gitignore
- `"executa a fase 1 inteira"` → implemento todos os itens críticos
- `"começa pelos itens rápidos"` → executo itens 1, 2, 3, 4 em sequência (total ~25 min)
- `"quero o 2.5"` → movo cálculo de SL/TP para código determinístico
