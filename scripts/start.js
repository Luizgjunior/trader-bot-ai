// Wrapper: kills previous instances (via PID file), starts Python indicators server + ts-node bot
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PID_FILE = path.join(__dirname, '..', 'data', 'bot.pid');
const PY_PID_FILE = path.join(__dirname, '..', 'data', 'python.pid');

// Ensure data dir exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Kill previous instances
for (const [label, file] of [['bot', PID_FILE], ['python', PY_PID_FILE]]) {
  if (fs.existsSync(file)) {
    const oldPid = fs.readFileSync(file, 'utf8').trim();
    try {
      execSync(`taskkill /F /PID ${oldPid}`, { stdio: 'ignore' });
      console.log(`[Launcher] Killed previous ${label} (PID ${oldPid})`);
    } catch { /* already gone */ }
    try { fs.unlinkSync(file); } catch { /* already deleted by exiting process */ }
  }
}

// Start Python indicators server
const pyApp = path.join(__dirname, '..', 'python-indicators', 'app.py');
const py = spawn('python', [pyApp], {
  cwd: path.join(__dirname, '..'),
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
});
fs.writeFileSync(PY_PID_FILE, String(py.pid));
py.stdout.on('data', (d) => process.stdout.write(`[Python] ${d}`));
py.stderr.on('data', (d) => process.stderr.write(`[Python] ${d}`));
console.log(`[Launcher] Python indicators server started (PID ${py.pid})`);

// Wait for Python server to be ready, then start the bot
function waitForPython(retries, cb) {
  const http = require('http');
  const req = http.get('http://localhost:5001/health', (res) => {
    if (res.statusCode === 200) return cb();
    retry();
  });
  req.on('error', retry);
  req.setTimeout(500, () => { req.destroy(); retry(); });

  function retry() {
    if (retries <= 0) { console.error('[Launcher] Python server did not start in time'); process.exit(1); }
    setTimeout(() => waitForPython(retries - 1, cb), 500);
  }
}

waitForPython(20, () => {
  console.log('[Launcher] Python indicators server is ready');

  // Start the bot
  const bot = spawn('npx', ['ts-node', 'src/core/loop.ts'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
  });
  fs.writeFileSync(PID_FILE, String(bot.pid));
  console.log(`[Launcher] Bot started (PID ${bot.pid})`);

  bot.on('exit', (code) => {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    // Also kill python
    if (fs.existsSync(PY_PID_FILE)) {
      const pid = fs.readFileSync(PY_PID_FILE, 'utf8').trim();
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch {}
      try { fs.unlinkSync(PY_PID_FILE); } catch {}
    }
    process.exit(code ?? 0);
  });
});

py.on('exit', (code) => {
  if (fs.existsSync(PY_PID_FILE)) fs.unlinkSync(PY_PID_FILE);
  console.error(`[Launcher] Python server exited (code ${code})`);
});
