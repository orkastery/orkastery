"""Ensaio transacional de preparacao. Sem CLI/apply e restrito a PostgreSQL sintetico.

GovernedStore e responsavel por toda escrita; SQL abaixo serve somente aos locks.
O caminho operacional depende de autoridade nativa para orfas e decisao do condutor.
"""
import hashlib
import json
import uuid
import re
from orkmind_fixture import receipt_file
from orkmind_bridge import prospective_agent_valid, native_schema_fields
from orkmind.core.models import MemoryEntry
from orkmind.store.governance import assert_nao_protegida, assert_pode_escrever


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def dump(entry):
    return entry.model_dump(mode='json')


def same_payload(a, b):
    return {k: v for k, v in a.items() if k not in ('version', 'updated_at')} == {
        k: v for k, v in b.items() if k not in ('version', 'updated_at')}


async def rehearse(native_store, plan, requester, *, fixture_receipt=None, rollback_receipt=None, fail_after=None, locked_probe=None):
    """Lote e compensacao EXATOS, executaveis somente em fixture; requester sempre nomeado."""
    if not isinstance(requester, str) or not requester.strip():
        raise PermissionError('memory.prospective.requester-required')
    if not isinstance(fixture_receipt, str):
        raise PermissionError('runtime.fixture.receipt-required')
    fixture = receipt_file(fixture_receipt)
    native_schema_fields()
    conn = await native_store.inner._get_conn()
    if conn.info.dbname != fixture['database'] or conn.info.host != fixture['socket']:
        raise PermissionError('memory.prospective.operational-unavailable')
    identity = await (await conn.execute('SELECT identity, tenant FROM public.ork_fixture_identity')).fetchone()
    if identity != {'identity': fixture['identity'], 'tenant': fixture['tenant']}:
        raise PermissionError('runtime.fixture.identity-mismatch')
    items = plan['entradas']
    ids = sorted(item['id'] for item in items)
    if len(ids) != 3 or len(set(ids)) != 3:
        raise ValueError('memory.prospective.scope')
    items = sorted(items, key=lambda e: e['id'])
    phase = 'rollback' if rollback_receipt else 'prepare-rehearsal'
    operation_hash = digest({'plan': plan, 'requester': requester, 'rollback': rollback_receipt})
    receipt_id = str(uuid.uuid5(uuid.NAMESPACE_URL, operation_hash + ':' + phase))
    async with conn.transaction():
        # ORDER BY precede o lock; todos os tres IDs sao bloqueados antes de retrieve/update.
        rows = await (await conn.execute('SELECT id FROM memories WHERE id=ANY(%s) ORDER BY id FOR UPDATE', (ids,))).fetchall()
        if [r['id'] for r in rows] != ids:
            raise ValueError('memory.prospective.scope-changed')
        if locked_probe:
            await locked_probe(ids)
        current = [await native_store.retrieve(i) for i in ids]
        identities = await native_store._identidades(requester)
        for entry in current:
            assert_nao_protegida(entry, 'agent', 'update')
            assert_pode_escrever(entry, requester, identities)
            if (entry.collection != 'rule' or entry.source != 'agent' or entry.priority != 'high'
                    or entry.mandatory or entry.visibility != 'private'):
                raise PermissionError('memory.prospective.governance')
        expected = [item['antes'] for item in items]
        desired = [item['proposta'] for item in items]
        if rollback_receipt:
            applied = await native_store.retrieve(rollback_receipt)
            if not applied:
                raise ValueError('memory.prospective.receipt-missing')
            previous = json.loads(applied.content)
            if (previous.get('schema') != 'ork.prospective-transaction/v1'
                    or previous.get('phase') != 'prepare-rehearsal' or previous.get('rollbackOf') is not None
                    or previous.get('planHash') != digest(plan) or previous.get('requester') != requester):
                raise ValueError('memory.prospective.receipt-conflict')
            expected, desired = previous['after'], previous['before']
        receipt = await native_store.retrieve(receipt_id)
        if receipt:
            previous = json.loads(receipt.content)
            if (previous['operationHash'] != operation_hash or previous['requester'] != requester
                    or previous['after'] != [dump(e) for e in current]):
                raise ValueError('memory.prospective.replay-conflict')
            return {'receiptId': receipt_id, 'replay': True, 'updated': 0}
        if [dump(e) for e in current] != expected:
            raise ValueError('memory.prospective.snapshot-conflict')
        # Validacao de TODO o lote antes da primeira escrita; preservar todas as colunas.
        targets = []
        for old, target in zip(current, desired):
            if set(target) != set(dump(old)):
                raise ValueError('memory.prospective.snapshot-incomplete')
            changed = {k for k in target if target[k] != dump(old)[k]}
            permitted = {'tags', 'metadata'} | ({'version', 'updated_at'} if rollback_receipt else set())
            if changed - permitted:
                raise ValueError('memory.prospective.field-change')
            if target['tags'].get('editors', []) != old.tags.get('editors', []):
                raise PermissionError('memory.prospective.acl-change')
            if not rollback_receipt:
                try:
                    marker = target['metadata']['orkastery_prospective']
                    original = marker['originalJson']
                    if (set(marker) != {'schema', 'historicalOrigin', 'source', 'entryId', 'agent', 'revision',
                                        'receiptSha256', 'originalJson', 'originalSha256'}
                            or marker['schema'] != 'ork.prospective-origin/v1'
                            or marker['historicalOrigin'] != 'unknown' or marker['source'] != 'agent'
                            or not prospective_agent_valid(marker['agent'])
                            or not re.fullmatch('[a-f0-9]{40}', marker['revision'])
                            or not re.fullmatch('[a-f0-9]{64}', marker['receiptSha256'])
                            or marker['entryId'] != old.id or json.loads(original) != dump(old)
                            or hashlib.sha256(original.encode()).hexdigest() != marker['originalSha256']):
                        raise ValueError()
                except (KeyError, ValueError, TypeError, AttributeError):
                    raise ValueError('memory.prospective.marker-invalid') from None
            targets.append(MemoryEntry.model_validate({**target, 'version': old.version, 'updated_at': dump(old)['updated_at']}))
        for n, (old, target) in enumerate(zip(current, targets), 1):
            if await native_store.inner._get_conn() is not conn:
                raise RuntimeError('memory.prospective.connection-changed')
            if not await native_store.update(old.id, target, requester_id=requester):
                raise ValueError('memory.prospective.update-refused')
            saved = await native_store.retrieve(old.id)
            if saved.version != old.version + 1 or not same_payload(dump(saved), dump(target)):
                raise ValueError('memory.prospective.readback')
            if fail_after == n:
                raise RuntimeError('fixture.injected-failure')
        after = [dump(await native_store.retrieve(i)) for i in ids]
        body = {'schema': 'ork.prospective-transaction/v1', 'phase': phase, 'operationHash': operation_hash,
                'planHash': digest(plan), 'requester': requester, 'before': expected, 'after': after,
                'rollbackOf': rollback_receipt, 'historicalOrigin': 'unknown'}
        # Sidecar nativo integral, privado e duravel na MESMA transacao; nao memory_versions parcial.
        receipt = MemoryEntry(id=receipt_id, collection='semantic_log', content=json.dumps(body, ensure_ascii=False),
                              source='agent', priority='high', mandatory=False, visibility='private',
                              scope='project', author_id=requester, tags={'project': current[0].tags['project']},
                              metadata={'operationHash': operation_hash, 'historicalOrigin': 'unknown'})
        if await native_store.store(receipt) != receipt_id:
            raise ValueError('memory.prospective.receipt-write')
        if json.loads((await native_store.retrieve(receipt_id)).content) != body:
            raise ValueError('memory.prospective.receipt-readback')
    return {'receiptId': receipt_id, 'replay': False, 'updated': 3}
