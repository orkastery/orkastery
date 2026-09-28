/**
 * Os 7 packs de auditoria periodica e o hardening por estagio (bloco B5).
 *
 * A feature mandatoria do PO realiza a premissa (b) da visao: o builder cria em sessoes
 * despreocupadas, e quem carrega o peso das boas praticas sao os auditores. A divisao de
 * responsabilidade da visao (secao 5.1) e inegociavel e esta codificada aqui:
 *
 *   - QUEM DISPARA e o orquestrador (cron/schedule do Hermes, OpenClaw ou Claude Code)
 *     chamando `ork audit run <pack> --profile <p> [--since Nd]`;
 *   - QUEM EXECUTA e o runtime adapter que JA existe (`claude-bg`), sem mecanismo novo;
 *   - O QUE SAI e sempre PROPOSTA DE AJUSTE para o roadmap do produto, nunca correcao
 *     aplicada direto;
 *   - O QUE O HUMANO FAZ e decidir o que vira thread (`ork thread new --from-finding`).
 *
 * Este modulo e o catalogo e as regras deterministicas em volta dele (estagio, postura,
 * janela de custo, escopo incremental, template do prompt). Quem despacha e colhe achado
 * e o `auditrun.ts`; quem guarda a divida e o `divida.ts`.
 */

import * as path from 'node:path';
import { DESCRICAO_DO_MOTIVO } from './gates';
import {
  carregarTemplatesDe,
  ContratoDeTemplate,
  lintTemplate,
  ProblemaDeTemplate,
  renderizar,
  TemplateDePrompt,
} from './prompts';
import { exec, noPath, tabela } from './util';
import { lerFusoDoDono, partesLocais, rotuloDoFuso } from './horario';
import {
  DefinicaoDePack,
  Estagio,
  EscopoDaRodada,
  JanelaDeCusto,
  Manifesto,
  MotivoDeAuditoria,
  PackDeAuditoria,
  PosturaDoPack,
} from './types';

// ---------------------------------------------------------------------------
// Motivos tipados da auditoria
// ---------------------------------------------------------------------------

/**
 * O que cada motivo SO DA AUDITORIA significa. Os demais vem do catalogo do B1: o auditor
 * reprova pelos mesmos motivos tipados de qualquer fase, porque ele nao tem regime proprio.
 */
export const DESCRICAO_DO_MOTIVO_DE_AUDITORIA: Readonly<Record<MotivoDeAuditoria, string>> = {
  ...DESCRICAO_DO_MOTIVO,
  'custo.fora-da-janela':
    'a rodada cairia fora da janela ociosa declarada no manifesto (governanca de custo)',
  'pack.inativo-no-estagio': 'o pack ainda nao esta ativo no estagio declarado do produto',
  'achado.sem-proposta': 'achado sem proposta de ajuste completa para o roadmap do produto',
  'achado.duplicado-na-rodada': 'a mesma rodada ja registrou este achado (mesma regra, mesma evidencia)',
  'achado.ja-virou-thread': 'o achado ja originou uma thread e nao pode originar outra',
};

/** Linha de saida do CLI para um motivo tipado de auditoria. */
export function descreverMotivoDeAuditoria(motivo: MotivoDeAuditoria, detalhe: string): string {
  return `motivo tipado: ${motivo} (${DESCRICAO_DO_MOTIVO_DE_AUDITORIA[motivo]})\n  detalhe: ${detalhe}`;
}

// ---------------------------------------------------------------------------
// Estagios e postura (tabela da visao, secao 5.2)
// ---------------------------------------------------------------------------

/** Os estagios em ordem de maturidade. O roadmap promove; o pack acompanha. */
export const ORDEM_DOS_ESTAGIOS: readonly Estagio[] = ['nascente', 'crescendo', 'maduro'];

/** Estagio valido a partir do texto do usuario, ou null. */
export function parseEstagio(bruto: string | undefined): Estagio | null {
  const alvo = (bruto ?? '').trim().toLowerCase();
  return (ORDEM_DOS_ESTAGIOS as readonly string[]).includes(alvo) ? (alvo as Estagio) : null;
}

/** O estagio `a` ja alcancou o estagio `b`? */
export function alcancou(a: Estagio, b: Estagio): boolean {
  return ORDEM_DOS_ESTAGIOS.indexOf(a) >= ORDEM_DOS_ESTAGIOS.indexOf(b);
}

/**
 * A postura do estagio, na letra da tabela da visao (secao 5.2):
 *   nascente  -> so `warn`: o builder cria livre, o auditor anota;
 *   crescendo -> achado critico vira proposta prioritaria no roadmap;
 *   maduro    -> a recorrencia PROPOE promover a policy de `warn` para `block`.
 */
export const POSTURA_DO_ESTAGIO: Readonly<Record<Estagio, PosturaDoPack>> = {
  nascente: 'warn',
  crescendo: 'proposta-prioritaria',
  maduro: 'promove-policy',
};

