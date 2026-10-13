/**
 * RM-061, fatia F3b: a familia `adapter` do catalogo de mensagens (`ork adapter list|show|install`): a tabela dos hosts,
 * a descricao e os pitfalls de cada um, o texto da instalacao, os avisos do pacote de experiencia e as recusas. O pt-BR
 * e a fonte (o `HOSTS` de `hosts.ts` le a descricao e os pitfalls daqui); o ingles e tipado por ele. Sem import do nucleo.
 *
 * O host, o caminho, o comando de ativacao, o motivo da divergencia (`catalogo-andou`) e o recibo `INSTALADO.json` sao
 * dado e saem iguais nas duas linguas. A prova de cada pitfall e um comando: so o comentario depois do `#` muda.
 */

export interface PitfallDoCatalogo { titulo: string; detalhe: string; prova: string }
export interface HostDoCatalogo { descricao: string; pitfalls: PitfallDoCatalogo[] }
type NomeDoHost = 'claude-code' | 'codex' | 'hermes' | 'openclaw';

const HOSTS_PT_BR: Record<NomeDoHost, HostDoCatalogo> = {
  'claude-code': {
    descricao: 'Plugin com as skills do catalogo, subagentes de fase, entrada /orkastery:ork e hooks do Orkastery',
    pitfalls: [
      {
        titulo: 'manifesto sem os caminhos das skills instala limpo e nao expoe nada',
        detalhe:
          'o plugin auto-descobre skills/<nome>/SKILL.md e para ai: ele nao desce nos buckets (core/, phases/, reviewers/, ...) que este catalogo usa, entao o plugin.json declara cada caminho de skill, um a um',
        prova: 'claude plugin details orkastery   # Skills (N) soma as skills do plugin.json e os comandos de commands/',
      },
      {
        titulo: 'duas copias do catalogo divergem',
        detalhe:
          'a fonte unica e skills/ na raiz do produto; o INSTALADO.json guarda a origem e o sha256 de cada arquivo, e reinstalar CLASSIFICA cada divergencia por ele: o que so mudou no catalogo ressincroniza sozinho, o que voce editou barra e pede decisao por arquivo (--aceitar-catalogo ou --manter-copia). Editar a copia instalada e bandeira vermelha',
        prova: 'ork adapter install claude-code --dry-run   # mostra o que divergiu do catalogo',
      },
      {
        titulo: 'hook com caminho relativo nao roda, e o guard vira decoracao',
        detalhe:
          'o hooks.json chama node "${CLAUDE_PLUGIN_ROOT}/hooks/ork-guard.js", nunca um caminho relativo ao diretorio de trabalho, que muda a cada worktree de thread',
        prova:
          `echo '{"tool_name":"Bash","tool_input":{"command":"git add -A"}}' | node <destino>/hooks/ork-guard.js ; echo "codigo: $?"   # 2 = guard vivo`,
      },
    ],
  },
  codex: {
    descricao: 'Entrada $ork e catalogo de conducao em skills locais do projeto, sem configuracao global',
    pitfalls: [
      {
        titulo: 'skills instaladas fora do projeto da sessao',
        detalhe: 'Codex descobre .agents/skills a partir do diretorio da sessao ate a raiz do repositorio; outra worktree precisa da sua propria instalacao e comprovacao de descoberta',
        prova: 'No Codex aberto no projeto instalado: $ork',
      },
      {
        titulo: 'copia instalada diferente do catalogo',
        detalhe: 'o recibo INSTALADO.json registra os arquivos e hashes dentro da pasta propria orkastery; uma edicao divergente barra a reinstalacao sem substituir arquivos de outras skills',
        prova: 'ork adapter install codex --dry-run',
      },
      {
        titulo: 'skill confundida com autorizacao de runtime',
        detalhe: 'instalar instrucoes nao habilita permissoes, hooks ou sandbox; em projeto configurado, AGENTS.md recebe apenas o bloco reversível da experiência. Gates e preflight continuam no nucleo, e descoberta nao prova a jornada conversacional',
        prova: 'ork doctor',
      },
    ],
  },
  hermes: {
    descricao: 'Skill roteadora fina, plugin que a declara e script de abertura de thread',
    pitfalls: [
      {
        titulo: 'ork fora do PATH do host',
        detalhe:
          'o host roda com ambiente mais enxuto que o terminal do builder e ~/.local/bin pode nao estar la; o plugin grava o caminho absoluto e o script honra ORK_BIN',
        prova: 'ORK_BIN=$(command -v ork) ; "$ORK_BIN" doctor',
      },
      {
        titulo: 'reimplementar o parse da #TAG no host',
        detalhe:
          'duas implementacoes divergem na primeira tag nova, e a divergencia aparece como thread aberta no modo errado, o que ninguem percebe ate a pausa que nao veio',
        prova: 'ork modos --do-pedido "teste #Maestro"   # a unica fonte do modo',
      },
      {
        titulo: 'validar allowed_modes no host',
        detalhe:
          'um host que recusa o modo antes de chamar o ork recusa com a regra que ele tem em cache, nao com a do manifesto do projeto; deixe o ork thread new recusar, com erro tipado',
        prova: 'ork thread new "teste" --mode look --dry-run',
      },
    ],
  },
  openclaw: {
    descricao: 'extensao do OpenClaw 2026.7.1 (package.json + dist/index.js) com as tools ork_*, cada uma uma chamada de CLI',
    pitfalls: [
      {
        titulo: 'placeholder {{ork_bin}} que fica no arquivo',
        detalhe:
          'o entry executa o binario como ele esta: um placeholder nao renderizado cai no fallback (ORK_BIN ou o ork do PATH), e sem o fallback vira "comando nao encontrado" em toda tool, que a sessao so descobre depois de ja ter aberto thread na cabeca do agente',
        prova: 'grep -c "{{" <destino>/extensions/orkastery/dist/index.js   # precisa devolver 0',
      },
      {
        titulo: 'argumento com espaco quebrado em varios argumentos',
        detalhe:
          'cada tool monta o comando como VETOR de argv, nunca como string de shell, para o pedido do builder chegar inteiro em --prompt; string de shell aqui vira injecao de comando com o texto do builder dentro',
        prova: 'ork_phase_run com um prompt de varias linhas, conferido em ork phase list <thread>',
      },
      {
        titulo: 'tool que reimplementa regra do nucleo',
        detalhe:
          'toda tool deste plugin e uma chamada de CLI e nada mais; tool nova que precisa de logica e sinal de que a logica pertence ao ork, com teste',
        prova: 'ork eval   # o corpus reprova host com regra de negocio duplicada',
      },
    ],
  },
};

