"""Contrato de fixture externa. Apenas socket sintetico atestado; nunca DSN do ambiente."""
import json
import os
from pathlib import Path
import re
import stat
import time


def receipt_file(filename):
    try:
        path = Path(filename)
        root = path.parent
        if (not path.is_absolute() or not re.fullmatch(r'receipt(?:-[a-f0-9]+)?\.json', path.name)
                or not re.fullmatch(r'/tmp/ork-prospective-fixture-[a-zA-Z0-9-]+', str(root))
                or root.resolve() != root or root.is_symlink()):
            raise ValueError()
        st = root.stat()
        if st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700:
            raise ValueError()
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o600:
                raise ValueError()
            with os.fdopen(fd, closefd=False) as f:
                receipt = json.load(f)
        finally:
            os.close(fd)
        if (receipt['schema'] != 'ork.native-fixture/v1' or receipt['synthetic'] is not True
                or receipt['ownerUid'] != os.getuid() or not receipt['preparedBy'].strip()
                or receipt['socket'] != str(root) or receipt['database'] != 'ork_i06_txn_fixture'
                or receipt['tenant'] != 'synthetic' or receipt['expiresAt'] <= time.time()
                or not re.fullmatch('[a-f0-9]{64}', receipt['container'])
                or not re.fullmatch('sha256:[a-f0-9]{64}', receipt['image'])
                or not re.fullmatch('[a-f0-9]{64}', receipt['identity'])):
            raise ValueError()
        socket = root / '.s.PGSQL.5432'
        st = socket.lstat()
        if not stat.S_ISSOCK(st.st_mode) or st.st_uid != os.getuid():
            raise ValueError()
        return receipt
    except (OSError, ValueError, KeyError, TypeError):
        raise PermissionError('runtime.fixture.invalid') from None


def fixture_dsn(receipt):
    # Values are validated, and credentials/operational connection strings are not inputs.
    from psycopg.conninfo import make_conninfo
    return make_conninfo(dbname=receipt['database'], user='postgres', host=receipt['socket'])


async def connect_fixture(filename):
    import psycopg
    receipt = receipt_file(filename)
    try:
        conn = await psycopg.AsyncConnection.connect(fixture_dsn(receipt), autocommit=True)
    except psycopg.OperationalError:
        raise RuntimeError('runtime.unavailable: external fixture connection') from None
    try:
        row = await (await conn.execute('SELECT identity, tenant FROM public.ork_fixture_identity')).fetchone()
        if row != (receipt['identity'], receipt['tenant']):
            raise PermissionError('runtime.fixture.identity-mismatch')
    except Exception:
        await conn.close()
        raise PermissionError('runtime.fixture.identity-mismatch') from None
    return conn, receipt
