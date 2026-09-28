"""Transporte de fabrica: OrkMind instalado, stdin JSON, sem provider ou embedder."""
from __future__ import annotations
import asyncio
import contextlib
import hashlib
import io
import json
import logging
import os
import sys


class LegacyProvenanceCollision(ValueError):
    """Mesmo conteudo sem identidade comprovada: preservar e exigir tratamento."""


class ProspectiveMarkerInvalid(ValueError):
    """Integridade do marcador recusada; nao e falha de transporte."""


class NativeSchemaMismatch(ValueError):
    """Biblioteca instalada divergiu do contrato compartilhado; atualizacao exige revisao."""


def native_schema_fields():
    from pathlib import Path
    from orkmind.core.models import MemoryEntry
    contract = json.loads(Path(__file__).with_name('orkmind-native-schema.json').read_text())
    fields = contract.get('fields', [])
    if (contract.get('schema') != 'ork.native-entry-fields/v1'
            or len(fields) != len(set(fields)) or set(fields) != set(MemoryEntry.model_fields)):
        raise NativeSchemaMismatch('memory.native.schema-mismatch')
    return set(fields)


def prospective_agent_valid(value):
    import re
    return (isinstance(value, str) and re.fullmatch('[a-z0-9.-]+:[a-z0-9.-]+', value) is not None
            and 'human' not in value.lower())


class QueryError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def error_code(error):
    return (error.code if isinstance(error, QueryError)
            else 'memory.native.schema-mismatch' if isinstance(error, NativeSchemaMismatch)
            else 'memory.prospective.marker-invalid' if isinstance(error, ProspectiveMarkerInvalid)
            else 'memory.legacy.provenance-collision' if isinstance(error, LegacyProvenanceCollision)
            else 'memory.schema.absent' if type(error).__name__ == 'UndefinedTable' else 'memory.bridge.failed')


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


PHASES = {'GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'}
FACTORY_KEYS = {'orkastery_identity', 'orkastery_identity_version'}


def prospective_compatible(old, entry):
    """Recibo in-band integral preservado por duplicate sem update; nao autentica o passado."""
    import re
    fields = native_schema_fields()
    try:
        p = old.metadata['orkastery_prospective']
        if (p['schema'] != 'ork.prospective-origin/v1' or p['historicalOrigin'] != 'unknown'
                or p['source'] != 'agent' or p['entryId'] != old.id
                or not re.fullmatch('[a-f0-9]{64}', p['receiptSha256'])
                or not re.fullmatch('[a-f0-9]{40}', p['revision'])
                or not prospective_agent_valid(p['agent'])
                or hashlib.sha256(p['originalJson'].encode()).hexdigest() != p['originalSha256']):
            return False
        original = json.loads(p['originalJson'])
        if set(original) != fields:
            return False
        tags = {k: sorted(set(original['tags'].get(k, [])) | set(entry.tags.get(k, [])))
                for k in set(original['tags']) | set(entry.tags)}
        return (old.collection == entry.collection == 'rule' and old.source == entry.source == 'agent'
                and old.priority == entry.priority == 'high' and old.mandatory is False and old.protected is False
                and old.visibility == original['visibility'] == 'private' and original['id'] == old.id
                and original['content'] == old.content == entry.content and original['source'] == 'agent'
                and original['priority'] == 'high' and original['mandatory'] is False
                and original['protected'] is False and old.author_id == original['author_id']
                and old.scope == original['scope'] == entry.scope and old.tags == tags
                and old.metadata == {**entry.metadata, 'orkastery_prospective': p})
    except (KeyError, TypeError, ValueError):
        return False


def fixed_tags(tags):
    """Fase e runtime sao observacoes; tenant e demais classificacoes sao identidade."""
    fixed = {}
    for key, values in tags.items():
        if key == 'agent':
            continue
        keep = [v for v in values if not (key == 'skill' and v in PHASES)
                and not (key == 'situation' and v.startswith('fase:') and v[5:] in PHASES)]
        if keep:
            fixed[key] = sorted(set(keep))
    return fixed


