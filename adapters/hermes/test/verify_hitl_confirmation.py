"""Verify autocontido: host instalado, transportes SIMULADOS, ambiente sem herança."""
import hashlib
import json
import os
import socket
from pathlib import Path
import sys
import tempfile
import unittest
from layout import plugin_directory


def main():
    installed = Path.home() / '.hermes' / 'hermes-agent'
    tests = Path(__file__).resolve().parent
    plugin = plugin_directory(tests)
    # asyncio.to_thread precisa acordar o loop por socket local. Falhar é diferente
    # de pular testes ou esperar indefinidamente pelo shutdown do executor.
    try:
        a, b = socket.socketpair()
        try:
            a.send(b'x')
            assert b.recv(1) == b'x'
        finally:
            a.close()
            b.close()
    except OSError:
        raise SystemExit('hermes.environment.local-socket-denied: suíte não executada')
    if not (installed / 'hermes_cli/plugins.py').is_file():
        raise SystemExit('Contrato instalado ausente; C24 não pode ser verificada neste host.')
    # Limpar ANTES de importar qualquer módulo do host (incluindo dotenv/config).
    os.environ.clear()
    sys.dont_write_bytecode = True
    with tempfile.TemporaryDirectory(prefix='ork-hitl-simulado-', dir='/tmp') as sandbox:
        os.environ.update(PATH='/usr/bin:/bin', HOME=sandbox, HERMES_HOME=sandbox,
                          XDG_CONFIG_HOME=sandbox, XDG_CACHE_HOME=sandbox,
                          TMPDIR=sandbox, PYTHONDONTWRITEBYTECODE='1', PYTHONUTF8='1')
        tempfile.tempdir = sandbox
        sys.path.insert(0, str(installed))
        blocked = {'network': 0, 'private_file': 0}

        def guard(event, args):
            if event in {'socket.connect', 'socket.getaddrinfo', 'socket.sendto'}:
                blocked['network'] += 1
                raise RuntimeError('Rede proibida: verify exclusivamente SIMULADO')
            if event == 'open' and isinstance(args[0], (str, bytes, os.PathLike)):
                path = Path(os.fsdecode(args[0])).resolve()
                if (path.name == '.env' or path.name in {'auth.json', 'credentials.json'}) and not path.is_relative_to(sandbox):
                    blocked['private_file'] += 1
                    raise RuntimeError('Arquivo operacional proibido na prova SIMULADA')

        sys.addaudithook(guard)
        print('SIMULADO: ambiente herdado removido; HOME/HERMES_HOME/TMPDIR isolados; rede e segredos operacionais bloqueados.', flush=True)
        suite = unittest.defaultTestLoader.discover(str(tests), pattern='*_test.py')
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        from gateway.platforms.base import MessageEvent
        from telegram import Message
        import telegram
        import hermes_cli.plugins as plugins
        import inspect
        files = [installed / 'gateway/run.py', Path(inspect.getfile(plugins)),
                 Path(inspect.getfile(MessageEvent)), Path(inspect.getfile(Message)),
                 plugin / '__init__.py', plugin / 'plugin.yaml']
        proof = {'transporteCLI': 'SIMULADO', 'transporteTelegram': 'SIMULADO',
                 'ptb': telegram.__version__, 'invokeHook': str(inspect.signature(plugins.invoke_hook)),
                 'fontesInstaladasSha256': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
                 'testes': result.testsRun, 'falhas': len(result.failures), 'erros': len(result.errors),
                 'skips': len(result.skipped), 'bloqueios': blocked}
        print(json.dumps(proof, ensure_ascii=False, indent=2), flush=True)
        return 0 if result.wasSuccessful() and not result.skipped and not any(blocked.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
