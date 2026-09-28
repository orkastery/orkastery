/**
 * Canarios da I-43: cada remocao so e dada como pronta junto do canario que prova que
 * a falha evitada pelo mecanismo removido continua evitada por outra coisa.
 *
 * Remocao sem canario nao e simplificacao, e aposta. E a razao de este arquivo existir
 * separado: o CHECK confere as cinco remocoes num lugar so, e o que cada uma perdeu
 * esta escrito ao lado do que a substitui.
 *
 * Os canarios rodam em sandbox git propria (`sandboxGit`), nunca contra o board vivo:
 * `raizDoEstado` manda o estado para a arvore principal mesmo de dentro de uma worktree
 * vinculada, entao qualquer conferencia feita "no projeto" leria as 137 threads reais
 * e viraria contagem de artefato vivo, que reprova sozinha quando a branch cresce.
 */

import type { Canario } from './canarios';
import { sandboxGit, dirTemporario } from './sandbox';
import * as fs from 'node:fs';
import { instalarAdaptador, lerRecibo, textoDaInstalacao } from './hosts';
import { novaThread, lerThread, gravarThread, dirThread, threadsDaListagem, tabelaDeThreads } from './thread';
import { tagDoModo, definicaoDoModo, parseModo, extrairTagDoPedido,
  extrairTagAposentadaDoPedido, recusaDeModoAposentado, MODOS_APOSENTADOS,
  MODOS_LEGADOS, ORDEM_DOS_MODOS, substitutosVivos, cicloCompleto } from './modos';
import { profundidadeDoModo, validarPedidoHitl, PedidoHitl } from './hitl-contract';
import { carregarManifesto } from './manifest';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { aceitarPorOmissao, indiceDaThread, lerMasterLog, tabelaDeEntregas } from './master';
import { runtimeCruzadoParaDespacho } from './phase';
import { verificar } from './verify';
import { lerClaims } from './claims';
import { DESCRICAO_DO_MOTIVO } from './gates';
import { POLITICA_DE_RETRY } from './retry';
import { commitar } from './sandbox';
import { exec } from './util';
import { ModoAposentado } from './types';

/** Um pedido `ork.hitl/v1` como os gravados antes da aposentadoria. */
function pedidoLegado(modo: ModoAposentado): PedidoHitl {
  return { contrato: 'ork.hitl/v1', id: 'pedido-legado', thread: 'ork-smokeb0', fase: 'PLAN',
    modo, alvo: { tipo: 'gate', sobre: 'plano' }, motivo: 'human.pending',
    pergunta: 'Qual e o veredito sobre o plano?',
    opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }, { numero: 2, texto: 'Revisar', acao: 'recusar' }],
    recomendacao: 'Conferir as evidencias.', criadoEm: '2026-09-02T12:00:00Z',
    prazo: '2026-09-02T13:00:00Z', acaoPadraoAoExpirar: 'esperar',
    respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: profundidadeDoModo(modo) };
}

/**
 * fx-modo-aposentado-leitor: o lado que NAO pode encolher.
 *
 * As tres threads reais em `#Look`/`#Ork` sao de 02 e 03/09 e estao fechadas, mas o
 * board continua abrindo todas elas. Se a matriz encolhesse junto com a lista de
 * escrita, `tagDoModo` devolveria `#?look` e um recibo `ork.hitl/v1` com
 * `modo: look, profundidade: profunda` deixaria de validar EM SILENCIO: o produto
 * passaria a negar o que ele mesmo emitiu e assinou.
 *
 * O canario grava uma thread em modo aposentado direto no disco da sandbox, como uma
 * thread de setembro esta gravada, e cobra que ela abra inteira.
 */
