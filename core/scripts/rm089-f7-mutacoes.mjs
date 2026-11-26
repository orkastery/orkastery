import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPILADO = path.join(RAIZ, 'dist-test');
const GH = 'test/rm089-f7-github-gate.test.js';
const GLF = 'test/rm089-f7-gitlab-free-gate.test.js';
const GLP = 'test/rm089-f7-gitlab-paid-gate.test.js';
const SERVICO = 'test/rm089-f7-servico-fabrica.test.js';
const RESULTADO = 'test/rm089-f7-resultado-fabrica.test.js';
const NIVEIS = 'test/rm089-f7-niveis-gate.test.js';
const SHIP = 'test/rm089-f7-ship-fabrica.test.js';

const A = (alvo, de, para) => ({ alvo: `src/${alvo}.js`, de, para });
const M = (id, rotulo, alteracoes, focais) => ({ id, rotulo, alteracoes, focais });
const matriz = [
  M('MF1', 'Aceitar App diferente no GitHub', [A('ci-fabrica-github', 'c.appId === app', '(c.appId === app || c.appId === 7)')], [GH]),
  M('MF2', 'Aceitar app_id nulo', [A('ci-fabrica-github', 'c.appId === app', '(c.appId === app || c.appId === null)')], [GH]),
  M('MF3', 'Aceitar app_id igual a -1', [A('ci-fabrica-github', 'c.appId === app', '(c.appId === app || c.appId === -1)')], [GH]),
  M('MF4', 'Promover commit status GitLab a autoridade', [A('ci-fabrica-gitlab', 'e.divergencia !== 0', "(e.divergencia !== 0 && e.statusDoCommit !== 'success')")], [GLF]),
  M('MF5', 'Promover external status check a autoridade', [A('ci-fabrica-gitlab', 'e.divergencia !== 0', "(e.divergencia !== 0 && e.statusExterno !== 'passed')")], [GLP]),
  M('MF6', 'Usar campos do evento sem releitura', [A('ci-fabrica-servico', 'registros = portas.reler();', 'registros = { ...portas.reler(), head: evento.headInformado ?? portas.reler().head };')], [SERVICO]),
  M('MF7', 'Assinar a partir do check-run do CI', [A('ci-fabrica-servico', 'const resultado = portas.emitirResultado(conferido.prova);', 'const resultado = portas.emitirResultado({ ...conferido.prova, head: conferido.prova.check.shaRevisado });')], [SERVICO]),
  M('MF8', 'Ler nível do checkout do PR', [A('ci-fabrica-servico', 'nivel = registros.nivelDoDestino;', "nivel = registros.configuracaoDoCheckout ? 'observar' : registros.nivelDoDestino;")], [SERVICO]),
  M('MF9', 'Aceitar fork', [A('ci-fabrica-resultado', '|| esperado.fork === true ||', '|| false ||')], [RESULTADO]),
  M('MF10', 'Aceitar resultado de outro HEAD', [
    A('ci-fabrica-resultado', 'p.head !== esperado.head', 'false'),
    A('ci-fabrica-resultado', 'p.commitAvaliado !== esperado.head', 'false'),
  ], [RESULTADO]),
  M('MF11', 'Aceitar resultado vencido', [A('ci-fabrica-resultado', 'Date.parse(agora) >= Date.parse(p.validoAte)', 'false')], [RESULTADO]),
  M('MF12', 'Ignorar relógio validado', [A('ci-fabrica-resultado', 'Date.parse(agora) < Date.parse(p.emitidoEm)', 'false')], [RESULTADO]),
  M('MF13', 'Ignorar assinatura do webhook', [A('ci-fabrica-servico', '!evento.assinaturaValida', 'false')], [SERVICO]),
  M('MF14', 'Ignorar janela do webhook', [A('ci-fabrica-servico', 'recebido - emitido > janelaMs', 'false')], [SERVICO]),
  M('MF15', 'Bloquear reentrega legítima idêntica', [A('ci-fabrica-servico', 'return existente;', "throw new Error('reentrega bloqueada');")], [SERVICO]),
  M('MF16', 'Processar evento antigo depois de push novo', [A('ci-fabrica-servico', '(Number.isFinite(ultimo) && emitido <= ultimo)', 'false')], [SERVICO]),
  M('MF17', 'Liberar exigir com fábrica indisponível', [A('ci-fabrica-servico', "estado: nivel === 'exigir' ? 'bloqueado' : 'diagnostico'", "estado: 'diagnostico'")], [NIVEIS]),
  M('MF18', 'Publicar neutral no nome decisório', [A('ci-fabrica-github', "decisorio ? 'success' : 'neutral'", "'neutral'")], [GH]),
  M('MF19', 'Publicar skipped no nome decisório', [A('ci-fabrica-github', "decisorio ? 'success' : 'neutral'", "'skipped'")], [GH]),
  M('MF20', 'Publicar antes de persistir', [A('ci-fabrica-servico', 'portas.persistir(decisao);\n    portas.publicar(decisao);', 'portas.publicar(decisao);\n    portas.persistir(decisao);')], [SERVICO]),
  M('MF21', 'Mesclar sem sha', [A('forja/gitlab/pedidos', 'corpo: { sha: head }', 'corpo: {}')], [GLF]),
  M('MF22', 'Mesclar com SHA do evento', [A('ci-fabrica-gitlab', 'e.projeto, e.iid, e.headRelido', 'e.projeto, e.iid, e.head')], [GLF]),
  M('MF23', 'Aceitar push entre decisão e merge', [A('ci-fabrica-gitlab', 'e.destinoNaPrimeiraLeitura !== e.destinoAntesDoEfeito', 'false')], [GLF]),
  M('MF24', 'Ignorar mudança de proteção antes do efeito', [A('ci-fabrica-servico', 'else if (portas.revalidarAntesDoEfeito && !portas.revalidarAntesDoEfeito(conferido.prova))', 'else if (false)')], [SERVICO]),
  M('MF25', 'Ignorar mudança das configurações de aprovação', [A('ci-fabrica-gitlab', 'const configuracaoValida = e.configuracaoCompleta &&', 'const configuracaoValida = true &&')], [GLP]),
  M('MF26', 'Aceitar regra de aprovação editável no MR', [A('ci-fabrica-gitlab', '!e.regraDeAprovacaoEditavelNoMr', 'true')], [GLP]),
  M('MF27', 'Tratar aprovação como vínculo ao SHA após rebase', [A('ci-fabrica-gitlab', 'e.baseDeMerge !== e.commitDoVerify', 'false')], [GLP]),
  M('MF28', 'Reusar verde depois de troca de base', [A('ci-fabrica-github', 'entrada.baseDoPedido !== entrada.destino', 'false')], [GH]),
  M('MF29', 'Reusar verde em outro destino com o mesmo HEAD', [A('ci-fabrica-github', '(0, exports.nomeDecisorioGithub)(entrada.destino)', "(0, exports.nomeDecisorioGithub)('main')")], [GH]),
  M('MF30', 'Aceitar merge queue sem decisão do merge_group', [A('ci-fabrica-github', "entrada.evento === 'merge_group'", 'false')], [GH]),
  M('MF31', 'Aceitar merge train sem decisão do SHA temporário', [A('ci-fabrica-gitlab', '!e.mergeTrainAtivo', 'true')], [GLP]),
  M('MF32', 'Aceitar exceção de outro projeto', [A('ci-fabrica-resultado', 'excecao.projeto === prova.projeto', 'true')], [RESULTADO]),
  M('MF33', 'Aceitar exceção de outra origem', [A('ci-fabrica-resultado', 'excecao.origem === prova.origem', 'true')], [RESULTADO]),
  M('MF34', 'Aceitar exceção de outro destino', [A('ci-fabrica-resultado', 'excecao.destino === prova.destino', 'true')], [RESULTADO]),
  M('MF35', 'Aceitar exceção de outro HEAD', [A('ci-fabrica-resultado', 'excecao.head === prova.head', 'true')], [RESULTADO]),
  M('MF36', 'Ignorar troca do App esperado', [A('ci-fabrica-github', 'c.appId === app', 'c.appId !== null && c.appId !== -1')], [GH]),
  M('MF37', 'Ignorar rotação da credencial da fábrica', [A('ci-fabrica-registros', 'entrada.identidadeRelidaDaFabrica !== identidade', 'false')], [SERVICO]),
  M('MF38', 'Ignorar ruleset ativo', [A('ci-fabrica-github', 'r.ativo && r.exclusoes.length', 'true && r.exclusoes.length')], [GH]),
  M('MF39', 'Publicar no HEAD quando a forja exige commit de teste', [A('ci-fabrica-github', 'entrada.commitDaPublicacao !== entrada.head', 'false')], [GH]),
  M('MF40', 'Aceitar CHECK do mesmo principal nativo do construtor', [A('ci-fabrica-registros', '!construtores.includes(c.sessionId)', 'true')], [SERVICO]),
  M('MF41', 'Aceitar verify vermelho', [A('ci-fabrica-registros', '!ultimoVerify.verde', 'false')], [SERVICO]),
  M('MF42', 'Aceitar verify de outro HEAD', [A('ci-fabrica-registros', 'c.shaRevisado === ultimoVerify.commit', 'true')], [SERVICO]),
  M('MF43', 'Aceitar chave de prova do artefato divergente', [A('ci-fabrica-registros', 'entrada.chaveDeProvaDoArtefato !== ultimoVerify.chaveDeProva', 'false')], [SERVICO]),
  M('MF44', 'Aceitar tag de outra condução', [A('ci-fabrica-registros', 't.conducaoId === check.conducaoId', 'true')], [SERVICO]),
  M('MF45', 'Ler ci.fabrica do checkout do PR', [A('ci-fabrica-registros', 'entrada.configuracaoDoDestino.github_app_id', 'entrada.configuracaoDoCheckout?.github_app_id')], [SERVICO]),
  M('MF46', 'Deixar ork ship aceitar sinal positivo da CI em exigir', [A('ship', 'if (!e.resultado?.valido || e.resultado.destino !== e.destino || e.resultado.head !== e.head) {', "if ((0, produtor_1.sinalDaCiParaFabrica)(e.ci.state) === 'positivo-sem-autorizacao') return { ok: true, acao: 'mesclar-github' };\n    if (!e.resultado?.valido || e.resultado.destino !== e.destino || e.resultado.head !== e.head) {")], [SHIP]),
  M('MF47', 'Aceitar regra por padrão que exige nome de outro destino', [A('ci-fabrica-github', 'p.padrao === destino', 'true')], [GH]),
  M('MF48', 'Aceitar nomes de destino que colidem sem caixa', [A('ci-fabrica-github', '&& existente !== nome', '&& false')], [GH]),
  M('MF49', 'Aceitar exceção F6 de outra operation', [A('ci-fabrica-resultado', "excecao.operation === 'ci.run'", 'true')], [RESULTADO]),
  M('MF50', 'Ignorar Maintainer herdado ou convidado', [A('ci-fabrica-gitlab', 'const adicionais = e.membrosCompletos ? e.membros.filter((m) => m.nivel === 40 && m.id !== e.contaDaFabrica) : [];', 'const adicionais = [];')], [GLF]),
  M('MF51', 'Aceitar CHECK gravado antes do último commit de produto', [A('ci-fabrica-registros', 'c.posicao > posicaoDoUltimoProduto', 'true')], [SERVICO]),
  M('MF52', 'Aceitar destino sem atualização estrita', [
    A('ci-fabrica-github', "(entrada.relacaoComDestino !== 'ahead' && entrada.relacaoComDestino !== 'identical')", 'false'),
    A('ci-fabrica-gitlab', 'e.divergencia !== 0', 'false'),
  ], [GH, GLF]),
  M('MF53', 'Aceitar commit de produto sem registro da thread', [
    A('ci-fabrica-registros', 'if (semRegistro)', 'if (false)'),
    A('ci-fabrica-registros', 'const dosProdutos = produtos.flatMap((commit) => registros.get(commit.sha));',
      'const dosProdutos = produtos.flatMap((commit) => registros.get(commit.sha) ?? []).filter(Boolean);'),
  ], [SERVICO]),
  M('MF54', 'Aceitar verify verde anterior a um vermelho', [A('ci-fabrica-registros', '.at(-1);', '.find((v) => v.verde);')], [SERVICO]),
  M('MF55', 'Aceitar verify ancestral seguido por mudança de produto', [A('ci-fabrica-registros', '!soBundle(entrada.comparacao.arquivosDesdeVerify)', 'false')], [SERVICO]),
  M('MF56', 'Aceitar verify em commit fora da cadeia do HEAD do PR', [A('ci-fabrica-registros', "entrada.comparacao.relacao !== 'ahead' && entrada.comparacao.relacao !== 'identical'", 'false')], [SERVICO]),
  M('MF57', 'Aceitar lista de arquivos truncada', [
    A('ci-fabrica-github', '!entrada.listaCompleta', 'false'),
    A('ci-fabrica-gitlab', '!e.comparacaoCompleta', 'false'),
  ], [GH, GLF]),
  M('MF58', 'Aceitar CHECK sem vínculo nativo completo', [A('ci-fabrica-registros', 'c.despachoRegistrado && c.despachoVerificado', 'true && true')], [SERVICO]),
];

