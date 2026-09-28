/**
 * I-35 (D11): lint do horário para pessoas. Reprova a volta do UTC truncado
 * (`replace('T', ' ')`), do fuso fixo fora de `horario.ts` e de campo ISO cru em texto:
 * interpolado, concatenado, guardado numa variável local que vai para o texto ou passado
 * direto ao `console.*`. Vale para `core/src` e para as rotinas de `scripts/` e `monitor/`
 * (GO-FIX 1, P3-1 do CHECK c655cb5e). O que é dado de máquina fica listado aqui com a
 * razão; exceção que não casa mais reprova.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..', '..');
const DOMICILIO = 'core/src/horario.ts';

function fontes(): { arquivo: string; linhas: string[] }[] {
  const saida: { arquivo: string; linhas: string[] }[] = [];
  const andar = (dir: string, extensoes: RegExp) => {
    for (const nome of fs.readdirSync(path.join(REPO, dir)).sort()) {
      const rel = path.join(dir, nome);
      if (fs.statSync(path.join(REPO, rel)).isDirectory()) andar(rel, extensoes);
      else if (extensoes.test(nome) && !/\.test\./.test(nome)) {
        saida.push({ arquivo: rel, linhas: fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n') });
      }
    }
  };
  andar('core/src', /\.ts$/);
  // Rotinas do cron e do orquestrador também escrevem para o humano (P2-1 passou por aqui).
  andar('scripts', /\.(?:sh|c?js|mjs)$/);
  andar('monitor', /\.(?:sh|c?js|mjs)$/);
  return saida;
}

/** Campo ISO (`...Em`, `...At`, `...Ate`, `.ts`, `.prazo`) lido como valor, não chamado. */
const CAMPO_ISO = /\.(?:[A-Za-z0-9_]*Em|[A-Za-z0-9_]*At|[A-Za-z0-9_]*Ate|ts|prazo)\b(?!\s*\()/;
const PASSA_PELO_FORMATADOR = /formatar|localizar|legendaDoFuso|rotuloDoFuso|minutos\(|Date\.parse|\.slice\(0,\s*8\)/;
const INTERPOLACAO = /\$\{([^{}]*)\}/g;
const ASPAS = '\'"`';
const CADEIA = /^[\w$][\w$.?!\[\]]*$/;
const cru = (expr: string): boolean => (CAMPO_ISO.test(expr) || /toISOString\(\)/.test(expr)) && !PASSA_PELO_FORMATADOR.test(expr);

/** Variável local que guarda o ISO cru: `const quando = e.ts` (também com `??`/`||` ou `.toISOString()`). */
function variaveisCruas(linhas: readonly string[]): Set<string> {
  const nomes = new Set<string>();
  for (const linha of linhas) {
    for (const m of linha.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;,]+)/g)) {
      const operandos = m[2].split(/\?\?|\|\|/).map(o => o.trim());
      if (operandos.some(o => (CADEIA.test(o) && cru(o)) || /\.toISOString\(\)$/.test(o))) nomes.add(m[1]);
    }
  }
  return nomes;
}

/** Posição da aspa que fecha (passo 1) ou abre (passo -1) o literal que começa em `i`. */
function outraAspa(linha: string, i: number, passo: 1 | -1): number {
  let j = i + passo;
  while (j >= 0 && j < linha.length && !(linha[j] === linha[i] && linha[j - 1] !== '\\')) j += passo;
  return j;
}

/** Operando inteiro de um `+`, para a direita (passo 1) ou para a esquerda (passo -1), no mesmo nível. */
function operando(linha: string, i: number, passo: 1 | -1): string {
  let j = i, nivel = 0;
  while (j >= 0 && j < linha.length && linha[j] === ' ') j += passo;
  const inicio = j;
  const abre = passo === 1 ? '([{' : ')]}', fecha = passo === 1 ? ')]}' : '([{';
  for (; j >= 0 && j < linha.length; j += passo) {
    const c = linha[j];
    if (ASPAS.includes(c)) { j = outraAspa(linha, j, passo); continue; }
    if (abre.includes(c)) { nivel++; continue; }
    if (fecha.includes(c)) { if (nivel === 0) break; nivel--; continue; }
    if (nivel === 0 && (/[+,;:|&=]/.test(c) || (c === '?' && linha[j + 1] !== '.'))) break;
  }
  return (passo === 1 ? linha.slice(inicio, j) : linha.slice(j + 1, inicio + 1)).trim();
}

