"""RM-026 K7 (fatia 3): o conhecimento escrito no Hermes, as mesmas tools do MCP e do OpenClaw.

Cada wrapper chama `ork conhecimento <consulta> [argumentos] --json` com o modo sem cwd e o canal do Hermes, sem shell
no meio; o JSON do nucleo volta como vem, tambem na saida 1. Os nomes sao os do manifesto do OpenClaw, e a regra das
lacunas na skill e a mesma frase das descricoes do OpenClaw.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

RAIZ = Path(__file__).resolve().parents[1]
CONSULTAS = ['listar', 'mostrar', 'colecoes', 'verificar']
NOMES = [f'ork_conhecimento_{c}' for c in CONSULTAS]


def uma_linha(texto):
    return re.sub(r'\s+', ' ', texto).strip()


def regra_do_openclaw():
    """A frase das lacunas no fonte do OpenClaw (`REGRA_DAS_LACUNAS`), lida como o teste da RM-057 le a dele."""
    fonte = (RAIZ.parent / 'openclaw' / 'src' / 'index.ts').read_text(encoding='utf-8')
    m = re.search(r'const REGRA_DAS_LACUNAS =([\s\S]*?);\n', fonte)
    if not m:
        raise AssertionError('o OpenClaw define REGRA_DAS_LACUNAS')
    return uma_linha(''.join(re.findall(r"'([^']*)'", m.group(1))))


def wrapper(consulta):
    return RAIZ / 'bin' / f'ork-conhecimento-{consulta}.sh'


class ConhecimentoHermesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.sink = self.dir / 'chamadas.jsonl'
        # O ork falso: grava o argv e o ambiente que importam; com RESPOSTA, imprime o arquivo e sai com SAIDA.
        self.ork = self.dir / 'ork falso'
        self.ork.write_text(
            f'#!{sys.executable}\n'
            'import json, os, sys\n'
            'with open(os.environ["SINK"], "a", encoding="utf-8") as f:\n'
            '    f.write(json.dumps({"argv": sys.argv[1:], "explicito": os.environ.get("ORK_PROJETO_EXPLICITO"),\n'
            '                        "canal": os.environ.get("ORK_CANAL")}) + "\\n")\n'
            'if os.environ.get("RESPOSTA"):\n'
            '    sys.stdout.write(open(os.environ["RESPOSTA"], encoding="utf-8").read())\n'
            'sys.exit(int(os.environ.get("SAIDA", "0")))\n', encoding='utf-8')
        self.ork.chmod(0o755)

    def instalar(self, consulta, ork_bin):
        """O wrapper como o `ork adapter install hermes` o deixa: o `{{ork_bin}}` renderizado (renderizarArquivo)."""
        fonte = wrapper(consulta).read_text(encoding='utf-8')
        self.assertEqual(fonte.count('{{'), 1, 'o unico placeholder e o do ork')
        destino = self.dir / 'instalado' / wrapper(consulta).name
        destino.parent.mkdir(exist_ok=True)
        destino.write_text(fonte.replace('{{ork_bin}}', ork_bin), encoding='utf-8')
        return destino

    def rodar(self, consulta, *args, ork_bin=None, **env):
        base = {k: v for k, v in os.environ.items()
                if k not in ('ORK_BIN', 'ORK_PROJETO_EXPLICITO', 'ORK_CANAL', 'ORK_PROJETO')}
        base.update(SINK=str(self.sink), **env)
        script = self.instalar(consulta, ork_bin or str(self.ork))
        return subprocess.run(['/bin/sh', str(script), *args], env=base, cwd=self.dir,
                              capture_output=True, text=True, timeout=30)

    def chamadas(self):
        return [json.loads(l) for l in self.sink.read_text(encoding='utf-8').splitlines()]

    def test_manifesto_declara_as_quatro_tools_com_os_nomes_do_openclaw(self):
        manifesto = json.loads((RAIZ / 'hermes.plugin.json').read_text(encoding='utf-8'))
        do_hermes = sorted(k for k in manifesto['bin'] if k.startswith('ork_conhecimento_'))
        self.assertEqual(do_hermes, sorted(NOMES))
        for c in CONSULTAS:
            self.assertEqual(manifesto['bin'][f'ork_conhecimento_{c}'], f'./bin/ork-conhecimento-{c}.sh')
            self.assertTrue(wrapper(c).is_file(), wrapper(c))
        openclaw = json.loads((RAIZ.parent / 'openclaw' / 'openclaw.plugin.json').read_text(encoding='utf-8'))
        self.assertEqual(sorted(t for t in openclaw['contracts']['tools'] if t.startswith('ork_conhecimento_')), do_hermes,
                         'os mesmos nomes nos dois hosts')

    def test_cada_wrapper_chama_o_ork_com_a_consulta_e_o_json_no_fim(self):
        casos = [
            ('listar', [], ['conhecimento', 'listar', '--json']),
            ('listar', ['--colecao', 'rh', '--projeto', 'orkastery'],
             ['conhecimento', 'listar', '--colecao', 'rh', '--projeto', 'orkastery', '--json']),
            ('mostrar', ['doc-politica-de-ferias'], ['conhecimento', 'mostrar', 'doc-politica-de-ferias', '--json']),
            ('mostrar', ['doc-abc', '--projeto', 'acme'], ['conhecimento', 'mostrar', 'doc-abc', '--projeto', 'acme', '--json']),
            ('colecoes', [], ['conhecimento', 'colecoes', '--json']),
            ('verificar', ['--projeto', 'acme'], ['conhecimento', 'verificar', '--projeto', 'acme', '--json']),
        ]
        for consulta, args, esperado in casos:
            r = self.rodar(consulta, *args)
            self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual([c['argv'] for c in self.chamadas()], [e for _, _, e in casos])
        self.assertEqual({(c['explicito'], c['canal']) for c in self.chamadas()}, {('1', 'hermes')},
                         'o cwd do gateway nao escolhe projeto, e o canal e o do Hermes')

    def test_argumento_continua_dado_e_o_modo_pedido_pelo_host_vale(self):
        literal = 'a b; $(touch INJETADO) `id`'
        r = self.rodar('mostrar', literal)
        self.assertEqual(r.returncode, 0, r.stderr)
        r = self.rodar('verificar', ORK_PROJETO_EXPLICITO='0', ORK_CANAL='outro')
        self.assertEqual(r.returncode, 0, r.stderr)
        # ORK_BIN vence o caminho renderizado, como nos outros wrappers do Hermes.
        r = self.rodar('colecoes', ork_bin='/caminho/sem/ork', ORK_BIN=str(self.ork))
        self.assertEqual(r.returncode, 0, r.stderr)
        primeira, segunda, terceira = self.chamadas()
        self.assertEqual(primeira['argv'], ['conhecimento', 'mostrar', literal, '--json'])
        self.assertFalse((self.dir / 'INJETADO').exists(), 'sem shell no meio')
        self.assertEqual((segunda['explicito'], segunda['canal']), ('0', 'outro'))
        self.assertEqual(terceira['argv'], ['conhecimento', 'colecoes', '--json'])

    def test_o_json_do_nucleo_volta_como_vem_tambem_na_saida_1(self):
        consulta = {
            'contrato': 'ork.conhecimento/v1', 'consulta': 'mostrar', 'dir': 'docs/conhecimento', 'id': 'doc-sumido',
            'documento': None,
            'lacunas': [{'codigo': 'documento.inexistente', 'arquivo': None, 'documento': 'doc-sumido', 'referencia': None,
                         'detalhe': 'nenhum documento válido da pasta tem o id doc-sumido'}],
        }
        resposta = self.dir / 'resposta.json'
        resposta.write_text(json.dumps(consulta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        for saida in ['1', '0']:
            r = self.rodar('mostrar', 'doc-sumido', RESPOSTA=str(resposta), SAIDA=saida)
            self.assertEqual(r.returncode, int(saida), 'a saida do nucleo, sem traducao')
            self.assertEqual(r.stdout, resposta.read_text(encoding='utf-8'), 'o JSON do nucleo, byte a byte')
            self.assertEqual(json.loads(r.stdout)['lacunas'], consulta['lacunas'])

    def test_a_skill_roteia_as_quatro_e_diz_a_regra_das_lacunas_do_openclaw(self):
        skill = uma_linha((RAIZ / 'skills' / 'orkastery-devmaster' / 'SKILL.md').read_text(encoding='utf-8'))
        for nome in NOMES:
            self.assertIn(f'`{nome}', skill)
        regra = regra_do_openclaw()
        self.assertTrue(regra.startswith('Conhecimento escrito (RM-026 K7): a resposta é o JSON do núcleo'), regra)
        self.assertIn(regra, skill, 'a mesma frase nos dois hosts')
        self.assertIn('nunca como resposta', regra)
        self.assertIn('`--projeto <nome>` do projeto pedido', skill)


if __name__ == '__main__':
    unittest.main()