const HOSTS_EN: Record<NomeDoHost, HostDoCatalogo> = {
  'claude-code': {
    descricao: 'Plugin with the catalog skills, phase subagents, the /orkastery:ork entry and the Orkastery hooks',
    pitfalls: [
      {
        titulo: 'a manifest without the skill paths installs cleanly and exposes nothing',
        detalhe:
          'the plugin auto-discovers `skills/<name>/SKILL.md` and stops there: it does not go down into the buckets (`core/`, `phases/`, `reviewers/`, ...) this catalog uses, so `plugin.json` declares each skill path, one by one',
        prova: 'claude plugin details orkastery   # Skills (N) adds up the skills in plugin.json and the commands in commands/',
      },
      {
        titulo: 'two copies of the catalog drift apart',
        detalhe:
          'the single source is `skills/` at the product root; `INSTALADO.json` keeps the origin and the sha256 of each file, and a reinstall CLASSIFIES each divergence by it: what only changed in the catalog resyncs by itself, what you edited blocks the install and asks for a decision per file (`--aceitar-catalogo` or `--manter-copia`). Editing the installed copy is a red flag',
        prova: 'ork adapter install claude-code --dry-run   # shows what drifted from the catalog',
      },
      {
        titulo: 'a hook with a relative path does not run, and the guard becomes decoration',
        detalhe:
          '`hooks.json` calls `node "${CLAUDE_PLUGIN_ROOT}/hooks/ork-guard.js"`, never a path relative to the working directory, which changes with each thread worktree',
        prova:
          `echo '{"tool_name":"Bash","tool_input":{"command":"git add -A"}}' | node <target>/hooks/ork-guard.js ; echo "code: $?"   # 2 = guard alive`,
      },
    ],
  },
  codex: {
    descricao: 'The $ork entry and the conduction catalog as project-local skills, with no global configuration',
    pitfalls: [
      {
        titulo: 'skills installed outside the session project',
        detalhe: 'Codex discovers `.agents/skills` from the session directory up to the repository root; another worktree needs its own install and its own proof of discovery',
        prova: 'In Codex opened on the installed project: $ork',
      },
      {
        titulo: 'installed copy differs from the catalog',
        detalhe: 'the `INSTALADO.json` receipt records the files and hashes inside its own `orkastery` folder; a divergent edit blocks the reinstall without replacing files of other skills',
        prova: 'ork adapter install codex --dry-run',
      },
      {
        titulo: 'a skill mistaken for runtime authorization',
        detalhe: 'installing instructions does not enable permissions, hooks or a sandbox; in a configured project, `AGENTS.md` only gets the reversible experience block. Gates and preflight stay in the core, and discovery does not prove the conversational journey',
        prova: 'ork doctor',
      },
    ],
  },
  hermes: {
    descricao: 'A thin router skill, the plugin that declares it and the thread opening script',
    pitfalls: [
      {
        titulo: 'ork outside the host PATH',
        detalhe:
          'the host runs with a leaner environment than the builder terminal, and `~/.local/bin` may not be there; the plugin writes the absolute path and the script honors `ORK_BIN`',
        prova: 'ORK_BIN=$(command -v ork) ; "$ORK_BIN" doctor',
      },
      {
        titulo: 'reimplementing the #TAG parse in the host',
        detalhe:
          'two implementations drift apart on the first new tag, and the drift shows up as a thread opened in the wrong mode, which nobody notices until the pause that never came',
        prova: 'ork modos --do-pedido "test #Maestro"   # the only source of the mode',
      },
      {
        titulo: 'validating allowed_modes in the host',
        detalhe:
          'a host that refuses the mode before calling ork refuses with the rule it has cached, not the one in the project manifest; let `ork thread new` refuse, with a typed error',
        prova: 'ork thread new "test" --mode look --dry-run',
      },
    ],
  },
  openclaw: {
    descricao: 'OpenClaw 2026.7.1 extension (package.json + dist/index.js) with the ork_* tools, each one a CLI call',
    pitfalls: [
      {
        titulo: 'a {{ork_bin}} placeholder left in the file',
        detalhe:
          'the entry runs the binary as it is: an unrendered placeholder falls back (`ORK_BIN` or the ork in PATH), and without the fallback it becomes "command not found" in every tool, which the session only finds out after the agent already believes the thread is open',
        prova: 'grep -c "{{" <target>/extensions/orkastery/dist/index.js   # must return 0',
      },
      {
        titulo: 'an argument with spaces split into several arguments',
        detalhe:
          'each tool builds the command as an argv VECTOR, never as a shell string, so the builder request reaches `--prompt` whole; a shell string here becomes command injection with the builder text inside',
        prova: 'ork_phase_run with a multi-line prompt, checked in ork phase list <thread>',
      },
      {
        titulo: 'a tool that reimplements a core rule',
        detalhe:
          'every tool in this plugin is a CLI call and nothing more; a new tool that needs logic is a sign that the logic belongs in ork, with a test',
        prova: 'ork eval   # the corpus fails a host with a duplicated business rule',
      },
    ],
  },
};