def legacy_factory_identity(entry):
    """Reconhece somente fingerprints comprovaveis da ponte T5, sem adotar legado."""
    if 'orkastery_identity_version' in entry.metadata:
        return False
    original = {'collection': entry.collection, 'content': entry.content, 'tags': entry.tags,
                'priority': entry.priority,
                'metadata': {k: v for k, v in entry.metadata.items() if k not in FACTORY_KEYS}}
    for source in (False, True):
        for mandatory in (False, True):
            candidate = dict(original)
            if source:
                candidate['source'] = entry.source
            if mandatory:
                candidate['mandatory'] = False
            if hashlib.sha256(encoded(candidate).encode()).hexdigest() == entry.metadata.get('orkastery_identity'):
                return True
    return False


def governance(entry):
    if 'scope' in entry and entry['scope'] != 'project':
        raise ValueError('scope outside project contract')
    if entry.get('mandatory') or entry.get('source', 'agent') not in ('agent', 'human'):
        raise ValueError('governance')
    if entry['collection'] not in ('decision', 'handoff', 'rule', 'learning', 'roadmap'):
        raise ValueError('collection')
    if entry.get('priority') == 'critical' and entry['collection'] in ('rule', 'instruction'):
        raise ValueError('critical')
    if entry.get('source') == 'human':
        p = entry.get('metadata', {}).get('proveniencia', {})
        if (entry['collection'] != 'decision' or entry.get('priority') == 'critical'
                or p.get('tipo') != 'human_gate' or p.get('source') != 'human'
                or p.get('confirmado') is not True
                or not all(isinstance(p.get(k), str) and p[k] for k in ('autor', 'evento', 'evidencia', 'sha256'))):
            raise ValueError('human provenance')


async def readback(store, p, handoff):
    package = await store.retrieve(handoff.metadata['package_entry_id'])
    session = await store.retrieve(handoff.parent_id)
    if not package or not session:
        raise ValueError('incomplete chain')
    if (session.collection != 'session' or package.collection != 'semantic_log'
            or package.parent_id != session.id or handoff.parent_id != session.id
            or session.metadata['session_id'] != p['sessionId']
            or handoff.metadata['package_id'] != package.metadata['package_id']
            or handoff.metadata['origin'] != p['origem']
            or handoff.metadata['destination'] != p['destino']
            or json.loads(package.content) != p['payload']):
        raise ValueError('readback mismatch')
    if not all(set(values) <= set(session.tags.get(k, [])) for k, values in p['tags'].items()):
        raise ValueError('session tags mismatch')
    for entry in (handoff, package):
        if entry.metadata['orkastery_identity'] != p['identidade']:
            raise ValueError('identity mismatch')
        if not all(set(values) <= set(entry.tags.get(k, [])) for k, values in p['tags'].items()):
            raise ValueError('tags mismatch')
        if not all(entry.metadata.get(k) == v for k, v in p['metadata'].items()):
            raise ValueError('metadata mismatch')
    return {'ok': True, 'id': handoff.id, 'collection': 'handoff', 'readback': True,
            'session_entry_id': session.id, 'package_entry_id': package.id,
            'package_id': package.metadata['package_id'], 'detalhe': 'G3 e readback confirmados'}


def query_contract(request):
    """Somente fronteiras de leitura. Nao cria requester, ACL ou filtro extra."""
    import re
    def text(value, maximum):
        return (isinstance(value, str) and 0 < len(value) <= maximum
                and re.search(r'[\x00-\x1f\x7f]', value) is None)
    valid = isinstance(request, dict) and set(request) == {'op', 'collection', 'tags', 'limit'}
    tags = request.get('tags') if valid else None
    limit = request.get('limit') if valid else None
    if (not valid or request['op'] != 'query'
            or request['collection'] not in ('decision', 'handoff', 'rule', 'learning', 'roadmap')
            or type(limit) is not int or not 1 <= limit <= 1000
            or not isinstance(tags, dict) or set(tags) != {'project', 'situation'}
            or any(not isinstance(v, list) or len(v) != 1 for v in tags.values())
            or not text(tags['project'][0], 128) or not text(tags['situation'][0], 135)
            or re.fullmatch(r'thread:[a-z0-9][a-z0-9_-]{0,127}', tags['situation'][0]) is None):
        raise QueryError('memory.query.invalid')
    return {k: list(v) for k, v in tags.items()}, request['collection'], limit