const fxModoAposentadoLeitor: Canario = {
  id: 'fx-modo-aposentado-leitor',
  sobre: 'thread e recibo gravados em modo aposentado continuam sendo lidos para sempre',
  precisaDeGit: true,
  rodar: () => {
    const s = sandboxGit('modo-aposentado-leitor');
    try {
      const tags: string[] = [];
      const pausas: number[] = [];
      let recibosValidos = 0;

      for (const morto of MODOS_APOSENTADOS) {
        // A thread nasce viva (escrever aposentado esta barrado) e e REGRAVADA em disco
        // com o modo antigo, que e exatamente o estado de `ork-smokeb0` e `ork-b4adapt`.
        const nova = novaThread(s.carregado, { nome: `legada ${morto}`, modo: 'classic' }).thread;
        const emDisco = lerThread(s.dir, nova.id);
        emDisco.modo = morto;
        emDisco.blocos = definicaoDoModo(morto).blocos;
        gravarThread(s.dir, emDisco);

        const relida = lerThread(s.dir, nova.id);
        tags.push(tagDoModo(relida.modo));
        pausas.push(relida.blocos.filter((b) => b.pausa).length);

        // O recibo assinado com esse modo continua batendo com a propria profundidade.
        try { validarPedidoHitl(pedidoLegado(morto)); recibosValidos++; } catch { /* reprova abaixo */ }
      }

      return {
        tags,
        pausas,
        recibosValidos,
        // RELACOES, nao contagens: a I-42 vai acrescentar `fast` a lista viva, e um
        // numero carimbado aqui reprovaria a irma sem nenhum defeito ter aparecido.
        todoAposentadoTemDefinicao: MODOS_APOSENTADOS.every(
          (m) => (MODOS_LEGADOS as readonly string[]).includes(m)),
        nenhumAposentadoEscrivel: MODOS_APOSENTADOS.every(
          (m) => !(ORDEM_DOS_MODOS as readonly string[]).includes(m)),
        todoVivoEhLegado: ORDEM_DOS_MODOS.every(
          (m) => (MODOS_LEGADOS as readonly string[]).includes(m)),
        // O mapa de profundidade do recibo legado esta intacto (costura da I-41).
        profundidadeDeLook: profundidadeDoModo('look'),
        profundidadeDeOrk: profundidadeDoModo('ork'),
      };
    } finally { s.limpar(); }
  },
};

/**
 * fx-modo-aposentado-escritor: o lado que precisa RECUSAR, e recusar falando.
 *
 * Ignorar em silencio e o pecado que o produto inteiro combate, e seria o pior
 * resultado desta aposentadoria: o builder escreve `#Look` no pedido e recebe uma
 * thread em `#Auto` sem saber que trocou de regime de supervisao.
 *
 * O canario cobra as tres coisas juntas: a recusa acontece, ela e TIPADA, e ela nomeia
 * um substituto que EXISTE. Toda #TAG do texto e um modo da matriz, e o substituto e
 * sempre de ciclo completo: com a I-42, o `#Fast` existe, mas nao substitui modo de
 * vigilancia maxima.
 */
