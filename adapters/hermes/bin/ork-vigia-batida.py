#!/usr/bin/env python3
"""Batida do host Hermes (RM-063, fatia 3, H1): a segunda linha da fábrica, sem inferência.

Roda a cada 30 min pelo cron ou pelo timer do systemd, nunca como cron LLM com deliver=origin. Lê o
`ork doctor --json` (contrato ork.doctor/v1) e decide uma coisa só: batida atrasada leva ao dono o aviso
pronto do núcleo; `ork` ausente, com falha ou fora do contrato leva um alerta curto; o resto não leva nada.
Sem --target, imprime a mensagem (ou nada) e sai 0. Com --target, envia pela API de mensagem do Hermes,
como o bin/ork-pulse-enviar.py: sai 0 com a entrega confirmada (ou nada a enviar) e 1 quando ela falha.
"""
import argparse
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys

# RM-052: o nome de um projeto registrado, a mesma forma das tools; nunca caminho nem opção.
PROJETO = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}')
# Erro tipado do núcleo (`projeto.desconhecido`): vocabulário fechado, seguro de citar; a saída livre não é.
ERRO_TIPADO = re.compile(r'[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+', re.IGNORECASE)
PRAZO = 120


def texto_seguro(message):
    message = re.sub(r'(?i)MEDIA\s*:', 'MEDIA [texto]:', message)
    return re.sub(r'(?i)\[\[(?:audio_as_voice|as_document)\]\]', '[diretiva em texto]', message)


def limpo(texto, teto):
    return re.sub(r'[\x00-\x1f\x7f]+', ' ', str(texto)).strip()[:teto]


def doctor(projeto):
    """O stdout do `ork doctor --json`, que traz o JSON mesmo com saída 1 (veredito bloqueado), e a falha."""
    # O doctor só lê: não recebe as chaves privadas do ingresso HITL que vivem no ambiente do gateway.
    env = {k: v for k, v in os.environ.items() if not k.startswith('ORK_HITL_')}
    env.update(ORK_CANAL='hermes', ORK_PROJETO_EXPLICITO='1')
    ork = (os.environ.get('ORK_BIN') or '').strip() or 'ork'
    try:
        # stderr capturado e descartado: a linha "Projeto consultado" do núcleo não é recado para o dono.
        r = subprocess.run([ork, '--projeto', projeto, 'doctor', '--json'], env=env, stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, encoding='utf-8', errors='replace',
                           timeout=PRAZO, check=False)
    except FileNotFoundError:
        return '', f'ork nao encontrado em {ork}'
    except subprocess.TimeoutExpired:
        return '', f'sem resposta em {PRAZO} s'
    except OSError as exc:
        return '', type(exc).__name__
    return r.stdout, (f'saiu com codigo {r.returncode}' if r.returncode else '')


def mensagem(projeto):
    """O texto do dono, ou None quando não há o que avisar."""
    if not projeto:
        return ('Orkastery: a batida do Hermes nao sabe qual fabrica conferir: falta --projeto <nome> '
                '(ou ORK_PROJETO) no agendamento.')
    if not PROJETO.fullmatch(projeto):
        return (f'Orkastery: a batida do Hermes recebeu um projeto invalido ({limpo(projeto, 80)}): '
                'use o nome de `ork projetos` em --projeto.')
    saida, falha = doctor(projeto)
    try:
        valor = json.loads(saida)
    except Exception:
        valor = None
    if isinstance(valor, dict) and valor.get('contrato') == 'ork.doctor/v1':
        batida = valor.get('batida')
        if not isinstance(batida, dict) or batida.get('atrasada') is not True:
            return None
        aviso = batida.get('aviso')
        if isinstance(aviso, str) and aviso.strip():
            return aviso.strip()
        return f'Orkastery: a fabrica {projeto} esta sem batida. Confira com: ork fabrica batida status'
    erro = valor.get('erro') if isinstance(valor, dict) else None
    tipado = erro if isinstance(erro, str) and ERRO_TIPADO.fullmatch(erro) else ''
    detalhe = limpo(': '.join(p for p in (falha, tipado) if p) or 'resposta fora do contrato ork.doctor/v1', 160)
    maquina = limpo((os.environ.get('ORK_MAQUINA') or '').strip() or socket.gethostname(), 64)
    return (f'Orkastery: o ork doctor nao respondeu na maquina {maquina} ({detalhe}): '
            f'a batida da fabrica {projeto} nao pode ser conferida.')


def enviar(target, texto):
    """A mesma entrega do bin/ork-pulse-enviar.py: sucesso só com success true e o id da mensagem."""
    home = Path(os.environ.get('HERMES_HOME', Path.home() / '.hermes'))
    agent = Path(os.environ.get('HERMES_AGENT_DIR', home / 'hermes-agent'))
    sys.path.insert(0, str(agent))
    try:
        # O .env do Hermes entra depois do doctor: as credenciais do canal nunca chegam ao `ork`.
        from dotenv import load_dotenv
        load_dotenv(home / '.env', override=False)
        from tools.send_message_tool import send_message_tool
        # Conteúdo do runtime é texto. Não pode pedir ao host que anexe arquivo local.
        result = send_message_tool({'action': 'send', 'target': target, 'message': texto_seguro(texto)})
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


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--projeto', default=os.environ.get('ORK_PROJETO', ''),
                        help='Nome do projeto em `ork projetos` (ou ORK_PROJETO)')
    parser.add_argument('--target', help='Destino explícito: telegram:chat_id[:topic_id]; sem ele, só imprime')
    args = parser.parse_args()
    if args.target is not None and not re.fullmatch(r'telegram:-?\d+(?::\d+)?', args.target):
        parser.error('use identificador explícito do chat Telegram autorizado')
    texto = mensagem(args.projeto.strip())
    if texto is None:
        return 0
    if args.target is None:
        print(texto)
        return 0
    return enviar(args.target, texto)


if __name__ == '__main__':
    sys.exit(main())
