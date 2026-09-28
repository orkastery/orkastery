#!/usr/bin/env python3
"""PermissionRequest real com plugin nativo e configuração descartável, sem aprovar Bash."""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import pexpect

spec = json.loads(sys.argv[1])
root = Path(spec['root']).resolve()
cwd = Path(spec['cwd']).resolve()
assert root.name.startswith('ork-test-native-plugin-') and root.parent == Path('/tmp').resolve()
assert cwd == root or root in cwd.parents
assert Path(spec['config']).resolve().is_relative_to(root)
assert Path(spec['ledger']).resolve().is_relative_to(root)
assert os.getuid() != 0

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def event():
    entries = [json.loads(line) for line in Path(spec['ledger']).read_text().splitlines() if line]
    return next((e for e in entries if e.get('sessionId') == spec['sessionId'] and e.get('tipo') == 'sessao_bloqueada'), None)

# Somente OAuth da assinatura; nunca ler a credencial API nem repassar providers.
secret = (Path.home() / '.hermes' / '.env').read_text()
match = re.search(r'^\s*(?:export\s+)?ANTHROPIC_TOKEN\s*=\s*(.*)$', secret, re.M)
token = match.group(1).strip().strip('\"\'') if match else ''
assert token.startswith('sk-ant-oat01-'), 'OAuth indisponível no domicílio autorizado; sem fallback'
del secret
env = {k: os.environ[k] for k in ['PATH', 'HOME', 'USER', 'LANG', 'TMPDIR', 'XDG_CONFIG_HOME',
                                'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME'] if k in os.environ}
assert Path(env['HOME']).resolve().is_relative_to(root)
env.update(CLAUDE_CONFIG_DIR=spec['config'], CLAUDE_CODE_OAUTH_TOKEN=token,
           CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1', DISABLE_AUTOUPDATER='1', ORK_SENSOR_CLI=spec['cli'])
auth = subprocess.run(['claude', 'auth', 'status', '--json'], cwd=cwd, env=env,
                      capture_output=True, text=True, timeout=10)
auth_info = json.loads(auth.stdout)
assert auth.returncode == 0 and auth_info.get('loggedIn') and auth_info.get('authMethod') == 'oauth_token'
assert not auth_info.get('apiKeySource'), 'API key inesperada; sem fallback'
# Preferências apenas do sandbox; a confiança na fixture passa pelo diálogo do CLI.
config = Path(spec['config']) / '.claude.json'
data = json.loads(config.read_text()) if config.exists() else {}
data.update(hasCompletedOnboarding=True, theme='dark')
config.write_text(json.dumps(data))
args = ['--session-id', spec['sessionId'], '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--settings', '{"permissions":{"ask":["Bash"]}}', '--permission-mode', 'manual',
        '--tools', 'Bash', '--model', 'opus', '--effort', 'low', '--no-chrome', '--ax-screen-reader',
        '--debug-file', spec['debug'],
        'Teste isolado autorizado: solicite Bash exatamente uma vez para executar printf ORK_NATIVE > native-permission-proof.txt. '
        'Não leia arquivos nem use outros serviços. O condutor encerrará a sessão ao aparecer o pedido de permissão.']
p = pexpect.spawn('claude', args, cwd=str(cwd), env=env, encoding='utf8', timeout=.2, dimensions=(42, 160))
started = time.monotonic()
text = ''
clean = ''
trust = False
prompt_at = None
observed = None
try:
    while time.monotonic() - started < 65:
        try:
            text = (text + p.read_nonblocking(8192, timeout=.2))[-65536:]
        except pexpect.TIMEOUT:
            pass
        except pexpect.EOF:
            break
        clean = re.sub(r'\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))', '', text)
        if not trust and 'Yes, I trust this folder' in clean:
            p.send('y\r')
            trust = True
            continue
        observed = event()
        if observed and re.search(r'Permission Required: Bash|Do you want to proceed|Run this command|Allow this|Yes, allow', clean, re.I):
            prompt_at = now()
            break
finally:
    p.sendcontrol('c')
    time.sleep(.2)
    p.sendcontrol('c')
    time.sleep(.2)
    p.terminate(force=True)
    p.close()
log = Path(spec['debug']).read_text() if Path(spec['debug']).exists() else ''
executed = (cwd / 'native-permission-proof.txt').exists()
result = {'argv': ['claude'] + args, 'cwd': str(cwd), 'authMethod': auth_info.get('authMethod'),
          'sessionId': spec['sessionId'],
          'apiProvider': auth_info.get('apiProvider'), 'trustAccepted': trust,
          'promptAt': prompt_at, 'toolExecuted': executed, 'exitCode': p.exitstatus, 'signal': p.signalstatus,
          'durationMs': round((time.monotonic() - started) * 1000),
          'loaderAndHookOutput': [line for line in log.splitlines() if re.search(
              r'Registered \d+ hooks from|Total plugin (agents|skills|commands) loaded:|PermissionRequest|ork-sensor.js|ork-guard.js', line)]}
result['ok'] = bool(prompt_at and observed and not executed and 'Registered 6 hooks from 1 plugins' in log)
if not result['ok']:
    result['terminal'] = re.sub(r'sk-ant-[\w-]+', '[REDACTED]', clean[-6000:])
print(json.dumps(result))
