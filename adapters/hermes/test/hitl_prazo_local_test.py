"""I-35: a oferta nativa do Hermes mostra o prazo no fuso do dono. Núcleo e Discord SIMULADOS.

A mensagem vem do núcleo real (core/dist, com o dono em America/Sao_Paulo), então o teste prova
o que o adapter exibe, não uma string montada à mão. Rodar depois de `npm --prefix core run build`.
"""
from datetime import datetime, timezone
import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import AsyncMock, patch
from layout import plugin_directory

spec = importlib.util.spec_from_file_location('prazo_local_fixture', plugin_directory() / '__init__.py')
ingress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingress)

CORE = Path(__file__).resolve().parents[3] / 'core' / 'dist'
ISO = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}')
PRAZO = '2030-01-01T02:30:00.000Z'


def apresentacao_do_nucleo():
    """Mensagem e prazoLocal produzidos pelas funções reais do núcleo, sob TZ=UTC."""
    script = f'''
const h = require({json.dumps(str(CORE / 'horario.js'))});
const a = require({json.dumps(str(CORE / 'hitl-presentation.js'))});
h.definirFusoDoDono('America/Sao_Paulo');
const pedido = {{ contrato: 'ork.hitl/v1', id: 'pedido-1', thread: 'ork-fixture', fase: 'GOAL', modo: 'ork',
  alvo: {{ tipo: 'gate', sobre: 'premissas' }}, motivo: 'human.pending', pergunta: 'Aprovar fixture SIMULADA?',
  opcoes: [{{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }}, {{ numero: 2, texto: 'Esperar', acao: 'esperar' }}],
  recomendacao: 'Somente fixture', criadoEm: '2030-01-01T01:30:00.000Z', prazo: {json.dumps(PRAZO)},
  acaoPadraoAoExpirar: 'esperar', respostaAceita: {{ tipo: 'opcao', maxCaracteres: 100 }}, profundidade: 'detalhada' }};
process.stdout.write(JSON.stringify({{ mensagem: a.apresentarDecisao(pedido, '2030-01-01T01:30:00.000Z').mensagem,
  prazoLocal: a.prazoLocalDoPedido(pedido, '2030-01-01T01:30:00.000Z') }}));
'''
    # O runner hospedado instala o node fora de /usr/bin (hostedtoolcache), entao cravar PATH
    # perdia o binario. Resolve onde ele esta e mantem o ambiente minimo, com TZ fixo.
    node = shutil.which('node') or '/usr/bin/node'
    r = subprocess.run([node, '-e', script], capture_output=True, text=True,
                       env={'PATH': f'{Path(node).parent}:/usr/bin:/bin', 'TZ': 'UTC'}, check=True)
    return json.loads(r.stdout)


class PrazoLocalTest(unittest.IsolatedAsyncioTestCase):
    async def oferta(self, mensagem, prazo_local):
        discord = ModuleType('discord')
        discord.Message = SimpleNamespace
        discord.AllowedMentions = SimpleNamespace(none=lambda: None)
        view = dict(pedido=dict(id='pedido-1', thread='ork-fixture', alvo=dict(tipo='gate'), prazo=PRAZO),
                    contexto='a' * 64, pedidoSha256='b' * 64, apresentacao=dict(mensagem=mensagem), prazoLocal=prazo_local,
                    canais=[dict(canal='hermes', transporte='native', estado='disponivel')])
        msg = SimpleNamespace(id=1, channel=SimpleNamespace(id=42), created_at=datetime.now(timezone.utc))
        msg.reply = AsyncMock(side_effect=lambda text, **_: SimpleNamespace(channel=msg.channel, content=text))
        binding = dict(host='hermes', installationId='fixture', connectionId='connection', sessionId='session',
                       accountId='7', channelId='discord', conversationId='42', personId='24')
        entry = dict(ref='fixture', effect='pending', confirmation='unknown')
        match = ingress.NATIVE_COMMAND.fullmatch('/ork offer ork-fixture pedido-1')
        with patch.dict('sys.modules', {'discord': discord}), patch.object(ingress, '_native_core', AsyncMock(return_value=view)):
            await ingress._native_deliver(entry, msg, match, binding, 'fixture-key-' * 4, '/tmp')
        self.assertEqual(entry.get('effect'), 'presented')
        return msg.reply.await_args.args[0]

    async def test_nucleo_atual_mostra_prazo_local_uma_vez(self):
        nucleo = apresentacao_do_nucleo()
        self.assertEqual(nucleo['prazoLocal'], '31/12 23:30 (horário de Brasília)')
        texto = await self.oferta(nucleo['mensagem'], nucleo['prazoLocal'])
        self.assertIn('• Prazo: 31/12 23:30 (horário de Brasília), em 1h00.', texto)
        self.assertEqual(texto.count(nucleo['prazoLocal']), 1)
        self.assertIsNone(ISO.search(texto))
        self.assertTrue(texto.endswith('Canal nativo Hermes disponível nesta conversa.'))

    async def test_nucleo_de_outra_versao_recebe_o_prazo_local_do_campo(self):
        texto = await self.oferta('Decisão pendente\n• Prazo: 2030-01-01T02:30:00.000Z.', '31/12/2029 23:30 (horário de Brasília)')
        self.assertIn('\nPrazo (fuso do dono): 31/12/2029 23:30 (horário de Brasília)\n', texto)


if __name__ == '__main__':
    unittest.main()
