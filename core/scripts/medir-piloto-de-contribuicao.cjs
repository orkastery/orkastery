#!/usr/bin/env node
/**
 * RM-050: mede o piloto do guia de contribuicao pelos dados do GitHub.
 *
 * A metrica principal do RM-050 e a fracao de PRs de fora cujo CI passa na primeira execucao
 * (meta de 80%), e o item fecha quando dois PRs de fora passarem pelo guia sem ajuda do
 * mantenedor. Este script faz as duas contas, por repositorio, desde a publicacao do guia:
 *
 *  - PR de fora: `author_association` fora de OWNER e MEMBER, de autor que nao e bot. A associacao
 *    e a de hoje: guarde a coleta de cada rodada (`--salvar-dados`) como evidencia;
 *  - os runs do PR: os do workflow de CI com evento `pull_request` criados enquanto o PR esteve
 *    aberto, na branch de origem dele e no repositorio de origem, o que cobre o commit que saiu do
 *    PR por `push --force` ou rebase. Com o fork apagado, sobra o nome da branch, entre os runs que
 *    tambem perderam a origem: o PR sai marcado para conferir e fica fora do fechamento. Limites: o intervalo em que um PR reaberto ficou
 *    fechado conta como aberto, e a branch renomeada com o PR aberto perde os runs do nome antigo;
 *  - primeira execucao: o mais antigo desses runs. `action_required` (o GitHub esperando o
 *    mantenedor liberar o PR de fork), `skipped`, `stale` e `cancelled` (todo cancelado: o push
 *    seguinte cancela o anterior quando o CI tem `cancel-in-progress`) nao sao execucao; num run
 *    reexecutado vale a primeira tentativa que rodou;
 *  - sem ajuda: nenhum commit de outra pessoa nem commit sem login do GitHub no PR. Ajuda em
 *    comentario nao vira dado: o mantenedor confere nos PRs listados.
 *
 * Lacuna nao vira zero: lista cortada pelo teto do GitHub (250 commits por PR, 1.000 runs por
 * consulta), PR de fora sem os commits, run reexecutado sem as tentativas anteriores ou medida
 * pedida antes do inicio da coleta reprovam a leitura; sem PR de fora com execucao concluida, a
 * taxa sai "sem medida".
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
/** A coleta e a medida tem esquemas distintos: a saida `--json` nao passa por coleta em `--dados`. */
const ESQUEMA_COLETA = 'ork.piloto-coleta/v1';
const ESQUEMA_MEDIDA = 'ork.piloto-medida/v1';
const ASSOCIACOES_DA_CASA = new Set(['OWNER', 'MEMBER']);
const NAO_E_EXECUCAO = new Set(['action_required', 'skipped', 'stale', 'cancelled']);
/** Tetos do GitHub: a lista de commits de um PR para em 250, e a de runs de uma consulta em 1.000. */
const TETO_DE_COMMITS = 250;
const TETO_DE_RUNS = 1000;

const USO = [
  'uso: node core/scripts/medir-piloto-de-contribuicao.cjs [--repo DONO/NOME]... [--workflow ci.yml]',
  '       [--desde AAAA-MM-DD] [--tratar-como-externo LOGIN]... [--dados ARQUIVO] [--salvar-dados ARQUIVO] [--json]',
].join('\n');

const instante = (data) => Date.parse(`${data}T00:00:00Z`);

/** Data `AAAA-MM-DD` que existe no calendario: 2026-02-31 nao vira 03/03 em silencio. */
function dataValida(data) {
  return typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data) && !Number.isNaN(instante(data)) &&
    new Date(instante(data)).toISOString().slice(0, 10) === data;
}

/** Os repositorios sem repeticao, sem diferenciar maiusculas, na grafia da primeira vez. */
function semRepetir(repos) {
  return [...new Map(repos.map((r) => [r.toLowerCase(), r])).values()];
}

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
 * O run e deste PR: evento `pull_request`, criado enquanto o PR esteve aberto (o PR reaberto como
 * outro, da mesma branch, nao herda o run do anterior) e na branch de origem dele, no repositorio de
 * origem. O SHA nao entra: ele casaria o mesmo commit noutra branch (PRs empilhados) e perderia o
 * commit que saiu por push forcado. Com o fork apagado (`head.repo` nulo), sobra a branch, e so entre
 * os runs que tambem perderam a origem: o run de um fork vivo com a mesma branch (`patch-1`) nao entra.
 */