/** O que cada postura significa, em uma linha, para a saida do CLI. */
export const DESCRICAO_DA_POSTURA: Readonly<Record<PosturaDoPack, string>> = {
  warn: 'so avisa: o builder cria livre e o auditor anota',
  'proposta-prioritaria': 'achado critico vira proposta prioritaria no roadmap do produto',
  'promove-policy':
    'a recorrencia propoe promover a policy de warn para block (2 propoem controle, 3 propoem bloqueante)',
};

/** A postura que vale para este pack neste estagio. */
export function posturaDoPack(estagio: Estagio): PosturaDoPack {
  return POSTURA_DO_ESTAGIO[estagio];
}

// ---------------------------------------------------------------------------
// Os 7 packs
// ---------------------------------------------------------------------------

/**
 * O catalogo dos packs. Cada regra declara O QUE audita e QUE EVIDENCIA a comprova, porque
 * e a evidencia que vai virar claim: um achado sem comando que o reexecute nao passa no
 * `ork audit verify`, exatamente como uma alegacao de fase sem comando nao passa no gate.
 */
export const PACKS: Readonly<Record<PackDeAuditoria, DefinicaoDePack>> = {
  'clean-code': {
    id: 'clean-code',
    titulo: 'Clean code',
    objetivo:
      'Legibilidade e manutenibilidade do codigo novo, sem reescrever o que ja funciona.',
    estagioMinimo: 'nascente',
    fonte: 'codigo',
    referencias: ['references/code-review-axes.md', 'references/definition-of-done.md'],
    evidencias: [
      'diff do escopo da rodada (`git diff --stat` da janela do --since)',
      'caminho:linha de cada ocorrencia, nunca "varios arquivos"',
    ],
    regras: [
      {
        id: 'CC1',
        regra: 'Funcao ou arquivo muito acima da mediana do proprio repositorio, sem razao declarada.',
        evidencia: 'comando que conta as linhas do alvo e mostra o numero (wc -l, awk sobre o arquivo)',
      },
      {
        id: 'CC2',
        regra: 'Bloco identico repetido em 3 ou mais lugares (candidato obvio a extracao).',
        evidencia: 'grep -n do bloco mostrando as 3 ocorrencias com arquivo e linha',
      },
      {
        id: 'CC3',
        regra: 'Nome que mente: a funcao faz o que o nome nao diz, ou faz mais do que ele promete.',
        evidencia: 'trecho citado com arquivo:linha e o efeito colateral nao anunciado pelo nome',
      },
      {
        id: 'CC4',
        regra: 'Erro engolido: catch vazio, promise sem tratamento, codigo de saida ignorado.',
        evidencia: 'grep -n do catch ou da chamada sem checagem de retorno',
      },
      {
        id: 'CC5',
        regra: 'Comentario que descreve o "o que" (ja obvio no codigo) em vez do "por que".',
        evidencia: 'comentario citado com arquivo:linha',
      },
    ],
  },
  reuse: {
    id: 'reuse',
    titulo: 'Reuso',
    objetivo:
      'Impedir que o produto cresca reimplementando o que ele mesmo ja tem (a divida mais cara e a mais silenciosa).',
    estagioMinimo: 'nascente',
    fonte: 'codigo',
    referencias: ['references/code-review-axes.md'],
    evidencias: [
      'os DOIS lados da duplicacao com caminho:linha (o novo e o que ja existia)',
      'comando que prova que os dois existem ao mesmo tempo no HEAD',
    ],
    regras: [
      {
        id: 'RU1',
        regra: 'Utilitario novo que reimplementa um utilitario ja existente no proprio repositorio.',
        evidencia: 'grep -n dos dois simbolos, com os dois caminhos',
      },
      {
        id: 'RU2',
        regra: 'Componente de interface duplicado fora do design system do produto.',
        evidencia: 'caminho do componente novo e o caminho do equivalente no design system',
      },
      {
        id: 'RU3',
        regra: 'Dependencia nova para fazer o que a stack ja instalada faz.',
        evidencia: 'a entrada no manifesto de pacotes e o modulo da stack que ja resolvia',
      },
      {
        id: 'RU4',
        regra: 'Regra de negocio repetida em dois modulos (fonte dupla de verdade).',
        evidencia: 'grep -n da mesma regra nos dois modulos',
      },
    ],
  },
  architecture: {
    id: 'architecture',
    titulo: 'Arquitetura',
    objetivo: 'Manter as fronteiras do produto legiveis enquanto o MVP cresce.',
    estagioMinimo: 'crescendo',
    fonte: 'codigo',
    referencias: ['references/code-review-axes.md', 'references/definition-of-done.md'],
    evidencias: [
      'o grafo de dependencia do escopo (Graphify quando disponivel, senao grep dirigido de imports)',
      'a fronteira violada nomeada, com o import que a viola',
    ],
    regras: [
      {
        id: 'AR1',
        regra: 'Dependencia ciclica entre modulos.',
        evidencia: 'os imports dos dois lados do ciclo, com arquivo:linha',
      },
      {
        id: 'AR2',
        regra: 'Camada violada: o nucleo importando adaptador, ou a interface importando implementacao.',
        evidencia: 'grep -n do import proibido',
      },
      {
        id: 'AR3',
        regra: 'Responsabilidade sem dono unico: a mesma decisao tomada em dois lugares.',
        evidencia: 'os dois pontos de decisao com arquivo:linha',
      },
      {
        id: 'AR4',
        regra: 'Acoplamento por estado global mutavel entre modulos que deveriam ser independentes.',
        evidencia: 'a variavel de modulo e os pontos de escrita',
      },
      {
        id: 'AR5',
        regra: 'Fronteira externa sem contrato tipado (entrada ou saida em `any`/dicionario solto).',
        evidencia: 'a assinatura no arquivo:linha',
      },
    ],
  },
  'data-model': {
    id: 'data-model',
    titulo: 'Modelo de dados',
    objetivo: 'Evitar que o esquema fique impossivel de corrigir depois que ha dado real dentro.',
    estagioMinimo: 'crescendo',
    fonte: 'codigo',
    referencias: ['references/definition-of-done.md', 'references/testing-patterns.md'],
    evidencias: [
      'o DDL ou a migracao citada com caminho:linha',
      'o passo irreversivel destacado quando o fix tocar dado existente',
    ],
    regras: [
      {
        id: 'DM1',
        regra: 'Indice unico que ignora soft-delete (a linha apagada continua bloqueando a nova).',
        evidencia: 'o indice na migracao e a coluna de soft-delete que ele nao considera',
      },
      {
        id: 'DM2',
        regra: 'Migracao sem rollback declarado.',
        evidencia: 'o arquivo de migracao sem o passo de volta',
      },
      {
        id: 'DM3',
        regra: 'Relacao sem integridade referencial declarada no banco.',
        evidencia: 'a coluna de chave e a ausencia da constraint na migracao',
      },
      {
        id: 'DM4',
        regra: 'Coluna nullable que o codigo trata como obrigatoria (ou o contrario).',
        evidencia: 'o DDL e o uso no codigo, os dois com arquivo:linha',
      },
      {
        id: 'DM5',
        regra: 'Desnormalizacao sem dono declarado da sincronizacao.',
        evidencia: 'os dois lugares onde o mesmo dado e escrito',
      },
    ],
  },
  ux: {
    id: 'ux',
    titulo: 'UX',
    objetivo: 'Cobrir os estados que o builder nao ve na sessao feliz de criacao.',
    estagioMinimo: 'crescendo',
    fonte: 'codigo',
    referencias: ['references/definition-of-done.md', 'references/performance-checklist.md'],
    evidencias: [
      'a tela ou componente com caminho:linha',
      'o estado ausente nomeado (vazio, erro, carregando, sem permissao)',
    ],
    regras: [
      {
        id: 'UX1',
        regra: 'Estado vazio ausente: a lista sem itens nao explica nada ao usuario.',
        evidencia: 'o componente de lista sem ramo para colecao vazia',
      },
      {
        id: 'UX2',
        regra: 'Estado de erro sem acao de saida (o usuario ve o erro e nao tem o que fazer).',
        evidencia: 'o tratamento de erro sem acao de recuperacao',
      },
      {
        id: 'UX3',
        regra: 'Acao demorada sem retorno visual de progresso.',
        evidencia: 'a chamada assincrona sem estado de carregamento associado',
      },
      {
        id: 'UX4',
        regra: 'Acessibilidade abaixo do minimo: foco invisivel, alvo sem rotulo, contraste insuficiente.',
        evidencia: 'o elemento com arquivo:linha e o atributo ausente',
      },
      {
        id: 'UX5',
        regra: 'Acao destrutiva sem confirmacao nem desfazer.',
        evidencia: 'o handler da acao destrutiva',
      },
    ],
  },
  'security-privacy': {
    id: 'security-privacy',
    titulo: 'Seguranca e privacidade (inclui LGPD e superficie de ataque de rede)',
    objetivo:
      'O pack que so entra quando ha usuario real, porque e quando o dado de gente de verdade passa a estar em jogo. Cobre seguranca de codigo, LGPD e a SUPERFICIE DE ATAQUE DE REDE que o produto publica (rotas e endpoints expostos).',
    estagioMinimo: 'maduro',
    fonte: 'codigo',
    referencias: ['references/security-checklist.md', 'references/definition-of-done.md'],
    evidencias: [
      'caminho:linha do ponto exato, NUNCA o segredo ou o dado pessoal em si',
      'o titular do dado e a base legal, quando o achado for de LGPD',
      'nas regras de superficie de rede (SP8..SP12), a saida da varredura deterministica do proprio `ork` (`ork audit surface`), com o framework reconhecido e o nivel de confianca de cada achado',
    ],
    regras: [
      {
        id: 'SP1',
        regra: 'Segredo em codigo, em log ou em arquivo versionado.',
        evidencia: 'o NOME do padrao e o arquivo:linha, com o trecho omitido de proposito',
      },
      {
        id: 'SP2',
        regra: 'LGPD: dado pessoal em log, em telemetria ou em mensagem de erro.',
        evidencia: 'a chamada de log e o campo pessoal que ela carrega',
      },
      {
        id: 'SP3',
        regra: 'LGPD: dado pessoal armazenado sem prazo de retencao declarado.',
        evidencia: 'a tabela ou colecao e a ausencia de politica de expurgo',
      },
      {
        id: 'SP4',
        regra: 'LGPD: coleta sem base legal registrada (consentimento sem registro de quando e do que).',
        evidencia: 'o ponto de coleta e a ausencia do registro de consentimento',
      },
      {
        id: 'SP5',
        regra: 'LGPD: direito de exclusao sem caminho executavel (nao ha como apagar o titular).',
        evidencia: 'a ausencia da rotina de exclusao para os dados do titular',
      },
      {
        id: 'SP6',
        regra: 'Entrada de fronteira externa usada sem validacao.',
        evidencia: 'o handler e o uso direto do dado de entrada',
      },
      {
        id: 'SP7',
        regra: 'Dependencia com vulnerabilidade conhecida no manifesto de pacotes.',
        evidencia: 'a saida real do auditor de dependencias da stack',
      },
      {
        id: 'SP8',
        regra:
          'Superficie de rede: rota de servidor HTTP/API declarada em producao sem camada de autenticacao/autorizacao.',
        evidencia:
          'a definicao da rota com arquivo:linha, o framework reconhecido e o comando que prova a ausencia de guarda no bloco da rota (ou no arquivo inteiro)',
      },
      {
        id: 'SP9',
        regra:
          'Superficie de rede: endpoint privado de administracao ou operacao (admin, console, debug, swagger/openapi, health detalhado, metadados de cluster) exposto sem restricao de rede nem oAuth.',
        evidencia:
          'o endpoint administrativo com arquivo:linha e o comando que prova a ausencia de allowlist de rede, basic auth ou oAuth',
      },
      {
        id: 'SP10',
        regra:
          'Superficie de rede: rota sem limite de taxa, sujeita a brute-force, enumeracao e DDoS de aplicacao.',
        evidencia:
          'a rota com arquivo:linha e o comando que prova a ausencia de middleware de limite, cota ou rpm no bloco e no arquivo',
      },
      {
        id: 'SP11',
        regra:
          'Superficie de rede: CORS permissivo demais (origem global com credenciais habilitadas, ou origem aberta em arquivo que serve rota de dado sensivel).',
        evidencia:
          'a configuracao de CORS com arquivo:linha, o curinga de origem e a flag de credenciais, cada um com o comando que o reexecuta',
      },
      {
        id: 'SP12',
        regra:
          'Superficie de rede: definicao de rota sem esquema/validacao do payload na borda (complementa o SP6, que olha o USO do dado dentro do handler).',
        evidencia:
          'a definicao da rota com arquivo:linha e o comando que prova a ausencia de schema/validador na definicao',
      },
    ],
  },
  process: {
    id: 'process',
    titulo: 'Processo (meta-auditor)',
    objetivo:
      'O unico pack que audita o METODO e nao o produto: le o ledger, os POSTMORTEMs e os MASTER logs e propoe mudanca no proprio Orkastery.',
    estagioMinimo: 'nascente',
    fonte: 'ledger',
    referencias: ['references/definition-of-done.md'],
    evidencias: [
      '.orkastery/threads/<id>/ledger.jsonl com o evento citado',
      '.orkastery/threads/<id>/POSTMORTEM.json e master-log.json quando houver',
    ],
    regras: [
      {
        id: 'PR1',
        regra: 'Entrega sem MASTER log (uma entrega sem MASTER log nao aconteceu).',
        evidencia: 'o evento ship_done no ledger e a ausencia do master-log.json da mesma thread',
      },
      {
        id: 'PR2',
        regra: 'Thread entregue sem score humano registrado, parada na fila de batch.',
        evidencia: 'thread entregue sem master_done.por humano correspondente ao score',
      },
      {
        id: 'PR3',
        regra: 'O mesmo motivo tipado de gate reprovando de novo em threads diferentes.',
        evidencia: 'os eventos gate_blocked com o mesmo motivo, em threads distintas',
      },
      {
        id: 'PR4',
        regra: 'Claim nao-verificavel recorrente: a fase alega e nao declara como comprovar.',
        evidencia: 'as claims com estado nao-verificavel no claims.jsonl das threads',
      },
      {
        id: 'PR5',
        regra: 'Decisao autonoma sem evidencia declarada no ledger.',
        evidencia: 'o evento autonomous_decision sem campo de evidencia',
      },
      {
        id: 'PR6',
        regra: 'Classe de falha recorrente no POSTMORTEM sem controle correspondente.',
        evidencia: 'as classes de falha repetidas nos POSTMORTEMs, com as threads que as levaram',
      },
    ],
  },
};

