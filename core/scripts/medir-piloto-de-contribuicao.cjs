#!/usr/bin/env node
/**
 * RM-050: mede o piloto do guia de contribuicao pelos dados do GitHub.
 *
 * A metrica principal do RM-050 e a fracao de PRs de fora cujo CI passa na primeira execucao
 * (meta de 80%), e o item fecha quando dois PRs de fora passarem pelo guia sem ajuda do
 * mantenedor. Este script faz as duas contas, por repositorio, desde a publicacao do guia:
 *
 *  - PR de fora: `author_association` fora de OWNER e MEMBER, de autor que nao e bot;
 *  - primeira execucao: o run mais antigo do workflow de CI, com evento `pull_request`, sobre um
 *    commit do PR. `action_required` (o GitHub esperando o mantenedor liberar o PR de fork),
 *    `skipped` e `stale` nao sao execucao; num run reexecutado vale a primeira tentativa que rodou;
 *  - sem ajuda: nenhum commit de outra pessoa no PR. Commit sem login do GitHub nao conta como
 *    prova; ajuda em comentario nao vira dado: o mantenedor confere nos PRs listados.
 *
 * Lacuna nao vira zero: PR de fora sem os commits na coleta, ou run reexecutado sem as tentativas
 * anteriores, reprova a leitura; sem PR de fora com execucao, a taxa sai "sem medida".
 *
 * A coleta usa o `gh api` (rede e `gh auth login`). `--dados ARQUIVO` le uma coleta salva com
 * `--salvar-dados`, sem rede. `--tratar-como-externo LOGIN` conta tambem os PRs desse autor: serve
 * para ensaiar a medicao sobre PRs reais antes do primeiro PR de fora.
 *
 *   node core/scripts/medir-piloto-de-contribuicao.cjs [--repo DONO/NOME]... [--workflow ci.yml]
 *        [--desde AAAA-MM-DD] [--tratar-como-externo LOGIN]... [--dados ARQUIVO]
 *        [--salvar-dados ARQUIVO] [--json]
 *
 * `--desde` e uma data em UTC. Sai 0 com a medida e 2 com erro de uso, de coleta ou de dados.
 */
'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

/** Os dois repositorios do piloto e a publicacao do guia (PR #22, mesclado em 29/09/2026). */
const REPOS_DO_PILOTO = ['orkastery/orkastery', 'orkastery/orkmind'];
const PUBLICACAO = '2026-09-29';
const META = 0.8;
const PRS_PARA_FECHAR = 2;
const ESQUEMA = 'ork.piloto-contribuicao/v1';
const ASSOCIACOES_DA_CASA = new Set(['OWNER', 'MEMBER']);
const NAO_E_EXECUCAO = new Set(['action_required', 'skipped', 'stale']);

const USO = [
  'uso: node core/scripts/medir-piloto-de-contribuicao.cjs [--repo DONO/NOME]... [--workflow ci.yml]',
  '       [--desde AAAA-MM-DD] [--tratar-como-externo LOGIN]... [--dados ARQUIVO] [--salvar-dados ARQUIVO] [--json]',
].join('\n');

const instante = (data) => Date.parse(`${data}T00:00:00Z`);

function deFora(pr, externos) {
  const login = pr.user?.login ?? null;
  if (login !== null && externos.has(login)) return true;
  return !ASSOCIACOES_DA_CASA.has(pr.author_association) && pr.user?.type !== 'Bot';
}

function estadoDoPr(pr) {
  if (pr.merged_at) return 'mesclado';
  return pr.state === 'open' ? 'aberto' : 'fechado';
}

/**
 * As tentativas de um run em ordem: as anteriores vem da coleta (`tentativas`), a ultima e o
 * proprio run. Reexecutado sem as anteriores na coleta e lacuna, e lacuna reprova.
 */
