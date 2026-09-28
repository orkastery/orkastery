#!/usr/bin/env python3
"""Responde HITL a partir de um update Telegram entregue pelo gateway autenticado."""
import argparse
import json
import os
import re
import subprocess
import sys


def lista_permitida(nome):
    return {v.strip() for v in os.environ.get(nome, '').split(',') if v.strip()}


def argumentos(update, operacao, thread, pedido):
    if operacao not in ('ork_gate_answer', 'ork_session_answer'):
        raise ValueError('comando HITL inválido')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}', thread):
        raise ValueError('thread inválida')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}', pedido):
        raise ValueError('pedido inválido')
    callback = update.get('callback_query')
    mensagem = callback.get('message', {}) if callback else update.get('message', {})
    remetente = callback.get('from', {}) if callback else mensagem.get('from', {})
    usuario = str(remetente.get('id', ''))
    chat = str(mensagem.get('chat', {}).get('id', ''))
    if (not usuario or not chat or remetente.get('is_bot') is not False
            or usuario not in lista_permitida('ORK_HITL_TELEGRAM_USERS')
            or chat not in lista_permitida('ORK_HITL_TELEGRAM_CHATS')
            or mensagem.get('forward_origin')):
        raise ValueError('origem humana não autorizada pelo gateway')
    marker = f'ork-hitl {thread} {pedido}'
    if callback:
        prefixo = f'ork:{thread}:{pedido}:'
        dado = callback.get('data', '')
        if not isinstance(dado, str) or not dado.startswith(prefixo):
            raise ValueError('callback não corresponde ao pedido')
        resposta = dado[len(prefixo):]
        if not re.fullmatch(r'[1-9][0-9]?', resposta):
            raise ValueError('opção de callback inválida')
        referencia = callback.get('id')
    else:
        origem = mensagem.get('reply_to_message', {}).get('text', '')
        if marker not in origem.splitlines():
            raise ValueError('responda à mensagem do pedido HITL')
        resposta = mensagem.get('text', '')
        referencia = mensagem.get('message_id')
    if (not isinstance(resposta, str) or not resposta.strip() or len(resposta) > 4096
            or '\x00' in resposta or not referencia):
        raise ValueError('resposta ou referência de mensagem inválida')
    return ['gate' if operacao == 'ork_gate_answer' else 'sessions', 'answer', thread, pedido,
            '--resposta-stdin', '--por', f'telegram:{usuario}',
            '--mensagem', f'telegram:{chat}:{referencia}', '--origem', 'telegram'], resposta


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('comando', choices=['ork_gate_answer', 'ork_session_answer'])
    parser.add_argument('thread')
    parser.add_argument('pedido')
    args = parser.parse_args()
    try:
        # O gateway fornece o update original por stdin, nunca uma descrição criada por LLM.
        bruto = sys.stdin.read(65537)
        if len(bruto) > 65536:
            raise ValueError('update excede limite')
        argv, resposta = argumentos(json.loads(bruto), args.comando, args.thread, args.pedido)
        result = subprocess.run([os.environ.get('ORK_BIN', 'ork'), *argv],
                                input=resposta, text=True, capture_output=True, timeout=55, check=False)
        # O núcleo devolve um recibo sem repetir a resposta nem credenciais.
        if result.returncode != 0:
            print(json.dumps({'ok': False, 'erro': 'núcleo recusou a resposta', 'codigo': result.returncode}))
            return 1
        print(result.stdout.strip())
        return 0
    except (ValueError, TypeError, AttributeError, OSError, subprocess.TimeoutExpired):
        print(json.dumps({'ok': False, 'erro': 'resposta HITL não confirmada'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
