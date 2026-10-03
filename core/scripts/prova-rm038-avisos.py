#!/usr/bin/env python3
"""Prova negativa dos avisos da rodada 2, sem rede e sem alterar fontes ou estado.

Preparo: npm --prefix core run build && npm --prefix core run build:test
Uso: python3 core/scripts/prova-rm038-avisos.py [--grupo ts|ponte|todos]
A ponte exige o interpretador do OrkMind instalado. Falha da baseline nao mata mutante.
As mutacoes TS usam os JS compilados; cada caso tem uma copia nova do arquivo original.
"""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile


def trocar(texto, antes, depois):
    if texto.count(antes) != 1:
        raise RuntimeError('alvo da mutacao ausente ou ambiguo: ' + antes)
    return texto.replace(antes, depois, 1)


def depois_da_leitura(texto, funcao, leitura):
    inicio = texto.index('async def ' + funcao + '(')
    fim = texto.index('\n\n\ndef ', inicio) if funcao == 'universo' else texto.index('\n\n\nasync def execute', inicio)
    trecho = texto[inicio:fim]
    trecho = trocar(trecho, '    agora = datetime.now(timezone.utc)\n', '')
    indentacao = '        ' if funcao == 'universo' else '    '
    trecho = trocar(trecho, leitura, leitura + '\n' + indentacao + 'agora = datetime.now(timezone.utc)')
    return texto[:inicio] + trecho + texto[fim:]


def saida_zero(texto, json):
    inicio = texto.index('function buscaPorTexto(')
    fim = texto.index('\n/**', inicio)
    trecho = texto[inicio:fim]
    alvo = '        return codigo;' if json else '    return codigo;\n}'
    trecho = trocar(trecho, alvo, alvo.replace('return codigo', 'return 0'))
    return texto[:inicio] + trecho + texto[fim:]


def executar(raiz, arquivo, padrao):
    comando = ['node', '--test', '--experimental-test-isolation=none', '--test-name-pattern=' + padrao,
               str(raiz / 'core/dist-test/test' / arquivo)]
    resultado = subprocess.run(comando, cwd=raiz, capture_output=True, text=True, timeout=60)
    saida = resultado.stdout + resultado.stderr
    # Sem execucao de assercoes (ou com erro de infraestrutura), nao ha prova.
    if '# tests 0' in saida or '# skipped 0' not in saida:
        raise RuntimeError('testes nao executados:\n' + saida)
    return resultado.returncode, saida


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--grupo', choices=['ts', 'ponte', 'todos'], default='todos')
    grupo = parser.parse_args().grupo
    origem = Path(__file__).resolve().parents[1]
    teste = 'rm038-universo.test.js'
    relogio = 'rm038-universo-ponte.test.js'
    normalizacao = 'normalizacao preserva'
    transporte = 'transporte aplica prazo exclusivo'
    config = 'manifesto configura prazo proprio'
    cli = 'cli retorna 1'
    temporal = 'fts e universo julgam'
    casos = []

    def mutacao(nome, arquivo, antes, depois, padrao):
        casos.append((nome, 'core/dist-test/src/' + arquivo + '.js', teste, padrao,
                      lambda texto: trocar(texto, antes, depois)))

    if grupo in ('ts', 'todos'):
        for json in (True, False):
            casos.append(('saida zero em ' + ('json' if json else 'texto'), 'core/dist-test/src/index.js', teste, cli,
                          lambda texto, json=json: saida_zero(texto, json)))
        mutacao('descarta injection_risk', 'orkmind', 'injection_risk: o.injection_risk,', 'injection_risk: undefined,', normalizacao)
        mutacao('descarta expires_at', 'orkmind', 'expires_at: o.expires_at,', 'expires_at: undefined,', normalizacao)
        mutacao('aceita injection_risk antes do embed', 'orkmind', 'e.injection_risk !== true', 'true', 'indice recusa entrada')
        mutacao('aceita expirada antes do embed', 'orkmind', '(expira === null || expira > agora)', 'true', 'indice recusa entrada')
        mutacao('aceita expiracao no limite', 'orkmind', 'expira > agora', 'expira >= agora', normalizacao)
        mutacao('prazo padrao volta a 15 s', 'orkmind', 'exports.TIMEOUT_DO_UNIVERSO_MS = 90_000;',
                'exports.TIMEOUT_DO_UNIVERSO_MS = 15_000;', transporte)
        mutacao('universo usa prazo geral', 'orkmind', 'this.config.universoTimeoutMs ?? exports.TIMEOUT_DO_UNIVERSO_MS',
                'this.config.timeoutMs', transporte)
        mutacao('ignora prazo configurado', 'orkmind', 'manifesto.memory.universo_timeout_ms ?? exports.TIMEOUT_DO_UNIVERSO_MS',
                'exports.TIMEOUT_DO_UNIVERSO_MS', config)
        mutacao('latencia inventada', 'orkmind', 'latenciaMs: node_perf_hooks_1.performance.now() - inicio', 'latenciaMs: 0', transporte)
        mutacao('indice perde latencia', 'indice-vetorial', 'latenciaUniversoMs: o.universo.latenciaMs ?? null',
                'latenciaUniversoMs: null', transporte)
        mutacao('status perde latencia', 'memoria', '{ latenciaMs: opcoes.universo.latenciaMs }', '{}', transporte)

    if grupo in ('ponte', 'todos'):
        for funcao, leitura in [('universo', '        lidas = await ate_o_fim(contar, ler)'),
                                ('fts', '    entries = await ate_o_fim(contar, ler)')]:
            casos.append((funcao + ' captura depois da leitura', 'core/assets/orkmind_bridge.py', relogio, temporal,
                          lambda texto, f=funcao, l=leitura: depois_da_leitura(texto, f, l)))
        for funcao, chamada in [('universo', 'no_universo(e, tenant, agora)'),
                                ('fts', "no_universo(e, request['tenant'], agora)")]:
            casos.append((funcao + ' omite agora', 'core/assets/orkmind_bridge.py', relogio, temporal,
                          lambda texto, c=chamada: trocar(texto, c, c.replace(', agora)', ')'))))

    with tempfile.TemporaryDirectory(prefix='ork-rm038-mutacoes-') as temporario:
        raiz = Path(temporario)
        for pasta in ('dist', 'dist-test', 'assets', 'schemas'):
            shutil.copytree(origem / pasta, raiz / 'core' / pasta)
        (raiz / 'core/node_modules').symlink_to(origem / 'node_modules', target_is_directory=True)
        shutil.copy2(origem / 'package.json', raiz / 'core/package.json')
        for arquivo, padrao in dict.fromkeys((c[2], c[3]) for c in casos):
            codigo, saida = executar(raiz, arquivo, padrao)
            if codigo != 0:
                raise RuntimeError('baseline falhou; nenhuma mutacao comprovada neste grupo:\n' + saida)
            print('baseline ok: ' + padrao, flush=True)
        for nome, arquivo, teste, padrao, transformar in casos:
            alvo = raiz / arquivo
            original = alvo.read_text()
            try:
                alvo.write_text(transformar(original))
                codigo, saida = executar(raiz, teste, padrao)
                if codigo != 1 or 'ERR_ASSERTION' not in saida:
                    raise RuntimeError('mutante sobreviveu ou falhou sem assercao: ' + nome + '\n' + saida)
                print('mutante derrubado: ' + nome, flush=True)
            finally:
                alvo.write_text(original)
        print(f'RM-038: {len(casos)}/{len(casos)} mutantes derrubados; arquivos originais preservados')


if __name__ == '__main__':
    main()