assert.equal(matriz.length, 58, 'a lane precisa ter uma linha por ID do PLAN');
assert.equal(new Set(matriz.map((m) => m.id)).size, matriz.length, 'ID de mutante repetido');

function ligarArvore(origem, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const entrada of fs.readdirSync(origem, { withFileTypes: true })) {
    const de = path.join(origem, entrada.name), para = path.join(destino, entrada.name);
    if (entrada.isDirectory()) ligarArvore(de, para);
    else fs.linkSync(de, para);
  }
}

function executarFocal(raiz, arquivo) {
  const env = { ...process.env, NODE_PATH: path.join(RAIZ, 'node_modules') };
  delete env.NODE_TEST_CONTEXT;
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-mutacao-relatorio-'));
  const relatorio = path.join(temporario, 'tap.txt');
  try {
    const r = spawnSync(process.execPath, ['--test', '--experimental-test-isolation=none', '--test-reporter=tap',
      `--test-reporter-destination=${relatorio}`, path.join(raiz, arquivo)], { cwd: raiz, env, encoding: 'utf8' });
    const saida = fs.readFileSync(relatorio, 'utf8');
    return { ...r, stdout: `${r.stdout}${saida}` };
  } finally {
    fs.rmSync(temporario, { recursive: true, force: true });
  }
}

