/**
 * RM-061, F3d (snapshot pt-BR): `audit` (packs, lint, run, list, show, prompt, ingest, finding, verify, report, divida e
 * surface) e as tabelas de `auditoria.ts`, `auditrun.ts`, `divida.ts` e `superficie.ts`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { tabelaDePacks, textoDoPack } from '../src/auditoria';
import { resumoDoBoard, tabelaDeRodadas, tabelaDoLedgerDaRodada, textoDaRodada } from '../src/auditrun';
import { tabelaDaDivida } from '../src/divida';
import { textoDaVarredura } from '../src/superficie';
import { exec } from '../src/util';
import { Ambiente, caso, Casos, dirTemp, erro, ork, orkComEnv, projeto, SHA_64, SHA_A, T0, T1, T2, texto } from './locale-f3d-apoio';

const SESSAO = '0f0e0d0c-1111-4222-8333-444455556666';
const JANELA = 'audit.janela_ociosa nao declarada no manifesto: o custo desta rodada e governado apenas por effort eco e escopo incremental';
const ESCOPO_TOTAL = { since: null, incremental: false, arquivos: [], total: 0, graphify: 'ausente',
  detalhe: 'sem --since e sem audit.since_padrao: escopo total por ausencia de janela declarada' };
const ESCOPO_7D = { since: '7d', incremental: true, arquivos: ['src/app.js'], total: 1, graphify: 'ausente',
  detalhe: 'escopo incremental: 1 arquivo(s) tocado(s) nos ultimos 7d' };

/** O app com rotas que a varredura de superficie reconhece (SP8 a SP12, uma de confianca baixa). */
const APP = [
  "const express = require('express');",
  "const cors = require('cors');",
  'const app = express();',
  "app.use(cors({ origin: '*', credentials: true }));",
  "app.get('/admin/users', (req, res) => res.json([]));",
  "app.post('/api/pedidos', (req, res) => res.json(req.body));",
  "app.get('/api/relatorio', carimbar, (req, res) => res.json({}));",
  "app.post('/login', (req, res) => res.json({ ok: true }));",
  "app.get('/health', (req, res) => res.json({ versao: process.version, env: process.env }));",
  'module.exports = app;',
  '',
].join('\n');

const custo = (autorizadaPor: string | null) => ({
  janela: { declarada: false, inicio: '', fim: '', dentro: true, agora: '15:16', detalhe: JANELA }, effort: 'eco', model: 'opus', autorizadaPor,
});

const veredito = (rodada: string, ok: boolean, motivos: string[]) =>
  ({ rodada, commit: SHA_A, cwd: '/repo', resultados: [], motivos, ok, verificadoEm: T1 });

/** Uma rodada gravada a mao: o `audit run` poe a data de hoje no id, e estas tem id e instantes fixos. */
function gravarRodada(raiz: string, id: string, pack: string, extra: Record<string, unknown>): void {
  const dir = path.join(raiz, '.orkastery', 'audits', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
    versao: 1, id, pack, perfil: 'default', produto: 'loja', estagio: 'nascente', postura: 'warn', escopo: ESCOPO_TOTAL, custo: custo(null),
    runtime: 'claude-bg', sessionId: null, slug: id, promptPath: `.orkastery/audits/${id}/prompt.md`, promptSha256: SHA_64, verificada: false,
    memory: 'files', criadaEm: T0, status: 'ensaio', motivo: null, detalhe: '', achados: [], veredito: null, ...extra,
  }, null, 2) + '\n');
}

function gravarLedger(raiz: string, id: string, eventos: Record<string, unknown>[]): void {
  const linhas = eventos.map((e) => JSON.stringify({ thread: id, ...e }));
  fs.writeFileSync(path.join(raiz, '.orkastery', 'audits', id, 'ledger.jsonl'), linhas.join('\n') + '\n');
}

function achado(id: string, rodada: string, pack: string, regra: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, rodada, pack, regra, severidade: 'maior', titulo: `achado ${id} da regra ${regra}`, arquivo: 'src/app.js', linha: 3, descricao: '',
    proposta: { impacto: 'custa revisar', fix: 'quebrar a funcao', estimativa: '2h', passoIrreversivel: 'nenhum', destino: 'roadmap do produto loja',
      regime: 'files' },
    claim: { id: `${id}.C1`, thread: rodada, fase: null, arquivo: 'src/app.js:3', alegacao: 'o arquivo src/app.js existe', negativa: false,
      verificar: ['test -f src/app.js'], criadoEm: T0, estado: 'pendente' },
    estado: 'aberto', produto: 'loja', estagio: 'nascente', postura: 'warn', registradoEm: T0, thread: null, ...extra,
  };
}

