#!/usr/bin/env python3
"""Entrega uma página de digest com escolhas que chegam ao Hermes como texto humano."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import re
import sys


def validar(payload, target):
    if not re.fullmatch(r'telegram:-?\d+(?::\d+)?', target):
        raise ValueError('destino Telegram explícito obrigatório')
    if not isinstance(payload, dict) or payload.get('contrato') != 'ork.master-digest-page/v1':
        raise ValueError('contrato de página inválido')
    texto = payload.get('texto')
    if not isinstance(texto, str) or not texto.strip() or len(texto.encode('utf-16-le')) // 2 > 3900:
        raise ValueError('texto ausente ou maior que uma página')
    opcoes = payload.get('opcoes')
    if not isinstance(opcoes, list) or len(opcoes) > 12:
        raise ValueError('opções inválidas')
    if any(not isinstance(opcao, str) or not opcao.strip() or len(opcao) > 200 for opcao in opcoes):
        raise ValueError('opção inválida')
    partes = target.split(':')
    return partes[1], int(partes[2]) if len(partes) == 3 else None


async def entregar(payload, target, bot):
    chat, topico = validar(payload, target)
    # Teclado de texto usa o fluxo humano já autenticado pelo gateway do Hermes.
    # Não depende de um callback desconhecido nem executa comando ao enviar o digest.
    argumentos = {'chat_id': chat, 'text': payload['texto']}
    if topico is not None:
        argumentos['message_thread_id'] = topico
    if payload['opcoes']:
        argumentos['reply_markup'] = {
            'keyboard': [[{'text': opcao}] for opcao in payload['opcoes']],
            'resize_keyboard': True,
            'one_time_keyboard': True,
            'input_field_placeholder': 'Escolha a classe para ratificar a proposta',
        }
    resposta = await bot.send_message(**argumentos)
    recibo = getattr(resposta, 'message_id', None)
    if not isinstance(recibo, int) or recibo <= 0:
        raise ValueError('Telegram não confirmou a mensagem')
    return {'success': True, 'message_id': recibo, 'platform': 'telegram'}


async def enviar_pelo_hermes(payload, target):
    validar(payload, target)
    home = Path(os.environ.get('HERMES_HOME', Path.home() / '.hermes'))
    agent = Path(os.environ.get('HERMES_AGENT_DIR', home / 'hermes-agent'))
    sys.path.insert(0, str(agent))
    from dotenv import load_dotenv
    load_dotenv(home / '.env', override=False)
    from gateway.config import load_gateway_config, Platform
    from telegram import Bot
    config = load_gateway_config().platforms.get(Platform.TELEGRAM)
    if not config or not config.enabled or not config.token:
        raise ValueError('Telegram não configurado no Hermes')
    async with Bot(token=config.token) as bot:
        return await entregar(payload, target, bot)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    try:
        bruto = sys.stdin.read(65537)
        if len(bruto.encode('utf-8')) > 65536:
            raise ValueError('payload excede o limite')
        recibo = asyncio.run(enviar_pelo_hermes(json.loads(bruto), args.target))
        print(json.dumps(recibo))
        return 0
    except Exception as exc:
        # Configuração, credenciais e resposta bruta nunca entram no erro de transporte.
        print(json.dumps({'success': False, 'erro': type(exc).__name__}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
