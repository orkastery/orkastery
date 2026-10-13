"""RM-063 (fatia 3): o que o canal do dono ganha no host Hermes.

H2: #OrkRetomar e #OrkFabrica, sozinhos na mensagem, chegam ao núcleo pelo endereço assinado do pulse;
H1: bin/ork-vigia-batida.py lê o `ork doctor --json` e manda o aviso, o alerta ou nada.
Gateway, Telegram, Hermes, `ork`, chaves e chats exclusivamente SIMULADOS; sem rede.
"""
import asyncio
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import AsyncMock, patch
from datetime import datetime, timezone
from layout import plugin_directory

spec = importlib.util.spec_from_file_location('ingress', plugin_directory() / '__init__.py')
ingress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingress)

VIGIA = Path(__file__).resolve().parents[1] / 'bin/ork-vigia-batida.py'
RETOMANDO = ('Retomando: a batida da condução está rodando nesta máquina agora (SIMULADO). '
             'O que voltou a andar chega em seguida, por este canal.')
FABRICA = 'Fabrica: 1 maquina SIMULADA\n  maquina-simulada  3 threads  ultima batida 01:30'
# Conversa que cita as tags: vai ao assistente, nunca ao núcleo.
CONVERSA = ['pode #OrkRetomar', '#OrkRetomarAgora', '#OrkFabrica e o resto', '#Ork', 'fica em #OrkFabrica hoje']


class Message(SimpleNamespace):
    def get_bot(self):
        return SimpleNamespace(id=99)


class MessageEvent(SimpleNamespace):
    pass


class FormaTest(unittest.TestCase):
    def test_retomar_e_fabrica_so_sozinhos_na_mensagem(self):
        with patch.dict(os.environ, {'ORK_HITL_ROOT': ''}):
            for text in ['#OrkRetomar', '  #orkfabrica! ', '#OrkFabrica.', '#ORKRETOMAR']:
                self.assertTrue(ingress._is_pulse(text), text)
            for text in CONVERSA:
                self.assertFalse(ingress._is_pulse(text), text)