/** Pares de operandos de cada `+` fora de literal: `'desde ' + x.adquiridoEm` vira `['desde ', x.adquiridoEm]`. */
function concatenacoes(linha: string): [string, string][] {
  const pares: [string, string][] = [];
  for (let i = 0; i < linha.length; i++) {
    if (ASPAS.includes(linha[i])) { i = outraAspa(linha, i, 1); continue; }
    if (linha[i] !== '+' || linha[i + 1] === '+' || linha[i + 1] === '=' || linha[i - 1] === '+') continue;
    pares.push([operando(linha, i - 1, -1), operando(linha, i + 1, 1)]);
  }
  return pares;
}

/** Argumentos de `console.log|error|warn|info(...)` na mesma linha, separados no nível zero. */
function argumentosDeConsole(linha: string): string[] {
  const m = /console\.(?:log|error|warn|info)\(/.exec(linha);
  if (!m) return [];
  const args: string[] = [];
  let atual = '', nivel = 0, aspa = '';
  for (let i = m.index + m[0].length; i < linha.length; i++) {
    const c = linha[i];
    if (aspa) {
      atual += c;
      if (c === '\\') atual += linha[++i] ?? '';
      else if (c === aspa) aspa = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { aspa = c; atual += c; continue; }
    if ('([{'.includes(c)) nivel++;
    if (')]}'.includes(c)) { if (nivel === 0) break; nivel--; }
    if (c === ',' && nivel === 0) { args.push(atual.trim()); atual = ''; continue; }
    atual += c;
  }
  if (atual.trim()) args.push(atual.trim());
  return args;
}

/** Linhas (índice base 0) que expõem horário cru a uma pessoa, por qualquer das quatro formas. */
function linhasCruas(linhas: readonly string[]): number[] {
  const vars = variaveisCruas(linhas);
  const expoe = (expr: string) => cru(expr) || vars.has(expr.trim());
  return linhas.flatMap((linha, i) => {
    const interpolada = [...linha.matchAll(INTERPOLACAO)].some(m => expoe(m[1]));
    const concatenada = concatenacoes(linha).some(([esquerda, direita]) =>
      (/['"`]$/.test(esquerda) && expoe(direita)) || (/^['"`]/.test(direita) && expoe(esquerda)));
    const noConsole = argumentosDeConsole(linha).some(a => !/^['"`]/.test(a) && !/JSON\.stringify/.test(a) && expoe(a));
    return interpolada || concatenada || noConsole ? [i] : [];
  });
}

/** Dado de máquina ou fora do escopo (D5, D12): o texto guarda ISO e quem exibe localiza. */
const EXCECOES: { arquivo: string; trecho: string; razao: string }[] = [
  { arquivo: 'retry.ts', trecho: 'libera em ${pedido.liberaEm})', razao: 'detalhe gravado na tentativa; textoDoRetry e textoDaRetomada localizam' },
  { arquivo: 'retry.ts', trecho: 'o proximo libera em ${fila[0].liberaEm}', razao: 'detalhe gravado no ledger (retry_tentado); textoDoRetry localiza' },
  // Delta da I-33 (GO-FIX 2): perfis e fila duravel. O ISO fica no dado; quem imprime localiza.
  { arquivo: 'doctor.ts', trecho: 'ate ${p.esgotadoAte}', razao: 'estado do perfil no Check (lido tambem por teste); relatorio() localiza e diz o fuso uma vez' },
  { arquivo: 'preflight.ts', trecho: 'ate ${p.esgotadoAte}', razao: 'estado do perfil no Check; textoPreflight localiza e diz o fuso uma vez' },
  { arquivo: 'phase.ts', trecho: 'ate ${pedido.esgotadoAte}', razao: 'erro gravado em dispatch_failed e gate_blocked; o CLI localiza ao imprimir' },
  { arquivo: 'retry.ts', trecho: ': fila duravel ate ${liberaEm}', razao: 'razao gravada no evento runtime_profile_rotated' },
  { arquivo: 'retry.ts', trecho: 'ensaio: entraria na fila duravel ate ${liberaEm}', razao: 'detalhe do ensaio devolvido; textoDoRetry localiza' },
  { arquivo: 'retry.ts', trecho: 'aguarde ate ${pedido.liberaEm})', razao: 'correcao gravada no evento rate_limit_enqueued, como a de phase.ts' },
  { arquivo: 'retry.ts', trecho: 'fila duravel: pedido ${pedido.id} libera em ${pedido.liberaEm}', razao: 'detalhe gravado no evento retry_tentado' },
  { arquivo: 'retry.ts', trecho: 'na fila ate ${pedido.liberaEm}', razao: 'detalhe devolvido do enfileiramento; textoDoRetry e textoDaRetomada localizam' },
  { arquivo: 'pulse.ts', trecho: 'sem heartbeat desde ${o.ultimoHeartbeatEm}', razao: 'pergunta entra na assinatura de deduplicação; texto e mensagem localizam' },
  { arquivo: 'leases.ts', trecho: 'desde ${dono.adquiridoEm}', razao: 'detalhe de lease.busy devolvido e gravado; o CLI localiza' },
  { arquivo: 'ship.ts', trecho: 'registrada no ledger em ${antecipada.ts}', razao: 'razão da autorização gravada; textoDoShip localiza' },
  { arquivo: 'ship.ts', trecho: 'desde ${dono?.adquiridoEm', razao: 'detalhe do gate gravado no ledger; textoDoShip localiza' },
  { arquivo: 'phase.ts', trecho: 'aguarde ate ${pedido.liberaEm})', razao: 'correção gravada no evento rate_limit_enqueued' },
  { arquivo: 'orquestracao.ts', trecho: '(${p.liberaEm}, ', razao: 'detalhe do JSON do monitor guarda ISO; linhaDaParada localiza' },
  { arquivo: 'ocupacao.ts', trecho: '(${PAUSA_PREVISTA}) em ${e.ts}', razao: 'evidência cita o evento do ledger; o board localiza' },
  { arquivo: 'ocupacao.ts', trecho: '(human.pending) em ${e.ts}', razao: 'evidência cita o evento do ledger; o board localiza' },
  { arquivo: 'ocupacao.ts', trecho: '(${motivo}) em ${e.ts}', razao: 'evidência cita o evento do ledger; o board localiza' },
  { arquivo: 'liveness.ts', trecho: 'phase_dispatch ${d.ts} sessão', razao: 'evidência de máquina do liveness' },
  { arquivo: 'liveness.ts', trecho: 'chave = `${d.ts}|', razao: 'chave de deduplicação' },
  { arquivo: 'session-watcher.ts', trecho: 'heartbeat:${cursor.crescimentoEm}', razao: 'identificador do heartbeat' },
  { arquivo: 'session-watcher.ts', trecho: "update(sessionId + '|' + sessao.despachadaEm)", razao: 'entrada do hash que identifica o watcher da sessão' },
  { arquivo: 'handoff.ts', trecho: 'em ${b.gravadaEm}', razao: 'documento para a próxima sessão de agente (D12)' },
  { arquivo: 'handoff.ts', trecho: 'em ${eventos[eventos.length - 1].ts}', razao: 'documento para a próxima sessão de agente (D12)' },
  { arquivo: 'memoria.ts', trecho: 'em ${d.decididaEm}.', razao: 'registro de memória no OrkMind (D12)' },
  { arquivo: 'memoria-humana.ts', trecho: 'em ${e.ts}.', razao: 'registro de memória no OrkMind (D12)' },
  // I-45: chave do cache do radar em .orkastery/monitor/radar-encerradas.json; nunca vira texto.
  { arquivo: 'hitl.ts', trecho: '`${sid}|${s.startedAt ?? \'\'}`', razao: 'chave de maquina do cache de sessoes encerradas; o inicio da instancia so separa sessao retomada' },
];

test('lint: nenhum UTC truncado por replace de T em core/src, scripts/ e monitor/', () => {
  const achados = fontes().flatMap(f => f.linhas.map((l, i) => ({ f: f.arquivo, i: i + 1, l }))
    .filter(x => /\.replace\(\s*(['"`])T\1\s*,\s*(['"`]) \2\s*\)/.test(x.l)).map(x => `${x.f}:${x.i}`));
  assert.deepEqual(achados, []);
});

test('lint: fuso fixo e Intl com timeZone só no domicílio único', () => {
  const achados = fontes().filter(f => f.arquivo !== DOMICILIO).flatMap(f => f.linhas.map((l, i) => ({ f: f.arquivo, i: i + 1, l }))
    .filter(x => /America\/Sao_Paulo|timeZone\s*:/.test(x.l)).map(x => `${x.f}:${x.i}`));
  assert.deepEqual(achados, []);
});

test('lint: campo ISO não chega cru ao texto; exceções de máquina justificadas e vivas', () => {
  const usadas = new Set<number>();
  const achados: string[] = [];
  for (const f of fontes()) {
    for (const i of linhasCruas(f.linhas)) {
      const linha = f.linhas[i];
      const excecao = EXCECOES.findIndex(e => e.arquivo === path.basename(f.arquivo) && linha.includes(e.trecho));
      if (excecao >= 0) { usadas.add(excecao); continue; }
      achados.push(`${f.arquivo}:${i + 1}: ${linha.trim()}`);
    }
  }
  assert.deepEqual(achados, [], 'horário para pessoa passa por core/src/horario.ts (formatar*/localizarTexto)');
  const mortas = EXCECOES.filter((_, i) => !usadas.has(i)).map(e => `${e.arquivo}: ${e.trecho}`);
  assert.deepEqual(mortas, [], 'exceção que não casa mais deve sair da lista');
  for (const e of EXCECOES) assert.ok(e.razao.length > 10, `exceção sem razão: ${e.arquivo}`);
});

test('lint: o lint pega cada forma proibida e deixa passar a formatada (controle positivo)', () => {
  const proibidas: string[][] = [
    ['linhas.push(`  libera em ${p.liberaEm} e ${e.ts.replace(\'T\', \' \')}`);'],
    ['throw new Error(`perfil esgotado ate ${pedido.esgotadoAte}`);'],
    ['linhas.push(`agora: ${new Date().toISOString()}`);'],
    ["linhas.push('desde ' + l.adquiridoEm);"],
    ["const aviso = l.adquiridoEm + ' (lease)';"],
    ['console.log("AVISO: " + n + " sessoes (" + radar.consultadoEm + ")");'],
    ["console.error('lido em ' + fs.statSync(arquivo).mtime.toISOString());"],
    ["linhas.push('criada em ' + lerThread(raiz, id).criadaEm + '.');"],
    ['const quando = e.ts;', 'linhas.push(`evento de ${quando}`);'],
    ['const quando = e.ts ?? agora;', "linhas.push('evento de ' + quando);"],
    ['const carimbo = new Date().toISOString();', 'console.error(carimbo);'],
    ["console.log('quando', e.ts);"],
  ];
  for (const linhas of proibidas) assert.notDeepEqual(linhasCruas(linhas), [], linhas.join(' / '));
  assert.ok(/\.replace\(\s*(['"`])T\1\s*,\s*(['"`]) \2\s*\)/.test(proibidas[0][0]));
  const permitidas: string[][] = [
    ['linhas.push(`  libera em ${formatarDataHora(p.liberaEm)}`);'],
    ["linhas.push('desde ' + formatarDesde(l.adquiridoEm));"],
    ['const quando = formatarHora(e.ts);', 'linhas.push(`evento de ${quando}`);'],
    ['const chave = createHash(\'sha256\').update(s.despachadaEm).digest(\'hex\');', 'linhas.push(`${chave}`);'],
    ['console.log(JSON.stringify({ ts: e.ts }));'],
    ["console.log('quando', formatarDataHoraRotulada(e.ts));"],
    ["linhas.push('criada em ' + formatarDataHora(lerThread(raiz, id).criadaEm) + '.');"],
    ["const total = contagem.ts + 1;", "linhas.push('arquivo ' + nome + '.ts');"],
  ];
  for (const linhas of permitidas) assert.deepEqual(linhasCruas(linhas), [], linhas.join(' / '));
});
