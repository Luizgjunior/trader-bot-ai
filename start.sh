#!/bin/bash
# Inicia o tradebot-ai em background com logs persistentes

set -e

LOG_DIR="./data/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$LOG_DIR/bot_$TIMESTAMP.log"

echo "[start.sh] Iniciando tradebot-ai..."
echo "[start.sh] Logs em: $LOG_FILE"

nohup node scripts/start.js >> "$LOG_FILE" 2>&1 &
BOT_PID=$!

echo "[start.sh] Bot iniciado com PID $BOT_PID"
echo "[start.sh] Para acompanhar os logs em tempo real:"
echo "  tail -f $LOG_FILE"
echo "[start.sh] Para parar o bot:"
echo "  kill \$(cat data/bot.pid)"