for (const arquivo of [...new Set(matriz.flatMap((m) => m.focais))]) {
  test(`[base] ${arquivo}`, () => {
    const r = executarFocal(COMPILADO, arquivo);
    assert.equal(r.status, 0, r.stderr || r.stdout || 'mutante.invalido');
  });
}

for (const mutante of matriz) {
  test(`[${mutante.id}] ${mutante.rotulo}`, () => {
    const temporario = fs.mkdtempSync(path.join(RAIZ, 'dist-test-mutante-'));
    try {
      ligarArvore(COMPILADO, temporario);
      for (const alteracao of mutante.alteracoes) {
        const alvo = path.join(temporario, alteracao.alvo);
        const original = fs.readFileSync(alvo, 'utf8');
        const primeira = original.indexOf(alteracao.de);
        if (primeira < 0) assert.fail(`mutante.inaplicavel: ${mutante.id} ${alteracao.alvo}`);
        const segunda = original.indexOf(alteracao.de, primeira + alteracao.de.length);
        if (segunda >= 0) assert.fail(`mutante.inaplicavel: ${mutante.id} alvo ambiguo em ${alteracao.alvo}`);
        fs.unlinkSync(alvo);
        fs.writeFileSync(alvo, original.slice(0, primeira) + alteracao.para + original.slice(primeira + alteracao.de.length));
        const sintaxe = spawnSync(process.execPath, ['--check', alvo], { encoding: 'utf8' });
        if (sintaxe.status !== 0) assert.fail(`mutante.invalido: ${mutante.id} ${sintaxe.stderr}`);
      }
      for (const focal of mutante.focais) {
        const r = executarFocal(temporario, focal);
        if (r.signal || r.status === null) assert.fail(`mutante.invalido: ${mutante.id} ${r.signal ?? 'sem status'}`);
        assert.notEqual(r.status, 0, `mutante.sobreviveu: ${mutante.id} em ${focal}\n${r.stdout}`);
        if (mutante.id === 'MF53') {
          const saida = `${r.stdout}\n${r.stderr}`;
          assert.doesNotMatch(saida, /TypeError/, 'MF53 precisa morrer pela asserção do contrato');
          assert.match(saida, /AssertionError|ERR_ASSERTION/, 'MF53 precisa morrer pela asserção do contrato');
        }
      }
    } finally {
      fs.rmSync(temporario, { recursive: true, force: true });
    }
  });
}