async def execute(request, store):
    from orkmind.core.models import MemoryEntry
    from orkmind.core.semantic_layer import SemanticLayer
    from orkmind.guardrails.handoff import submeter_handoff
    layer = SemanticLayer(store, embedder=None, semantic_enabled=False)
    op = request['op']
    if op == 'stats':
        return {c: await store.count(c) for c in await store.list_collections()}
    if op == 'query':
        tags, collection, limit = query_contract(request)
        # GovernedStore conserva validade, anti-injection e visibilidade existentes.
        # O transporte desta ponte usa exclusivamente pgvector; nenhum acesso inner.
        entries = await store.search_by_tags(tags, collection=collection, limit=limit)
        if len(entries) >= limit:
            raise QueryError('memory.query.window-saturated')
        if any(e.collection != collection or any(
                not set(values) <= set(e.tags.get(k, [])) for k, values in tags.items())
                for e in entries):
            raise QueryError('memory.query.scope-violation')
        return [e.model_dump(mode='json') for e in entries]
    if op == 'export':
        collection = request['collection']
        count = await store.count(collection)
        entries = await store.search_by_tags({}, collection=collection, limit=count + 1)
        return [e.model_dump(mode='json') for e in entries]
    if op == 'get':
        entry = await store.retrieve(request['id'])
        if entry and entry.collection != request['collection']:
            raise ValueError('collection mismatch')
        return entry.model_dump(mode='json') if entry else None
    if op == 'add':
        data = request['entrada']
        governance(data)
        if set(data['metadata']) & (FACTORY_KEYS | {'orkastery_prospective'}):
            raise ValueError('reserved factory metadata')
        evolving = data['collection'] == 'decision' and data.get('source', 'agent') == 'agent'
        identity_data = data
        if evolving:
            if len(data['tags'].get('project', [])) != 1 or not data['tags']['project'][0]:
                raise ValueError('decision tenant')
            identity_data = {k: data[k] for k in ('collection', 'content', 'priority', 'metadata')}
            identity_data.update(source='agent', tags=fixed_tags(data['tags']))
        identity = hashlib.sha256(encoded(identity_data).encode()).hexdigest()
        metadata = {**data['metadata'], 'orkastery_identity': identity}
        if evolving:
            metadata['orkastery_identity_version'] = 2
        entry = MemoryEntry(content=data['content'], collection=data['collection'], tags=data['tags'],
                            priority=data['priority'], source=data.get('source', 'agent'),
                            scope='project', mandatory=False, visibility='public',
                            metadata=metadata)
        # A native content collision is accepted only when provenance and source agree.
        from orkmind.core.injection import compute_content_hash
        old = await store.find_by_content_hash(compute_content_hash(entry.content), entry.collection)
        if old:
            if 'orkastery_prospective' in old.metadata:
                if not prospective_compatible(old, entry):
                    raise ProspectiveMarkerInvalid('prospective receipt mismatch')
                return {'ok': True, 'id': old.id, 'duplicada': True, 'collection': old.collection,
                        'detalhe': 'duplicate; historical-origin-unknown'}
            if not old.metadata.get('orkastery_identity'):
                raise LegacyProvenanceCollision('unproven legacy identity')
            if (old.content != entry.content or old.source != entry.source or old.priority != entry.priority
                    or old.mandatory or old.scope != entry.scope or old.visibility != entry.visibility):
                raise ValueError('existing identity mismatch')
            if evolving:
                provenance = {k: v for k, v in old.metadata.items() if k not in FACTORY_KEYS}
                recognized = ((old.metadata.get('orkastery_identity_version') == 2
                               and old.metadata.get('orkastery_identity') == identity)
                              or legacy_factory_identity(old))
                if not recognized or provenance != data['metadata'] or fixed_tags(old.tags) != fixed_tags(entry.tags):
                    raise ValueError('existing decision provenance mismatch')
                tags = {k: sorted(set(old.tags.get(k, [])) | set(entry.tags.get(k, [])))
                        for k in set(old.tags) | set(entry.tags)}
                if old.tags != tags or old.metadata != metadata:
                    updated = old.model_copy(update={'tags': tags, 'metadata': metadata})
                    if not await store.update(old.id, updated):
                        raise ValueError('decision update rejected')
                    saved = await store.retrieve(old.id)
                    if (not saved or saved.tags != tags or saved.metadata != metadata or saved.content != old.content
                            or saved.source != old.source or saved.priority != old.priority or saved.mandatory):
                        raise ValueError('decision readback')
            elif old.metadata != entry.metadata or old.tags != entry.tags:
                raise ValueError('existing identity mismatch')
            return {'ok': True, 'id': old.id, 'duplicada': True, 'collection': old.collection, 'detalhe': 'duplicate'}
        entry_id, _ = await layer.add_memory(entry)
        saved = await store.retrieve(entry_id)
        if not saved or saved.metadata != entry.metadata or saved.source != entry.source:
            raise ValueError('add readback')
        return {'ok': True, 'id': entry_id, 'duplicada': False, 'collection': entry.collection, 'detalhe': 'created'}
    if op != 'handoff':
        raise ValueError('operation')
    p = request['pedido']
    if set(p['metadata']) & {'package_id', 'session_id', 'origin', 'destination', 'package_entry_id', 'handoff_entry_id', 'orkastery_identity'}:
        raise ValueError('reserved G3 metadata')
    if p['tags'].get('project') != [p['tenant']] or not p['identidade'] or not p['sessionId']:
        raise ValueError('tenant/identity')
    # Native lookup includes retained packages hidden from context search. The payload
    # carries the stable factory identity, so two distinct origins cannot collide.
    from orkmind.core.injection import compute_content_hash
    if p['payload'].get('orkastery_identity') != p['identidade']:
        raise ValueError('payload identity')
    package_hash = compute_content_hash(json.dumps(p['payload'], ensure_ascii=False, indent=2, default=str))
    existing_package = await store.find_by_content_hash(package_hash, 'semantic_log')
    if existing_package:
        existing = await store.retrieve(existing_package.metadata['handoff_entry_id'])
        return {**await readback(store, p, existing), 'duplicada': True}
    result = await submeter_handoff(layer, session_id=p['sessionId'], payload=p['payload'],
                                    origin=p['origem'], destination=p['destino'], refacao=0)
    if result['status'] != 'armazenado':
        raise ValueError('G3 rejected')
    # G3 owns validation and persistence. Only enrich entries it has just created.
    session = await store.retrieve(result['session_entry_id'])
    session.tags = {**session.tags, **{k: sorted(set(session.tags.get(k, [])) | set(v)) for k, v in p['tags'].items()}}
    session.metadata = {**session.metadata, 'tenant': p['tenant']}
    if not await store.update(session.id, session):
        raise ValueError('session enrichment')
    summary = await store.retrieve(result['handoff_id'])
    package = await store.retrieve(result['package_entry_id'])
    for entry in (summary, package):
        entry.tags = {**entry.tags, **p['tags']}
        entry.metadata = {**entry.metadata, **p['metadata'], 'orkastery_identity': p['identidade'],
                          'package_entry_id': package.id, 'handoff_entry_id': summary.id}
        entry.scope = 'project'
        if not await store.update(entry.id, entry):
            raise ValueError('G3 enrichment')
    summary = await store.retrieve(summary.id)
    return {**await readback(store, p, summary), 'duplicada': False}