function doPr(run, pr) {
  if (run.event !== 'pull_request') return false;
  const criado = Date.parse(run.created_at);
  if (!(criado >= Date.parse(pr.created_at))) return false;
  // `closed_at` so corta com o PR fechado: o reaberto, aberto de novo, nao perde os runs novos.
  if (pr.state === 'closed' && pr.closed_at && criado > Date.parse(pr.closed_at)) return false;
  if (!pr.head?.ref || run.head_branch !== pr.head.ref) return false;
  return (run.head_repo ?? null) === (pr.head.repo ?? null);
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

/** A primeira execucao entre os runs do PR, ou `null` quando nenhum rodou. */
function primeiraExecucao(runsDoPr, tentativas, repo) {
  const emOrdem = [...runsDoPr].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
  for (const run of emOrdem) {
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

/** A forma da coleta: esquema, janela e, em cada PR, numero e data de criacao. */
function validarColeta(dados) {
  if (!dados || dados.esquema !== ESQUEMA_COLETA) {
    throw new Error(`dados inválidos: esperado o esquema ${ESQUEMA_COLETA}, da coleta salva com --salvar-dados (a saída --json da medida não serve)`);
  }
  if (typeof dados.repos !== 'object' || dados.repos === null || Array.isArray(dados.repos)) {
    throw new Error('dados inválidos: falta o objeto repos');
  }
  if (!dataValida(dados.desde)) throw new Error(`dados inválidos: a coleta não diz desde quando (desde: ${dados.desde})`);
  const chaves = Object.keys(dados.repos).map((r) => r.toLowerCase());
  if (new Set(chaves).size !== chaves.length) throw new Error('dados inválidos: o mesmo repositório aparece duas vezes, com grafias diferentes');
  for (const [repo, d] of Object.entries(dados.repos)) {
    if (!Array.isArray(d?.prs) || (d.runs !== undefined && !Array.isArray(d.runs))) {
      throw new Error(`dados inválidos: ${repo} sem a lista de PRs ou com runs fora de lista`);
    }
    for (const pr of d.prs) {
      if (!Number.isInteger(pr?.number) || Number.isNaN(Date.parse(pr?.created_at))) {
        throw new Error(`dados inválidos: PR sem número ou sem created_at em ${repo}`);
      }
    }
  }
}

/** A medida inteira, sem rede: le a coleta (`dados`) e aplica as regras do cabecalho. */
function medirPiloto(dados, opcoes = {}) {
  validarColeta(dados);
  const desde = opcoes.desde ?? dados.desde;
  if (!dataValida(desde)) throw new Error(`--desde inválido: ${desde}`);
  if (instante(desde) < instante(dados.desde)) {
    throw new Error(`a coleta começa em ${dados.desde}: para medir desde ${desde}, colete de novo com --desde ${desde}`);
  }
  const externos = new Set(opcoes.tratarComoExterno ?? []);
  // Nome de repositorio no GitHub nao diferencia maiusculas: o mesmo repositorio nao conta duas vezes.
  const nomes = opcoes.repos?.length ? semRepetir(opcoes.repos) : Object.keys(dados.repos);
  const repos = nomes.map((pedido) => {
    const repo = Object.keys(dados.repos).find((r) => r.toLowerCase() === pedido.toLowerCase());
    if (!repo) throw new Error(`dados sem o repositório ${pedido}`);
    const d = dados.repos[repo];
    const prs = d.prs
      .filter((pr) => Date.parse(pr.created_at) >= instante(desde) && deFora(pr, externos))
      .sort((a, b) => a.number - b.number)
      .map((pr) => {
        const commits = d.commits?.[String(pr.number)];
        if (!Array.isArray(commits)) throw new Error(`dados sem os commits do PR #${pr.number} de ${repo}: colete de novo com as mesmas opções`);
        const autor = pr.user?.login ?? null;
        const runsDoPr = (d.runs ?? []).filter((r) => doPr(r, pr));
        const origemDesconhecida = !pr.head?.repo;
        const execucao = primeiraExecucao(runsDoPr, d.tentativas, repo);
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
          aguardandoLiberacao: !execucao && runsDoPr.some((r) => r.conclusion === 'action_required'),
          commits: commits.length,
          commitsDeOutraPessoa,
          commitsSemLogin,
          origemDesconhecida,
          // Sem a origem, outro fork com a mesma branch pode ter entrado: o fechamento pede a conferencia.
          contaParaFechamento: estado === 'mesclado' && execucao?.conclusao === 'success' && commitsDeOutraPessoa === 0 &&
            commitsSemLogin === 0 && !origemDesconhecida,
        };
      });
    return { repo, prs };
  });
  const todos = repos.flatMap((r) => r.prs);
  const comExecucao = todos.filter((p) => p.primeiraExecucao?.conclusao).length;
  const verdesNaPrimeira = todos.filter((p) => p.primeiraExecucao?.conclusao === 'success').length;
  const atingidos = todos.filter((p) => p.contaParaFechamento).length;
  return {
    esquema: ESQUEMA_MEDIDA,
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

const JQ_PR = '.[] | {number, html_url, state, created_at, closed_at, merged_at, author_association, ' +
  'user: (if .user then {login: .user.login, type: .user.type} else null end), head: {ref: .head.ref, repo: .head.repo.full_name}}';
const JQ_COMMIT = '.[] | {sha, author: (if .author then {login: .author.login} else null end)}';
const JQ_RUN = '.workflow_runs[] | {id, head_sha, head_branch, head_repo: .head_repository.full_name, event, status, conclusion, ' +
  'run_attempt, created_at, html_url}';

/**
 * A coleta pelo `gh api`, so do que a medida usa: todos os PRs desde a data, e commits, runs e
 * tentativas so dos PRs de fora. Os runs vem por PR, pela branch de origem, para nenhuma consulta
 * chegar perto do teto de 1.000 resultados da API.
 */
function coletar({ repos, workflow, desde, tratarComoExterno }) {
  const externos = new Set(tratarComoExterno ?? []);
  const dados = { esquema: ESQUEMA_COLETA, coletadoEm: new Date().toISOString(), workflow, desde, repos: {} };
  for (const repo of repos) {
    const prs = porLinha(gh(['--paginate', `repos/${repo}/pulls?state=all&per_page=100`, '--jq', JQ_PR]))
      .filter((pr) => Date.parse(pr.created_at) >= instante(desde));
    const commits = {};
    const runs = new Map();
    for (const pr of prs.filter((p) => deFora(p, externos))) {
      const doPrAtual = porLinha(gh(['--paginate', `repos/${repo}/pulls/${pr.number}/commits?per_page=100`, '--jq', JQ_COMMIT]));
      if (doPrAtual.length >= TETO_DE_COMMITS) {
        throw new Error(`o PR #${pr.number} de ${repo} chegou a ${doPrAtual.length} commits, o teto da API: a lista pode estar cortada, e a medida não sai com lacuna`);
      }
      commits[String(pr.number)] = doPrAtual;
      const branch = encodeURIComponent(pr.head?.ref ?? '');
      const daBranch = porLinha(gh(['--paginate',
        `repos/${repo}/actions/workflows/${workflow}/runs?event=pull_request&branch=${branch}&per_page=100&created=%3E%3D${desde}`,
        '--jq', JQ_RUN]));
      if (daBranch.length >= TETO_DE_RUNS) {
        throw new Error(`a consulta de runs do PR #${pr.number} de ${repo} chegou a ${daBranch.length}, o teto da API: a lista pode estar cortada`);
      }
      for (const run of daBranch) if (doPr(run, pr)) runs.set(run.id, run);
    }
    const tentativas = {};
    for (const run of runs.values()) {
      if ((run.run_attempt ?? 1) <= 1) continue;
      tentativas[String(run.id)] = [];
      for (let n = 1; n < run.run_attempt; n++) {
        tentativas[String(run.id)].push(JSON.parse(gh([`repos/${repo}/actions/runs/${run.id}/attempts/${n}`, '--jq', '{run_attempt, status, conclusion}'])));
      }
    }
    dados.repos[repo] = { prs, commits, runs: [...runs.values()], tentativas };
  }
  return dados;
}

/** Porcentagem truncada em uma casa: 79,5% nunca aparece como os 80% da meta. */
function porcento(x) {
  const p = Math.floor(x * 1000 + 1e-9) / 10;
  return `${Number.isInteger(p) ? p : p.toFixed(1).replace('.', ',')}%`;
}

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
      const semOrigem = p.origemDesconhecida ? ', fork apagado: runs casados só pela branch (confira)' : '';
      linhas.push(`  #${p.numero} @${p.autor ?? '?'}, ${p.estado}: ${ci}, commits de outra pessoa: ${p.commitsDeOutraPessoa}${semLogin}${semOrigem}`);
      if (e?.url) linhas.push(`      ${e.url}`);
    }
  }
  const r = m.resumo;
  const meta = `meta: ${porcento(r.meta)}`;
  const taxa = r.taxa === null
    ? `taxa sem medida, nenhuma primeira execução concluída (${meta})`
    : `taxa de ${porcento(r.taxa)} (${meta}, ${r.taxa >= r.meta ? 'atingida' : 'abaixo'})`;
  linhas.push(
    '',
    `Resumo: ${r.prsDeFora} PR(s) de fora, ${r.comExecucao} com a primeira execução do CI concluída, ${r.verdesNaPrimeira} verde(s): ${taxa}.`,
    `Fechamento: ${r.fechamento.atingidos} PR(s) de fora mesclado(s), verde(s) na primeira execução, sem commit de outra pessoa nem sem login, com o fork de origem; ` +
      `o critério pede ${r.fechamento.exigidos}${r.fechamento.fechado ? ': atingido.' : '.'}`,
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
  // O mesmo repositorio duas vezes contaria o mesmo PR duas vezes no fechamento.
  args.repos = semRepetir(args.repos);
  if (args.desde !== undefined && !dataValida(args.desde)) throw new Error(`--desde inválido: ${args.desde} (use AAAA-MM-DD, uma data que existe)`);
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
    const medida = medirPiloto(dados, { desde: args.desde, tratarComoExterno: args.tratarComoExterno, repos: args.repos });
    console.log(args.json ? JSON.stringify(medida, null, 2) : relatorio(medida));
    return 0;
  } catch (e) {
    console.error(e.message);
    return 2;
  }
}

module.exports = { medirPiloto, coletar, relatorio, porcento, main, REPOS_DO_PILOTO, PUBLICACAO, ESQUEMA_COLETA, ESQUEMA_MEDIDA };

if (require.main === module) process.exitCode = main();