/** Ordem canonica dos packs: a ordem em que os estagios os ativam. */
export const ORDEM_DOS_PACKS: readonly PackDeAuditoria[] = [
  'clean-code',
  'reuse',
  'architecture',
  'data-model',
  'ux',
  'security-privacy',
  'process',
];

/** Pack valido a partir do texto do usuario, ou null. */
export function parsePack(bruto: string | undefined): PackDeAuditoria | null {
  const alvo = (bruto ?? '').trim().toLowerCase();
  return (ORDEM_DOS_PACKS as readonly string[]).includes(alvo) ? (alvo as PackDeAuditoria) : null;
}

/** Os packs ativos no estagio informado (a coluna "Packs ativos" da visao 5.2). */
export function packsAtivos(estagio: Estagio): PackDeAuditoria[] {
  return ORDEM_DOS_PACKS.filter((p) => alcancou(estagio, PACKS[p].estagioMinimo));
}

/** O pack ja esta ativo neste estagio? */
export function packAtivo(pack: PackDeAuditoria, estagio: Estagio): boolean {
  return alcancou(estagio, PACKS[pack].estagioMinimo);
}

/** Tabela de `ork audit packs`. */
export function tabelaDePacks(estagio?: Estagio): string {
  const linhas = ORDEM_DOS_PACKS.map((id) => {
    const p = PACKS[id];
    const ativo = estagio ? (packAtivo(id, estagio) ? 'sim' : 'nao') : '-';
    return [
      p.id,
      p.estagioMinimo,
      ativo,
      p.fonte,
      String(p.regras.length),
      estagio && packAtivo(id, estagio) ? posturaDoPack(estagio) : '-',
      p.titulo,
    ];
  });
  const cabecalho = tabela(
    ['PACK', 'ATIVO A PARTIR DE', 'ATIVO AQUI', 'FONTE', 'REGRAS', 'POSTURA', 'TITULO'],
    linhas
  );
  const rodape: string[] = ['', 'Hardening por estagio (visao, secao 5.2):'];
  for (const e of ORDEM_DOS_ESTAGIOS) {
    rodape.push(
      `  ${e.padEnd(10)} ${packsAtivos(e).join(', ')}` +
        `\n  ${' '.repeat(10)} postura: ${DESCRICAO_DA_POSTURA[POSTURA_DO_ESTAGIO[e]]}`
    );
  }
  return cabecalho + '\n' + rodape.join('\n');
}

