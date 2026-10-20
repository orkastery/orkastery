/**
 * RM-061, F3d (snapshot pt-BR): `fabrica` (com a batida), `eval`, `licoes`, `master` (o bloco complementar), `mcp install`
 * e `demo`. Sem rede, cron ou systemd: o remoto da fabrica e um repositorio nu numa pasta temporaria, e a batida instalada
 * sai pelas funcoes de texto (o PATH do CLI nao tem `crontab`).
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { rodarCanarios, rodarEval, textoDoEval } from '../src/evalrunner';
import { textoDoEstadoDaBatida, textoDoResultadoDaBatida } from '../src/fabrica-batida';
import { textoDaFabrica, textoDasOutrasMaquinas } from '../src/fabrica-estado';
import { textoDeLicoes } from '../src/licoes';
import { textoDoMaster } from '../src/master';
import { exec } from '../src/util';
import { Ambiente, ambiente, caso, Casos, dirTemp, idDaThread, ork, orkComEnv, projeto, T0, T1, T2, texto } from './locale-f3d-apoio';

/** Grava `conteudo` (texto, ou JSON) em `raiz/relativo`, criando as pastas. */
function gravar(raiz: string, relativo: string, conteudo: unknown): void {
  const arquivo = path.join(raiz, relativo);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, typeof conteudo === 'string' ? conteudo : `${JSON.stringify(conteudo, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// fabrica: o painel e a secao das outras maquinas (funcoes de texto)
// ---------------------------------------------------------------------------

const THREAD = { nome: 'pedido', modo: '#Classic', status: 'aberta', branch: 'ork/loja', atualizadaEm: T1, entregue: null,
  esperaVoce: false, pergunta: null, paradaDesde: null, runtime: null, modelo: null, esforco: null, sessao: null };

function maquina(nome: string, por: string, publicadoEm: string, threads: object[]): object {
  return { contrato: 'ork.fabrica-maquina/v1', maquina: nome, por, projeto: 'loja', versaoOrk: '0.0.0', publicadoEm, threads };
}

function casosDoPainel(casos: Casos): void {
  const esta = maquina('pc-loc', 'Equipe da loja', T1, [
    { ...THREAD, id: 'loj-plano', fase: 'PLAN', roadmap: 'RM-001', esperaVoce: true, runtime: 'claude-bg', modelo: 'opus', esforco: 'high',
      sessao: { viva: true, desdeEm: null, motivo: null } },
    { ...THREAD, id: 'loj-go', fase: 'GO', esperaVoce: true, pergunta: 'aprovar o desenho da tela de pedidos?', paradaDesde: T0,
      runtime: 'codex', sessao: { viva: false, desdeEm: T0, motivo: 'a sessao saiu sem resposta' } },
    { ...THREAD, id: 'loj-pronta', fase: 'SHIP', entregue: 'abc1234' },
  ]);
  const outra = maquina('pc-dois', 'Outra pessoa', T0, [{ ...THREAD, id: 'loj-check', fase: 'CHECK', roadmap: 'RM-002' }]);
  const parada = maquina('pc-tres', 'Equipe da loja', T2, []);
  caso(casos, 'fabrica: painel com threads esperando', () =>
    textoDaFabrica({ maquinas: [esta, outra, parada], atualizado: true, ponta: null } as never, 'pc-loc'));
  caso(casos, 'fabrica: painel vazio sem leitura nova', () =>
    textoDaFabrica({ maquinas: [], atualizado: false, ponta: null } as never, 'pc-loc'));
  caso(casos, 'fabrica: outras maquinas lidas agora', () =>
    textoDasOutrasMaquinas({ maquinas: [esta, outra, parada], atualizado: true, ponta: null } as never, 'pc-loc'));
  caso(casos, 'fabrica: nenhuma outra maquina na copia local', () =>
    textoDasOutrasMaquinas({ maquinas: [esta], atualizado: false, ponta: null } as never, 'pc-loc'));
}

// ---------------------------------------------------------------------------
// fabrica batida: o estado e o resultado (funcoes de texto, crontab nenhum)
// ---------------------------------------------------------------------------

const LINHA_DO_ORK = "*/15 * * * * ORK_PULSE_PROJECT='/srv/loja' PATH='/usr/bin:/bin' '/srv/loja/monitor/pulse-varredura.sh' # ork-batida";
const LINHA_A_MAO = "*/30 * * * * ORK_PULSE_PROJECT='/srv/loja' '/srv/loja/monitor/pulse-varredura.sh'";

function casosDaBatida(casos: Casos): void {
  const estado = { projeto: '/srv/loja', maquina: 'pc-loc', leitura: { ok: true }, gerenciada: null, manuais: [], instalada: false,
    intervaloMin: null, ultimaRodada: null };
  caso(casos, 'fabrica batida: crontab nao lido', () => textoDoEstadoDaBatida({ ...estado,
    leitura: { ok: false, motivo: 'comando crontab ausente nesta maquina' } } as never, T2));
  caso(casos, 'fabrica batida: nao instalada com rodada ok', () => textoDoEstadoDaBatida({ ...estado,
    ultimaRodada: { em: T1, code: 0, detalhe: 'varredura sem pendencia', haMin: 5 } } as never, T2));
  caso(casos, 'fabrica batida: instalada pelo ork e atrasada', () => textoDoEstadoDaBatida({ ...estado, gerenciada: LINHA_DO_ORK,
    manuais: [LINHA_A_MAO], instalada: true, intervaloMin: 15, ultimaRodada: { em: T0, code: 2, detalhe: '', haMin: 84 },
    autorizacao: { estado: 'ausente', motivo: 'autorizacao.ausente', por: null, ate: null, pode: [],
      linha: 'sem autorizacao duravel: as acoes da varredura viram itens da fila do pulse' } } as never, T2));
  caso(casos, 'fabrica batida: linha a mao com horario ilegivel', () => textoDoEstadoDaBatida({ ...estado,
    manuais: ["@reboot ORK_PULSE_PROJECT='/srv/loja' '/srv/loja/monitor/pulse-varredura.sh'"], instalada: true,
    ultimaRodada: { em: T2, code: null, detalhe: 'saiu sem codigo', haMin: 0 } } as never, T2));
  const resultado = { projeto: '/srv/loja', linha: null, retiradas: [], manuais: [], eventId: null };
  caso(casos, 'fabrica batida: instalar ja instalada', () =>
    textoDoResultadoDaBatida({ ...resultado, acao: 'ja-instalada', linha: LINHA_DO_ORK } as never));
  caso(casos, 'fabrica batida: instalar trocando linhas', () => textoDoResultadoDaBatida({ ...resultado, acao: 'instalou',
    linha: LINHA_DO_ORK, retiradas: [LINHA_A_MAO, '*/10 * * * * /srv/antiga.sh # ork-batida'], eventId: 'evt-instalou' } as never));
  caso(casos, 'fabrica batida: remover', () => textoDoResultadoDaBatida({ ...resultado, acao: 'removeu', retiradas: [LINHA_DO_ORK],
    manuais: [LINHA_A_MAO], eventId: 'evt-removeu' } as never));
  caso(casos, 'fabrica batida: remover sem batida do ork', () =>
    textoDoResultadoDaBatida({ ...resultado, acao: 'nao-instalada', manuais: [LINHA_A_MAO] } as never));
}

// ---------------------------------------------------------------------------
// fabrica no CLI: remoto nu local, publicar, entrar, sair e as recusas
// ---------------------------------------------------------------------------

function casosDaFabricaNoCli(casos: Casos): void {
  // Ambiente proprio: `fabrica entrar` e `sair` gravam a adesao da maquina na casa, e o resto do grupo nao a herda.
  const amb = ambiente('fabrica');
  const repo = projeto('fabrica', 'fab', amb);
  caso(casos, 'cli fabrica: list sem o remoto', () => texto(ork(repo, amb, 'fabrica')));
  caso(casos, 'cli fabrica: subcomando desconhecido', () => texto(ork(repo, amb, 'fabrica', 'voar')));
  caso(casos, 'cli fabrica: batida com acao desconhecida', () => texto(ork(repo, amb, 'fabrica', 'batida', 'voar')));
  caso(casos, 'cli fabrica: batida status sem crontab', () => texto(ork(repo, amb, 'fabrica', 'batida', 'status')));
  const origem = dirTemp('fabrica-origem', '<ORIGEM>');
  exec('git', ['init', '-q', '--bare', '-b', 'main'], origem);
  exec('git', ['remote', 'add', 'origin', origem], repo);
  caso(casos, 'cli fabrica: nenhuma maquina publicou', () => texto(ork(repo, amb, 'fabrica')));
  caso(casos, 'cli fabrica: publicar', () => texto(ork(repo, amb, 'fabrica', 'publicar')));
  caso(casos, 'cli fabrica: publicar sem mudanca', () => texto(ork(repo, amb, 'fabrica', 'publicar')));
  // A trava de outra publicacao desta maquina: o pid vivo e o deste processo.
  const trava = path.join(repo, '.orkastery', 'monitor', 'fabrica.lock');
  fs.mkdirSync(trava, { recursive: true });
  fs.writeFileSync(path.join(trava, 'pid'), String(process.pid));
  caso(casos, 'cli fabrica: publicar com outra publicacao em andamento', () => texto(ork(repo, amb, 'fabrica', 'publicar', '--forcar')));
  fs.rmSync(trava, { recursive: true, force: true });
  caso(casos, 'cli fabrica: list com esta maquina', () => texto(ork(repo, amb, 'fabrica')));
  caso(casos, 'cli fabrica: list sem leitura nova', () => texto(ork(repo, amb, 'fabrica', '--sem-remoto')));
  fs.appendFileSync(path.join(repo, 'orkastery.yaml'), '\nfabrica:\n  compartilhada: true\n');
  caso(casos, 'cli fabrica: publicar com o manifesto pedindo a fabrica', () =>
    texto(ork(repo, amb, 'fabrica', 'publicar', '--forcar')));
  caso(casos, 'cli fabrica: list com o manifesto pedindo a fabrica', () => texto(ork(repo, amb, 'fabrica')));
  caso(casos, 'cli fabrica: entrar com outro nome', () => texto(ork(repo, amb, 'fabrica', 'entrar', '--maquina', 'pc-dois')));
  caso(casos, 'cli fabrica: sair com a variavel ligada', () =>
    texto(orkComEnv(repo, amb, { ORK_FABRICA_COMPARTILHADA: '1' }, 'fabrica', 'sair')));
  caso(casos, 'cli fabrica: sair sem retrato', () => texto(ork(repo, amb, 'fabrica', 'sair')));
}

// ---------------------------------------------------------------------------
// eval: o corpus das skills e os canarios num catalogo temporario
// ---------------------------------------------------------------------------

/** A mensagem do motor de regex muda com a versao do Node; o texto do catalogo vem antes dela e fica inteiro. */
function semMensagemDoMotor(textoDoCaso: string): string {
  return textoDoCaso.replace(/^(\s*padrao "[^"\n]*" invalido: ).*$/gm, '$1<ERRO-DO-MOTOR-DE-REGEX>');
}

function corpusDasSkills(): string {
  const cat = dirTemp('eval-skills', '<CAT-SKILLS>');
  gravar(cat, 'skills/core/alfa/SKILL.md', ['# alfa', '', 'Regra: rode a prova antes de dizer pronto.', '',
    '## Racionalizacoes comuns', '', '| Desculpa | Resposta |', '| --- | --- |', '| ja testei na minha maquina | a prova roda no commit real |',
    '', '## Saida', '', 'Texto proibido aparece aqui.', ''].join('\n'));
  gravar(cat, 'skills/core/beta/SKILL.md', '# beta\n\nSem eval nenhum.\n');
  gravar(cat, 'skills/phases/gama/SKILL.md', '# gama\n\nRegra unica da gama.\n');
  const base = { gravidade: 'maior', cenario: 'o agente diz pronto', esperado: 'a prova roda' };
  gravar(cat, 'eval/casos/alfa.json', { skill: 'alfa', casos: [
    { ...base, id: 'alfa/feliz', tipo: 'caminho-feliz', assercoes: [
      { tipo: 'contem', valor: 'rode a prova', porque: 'a regra' },
      { tipo: 'contem', valor: 'regra que sumiu', porque: 'precisa existir' },
      { tipo: 'ausente', valor: 'Texto proibido', porque: 'nao pode aparecer' },
      { tipo: 'casa', valor: '(', porque: 'padrao' },
      { tipo: 'contem', valor: 'Regra:', porque: '' },
    ] },
    { ...base, id: 'alfa/feliz', tipo: 'racionalizacao', assercoes: [{ tipo: 'contem', valor: 'ja testei', porque: 'a desculpa' }] },
    { ...base, id: 'outra/borda', tipo: 'borda', gravidade: 'menor', assercoes: [] },
  ] });
  gravar(cat, 'eval/casos/delta.json', { skill: 'delta', casos: [] });
  gravar(cat, 'eval/casos/gama.json', { skill: 'gama', casos: [
    { ...base, id: 'gama/um', tipo: 'borda', assercoes: [{ tipo: 'contem', valor: 'Regra unica', porque: 'a regra da gama' }] },
  ] });
  gravar(cat, 'eval/casos/zeta.json', { casos: [] });
  return cat;
}

function casosDoEval(casos: Casos, amb: Ambiente): void {
  const skills = corpusDasSkills();
  caso(casos, 'eval: corpus das skills com cada falha', () => semMensagemDoMotor(textoDoEval(rodarEval({ catalogo: skills, soSkills: true }))));
  const canarios = dirTemp('eval-canarios', '<CAT-CANARIOS>');
  fs.mkdirSync(path.join(canarios, 'eval', 'fixtures', 'fx-sem-caso'), { recursive: true });
  gravar(canarios, 'eval/fixtures/fx-diverge/caso.json', { id: 'fx-outro', esperado: {} });
  gravar(canarios, 'eval/fixtures/fx-sem-executor/caso.json', { id: 'fx-sem-executor', esperado: {} });
  gravar(canarios, 'eval/fixtures/fx-schema-drift/caso.json', { id: 'fx-schema-drift', esperado: { contratoTrocado: true } });
  gravar(canarios, 'eval/fixtures/b2-master-log/caso.json', { valido: {} });
  caso(casos, 'eval: canarios pedidos com fixture torta', () => textoDoEval(rodarEval({ catalogo: canarios, soCanarios: true,
    canarios: ['fx-sem-caso', 'fx-diverge', 'fx-sem-executor', 'fx-schema-drift', 'fx-sumido'] })));
  caso(casos, 'eval: filtro de canarios vazio', () => textoDoEval(rodarEval({ catalogo: canarios, soCanarios: true, canarios: [] })));
  const divergente = dirTemp('eval-divergente', '<CAT-DIVERGENTE>');
  gravar(divergente, 'eval/fixtures/fx-schema-drift/caso.json', { id: 'fx-schema-drift', esperado: { validoPassa: true } });
  gravar(divergente, 'eval/fixtures/b2-master-log/caso.json', { valido: {} });
  caso(casos, 'eval: canario que diverge da fixture', () =>
    textoDoEval(rodarEval({ catalogo: divergente, soCanarios: true, canarios: ['fx-schema-drift'] })));
  // Sem filtro, todo canario do codigo sem fixture reprova; o caso guarda so a linha do fx-happy (a lista cresce com o codigo).
  caso(casos, 'eval: canario do codigo sem fixture', () => rodarCanarios(dirTemp('eval-sem-fixtures', '<CAT-VAZIO>')).falhas
    .filter((f) => f.caso === 'fx-happy').map((f) => `[${f.codigo}] ${f.detalhe}`).join('\n'));
  caso(casos, 'eval: texto com os tres estados', () => textoDoEval({ catalogo: '/srv/catalogo', metadeComportamental: 'unavailable', ok: false,
    canarios: [
      { id: 'fx-a', sobre: 'o ciclo que funciona', estado: 'passou', divergencias: [], motivo: '', observado: {} },
      { id: 'fx-b', sobre: 'a base andou', estado: 'falhou', divergencias: [], motivo: '1 chave(s) divergente(s)', observado: {} },
      { id: 'fx-c', sobre: 'precisa de git', estado: 'unavailable', divergencias: [], motivo: '', observado: {} },
    ],
    skills: [{ skill: 'alfa', casos: 3, assercoes: 7, falhas: 1 }],
    falhas: [{ codigo: 'canario', caso: 'fx-b/ponta', detalhe: 'esperado 1, observado 2' }],
    totalDeCasos: 3, totalDeAssercoes: 7 } as never));
  const fora = dirTemp('eval-fora', '<FORA>');
  // Sem git no PATH: o canario que precisa dele sai unavailable, nunca passing.
  caso(casos, 'cli eval: canario sem git na maquina', () =>
    texto(orkComEnv(fora, amb, { PATH: amb.stub }, 'eval', '--so-canarios', '--canario', 'fx-happy')));
}

// ---------------------------------------------------------------------------
// licoes: o texto que volta no GOAL e no PLAN, e as propostas de policy
// ---------------------------------------------------------------------------

function licao(raiz: string, id: string, classes: string[], motivos: string[], score: number, justificativa: string, em: string): void {
  gravar(raiz, `.orkastery/threads/${id}/POSTMORTEM.json`, { thread: id, classesDeFalha: classes,
    gatesBloqueados: motivos.map((motivo) => ({ ts: em, motivo, detalhe: '' })), geradoEm: em });
  gravar(raiz, `.orkastery/threads/${id}/master-log.json`, { contrato: 'ork.master-log/v1', thread: id, score, justificativa,
    avaliadoPor: 'dono', avaliadoEm: em });
}

function casosDasLicoes(casos: Casos): void {
  caso(casos, 'licoes: sem thread fechada', () => textoDeLicoes(dirTemp('licoes-vazio', '<LICOES>'), T2));
  const raiz = dirTemp('licoes', '<LICOES>');
  licao(raiz, 'loj-a', ['processo'], ['claims.failed'], 2, 'faltou a prova da claim', T0);
  licao(raiz, 'loj-b', ['processo', 'modelo'], ['claims.failed', 'tree.blocked'], 3, 'o modelo ignorou o plano', T1);
  licao(raiz, 'loj-c', ['processo'], ['claims.failed', 'motivo.sem-dica'], 1, 'repetiu o mesmo erro', T2);
  caso(casos, 'licoes: recorrencia vira proposta', () => textoDeLicoes(raiz, T2));
}

// ---------------------------------------------------------------------------
// master: o texto do registro, as recusas do score e a proposta de policy no CLI
// ---------------------------------------------------------------------------

function casosDoMaster(casos: Casos, amb: Ambiente): string {
  caso(casos, 'master: texto do registro com avisos', () => textoDoMaster({
    thread: { id: 'loj-mestre' },
    masterLog: { contrato: 'ork.master-log/v1', score: 4, justificativa: 'entregou o pedido com prova', avaliadoPor: 'dono', avaliadoEm: T1,
      classesDeFalha: ['processo', 'base-avancou'], fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'] },
    postmortem: { score: { regime: 'humano' }, entregas: [{}], gatesBloqueados: [{}, {}] },
    caminhoPostmortem: '/srv/loja/.orkastery/threads/loj-mestre/POSTMORTEM.json',
    caminhoMasterLog: '/srv/loja/.orkastery/threads/loj-mestre/master-log.json',
    classesInferidas: true, avisos: ['classes inferidas do ledger: processo', 'a base andou 1 vez antes da entrega'],
  } as never));
  const repo = projeto('master', 'mst', amb);
  caso(casos, 'cli master: fila aposentada', () => texto(ork(repo, amb, 'master', '--batch')));
  caso(casos, 'cli master: propor sem thread', () => texto(ork(repo, amb, 'master', 'propor')));
  caso(casos, 'cli master: sem score', () => texto(ork(repo, amb, 'master', 'mst-x')));
  caso(casos, 'cli master: score sem justificativa', () => texto(ork(repo, amb, 'master', 'mst-x', '--score', '4')));
  caso(casos, 'cli master: classe invalida', () =>
    texto(ork(repo, amb, 'master', 'mst-x', '--score', '4', '--justificativa', 'boa entrega', '--classe', 'voar')));
  caso(casos, 'cli master: classes', () => texto(ork(repo, amb, 'master', 'classes')));
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'mestre-a', '--sem-worktree'));
  const sha = createHash('sha256').update(fs.readFileSync(path.join(repo, 'README.md'))).digest('hex');
  ork(repo, amb, 'thread', 'entrega', id, '--arquivo', 'README.md', '--sha256', sha, '--por', 'dono');
  // Duas threads ja fechadas com a mesma classe, minutos antes: a terceira passa do piso e vira proposta.
  const agora = Date.now();
  licao(repo, 'mst-velha1', ['processo'], ['claims.failed'], 2, 'faltou prova', new Date(agora - 120000).toISOString());
  licao(repo, 'mst-velha2', ['processo'], ['claims.failed'], 2, 'faltou prova de novo', new Date(agora - 60000).toISOString());
  caso(casos, 'cli master: registra e propoe policy', () => texto(ork(repo, amb, 'master', id, '--score', '3',
    '--justificativa', 'entregou sem prova', '--classe', 'processo', '--por', 'dono')));
  caso(casos, 'cli licoes: com threads fechadas', () => texto(ork(repo, amb, 'licoes')));
  return repo;
}

// ---------------------------------------------------------------------------
// mcp install e demo
// ---------------------------------------------------------------------------

function casosDoMcp(casos: Casos, amb: Ambiente, repo: string): void {
  caso(casos, 'cli mcp: install sem opcoes', () => texto(ork(repo, amb, 'mcp', 'install')));
  caso(casos, 'cli mcp: install com raiz relativa', () => texto(ork(repo, amb, 'mcp', 'install', '--project', 'loja', '--host', 'claude-code')));
  caso(casos, 'cli mcp: install em simulacao', () =>
    texto(ork(repo, amb, 'mcp', 'install', '--project', repo, '--host', 'claude-code', '--dry-run')));
  caso(casos, 'cli mcp: install', () => texto(ork(repo, amb, 'mcp', 'install', '--project', repo, '--host', 'claude-code')));
}

function casosDaDemo(casos: Casos, amb: Ambiente): void {
  const fora = dirTemp('demo-fora', '<FORA>');
  caso(casos, 'cli demo: no diretorio pedido', () => texto(ork(fora, amb, 'demo', '--dir', dirTemp('demo', '<DEMO>'))));
  const cheio = dirTemp('demo-cheio', '<DEMO-CHEIO>');
  fs.writeFileSync(path.join(cheio, 'nota.txt'), 'ocupado\n');
  caso(casos, 'cli demo: diretorio que nao esta vazio', () => texto(ork(fora, amb, 'demo', '--dir', cheio)));
  // Sem git no PATH: o primeiro git da demo falha antes de qualquer narracao.
  caso(casos, 'cli demo: sem git na maquina', () =>
    texto(orkComEnv(fora, amb, { PATH: amb.stub }, 'demo', '--dir', dirTemp('demo-sem-git', '<DEMO-SEM-GIT>'))));
}

export function gerarGrupo(casos: Casos, amb: Ambiente): void {
  casosDoPainel(casos);
  casosDaBatida(casos);
  casosDasLicoes(casos);
  casosDoEval(casos, amb);
  casosDaFabricaNoCli(casos);
  const repo = casosDoMaster(casos, amb);
  casosDoMcp(casos, amb, repo);
  casosDaDemo(casos, amb);
}
