"""D12: resolve um único layout completo, sem escolher uma cópia ambígua."""
from pathlib import Path


def plugin_directory(tests=None):
    root = (Path(tests) if tests is not None else Path(__file__).parent).resolve().parent
    candidates = [root / 'hitl-ingress', root / 'plugins/orkastery-hitl']
    present = [p for p in candidates if p.exists() or p.is_symlink()]
    if len(present) != 1:
        raise RuntimeError('hermes.layout.ambiguous' if present else 'hermes.layout.missing')
    plugin = present[0]
    if not all((plugin / name).is_file() for name in ('__init__.py', 'plugin.yaml')):
        raise RuntimeError('hermes.layout.incomplete')
    return plugin