export const ADAPTER_PT_BR = {
  hosts: HOSTS_PT_BR,
  // ork adapter list
  titulo: 'Adaptadores de host (Camada 1, o podio)',
  destinoPadrao: (destino: string) => `destino padrao: <projeto>/${destino}`,
  catalogoJunto: (leva: boolean) => `catalogo de skills junto: ${leva ? 'sim' : 'nao'}`,
  instaleCom: 'Instale com: ork adapter install <host> [--dir DIR] [--dry-run] [--force]',
  zeroRegra: 'Zero regra de negocio no host: a #TAG vira `--mode` e a validacao e do nucleo.',
  // ork adapter show e os erros de uso
  adaptador: (host: string) => `Adaptador ${host}`,
  hostDesconhecido: (bruto: string, hosts: string) => `host desconhecido: "${bruto}". Use: ${hosts}`,
  subcomandoDesconhecido: (sub: string) => `subcomando desconhecido: adapter ${sub}`,
  tituloDosPitfalls: (host: string) => `Os 3 pitfalls de instalacao do ${host} (confira, nao suponha):`,
  prova: (prova: string) => `prova: ${prova}`,
  // ork adapter install
  experiencia: (estado: 'ativa' | 'pulada' | 'desativada', skill: string) => `Experiência: ${{ ativa: 'ativação preparada',
    pulada: 'pacote pulado nesta instalação, veja o aviso abaixo', desativada: 'desativada ou sem integração de skills' }[estado]}` +
    `${skill ? ` (${skill})` : ''}.`,
  aviso: (aviso: string) => `Aviso: ${aviso}`,
  simulacao: (host: string) => `Simulacao (--dry-run) da instalacao do adaptador ${host}: nada foi escrito.`,
  preparados: (host: string) => `Arquivos do adaptador ${host} preparados.`,
  barrada: (host: string) => `Instalacao do adaptador ${host} BARRADA: ha arquivo diferente no destino.`,
  claudeNaoVerificado: 'Uso no Claude Code ainda nao verificado por esta copia.',
  claudeValide: 'No diretorio deste projeto, valide e ative o plugin:',
  claudeDepois: 'Depois, na sessao deste projeto: /orkastery:ork',
  codexAbra: 'Abra o Codex neste projeto e use $ork.',
  codexNaoVerificado: 'Descoberta e uso nativo ainda nao verificados por esta copia.',
  prepareMcp: (projeto: string, host: string) => `Prepare tambem as ferramentas do projeto: ork mcp install --project ${projeto} --host ${host}`,
  consentimento: 'A configuracao MCP exige descoberta e consentimento no cliente; a copia nao concede aprovacoes.',
  catalogo: (catalogo: string) => `  catalogo: ${catalogo}`,
  destino: (destino: string) => `  destino:  ${destino}`,
  ork: (ork: string) => `  ork:      ${ork}`,
  avisoOrk: (aviso: string) => `  Aviso: ${aviso}`,
  arquivos: (total: number, novos: number, iguais: number, divergentes: number) =>
    `  arquivos: ${total} (${novos} novo(s), ${iguais} ja identico(s), ${divergentes} divergente(s))`,
  removido: (relativo: string, simulacao: boolean) => `    - ${relativo}  (saiu do catalogo${simulacao ? ', seria removido' : ', removido'})`,
  reciboVizinho: (destino: string, vizinho: string) => [`  ATENCAO: nao ha recibo em ${destino}, mas ha um em`, `    ${vizinho}`,
    '  `--dir` e o destino COMPLETO, nao a raiz do projeto. Do jeito que esta, esta',
    '  instalacao criaria uma copia nova ao lado da que ja existe, e a que existe', '  ficaria sem conferencia nenhuma.'],
  catalogoAndou: (n: number) => [`  ${n} divergente(s) sao "catalogo-andou": a copia esta como foi instalada`,
    '  e quem mudou foi o catalogo. Sobrescrever nao perde trabalho de ninguem.'],
  precisamDeDecisao: (n: number) => `  ${n} arquivo(s) precisam de uma decisao sua:`,
  resolva: '  Resolva em UM comando, por arquivo:',
  proximoPassoClaude: 'Proximo passo, no diretorio deste projeto (o mesmo do comeco):',
  proximoPasso: 'Proximo passo (o mesmo do comeco):',
  // Os avisos do pacote de experiencia e do ork do PATH (`instalarAdaptador`)
  segue: 'O restante da instalação do adaptador segue normalmente.',
  puladoManifesto: (erro: string, segue: string) => `Pacote de experiência pulado: o manifesto tem erros (${erro}). ${segue}`,
  puladoInvalida: (aviso: string, segue: string) => `Pacote de experiência pulado: ${aviso}. ${segue}`,
  puladoSemSkill: (skill: string, segue: string) => `Pacote de experiência pulado: a skill ${skill} não está no catálogo. ${segue}`,
  puladoForaDoProjeto: (segue: string) =>
    `Pacote de experiência pulado: o adaptador fica fora do projeto e o bloco de instruções só aponta caminhos do projeto. ${segue}`,
  puladoCaminho: (segue: string) =>
    `Pacote de experiência pulado: o caminho das skills contém quebra de linha ou crase, incompatível com o bloco de instruções. ${segue}`,
  puladoBloco: (link: boolean, host: string, segue: string) => `Pacote de experiência pulado: ${link ? 'o arquivo de instruções é link ou não é arquivo comum'
    : `o bloco de instruções ou o recibo .orkastery/experiencia/${host}.json foi editado ou está duplicado`}; nada foi escrito. Revise os dois à mão. ${segue}`,
  versaoDesconhecida: 'versão desconhecida',
  orkNoPath: (doPath: string, outra: string, emExecucao: string, versao: string) =>
    `o ork do PATH (${doPath}, ${outra}) não é o que roda este install (${emExecucao}, ${versao}). ` +
    `A extensão chama ${emExecucao}; para outro binário, passe --ork <caminho>.`,
  // As recusas
  adaptadorNaoExiste: (host: string, dir: string) => `adaptador do host ${host} nao existe em ${dir}`,
  destinoInseguro: 'experiencia.path.unsafe: destino do adaptador',
  catalogoNaoEncontrado: 'catalogo do Orkastery nao encontrado (esperado um diretorio com skills/, references/ e eval/)',
};

