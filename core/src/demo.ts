/**
 * I-56 (RM-046, fase 2): `ork demo`, a promessa do produto em trinta segundos.
 *
 * O agente diz "pronto"; o `ork` reexecuta a prova no commit real e recusa a afirmacao falsa. A
 * demonstracao roda offline, sem runtime, sem conta e sem modelo: um repositorio temporario, uma
 * funcao com defeito, uma claim com o comando que a julga, e o `ork verify` de verdade, antes e
 * depois da correcao. Nada toca o projeto de quem roda, o registro de contas nem remoto nenhum.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { adicionarClaim } from './claims';
import { init } from './init';
import { exigirManifesto } from './manifest';
import { novaThread } from './thread';
import { exec } from './util';
import { ResultadoVerify, verificar } from './verify';

export interface ResultadoDaDemo {
  dir: string;
  antes: ResultadoVerify;
  depois: ResultadoVerify;
  /** A demo mostrou o que promete: reprovou a afirmacao falsa e aceitou a corrigida. */
  ok: boolean;
  mantido: boolean;
}

const PROVA = "node -e \"process.exit(require('./soma').soma(2, 2) === 4 ? 0 : 1)\"";

function git(dir: string, args: string[]): void {
  const r = exec('git', args, dir);
  if (!r.ok) throw new Error(`demo: git ${args[0]} falhou: ${r.stderr.trim().split('\n').pop() ?? ''}`);
}

function commit(dir: string, arquivo: string, conteudo: string, mensagem: string): void {
  fs.writeFileSync(path.join(dir, arquivo), conteudo, 'utf8');
  git(dir, ['add', '--', arquivo]);
  git(dir, ['commit', '-q', '-m', mensagem]);
}

/**
 * Roda a demonstracao inteira e devolve os dois veredictos. `escrever` recebe a narracao, linha a
 * linha; sem ele, a demo e silenciosa (testes).
 */
export function executarDemo(opcoes: { dir?: string; manter?: boolean; escrever?: (linha: string) => void } = {}): ResultadoDaDemo {
  const diga = opcoes.escrever ?? (() => undefined);
  // Diretorio dado por quem roda: so vazio ou inexistente, e nunca e apagado no fim.
  if (opcoes.dir && fs.existsSync(opcoes.dir) && fs.readdirSync(opcoes.dir).length > 0) {
    throw new Error(`demo: ${opcoes.dir} nao esta vazio; a demo cria o proprio repositorio`);
  }
  const temporario = !opcoes.dir;
  const dir = opcoes.dir ? path.resolve(opcoes.dir) : fs.mkdtempSync(path.join(os.tmpdir(), 'ork-demo-'));
  fs.mkdirSync(dir, { recursive: true });
  // A demo nunca publica estado da fabrica, mesmo numa maquina que entrou nela.
  const publicarAntes = process.env.ORK_FABRICA_PUBLICAR;
  process.env.ORK_FABRICA_PUBLICAR = '0';
  try {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.name', 'ork demo']);
    git(dir, ['config', 'user.email', 'demo@orkastery.local']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    commit(dir, 'soma.js', '// Soma dois numeros.\nexports.soma = (a, b) => a - b;\n', 'funcao soma');
    init(dir, { nome: 'demo', abbrev: 'dmo' });
    const carregado = exigirManifesto(dir);
    const { thread } = novaThread(carregado, { nome: 'demo', modo: 'auto' });

    diga('ork demo: a afirmacao do agente contra a prova');
    diga('');
    diga('  1. O agente entrega soma.js e diz: "soma(2, 2) devolve 4. Pronto."');
    adicionarClaim(dir, thread.id, { arquivo: 'soma.js', alegacao: 'soma(2, 2) devolve 4', verificar: [PROVA] });
    diga('  2. O ork nao aceita relato: reexecuta a prova no commit real.');
    diga(`       ${PROVA}`);
    const antes = verificar(carregado, thread.id, { soClaims: true });
    diga(`     Veredito: ${antes.ok ? 'VERDADE SUSTENTADA' : `REPROVADO (${antes.motivos.join(', ')})`}. A funcao faz a - b.`);

    diga('  3. O agente corrige soma.js e faz commit.');
    commit(dir, 'soma.js', '// Soma dois numeros.\nexports.soma = (a, b) => a + b;\n', 'corrige a soma');
    diga('  4. O ork reexecuta a MESMA prova no commit novo.');
    const depois = verificar(carregado, thread.id, { soClaims: true });
    diga(`     Veredito: ${depois.ok ? 'VERDADE SUSTENTADA' : `REPROVADO (${depois.motivos.join(', ')})`}.`);
    diga('');
    diga('Nenhuma afirmacao vale sem o comando que a julga, reexecutado no commit real.');
    diga('No seu projeto: ork init, depois ork thread new "<pedido>" --modo auto.');

    const ok = !antes.ok && antes.motivos.includes('claims.failed') && depois.ok;
    const mantido = !temporario || opcoes.manter === true;
    if (mantido) diga(`(o repositorio da demo ficou em ${dir})`);
    return { dir, antes, depois, ok, mantido };
  } finally {
    if (publicarAntes === undefined) delete process.env.ORK_FABRICA_PUBLICAR; else process.env.ORK_FABRICA_PUBLICAR = publicarAntes;
    if (temporario && !opcoes.manter) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
