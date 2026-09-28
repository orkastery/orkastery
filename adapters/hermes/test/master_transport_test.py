"""O teclado produz mensagem humana e o transporte exige recibo do Telegram."""
import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

arquivo = Path(__file__).resolve().parents[1] / 'bin' / 'ork-master-enviar.py'
spec = importlib.util.spec_from_file_location('master_transporte', arquivo)
transporte = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transporte)


class BotFalso:
    def __init__(self, recibo=42, falha=None):
        self.recibo, self.falha, self.chamadas = recibo, falha, []

    async def send_message(self, **kwargs):
        self.chamadas.append(kwargs)
        if self.falha:
            raise self.falha
        return SimpleNamespace(message_id=self.recibo)


class TransporteMasterTest(unittest.TestCase):
    def payload(self):
        return {'contrato': 'ork.master-digest-page/v1',
                'texto': 'ork-exemplo: score proposto 4/5. Justificativa: testes passaram.',
                'opcoes': [f'Ratificar ork-exemplo / classe-{n} / abcdef12' for n in range(9)]}

    def test_nove_escolhas_viram_texto_humano_sem_executar(self):
        bot = BotFalso()
        recibo = asyncio.run(transporte.entregar(self.payload(), 'telegram:123:9', bot))
        self.assertEqual(recibo['message_id'], 42)
        chamada = bot.chamadas[0]
        self.assertEqual(chamada['chat_id'], '123')
        self.assertEqual(chamada['message_thread_id'], 9)
        self.assertEqual([linha[0]['text'] for linha in chamada['reply_markup']['keyboard']], self.payload()['opcoes'])
        self.assertNotIn('parse_mode', chamada)

    def test_falha_e_recibo_ausente_nao_parecem_entrega(self):
        for bot in [BotFalso(recibo=None), BotFalso(falha=RuntimeError('falha'))]:
            with self.assertRaises((ValueError, RuntimeError)):
                asyncio.run(transporte.entregar(self.payload(), 'telegram:123', bot))

    def test_destino_payload_e_limite_recusados_antes_de_enviar(self):
        casos = [(self.payload(), 'telegram:@alguem'), ({}, 'telegram:123'),
                 ({**self.payload(), 'texto': '😀' * 2000}, 'telegram:123'),
                 ({**self.payload(), 'opcoes': [42]}, 'telegram:123')]
        for payload, target in casos:
            bot = BotFalso()
            with self.assertRaises(ValueError):
                asyncio.run(transporte.entregar(payload, target, bot))
            self.assertEqual(bot.chamadas, [])


if __name__ == '__main__':
    unittest.main()
