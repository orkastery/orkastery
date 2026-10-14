"""RM-058 N6: o comando /ork noctum no ingresso do Telegram. Gateway, Telegram, CLI e credenciais SIMULADOS; sem rede."""
import asyncio
import hashlib
import hmac
import importlib.util
import json
import os
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import AsyncMock, patch
from datetime import datetime, timezone, timedelta
from layout import plugin_directory

spec = importlib.util.spec_from_file_location('ingress_noctum', plugin_directory() / '__init__.py')
ingress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingress)

HASH = 'a' * 64


class Message(SimpleNamespace):
    def get_bot(self):
        return SimpleNamespace(id=99)


class MessageEvent(SimpleNamespace):
    pass


def recibo(**changes):
    value = {'ok': True, 'contrato': 'ork.noctum-ingresso/v1', 'arco': 'arco-simulado', 'ato': 'autorizar', 'situacao': 'vigente',
             'versao': 1, 'envelopeSha256': HASH, 'repetida': False}
    value.update(changes)
    return SimpleNamespace(returncode=0, stdout=json.dumps(value))


class NoctumIngressTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'ORK_HITL_INGRESS_KEY_HERMES': 'chave-SIMULADA-exclusiva-dos-testes-000',
            'ORK_HITL_TELEGRAM_USERS': '42', 'ORK_HITL_TELEGRAM_CHATS': '-7',
            'ORK_HITL_TELEGRAM_BOT_ID': '99', 'ORK_HITL_ROOT': '/tmp', 'ORK_BIN': 'ork-simulado'}, clear=True)
        self.env.start(); self.addCleanup(self.env.stop)
        base, telegram = ModuleType('gateway.platforms.base'), ModuleType('telegram')
        base.MessageEvent, telegram.Message = MessageEvent, Message
        modules = patch.dict('sys.modules', {'gateway.platforms.base': base, 'telegram': telegram})
        modules.start(); self.addCleanup(modules.stop)
        ingress._entries.clear()
        ingress._tasks.clear()

    def mensagem(self, texto, usuario=42, idade=0):
        msg = Message(text=texto, message_id=8, from_user=SimpleNamespace(id=usuario, is_bot=False), chat=SimpleNamespace(id=-7),
                      date=datetime.now(timezone.utc) - timedelta(seconds=idade))
        msg.reply_text = AsyncMock(return_value=Message(message_id=9, chat=msg.chat, from_user=SimpleNamespace(id=99, is_bot=True),
                                                        text=ingress.CONFIRM_TEXT['noctum']))
        evento = MessageEvent(text=texto, raw_message=msg, message_id='8',
            source=SimpleNamespace(platform=SimpleNamespace(value='telegram'), user_id=str(usuario), chat_id='-7'))
        return msg, evento

    def invocar(self, evento):
        return ingress._ingress(event=evento, gateway=SimpleNamespace(_is_user_authorized=lambda _: True))

    async def terminar(self, evento):
        await asyncio.gather(*list(ingress._tasks))
        await asyncio.sleep(0)
        return self.invocar(evento)

    async def test_autorizar_assina_o_endereco_do_arco_e_entrega_ao_responder(self):
        msg, evento = self.mensagem(f'/ork noctum arco-simulado autorizar {HASH}')
        with patch.object(ingress.subprocess, 'run', return_value=recibo()) as run:
            self.invocar(evento)
            r = await self.terminar(evento)
            self.assertEqual((r['effect'], r['confirmation']), ('confirmed', 'sent'))
            argv, kw = run.call_args.args[0], run.call_args.kwargs
            self.assertEqual(argv, ['ork-simulado', 'noctum', 'responder', 'arco-simulado', '--resposta-stdin', '--origem', 'telegram',
                                    '--canal', 'hermes', '--por', 'telegram:42', '--mensagem', 'telegram:-7:8'])
            corpo = json.loads(kw['input'])
            self.assertEqual(corpo['resposta'], f'autorizar {HASH}')
            canonico = ['ork.hitl-answer/v2', 'noctum', 'arco:arco-simulado', 'hermes', None, 'telegram', 'telegram:42', 'telegram:-7:8',
                        corpo['recebidoEm'], f'autorizar {HASH}']
            esperado = hmac.new(os.environ['ORK_HITL_INGRESS_KEY_HERMES'].encode(),
                                json.dumps(canonico, ensure_ascii=False, separators=(',', ':')).encode(), hashlib.sha256).hexdigest()
            self.assertEqual(corpo['prova'], esperado)
            msg.reply_text.assert_awaited_once()
            self.assertEqual(msg.reply_text.call_args.args, (ingress.CONFIRM_TEXT['noctum'],))

    async def test_revogar_vai_pelo_mesmo_caminho(self):
        _msg, evento = self.mensagem('/ork noctum arco-simulado revogar')
        with patch.object(ingress.subprocess, 'run', return_value=recibo(ato='revogar', situacao='revogado')) as run:
            self.invocar(evento)
            r = await self.terminar(evento)
            self.assertEqual(r['effect'], 'confirmed')
            self.assertEqual(json.loads(run.call_args.kwargs['input'])['resposta'], 'revogar')

    async def test_comando_malformado_nao_chama_o_nucleo(self):
        for texto in ['/ork noctum arco-simulado autorizar abc', '/ork noctum ARCO autorizar ' + HASH, '/ork noctum arco-simulado aprovar',
                      '/ork noctum arco:x revogar', '/ork noctum arco-simulado revogar agora', f'/ork noctum arco-simulado autorizar {HASH.upper()}']:
            with self.subTest(texto=texto), patch.object(ingress.subprocess, 'run') as run:
                ingress._entries.clear()
                _msg, evento = self.mensagem(texto)
                r = self.invocar(evento)
                self.assertEqual((r['action'], r['effect']), ('skip', 'unconfirmed'))
                run.assert_not_called()

    async def test_usuario_fora_da_lista_e_mensagem_velha_nao_chegam_ao_nucleo(self):
        for usuario, idade in [(43, 0), (42, 120)]:
            with self.subTest(usuario=usuario, idade=idade), patch.object(ingress.subprocess, 'run') as run:
                ingress._entries.clear()
                _msg, evento = self.mensagem(f'/ork noctum arco-simulado autorizar {HASH}', usuario=usuario, idade=idade)
                self.assertEqual(self.invocar(evento)['effect'], 'unconfirmed')
                run.assert_not_called()

    async def test_recibo_de_outro_arco_ou_contrato_nao_confirma(self):
        # O recibo de outro ato ou de outro hash tambem nao confirma: o gateway so diz ao dono o ato que ele pediu.
        for errado in [recibo(arco='outro-arco'), recibo(contrato='ork.hitl-gate/v1'), recibo(ato='aprovar'), recibo(repetida='nao'),
                       recibo(ato='revogar', situacao='revogado'), recibo(envelopeSha256='c' * 64)]:
            with self.subTest(recibo=errado.stdout), patch.object(ingress.subprocess, 'run', return_value=errado):
                ingress._entries.clear()
                msg, evento = self.mensagem(f'/ork noctum arco-simulado autorizar {HASH}')
                self.invocar(evento)
                r = await self.terminar(evento)
                self.assertNotEqual(r['effect'], 'confirmed')
                msg.reply_text.assert_not_awaited()

    async def test_ato_que_ja_valia_nao_confirma_de_novo_ao_dono(self):
        msg, evento = self.mensagem(f'/ork noctum arco-simulado autorizar {HASH}')
        with patch.object(ingress.subprocess, 'run', return_value=recibo(repetida=True)):
            self.invocar(evento)
            r = await self.terminar(evento)
            self.assertEqual((r['effect'], r['confirmation']), ('confirmed', 'unknown'))
            msg.reply_text.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
