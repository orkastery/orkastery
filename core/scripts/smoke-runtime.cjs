'use strict';
// T11-R8-D2: autenticação nativa em memória; toda a escrita do runtime é da tentativa.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const os = require('node:os');
const AUTH_MEMORIA = String.raw`
import os, sys, json, fcntl
try:
    with open(sys.argv[1]) as source: auth = json.load(source)
    assert auth.get('auth_mode') == 'chatgpt' and auth.get('tokens') and not auth.get('OPENAI_API_KEY')
    fd = os.memfd_create('ork-smoke-auth', os.MFD_ALLOW_SEALING)
    os.fchmod(fd, 0o600)
    os.write(fd, json.dumps(auth).encode())
    fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL)
    del auth
    print(json.dumps({'path': '/proc/%d/fd/%d' % (os.getpid(), fd), 'sealed': True}), flush=True)
    sys.stdin.read()
    os.close(fd)
except Exception:
    print('{"error":"Cache nativo ChatGPT indisponível para leitura selada; sem fallback"}', flush=True)
    sys.exit(1)
`;

function ambienteIsolado(raiz, base = process.env) {
  const env = {};
  for (const key of ['PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'SHELL']) {
    if (base[key]) env[key] = base[key];
  }
  for (const [key, subdir] of Object.entries({ HOME: 'home', CODEX_HOME: 'codex',
    CLAUDE_CONFIG_DIR: 'claude', XDG_CONFIG_HOME: 'xdg-config', XDG_CACHE_HOME: 'xdg-cache',
    XDG_DATA_HOME: 'xdg-data', XDG_STATE_HOME: 'xdg-state', TMPDIR: 'tmp' })) {
    env[key] = path.join(raiz, subdir);
    fs.mkdirSync(env[key], { recursive: true, mode: 0o700 });
  }
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  env.DISABLE_AUTOUPDATER = '1';
  return env;
}

async function prepararRuntime(runtime, raiz, base = process.env) {
  const env = ambienteIsolado(raiz, base);
  let keeper;
  const fechar = async () => {
    if (!keeper) return;
    const child = keeper; keeper = null;
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGTERM'), 2000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  };
  try {
    if (runtime === 'claude') {
      const secret = fs.readFileSync(path.join(os.homedir(), '.hermes/.env'), 'utf8');
      const token = /^\s*(?:export\s+)?ANTHROPIC_TOKEN\s*=\s*(.*)$/m.exec(secret)?.[1].trim().replace(/^["']|["']$/g, '');
      if (!token?.startsWith('sk-ant-oat01-')) throw new Error('OAuth de assinatura indisponível no domicílio autorizado; sem fallback');
      env.CLAUDE_CODE_OAUTH_TOKEN = token;
      fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark' }), { mode: 0o600 });
    } else if (runtime === 'codex') {
      const source = path.join(base.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
      keeper = cp.spawn('python3', ['-c', AUTH_MEMORIA, source], { env, stdio: ['pipe', 'pipe', 'ignore'] });
      keeper.stdin.on('error', () => {});
      const auth = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Timeout no cache nativo em memória')), 5000);
        keeper.once('error', () => { clearTimeout(timer); reject(new Error('Memfd indisponível')); });
        keeper.once('close', () => { clearTimeout(timer); reject(new Error('Cache nativo indisponível')); });
        keeper.stdout.on('data', bytes => {
          output += bytes.toString();
          if (!output.includes('\n')) return;
          clearTimeout(timer);
          try { resolve(JSON.parse(output.split('\n')[0])); } catch { reject(new Error('Recibo memfd inválido')); }
        });
      });
      if (!auth.sealed || !/^\/proc\/\d+\/fd\/\d+$/.test(auth.path)) throw new Error('Cache ChatGPT selado indisponível; sem fallback');
      fs.symlinkSync(auth.path, path.join(env.CODEX_HOME, 'auth.json'));
      fs.writeFileSync(path.join(env.CODEX_HOME, 'config.toml'), 'forced_login_method = "chatgpt"\ncli_auth_credentials_store = "file"\n', { mode: 0o600 });
    } else throw new Error('Runtime desconhecido');
    return { env, fechar, prova: { raiz, home: env.HOME, codexHome: env.CODEX_HOME,
      claudeConfigDir: env.CLAUDE_CONFIG_DIR, auth: runtime === 'codex' ? 'native-chatgpt-sealed-memfd' : 'subscription-oauth-env',
      credencialPersistida: false, refreshDoCache: runtime === 'codex' ? 'indisponivel: memfd selado' : 'nao solicitado' } };
  } catch (error) { await fechar(); throw error; }
}

function arquivosRuntime(raiz) {
  const files = [];
  function visitar(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      // Nunca seguir auth.json nem outro link; só metadados de arquivos da tentativa.
      if (entry.isDirectory()) visitar(file);
      else if (entry.isFile()) files.push({ path: path.relative(raiz, file), bytes: fs.statSync(file).size });
    }
  }
  visitar(raiz);
  return files;
}
module.exports = { ambienteIsolado, prepararRuntime, arquivosRuntime };