function tentativasDoRun(run, tentativas, repo) {
  const anteriores = tentativas?.[String(run.id)] ?? [];
  const total = run.run_attempt ?? 1;
  const lista = [...anteriores, run].sort((a, b) => (a.run_attempt ?? 1) - (b.run_attempt ?? 1));
  const numeros = lista.map((t) => t.run_attempt ?? 1);
  for (let n = 1; n <= total; n++) {
    if (!numeros.includes(n)) throw new Error(`dados sem a tentativa ${n} do run ${run.id} de ${repo}: colete de novo`);
  }
  return lista;
}

/** A primeira execucao do CI sobre os commits do PR, ou `null` com o motivo. */
function primeiraExecucao(shas, runs, tentativas, repo) {
  const doPr = runs
    .filter((r) => r.event === 'pull_request' && shas.has(r.head_sha))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
  for (const run of doPr) {
    for (const t of tentativasDoRun(run, tentativas, repo)) {
      if (NAO_E_EXECUCAO.has(t.conclusion)) continue;
      const concluida = (t.status ?? run.status) === 'completed';
      return {
        run: run.id,
        tentativa: t.run_attempt ?? 1,
        conclusao: concluida ? t.conclusion : null,
        emAndamento: !concluida,
        url: run.html_url ?? null,
      };
    }
  }
  return null;
}

/** A medida inteira, sem rede: le a coleta (`dados`) e aplica as regras do cabecalho. */
function medirPiloto(dados, opcoes = {}) {
  if (!dados || typeof dados.repos !== 'object' || dados.repos === null) throw new Error('dados inválidos: falta o objeto repos');
  const desde = opcoes.desde ?? PUBLICACAO;
  if (Number.isNaN(instante(desde))) throw new Error(`--desde inválido: ${desde}`);
  const externos = new Set(opcoes.tratarComoExterno ?? []);
  const nomes = opcoes.repos?.length ? opcoes.repos : Object.keys(dados.repos);
  const repos = nomes.map((repo) => {
    const d = dados.repos[repo];
    if (!d) throw new Error(`dados sem o repositório ${repo}`);
    const prs = (d.prs ?? [])
      .filter((pr) => Date.parse(pr.created_at) >= instante(desde) && deFora(pr, externos))
      .sort((a, b) => a.number - b.number)
      .map((pr) => {
        const commits = d.commits?.[String(pr.number)];
        if (!Array.isArray(commits)) throw new Error(`dados sem os commits do PR #${pr.number} de ${repo}: colete de novo com as mesmas opções`);
        const autor = pr.user?.login ?? null;
        const execucao = primeiraExecucao(new Set(commits.map((c) => c.sha)), d.runs ?? [], d.tentativas, repo);
        const doPr = (d.runs ?? []).filter((r) => r.event === 'pull_request' && commits.some((c) => c.sha === r.head_sha));
        const commitsDeOutraPessoa = commits.filter((c) => c.author?.login && c.author.login !== autor).length;
        const commitsSemLogin = commits.filter((c) => !c.author?.login).length;
        const estado = estadoDoPr(pr);
        return {
          numero: pr.number,
          autor,
          associacao: pr.author_association ?? null,
          criadoEm: pr.created_at,
          estado,
          url: pr.html_url ?? null,
          primeiraExecucao: execucao,
          aguardandoLiberacao: !execucao && doPr.some((r) => r.conclusion === 'action_required'),
          commits: commits.length,
          commitsDeOutraPessoa,
          commitsSemLogin,
          contaParaFechamento:
            estado === 'mesclado' && execucao?.conclusao === 'success' && commitsDeOutraPessoa === 0 && commitsSemLogin === 0,
        };
      });
    return { repo, prs };
  });
  const todos = repos.flatMap((r) => r.prs);
  const comExecucao = todos.filter((p) => p.primeiraExecucao?.conclusao).length;
  const verdesNaPrimeira = todos.filter((p) => p.primeiraExecucao?.conclusao === 'success').length;
  const atingidos = todos.filter((p) => p.contaParaFechamento).length;
  return {
    esquema: ESQUEMA,
    desde,
    tratadosComoExternos: [...externos].sort(),
    workflow: dados.workflow ?? null,
    coletadoEm: dados.coletadoEm ?? null,
    repos,
    resumo: {
      prsDeFora: todos.length,
      comExecucao,
      verdesNaPrimeira,
      taxa: comExecucao ? verdesNaPrimeira / comExecucao : null,
      meta: META,
      fechamento: { exigidos: PRS_PARA_FECHAR, atingidos, fechado: atingidos >= PRS_PARA_FECHAR },
    },
  };
}

