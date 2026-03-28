// Launcher: starts Python indicators server + ts-node bot
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const BOT_PID_FILE = path.join(DATA_DIR, 'bot.pid');
const PY_PID_FILE = path.join(DATA_DIR, 'python.pid');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Kill previous instances via saved PID files
for (const [label, file] of [['bot', BOT_PID_FILE], ['python', PY_PID_FILE]]) {
  if (fs.existsSync(file)) {
    const oldPid = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    try {
      process.kill(oldPid, 'SIGTERM');
      console.log(`[Launcher] Killed previous ${label} (PID ${oldPid})`);
    } catch { /* already gone */ }
    try { fs.unlinkSync(file); } catch {}
  }
}

// Start Python indicators server
const pyApp = path.join(ROOT, 'python-indicators', 'app.py');
const py = spawn('python', [pyApp], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
});
fs.writeFileSync(PY_PID_FILE, String(py.pid));
py.stdout.on('data', (d) => process.stdout.write(`[Python] ${d}`));
py.stderr.on('data', (d) => process.stderr.write(`[Python] ${d}`));
console.log(`[Launcher] Python indicators server started (PID ${py.pid})`);

py.on('exit', (code) => {
  try { fs.unlinkSync(PY_PID_FILE); } catch {}
  console.error(`[Launcher] Python server exited (code ${code})`);
});

// Wait for Python server to respond on port 5001
function waitForPython(retries, cb) {
  const req = http.get('http://localhost:5001/health', (res) => {
    if (res.statusCode === 200) return cb();
    retry();
  });
  req.on('error', retry);
  req.setTimeout(500, () => { req.destroy(); retry(); });

  function retry() {
    if (retries <= 0) {
      console.error('[Launcher] Python server did not start in time. Aborting.');
      cleanup();
      process.exit(1);
    }
    setTimeout(() => waitForPython(retries - 1, cb), 500);
  }
}

waitForPython(20, () => {
  console.log('[Launcher] Python indicators server is ready');

  const bot = spawn('npx', ['ts-node', 'src/core/loop.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  fs.writeFileSync(BOT_PID_FILE, String(bot.pid));
  console.log(`[Launcher] Bot started (PID ${bot.pid})`);

  bot.on('exit', (code) => {
    try { fs.unlinkSync(BOT_PID_FILE); } catch {}
    cleanup();
    process.exit(code ?? 0);
  });
});

function cleanup() {
  for (const [proc, file] of [[py, PY_PID_FILE]]) {
    try { proc.kill('SIGTERM'); } catch {}
    try { fs.unlinkSync(file); } catch {}
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
