import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'bin/ork-hitl-answer.py'
spec = importlib.util.spec_from_file_location('hitl', SCRIPT)
hitl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hitl)


def update(texto='1'):
    return {'message': {'message_id': 8, 'from': {'id': 42, 'is_bot': False},
                        'chat': {'id': -7}, 'text': texto,
                        'reply_to_message': {'text': 'Aprovar?\nork-hitl ork-t H1'}}}


class HitlAnswerTest(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, ORK_HITL_TELEGRAM_USERS='42', ORK_HITL_TELEGRAM_CHATS='-7')
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_numero_texto_e_sessao_preservam_origem(self):
        for operacao in ['ork_gate_answer', 'ork_session_answer']:
            for resposta in ['1', 'aprovar objetivo', 'reject']:
                args, entrada = hitl.argumentos(update(resposta), operacao, 'ork-t', 'H1')
                self.assertEqual(args[:4], ['gate' if operacao == 'ork_gate_answer' else 'sessions', 'answer', 'ork-t', 'H1'])
                self.assertEqual(resposta, entrada)
                self.assertNotIn(resposta, args)
                self.assertIn('telegram:42', args)
                self.assertIn('telegram:-7:8', args)

    def test_recusa_bot_outro_usuario_chat_e_resposta_sem_correlacao(self):
        casos = [update() for _ in range(5)]
        casos[0]['message']['from']['is_bot'] = True
        casos[1]['message']['from']['id'] = 43
        casos[2]['message']['chat']['id'] = -8
        casos[3]['message']['reply_to_message']['text'] = 'ork-hitl ork-outra H1'
        casos[4]['message']['forward_origin'] = {'type': 'user'}
        for caso in casos:
            with self.assertRaises(ValueError):
                hitl.argumentos(caso, 'ork_gate_answer', 'ork-t', 'H1')
        with patch.dict(os.environ, ORK_HITL_TELEGRAM_USERS=''):
            with self.assertRaises(ValueError):
                hitl.argumentos(update(), 'ork_gate_answer', 'ork-t', 'H1')

    def test_callback_correlacionado(self):
        cb = {'callback_query': {'id': 'cb7', 'from': {'id': 42, 'is_bot': False},
                                'message': {'chat': {'id': -7}}, 'data': 'ork:ork-t:H1:2'}}
        args, entrada = hitl.argumentos(cb, 'ork_gate_answer', 'ork-t', 'H1')
        self.assertEqual('2', entrada)
        self.assertIn('telegram:-7:cb7', args)
        cb['callback_query']['data'] = 'ork:ork-t:H2:1'
        with self.assertRaises(ValueError):
            hitl.argumentos(cb, 'ork_gate_answer', 'ork-t', 'H1')

    def test_cli_argv_sem_shell_e_falha_sem_vazar_resposta(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            stub = root / 'ork'
            stub.write_text('#!/usr/bin/env python3\nimport sys,json,os\nfrom pathlib import Path\n'
                            'Path(os.environ["SINK"]).write_text(json.dumps({"argv":sys.argv[1:],"stdin":sys.stdin.read()}))\n'
                            'print(json.dumps({"ok":True,"pedido":"H1"}))\n'
                            'sys.exit(int(os.environ.get("FAIL","0")))\n')
            stub.chmod(0o755)
            env = dict(os.environ, ORK_BIN=str(stub), SINK=str(root/'sink'))
            texto = '$(touch INJETADO) `id` ; "approve"\nsegunda linha'
            cmd = [sys.executable, str(SCRIPT), 'ork_gate_answer', 'ork-t', 'H1']
            r = subprocess.run(cmd, input=json.dumps(update(texto)), env=env, text=True, capture_output=True, cwd=tmp)
            self.assertEqual(r.returncode, 0, r.stderr)
            recebido = json.loads((root/'sink').read_text())
            self.assertEqual(texto, recebido['stdin'])
            self.assertNotIn(texto, recebido['argv'])
            self.assertFalse((root/'INJETADO').exists())
            env['FAIL'] = '1'
            r = subprocess.run(cmd, input=json.dumps(update('segredo-teste')), env=env, text=True, capture_output=True)
            self.assertEqual(r.returncode, 1)
            self.assertNotIn('segredo-teste', r.stdout + r.stderr)