async def main(request):
    if isinstance(request, dict) and request.get('op') == 'brain':
        if set(request) != {'op','request'}:
            return {'schema':'orkmind.company-brain-api/v1','state':'conflict','error':'brain.api.invalid'}
        from orkmind.cli.company_brain import service_request
        return service_request(request['request'])
    if isinstance(request, dict) and request.get('op') == 'query':
        query_contract(request)
    native_schema_fields()
    from orkmind.core.config import OrkMindConfig
    from orkmind.store.factory import create_store
    dsn = os.environ.get('ORKMIND_DATABASE_URL', '')
    if not dsn.strip():
        raise ValueError('missing tenant environment')
    store = create_store(OrkMindConfig(database_url=dsn, store_backend='pgvector', embedding_provider=''))
    try:
        if request['op'] in ('add', 'handoff'):
            conn = await store.inner._get_conn()
            async with conn.transaction():
                await conn.execute('SELECT pg_advisory_xact_lock(1869769581)')
                return await execute(request, store)
        return await execute(request, store)
    finally:
        await store.close()


if __name__ == '__main__':
    logging.disable(logging.CRITICAL)
    try:
        request = json.load(sys.stdin)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = asyncio.run(main(request))
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        # The factory requires an initialized tenant schema; health never provisions it.
        code = error_code(error)
        print(json.dumps({'error': code}))
        sys.exit(1)