/** Detalhe de um pack: as regras e as evidencias que ele exige. */
export function textoDoPack(pack: PackDeAuditoria, estagio?: Estagio): string {
  const p = PACKS[pack];
  const linhas: string[] = [];
  linhas.push(`Pack ${p.id}: ${p.titulo}`);
  linhas.push(`  ${p.objetivo}`);
  linhas.push(`  ativo a partir do estagio: ${p.estagioMinimo}`);
  linhas.push(`  fonte de evidencia: ${p.fonte === 'ledger' ? 'ledger e MASTER logs' : 'arvore de codigo'}`);
  if (estagio) {
    linhas.push(
      `  neste projeto (stage ${estagio}): ${packAtivo(pack, estagio) ? 'ATIVO' : 'inativo'}` +
        (packAtivo(pack, estagio) ? `, postura ${posturaDoPack(estagio)}` : '')
    );
  }
  linhas.push('');
  linhas.push('  Regras auditadas:');
  for (const r of p.regras) {
    linhas.push(`    ${r.id}  ${r.regra}`);
    linhas.push(`         evidencia: ${r.evidencia}`);
  }
  linhas.push('');
  linhas.push('  Evidencias da rodada:');
  for (const e of p.evidencias) linhas.push(`    - ${e}`);
  linhas.push('');
  linhas.push(`  Checklists normativas citaveis: ${p.referencias.join(', ')}`);
  return linhas.join('\n');
}

