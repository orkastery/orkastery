"""Ingresso nativo Hermes: callback síncrono, I/O limitado no loop do host.

D12: este host é o canal `hermes`. O canal entra no corpo assinado do envelope, não
num campo solto: Hermes e OpenClaw compartilham transporte, mas têm chaves e identidades
próprias; sem o canal dentro do HMAC o recibo perderia essa proveniência.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import subprocess
import time
from datetime import datetime, timezone

CANAL = 'hermes'
COMMAND = re.compile(r'^/ork (gate|session) ([a-zA-Z0-9][a-zA-Z0-9._-]{0,79}) ([a-zA-Z0-9][a-zA-Z0-9._-]{0,79}) ([\s\S]{1,4096})$')
NATIVE_COMMAND = re.compile(r'^/ork (offer|gate|session) ([a-zA-Z0-9][a-zA-Z0-9._-]{0,79}) ([a-zA-Z0-9][a-zA-Z0-9._-]{0,79})(?: ([\s\S]{1,4096}))?$')
# I-41 (GO-FIX 1): as duas formas da resposta ao resumo do pulse, que o dono digita sem barra e
# sem identificador: "P4EJ a" ao resumo e "1a 2c" as perguntas. As MESMAS fontes vivem no nucleo
# (GRAMATICA_DO_PULSE, core/src/pulse-resposta.ts) e um teste do nucleo confere que continuam
# iguais. O codigo comeca por letra e tem digito: conversa comum nao tem esta forma, e ele
# nunca se confunde com a resposta ao lote, que comeca pelo numero da pergunta.
PULSE_CONSENT = re.compile(r'^[ \t]*(?=[A-HJKMNP-TV-Z][2-9A-HJKMNP-TV-Z]{0,2}[2-9])[A-HJKMNP-TV-Z][2-9A-HJKMNP-TV-Z]{3}[ \t]+[^\r\n]{1,40}$', re.IGNORECASE)
PULSE_LOTE = re.compile(r'^[ \t]*[0-9]{1,2}[ \t]*[a-zA-Z](?:[ \t,;]*[0-9]{1,2}[ \t]*[a-zA-Z])*[ \t]*[.!]?[ \t]*$')
# I-50 (RM-039): a tag da cadencia do resumo, sozinha na mensagem. Comeca por '#': nunca se
# confunde com as outras duas formas, e tag no meio de uma frase continua indo para o assistente.
PULSE_CADENCIA = re.compile(r'^[ \t]*#OrkPulse(?:On(?:-(?:15|30|60)m)?|Off)[ \t]*[.!]?[ \t]*$', re.IGNORECASE)
# O endereco do pulse no corpo assinado: nem thread nem pedido. Quem traduz e o nucleo.
PULSE_ALVO, PULSE_ENDERECO = 'pulse', 'resposta'
CORE_TIMEOUT = 10
CONFIRM_TIMEOUT = 3
MAX_ENTRIES = 1024
MAX_PENDING = 16
CONFIRM_TEXT = {
    'gate': 'Orkastery: resposta ao gate registrada pelo núcleo.',
    'session': 'Orkastery: resposta entregue à sessão pelo núcleo.',
}
logger = logging.getLogger(__name__)
# Só metadados: nunca guardar resposta, chave, stdout ou exceção nestes registros.
_entries = {}
_tasks = set()


def _allowed(name, value):
    return value in {s.strip() for s in os.environ.get(name, '').split(',') if s.strip()}


def _status(entry=None, replay=False):
    effect = entry['effect'] if entry else 'unconfirmed'
    confirmation = entry['confirmation'] if entry else 'not_attempted'
    return {'action': 'skip', 'reason': f'ork.hitl: effect={effect}; confirmation={confirmation}',
            'effect': effect, 'confirmation': confirmation, 'replay': replay}


def _is_pulse(text):
    return '\x00' not in text and bool(PULSE_CONSENT.fullmatch(text) or PULSE_LOTE.fullmatch(text)
                                         or PULSE_CADENCIA.fullmatch(text))


def _receipt_ok(receipt, operation, pedido):
    if operation == 'pulse':
        # O texto que volta ao dono e montado pelo nucleo; este adaptador so o transporta.
        return (isinstance(receipt, dict) and receipt.get('ok') is True
                and receipt.get('contrato') == 'ork.pulse-resposta/v1'
                and isinstance(receipt.get('mensagem'), str) and bool(receipt['mensagem'])
                and type(receipt.get('repetida')) is bool)
    states = {'aprovado', 'recusado', 'aguardando'} if operation == 'gate' else {'entregue'}
    return (isinstance(receipt, dict) and receipt.get('ok') is True
            and receipt.get('pedidoId') == pedido and receipt.get('estado') in states
            and type(receipt.get('repetida')) is bool
            and (operation == 'gate' or isinstance(receipt.get('sessionId'), str)
                 and bool(receipt['sessionId'])))


def _call_core(argv, envelope, root, env):
    return subprocess.run(argv, input=json.dumps(envelope, ensure_ascii=False), cwd=root,
                          env=env, text=True, encoding='utf-8', capture_output=True,
                          timeout=CORE_TIMEOUT, check=False)


async def _deliver(entry, msg, operation, pedido, argv, envelope, root, env):
    try:
        # A espera no executor também tem orçamento. Cancelamento não prova rollback.
        entry['effect'] = 'unknown'
        result = await asyncio.wait_for(
            asyncio.to_thread(_call_core, argv, envelope, root, env), CORE_TIMEOUT + 1)
        receipt = json.loads(result.stdout) if result.returncode == 0 else None
        if not _receipt_ok(receipt, operation, pedido):
            return
        entry['effect'] = 'confirmed'
        if receipt['repetida']:
            # Após restart não sabemos se o canal já recebeu. Nunca reenviar às cegas.
            entry['confirmation'] = 'unknown'
            return
        entry['confirmation'] = 'unknown'
        reply = receipt['mensagem'] if operation == 'pulse' else CONFIRM_TEXT[operation]
        sent = await asyncio.wait_for(msg.reply_text(
            reply, do_quote=False, parse_mode=None,
            read_timeout=CONFIRM_TIMEOUT, write_timeout=CONFIRM_TIMEOUT,
            connect_timeout=CONFIRM_TIMEOUT, pool_timeout=CONFIRM_TIMEOUT), CONFIRM_TIMEOUT)
        from telegram import Message
        if (isinstance(sent, Message) and type(sent.message_id) is int and sent.message_id > 0
                and sent.chat.id == msg.chat.id and sent.from_user.id == msg.get_bot().id
                and sent.from_user.is_bot is True and sent.text == reply):
            entry['confirmation'] = 'sent'
    except (Exception, asyncio.CancelledError):
        # Timeout/exceção/recibo inválido: efeito pode existir; canal pode ter recebido.
        # Nunca ecoar detalhes do CLI/PTB, nem transformar incerteza em sucesso.
        pass
    finally:
        entry['done'] = True
        logger.info('ork.hitl: ref=%s effect=%s confirmation=%s',
                    entry['ref'], entry['effect'], entry['confirmation'])


def _ingress(*, event, gateway, **_kwargs):
    text = getattr(event, 'text', '')
    if not isinstance(text, str):
        return None
    pulse = not text.startswith('/ork ') and _is_pulse(text)
    if not text.startswith('/ork ') and not pulse:
        return None
    if getattr(getattr(event, 'source', None), 'platform', None) and event.source.platform.value != 'telegram':
        # O resumo do pulse sai pelo Telegram; a resposta a ele so e reconhecida la.
        return None if pulse else _native_ingress(event, gateway, _kwargs.get('session_store'))
    # invoke_hook instalado NÃO resolve coroutine. Todo caminho /ork, e a resposta ao pulse, retorna skip.
    try:
        from gateway.platforms.base import MessageEvent
        from telegram import Message
        if not isinstance(event, MessageEvent) or getattr(event, 'internal', False):
            return _status()
        msg, source = event.raw_message, event.source
        if (not isinstance(msg, Message) or source.platform.value != 'telegram'
                or gateway._is_user_authorized(source) is not True):
            return _status()
        user, chat = str(msg.from_user.id), str(msg.chat.id)
        bot = os.environ.get('ORK_HITL_TELEGRAM_BOT_ID', '')
        if (msg.from_user.is_bot is not False or not bot or str(msg.get_bot().id) != bot
                or user == bot or getattr(msg, 'forward_origin', None) or getattr(msg, 'sender_chat', None)
                or str(source.user_id) != user or str(source.chat_id) != chat
                or type(msg.message_id) is not int or msg.message_id <= 0
                or str(event.message_id) != str(msg.message_id) or msg.text != text
                or not _allowed('ORK_HITL_TELEGRAM_USERS', user)
                or not _allowed('ORK_HITL_TELEGRAM_CHATS', chat)):
            return _status()
        if pulse:
            # O dono respondeu ao resumo ou ao lote. O texto inteiro e a resposta, e o endereco
            # assinado e o do pulse: este adaptador nao conhece pedido e nao escolhe nada.
            operation, thread, pedido, answer = 'pulse', PULSE_ALVO, PULSE_ENDERECO, text
        else:
            match = COMMAND.fullmatch(text)
            if not match or '\x00' in text:
                return _status()
            operation, thread, pedido, answer = match.groups()
        now = datetime.now(timezone.utc)
        age = (now - msg.date).total_seconds()
        # FX1: este canal assina com a SUA chave. ORK_HITL_INGRESS_KEY fica so para o
        # envelope v1 legado, que este adaptador nao produz mais.
        key = os.environ.get('ORK_HITL_INGRESS_KEY_HERMES', '')
        root = os.environ.get('ORK_HITL_ROOT', '')
        if not 0 <= age <= 60 or len(key.encode()) < 32 or not os.path.isabs(root):
            return _status()
        envelope = {'resposta': answer, 'canal': CANAL, 'origem': 'telegram', 'por': f'telegram:{user}',
                    'mensagem': f'telegram:{chat}:{msg.message_id}',
                    'recebidoEm': msg.date.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}
        # FX5: `conta` tem posicao fixa no corpo v2, e e `None` neste canal: a allowlist do
        # Hermes e de usuario e chat, nao de conta. Declarar conta aqui seria recusado pelo
        # nucleo, e omitir a posicao mudaria a aridade do corpo assinado.
        body = ['ork.hitl-answer/v2', thread, pedido, CANAL, None, envelope['origem'], envelope['por'],
                envelope['mensagem'], envelope['recebidoEm'], answer]
        envelope['prova'] = hmac.new(key.encode(), json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode(), hashlib.sha256).hexdigest()
        # Cada subcomando tem a sua flag de stdin: `gate answer` exige --resposta-stdin e
        # `sessions answer` exige --stdin. Mandar a mesma flag para os dois fazia toda
        # resposta de sessao ser recusada pelo proprio CLI, antes de qualquer conferencia.
        if operation == 'pulse':
            argv = [os.environ.get('ORK_BIN', 'ork'), 'pulse', 'responder', '--resposta-stdin',
                    '--origem', 'telegram', '--canal', CANAL,
                    '--por', envelope['por'], '--mensagem', envelope['mensagem']]
        else:
            argv = [os.environ.get('ORK_BIN', 'ork'), 'gate' if operation == 'gate' else 'sessions',
                    'answer', thread, pedido,
                    '--resposta-stdin' if operation == 'gate' else '--stdin',
                    '--origem', 'telegram', '--canal', CANAL,
                    '--por', envelope['por'], '--mensagem', envelope['mensagem']]
        # Usar o loop que possui o bot HTTP; nunca asyncio.run/thread com esse bot.
        loop = asyncio.get_running_loop()
        identity = (root, bot, chat, str(msg.message_id))
        fingerprint = operation + ':' + envelope['prova']
        previous = _entries.get(identity)
        if previous:
            return _status(previous, replay=True) if hmac.compare_digest(previous['fingerprint'], fingerprint) else _status()
        for identity_old, old in list(_entries.items()):
            if old['done'] and time.monotonic() >= old['expires']:
                del _entries[identity_old]
        if len(_entries) >= MAX_ENTRIES or len(_tasks) >= MAX_PENDING:
            return _status()
        entry = {'fingerprint': fingerprint, 'effect': 'pending', 'confirmation': 'not_attempted',
                 'done': False, 'expires': time.monotonic() + 61,
                 'ref': hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:16]}
        _entries[identity] = entry  # Reserva antes de agendar, sem await no callback.
        work = _deliver(entry, msg, operation, pedido, argv, envelope, root, dict(os.environ))
        try:
            task = loop.create_task(work)
        except Exception:
            work.close()
            entry.update(effect='unconfirmed', done=True)
            return _status(entry)
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
        return _status(entry)
    except Exception:
        pass
    return _status()


def register(ctx):
    ctx.register_hook('pre_gateway_dispatch', _ingress)


async def _native_core(argv, root, envelope=None):
    # Subprocesso assíncrono limitado: não prende executor thread no shutdown.
    proc = await asyncio.create_subprocess_exec(*argv, cwd=root,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        limit=65536)
    try:
        data = None if envelope is None else json.dumps(envelope, ensure_ascii=False).encode()
        out, _ = await asyncio.wait_for(proc.communicate(data), CORE_TIMEOUT)
        if proc.returncode or len(out) > 65536:
            raise ValueError('native.core.unavailable')
        return json.loads(out)
    except BaseException:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
        raise


async def _native_deliver(entry, msg, match, binding, key, root):
    operation, thread, pedido, answer = match.groups()
    cli = os.environ.get('ORK_BIN', 'ork')
    try:
        compact = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))
        offer = dict(native=dict(binding, messageId=str(msg.id)),
                     recebidoEm=msg.created_at.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'))
        body = ['ork.hitl-native-offer/v1', thread, pedido] + [offer['native'][k] for k in
                ['host', 'installationId', 'connectionId', 'sessionId', 'accountId', 'channelId', 'conversationId', 'personId', 'messageId']] + [offer['recebidoEm']]
        offer['prova'] = hmac.new(key.encode(), compact(body).encode(), hashlib.sha256).hexdigest()
        view = await _native_core([cli, 'gate', 'context', thread, pedido, '--native-offer-stdin'], root, offer)
        p = view.get('pedido', {})
        if (p.get('id') != pedido or p.get('thread') != thread or (operation != 'offer' and p.get('alvo', {}).get('tipo') != operation)
                or not any(c.get('canal') == 'hermes' and c.get('transporte') == 'native' and c.get('estado') == 'disponivel' for c in view.get('canais', []))
                or not re.fullmatch('[a-f0-9]{64}', view.get('contexto', ''))
                or not re.fullmatch('[a-f0-9]{64}', view.get('pedidoSha256', ''))):
            return
        if operation == 'offer':
            text = view.get('apresentacao', {}).get('mensagem')
            if not isinstance(text, str):
                return
            # I-35: o prazo chega ao dono no fuso dele; nucleo de outra versao pode nao
            # ter posto o prazo local na mensagem, entao o campo local vai junto.
            prazo_local = view.get('prazoLocal')
            if isinstance(prazo_local, str) and prazo_local and prazo_local not in text:
                text += '\nPrazo (fuso do dono): ' + prazo_local
            import discord
            entry['effect'] = 'presented'
            entry['confirmation'] = 'unknown'
            text += '\nCanal nativo Hermes disponível nesta conversa.'
            sent = await asyncio.wait_for(msg.reply(text, mention_author=False,
                        allowed_mentions=discord.AllowedMentions.none()), CONFIRM_TIMEOUT)
            if isinstance(sent, discord.Message) and sent.channel.id == msg.channel.id and sent.content == text:
                entry['confirmation'] = 'sent'
            return
        n = dict(binding, messageId=str(msg.id), context=view['contexto'],
                 pedidoSha256=view['pedidoSha256'], expiresAt=p['prazo'])
        identity = [n[k] for k in ['host', 'installationId', 'connectionId', 'sessionId', 'channelId', 'accountId', 'conversationId', 'messageId']]
        envelope = dict(origem='native', canal='hermes', conta=n['accountId'], native=n,
                        por='native:hermes:' + n['personId'], mensagem='native:' + hashlib.sha256(compact(identity).encode()).hexdigest(),
                        recebidoEm=msg.created_at.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'), resposta=answer)
        body = ['ork.hitl-native/v1', thread, pedido] + [n[k] for k in ['host', 'installationId', 'connectionId', 'sessionId',
                'accountId', 'channelId', 'conversationId', 'personId', 'messageId', 'context', 'pedidoSha256', 'expiresAt']] + [envelope[k] for k in ['origem', 'canal', 'conta', 'por', 'mensagem', 'recebidoEm', 'resposta']]
        envelope['prova'] = hmac.new(key.encode(), compact(body).encode(), hashlib.sha256).hexdigest()
        entry['effect'] = 'unknown'
        receipt = await _native_core([cli, 'gate' if operation == 'gate' else 'sessions', 'answer', thread, pedido,
                    '--resposta-stdin' if operation == 'gate' else '--stdin', '--origem', 'native', '--canal', 'hermes',
                    '--conta', n['accountId'], '--por', envelope['por'], '--mensagem', envelope['mensagem']], root, envelope)
        if not _receipt_ok(receipt, operation, pedido):
            return
        entry['effect'] = 'confirmed'
        if receipt['repetida']:
            entry['confirmation'] = 'unknown'
            return
        entry['confirmation'] = 'unknown'
        import discord
        sent = await asyncio.wait_for(msg.reply(CONFIRM_TEXT[operation], mention_author=False,
                    allowed_mentions=discord.AllowedMentions.none()), CONFIRM_TIMEOUT)
        if isinstance(sent, discord.Message) and sent.channel.id == msg.channel.id and sent.content == CONFIRM_TEXT[operation]:
            entry['confirmation'] = 'sent'
    except (Exception, asyncio.CancelledError):
        pass
    finally:
        entry['done'] = True
        logger.info('ork.hitl.native: ref=%s effect=%s confirmation=%s', entry['ref'], entry['effect'], entry['confirmation'])


def _native_ingress(event, gateway, session_store):
    """Callback Discord do gateway instalado; terminal/ACP sem atestado fica indisponível."""
    try:
        from gateway.platforms.base import MessageEvent
        import discord
        if not isinstance(event, MessageEvent) or getattr(event, 'internal', False):
            return _status()
        msg, source = event.raw_message, event.source
        binding = json.loads(os.environ.get('ORK_HITL_NATIVE_BINDING_HERMES', 'null'))
        key, root = os.environ.get('ORK_HITL_NATIVE_KEY_HERMES', ''), os.environ.get('ORK_HITL_ROOT', '')
        fields = {'host', 'installationId', 'connectionId', 'sessionId', 'accountId', 'channelId', 'conversationId', 'personId'}
        if (not isinstance(binding, dict) or set(binding) != fields or any(not isinstance(v, str) or not v for v in binding.values())
                or binding['host'] != 'hermes' or binding['channelId'] != 'discord' or source.platform.value != 'discord'
                or not isinstance(msg, discord.Message) or source.is_bot is not False or msg.author.bot is not False
                or msg.webhook_id is not None or msg.application_id is not None
                or gateway._is_user_authorized(source) is not True or len(key.encode()) < 32 or not os.path.isabs(root)
                or str(msg.author.id) != source.user_id or source.user_id != binding['personId']
                or str(msg.channel.id) != source.chat_id or source.chat_id != binding['conversationId']
                or str(getattr(msg.guild, 'id', '')) != binding['accountId']
                or str(event.message_id) != str(msg.id) or msg.content != event.text):
            return _status()
        age = (datetime.now(timezone.utc) - msg.created_at).total_seconds()
        if not 0 <= age <= 60:
            return _status()
        # API observada no SessionStore instalado; não cria nem reseta sessão por consulta.
        entries = [s for s in session_store.list_sessions() if s.session_id == binding['sessionId']
                   and s.session_key == session_store._generate_session_key(source) and not s.suspended]
        if len(entries) != 1:
            return _status()
        match = NATIVE_COMMAND.fullmatch(event.text)
        if not match or '\x00' in event.text or (match[1] == 'offer' and match[4] is not None) or (match[1] != 'offer' and not match[4]):
            return _status()
        identity = (root, binding['connectionId'], binding['sessionId'], source.chat_id, str(msg.id))
        if identity in _entries:
            return _status(_entries[identity], replay=True)
        for old_id, old in list(_entries.items()):
            if old['done'] and time.monotonic() >= old['expires']:
                del _entries[old_id]
        if len(_entries) >= MAX_ENTRIES or len(_tasks) >= MAX_PENDING:
            return _status()
        entry = dict(effect='pending', confirmation='not_attempted', done=False, expires=time.monotonic() + 61,
                     ref=hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:16])
        _entries[identity] = entry
        task = asyncio.get_running_loop().create_task(_native_deliver(entry, msg, match, binding, key, root))
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
        return _status(entry)
    except Exception:
        return _status()
