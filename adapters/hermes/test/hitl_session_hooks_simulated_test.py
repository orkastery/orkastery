"""API pública do loader Hermes SIMULADA; plugin real, sem instalação do Hermes."""
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from layout import plugin_directory


class SimulatedPluginApi:
    """Imita somente register_hook/invoke_hook, a superfície pública consumida pelo plugin."""
    def __init__(self):
        self.hooks = {}

    def register_hook(self, name, callback):
        self.hooks.setdefault(name, []).append(callback)

    def invoke_hook(self, name, **kwargs):
        results = []
        for callback in self.hooks.get(name, []):
            result = callback(**kwargs)
            if result is not None:
                results.append(result)
        return results


def load_plugin():
    source = plugin_directory() / '__init__.py'
    spec = importlib.util.spec_from_file_location('orkastery_hitl_session_simulated', source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'plugin sem loader: {source}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SimulatedContractTest(unittest.TestCase):
    def test_session_hooks_transport_core_context(self):
        plugin = load_plugin()
        api = SimulatedPluginApi()
        plugin.register(api)
        self.assertEqual(list(api.hooks), ['pre_gateway_dispatch', 'on_session_start', 'pre_llm_call'])

        orientation = {'contrato': 'ork.sessao-orientacao/v1', 'estado': 'fora-de-thread',
                       'bloqueia': False, 'texto': 'Orientação SIMULADA pela API pública.'}
        env = {'ORK_NUCLEO_DIR': '/nucleo-SIMULADO', 'NODE_BIN': '/node-SIMULADO'}
        with patch.dict(os.environ, env, clear=True), patch.object(plugin.subprocess, 'run', return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(orientation))) as run:
            self.assertEqual(api.invoke_hook('on_session_start', session_id='sessao-simulada',
                model='modelo', platform='gateway'), [])
            self.assertEqual(api.invoke_hook('pre_llm_call', session_id='sessao-simulada',
                user_message='pedido', conversation_history=[], is_first_turn=True,
                model='modelo', platform='gateway'), [{'context': 'Orientação SIMULADA pela API pública.'}])
            self.assertEqual(api.invoke_hook('pre_llm_call', session_id='sessao-simulada',
                user_message='pedido', conversation_history=[], is_first_turn=True,
                model='modelo', platform='gateway'), [])
            self.assertEqual(run.call_args.args[0][0:2], ['/node-SIMULADO', '-e'])


if __name__ == '__main__':
    unittest.main()
