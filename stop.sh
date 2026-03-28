#!/bin/bash
# Para o tradebot-ai e o servidor Python

PID_FILE="./data/bot.pid"
PY_PID_FILE="./data/python.pid"

stop_pid() {
  local label=$1
  local file=$2
  if [ -f "$file" ]; then
    PID=$(cat "$file")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      echo "[stop.sh] $label (PID $PID) encerrado"
    else
      echo "[stop.sh] $label já estava parado"
    fi
    rm -f "$file"
  else
    echo "[stop.sh] PID file não encontrado: $file"
  fi
}

stop_pid "Bot" "$PID_FILE"
stop_pid "Python" "$PY_PID_FILE"

echo "[stop.sh] Encerrado."
