#!/usr/bin/env node
/**
 * Guard `PreToolUse` do adaptador Claude Code (bloco B4).
 *
 * Ele NAO tem regra de negocio: nao consulta ledger, nao decide quem pode entregar e nao
 * conhece thread nenhuma. Ele bloqueia, mecanicamente, a classe de comando que destroi
 * trabalho alheio sem pedir licenca, e manda o agente pelo caminho que o `ork` verifica.
 *
 * Dois bloqueios, herdados de incidente real:
 *  1. `git add -A` e parentes: engolem arquivo de outra thread que estava na mesma arvore.
 *     A regra do produto e um commit atomico por tarefa, com os arquivos nomeados.
 *  2. `git push` na mao: o push do Orkastery e provado, comparando o sha local com o que o
 *     remoto reporta, e serializado por lease. Push por fora nao e proibido por gosto: ele
 *     e um push que ninguem consegue provar depois.
 *
 * Protocolo: le o JSON do PreToolUse no stdin, escreve a decisao em JSON no stdout e sai
 * com codigo 2 quando nega (os dois canais, para funcionar tanto no host que le a decisao
 * quanto no que le o codigo de saida). Erro interno NUNCA bloqueia: um guard que quebra a
 * sessao por um bug proprio e pior que nenhum guard.
 */

'use strict';

/** Padroes bloqueados. Cada um traz o motivo e o caminho que o `ork` verifica. */
const BLOQUEIOS = [
  {
    nome: 'git-add-em-massa',
    regex: /\bgit\s+add\s+(?:-A\b|--all\b|\.(?:\s|$))/,
    motivo: 'git add em massa engole arquivo de outra thread que esteja na mesma arvore',
    caminho: 'nomeie os arquivos da tarefa: git add -- <arquivo> [<arquivo>...]',
  },
  {
    nome: 'git-commit-em-massa',
    regex: /\bgit\s+commit\b[^|;&]*\s-(?:a|[a-zA-Z]*a[a-zA-Z]*)\b/,
    motivo: 'git commit -a comita tudo que esta rastreado, nao a tarefa',
    caminho: 'adicione os arquivos da tarefa e comite sem -a',
  },
  {
    nome: 'force-push',
    regex: /\bgit\s+push\b[^|;&]*(?:--force\b|--force-with-lease\b|\s-f\b)/,
    motivo: 'force push reescreve historico publico e apaga entrega de outra thread',
    caminho: 'nunca. Se a base precisa mudar, isso e decisao registrada, nao comando.',
  },
  {
    nome: 'push-nao-provado',
    regex: /\bgit\s+push\b/,
    motivo:
      'push na mao nao e provado: o Orkastery compara o sha local com o que o remoto reporta e serializa o merge por lease',
    caminho: 'entregue por: ork ship <thread> --para <base> --autorizar-push <quem>',
  },
  {
    nome: 'reset-destrutivo',
    regex: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-zA-Z]*[fd]|checkout\s+--\s+\.)/,
    motivo: 'descarte em massa apaga trabalho nao commitado sem deixar rastro',
    caminho: 'descarte por arquivo, ou registre a decisao antes: ork gate approve <thread> <sobre> --por <quem>',
  },
  {
    nome: 'remocao-recursiva-ampla',
    regex: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(?:\/|\*|~|\$|\.\s*$|\.\/\s*$)/,
    motivo: 'remocao recursiva com alvo amplo ou variavel apaga o que ninguem pediu',
    caminho: 'remova caminhos nomeados, dentro da worktree da thread',
  },
];

function decidir(entrada) {
  const nome = entrada && entrada.tool_name;
  if (nome !== 'Bash') return null;
  const comando = String((entrada.tool_input && entrada.tool_input.command) || '');
  if (comando.trim() === '') return null;
  // Comando do proprio `ork` passa: quem verifica o push provado e o merge serializado e ele.
  if (/^\s*(?:[A-Za-z0-9_]+=\S*\s+)*(?:\S*\/)?ork\s/.test(comando)) return null;
  for (const b of BLOQUEIOS) {
    if (b.regex.test(comando)) return b;
  }
  return null;
}

function main(bruto) {
  let entrada;
  try {
    entrada = JSON.parse(bruto || '{}');
  } catch (e) {
    // Entrada ilegivel nao bloqueia: o guard erra para o lado de deixar passar.
    process.stdout.write(JSON.stringify({ ork_guard: 'entrada-ilegivel', decisao: 'allow' }) + '\n');
    return 0;
  }
  const bloqueio = decidir(entrada);
  if (!bloqueio) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
        ork_guard: 'ok',
      }) + '\n'
    );
    return 0;
  }
  const razao =
    `ork guard bloqueou "${bloqueio.nome}": ${bloqueio.motivo}.\n` + `caminho: ${bloqueio.caminho}`;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: razao,
      },
      ork_guard: bloqueio.nome,
    }) + '\n'
  );
  process.stderr.write(razao + '\n');
  return 2;
}

let bruto = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  bruto += c;
});
process.stdin.on('end', () => {
  let codigo = 0;
  try {
    codigo = main(bruto);
  } catch (e) {
    // Bug do guard nao derruba a sessao do builder.
    process.stderr.write(`ork guard falhou e liberou por seguranca: ${e && e.message}\n`);
    codigo = 0;
  }
  process.exitCode = codigo;
});

module.exports = { BLOQUEIOS, decidir };
