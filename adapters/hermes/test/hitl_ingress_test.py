"""Gateway, Telegram, CLI e credenciais exclusivamente SIMULADOS; sem rede."""
import asyncio
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import threading
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import AsyncMock, patch
from datetime import datetime, timezone, timedelta
from layout import plugin_directory

spec = importlib.util.spec_from_file_location('ingress', plugin_directory() / '__init__.py')
ingress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingress)


class Message(SimpleNamespace):
    def get_bot(self):
        return SimpleNamespace(id=99)


class MessageEvent(SimpleNamespace):
    pass


def receipt(operation='gate', **changes):
    value = {'ok': True, 'pedidoId': 'pedido-1', 'estado': 'aprovado', 'repetida': False}
    if operation == 'session':
        value.update(estado='entregue', sessionId='sessao-SIMULADA')
    value.update(changes)
    return SimpleNamespace(returncode=0, stdout=json.dumps(value))


class IngressTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'ORK_HITL_INGRESS_KEY_HERMES': 'chave-SIMULADA-exclusiva-dos-testes-000',
            'ORK_HITL_TELEGRAM_USERS': '42', 'ORK_HITL_TELEGRAM_CHATS': '-7',
            'ORK_HITL_TELEGRAM_BOT_ID': '99', 'ORK_HITL_ROOT': '/tmp', 'ORK_BIN': 'ork-simulado'}, clear=True)
        self.env.start(); self.addCleanup(self.env.stop)
        base, telegram = ModuleType('gateway.platforms.base'), ModuleType('telegram')
        base.MessageEvent, telegram.Message = MessageEvent, Message
        modules = patch.dict('sys.modules', {'gateway.platforms.base': base, 'telegram': telegram})
        modules.start(); self.addCleanup(modules.stop)
        self.msg = Message(text='/ork gate ork-simulado pedido-1 resposta ç 😀 e\u0301 $()', message_id=8,
            from_user=SimpleNamespace(id=42, is_bot=False), chat=SimpleNamespace(id=-7), date=datetime.now(timezone.utc))
        self.sent = Message(message_id=9, chat=self.msg.chat, from_user=SimpleNamespace(id=99, is_bot=True),
                            text=ingress.CONFIRM_TEXT['gate'])
        self.msg.reply_text = AsyncMock(return_value=self.sent)
        self.event = MessageEvent(text=self.msg.text, raw_message=self.msg, message_id='8',
            source=SimpleNamespace(platform=SimpleNamespace(value='telegram'), user_id='42', chat_id='-7'))
        self.gateway = SimpleNamespace(_is_user_authorized=lambda _: True)
        ingress._entries.clear()
        ingress._tasks.clear()

    def invoke(self):
        return ingress._ingress(event=self.event, gateway=self.gateway)

    async def finish(self):
        await asyncio.gather(*list(ingress._tasks))
        await asyncio.sleep(0)
        return self.invoke()

    async def test_native_hook_only_and_sync_skip(self):
        hooks = []
        ingress.register(SimpleNamespace(register_hook=lambda *args: hooks.append(args)))
        self.assertEqual(hooks[0][0], 'pre_gateway_dispatch')
        self.assertFalse(asyncio.iscoroutinefunction(hooks[0][1]))
        with patch.object(ingress.subprocess, 'run') as run:
            result = ingress._ingress(event=SimpleNamespace(**vars(self.event)), gateway=self.gateway)
            self.assertEqual(result['action'], 'skip')
            run.assert_not_called()
        self.event.text = 'conversa normal'
        self.assertIsNone(self.invoke())

    async def test_envelope_stdin_signature_unicode_receipt_replay(self):
        with patch.object(ingress.subprocess, 'run', return_value=receipt()) as run:
            initial = self.invoke()
            self.assertEqual(initial['effect'], 'pending')
            self.assertEqual(self.invoke()['effect'], 'pending')
            result = await self.finish()
            self.assertEqual((result['action'], result['effect'], result['confirmation']), ('skip', 'confirmed', 'sent'))
            self.assertTrue(result['replay'])
            self.assertEqual(run.call_count, 1)
            argv, kw = run.call_args.args[0], run.call_args.kwargs
            body = json.loads(kw['input'])
            self.assertNotIn(body['resposta'], argv)
            self.assertEqual(body['resposta'], 'resposta ç 😀 e\u0301 $()')
            # D12: o canal entra no corpo assinado; um v1 sobre o mesmo envelope nao bate.
            self.assertEqual(body['canal'], 'hermes')
            self.assertEqual(argv[argv.index('--canal') + 1], 'hermes')
            # FX5: `conta` tem posicao fixa no corpo v2 e e None neste canal.
            canonical = ['ork.hitl-answer/v2', 'ork-simulado', 'pedido-1', 'hermes', None, body['origem'], body['por'], body['mensagem'], body['recebidoEm'], body['resposta']]
            self.assertIsNone(body.get('conta'))
            expected = hmac.new(os.environ['ORK_HITL_INGRESS_KEY_HERMES'].encode(), json.dumps(canonical, ensure_ascii=False, separators=(',', ':')).encode(), hashlib.sha256).hexdigest()
            self.assertEqual(body['prova'], expected)
            antigo_v1 = ['ork.hitl-answer/v1', 'ork-simulado', 'pedido-1', body['origem'], body['por'], body['mensagem'], body['recebidoEm'], body['resposta']]
            self.assertNotEqual(body['prova'], hmac.new(os.environ['ORK_HITL_INGRESS_KEY_HERMES'].encode(), json.dumps(antigo_v1, ensure_ascii=False, separators=(',', ':')).encode(), hashlib.sha256).hexdigest())
            self.assertEqual(argv[5], '--resposta-stdin')
            self.assertEqual(kw['cwd'], '/tmp')
            self.assertEqual(kw['timeout'], 10)
            self.assertEqual(kw['encoding'], 'utf-8')
            self.assertFalse(kw.get('shell', False))
            self.msg.reply_text.assert_awaited_once()
            self.assertEqual(self.msg.reply_text.call_args.args, (ingress.CONFIRM_TEXT['gate'],))
            self.assertFalse(self.msg.reply_text.call_args.kwargs['do_quote'])
            for part in ['read', 'write', 'connect', 'pool']:
                self.assertEqual(self.msg.reply_text.call_args.kwargs[part + '_timeout'], 3)

    async def test_session_and_gate_refusal_have_static_non_approval_text(self):
        for operation, state in [('session', 'entregue'), ('gate', 'recusado'), ('gate', 'aguardando')]:
            with self.subTest(operation=operation, state=state):
                ingress._entries.clear(); self.msg.reply_text.reset_mock()
                self.msg.text = self.event.text = f'/ork {operation} ork-simulado pedido-1 NÃO 😀'
                self.sent.text = ingress.CONFIRM_TEXT[operation]
                with patch.object(ingress.subprocess, 'run', return_value=receipt(operation, estado=state)) as run:
                    self.invoke(); result = await self.finish()
                    self.assertEqual(result['confirmation'], 'sent')
                    argv = run.call_args.args[0]
                    self.assertEqual(argv[1], 'sessions' if operation == 'session' else 'gate')
                    # `gate answer` exige --resposta-stdin e `sessions answer` exige --stdin.
                    # A mesma flag para os dois fazia o CLI recusar toda resposta de sessao.
                    self.assertEqual(argv[5], '--resposta-stdin' if operation == 'gate' else '--stdin')
                    self.assertEqual(argv[argv.index('--canal') + 1], 'hermes')
                    self.assertEqual(json.loads(run.call_args.kwargs['input'])['canal'], 'hermes')
                    self.assertNotIn('NÃO', self.msg.reply_text.call_args.args[0])

    async def test_recuses_auth_bot_chat_internal_mismatch_stale_future_forward(self):
        cases = [(self.gateway, '_is_user_authorized', lambda _: False), (self.gateway, '_is_user_authorized', lambda _: 1),
            (self.msg.from_user, 'is_bot', True), (self.msg.from_user, 'id', 43),
            (self.msg.chat, 'id', -8), (self.event, 'internal', True), (self.event, 'message_id', '9'),
            (self.event.source, 'user_id', '43'), (self.event.source, 'chat_id', '-8'),
            (self.event.source.platform, 'value', 'discord'), (self.msg, 'message_id', 0),
            (self.msg, 'text', '/ork gate ork-outra pedido-1 outra'),
            (self.event, 'raw_message', SimpleNamespace(**vars(self.msg))),
            (self.msg, 'date', datetime.now(timezone.utc) - timedelta(seconds=61)),
            (self.msg, 'date', datetime.now(timezone.utc) + timedelta(seconds=30)),
            (self.msg, 'date', datetime.now()), (self.msg, 'forward_origin', object()),
            (self.msg, 'sender_chat', object()), (self.msg, 'get_bot', lambda: SimpleNamespace(id=100))]
        for target, key, value in cases:
            with self.subTest(key=key), patch.object(target, key, value, create=True), patch.object(ingress.subprocess, 'run') as run:
                result = self.invoke()
                self.assertEqual(result['action'], 'skip')
                self.assertFalse(ingress._tasks)
                run.assert_not_called()
                self.msg.reply_text.assert_not_called()

    async def test_recuses_configuration_and_invalid_command(self):
        for key, value in [('ORK_HITL_TELEGRAM_USERS', ''), ('ORK_HITL_TELEGRAM_CHATS', ''),
                           ('ORK_HITL_TELEGRAM_BOT_ID', ''), ('ORK_HITL_INGRESS_KEY_HERMES', 'short'),
                           ('ORK_HITL_ROOT', 'relative')]:
            with self.subTest(key=key), patch.dict(os.environ, {key: value}):
                self.assertEqual(self.invoke()['effect'], 'unconfirmed')
                self.assertFalse(ingress._tasks)
        for text in ['/ork gate x y ', '/ork gate x y \x00', '/ork invalid', '/ork gate ../x y a',
                     '/ork gate x y ' + 'a' * 4097]:
            self.msg.text = self.event.text = text
            self.assertEqual(self.invoke()['action'], 'skip')
            self.assertFalse(ingress._tasks)

    async def test_invalid_core_receipts_never_send(self):
        outputs = [receipt(ok=False), receipt(ok=1), receipt(pedidoId='pedido-outro'),
                   receipt(estado='entregue'), receipt(repetida=None), receipt(repetida=1),
                   SimpleNamespace(returncode=1, stdout=receipt().stdout),
                   SimpleNamespace(returncode=0, stdout='[]'), SimpleNamespace(returncode=0, stdout='not-json'),
                   SimpleNamespace(returncode=0, stdout='{"ok":true,"pedidoId":"pedido-1"}')]
        for output in outputs:
            with self.subTest(output=output), patch.object(ingress.subprocess, 'run', return_value=output) as run:
                ingress._entries.clear()
                self.invoke(); result = await self.finish()
                self.assertEqual(result['effect'], 'unknown')
                self.assertEqual(result['confirmation'], 'not_attempted')
                self.msg.reply_text.assert_not_called()
                self.assertEqual(run.call_count, 1)

    async def test_core_timeout_and_exception_consume_without_echo(self):
        for error in [RuntimeError('segredo-SIMULADO'), subprocess.TimeoutExpired('segredo-SIMULADO', 10)]:
            with self.subTest(kind=type(error).__name__), patch.object(ingress.subprocess, 'run', side_effect=error), self.assertLogs(ingress.logger, level='INFO') as logs:
                ingress._entries.clear()
                self.invoke(); result = await self.finish()
                self.assertEqual(result['action'], 'skip')
                self.assertEqual(result['effect'], 'unknown')
                self.assertNotIn('segredo-SIMULADO', str(result) + str(logs.output))
                self.msg.reply_text.assert_not_called()

    async def test_confirmation_timeout_does_not_undo_effect_or_retry(self):
        async def slow(*args, **kwargs):
            await asyncio.sleep(10)
        self.msg.reply_text.side_effect = slow
        with patch.object(ingress, 'CONFIRM_TIMEOUT', 0.03), patch.object(ingress.subprocess, 'run', return_value=receipt()) as run:
            started = asyncio.get_running_loop().time()
            self.invoke(); result = await self.finish()
            self.assertLess(asyncio.get_running_loop().time() - started, 0.5)
            self.assertEqual((result['effect'], result['confirmation']), ('confirmed', 'unknown'))
            self.assertEqual(run.call_count, 1)
            self.msg.reply_text.assert_awaited_once()

    async def test_confirmation_exceptions_invalid_receipt_do_not_claim_sent(self):
        for output in [None, True, SimpleNamespace(message_id=9),
                       Message(message_id=0), Message(message_id=9, chat=SimpleNamespace(id=-8)),
                       RuntimeError('segredo-SIMULADO')]:
            with self.subTest(kind=type(output).__name__), patch.object(ingress.subprocess, 'run', return_value=receipt()), self.assertLogs(ingress.logger, level='INFO') as logs:
                ingress._entries.clear(); self.msg.reply_text.reset_mock()
                self.msg.reply_text.side_effect = output if isinstance(output, Exception) else None
                self.msg.reply_text.return_value = output
                self.invoke(); result = await self.finish()
                self.assertEqual((result['effect'], result['confirmation']), ('confirmed', 'unknown'))
                self.assertNotIn('segredo-SIMULADO', str(logs.output) + str(result))
                self.msg.reply_text.assert_awaited_once()

    async def test_replay_from_durable_core_after_restart_does_not_resend_channel(self):
        with patch.object(ingress.subprocess, 'run', return_value=receipt(repetida=True)) as run:
            self.invoke(); result = await self.finish()
            self.assertEqual((result['effect'], result['confirmation']), ('confirmed', 'unknown'))
            self.msg.reply_text.assert_not_called()
            self.assertEqual(run.call_count, 1)

    async def test_divergent_replay_and_other_operation_do_not_repeat_action(self):
        with patch.object(ingress.subprocess, 'run', return_value=receipt()) as run:
            self.invoke(); await self.finish()
            for text in ['/ork gate ork-simulado pedido-1 outra', '/ork session ork-simulado pedido-1 resposta',
                         '/ork gate outra-thread pedido-1 resposta', '/ork gate ork-simulado pedido-2 resposta']:
                self.msg.text = self.event.text = text
                self.assertEqual(self.invoke()['effect'], 'unconfirmed')
            self.assertEqual(run.call_count, 1)
            self.msg.reply_text.assert_awaited_once()

    async def test_active_loop_remains_responsive_and_confirms_only_after_core(self):
        started, release = threading.Event(), threading.Event()
        def slow(*args, **kwargs):
            started.set()
            if not release.wait(1):
                raise TimeoutError('SIMULADO')
            return receipt()
        with patch.object(ingress.subprocess, 'run', side_effect=slow):
            self.assertEqual(self.invoke()['action'], 'skip')
            try:
                for _ in range(100):
                    if started.is_set(): break
                    await asyncio.sleep(0.001)
                self.assertTrue(started.is_set())
                self.msg.reply_text.assert_not_called()
                self.assertEqual(self.invoke()['effect'], 'unknown')
            finally:
                release.set()
            self.assertEqual((await self.finish())['confirmation'], 'sent')

    async def test_no_active_loop_consumes_without_cross_loop_bot(self):
        result = await asyncio.to_thread(self.invoke)
        self.assertEqual(result['action'], 'skip')
        self.assertFalse(ingress._tasks)
        self.msg.reply_text.assert_not_called()

    async def test_capacity_and_task_creation_failure_are_closed(self):
        with patch.object(ingress, 'MAX_PENDING', 0):
            self.assertEqual(self.invoke()['effect'], 'unconfirmed')
        with patch.object(ingress, 'MAX_ENTRIES', 0):
            self.assertEqual(self.invoke()['effect'], 'unconfirmed')
        loop = asyncio.get_running_loop()
        with patch.object(loop, 'create_task', side_effect=RuntimeError('segredo-SIMULADO')):
            self.assertEqual(self.invoke()['effect'], 'unconfirmed')
        self.assertFalse(ingress._tasks)
        self.msg.reply_text.assert_not_called()

    async def test_cancellation_after_effect_retains_confirmed_unknown(self):
        started = asyncio.Event()
        async def waiting(*args, **kwargs):
            started.set()
            await asyncio.sleep(10)
        self.msg.reply_text.side_effect = waiting
        with patch.object(ingress.subprocess, 'run', return_value=receipt()):
            self.invoke()
            await asyncio.wait_for(started.wait(), 1)
            for task in list(ingress._tasks): task.cancel()
            result = await self.finish()
            self.assertEqual((result['effect'], result['confirmation']), ('confirmed', 'unknown'))


    # I-41 (GO-FIX 1): o dono responde ao resumo e ao lote sem barra e sem identificador.
    def pulse_receipt(self, **changes):
        value = {'contrato': 'ork.pulse-resposta/v1', 'ok': True, 'tipo': 'lote', 'repetida': False,
                 'registradas': [], 'recusas': [], 'mensagem': 'Orkastery, 2 respostas registradas SIMULADAS'}
        value.update(changes)
        return SimpleNamespace(returncode=0, stdout=json.dumps(value))

    def say(self, text):
        self.msg.text = self.event.text = text

    async def test_pulse_answer_signs_pulse_address_and_replies_core_text(self):
        for text in ['P4EJ a', '1a 2c', '#OrkPulseOn-15m']:
            with self.subTest(text=text):
                ingress._entries.clear(); self.msg.reply_text.reset_mock()
                self.say(text)
                self.sent.text = 'Orkastery, 2 respostas registradas SIMULADAS'
                with patch.object(ingress.subprocess, 'run', return_value=self.pulse_receipt()) as run:
                    self.assertEqual(self.invoke()['action'], 'skip')
                    result = await self.finish()
                    self.assertEqual((result['effect'], result['confirmation']), ('confirmed', 'sent'))
                    argv, kw = run.call_args.args[0], run.call_args.kwargs
                    self.assertEqual(argv[:4], ['ork-simulado', 'pulse', 'responder', '--resposta-stdin'])
                    self.assertEqual(argv[argv.index('--canal') + 1], 'hermes')
                    body = json.loads(kw['input'])
                    # O texto inteiro e a resposta, e nunca vai em argv.
                    self.assertEqual(body['resposta'], text)
                    self.assertNotIn(text, argv)
                    # O endereco assinado e o do pulse, com a chave deste canal e o corpo v2 de sempre.
                    canonical = ['ork.hitl-answer/v2', 'pulse', 'resposta', 'hermes', None, 'telegram',
                                 body['por'], body['mensagem'], body['recebidoEm'], text]
                    expected = hmac.new(os.environ['ORK_HITL_INGRESS_KEY_HERMES'].encode(),
                        json.dumps(canonical, ensure_ascii=False, separators=(',', ':')).encode(), hashlib.sha256).hexdigest()
                    self.assertEqual(body['prova'], expected)
                    # O que volta ao dono e o texto que o nucleo montou, transportado como veio.
                    self.assertEqual(self.msg.reply_text.call_args.args, ('Orkastery, 2 respostas registradas SIMULADAS',))

    async def test_pulse_shape_is_strict_and_ordinary_chat_goes_to_the_assistant(self):
        for text in ['1a', '1a, 2c', 'p4ej sim', 'K3F9 agora não', '#orkpulseoff', ' #OrkPulseOn. ']:
            with self.subTest(text=text), patch.object(ingress.subprocess, 'run', return_value=self.pulse_receipt()):
                ingress._entries.clear(); self.say(text)
                self.assertEqual(self.invoke()['action'], 'skip')
                await self.finish()
        for text in ['oi tudo bem', 'HMMM ok', '7XYZ b', 'P4EJ', '1ab', 'bora 2', '1a\n2b',
                     'fica em #OrkPulseOn hoje', '#OrkPulseOff-15m', '#OrkPulseOn-45m']:
            with self.subTest(text=text), patch.object(ingress.subprocess, 'run') as run:
                ingress._entries.clear(); self.say(text)
                self.assertIsNone(self.invoke())
                run.assert_not_called()

    async def test_pulse_keeps_every_gate_refusal(self):
        self.say('1a')
        for target, key, value in [(self.msg.from_user, 'id', 43), (self.msg.chat, 'id', -8),
                                   (self.msg, 'date', datetime.now(timezone.utc) - timedelta(seconds=61)),
                                   (self.msg, 'forward_origin', object()), (self.msg.from_user, 'is_bot', True)]:
            with self.subTest(key=key), patch.object(target, key, value, create=True), patch.object(ingress.subprocess, 'run') as run:
                ingress._entries.clear()
                self.assertEqual(self.invoke()['action'], 'skip')
                run.assert_not_called()
                self.msg.reply_text.assert_not_called()
        # Fora do Telegram a resposta ao pulse nao e reconhecida: o resumo sai la.
        with patch.object(self.event.source.platform, 'value', 'discord'), patch.object(ingress.subprocess, 'run') as run:
            ingress._entries.clear()
            self.assertIsNone(self.invoke())
            run.assert_not_called()

    async def test_pulse_repeated_or_invalid_receipt_never_sends(self):
        self.say('1a')
        for output in [self.pulse_receipt(repetida=True), self.pulse_receipt(contrato='ork.hitl/v2'),
                       self.pulse_receipt(mensagem=''), self.pulse_receipt(ok=False), self.pulse_receipt(repetida=None),
                       SimpleNamespace(returncode=1, stdout=self.pulse_receipt().stdout)]:
            with self.subTest(output=output.stdout[:60]), patch.object(ingress.subprocess, 'run', return_value=output):
                ingress._entries.clear(); self.msg.reply_text.reset_mock()
                self.invoke(); await self.finish()
                self.msg.reply_text.assert_not_called()

    async def test_pulse_replay_of_same_message_calls_core_once(self):
        self.say('P4EJ a')
        self.sent.text = 'Orkastery, 2 respostas registradas SIMULADAS'
        with patch.object(ingress.subprocess, 'run', return_value=self.pulse_receipt()) as run:
            self.invoke(); self.invoke()
            result = await self.finish()
            self.assertTrue(result['replay'])
            self.assertEqual(run.call_count, 1)
            self.msg.reply_text.assert_awaited_once()

if __name__ == '__main__':
    unittest.main()