function gravarBoard(raiz: string, achados: Record<string, unknown>[]): void {
  fs.mkdirSync(path.join(raiz, '.orkastery', 'divida'), { recursive: true });
  fs.writeFileSync(path.join(raiz, '.orkastery', 'divida', 'board.jsonl'), achados.map((a) => JSON.stringify(a)).join('\n') + '\n');
}

function achadoDeRede(regra: string, linha: number, confianca: string, severidade: string, rota: string): Record<string, unknown> {
  return { regra, arquivo: 'src/app.js', linha, confianca, severidade, titulo: `rota ${rota} sem controle`, descricao: '', alegacao: '',
    verificar: [], impacto: '', fix: '', irreversivel: 'nenhum', estimativa: '2h', framework: 'express', rota };
}

/**
 * Projeto com o app de rotas commitado. A janela ociosa que o `init` declara (22:00-06:00) faria o `audit run` e o
 * `audit prompt` dependerem do relogio; sem ela, o detalhe da janela e fixo.
 */
function projetoComApp(nome: string, abbrev: string, amb: Ambiente): string {
  const repo = projeto(nome, abbrev, amb);
  const yaml = path.join(repo, 'orkastery.yaml');
  fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8').replace('  janela_ociosa: "22:00-06:00"', '  janela_ociosa: ""'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), APP);
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.writeFileSync(path.join(repo, 'docs', 'README.md'), '# docs\n');
  exec('git', ['add', '--', 'orkastery.yaml', 'src/app.js', 'docs/README.md'], repo);
  exec('git', ['commit', '-q', '-m', 'app'], repo);
  return repo;
}

/** Um `claude` falso que despacha com sessao fixa; `agentes` e o que o `claude agents --json` responde. */
function claudeQueDespacha(nome: string, agentes: string): string {
  const dir = dirTemp(`audit-${nome}`, `<${nome.toUpperCase()}>`);
  fs.writeFileSync(path.join(dir, 'claude'), [
    '#!/bin/sh',
    `if [ "$1" = "--bg" ]; then echo "sessao em segundo plano: ${SESSAO}"; exit 0; fi`,
    `if [ "$1" = "agents" ]; then echo '${agentes}'; exit 0; fi`,
    "echo '[]'",
    'exit 0',
    '',
  ].join('\n'), { mode: 0o755 });
  return dir;
}

/**
 * Um OrkMind falso: a ponte so responde a sonda `health`, sem base nem rede. Com ela o regime efetivo e `orkmind`, e o
 * `ork` imprime a linha da memoria (a proposta global nao grava sem ativacao do operador, entao sai como falha).
 */
