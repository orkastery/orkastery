"""Classes e invoke_hook INSTALADOS; CLI e HTTP Telegram estritamente SIMULADOS.

Executar pelo verify_hitl_confirmation.py, que isola ambiente antes dos imports.
"""
import asyncio
import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

from gateway.platforms.base import MessageEvent
from gateway.session import SessionSource
from gateway.config import Platform
from hermes_cli import plugins
from telegram import Bot, Chat, Message, User
from telegram.request import BaseRequest
from layout import plugin_directory


class SimulatedRequest(BaseRequest):
    """Exercita Bot.send_message real até o BaseRequest; nunca abre socket."""
    def __init__(self):
        self.calls = []
        self.mode = 'ok'
        self.loop = None

    @property
    def read_timeout(self):
        return 1

    async def initialize(self):
        pass

    async def shutdown(self):
        pass

    async def do_request(self, url, method, request_data=None, **kwargs):
        if not url.endswith('/sendMessage'):
            raise AssertionError('Somente sendMessage SIMULADO; getMe/getChat proibidos')
        self.loop = asyncio.get_running_loop()
        params = request_data.parameters
        self.calls.append({'method': method, 'params': params, 'timeouts': kwargs})
        if self.mode == 'timeout':
            await asyncio.sleep(10)
        if self.mode == 'exception':
            raise RuntimeError('erro-privado-SIMULADO')
        result = {'message_id': 123, 'date': int(datetime.now(timezone.utc).timestamp()),
                  'chat': {'id': 42, 'type': 'private'},
                  'from': {'id': 99, 'is_bot': True, 'first_name': 'Bot SIMULADO'},
                  'text': params['text']}
        if self.mode == 'wrong_chat':
            result['chat']['id'] = 43
        if self.mode == 'missing_id':
            del result['message_id']
        return 200, json.dumps({'ok': True, 'result': result}).encode()


class InstalledContractTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.assertNotIn('TELEGRAM_BOT_TOKEN', os.environ)
        self.assertNotIn('OPENAI_API_KEY', os.environ)
        self.assertNotIn('ANTHROPIC_API_KEY', os.environ)
        self.env = patch.dict(os.environ, {
            'ORK_HITL_INGRESS_KEY_HERMES': 'chave-SIMULADA-exclusiva-dos-testes-000',
            'ORK_HITL_TELEGRAM_USERS': '42', 'ORK_HITL_TELEGRAM_CHATS': '42',
            'ORK_HITL_TELEGRAM_BOT_ID': '99', 'ORK_HITL_ROOT': os.environ['HERMES_HOME'],
            'ORK_BIN': 'ork-SIMULADO-nao-executar'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.manager = plugins.PluginManager()
        plugin_dir = plugin_directory()
        manifest = self.manager._parse_manifest(plugin_dir / 'plugin.yaml', plugin_dir, 'user', '')
        self.assertIsNotNone(manifest)
        self.manager._load_plugin(manifest)
        loaded = self.manager._plugins[manifest.key or manifest.name]
        self.assertIsNone(loaded.error)
        self.assertTrue(loaded.enabled)
        self.assertEqual(loaded.tools_registered, [])
        self.assertEqual(loaded.commands_registered, [])
        self.ingress = loaded.module
        singleton = patch.object(plugins, '_plugin_manager', self.manager)
        singleton.start(); self.addCleanup(singleton.stop)
        self.request = SimulatedRequest()
        self.bot = Bot('99:TOKEN-SIMULADO-SEM-VALIDADE', request=self.request, get_updates_request=self.request)
        # Cache sintético: não inicializar/getMe nem usar token do .env.
        self.bot._bot_user = User(99, 'Bot SIMULADO', True)
        self.msg = Message(8, datetime.now(timezone.utc), Chat(42, 'private'),
                           from_user=User(42, 'Humano SIMULADO', False),
                           text='/ork gate ork-simulado pedido-1 NÃO ç 😀 e\u0301 $()')
        self.msg.set_bot(self.bot)
        self.event = MessageEvent(text=self.msg.text, raw_message=self.msg, message_id='8',
                                  source=SessionSource(Platform.TELEGRAM, '42', user_id='42'))
        self.gateway = SimpleNamespace(_is_user_authorized=lambda source: source is self.event.source)

    def invoke(self):
        results = plugins.invoke_hook('pre_gateway_dispatch', event=self.event, gateway=self.gateway)
        self.assertEqual(len(results), 1)
        self.assertIsInstance(results[0], dict)
        self.assertEqual(results[0]['action'], 'skip')
        return results[0]

    async def finish(self):
        await asyncio.gather(*list(self.ingress._tasks))
        await asyncio.sleep(0)
        return self.invoke()

    def core_receipt(self, *args, **kwargs):
        # Verifica HMAC e argv no receptor SIMULADO, além do teste do produtor.
        env = kwargs['env']
        self.assertNotIn('TELEGRAM_BOT_TOKEN', env)
        self.assertNotIn('OPENAI_API_KEY', env)
        argv, envelope = args[0], json.loads(kwargs['input'])
        self.assertEqual(argv[0], 'ork-SIMULADO-nao-executar')
        self.assertEqual(argv[2:5], ['answer', 'ork-simulado', 'pedido-1'])
        self.assertEqual(envelope['resposta'], 'NÃO ç 😀 e\u0301 $()')
        canonical = ['ork.hitl-answer/v2', argv[3], argv[4], 'hermes', None,
                     envelope['origem'], envelope['por'], envelope['mensagem'],
                     envelope['recebidoEm'], envelope['resposta']]
        proof = hmac.new(env['ORK_HITL_INGRESS_KEY_HERMES'].encode(), json.dumps(canonical, ensure_ascii=False, separators=(',', ':')).encode(), hashlib.sha256).hexdigest()
        self.assertEqual(proof, envelope['prova'])
        value = {'ok': True, 'pedidoId': argv[4], 'estado': 'aprovado', 'repetida': False}
        if argv[1] == 'sessions':
            value.update(estado='entregue', sessionId='sessao-SIMULADA')
        return SimpleNamespace(returncode=0, stdout=json.dumps(value))

    async def test_installed_loader_invoke_hook_and_native_reply_on_same_loop(self):
        for operation in ['gate', 'session']:
            with self.subTest(operation=operation):
                self.ingress._entries.clear(); self.request.calls.clear()
                self.event.text = f'/ork {operation} ork-simulado pedido-1 NÃO ç 😀 e\u0301 $()'
                with self.msg._unfrozen(): self.msg.text = self.event.text
                with patch.object(self.ingress.subprocess, 'run', side_effect=self.core_receipt) as run:
                    self.assertEqual(self.invoke()['effect'], 'pending')
                    self.assertTrue(self.invoke()['replay'])
                    self.assertEqual(self.request.calls, [])
                    result = await self.finish()
                    self.assertEqual((result['effect'], result['confirmation']), ('confirmed', 'sent'))
                    self.assertEqual(run.call_count, 1)
                    self.assertEqual(len(self.request.calls), 1)
                    call = self.request.calls[0]
                    self.assertEqual(call['params']['chat_id'], 42)
                    self.assertEqual(call['params']['text'], self.ingress.CONFIRM_TEXT[operation])
                    self.assertNotIn('reply_parameters', call['params'])
                    self.assertNotIn('parse_mode', call['params'])
                    self.assertIs(self.request.loop, asyncio.get_running_loop())

    async def test_installed_contract_timeout_exception_missing_id_and_wrong_chat(self):
        for mode in ['timeout', 'exception', 'missing_id', 'wrong_chat']:
            with self.subTest(mode=mode), patch.object(self.ingress, 'CONFIRM_TIMEOUT', 0.03), patch.object(self.ingress.subprocess, 'run', side_effect=self.core_receipt) as run, self.assertLogs(self.ingress.logger, level='INFO') as logs:
                self.ingress._entries.clear(); self.request.calls.clear(); self.request.mode = mode
                started = asyncio.get_running_loop().time()
                self.invoke(); result = await self.finish()
                self.assertLess(asyncio.get_running_loop().time() - started, 0.5)
                self.assertEqual((result['effect'], result['confirmation']), ('confirmed', 'unknown'))
                self.assertEqual(run.call_count, 1)
                self.assertEqual(len(self.request.calls), 1)
                self.assertNotIn('erro-privado-SIMULADO', str(result) + str(logs.output))

    async def test_installed_discovery_opt_in_cache_and_reload_in_synthetic_home(self):
        with tempfile.TemporaryDirectory(dir=os.environ['HERMES_HOME']) as synthetic:
            home = Path(synthetic)
            plugin_dir = home / 'plugins' / 'orkastery-hitl'
            shutil.copytree(plugin_directory(), plugin_dir)
            config = home / 'config.yaml'
            config.write_text('plugins:\n  enabled: []\n')
            with patch.dict(os.environ, HERMES_HOME=str(home), HERMES_BUNDLED_PLUGINS=str(home / 'empty')), patch.object(plugins.PluginManager, '_scan_entry_points', return_value=[]):
                manager = plugins.PluginManager()
                manager.discover_and_load()
                self.assertFalse(manager._plugins['orkastery-hitl'].enabled)
                config.write_text('plugins:\n  enabled: [orkastery-hitl]\n')
                manager.discover_and_load()
                self.assertFalse(manager._plugins['orkastery-hitl'].enabled)
                manager.discover_and_load(force=True)
                self.assertTrue(manager._plugins['orkastery-hitl'].enabled)
                with patch.object(plugins, '_plugin_manager', manager):
                    self.ingress = manager._plugins['orkastery-hitl'].module
                    with patch.object(self.ingress.subprocess, 'run', side_effect=self.core_receipt):
                        self.invoke()
                        self.assertEqual((await self.finish())['confirmation'], 'sent')

    async def test_installed_message_mismatch_rejected_without_any_transport(self):
        with patch.object(self.ingress.subprocess, 'run') as run:
            self.event.source.user_id = '43'
            self.assertEqual(self.invoke()['effect'], 'unconfirmed')
            self.assertEqual(self.request.calls, [])
            run.assert_not_called()
            self.assertEqual(len(self.ingress._tasks), 0)

    async def test_installed_invoke_hook_consumes_core_exception(self):
        with patch.object(self.ingress.subprocess, 'run', side_effect=subprocess.TimeoutExpired('SIMULADO', 10)):
            self.invoke(); result = await self.finish()
            self.assertEqual((result['effect'], result['confirmation']), ('unknown', 'not_attempted'))
            self.assertEqual(self.request.calls, [])
