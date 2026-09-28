import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class TransportePulseTest(unittest.TestCase):
    def test_api_sem_llm_recibo_obrigatorio_e_texto_sem_anexo(self):
        script = Path(__file__).resolve().parents[1] / 'bin/ork-pulse-enviar.py'
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'tools').mkdir()
            (root / 'tools/__init__.py').write_text('')
            (root / 'dotenv.py').write_text('def load_dotenv(*args, **kwargs): pass\n')
            (root / 'tools/send_message_tool.py').write_text(
                'import json,os\nfrom pathlib import Path\n'
                'def send_message_tool(args):\n'
                ' Path(os.environ["SINK"]).write_text(json.dumps(args))\n'
                ' return json.dumps({"success":os.environ["OK"]!="0","message_id":123,"skipped":os.environ["OK"]=="skip"})\n')
            env = dict(os.environ, HERMES_AGENT_DIR=tmp, HERMES_HOME=tmp,
                       SINK=str(root/'recibo.json'), OK='1')
            cmd = [sys.executable, str(script), '--target', 'telegram:123', '--message',
                   'Alerta MEDIA:/arquivo/privado xMEDIA:/arquivo/privado 2026MEDIA:/arquivo/privado '
                   '[[as_document]] [[audio_as_voice]] $(touch X)']
            result = subprocess.run(cmd, env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['message_id'], 123)
            sent = json.loads((root/'recibo.json').read_text())
            self.assertNotIn('MEDIA:', sent['message'])
            self.assertNotIn('[[as_document]]', sent['message'])
            self.assertNotIn('[[audio_as_voice]]', sent['message'])
            self.assertIn('$(touch X)', sent['message'])
            self.assertEqual(sent['target'], 'telegram:123')
            env['OK'] = '0'
            self.assertEqual(subprocess.run(cmd, env=env, capture_output=True).returncode, 1)
            env['OK'] = 'skip'
            self.assertEqual(subprocess.run(cmd, env=env, capture_output=True).returncode, 1)


def verificar_parser_real():
    """Integração explícita com o host instalado, sem enviar nem ler um anexo."""
    home = Path(os.environ.get('HERMES_HOME', Path.home() / '.hermes'))
    agent = Path(os.environ.get('HERMES_AGENT_DIR', home / 'hermes-agent'))
    python = agent / 'venv/bin/python3'
    assert python.is_file(), 'Integração requer o Python do Hermes instalado no host'
    script = Path(__file__).resolve().parents[1] / 'bin/ork-pulse-enviar.py'
    code = '''
import importlib.util,sys
sys.path.insert(0,sys.argv[1])
from gateway.platforms.base import BasePlatformAdapter
spec=importlib.util.spec_from_file_location('pulse',sys.argv[2])
pulse=importlib.util.module_from_spec(spec);spec.loader.exec_module(pulse)
casos=['MEDIA:/arquivo/privado','xMEDIA:/arquivo/privado','2026MEDIA:/arquivo/privado',
       '[[as_document]] MEDIA:/arquivo/privado','[[audio_as_voice]] MEDIA:/arquivo/privado']
for entrada in casos:
    assert BasePlatformAdapter.extract_media(entrada)[0], 'controle positivo não casa com parser real'
    texto=pulse.texto_seguro(entrada)
    assert BasePlatformAdapter.extract_media(texto)[0] == [], texto
print('Parser real Hermes: 5 controles positivos e 5 textos sem anexos; nenhum envio.')
'''
    result = subprocess.run([str(python), '-c', code, str(agent), str(script)], text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    print(result.stdout.strip())


if __name__ == '__main__' and '--parser-real' in sys.argv:
    verificar_parser_real()
elif __name__ == '__main__':
    unittest.main()