function gh(args) {
  const r = spawnSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`o gh não rodou (${r.error.message}): instale o GitHub CLI e rode gh auth login`);
  if (r.status !== 0) throw new Error(`gh api ${args.join(' ')} saiu ${r.status}: ${(r.stderr ?? '').trim()}`);
  return r.stdout;
}

/** Uma linha de JSON por item: a forma que o `gh api --paginate --jq '.[]'` devolve. */
const porLinha = (saida) => saida.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

/** A coleta pelo `gh api`, so do que a medida usa. Commits e runs so dos PRs de fora. */
function coletar({ repos, workflow, desde, tratarComoExterno }) {
  const externos = new Set(tratarComoExterno ?? []);
  const dados = { esquema: ESQUEMA, coletadoEm: new Date().toISOString(), workflow, desde, repos: {} };
  for (const repo of repos) {
    const prs = porLinha(gh([
      '--paginate', `repos/${repo}/pulls?state=all&per_page=100`,
      '--jq', '.[] | {number, html_url, state, created_at, merged_at, author_association, user: (if .user then {login: .user.login, type: .user.type} else null end)}',
    ])).filter((pr) => Date.parse(pr.created_at) >= instante(desde));
    const commits = {};
    for (const pr of prs.filter((p) => deFora(p, externos))) {
      commits[String(pr.number)] = porLinha(gh([
        '--paginate', `repos/${repo}/pulls/${pr.number}/commits?per_page=100`,
        '--jq', '.[] | {sha, author: (if .author then {login: .author.login} else null end)}',
      ]));
    }
    let runs = [];
    const tentativas = {};
    if (Object.keys(commits).length) {
      const shas = new Set(Object.values(commits).flat().map((c) => c.sha));
      runs = porLinha(gh([
        '--paginate', `repos/${repo}/actions/workflows/${workflow}/runs?event=pull_request&per_page=100&created=%3E%3D${desde}`,
        '--jq', '.workflow_runs[] | {id, head_sha, event, status, conclusion, run_attempt, created_at, html_url}',
      ])).filter((r) => shas.has(r.head_sha));
      for (const run of runs.filter((r) => (r.run_attempt ?? 1) > 1)) {
        tentativas[String(run.id)] = [];
        for (let n = 1; n < run.run_attempt; n++) {
          tentativas[String(run.id)].push(JSON.parse(gh([`repos/${repo}/actions/runs/${run.id}/attempts/${n}`, '--jq', '{run_attempt, status, conclusion}'])));
        }
      }
    }
    dados.repos[repo] = { prs, commits, runs, tentativas };
  }
  return dados;
}

const porcento = (x) => `${Math.round(x * 100)}%`;

