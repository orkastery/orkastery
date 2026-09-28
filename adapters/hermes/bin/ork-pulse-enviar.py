#!/usr/bin/env python3
"""Transporte de texto do pulse pela API de mensagem do Hermes, sem inferência."""
import argparse
import json
import os
from pathlib import Path
import re
import sys


def texto_seguro(message):
    message = re.sub(r'(?i)MEDIA\s*:', 'MEDIA [texto]:', message)
    return re.sub(r'(?i)\[\[(?:audio_as_voice|as_document)\]\]', '[diretiva em texto]', message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, help='Destino explícito: telegram:chat_id[:topic_id]')
    parser.add_argument('--message', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'telegram:-?\d+(?::\d+)?', args.target):
        parser.error('use identificador explícito do chat Telegram autorizado')
    home = Path(os.environ.get('HERMES_HOME', Path.home() / '.hermes'))
    agent = Path(os.environ.get('HERMES_AGENT_DIR', home / 'hermes-agent'))
    sys.path.insert(0, str(agent))
    try:
        from dotenv import load_dotenv
        load_dotenv(home / '.env', override=False)
        from tools.send_message_tool import send_message_tool
        # Conteúdo do runtime é texto. Não pode pedir ao host que anexe arquivo local.
        message = texto_seguro(args.message)
        result = send_message_tool({'action': 'send', 'target': args.target, 'message': message})
        data = json.loads(result) if isinstance(result, str) else result
        if (not isinstance(data, dict) or data.get('success') is not True or data.get('skipped')
                or not (data.get('message_id') or data.get('message_ids'))):
            print(json.dumps({'success': False, 'erro': 'Hermes não confirmou a entrega'}))
            return 1
        print(json.dumps({k: data[k] for k in ['success', 'message_id', 'message_ids', 'platform'] if k in data}))
        return 0
    except Exception as exc:
        # Não imprimir configuração, credencial ou resposta bruta de uma API.
        print(json.dumps({'success': False, 'erro': type(exc).__name__}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