export type MensagensDeAdapter = typeof ADAPTER_PT_BR;

export const ADAPTER_EN: MensagensDeAdapter = {
  hosts: HOSTS_EN,
  titulo: 'Host adapters (Layer 1, the podium)',
  destinoPadrao: (destino) => `default target: <project>/${destino}`,
  catalogoJunto: (leva) => `skill catalog included: ${leva ? 'yes' : 'no'}`,
  instaleCom: 'Install with: ork adapter install <host> [--dir DIR] [--dry-run] [--force]',
  zeroRegra: 'Zero business rules in the host: the #TAG becomes `--mode` and validation belongs to the core.',
  adaptador: (host) => `Adapter ${host}`,
  hostDesconhecido: (bruto, hosts) => `unknown host: "${bruto}". Use: ${hosts}`,
  subcomandoDesconhecido: (sub) => `unknown subcommand: adapter ${sub}`,
  tituloDosPitfalls: (host) => `The 3 install pitfalls of ${host} (check them, do not assume):`,
  prova: (prova) => `proof: ${prova}`,
  experiencia: (estado, skill) => `Experience: ${{ ativa: 'activation prepared', pulada: 'package skipped in this install, see the warning below',
    desativada: 'disabled or without skill integration' }[estado]}${skill ? ` (${skill})` : ''}.`,
  aviso: (aviso) => `Warning: ${aviso}`,
  simulacao: (host) => `Dry run (\`--dry-run\`) of the ${host} adapter install: nothing was written.`,
  preparados: (host) => `${host} adapter files prepared.`,
  barrada: (host) => `${host} adapter install BLOCKED: there is a different file at the target.`,
  claudeNaoVerificado: 'Use in Claude Code not verified by this copy yet.',
  claudeValide: 'In this project directory, validate and enable the plugin:',
  claudeDepois: 'Then, in this project session: /orkastery:ork',
  codexAbra: 'Open Codex in this project and use $ork.',
  codexNaoVerificado: 'Discovery and native use not verified by this copy yet.',
  prepareMcp: (projeto, host) => `Also prepare the project tools: ork mcp install --project ${projeto} --host ${host}`,
  consentimento: 'MCP configuration needs discovery and consent in the client; the copy grants no approvals.',
  catalogo: (catalogo) => `  catalog:  ${catalogo}`,
  destino: (destino) => `  target:   ${destino}`,
  ork: (ork) => `  ork:      ${ork}`,
  avisoOrk: (aviso) => `  Warning: ${aviso}`,
  arquivos: (total, novos, iguais, divergentes) =>
    `  files: ${total} (${novos} new, ${iguais} already identical, ${divergentes} divergent)`,
  removido: (relativo, simulacao) => `    - ${relativo}  (left the catalog${simulacao ? ', would be removed' : ', removed'})`,
  reciboVizinho: (destino, vizinho) => [`  WARNING: there is no receipt in ${destino}, but there is one in`, `    ${vizinho}`,
    '  `--dir` is the FULL target, not the project root. As it is, this install',
    '  would create a new copy next to the existing one, and the existing one', '  would be left without any check.'],
  catalogoAndou: (n) => [`  ${n} divergent file(s) are "catalogo-andou": the copy is as it was installed`,
    '  and what changed was the catalog. Overwriting loses nobody\'s work.'],
  precisamDeDecisao: (n) => `  ${n} file(s) need a decision from you:`,
  resolva: '  Resolve it in ONE command, per file:',
  proximoPassoClaude: 'Next step, in this project directory (the same as at the start):',
  proximoPasso: 'Next step (the same as at the start):',
  segue: 'The rest of the adapter install goes on as usual.',
  puladoManifesto: (erro, segue) => `Experience package skipped: the manifest has errors (${erro}). ${segue}`,
  puladoInvalida: (aviso, segue) => `Experience package skipped: ${aviso}. ${segue}`,
  puladoSemSkill: (skill, segue) => `Experience package skipped: skill ${skill} is not in the catalog. ${segue}`,
  puladoForaDoProjeto: (segue) =>
    `Experience package skipped: the adapter lives outside the project and the instructions block only points to project paths. ${segue}`,
  puladoCaminho: (segue) =>
    `Experience package skipped: the skills path has a line break or a backtick, which the instructions block cannot hold. ${segue}`,
  puladoBloco: (link, host, segue) => `Experience package skipped: ${link ? 'the instructions file is a link or not a regular file'
    : `the instructions block or the \`.orkastery/experiencia/${host}.json\` receipt was edited or is duplicated`}; nothing was written. Review both by hand. ${segue}`,
  versaoDesconhecida: 'unknown version',
  orkNoPath: (doPath, outra, emExecucao, versao) =>
    `the ork in PATH (${doPath}, ${outra}) is not the one running this install (${emExecucao}, ${versao}). ` +
    `The extension calls ${emExecucao}; for another binary, pass \`--ork <path>\`.`,
  adaptadorNaoExiste: (host, dir) => `the ${host} host adapter does not exist in ${dir}`,
  destinoInseguro: 'experiencia.path.unsafe: adapter target',
  catalogoNaoEncontrado: 'Orkastery catalog not found (expected a directory with skills/, references/ and eval/)',
};