class CanalTest(unittest.IsolatedAsyncioTestCase):
    """O mesmo cenário do IngressTest de hitl_ingress_test.py, com os comandos de condução."""

    def setUp(self):
        self.env = patch.dict(os.environ, {'ORK_HITL_INGRESS_KEY_HERMES': 'chave-SIMULADA-exclusiva-dos-testes-000',
            'ORK_HITL_TELEGRAM_USERS': '42', 'ORK_HITL_TELEGRAM_CHATS': '-7',
            'ORK_HITL_TELEGRAM_BOT_ID': '99', 'ORK_HITL_ROOT': '/tmp', 'ORK_BIN': 'ork-simulado'}, clear=True)
        self.env.start(); self.addCleanup(self.env.stop)
        base, telegram = ModuleType('gateway.platforms.base'), ModuleType('telegram')
        base.MessageEvent, telegram.Message = MessageEvent, Message
        modules = patch.dict('sys.modules', {'gateway.platforms.base': base, 'telegram': telegram})
        modules.start(); self.addCleanup(modules.stop)
        self.msg = Message(text='#OrkRetomar', message_id=8, from_user=SimpleNamespace(id=42, is_bot=False),
                           chat=SimpleNamespace(id=-7), date=datetime.now(timezone.utc))
        self.sent = Message(message_id=9, chat=self.msg.chat, from_user=SimpleNamespace(id=99, is_bot=True), text=RETOMANDO)
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

    def say(self, text):
        self.msg.text = self.event.text = text

    def recibo(self, tipo, mensagem, **changes):
        value = {'contrato': 'ork.pulse-resposta/v1', 'ok': True, 'tipo': tipo, 'repetida': False,
                 'registradas': [], 'recusas': [], 'mensagem': mensagem}
        value.update(changes)
        return SimpleNamespace(returncode=0, stdout=json.dumps(value))

    async def test_retomar_e_fabrica_vao_ao_nucleo_pelo_endereco_assinado_do_pulse(self):
        for text, tipo, mensagem in [('#OrkRetomar', 'retomar', RETOMANDO), ('  #orkfabrica! ', 'fabrica', FABRICA)]:
            with self.subTest(text=text):
                ingress._entries.clear(); self.msg.reply_text.reset_mock()
                self.say(text)
                self.sent.text = mensagem
                with patch.object(ingress.subprocess, 'run', return_value=self.recibo(tipo, mensagem)) as run:
                    self.assertEqual(self.invoke()['action'], 'skip')
                    result = await self.finish()
                    self.assertEqual((result['effect'], result['confirmation']), ('confirmed', 'sent'))
                    argv, kw = run.call_args.args[0], run.call_args.kwargs
                    # O texto inteiro é a resposta: vai no envelope assinado pelo stdin, nunca em argv.
                    self.assertEqual(argv, ['ork-simulado', 'pulse', 'responder', '--resposta-stdin', '--origem', 'telegram',
                                            '--canal', 'hermes', '--por', 'telegram:42', '--mensagem', 'telegram:-7:8'])
                    body = json.loads(kw['input'])
                    self.assertEqual(body['resposta'], text)
                    canonical = ['ork.hitl-answer/v2', 'pulse', 'resposta', 'hermes', None, 'telegram',
                                 body['por'], body['mensagem'], body['recebidoEm'], text]
                    expected = hmac.new(os.environ['ORK_HITL_INGRESS_KEY_HERMES'].encode(),
                        json.dumps(canonical, ensure_ascii=False, separators=(',', ':')).encode(), hashlib.sha256).hexdigest()
                    self.assertEqual(body['prova'], expected)
                    # O que volta ao dono é o texto que o núcleo montou, transportado como veio.
                    self.assertEqual(self.msg.reply_text.call_args.args, (mensagem,))

    async def test_conversa_com_a_tag_e_outro_chat_nunca_chegam_ao_nucleo(self):
        for text in CONVERSA:
            with self.subTest(text=text), patch.object(ingress.subprocess, 'run') as run:
                ingress._entries.clear(); self.say(text)
                self.assertIsNone(self.invoke())
                run.assert_not_called()
        # Outro chat, fora da allowlist: recusado antes do núcleo.
        self.say('#OrkRetomar')
        with patch.object(self.msg.chat, 'id', -8), patch.object(self.event.source, 'chat_id', '-8'), \
                patch.object(ingress.subprocess, 'run') as run:
            ingress._entries.clear()
            self.assertEqual(self.invoke()['action'], 'skip')
            run.assert_not_called()
            self.msg.reply_text.assert_not_called()
        # A mesma mensagem já tratada pelo núcleo nunca é respondida de novo.
        with patch.object(ingress.subprocess, 'run', return_value=self.recibo('retomar', RETOMANDO, repetida=True)):
            ingress._entries.clear()
            self.invoke(); await self.finish()
            self.msg.reply_text.assert_not_called()


AVISO = ('Orkastery: a fabrica fabrica-simulada na maquina maquina-simulada esta sem batida ha 45 min '
         '(ultima rodada SIMULADA). Confira com: ork fabrica batida status')
BATIDA = {'threadsAbertas': 2, 'instalada': True, 'ultimaRodadaEm': '2026-10-13T00:15:00.000Z', 'codigo': 0,
          'haMin': 45, 'limiteMin': 30, 'atrasada': True, 'aviso': AVISO}
FALSO = '''#!{python}
import json, os, sys
from pathlib import Path
Path(os.environ['ORK_FALSO_REGISTRO']).write_text(json.dumps({{'argv': sys.argv[1:],
    'env': {{k: v for k, v in os.environ.items() if k.startswith(('ORK_', 'SEGREDO_'))}}}}))
sys.stderr.write('Projeto consultado: fabrica-simulada (SIMULADO)\\n')
sys.stdout.write(Path(os.environ['ORK_FALSO_SAIDA']).read_text(encoding='utf-8'))
sys.exit(int(os.environ.get('ORK_FALSO_CODIGO', '0')))
'''


def doctor_json(batida):
    return json.dumps({'contrato': 'ork.doctor/v1', 'consultadoEm': '2026-10-13T01:00:00.000Z', 'veredito': 'bloqueado',
                       'falhas': 1, 'avisos': 0, 'projeto': 'fabrica-simulada', 'maquina': 'maquina-simulada',
                       'checks': [], 'batida': batida}, indent=2)


def alerta(detalhe):
    return (f'Orkastery: o ork doctor nao respondeu na maquina maquina-simulada ({detalhe}): '
            'a batida da fabrica fabrica-simulada nao pode ser conferida.\n')


