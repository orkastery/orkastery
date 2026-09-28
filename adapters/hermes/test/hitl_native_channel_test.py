"""Callback/SDK/CLI SIMULADOS. Não prova identidade de uma pessoa operacional."""
import asyncio
import importlib.util
import json
import hashlib
import hmac
import os
from datetime import datetime, timezone
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import AsyncMock, patch
from layout import plugin_directory

spec = importlib.util.spec_from_file_location('native_ingress_fixture', plugin_directory() / '__init__.py')
ingress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingress)


class Message(SimpleNamespace):
    pass


class Event(SimpleNamespace):
    pass


class NativeChannelTest(unittest.IsolatedAsyncioTestCase):
    async def test_discord_callback_without_telegram_and_negative_identity(self):
        binding = dict(host='hermes', installationId='fixture', connectionId='fixture-connection', sessionId='fixture-session',
                       accountId='7', channelId='discord', conversationId='42', personId='24')
        env = dict(ORK_HITL_NATIVE_BINDING_HERMES=json.dumps(binding), ORK_HITL_NATIVE_KEY_HERMES='fixture-key-' * 4, ORK_HITL_ROOT='/tmp')
        base, discord = ModuleType('gateway.platforms.base'), ModuleType('discord')
        base.MessageEvent, discord.Message = Event, Message
        discord.AllowedMentions = SimpleNamespace(none=lambda: None)
        msg = Message(id=1, content='/ork gate ork-fixture pedido-1 1', author=SimpleNamespace(id=24, bot=False),
                      channel=SimpleNamespace(id=42), guild=SimpleNamespace(id=7), webhook_id=None, application_id=None,
                      created_at=datetime.now(timezone.utc))
        msg.reply = AsyncMock(return_value=Message(channel=msg.channel, content=ingress.CONFIRM_TEXT['gate']))
        source = SimpleNamespace(platform=SimpleNamespace(value='discord'), is_bot=False, user_id='24', chat_id='42')
        event = Event(text=msg.content, source=source, raw_message=msg, message_id='1', internal=False)
        store = SimpleNamespace(list_sessions=lambda: [SimpleNamespace(session_id='fixture-session', session_key='fixture-key', suspended=False)],
                                _generate_session_key=lambda _: 'fixture-key')
        gateway = SimpleNamespace(_is_user_authorized=lambda _: True)
        async def core(argv, root, envelope=None):
            if argv[1:3] == ['gate', 'context']:
                self.assertEqual(argv[-1], '--native-offer-stdin')
                n = envelope['native']
                body = ['ork.hitl-native-offer/v1', 'ork-fixture', 'pedido-1'] + [n[k] for k in
                        ['host', 'installationId', 'connectionId', 'sessionId', 'accountId', 'channelId', 'conversationId', 'personId', 'messageId']] + [envelope['recebidoEm']]
                signature = hmac.new(env['ORK_HITL_NATIVE_KEY_HERMES'].encode(), json.dumps(body, separators=(',', ':')).encode(), hashlib.sha256).hexdigest()
                self.assertEqual(envelope['prova'], signature)
                return dict(pedido=dict(id='pedido-1', thread='ork-fixture', alvo=dict(tipo='gate'), prazo='2030-01-01T00:00:00.000Z'),
                            contexto='a' * 64, pedidoSha256='b' * 64, apresentacao=dict(mensagem='Decisão pendente'),
                            canais=[dict(canal='hermes', transporte='native', estado='disponivel')])
            self.assertEqual(envelope['origem'], 'native')
            self.assertEqual(envelope['native']['sessionId'], binding['sessionId'])
            self.assertEqual(envelope['resposta'], '1')
            self.assertEqual(len(envelope['prova']), 64)
            return dict(ok=True, pedidoId='pedido-1', estado='aprovado', repetida=False)
        with patch.dict(os.environ, env, clear=True), patch.dict('sys.modules', {'gateway.platforms.base': base, 'discord': discord}), patch.object(ingress, '_native_core', side_effect=core) as cli:
            ingress._entries.clear(); ingress._tasks.clear()
            invoke = lambda: ingress._ingress(event=event, gateway=gateway, session_store=store)
            hooks = []
            ingress.register(SimpleNamespace(register_hook=lambda *a: hooks.append(a)))
            self.assertEqual(hooks[0][0], 'pre_gateway_dispatch')
            event.internal = True
            self.assertEqual(invoke()['effect'], 'unconfirmed')
            event.internal = False; msg.author.bot = True
            self.assertEqual(invoke()['effect'], 'unconfirmed')
            msg.author.bot = False; source.user_id = 'other'
            self.assertEqual(invoke()['effect'], 'unconfirmed')
            source.user_id = '24'
            self.assertEqual(invoke()['effect'], 'pending')
            await asyncio.gather(*list(ingress._tasks))
            self.assertEqual(invoke()['effect'], 'confirmed')
            self.assertEqual(cli.call_count, 2)
            msg.reply.assert_awaited_once()
            msg.id = 2; event.message_id = '2'
            msg.content = event.text = '/ork offer ork-fixture pedido-1'
            text = 'Decisão pendente\nCanal nativo Hermes disponível nesta conversa.'
            msg.reply.return_value = Message(channel=msg.channel, content=text)
            self.assertEqual(invoke()['effect'], 'pending')
            await asyncio.gather(*list(ingress._tasks))
            self.assertEqual(invoke()['effect'], 'presented')
            self.assertEqual(invoke()['confirmation'], 'sent')
            self.assertEqual(cli.call_count, 3)
            self.assertEqual(msg.reply.await_args.args[0], text)
            del os.environ['ORK_HITL_NATIVE_BINDING_HERMES']
            self.assertEqual(invoke()['effect'], 'unconfirmed')