function orkmindFalso(): string {
  const dir = dirTemp('audit-orkmind', '<ORKMIND>');
  const interpretador = path.join(dir, 'python-falso');
  const saude = JSON.stringify({ contagens: { roadmap: 0 }, fallback: { dependencias: false }, orkmind: '0.0.1' });
  fs.writeFileSync(interpretador, `#!/bin/sh\ncat > /dev/null\necho '${saude}'\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'orkmind'), `#!${interpretador}\n`, { mode: 0o755 });
  return dir;
}

/** O id da rodada que o `audit run` cria leva a data de hoje e o contador do dia: os dois viram marcador. */
const semDia = (t: string): string => t.replace(/-\d{4}-\d{2}-\d{2}-\d+\b/g, '-<DIA>-<N>');

function casosDosPacks(casos: Casos): void {
  caso(casos, 'audit: tabela de packs sem estagio', () => tabelaDePacks());
  caso(casos, 'audit: tabela de packs no estagio crescendo', () => tabelaDePacks('crescendo' as never));
  caso(casos, 'audit: pack de ledger ativo no estagio maduro', () => textoDoPack('process' as never, 'maduro' as never));
  caso(casos, 'audit: pack de codigo inativo no estagio crescendo', () => textoDoPack('security-privacy' as never, 'crescendo' as never));
  caso(casos, 'audit: pack sem estagio', () => textoDoPack('reuse' as never));
}

function casosDaSuperficie(casos: Casos): void {
  const vazia = { raiz: '/repo', arquivosLidos: 0, arquivosComRota: 0, rotas: 0, frameworks: [], achados: [], truncados: [], limitePorRegra: 10,
    detalhe: 'nenhum arquivo de codigo no escopo: a varredura de superficie nao leu nada (isto NAO e o mesmo que superficie limpa)' };
  caso(casos, 'audit: varredura de superficie vazia', () => textoDaVarredura(vazia as never));
  const cheia = {
    raiz: '/repo', arquivosLidos: 3, arquivosComRota: 2, rotas: 6, frameworks: ['Express', 'Fastify'], limitePorRegra: 2,
    achados: [achadoDeRede('SP8', 6, 'media', 'maior', 'POST /api/pedidos'), achadoDeRede('SP8', 7, 'baixa', 'menor', 'GET /api/relatorio'),
      achadoDeRede('SP11', 4, 'alta', 'critico', 'configuracao de CORS')],
    truncados: [{ regra: 'SP8', ocultos: 2 }, { regra: 'SP12', ocultos: 1 }],
    detalhe: '3 arquivo(s) lido(s), 2 com definicao de rota, 6 rota(s), 3 achado(s) de superficie; ' +
      'teto de 2 por regra atingido em SP8 (+2), SP12 (+1)',
  };
  caso(casos, 'audit: varredura de superficie com teto e confianca baixa', () => textoDaVarredura(cheia as never));
}

function casosDoEstado(casos: Casos): void {
  const vazia = dirTemp('audit-vazia', '<VAZIA>');
  caso(casos, 'audit: lista de rodadas vazia', () => tabelaDeRodadas(vazia));
  caso(casos, 'audit: resumo do board vazio', () => resumoDoBoard(vazia));
  caso(casos, 'audit: board de divida vazio', () => tabelaDaDivida(vazia));
  caso(casos, 'audit: board de divida vazio de um pack', () => tabelaDaDivida(vazia, { pack: 'ux' as never }));

  const raiz = dirTemp('audit-estado', '<ESTADO>');
  const [r1, r2, r3, r4] = ['loj-clean-code-2025-09-19-1', 'loj-clean-code-2025-09-19-2', 'loj-security-privacy-2025-09-19-1',
    'loj-security-privacy-2025-09-19-2'];
  gravarRodada(raiz, r1, 'clean-code', { escopo: ESCOPO_7D, custo: custo('operador'), sessionId: SESSAO, verificada: true, status: 'relatada',
    detalhe: 'rodada despachada pelo runtime adapter claude-bg', achados: ['F1', 'F2'], veredito: veredito(r1, true, []) });
  gravarRodada(raiz, r2, 'clean-code', { sessionId: SESSAO, status: 'verificada', achados: ['F3', 'F7'],
    veredito: veredito(r2, false, ['claims.failed', 'claims.unverifiable']) });
  gravarRodada(raiz, r3, 'security-privacy', { achados: ['F4', 'F5'], detalhe: 'simulacao (--dry-run): o prompt foi montado e nada foi despachado',
    superficie: { arquivosLidos: 1, arquivosComRota: 1, rotas: 5, frameworks: ['Express'], encontrados: 9, registrados: 2, aConfirmar: 1,
      detalhe: '1 arquivo(s) lido(s), 1 com definicao de rota, 5 rota(s), 9 achado(s) de superficie' } });
  gravarRodada(raiz, r4, 'security-privacy', { promptSha256: '', status: 'bloqueada', motivo: 'pack.inativo-no-estagio',
    detalhe: 'o pack security-privacy entra a partir do estagio maduro, e o produto declara stage nascente',
    superficie: { arquivosLidos: 0, arquivosComRota: 0, rotas: 0, frameworks: [], encontrados: 0, registrados: 0, aConfirmar: 0,
      detalhe: 'nenhum arquivo de codigo no escopo: a varredura de superficie nao leu nada (isto NAO e o mesmo que superficie limpa)' } });
  gravarLedger(raiz, r1, [
    { ts: T0, tipo: 'audit_dispatch', pack: 'clean-code', sessionId: SESSAO },
    { ts: T0, tipo: 'finding_added', pack: 'clean-code', achado: 'F1' },
    { ts: T1, tipo: 'proposal_recorded', achado: 'F1', destino: 'roadmap do produto loja' },
    { ts: T1, tipo: 'audit_verified', pack: 'clean-code', veredito: 'achados sustentados' },
    { ts: T2, tipo: 'audit_blocked', motivo: 'custo.fora-da-janela',
      detalhe: `fora da janela desde ${T0}, anotado para a revisao do dono da rodada` },
    { ts: T2, tipo: 'finding_to_thread', achado: 'F2', thread: 'loj-achado-f2' },
    { ts: T2, tipo: 'report_generated', pack: 'clean-code', thread: r1 },
  ]);
  gravarBoard(raiz, [
    achado('F1', r1, 'clean-code', 'CC1'),
    achado('F2', r1, 'clean-code', 'CC1', { estado: 'virou-thread', thread: 'loj-achado-f2' }),
    achado('F3', r2, 'clean-code', 'CC1', { estado: 'adiado', severidade: 'menor' }),
    achado('F4', r3, 'security-privacy', 'SP8', { severidade: 'critico',
      proposta: { impacto: 'expoe o pedido', fix: 'exigir a guarda', estimativa: '1d', passoIrreversivel: 'girar a chave de assinatura',
        destino: 'roadmap do produto loja', regime: 'files' } }),
    achado('F5', r3, 'security-privacy', 'SP8', { linha: null, descricao: 'a rota vem de um roteador montado em outro arquivo' }),
    achado('F6', 'loj-ux-2025-09-19-1', 'ux', 'UX1', { estado: 'resolvido' }),
    achado('F7', r2, 'clean-code', 'CC2', { estado: 'descartado' }),
  ]);
  caso(casos, 'audit: lista de rodadas com os tres vereditos', () => tabelaDeRodadas(raiz));
  caso(casos, 'audit: rodada relatada com veredito sustentado', () => textoDaRodada(raiz, r1));
  caso(casos, 'audit: rodada verificada com veredito reprovado', () => textoDaRodada(raiz, r2));
  caso(casos, 'audit: rodada em ensaio com superficie', () => textoDaRodada(raiz, r3));
  caso(casos, 'audit: rodada bloqueada sem prompt', () => textoDaRodada(raiz, r4));
  caso(casos, 'audit: ledger vazio da rodada', () => tabelaDoLedgerDaRodada(raiz, r4));
  caso(casos, 'audit: ledger da rodada com todos os detalhes', () => tabelaDoLedgerDaRodada(raiz, r1));
  caso(casos, 'audit: ledger de rodada que nao existe', () => erro(() => tabelaDoLedgerDaRodada(raiz, 'loj-nada-2025-09-19-1')));
  caso(casos, 'audit: resumo do board', () => resumoDoBoard(raiz));
  caso(casos, 'audit: board de divida com recorrencia', () => tabelaDaDivida(raiz));
  caso(casos, 'audit: board de divida com todos os estados', () => tabelaDaDivida(raiz, { todos: true }));
  caso(casos, 'audit: board de divida de um pack so com achado resolvido', () => tabelaDaDivida(raiz, { pack: 'ux' as never }));
  caso(casos, 'audit: board de divida de um pack sem recorrencia', () => tabelaDaDivida(raiz, { pack: 'ux' as never, todos: true }));
}

function casosDoCliDeCatalogo(casos: Casos, amb: Ambiente): void {
  const fora = dirTemp('audit-fora', '<FORA>');
  caso(casos, 'cli audit: packs fora de projeto', () => texto(ork(fora, amb, 'audit', 'packs')));
  caso(casos, 'cli audit: lint fora de projeto', () => texto(ork(fora, amb, 'audit', 'lint')));

  const repo = projetoComApp('audit', 'aud', amb);
  caso(casos, 'cli audit: list sem rodadas', () => texto(ork(repo, amb, 'audit', 'list')));
  caso(casos, 'cli audit: padrao no estagio do projeto', () => texto(ork(repo, amb, 'audit')));
  caso(casos, 'cli audit: packs com estagio na opcao', () => texto(ork(repo, amb, 'audit', 'packs', '--estagio', 'maduro')));
  caso(casos, 'cli audit: packs com estagio invalido', () => texto(ork(repo, amb, 'audit', 'packs', '--stage', 'velho')));
  caso(casos, 'cli audit: pack desconhecido', () => texto(ork(repo, amb, 'audit', 'pack', 'voar')));
  caso(casos, 'cli audit: pack por opcao em outro estagio', () => texto(ork(repo, amb, 'audit', 'packs', '--pack', 'ux', '--estagio', 'crescendo')));
  caso(casos, 'cli audit: pack de ledger no estagio do projeto', () => texto(ork(repo, amb, 'audit', 'pack', 'process')));
  caso(casos, 'cli audit: lint do projeto', () => texto(ork(repo, amb, 'audit', 'lint')));
  const quebrado = path.join(repo, 'auditors', 'auditoria-clean-code.md');
  fs.mkdirSync(path.dirname(quebrado));
  fs.writeFileSync(quebrado, '---\nid: auditoria-rascunho\nversao: 0\nvariaveis: [pack, sobra]\n---\n# Auditoria {{pack}} {{fantasma}}\n');
  caso(casos, 'cli audit: lint com template quebrado', () => texto(ork(repo, amb, 'audit', 'lint')));
  fs.rmSync(quebrado);

  caso(casos, 'cli audit: run sem pack', () => texto(ork(repo, amb, 'audit', 'run')));
  caso(casos, 'cli audit: run de pack inativo no estagio', () => semDia(texto(ork(repo, amb, 'audit', 'run', 'architecture'))));
  caso(casos, 'cli audit: run sem sessao na saida do runtime', () => semDia(texto(ork(repo, amb, 'audit', 'run', 'process'))));
  caso(casos, 'cli audit: run em ensaio', () => semDia(texto(ork(repo, amb, 'audit', 'run', 'clean-code', '--dry-run'))));
  caso(casos, 'cli audit: run em ensaio com superficie',
    () => semDia(texto(ork(repo, amb, 'audit', 'run', 'security-privacy', '--dry-run', '--forcar'))));
  const vivo = claudeQueDespacha('claude-vivo', `[{"sessionId":"${SESSAO}","cwd":"/repo","name":"rodada"}]`);
  caso(casos, 'cli audit: run despachada com superficie',
    () => semDia(texto(orkComEnv(repo, amb, { PATH: `${vivo}:${amb.bin}` }, 'audit', 'run', 'security-privacy', '--forcar'))));
  const semSessao = claudeQueDespacha('claude-sem-sessao', '[]');
  caso(casos, 'cli audit: run despachada sem a sessao no runtime',
    () => semDia(texto(orkComEnv(repo, amb, { PATH: `${semSessao}:${amb.bin}` }, 'audit', 'run', 'reuse'))));
  caso(casos, 'cli audit: prompt sem pack', () => texto(ork(repo, amb, 'audit', 'prompt')));
  caso(casos, 'cli audit: prompt do pack', () => texto(ork(repo, amb, 'audit', 'prompt', 'reuse')));
  caso(casos, 'cli audit: subcomando desconhecido', () => texto(ork(repo, amb, 'audit', 'voar')));
  caso(casos, 'cli audit: subcomando com nome de propriedade de objeto', () => texto(ork(repo, amb, 'audit', 'constructor')));
}

function casosDoCliDaRodada(casos: Casos, amb: Ambiente): void {
  const repo = projetoComApp('loja', 'loj', amb);
  const [ra, rb, rc] = ['loj-clean-code-2025-09-19-1', 'loj-security-privacy-2025-09-19-1', 'loj-architecture-2025-09-19-1'];
  gravarRodada(repo, ra, 'clean-code', { escopo: ESCOPO_7D, custo: custo('operador'), sessionId: SESSAO, verificada: true, status: 'despachada',
    detalhe: 'rodada despachada pelo runtime adapter claude-bg' });
  gravarRodada(repo, rb, 'security-privacy', { detalhe: 'simulacao (--dry-run): o prompt foi montado e nada foi despachado' });
  gravarRodada(repo, rc, 'architecture', { promptSha256: '', status: 'bloqueada', motivo: 'pack.inativo-no-estagio',
    detalhe: 'o pack architecture entra a partir do estagio crescendo, e o produto declara stage nascente' });
  fs.writeFileSync(path.join(repo, 'achados.json'), JSON.stringify({ achados: [
    { regra: 'cc1', severidade: 'maior', titulo: 'funcao com 80 linhas', arquivo: 'src/app.js:3', alegacao: 'o arquivo src/app.js existe',
      verificar: ['test -f src/app.js'], impacto: 'custa revisar', fix: 'quebrar a funcao', irreversivel: 'nenhum', estimativa: '2h' },
    { regra: 'CC2', severidade: 'critico', titulo: 'nome generico', arquivo: 'src/app.js:5', alegacao: 'existe o arquivo src/nada.js',
      verificar: 'test -f src/nada.js', impacto: 'confunde quem le', fix: 'renomear', irreversivel: 'migrar o banco', estimativa: '1d' },
    { regra: 'CC3', titulo: 'comentario obsoleto', arquivo: 'src/app.js:7', impacto: 'engana quem le', fix: 'apagar', irreversivel: 'nenhum',
      estimativa: '1h' },
    { regra: 'CC9', titulo: 'regra que nao existe', arquivo: 'src/app.js:1', impacto: 'nenhum leitor', fix: 'trocar a regra', estimativa: '1h' },
    { regra: 'CC4', titulo: 'sem proposta' },
  ] }, null, 2));

  caso(casos, 'cli audit: divida vazia', () => texto(ork(repo, amb, 'audit', 'divida')));
  caso(casos, 'cli audit: divida de pack desconhecido', () => texto(ork(repo, amb, 'audit', 'divida', '--pack', 'voar')));
  caso(casos, 'cli audit: show sem rodada', () => texto(ork(repo, amb, 'audit', 'show')));
  caso(casos, 'cli audit: show de rodada que nao existe', () => texto(ork(repo, amb, 'audit', 'show', 'loj-nada-2025-09-19-1')));
  caso(casos, 'cli audit: ingest sem arquivo', () => texto(ork(repo, amb, 'audit', 'ingest', ra)));
  caso(casos, 'cli audit: ingest', () => texto(ork(repo, amb, 'audit', 'ingest', ra, '--arquivo', 'achados.json')));
  caso(casos, 'cli audit: ingest repetido', () => texto(ork(repo, amb, 'audit', 'ingest', ra, '--file', 'achados.json')));
  caso(casos, 'cli audit: finding add sem rodada', () => texto(ork(repo, amb, 'audit', 'finding', 'add')));
  caso(casos, 'cli audit: finding add', () => texto(ork(repo, amb, 'audit', 'finding', 'add', ra, '--regra', 'cc4', '--severidade', 'critico',
    '--titulo', 'ambiente na resposta', '--arquivo', 'src/app.js:9', '--descricao', 'o handler de saude devolve o ambiente',
    '--alegacao', 'o README existe', '--verificar', 'test -f README.md', '--impacto', 'vaza segredo', '--fix', 'tirar o ambiente da resposta',
    '--irreversivel', 'girar as chaves', '--estimativa', '4h')));
  caso(casos, 'cli audit: finding estado sem argumentos', () => texto(ork(repo, amb, 'audit', 'finding', 'estado')));
  caso(casos, 'cli audit: finding estado reservado', () => texto(ork(repo, amb, 'audit', 'finding', 'estado', 'F1', 'virou-thread')));
  caso(casos, 'cli audit: finding estado adiado', () => texto(ork(repo, amb, 'audit', 'finding', 'estado', 'f4', 'adiado')));
  caso(casos, 'cli audit: finding desconhecido', () => texto(ork(repo, amb, 'audit', 'achado', 'voar')));
  caso(casos, 'cli audit: finding sem acao', () => texto(ork(repo, amb, 'audit', 'finding')));
  caso(casos, 'cli audit: verify sem rodada', () => texto(ork(repo, amb, 'audit', 'verify')));
  caso(casos, 'cli audit: verify sem achado aberto', () => texto(ork(repo, amb, 'audit', 'verify', rb)));
  caso(casos, 'cli audit: verify com claims', () => texto(ork(repo, amb, 'audit', 'verify', ra)));
  caso(casos, 'cli audit: show', () => texto(ork(repo, amb, 'audit', 'show', ra)));
  caso(casos, 'cli audit: show com o ledger', () => texto(ork(repo, amb, 'audit', 'show', ra, '--ledger')));
  caso(casos, 'cli audit: report sem rodada', () => texto(ork(repo, amb, 'audit', 'report')));
  caso(casos, 'cli audit: report', () => texto(ork(repo, amb, 'audit', 'report', ra)));
  caso(casos, 'cli audit: relatorio publicado', () => texto(ork(repo, amb, 'audit', 'relatorio', rb, '--publicar')));

  caso(casos, 'cli audit: surface com regra desconhecida', () => texto(ork(repo, amb, 'audit', 'surface', '--regra', 'SP99')));
  caso(casos, 'cli audit: surface com limite invalido', () => texto(ork(repo, amb, 'audit', 'superficie', '--limite', '0')));
  caso(casos, 'cli audit: surface', () => texto(ork(repo, amb, 'audit', 'surface')));
  caso(casos, 'cli audit: surface de pasta sem codigo', () => texto(ork(repo, amb, 'audit', 'surface', 'docs')));
  caso(casos, 'cli audit: surface de uma regra com teto', () => texto(ork(repo, amb, 'audit', 'surface', '--regra', 'sp8', '--limite', '1')));
  caso(casos, 'cli audit: surface registrar', () => texto(ork(repo, amb, 'audit', 'surface', '--registrar', rb, '--limite', '1')));
  caso(casos, 'cli audit: surface registrar repetido', () => texto(ork(repo, amb, 'audit', 'surface', '--registrar', rb, '--limite', '1')));
  caso(casos, 'cli audit: surface registrar em rodada de outro pack',
    () => texto(ork(repo, amb, 'audit', 'surface', '--registrar', ra, '--limite', '1')));

  // A memoria vem por ultimo: o manifesto passa a pedir o regime orkmind, e so estes dois casos levam a ponte falsa. O
  // prazo da ponte sobe para 120 s: sob steal, os 15 s do init derrubariam o regime para files e a linha sumiria.
  const yaml = path.join(repo, 'orkastery.yaml');
  const manifesto = fs.readFileSync(yaml, 'utf8');
  fs.writeFileSync(yaml, manifesto.replace('  mode: files', '  mode: orkmind')
    .replace('  database_url_env: ""', '  database_url_env: "ORK_DSN_LOCALE"').replace('  timeout_ms: 15000', '  timeout_ms: 120000'));
  const memoria = { PATH: `${orkmindFalso()}:${amb.stub}:${amb.bin}`, ORK_DSN_LOCALE: 'postgresql://orkmind-falso.invalid/locale' };
  caso(casos, 'cli audit: finding add com memoria orkmind', () => texto(orkComEnv(repo, amb, memoria, 'audit', 'finding', 'add', rb,
    '--regra', 'sp1', '--titulo', 'segredo no codigo', '--arquivo', 'src/app.js:2', '--impacto', 'vaza a chave', '--fix', 'ler do cofre',
    '--estimativa', '1h')));
  fs.writeFileSync(path.join(repo, 'achados-memoria.json'), JSON.stringify([
    { regra: 'CC5', titulo: 'duplicacao no handler', arquivo: 'src/app.js:6', impacto: 'muda em dois lugares', fix: 'extrair', irreversivel: 'nenhum',
      estimativa: '1h' },
    { regra: 'CC5', titulo: 'duplicacao no login', arquivo: 'src/app.js:8', impacto: 'muda em dois lugares', fix: 'extrair', irreversivel: 'nenhum',
      estimativa: '1h' },
  ], null, 2));
  caso(casos, 'cli audit: ingest com memoria orkmind',
    () => texto(orkComEnv(repo, amb, memoria, 'audit', 'ingest', ra, '--arquivo', 'achados-memoria.json')));
  fs.writeFileSync(yaml, manifesto);

  caso(casos, 'cli audit: finding estado resolvido', () => texto(ork(repo, amb, 'audit', 'finding', 'estado', 'F2', 'resolvido')));
  caso(casos, 'cli audit: divida', () => texto(ork(repo, amb, 'audit', 'divida')));
  caso(casos, 'cli audit: board com todos', () => texto(ork(repo, amb, 'audit', 'board', '--todos')));
  caso(casos, 'cli audit: divida de pack sem achado', () => texto(ork(repo, amb, 'audit', 'divida', '--pack', 'ux')));
  caso(casos, 'cli audit: list', () => texto(ork(repo, amb, 'audit', 'list')));
}

export function gerarGrupo(casos: Casos, amb: Ambiente): void {
  casosDosPacks(casos);
  casosDaSuperficie(casos);
  casosDoEstado(casos);
  casosDoCliDeCatalogo(casos, amb);
  casosDoCliDaRodada(casos, amb);
}