def agente_falso(root):
    """O Hermes instalado, SIMULADO como em pulse_transport_test.py; o .env carregado vira uma variável visível."""
    (root / 'tools').mkdir(parents=True)
    (root / 'tools/__init__.py').write_text('')
    (root / 'dotenv.py').write_text('import os\ndef load_dotenv(*args, **kwargs):\n'
                                    '    os.environ["SEGREDO_SIMULADO_DO_HERMES"] = "1"\n')
    (root / 'tools/send_message_tool.py').write_text(
        'import json, os\nfrom pathlib import Path\n'
        'def send_message_tool(args):\n'
        '    Path(os.environ["SINK"]).write_text(json.dumps(dict(args, segredo=os.environ.get("SEGREDO_SIMULADO_DO_HERMES"))))\n'
        '    if os.environ["OK"] == "raise":\n'
        '        raise ConnectionError("resposta bruta SIMULADA com token-SIMULADO")\n'
        '    return json.dumps({"success": os.environ["OK"] == "1", "message_id": 123})\n')


class VigiaTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.ork = self.dir / 'ork'
        self.ork.write_text(FALSO.format(python=sys.executable))
        self.ork.chmod(0o700)
        self.registro, self.saida = self.dir / 'registro.json', self.dir / 'saida.txt'

    def vigiar(self, argv=('--projeto', 'fabrica-simulada'), saida='', codigo=0, env=None):
        """Roda a batida como o cron, sem os ORK_* e HERMES_* deste processo; valor None remove a variável."""
        self.saida.write_text(saida, encoding='utf-8')
        self.registro.unlink(missing_ok=True)
        base = {k: v for k, v in os.environ.items() if not k.startswith(('ORK_', 'HERMES_', 'SEGREDO_'))}
        base.update(HOME=str(self.dir), PYTHONDONTWRITEBYTECODE='1', ORK_BIN=str(self.ork), ORK_MAQUINA='maquina-simulada',
                    ORK_FALSO_REGISTRO=str(self.registro), ORK_FALSO_SAIDA=str(self.saida), ORK_FALSO_CODIGO=str(codigo))
        base.update(env or {})
        r = subprocess.run([sys.executable, str(VIGIA), *argv], env={k: v for k, v in base.items() if v is not None},
                           text=True, capture_output=True, timeout=60)
        return r, (json.loads(self.registro.read_text()) if self.registro.exists() else None)

    def test_batida_atrasada_sem_target_imprime_o_aviso_do_nucleo(self):
        # O doctor sai 1 (veredito bloqueado) e ainda imprime o JSON: ele é lido mesmo assim.
        r, chamada = self.vigiar(saida=doctor_json(BATIDA), codigo=1, env={'ORK_CANAL': 'claude-code',
            'ORK_PROJETO_EXPLICITO': '0', 'ORK_HITL_INGRESS_KEY_HERMES': 'chave-SIMULADA-que-o-doctor-nunca-recebe-000'})
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, AVISO + '\n', ''))
        self.assertEqual(chamada['argv'], ['--projeto', 'fabrica-simulada', 'doctor', '--json'])
        self.assertEqual((chamada['env']['ORK_CANAL'], chamada['env']['ORK_PROJETO_EXPLICITO']), ('hermes', '1'))
        self.assertEqual([k for k in chamada['env'] if k.startswith('ORK_HITL_')], [], 'o doctor nunca recebe as chaves HITL')

    def test_batida_em_dia_nao_manda_nada(self):
        for batida in [dict(BATIDA, haMin=5, atrasada=False, aviso=None), None]:
            with self.subTest(batida=batida):
                r, chamada = self.vigiar(saida=doctor_json(batida))
                self.assertEqual((r.returncode, r.stdout, r.stderr), (0, '', ''))
                self.assertIsNotNone(chamada)
        r, _ = self.vigiar(saida=doctor_json(dict(BATIDA, aviso=None)))
        self.assertEqual(r.stdout, 'Orkastery: a fabrica fabrica-simulada esta sem batida. Confira com: ork fabrica batida status\n')

    def test_ork_que_falha_vira_alerta_com_detalhe_curto(self):
        r, _ = self.vigiar(saida='isto nao e json SIMULADO', codigo=2)
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, alerta('saiu com codigo 2'), ''))
        r, _ = self.vigiar(saida=json.dumps({'erro': 'projeto.desconhecido', 'detalhe': 'texto livre SIMULADO do nucleo'}), codigo=4)
        self.assertEqual((r.returncode, r.stdout), (0, alerta('saiu com codigo 4: projeto.desconhecido')))
        r, _ = self.vigiar(saida=json.dumps({'contrato': 'outro/v1'}))
        self.assertEqual((r.returncode, r.stdout), (0, alerta('resposta fora do contrato ork.doctor/v1')))
        ausente = str(self.dir / 'nao-existe' / 'ork')
        r, chamada = self.vigiar(env={'ORK_BIN': ausente})
        self.assertEqual((r.returncode, r.stdout, chamada), (0, alerta(f'ork nao encontrado em {ausente}'[:160]), None))

    def test_projeto_vem_do_argumento_ou_do_ambiente_e_sem_ele_o_alerta_diz(self):
        saida = doctor_json(None)
        self.assertEqual(self.vigiar(('--projeto=fabrica-igual',), saida=saida)[1]['argv'][1], 'fabrica-igual')
        self.assertEqual(self.vigiar((), saida=saida, env={'ORK_PROJETO': 'fabrica-do-ambiente'})[1]['argv'][1],
                         'fabrica-do-ambiente')
        r, chamada = self.vigiar((), saida=saida)
        self.assertEqual((r.returncode, chamada), (0, None))
        self.assertTrue(r.stdout.startswith('Orkastery: a batida do Hermes nao sabe qual fabrica conferir'), r.stdout)
        for argv in [('--projeto', '../fabrica'), ('--projeto', '/caminho/da/fabrica'), ('--projeto=--json',)]:
            with self.subTest(argv=argv):
                r, chamada = self.vigiar(argv, saida=saida)
                self.assertEqual((r.returncode, chamada), (0, None))
                self.assertTrue(r.stdout.startswith('Orkastery: a batida do Hermes recebeu um projeto invalido'), r.stdout)

    def test_target_entrega_pela_api_do_hermes_e_falha_sai_1(self):
        agent, sink = self.dir / 'agent', self.dir / 'enviado.json'
        agente_falso(agent)
        env = {'HERMES_HOME': str(self.dir / 'home'), 'HERMES_AGENT_DIR': str(agent), 'SINK': str(sink), 'OK': '1'}
        argv = ('--projeto', 'fabrica-simulada', '--target', 'telegram:-1001234:5')
        r, chamada = self.vigiar(argv, saida=doctor_json(dict(BATIDA, aviso=AVISO + ' MEDIA:/arquivo/privado')), env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), {'success': True, 'message_id': 123})
        enviado = json.loads(sink.read_text())
        self.assertEqual((enviado['action'], enviado['target']), ('send', 'telegram:-1001234:5'))
        # Texto do runtime não pede anexo ao host.
        self.assertEqual(enviado['message'], AVISO + ' MEDIA [texto]:/arquivo/privado')
        # O .env do Hermes foi carregado para enviar, e só depois do doctor.
        self.assertEqual(enviado['segredo'], '1')
        self.assertNotIn('SEGREDO_SIMULADO_DO_HERMES', chamada['env'])
        # O alerta do ork que falha também vai pelo canal.
        r, _ = self.vigiar(argv, saida='lixo SIMULADO', codigo=2, env=env)
        self.assertEqual((r.returncode, json.loads(sink.read_text())['message']), (0, alerta('saiu com codigo 2').rstrip('\n')))
        # Nada a avisar: nada é enviado.
        sink.unlink()
        r, _ = self.vigiar(argv, saida=doctor_json(None), env=env)
        self.assertEqual((r.returncode, r.stdout, sink.exists()), (0, '', False))
        # Entrega não confirmada ou exceção: sai 1, sem credencial nem resposta bruta.
        r, _ = self.vigiar(argv, saida=doctor_json(BATIDA), env=dict(env, OK='0'))
        self.assertEqual((r.returncode, json.loads(r.stdout)), (1, {'success': False, 'erro': 'Hermes não confirmou a entrega'}))
        r, _ = self.vigiar(argv, saida=doctor_json(BATIDA), env=dict(env, OK='raise'))
        self.assertEqual((r.returncode, json.loads(r.stdout)), (1, {'success': False, 'erro': 'ConnectionError'}))
        self.assertNotIn('token-SIMULADO', r.stdout + r.stderr)

    def test_target_sem_chat_telegram_explicito_e_recusado_antes_do_doctor(self):
        for target in ['@dono', 'telegram:1:2:3', 'discord:123']:
            with self.subTest(target=target):
                r, chamada = self.vigiar(('--projeto', 'fabrica-simulada', '--target', target), saida=doctor_json(BATIDA))
                self.assertEqual((r.returncode, chamada), (2, None))


if __name__ == '__main__':
    unittest.main()