const fxModoAposentadoEscritor: Canario = {
  id: 'fx-modo-aposentado-escritor',
  sobre: 'modo aposentado escrito em qualquer entrada recebe recusa tipada, nunca silencio',
  precisaDeGit: true,
  rodar: () => {
    const s = sandboxGit('modo-aposentado-escritor');
    try {
      let recusasNaCriacao = 0, recusasNoParse = 0, tagsReconhecidas = 0;
      const mensagens: string[] = [];

      for (const morto of MODOS_APOSENTADOS) {
        // 1. O portao de escrita recusa, e nao confunde aposentado com inexistente.
        if (parseModo(morto) === null) recusasNoParse++;
        try {
          novaThread(s.carregado, { nome: 'proibida', modo: morto as never });
        } catch { recusasNaCriacao++; }

        // 2. A #TAG no texto livre do pedido e RECONHECIDA, e nao cai no default.
        const pedido = `Migracao de risco #${morto} agora`;
        if (extrairTagDoPedido(pedido) === null && extrairTagAposentadaDoPedido(pedido) === morto) {
          tagsReconhecidas++;
        }
        mensagens.push(recusaDeModoAposentado(morto));
      }

      const substitutos = substitutosVivos();
      const texto = mensagens.join(' | ');
      return {
        recusasNoParse,
        recusasNaCriacao,
        tagsReconhecidas,
        // Toda mensagem e tipada e nomeia o modo pedido.
        todasTipadas: mensagens.every((m) => m.startsWith('modo.aposentado:')),
        nomeiaOModoPedido: mensagens.every((m, i) => m.includes(`#${MODOS_APOSENTADOS[i][0].toUpperCase()}${MODOS_APOSENTADOS[i].slice(1)}`)),
        // E todo substituto oferecido e um modo que EXISTE hoje.
        substitutosVivos: substitutos.every((tag) => ORDEM_DOS_MODOS.some((m) => tagDoModo(m) === tag)),
        // `#Maestro` nao e substituto: ele e o modo de gate, de outra natureza.
        semMaestroNaOferta: !texto.includes('#Maestro'),
        // Nenhum modo inexistente e prometido: toda #TAG do texto e um modo da matriz.
        semModoInexistente: (texto.match(/#[A-Za-z]+/g) ?? []).every((tag) =>
          MODOS_LEGADOS.some((m) => tagDoModo(m) === tag)),
        // I-42: o substituto de um modo de vigilancia maxima e de ciclo completo; o #Fast nao entra.
        semCicloParcialNaOferta: substitutos.length > 0 && ORDEM_DOS_MODOS.every((m) =>
          cicloCompleto(m) || !substitutos.includes(tagDoModo(m))),
        // O manifesto do proprio sandbox nasce so com os vivos. Relacao, nao numero:
        // quando a I-42 acrescentar `fast`, isto continua verdadeiro sozinho.
        initSoComVivos: (carregarManifesto(s.dir)?.manifesto.conduction.allowed_modes ?? [])
          .every((m) => (ORDEM_DOS_MODOS as readonly string[]).includes(m)),
        initTemTodosOsVivos: ORDEM_DOS_MODOS.every((m) =>
          (carregarManifesto(s.dir)?.manifesto.conduction.allowed_modes ?? []).includes(m)),
      };
    } finally { s.limpar(); }
  },
};

/**
 * fx-listagem-abertas: o default para de mostrar o que ninguem pediu para ver.
 *
 * O custo medido era o DEFAULT, nao a falta de flag: `ork thread list` imprimia 137
 * linhas para as 31 que interessavam, e 71 delas (52 por cento) eram threads
 * `Sessao adotada claude-bg <uuid>`, lixo do mecanismo de adocao de 07 a 14/09. Quem
 * pagava era quem nao sabia que existia flag, porque flag nenhuma existia.
 *
 * O canario roda em SANDBOX e nunca contra o board vivo, e isso nao e detalhe: M8 do
 * PLAN mediu que `ork thread list` rodado DENTRO desta worktree lista as 137 threads
 * da arvore principal, porque `raizDoEstado` resolve o estado pelo `git-common-dir`.
 * Conferir "no projeto" seria comparar 137 com 10 e afirmar contagem de artefato vivo,
 * que reprova sozinha quando a branch cresce. Aqui as contagens sao 1 e 2, fixadas
 * pelo proprio canario.
 *
 * A thread PAUSADA e a razao de o default ser "nao fechadas" e nao "so abertas", que
 * era o texto do GOAL: esconder a pausada seria esconder a que mais pede atencao.
 */
const fxListagemAbertas: Canario = {
  id: 'fx-listagem-abertas',
  sobre: 'o default de ork thread list mostra o que ainda pede atencao, e --todas abre o resto',
  precisaDeGit: true,
  rodar: () => {
    const s = sandboxGit('listagem-abertas');
    try {
      const aberta = novaThread(s.carregado, { nome: 'aberta', modo: 'classic' }).thread;
      const pausada = novaThread(s.carregado, { nome: 'pausada', modo: 'classic' }).thread;
      const fechada = novaThread(s.carregado, { nome: 'fechada', modo: 'classic' }).thread;

      const p = lerThread(s.dir, pausada.id); p.status = 'pausada'; gravarThread(s.dir, p);
      const f = lerThread(s.dir, fechada.id); f.status = 'fechada'; gravarThread(s.dir, f);

      const padrao = threadsDaListagem(s.dir);
      const todas = threadsDaListagem(s.dir, { todas: true });
      const texto = tabelaDeThreads(s.dir);

      return {
        // O default traz a aberta E a pausada, e deixa a fechada de fora.
        noDefault: padrao.map((l) => l.status).sort(),
        defaultTemAAberta: padrao.some((l) => l.id === aberta.id),
        defaultTemAPausada: padrao.some((l) => l.id === pausada.id),
        defaultEscondeAFechada: !padrao.some((l) => l.id === fechada.id),
        // `--todas` traz as tres.
        comTodas: todas.length,
        todasTemAFechada: todas.some((l) => l.id === fechada.id),
        // A soma bate: default + fechadas = tudo. Sem afirmar numero de artefato vivo,
        // porque as tres threads sao criadas por este canario.
        somaBate: padrao.length + todas.filter((l) => l.status === 'fechada').length === todas.length,
        // E o texto avisa que escondeu algo, em vez de esconder em silencio.
        avisaQueEscondeu: texto.includes('fechada(s) omitida(s)'),
      };
    } finally { s.limpar(); }
  },
};

/**
 * fx-indice-reversao: a entrega revertida se rebaixa SOZINHA, pelo caminho que o
 * produto percorre de verdade.
 *
 * E o canario que libera a saida da fila de ratificacao de score, e ele prova a
 * propriedade exata que a fila nao entregava: a fila tinha 13 entradas esperando nota
 * humana justamente porque lembrete nao converte em nota, e nenhuma delas dizia se a
 * entrega tinha sido desfeita depois.
 *
 * ELE NAO CHAMA A DETECCAO A MAO, e essa e a mudanca do GO-FIX 1. Na primeira versao
 * ele chamava `registrarReversaoDaEntrega` direto, que era justamente o passo que no
 * produto ninguem executava: o unico chamador era o COMECO de um `ork ship` seguinte
 * da mesma thread, e depois do MASTER nao ha ship seguinte. O canario ficava verde com
 * a propriedade quebrada, e o CHECK provou com `git revert` real que o produto gravava
 * score 5 e a justificativa "sem reversao" numa entrega desfeita.
 *
 * Agora o que roda aqui e o que `ork master` roda: `tabelaDeEntregas` (o que o dono le)
 * e `aceitarPorOmissao` (o que `--aceitar-omissao` faz). A reversao tem de alcancar o
 * texto, o indice, o `score` gravado e o MASTER log sem ninguem chamar nada a mao.
 *
 * O caminho exercitado, do comeco ao fim:
 *   1. a thread entrega, e `ship_done` grava o `mergeSha` e o destino;
 *   2. alguem faz `git revert` na base, como faria de verdade;
 *   3. o dono roda `ork master`, e a tabela ja mostra a reversao em vez de "sem tropeco";
 *   4. a aceitacao por omissao grava score 2, e a justificativa NAO diz "sem reversao".
 *
 * A deteccao ancora em "This reverts commit <sha>" e nao em diff de arvore: um arquivo
 * que voltou ao estado anterior pode ser trabalho de outra thread, e chamar isso de
 * reversao rebaixaria entrega alheia por coincidencia.
 *
 * Tambem se prova a IDEMPOTENCIA: o caminho roda em todo `ork master`, entao rodar de
 * novo nao pode rebaixar duas vezes. Sem isso, consultar a tabela afundaria a nota.
 */
const fxIndiceReversao: Canario = {
  id: 'fx-indice-reversao',
  sobre: 'entrega revertida depois do ship se rebaixa sozinha no caminho real do ork master, sem ninguem pontuar',
  precisaDeGit: true,
  rodar: () => {
    const s = sandboxGit('indice-reversao');
    try {
      const t = novaThread(s.carregado, { nome: 'entrega', modo: 'auto' }).thread;
      const dir = dirThread(s.dir, t.id);

      // Antes de qualquer tropeco, a entrega vale o teto: entregue e aceito.
      const antesDeTudo = indiceDaThread(s.dir, t.id).valor;

      // 1. A entrega acontece de verdade no git da sandbox.
      const merge = commitar(s.dir, 'entrega.md', '# entrega da thread\n', 'feat: entrega');
      registrar(dir, t.id, 'ship_done', { fase: 'SHIP', de: 'ork/entrega', para: 'main',
        mergeSha: merge, pushVerificado: true });
      // Com git presente e nenhuma reversao, o caminho do produto nao inventa tropeco.
      const depoisDoShip = indiceDaThread(s.dir, t.id).valor;

      // 2. O dono reverte na base, como reverteria de verdade.
      exec('git', ['revert', '--no-edit', merge], s.dir);

      // 3. O dono roda `ork master`. NINGUEM chamou a deteccao: quem a chama e o produto.
      const tabela = tabelaDeEntregas(s.dir);
      const depoisDaReversao = indiceDaThread(s.dir, t.id).valor;

      // 4. E a aceitacao por omissao, que e o que carimbava 5 em coisa revertida.
      const aceite = aceitarPorOmissao(s.dir, t.id);
      const gravado = lerThread(s.dir, t.id).score;
      const masterLog = lerMasterLog(s.dir, t.id);

      // 5. De novo: o caminho roda em toda consulta, e nao pode rebaixar duas vezes.
      tabelaDeEntregas(s.dir);
      const depoisDeRepetir = indiceDaThread(s.dir, t.id).valor;
      const rollbacks = lerLedger(dir).filter((e) => e.tipo === 'rollback_done').length;

      return {
        antesDeTudo,
        depoisDoShip,
        // O texto que o dono le: a reversao aparece, e "sem tropeco" some.
        depoisDaReversao,
        tabelaMostraAReversao: tabela.includes('rollback_done x1'),
        tabelaDizSemTropeco: tabela.includes('sem tropeco'),
        // O indice e o score que o MASTER consome.
        indiceDoAceite: aceite.indice.valor,
        scoreGravado: gravado?.valor ?? null,
        regimeGravado: gravado?.regime ?? null,
        masterLogScore: masterLog?.score ?? null,
        // A justificativa gravada dizia "sem reversao" sobre uma entrega desfeita.
        justificativaDizSemReversao: (gravado?.justificativa ?? '').includes('sem reversao'),
        justificativaCitaAReversao: (gravado?.justificativa ?? '').includes('rollback_done'),
        // Ninguem HUMANO pontuou: quem decidiu foi o nucleo, e isso fica legivel.
        avaliadoPor: gravado?.avaliadoPor ?? null,
        depoisDeRepetir,
        rollbacks,
        // O evento e do catalogo do nucleo, nao string livre.
        eventoNoCatalogo: TIPOS_DE_EVENTO.rollbackConcluido === 'rollback_done',
      };
    } finally { s.limpar(); }
  },
};

/**
 * fx-check-runtime-cruzado: quem valida nao pode ser quem executou.
 *
 * Esta e a VIGA (a) do Objective Envelope, a unica regra do produto que dizia isso, e
 * ela estava presa dentro de um mecanismo que nunca rodou: valia na criacao do
 * envelope, para tres threads com zero sessoes, e `validationRuntimes` nao aparecia em
 * nenhum arquivo alem de `objective.ts` e `index.ts`.
 *
 * O regime que ela combate esta medido: das 137 threads, 16 registram sessoes de GO e
 * de CHECK, e em 11 delas o CHECK rodou apenas em runtime que o GO tambem usou. As
 * quatro threads mais recentes sao todas `claude-bg` conferindo `claude-bg`.
 *
 * O canario prova os TRES lados, porque so o positivo nao provaria nada:
 *   - a thread que EXIGE recusa o CHECK no runtime do GO, com motivo tipado;
 *   - a mesma thread ACEITA o CHECK em outro runtime;
 *   - a thread que NAO exige despacha normalmente, entao a regra nao vazou para quem
 *     nao pediu por ela.
 */
const fxCheckRuntimeCruzado: Canario = {
  id: 'fx-check-runtime-cruzado',
  sobre: 'thread que exige validacao cruzada recusa o CHECK no mesmo runtime que entregou',
  precisaDeGit: true,
  rodar: () => {
    const s = sandboxGit('check-runtime-cruzado');
    try {
      /** Uma thread com uma sessao de GO ja registrada no runtime informado. */
      const comGoEm = (nome: string, runtime: string, exige: boolean) => {
        const t = novaThread(s.carregado, { nome, modo: 'auto', exigeRuntimeDiferente: exige }).thread;
        const emDisco = lerThread(s.dir, t.id);
        emDisco.faseAtual = 'CHECK';
        emDisco.sessoes.push({ sessionId: `11111111-2222-3333-4444-${nome.padEnd(12, '0').slice(0, 12)}`,
          slug: emDisco.slug, fase: 'GO', bloco: 'GO', runtime, despachadaEm: '2026-09-20T12:00:00.000Z',
          promptPath: '', promptSha256: '', verificada: true });
        gravarThread(s.dir, emDisco);
        return lerThread(s.dir, emDisco.id);
      };

      const exigente = comGoEm('exigente', 'claude-bg', true);
      const solta = comGoEm('solta', 'claude-bg', false);

      const mesmoRuntime = runtimeCruzadoParaDespacho(exigente, 'CHECK', 'claude-bg');
      const outroRuntime = runtimeCruzadoParaDespacho(exigente, 'CHECK', 'codex');
      const semExigencia = runtimeCruzadoParaDespacho(solta, 'CHECK', 'claude-bg');
      // A regra vale no CHECK e so no CHECK: ela e sobre VALIDACAO.
      const noGo = runtimeCruzadoParaDespacho(exigente, 'GO', 'claude-bg');

      return {
        recusaMesmoRuntime: mesmoRuntime !== null,
        // A recusa DIZ o que esta errado e o que destrava, com motivo tipado.
        recusaTipada: (mesmoRuntime ?? '').startsWith('runtime.autoconferencia:'),
        recusaNomeiaORuntimeDoGo: (mesmoRuntime ?? '').includes('claude-bg'),
        recusaDizOQueDestrava: (mesmoRuntime ?? '').includes('outro runtime'),
        aceitaOutroRuntime: outroRuntime === null,
        semExigenciaDespacha: semExigencia === null,
        naoVazaParaOGo: noGo === null,
        // O motivo esta no catalogo e tem politica de retry declarada.
        motivoNoCatalogo: DESCRICAO_DO_MOTIVO['runtime.autoconferencia'] !== undefined,
        semRetryAutomatico: POLITICA_DE_RETRY['runtime.autoconferencia'].automatica === false,
        escalaParaHumano: POLITICA_DE_RETRY['runtime.autoconferencia'].acao === 'escalar-humano',
      };
    } finally { s.limpar(); }
  },
};

/**
 * fx-donewhen-executavel: criterio de pronto que FALHA reprova, e o veredito o nomeia.
 *
 * Esta e a VIGA (b) do Objective Envelope, e salva-la nao foi mover codigo: foi criar
 * capacidade. Dentro do envelope, `doneWhen` era PROSA. `objective.ts:205` despejava
 * os itens como lista no `SPEC.md` e NENHUM codigo os executava; os criterios do
 * envelope real eram frases do tipo "D1: ork phase run recusa o despacho quando o
 * objective da thread nao esta approved, com teste que cobre a recusa". Bonito, e
 * impossivel de reprovar.
 *
 * O canario prova as duas metades, porque criterio que so passa nao prova nada:
 *   - o criterio que o comando SUSTENTA passa e a thread verifica;
 *   - o criterio que o comando NAO sustenta reprova, e o veredito diz QUAL criterio
 *     falhou, pela alegacao que a claim carrega.
 *
 * E prova a IDEMPOTENCIA: `ork verify` roda em toda fase, e uma claim por criterio
 * por rodada transformaria a lista num acumulador em vez de uma verificacao.
 */
const fxDoneWhenExecutavel: Canario = {
  id: 'fx-donewhen-executavel',
  sobre: 'criterio de pronto executavel reprova quando o comando falha, e o veredito o nomeia',
  precisaDeGit: true,
  rodar: () => {
    const s = sandboxGit('donewhen-executavel');
    try {
      const t = novaThread(s.carregado, { nome: 'com criterio', modo: 'auto', doneWhen: [
        { criterio: 'o README do projeto existe', comando: 'test -f README.md' },
        { criterio: 'o arquivo prometido pela entrega existe', comando: 'test -f ENTREGA-QUE-NAO-EXISTE.md' },
      ] }).thread;

      // O verify roda os criterios como claims do nucleo, pela maquina que ja existe.
      const antes = verificar(s.carregado, t.id, { soClaims: true });
      const claims = lerClaims(s.dir, t.id);
      const doNucleo = claims.filter((c) => c.origem === 'nucleo.doneWhen');
      const reprovada = antes.claims.find((c) => !c.verificado);

      // Idempotente: verificar de novo nao cria claim nova.
      verificar(s.carregado, t.id, { soClaims: true });
      const depoisDeRepetir = lerClaims(s.dir, t.id).filter((c) => c.origem === 'nucleo.doneWhen').length;

      // A metade que passa: o criterio sustentado pelo comando verifica.
      const passou = antes.claims.find((c) => c.claim.alegacao.includes('README do projeto existe'));

      return {
        criteriosViraramClaim: doNucleo.length,
        naoDuplicaAoRepetir: depoisDeRepetir === doNucleo.length,
        // A thread REPROVA quando um criterio nao se sustenta.
        verifyReprovou: antes.ok === false,
        motivoTipado: antes.motivos.includes('claims.failed'),
        // E o veredito NOMEIA o criterio, porque a claim carrega o texto dele.
        vereditoNomeiaOCriterio: (reprovada?.claim.alegacao ?? '').includes('o arquivo prometido pela entrega existe'),
        // A metade que passa continua passando: a regra nao reprova por reprovar.
        criterioSustentadoPassa: passou?.verificado === true,
        // A claim do nucleo e distinguivel de auto-relato de agente.
        marcadaComoDoNucleo: doNucleo.every((c) => c.origem === 'nucleo.doneWhen'),
      };
    } finally { s.limpar(); }
  },
};

/**
 * fx-adapter-editado-detectado: a copia editada a mao continua sendo PEGA.
 *
 * R1 do GOAL chama esta de a remocao com maior risco, e pelo motivo certo: a cerimonia
 * de instalacao e o unico mecanismo que pega uma copia instalada editada a mao, e
 * nenhum teste da suite alcanca isso, porque a suite roda sobre o CATALOGO e nao sobre
 * a copia. Trocar uma recusa barulhenta por nada seria trocar investigacao de
 * madrugada por defeito que ninguem ve.
 *
 * O que muda e o que BARRA, nao o que DETECTA. O canario cobra os dois lados:
 *   - a copia editada e detectada, NOMEADA, e classificada como `copia-editada`;
 *   - a divergencia segura (`catalogo-andou`) resolve sozinha e nao vira decisao;
 *   - a saida traz o `diff` do arquivo e um caminho de UM comando, com o `--dir` em
 *     uso repetido. A linha antiga mandava rodar `--force` SEM o `--dir`, e rodar o
 *     que estava na tela instalaria no lugar errado.
 */
const fxAdapterEditadoDetectado: Canario = {
  id: 'fx-adapter-editado-detectado',
  sobre: 'copia de adapter editada fora do catalogo continua detectada e nomeada, com saida de um comando',
  precisaDeGit: false,
  rodar: (ctx) => {
    const destino = dirTemporario('adapter-editado');
    try {
      const comum = { projeto: destino, dir: '.', catalogo: ctx.catalogo, versao: '0.0.0-canario' } as const;

      // 1. Instalacao limpa: nasce o recibo com o sha de cada arquivo.
      const primeira = instalarAdaptador('hermes', comum);
      const recibo = lerRecibo(destino);

      // 2. Reinstalar sem mexer em nada nao acusa divergencia nenhuma.
      const semMexer = instalarAdaptador('hermes', { ...comum, dryRun: true });

      // 3. Alguem edita a COPIA instalada, que e o defeito que a suite nao alcanca.
      const alvo = primeira.arquivos.find((a) => a.relativo.endsWith('README.md'))!;
      fs.writeFileSync(alvo.destino, fs.readFileSync(alvo.destino, 'utf8') + '\n<!-- editado a mao -->\n');

      const depois = instalarAdaptador('hermes', { ...comum, dryRun: true });
      const achado = depois.conflitos.find((a) => a.relativo === alvo.relativo);
      const texto = textoDaInstalacao(depois);

      // 4. E a resolucao e de UM comando, por arquivo.
      const resolvido = instalarAdaptador('hermes', {
        ...comum, dryRun: true, aceitarCatalogo: [alvo.relativo],
      });

      return {
        // A instalacao limpa nao inventa divergencia.
        semDivergenciaAoInstalar: primeira.conflitos.length === 0,
        reciboGravado: (recibo?.arquivos.length ?? 0) > 0,
        reinstalarNaoAcusa: semMexer.conflitos.length === 0 && semMexer.ok,
        // A copia editada e DETECTADA, NOMEADA e CLASSIFICADA.
        detectouAEdicao: achado !== undefined,
        nomeiaOArquivo: texto.includes(alvo.relativo),
        classificouComoCopiaEditada: achado?.divergencia === 'copia-editada',
        // E ela BARRA, porque `copia-editada` e justamente o que nao se resolve sozinho.
        barrouSemDecisao: depois.ok === false,
        // A saida traz o diff e o caminho de um comando, com o --dir em uso.
        temDiffNaSaida: texto.includes('$ diff -u'),
        temUmComando: texto.includes('--aceitar-catalogo') && texto.includes('--manter-copia'),
        naoOfereceForce: !texto.includes('--force'),
        // Decidido o arquivo, o comando deixa de barrar.
        umComandoResolve: resolvido.ok === true,
      };
    } finally { fs.rmSync(destino, { recursive: true, force: true }); }
  },
};

export const CANARIOS_I43: readonly Canario[] = [
  fxModoAposentadoLeitor,
  fxModoAposentadoEscritor,
  fxListagemAbertas,
  fxIndiceReversao,
  fxCheckRuntimeCruzado,
  fxDoneWhenExecutavel,
  fxAdapterEditadoDetectado,
];