function relatorio(m) {
  const linhas = [`Piloto do RM-050: PRs de fora desde ${m.desde} (UTC), CI pelo workflow ${m.workflow ?? '(não informado)'}`];
  if (m.tratadosComoExternos.length) {
    linhas.push(`Ensaio: conta também os PRs de ${m.tratadosComoExternos.join(', ')}, que não são de fora. Não vale como medida do piloto.`);
  }
  for (const { repo, prs } of m.repos) {
    if (!prs.length) {
      linhas.push('', `${repo}: nenhum PR de fora.`);
      continue;
    }
    linhas.push('', `${repo}:`);
    for (const p of prs) {
      const e = p.primeiraExecucao;
      let ci;
      if (e?.emAndamento) ci = `primeira execução em andamento (run ${e.run})`;
      else if (e) ci = `primeira execução ${e.conclusao} (run ${e.run}, tentativa ${e.tentativa})`;
      else ci = p.aguardandoLiberacao ? 'CI aguardando o mantenedor liberar' : 'sem execução do CI';
      const semLogin = p.commitsSemLogin ? `, commits sem login do GitHub: ${p.commitsSemLogin} (confira)` : '';
      linhas.push(`  #${p.numero} @${p.autor ?? '?'}, ${p.estado}: ${ci}, commits de outra pessoa: ${p.commitsDeOutraPessoa}${semLogin}`);
      if (e?.url) linhas.push(`      ${e.url}`);
    }
  }
  const r = m.resumo;
  const taxa = r.taxa === null ? 'taxa sem medida, nenhuma primeira execução concluída' : `taxa de ${porcento(r.taxa)}`;
  linhas.push(
    '',
    `Resumo: ${r.prsDeFora} PR(s) de fora, ${r.comExecucao} com a primeira execução do CI concluída, ${r.verdesNaPrimeira} verde(s): ${taxa} (meta: ${porcento(r.meta)}).`,
    `Fechamento: ${r.fechamento.atingidos} PR(s) de fora mesclado(s), verde(s) na primeira execução e sem commit de outra pessoa; o critério pede ${r.fechamento.exigidos}${r.fechamento.fechado ? ': atingido.' : '.'}`,
    'Ajuda em comentário não entra na conta: confira nos PRs listados.',
  );
  return linhas.join('\n');
}

function lerArgs(argv) {
  const args = { repos: [], tratarComoExterno: [], json: false };
  const valor = (i, nome) => {
    if (i + 1 >= argv.length) throw new Error(`${nome} pede um valor`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.ajuda = true;
    else if (a === '--repo') args.repos.push(valor(i++, a));
    else if (a === '--tratar-como-externo') args.tratarComoExterno.push(valor(i++, a));
    else if (a === '--workflow') args.workflow = valor(i++, a);
    else if (a === '--desde') args.desde = valor(i++, a);
    else if (a === '--dados') args.dados = valor(i++, a);
    else if (a === '--salvar-dados') args.salvarDados = valor(i++, a);
    else throw new Error(`opção desconhecida: ${a}`);
  }
  for (const r of args.repos) if (!/^[\w.-]+\/[\w.-]+$/.test(r)) throw new Error(`--repo inválido: ${r} (use DONO/NOME)`);
  if (args.desde !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(args.desde) || Number.isNaN(instante(args.desde)))) {
    throw new Error(`--desde inválido: ${args.desde} (use AAAA-MM-DD)`);
  }
  if (args.workflow !== undefined && !/^[\w.-]+$/.test(args.workflow)) throw new Error(`--workflow inválido: ${args.workflow}`);
  if (args.dados && args.salvarDados) throw new Error('--dados e --salvar-dados não andam juntos: ou lê a coleta, ou coleta');
  return args;
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = lerArgs(argv);
  } catch (e) {
    console.error(`${e.message}\n${USO}`);
    return 2;
  }
  if (args.ajuda) {
    console.log(USO);
    return 0;
  }
  try {
    let dados;
    if (args.dados) {
      try {
        dados = JSON.parse(fs.readFileSync(args.dados, 'utf8'));
      } catch (e) {
        throw new Error(`não li a coleta ${args.dados}: ${e.message}`);
      }
    } else {
      dados = coletar({
        repos: args.repos.length ? args.repos : REPOS_DO_PILOTO,
        workflow: args.workflow ?? 'ci.yml',
        desde: args.desde ?? PUBLICACAO,
        tratarComoExterno: args.tratarComoExterno,
      });
      if (args.salvarDados) fs.writeFileSync(args.salvarDados, `${JSON.stringify(dados, null, 2)}\n`);
    }
    const medida = medirPiloto(dados, {
      desde: args.desde ?? dados.desde ?? PUBLICACAO,
      tratarComoExterno: args.tratarComoExterno,
      repos: args.repos,
    });
    console.log(args.json ? JSON.stringify(medida, null, 2) : relatorio(medida));
    return 0;
  } catch (e) {
    console.error(e.message);
    return 2;
  }
}

module.exports = { medirPiloto, coletar, relatorio, main, REPOS_DO_PILOTO, PUBLICACAO };

if (require.main === module) process.exitCode = main();
