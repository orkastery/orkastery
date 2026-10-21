"""RM-057 (resposta curta): o reply a uma pergunta do bot no ingresso do Telegram. Gateway, Telegram, CLI e credenciais SIMULADOS; sem rede.

GO-FIX 1 (achado 2): a referencia so sai do titulo da pergunta do arco e leva o id da mensagem respondida; confirmacao,
recusa, lembrete e conversa nunca dao referencia, e so a resposta a uma pergunta vai com ela.

GO-FIX 2 (rodada 2 do CHECK, R1): a palavra solta em reply a qualquer outra mensagem vai marcada (`resposta:outra`), e o
nucleo a recusa; o codigo e o numero dizem a pergunta e vao sem a marca; a abertura do topico do forum nao e reply.
"""
import asyncio
import hashlib
import hmac
import importlib.util
import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import AsyncMock, patch
from datetime import datetime, timedelta, timezone
from layout import plugin_directory

spec = importlib.util.spec_from_file_location('ingress_resposta_curta', plugin_directory() / '__init__.py')
ingress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingress)

PERGUNTA = '🔔 7. arco arco-simulado · NX4K\n❓ Autorizar o arco arco-simulado (proposta 1)?\n↩️ Responda a, b ou c. Detalhes: NX4K detalhes.'
CONFIRMACAO = 'NX4K → b) Adiar: nada muda, e a proposta vence às 05:09 se você não autorizar antes.'


class Message(SimpleNamespace):
    def get_bot(self):
        return SimpleNamespace(id=99)


class MessageEvent(SimpleNamespace):
    pass


def recibo(**changes):
    value = {'ok': True, 'contrato': 'ork.pulse-resposta/v1', 'tipo': 'codigo', 'mensagem': '✅ NX4K → a) Autorizo: o arco está autorizado.',
             'repetida': False, 'registradas': [], 'recusas': []}
    value.update(changes)
    return SimpleNamespace(returncode=0, stdout=json.dumps(value))


class RespostaCurtaTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # ORK_HITL_ROOT sem pulse-escuta.json: a janela da palavra solta esta FECHADA em todos os casos.
        self.env = patch.dict(os.environ, {'ORK_HITL_INGRESS_KEY_HERMES': 'chave-SIMULADA-exclusiva-dos-testes-000',
            'ORK_HITL_TELEGRAM_USERS': '42', 'ORK_HITL_TELEGRAM_CHATS': '-7',
            'ORK_HITL_TELEGRAM_BOT_ID': '99', 'ORK_HITL_ROOT': '/tmp/ork-resposta-curta-SIMULADA-sem-escuta', 'ORK_BIN': 'ork-simulado'}, clear=True)
        self.env.start(); self.addCleanup(self.env.stop)
        base, telegram = ModuleType('gateway.platforms.base'), ModuleType('telegram')
        base.MessageEvent, telegram.Message = MessageEvent, Message
        modules = patch.dict('sys.modules', {'gateway.platforms.base': base, 'telegram': telegram})
        modules.start(); self.addCleanup(modules.stop)
        ingress._entries.clear()
        ingress._tasks.clear()

    def mensagem(self, texto, respondida=None, autor=99, bot=True, respondida_id=5):
        msg = Message(text=texto, message_id=8, from_user=SimpleNamespace(id=42, is_bot=False), chat=SimpleNamespace(id=-7),
                      date=datetime.now(timezone.utc))
        if respondida is not None:
            msg.reply_to_message = Message(text=respondida, message_id=respondida_id, from_user=SimpleNamespace(id=autor, is_bot=bot))
        msg.reply_text = AsyncMock(return_value=Message(message_id=9, chat=msg.chat, from_user=SimpleNamespace(id=99, is_bot=True),
                                                        text=recibo().stdout and json.loads(recibo().stdout)['mensagem']))
        evento = MessageEvent(text=texto, raw_message=msg, message_id='8',
            source=SimpleNamespace(platform=SimpleNamespace(value='telegram'), user_id='42', chat_id='-7'))
        return msg, evento

    def invocar(self, evento):
        return ingress._ingress(event=evento, gateway=SimpleNamespace(_is_user_authorized=lambda _: True))

    async def terminar(self, evento):
        await asyncio.gather(*list(ingress._tasks))
        await asyncio.sleep(0)
        return self.invocar(evento)

    def prova_esperada(self, corpo, endereco='resposta:NX4K:5'):
        canonico = ['ork.hitl-answer/v2', 'pulse', endereco, 'hermes', None, 'telegram', 'telegram:42', 'telegram:-7:8',
                    corpo['recebidoEm'], corpo['resposta']]
        return hmac.new(os.environ['ORK_HITL_INGRESS_KEY_HERMES'].encode(),
                        json.dumps(canonico, ensure_ascii=False, separators=(',', ':')).encode(), hashlib.sha256).hexdigest()

    async def test_reply_sim_assina_o_codigo_e_o_id_da_mensagem_respondida(self):
        msg, evento = self.mensagem('sim', respondida=PERGUNTA)
        with patch.object(ingress.subprocess, 'run', return_value=recibo()) as run:
            self.invocar(evento)
            r = await self.terminar(evento)
            self.assertEqual(r['effect'], 'confirmed')
            argv, corpo = run.call_args.args[0], json.loads(run.call_args.kwargs['input'])
            self.assertEqual(argv, ['ork-simulado', 'pulse', 'responder', '--resposta-stdin', '--origem', 'telegram', '--canal', 'hermes',
                                    '--por', 'telegram:42', '--mensagem', 'telegram:-7:8', '--em-resposta-a', 'NX4K:5'])
            self.assertEqual(corpo['resposta'], 'sim', 'o texto do dono vai como ele digitou')
            self.assertEqual(corpo['prova'], self.prova_esperada(corpo))
            msg.reply_text.assert_awaited_once()

    async def test_reply_vale_com_a_janela_fechada_para_letra_palavra_e_numero(self):
        for texto in ['a', 'autorizo', 'b', '7a']:
            with self.subTest(texto=texto), patch.object(ingress.subprocess, 'run', return_value=recibo()) as run:
                ingress._entries.clear()
                _msg, evento = self.mensagem(texto, respondida=PERGUNTA)
                self.assertIsNotNone(self.invocar(evento))
                await self.terminar(evento)
                self.assertEqual(run.call_args.args[0][-2:], ['--em-resposta-a', 'NX4K:5'])

    async def test_sem_reply_e_com_a_janela_fechada_a_palavra_vai_ao_assistente(self):
        with patch.object(ingress.subprocess, 'run') as run:
            _msg, evento = self.mensagem('sim')
            self.assertIsNone(self.invocar(evento))
            run.assert_not_called()

    async def test_reply_a_mensagem_que_nao_e_do_bot_nao_da_referencia(self):
        for autor, bot in [(42, False), (77, True)]:
            with self.subTest(autor=autor), patch.object(ingress.subprocess, 'run') as run:
                ingress._entries.clear()
                _msg, evento = self.mensagem('sim', respondida=PERGUNTA, autor=autor, bot=bot)
                self.assertIsNone(self.invocar(evento))
                run.assert_not_called()

    async def test_confirmacao_recusa_lembrete_e_conversa_nunca_dao_referencia(self):
        # S4 do CHECK, invertido: a confirmacao do "b" tem o codigo, e o "ok" a ela autorizava o arco.
        for respondida in [CONFIRMACAO, 'lembrete: NX4K', 'NX4K b', 'Orkastery: resumo sem pergunta nenhuma',
                           'texto antes\n' + PERGUNTA, '🔔 7. arco Arco-Maiusculo · NX4K']:
            with self.subTest(respondida=respondida[:30]), patch.object(ingress.subprocess, 'run') as run:
                ingress._entries.clear()
                self.assertIsNone(ingress._referencia(self.mensagem('ok', respondida=respondida)[1]))
                _msg, evento = self.mensagem('ok', respondida=respondida)
                self.assertIsNone(self.invocar(evento))
                run.assert_not_called()

    async def test_mensagem_respondida_sem_id_nao_da_referencia(self):
        for mid in [None, 0, -5, '5']:
            with self.subTest(mid=mid):
                _msg, evento = self.mensagem('sim', respondida=PERGUNTA, respondida_id=mid)
                self.assertIsNone(ingress._referencia(evento))

    async def test_codigo_digitado_em_reply_vai_com_a_referencia_e_o_nucleo_decide(self):
        with patch.object(ingress.subprocess, 'run', return_value=recibo()) as run:
            _msg, evento = self.mensagem('NX4K a', respondida=PERGUNTA)
            self.invocar(evento)
            await self.terminar(evento)
            argv, corpo = run.call_args.args[0], json.loads(run.call_args.kwargs['input'])
            self.assertEqual(argv[-2:], ['--em-resposta-a', 'NX4K:5'])
            self.assertEqual(corpo['prova'], self.prova_esperada(corpo))

    async def test_conversa_comum_em_reply_vai_ao_assistente(self):
        with patch.object(ingress.subprocess, 'run') as run:
            _msg, evento = self.mensagem('pode me explicar o envelope antes?', respondida=PERGUNTA)
            self.assertIsNone(self.invocar(evento))
            run.assert_not_called()

    async def test_o_que_nao_e_resposta_vai_sem_a_referencia(self):
        # A tag da cadencia em reply a pergunta e a cadencia de sempre, no endereco do pulse, sem --em-resposta-a.
        with patch.object(ingress.subprocess, 'run', return_value=recibo(mensagem='Cadência SIMULADA')) as run:
            _msg, evento = self.mensagem('#OrkPulseOn', respondida=PERGUNTA)
            self.invocar(evento)
            await self.terminar(evento)
            argv, corpo = run.call_args.args[0], json.loads(run.call_args.kwargs['input'])
            self.assertNotIn('--em-resposta-a', argv)
            self.assertEqual(corpo['prova'], self.prova_esperada(corpo, 'resposta'))


    # GO-FIX 2 (rodada 2 do CHECK, R1): a palavra solta em reply a outra mensagem nunca vira palavra solta.

    def janela_aberta(self):
        """A janela da palavra solta ABERTA numa raiz temporaria (ork.pulse-escuta/v1), como o nucleo a grava."""
        raiz = tempfile.TemporaryDirectory()
        self.addCleanup(raiz.cleanup)
        monitor = Path(raiz.name) / '.orkastery' / 'monitor'
        monitor.mkdir(parents=True)
        ate = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat().replace('+00:00', 'Z')
        (monitor / 'pulse-escuta.json').write_text(json.dumps({'contrato': 'ork.pulse-escuta/v1', 'livreAte': ate}))
        abrir = patch.dict(os.environ, {'ORK_HITL_ROOT': raiz.name})
        abrir.start(); self.addCleanup(abrir.stop)

    async def test_palavra_em_reply_a_outra_mensagem_vai_marcada_com_a_janela_aberta(self):
        # G1 e G1b do CHECK, invertidos no gateway: o "ok" a confirmacao de um gate e o "sim" a mensagem de outra pessoa iam
        # como palavra solta, e a janela aberta os levava a pergunta do arco.
        self.janela_aberta()
        gate = '✅ DE6H → a) Aprovo: o gate da thread exemplo-SIMULADA está aprovado.'
        pergunta_de_gate = '🔔 1. exemplo-SIMULADA · GO · DE6H\n❓ Aprovar o gate?\n↩️ Responda a, b ou c.'
        for texto, respondida, autor, bot in [('ok', gate, 99, True), ('sim', 'Alguém revisa o PR hoje?', 43, False),
                                               ('a', 'Quer que eu rode a suíte agora?', 99, True), ('sim', pergunta_de_gate, 99, True),
                                               ('autorizo', PERGUNTA, 43, False)]:
            with self.subTest(texto=texto, respondida=respondida[:20]), patch.object(ingress.subprocess, 'run', return_value=recibo()) as run:
                ingress._entries.clear()
                _msg, evento = self.mensagem(texto, respondida=respondida, autor=autor, bot=bot)
                self.assertIsNotNone(self.invocar(evento))
                await self.terminar(evento)
                argv, corpo = run.call_args.args[0], json.loads(run.call_args.kwargs['input'])
                self.assertEqual(argv[-2:], ['--em-resposta-a', 'outra'])
                self.assertEqual(corpo['prova'], self.prova_esperada(corpo, 'resposta:outra'))

    async def test_codigo_e_numero_em_reply_a_outra_mensagem_vao_sem_a_marca(self):
        self.janela_aberta()
        for texto in ['DE6H a', '1a', '1. sim']:
            with self.subTest(texto=texto), patch.object(ingress.subprocess, 'run', return_value=recibo()) as run:
                ingress._entries.clear()
                _msg, evento = self.mensagem(texto, respondida='Alguém revisa o PR hoje?', autor=43, bot=False)
                self.invocar(evento)
                await self.terminar(evento)
                argv, corpo = run.call_args.args[0], json.loads(run.call_args.kwargs['input'])
                self.assertNotIn('--em-resposta-a', argv)
                self.assertEqual(corpo['prova'], self.prova_esperada(corpo, 'resposta'))

    async def test_palavra_em_reply_a_outra_mensagem_com_a_janela_fechada_vai_ao_assistente(self):
        for respondida, autor, bot in [('Alguém revisa o PR hoje?', 43, False), (CONFIRMACAO, 99, True)]:
            with self.subTest(respondida=respondida[:20]), patch.object(ingress.subprocess, 'run') as run:
                ingress._entries.clear()
                _msg, evento = self.mensagem('sim', respondida=respondida, autor=autor, bot=bot)
                self.assertIsNone(self.invocar(evento))
                run.assert_not_called()

    async def test_topico_do_forum_nao_e_reply_e_a_mensagem_de_outro_chat_e(self):
        self.janela_aberta()
        # No forum, toda mensagem do topico vem com a abertura dele em reply_to_message: nao e reply do dono.
        with patch.object(ingress.subprocess, 'run', return_value=recibo()) as run:
            msg, evento = self.mensagem('sim')
            msg.is_topic_message, msg.message_thread_id = True, 3
            msg.reply_to_message = Message(message_id=3, forum_topic_created=SimpleNamespace(name='Orkastery'), text=None,
                                           from_user=SimpleNamespace(id=42, is_bot=False))
            self.assertFalse(ingress._em_reply(evento))
            self.invocar(evento)
            await self.terminar(evento)
            self.assertNotIn('--em-resposta-a', run.call_args.args[0])
        msg, evento = self.mensagem('sim')
        msg.is_topic_message, msg.message_thread_id = True, 3
        msg.reply_to_message = Message(message_id=3, text=None, from_user=SimpleNamespace(id=42, is_bot=False))
        self.assertFalse(ingress._em_reply(evento), 'a abertura do topico, pelo id, sem o campo do servico')
        msg.reply_to_message = Message(message_id=11, text='outra mensagem do topico', from_user=SimpleNamespace(id=43, is_bot=False))
        self.assertTrue(ingress._em_reply(evento), 'o reply a outra mensagem dentro do topico conta')
        msg, evento = self.mensagem('sim')
        msg.external_reply = SimpleNamespace(origin=SimpleNamespace(type='user'))
        self.assertTrue(ingress._em_reply(evento), 'o reply a mensagem de outro chat conta')
        self.assertFalse(ingress._em_reply(self.mensagem('sim')[1]), 'sem reply nenhum')


if __name__ == '__main__':
    unittest.main()