// ---------------------------------------------------------------------------
// Governanca de custo (visao, secao 5.3)
// ---------------------------------------------------------------------------

/** `HH:MM` para minutos desde a meia-noite, ou null quando o texto nao e um horario. */
export function minutosDoHorario(bruto: string): number | null {
  const casado = /^(\d{1,2}):(\d{2})$/.exec(bruto.trim());
  if (!casado) return null;
  const h = Number(casado[1]);
  const m = Number(casado[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * A janela ociosa declarada no manifesto, avaliada contra o horario informado.
 *
 * Janela que atravessa a meia-noite (`22:00-06:00`) e o caso comum, entao ela e tratada
 * como intervalo circular. Janela nao declarada NAO vira "sempre pode": ela vira
 * `declarada: false`, e o CLI diz em voz alta que so `eco` e o escopo incremental estao
 * governando o custo daquela rodada.
 */
export function janelaDeCusto(manifesto: Manifesto, quando: Date = new Date()): JanelaDeCusto {
  // I-35: a janela e o "agora" sao do fuso do dono; sem owner.timezone, o do sistema (como antes).
  const fuso = lerFusoDoDono(manifesto.owner?.timezone).fuso;
  const local = partesLocais(quando, fuso);
  const agora = `${local.hora}:${local.minuto}`;
  const rotulo = rotuloDoFuso(fuso, quando);
  const bruta = (manifesto.audit?.janela_ociosa ?? '').trim();
  if (bruta === '') {
    return {
      declarada: false,
      inicio: '',
      fim: '',
      dentro: true,
      agora,
      detalhe:
        'audit.janela_ociosa nao declarada no manifesto: o custo desta rodada e governado apenas por effort eco e escopo incremental',
    };
  }
  const partes = bruta.split('-');
  const inicio = minutosDoHorario(partes[0] ?? '');
  const fim = minutosDoHorario(partes[1] ?? '');
  if (inicio === null || fim === null) {
    return {
      declarada: false,
      inicio: '',
      fim: '',
      dentro: true,
      agora,
      detalhe: `audit.janela_ociosa invalida ("${bruta}"): esperado HH:MM-HH:MM`,
    };
  }
  const minutosAgora = Number(local.hora) * 60 + Number(local.minuto);
  const dentro =
    inicio <= fim
      ? minutosAgora >= inicio && minutosAgora < fim
      : minutosAgora >= inicio || minutosAgora < fim;
  return {
    declarada: true,
    inicio: partes[0].trim(),
    fim: partes[1].trim(),
    dentro,
    agora,
    detalhe: dentro
      ? `${agora} (${rotulo}) esta dentro da janela ociosa ${bruta}`
      : `${agora} (${rotulo}) esta FORA da janela ociosa ${bruta}`,
  };
}

/** O Graphify existe nesta maquina? Fonte externa, nunca suposicao. */
export function graphifyDisponivel(): boolean {
  return noPath('graphify') !== null;
}

/**
 * Traduz a janela do contrato (`7d`, `24h`, `2w`) para o que o git entende.
 *
 * MEDIDO: `git log --since=30d` devolve VAZIO, porque a approxidate do git nao le `30d`;
 * `--since="30 days ago"` devolve os commits. Sem esta traducao, `--since 7d` produziria
 * escopo vazio em silencio, e uma auditoria que nao le nada passaria por auditoria limpa,
 * que e o pior defeito possivel neste bloco. Formato que o git ja entende passa direto.
 */
export function sinceParaGit(bruto: string): string {
  const casado = /^(\d+)\s*([dhwm])$/i.exec(bruto.trim());
  if (!casado) return bruto.trim();
  const unidade = { d: 'days', h: 'hours', w: 'weeks', m: 'months' }[casado[2].toLowerCase()];
  return `${casado[1]} ${unidade} ago`;
}

/**
 * O escopo da rodada.
 *
 * Escopo incremental e a principal alavanca de custo: `--since 7d` faz o auditor ler o que
 * mudou na janela, e nao o repositorio inteiro. Quando o git nao devolve nada (repo novo,
 * janela sem commit), a rodada declara escopo vazio em vez de silenciosamente virar total.
 */
export function escopoDaRodada(
  raiz: string,
  manifesto: Manifesto,
  opcoes: { since?: string; tudo?: boolean; pack?: PackDeAuditoria } = {}
): EscopoDaRodada {
  const graphifyLigado = (manifesto.audit?.graphify ?? 'auto') !== 'off';
  const graphify: EscopoDaRodada['graphify'] = !graphifyLigado
    ? 'desligado'
    : graphifyDisponivel()
      ? 'disponivel'
      : 'ausente';

  if (opcoes.tudo) {
    return {
      since: null,
      incremental: false,
      arquivos: [],
      total: 0,
      graphify,
      detalhe: 'escopo TOTAL pedido com --tudo: a rodada le o produto inteiro (custo maximo)',
    };
  }
  const since = (opcoes.since ?? manifesto.audit?.since_padrao ?? '').trim();
  if (since === '') {
    return {
      since: null,
      incremental: false,
      arquivos: [],
      total: 0,
      graphify,
      detalhe:
        'sem --since e sem audit.since_padrao: escopo total por ausencia de janela declarada',
    };
  }
  const r = exec(
    'git',
    ['log', `--since=${sinceParaGit(since)}`, '--name-only', '--pretty=format:'],
    raiz
  );
  const tocados = [
    ...new Set(
      r.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '')
    ),
  ].sort();
  const arquivos = filtrarPelaFonte(tocados, opcoes.pack);
  const cortados = tocados.length - arquivos.length;
  return {
    since,
    incremental: true,
    arquivos,
    total: arquivos.length,
    graphify,
    detalhe:
      arquivos.length > 0
        ? `escopo incremental: ${arquivos.length} arquivo(s) tocado(s) nos ultimos ${since}` +
          (cortados > 0 ? ` (${cortados} fora da fonte do pack)` : '')
        : `escopo incremental vazio: nenhum arquivo da fonte do pack mudou nos ultimos ${since}`,
  };
}

/**
 * Corta do escopo o que nao pertence a FONTE declarada do pack.
 *
 * Um pack de codigo nao audita o estado do proprio motor (`.orkastery/`), e o meta-auditor
 * `process` audita EXATAMENTE esse estado e nada mais. Sem este corte, uma rodada de
 * clean-code gastaria janela lendo ledger, e o `process` gastaria lendo codigo de produto.
 */
export function filtrarPelaFonte(arquivos: string[], pack?: PackDeAuditoria): string[] {
  if (!pack) return arquivos;
  const doMotor = (a: string): boolean => a.startsWith('.orkastery/') || a.startsWith('docs/audit/');
  return PACKS[pack].fonte === 'ledger' ? arquivos.filter(doMotor) : arquivos.filter((a) => !doMotor(a));
}

// ---------------------------------------------------------------------------
// O template do prompt do auditor
// ---------------------------------------------------------------------------

/** Onde um projeto versiona os prompts dos seus packs (diretorio reservado desde o B0). */
export function dirDeAuditores(raiz: string): string {
  return path.join(raiz, 'auditors');
}

/**
 * O template embutido do prompt de auditoria.
 *
 * Ele nao vive em `TEMPLATES_EMBUTIDOS` de proposito: um prompt de auditoria nao tem fase,
 * nem bloco, nem pausa, e o lint de `ork prompt lint` cobra secoes que so fazem sentido em
 * prompt de fase. O que ele reusa e a maquinaria de template (parse, render, lint), nao o
 * contrato do prompt de fase.
 */
export const TEMPLATE_AUDITORIA_PADRAO = `---
id: auditoria-padrao
versao: 1
descricao: Prompt canonico de uma rodada de auditoria periodica, com as regras do pack, o escopo, a governanca de custo e o bloco obrigatorio de propostas.
variaveis: [pack, titulo, objetivo, produto, perfil, estagio, postura, descricao_da_postura, fonte, rodada, dir_da_rodada, regras, evidencias, referencias, escopo, linha_graphify, effort, linha_janela, comando_de_registro, regras_de_evidencia]
---
# Orkastery, auditoria periodica: pack {{pack}} ({{titulo}})

Voce conduz a rodada {{rodada}} do pack {{pack}} sobre o produto "{{produto}}" (perfil {{perfil}}).

## Objetivo do pack
{{objetivo}}

## Estagio e postura
- estagio declarado do produto: {{estagio}}
- postura desta rodada: {{postura}} ({{descricao_da_postura}})
- fonte de evidencia: {{fonte}}

REGRA CENTRAL DA AUDITORIA: a saida e sempre PROPOSTA DE AJUSTE para o roadmap do produto.
Voce NAO corrige nada, nao commita, nao abre branch e nao roda passo irreversivel.

## Regras auditadas
{{regras}}

## Evidencias exigidas
{{evidencias}}

## Escopo desta rodada (governanca de custo)
{{escopo}}
{{linha_graphify}}
{{linha_janela}}
- esforco desta rodada: {{effort}}

## Checklists normativas citaveis por item
{{referencias}}

## Bloco OBRIGATORIO de propostas
A rodada so termina quando cada achado virar uma proposta enderecada ao roadmap de "{{produto}}",
com os cinco campos: evidencia arquivo:linha, impacto, fix sugerido, passo irreversivel e
estimativa. Achado sem proposta completa e recusado pelo \`ork\`, nao por opiniao.

## Como registrar (o \`ork\` e o unico escritor)
Escreva os achados em {{dir_da_rodada}}/achados.json e registre com:

{{comando_de_registro}}

## Regras de evidencia
{{regras_de_evidencia}}`;

/** Os templates de auditoria que vem dentro do `ork`, por id. */
export const TEMPLATES_DE_AUDITORIA_EMBUTIDOS: Readonly<Record<string, string>> = {
  'auditoria-padrao': TEMPLATE_AUDITORIA_PADRAO,
};

/** As regras de evidencia que valem para todo auditor, em todo pack. */
export const REGRAS_DE_EVIDENCIA_DO_AUDITOR: readonly string[] = [
  'O auditor NAO tem direito a self-report: todo achado carrega o comando que o reexecuta no HEAD real.',
  'Evidencia e arquivo:linha, nunca "varios lugares" nem "o codigo em geral".',
  'Alegacao negativa ou absoluta ("nenhum", "sempre", "zero") SEM comando e reprovada por `ork audit verify`.',
  'Nunca imprima o segredo nem o dado pessoal encontrado: cite o padrao e a posicao.',
  'Nenhum passo irreversivel: a rodada e somente leitura, e a correcao e proposta ao roadmap.',
  'NUNCA altere o estado do git: nada de reset, checkout, restore, stash, add, commit ou branch.',
];

/**
 * Os templates de auditoria que valem para este projeto: o embutido, sobrescrito por
 * `auditors/auditoria-<pack>.md` ou `auditors/auditoria-padrao.md` versionado no projeto.
 */
export function carregarTemplatesDeAuditoria(raiz?: string): TemplateDePrompt[] {
  return carregarTemplatesDe(TEMPLATES_DE_AUDITORIA_EMBUTIDOS, raiz ? dirDeAuditores(raiz) : undefined);
}

/** O template que conduz o pack: o especifico do pack, senao o padrao. */
export function templateDoPack(pack: PackDeAuditoria, raiz?: string): TemplateDePrompt {
  const templates = carregarTemplatesDeAuditoria(raiz);
  const especifico = templates.find((t) => t.id === `auditoria-${pack}`);
  if (especifico) return especifico;
  const padrao = templates.find((t) => t.id === 'auditoria-padrao');
  if (!padrao) throw new Error('template `auditoria-padrao` ausente: o `ork` nao tem prompt de auditoria');
  return padrao;
}

/** Secoes que todo template de auditoria precisa carregar para continuar sendo uma auditoria. */
export const SECOES_OBRIGATORIAS_DE_AUDITORIA: readonly string[] = [
  '## Regras auditadas',
  '## Evidencias exigidas',
  '## Escopo desta rodada',
  '## Bloco OBRIGATORIO de propostas',
  '## Regras de evidencia',
];

/** A frase que nenhum template de auditoria pode perder. */
export const REGRA_CENTRAL_DA_AUDITORIA =
  'REGRA CENTRAL DA AUDITORIA: a saida e sempre PROPOSTA DE AJUSTE para o roadmap do produto.';

/**
 * O contrato do prompt de auditoria, no mesmo formato do contrato do prompt de fase.
 *
 * Um template de auditoria nao tem fase nem pedido do builder (a demanda dele vem do pack),
 * mas tem o bloco obrigatorio de propostas: sem ele a rodada deixaria de ser auditoria e
 * viraria relatorio.
 */
export const CONTRATO_DE_AUDITORIA: ContratoDeTemplate = {
  nome: 'auditoria',
  secoes: SECOES_OBRIGATORIAS_DE_AUDITORIA,
  regraCentral: REGRA_CENTRAL_DA_AUDITORIA,
  variavelObrigatoria: null,
  validaFases: false,
};

/**
 * Lint do template de auditoria.
 *
 * Reusa o `lintTemplate` do B4 trocando SO o contrato: id, versao, descricao, variaveis
 * declaradas versus usadas, segredo no corpo, limite de bytes e idioma continuam valendo,
 * pelas mesmas regras e com o mesmo codigo. Uma copia deste lint ja tinha nascido mais
 * frouxa que a original (sem o limite de bytes e sem o aviso de idioma), e foi o proprio
 * pack `reuse` que apontou isso na rodada ork-reuse-2026-09-03-1.
 */
export function lintTemplateDeAuditoria(t: TemplateDePrompt): ProblemaDeTemplate[] {
  return lintTemplate(t, CONTRATO_DE_AUDITORIA);
}

/** Os valores que o template de auditoria recebe. Nada e calculado dentro do template. */
export function valoresDoPromptDeAuditoria(entrada: {
  pack: PackDeAuditoria;
  produto: string;
  perfil: string;
  estagio: Estagio;
  postura: PosturaDoPack;
  rodada: string;
  dirDaRodada: string;
  escopo: EscopoDaRodada;
  janela: JanelaDeCusto;
  effort: string;
}): Record<string, string> {
  const p = PACKS[entrada.pack];
  const listaDeArquivos =
    entrada.escopo.arquivos.length === 0
      ? ''
      : '\n' +
        entrada.escopo.arquivos.slice(0, 200).map((a) => `  - ${a}`).join('\n') +
        (entrada.escopo.arquivos.length > 200
          ? `\n  - (mais ${entrada.escopo.arquivos.length - 200} arquivo(s) no run.json da rodada)`
          : '');
  return {
    pack: p.id,
    titulo: p.titulo,
    objetivo: p.objetivo,
    produto: entrada.produto,
    perfil: entrada.perfil,
    estagio: entrada.estagio,
    postura: entrada.postura,
    descricao_da_postura: DESCRICAO_DA_POSTURA[entrada.postura],
    fonte: p.fonte === 'ledger' ? 'ledger, POSTMORTEMs e MASTER logs das threads' : 'arvore de codigo do produto',
    rodada: entrada.rodada,
    dir_da_rodada: entrada.dirDaRodada,
    regras: p.regras.map((r) => `- ${r.id}: ${r.regra}\n  evidencia exigida: ${r.evidencia}`).join('\n'),
    evidencias: p.evidencias.map((e) => `- ${e}`).join('\n'),
    referencias: p.referencias.map((r) => `- ${r}`).join('\n'),
    escopo: `- ${entrada.escopo.detalhe}${listaDeArquivos}`,
    linha_graphify:
      entrada.escopo.graphify === 'disponivel'
        ? '- Graphify disponivel nesta maquina: use o mapa do Graphify no lugar da leitura bruta do repositorio.'
        : entrada.escopo.graphify === 'desligado'
          ? '- Graphify desligado no manifesto (audit.graphify: off): leitura dirigida por grep, sem varredura bruta.'
          : '- Graphify ausente nesta maquina: leitura dirigida por grep no escopo acima, nunca varredura bruta do repositorio.',
    linha_janela: `- janela de custo: ${entrada.janela.detalhe}`,
    effort: entrada.effort,
    comando_de_registro: `  ork audit ingest ${entrada.rodada} --arquivo ${entrada.dirDaRodada}/achados.json\n\nO formato de cada achado esta em ${entrada.dirDaRodada}/FORMATO.md.`,
    regras_de_evidencia: REGRAS_DE_EVIDENCIA_DO_AUDITOR.map((r) => `- ${r}`).join('\n'),
  };
}

/** Monta o prompt exato da rodada, renderizando o template versionado do pack. */
export function montarPromptDeAuditoria(
  entrada: Parameters<typeof valoresDoPromptDeAuditoria>[0],
  raiz?: string
): string {
  return renderizar(templateDoPack(entrada.pack, raiz), valoresDoPromptDeAuditoria(entrada));
}
