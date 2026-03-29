@echo off
cd /d "C:\Users\Luiz\Desktop\trader-bot-ai"
start /B "" "C:\Program Files\nodejs\node.exe" scripts\start.js >> data\launcher.log 2>&1
