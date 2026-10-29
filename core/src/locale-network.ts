/**
 * RM-061, fatia F3b: a familia `network` do catalogo de mensagens (`ork network status|entrar|sair|publicar` e o uso),
 * o texto do status da rede, as lacunas que a leitura devolve e as recusas da rede (`rede.ts`, `rede-adesao.ts`,
 * `rede-forja.ts`). O pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * O detalhe de cada lacuna vai ao `--json` e nasce em pt-BR no escopo da leitura (`textoDoCatalogo`); so a impressao o
 * remonta. O nome da maquina, a casa, a forja, o login, a versao e o motivo tipado (`rede.sem-leitura`) sao dado e
 * saem iguais. O retrato publicado, a mensagem de commit e o indice da casa nao mudam com a lingua. `ork network
 * roadmap` segue em pt-BR (G6): o texto dele e contrato com os hosts e com a prova de ativacao.
 */

const NAO_CONSULTADO_EN: Readonly<Record<string, string>> = { roadmap: 'roadmap', reservas: 'reservations', threads: 'threads' };
/** A parte da lacuna (`ParteDaRede`) dita em ingles no detalhe; o `--json` guarda o identificador. */
const PARTES_EN: Readonly<Record<string, string>> = { projeto: 'project', roadmap: 'roadmap', reservas: 'reservations',
  fabrica: 'factory', 'estado-local': 'local state', forja: 'forge', registro: 'project registry', rede: 'network' };
const DIR_ROADMAP_LITERAL = 'docs/roadmap';

export const NETWORK_PT_BR = {
  // ork network status
  cabecalhoComCasa: (dono: string, forja: string, ref: string, estado: string) => `Orkastery Network de ${dono} · ${forja}: ${ref} · ${estado}`,
  casaLidaAgora: 'lida agora',
  casaUltimaCopia: 'última cópia local',
  casaNaoLida: 'não lida',
  semCasa: 'Orkastery Network · sem casa: nenhuma forja com login nesta máquina',
  repositorioDaRede: (ponta: string | null) => `repositório da rede (${ponta ?? 'vazio'})`,
  fabricaDe: (projeto: string, ref: string, atualizado: boolean) => `fábrica de ${projeto} (${ref}, ${atualizado ? 'lida agora' : 'última cópia'})`,
  consultado: (lista: string | null) => `Consultado: ${lista ?? 'nada (veja as lacunas)'}.`,
  naoConsultado: (lista: string) => `Não consultado: ${lista}. O roadmap de um projeto sai do ork roadmap status nele.`,
  /** O que a leitura nao olha (dado do `--json`), como o texto o mostra. */
  itemNaoConsultado: (item: string) => item,
  nenhumaMaquina: 'Nenhuma máquina lida. Isso não quer dizer que não há máquinas: veja as lacunas.',
  outraInstalacao: ' (outra instalação com o nome desta máquina)',
  estaMaquina: ' (esta máquina)',
  origemRede: (herdada: boolean) => `rede${herdada ? ', adesão herdada da fábrica' : ''}`,
  origemFabrica: (projetos: string) => `vista só na fábrica de ${projetos}; sem retrato na rede`,
  membro: (maquina: string, esta: string, origem: string, batida: string, idade: string) =>
    `${maquina}${esta} · ${origem} · batida ${batida} (há ${idade})`,
  fichaHostname: (hostname: string) => `hostname ${hostname}`,
  fichaOrk: (versao: string) => `ork ${versao}`,
  fichaForja: (forja: string, usuario: string | null) => `${forja}: ${usuario ?? 'sem login'}`,
  fichaPessoa: (pessoa: string) => `pessoa ${pessoa}`,
  runtimes: (lista: string) => `  runtimes: ${lista}`,
  hosts: (lista: string) => `  hosts: ${lista}`,
  hostAdaptador: (adaptador: string) => ` (adaptador ${adaptador})`,
  projetos: (lista: string) => `  projetos: ${lista}`,
  projetoEm: (caminho: string) => ` em ${caminho}`,
  estaEMembro: (maquina: string, herdado: boolean, publicada: boolean) => `Esta máquina (${maquina}) é membro` +
    `${herdado ? ', herdado da fábrica' : ''}${publicada ? '.' : '; o retrato dela ainda não está na casa.'}`,
  foraDaRedeLinha: (maquina: string) => `Esta máquina (${maquina}) não está na rede: ork network entrar.`,
  semLacunas: 'Lacunas: nenhuma.',
  lacunas: (n: number) => `Lacunas (${n}), o que faltou ler:`,
  lacuna: (tipo: string, detalhe: string) => `  • ${tipo}: ${detalhe}`,
  // As lacunas que a leitura devolve (o detalhe vai ao `--json` em pt-BR).
  semRedeSemCasa: 'sem rede e sem casa conhecida nesta maquina: rode sem --sem-remoto',
  casaNaoExiste: (ref: string) => `${ref} ainda nao existe: nenhuma maquina rodou ork network entrar`,
  casaPublica: (ref: string) => `${ref} nao e privado: nenhuma maquina publica nele`,
  casaSemHttps: (ref: string) => `${ref}: a forja devolveu uma URL sem https; a rede so fala por https (vale a ultima copia local, quando ha)`,
  comErro: (ref: string, erro: string) => `${ref}: ${erro}`,
  // O retrato de maquina que a leitura deixa de fora (`lerRetratos`, em `rede.ts`): a lacuna `retrato.invalido`
  retratoInvalido: (arquivo: string, motivo: string) => `${arquivo}: ${motivo}`,
  retratoForaDoPadrao: 'nome de arquivo fora do padrao maquinas/<maquina>.json',
  retratoIlegivel: 'JSON ilegivel',
  retratoForaDoContrato: (contrato: string) => `fora do contrato ${contrato}`,
  retratoDeOutraMaquina: (maquina: string) => `diz ser a maquina "${maquina}", que nao e a dona deste arquivo`,
  retratoProjetosOmitidos: (n: number, padrao: string) => `${n} projeto(s) fora da leitura: padrao "${padrao}" (valor omitido de proposito)`,
  retratoComSegredo: (padrao: string, onde: string) => `padrao "${padrao}" em ${onde} (valor omitido de proposito)`,
  semLeituraNova: (ref: string, temCopia: boolean) =>
    `${ref} sem leitura nova: ${temCopia ? 'mostrando a ultima copia local' : 'nenhuma copia local'}`,
  nuncaLida: (ref: string) => `${ref} nunca foi lida nesta maquina`,
  semClone: (nome: string, caminho: string) => `${nome}: ${caminho} nao tem mais o projeto nesta maquina`,
  remotoInvalido: (nome: string, remoto: string) => `${nome}: fabrica.remoto ${remoto} nao e nome de remoto do git; nada foi lido pelo git`,
  semRemoto: (nome: string, remoto: string) => `${nome}: sem o remoto ${remoto}, nao ha fabrica compartilhada para ler`,
  fabricaSemLeituraNova: (nome: string, branch: string) => `${nome}: ${branch} sem leitura nova; usei a ultima copia local`,
  nomeEmUsoNaCasa: (maquina: string) => `o retrato "${maquina}" na casa e de outra instalacao: esta maquina nao ` +
    'publica ate trocar de nome (ork network entrar --maquina NOME) ou retomar este (ork network entrar --forcar)',
  batidaIlegivel: (maquina: string) => `${maquina}: batida ilegivel`,
  semBatidaHa: (maquina: string, idade: string) => `${maquina}: sem batida ha ${idade}`,
  // A casa (resolverCasa) e a forja.
  cliAusente: (forja: string) => `a CLI da forja ${forja} nao esta nesta maquina`,
  nenhumaCli: 'nenhuma CLI de forja (gh ou glab) nesta maquina',
  loginNaoLido: (falhas: string) => `${falhas}; o login nao foi lido, rode de novo com a forja respondendo`,
  semLogin: (candidatas: readonly { nome: string; cli: string; host: string }[]) => {
    const partes = candidatas.map((c) => (c.nome === 'gitlab' ? `${c.cli} sem login no ${c.host}` : `${c.cli} sem login nesta maquina`) + ` (${c.cli} auth login)`);
    const noPadrao = candidatas.some((c) => c.nome === 'gitlab' && c.host === 'gitlab.com');
    return partes.join('; ') + (noPadrao ? '; um GitLab proprio exige GITLAB_HOST=<host>' : '');
  },
  respostaSemLogin: (cli: string) => `${cli} api user devolveu uma resposta sem login legivel`,
  semRespostaNoPrazo: 'sem resposta da forja no prazo',
  apiFalhou: (cli: string, rota: string, linha: string) => `rede.forja: ${cli} api ${rota} falhou${linha ? `: ${linha}` : ''}`,
  repositorioIlegivel: 'rede.forja: gh devolveu um repositorio ilegivel',
  projetoIlegivel: 'rede.forja: glab devolveu um projeto ilegivel',
  projetoEmOutroCaminho: (pedido: string, criado: string) => `rede.forja: o GitLab criou o projeto em ${criado}, e não em ${pedido}; confira o grupo e apague o que sobrou`,
  // As recusas da rede (rede.ts e rede-adesao.ts).
  foraDoContrato: (onde: string) => `rede.segredo: ${onde} fora do contrato; nada foi publicado`,
  campoForaDaLista: (campo: string) => `rede.segredo: campo "${campo}" fora da lista de permissao; nada foi publicado`,
  campoLongo: (campo: string) => `rede.segredo: campo "${campo}" longo demais; nada foi publicado`,
  contratoDoRetrato: 'rede.contrato: o retrato desta maquina nao passa no contrato ork.rede-maquina/v1; nada foi publicado',
  segredoNoRetrato: (padrao: string, onde: string) => `rede.segredo: padrao "${padrao}" em ${onde}; nada foi publicado (valor omitido de proposito)`,
  retratoAlheio: (maquina: string, caminho: string, proprio: string) =>
    `rede.retrato-alheio: ${maquina} tentou gravar ${caminho}; cada maquina so escreve ${proprio}`,
  semForja: (detalhe: string | null) => `rede.sem-forja: ${detalhe ?? 'nenhuma forja utilizavel'}`,
  semRepositorio: (ref: string) => `rede.sem-repositorio: ${ref} ainda nao existe; ork network entrar o cria, privado`,
  repositorioAlheio: (ref: string, login: string | null) =>
    `rede.repositorio-alheio: ${ref} nao existe e nao e do login ${login}; crie o repositorio privado na forja e rode de novo`,
  gitlabNaoSuportado: (motivo: 'subcaminho' | 'ca') =>
    `rede.forja-nao-suportada: a casa da rede num GitLab ${motivo === 'ca' ? 'com CA propria (GLAB_CA_CERT)' : 'em subcaminho (GITLAB_HOST com caminho)'} ` +
    'ainda nao e suportada; o rede.json guarda so host[:porta]. Use um GitLab na raiz do host e com certificado publico',
  grupoSemNivel: (ref: string, grupo: string, login: string | null, nivel: number) =>
    `rede.repositorio-alheio: ${ref} nao existe, e o login ${login} tem nivel ${nivel} no grupo ${grupo}; criar a casa num grupo pede ` +
    'Maintainer (40) ou acima',
  repositorioPublico: (ref: string) => `rede.repositorio-publico: ${ref} nao e privado; nada foi publicado`,
  semUrl: (cli: string, ref: string) => `rede.forja: ${cli} nao devolveu a URL de ${ref}`,
  semHttps: (cli: string, ref: string) =>
    `rede.sem-https: ${cli} devolveu para ${ref} uma URL sem https; a rede so fala com a forja por https, e nada foi publicado`,
  saiuDaRede: 'rede.fora: esta maquina saiu da rede; nada foi publicado',
  semLeitura: (ref: string) => `rede.sem-leitura: nao consegui ler ${ref}; publicar exige rede`,
  nomeEmUso: (maquina: string, quem: string, dica: string) => `rede.nome-em-uso: outra instalacao ja publica como "${maquina}"${quem}${dica}`,
  quemHostname: (hostname: string, batida: string) => ` (hostname ${hostname}, batida ${batida})`,
  quemIlegivel: ' (num retrato que esta versao nao le)',
  dicaMesmoHostname: '; o retrato tem o hostname desta maquina: se for ela mesma, com ~/.orkastery apagada ou copiada, retome o nome com ' +
    'ork network entrar --forcar; se for outra maquina ou instalacao com o mesmo hostname, escolha outro nome com --maquina NOME',
  dicaOutroNome: '; escolha outro nome com ork network entrar --maquina NOME, ou tome este com --forcar',
  concorrencia: (n: number) => `rede.concorrencia: ${n} pushes recusados seguidos; tente de novo em instantes`,
  foraDaRede: 'rede.fora: esta maquina nao esta na rede; ork network entrar',
  nomeInvalido: (maquina: string) =>
    `rede.maquina: nome de maquina invalido ("${maquina}"); use ork network entrar --maquina NOME (letras, numeros, ponto, _ ou -)`,
  nomeGenericoAusente: 'rede.maquina-generica: escolha um nome generico com ork network entrar --maquina maquina-a; ' +
    'o mapa fica somente em ~/.orkastery/maquina.json, fora do git',
  ocupadoAoEntrar: (trava: string) =>
    `rede.ocupado: outra publicacao desta maquina esta em andamento (${trava}); rode ork network entrar de novo em instantes`,
  semHttpsAoSair: (cli: string, ref: string) =>
    `rede.sem-https: saiu da rede aqui, mas ${cli} devolveu para ${ref} uma URL sem https; o retrato fica na casa`,
  ocupadoAoSair: (trava: string) =>
    `rede.ocupado: saiu da rede aqui, mas outra publicacao desta maquina segura a casa (${trava}); rode ork network sair de novo`,
  semLeituraAoSair: (ref: string) =>
    `rede.sem-leitura: saiu da rede aqui, mas nao consegui ler ${ref} para tirar o retrato; rode ork network sair de novo com rede`,
  hostInvalido: (host: string | null) => `rede.config: host invalido ("${host}")`,
  campoInvalido: (campo: string, valor: string) => `rede.config: ${campo} invalido ("${valor}")`,
  idNaoGravou: (arquivo: string) => `rede.id: nao consegui gravar nem ler ${arquivo}`,
  idNaoArquivo: (arquivo: string) => `rede.id: ${arquivo} nao e um arquivo; apague-o e rode de novo`,
  // ork network roadmap. As tres primeiras linhas e `clone em` sao contrato com os hosts e ficam fora daqui.
  roadmap: {
    uso: 'uso: ork network roadmap [--projeto <caminho|github:dono/repo|gitlab:grupo/repo|nome>] [--json] [--sem-remoto]',
    contratoInvalido: 'panorama da rede: contrato inválido',
    candidatos: 'Candidatos:',
    recusaDetalhe: (_codigo: string, detalhe: string) => detalhe,
    recusaCorrecao: (_codigo: string, correcao: string) => correcao,
    nadaForaDoPedido: '• nada fora do pedido',
    naoConsultado: (item: string) => `• ${item}`,
    redePorPessoa: 'Rede por pessoa (RM-053)',
    lacunasDaConsulta: 'Lacunas da consulta',
    roadmapNaoLido: (projeto: string, tipos: string) => `Roadmap do ${projeto}: não lido (${tipos}).`,
    semFonte: 'sem fonte',
    threadsPorMaquina: 'Threads por máquina',
    reservas: 'Reservas',
    fontes: 'Fontes',
    lacunas: 'Lacunas',
    nenhumaFonte: '• nenhuma fonte lida',
    nenhumaLacuna: '• nenhuma: todas as fontes foram lidas agora',
    nesteProjeto: (legenda: string) => `Neste projeto: ${legenda}`,
    fonteParte: (parte: string) => ({ roadmap: 'roadmap', reservas: 'reservas', fabrica: 'fábrica', 'estado-local': 'esta máquina' } as Record<string,string>)[parte] ?? parte,
    lidoAgora: 'lido agora',
    lidoEm: (quando: string) => `lido ${quando}`,
    fonteLocal: (parte: string, onde: string, lido: string) => `• ${parte}: estado local em ${onde}, ${lido}`,
    fonteInexistente: (parte: string, onde: string, lido: string) => `• ${parte}: ${onde} não existe, ${lido}`,
    alvoDoRoadmap: (onde: string) => `${DIR_ROADMAP_LITERAL} em ${onde}`,
    fonteCommit: (parte: string, alvo: string, commit: string, data: string, estado: string) =>
      `• ${parte}: ${alvo} @ ${commit} (commit de ${data}), ${estado}`,
    ultimaCopia: 'última cópia desta máquina, sem leitura nova',
    maquinasNaoLidas: '• não lidas: veja as lacunas',
    nenhumaMaquinaNaFabrica: '• nenhuma máquina publicou em ork/fabrica-estado',
    estaMaquina: ' (esta máquina)',
    maquinaSoNaRede: (quem: string, retrato: string, idade: string, semBatida: boolean, branch: string) =>
      `• ${quem}: threads não lidas, na rede por pessoa (retrato de ${retrato}, há ${idade}${semBatida ? ', SEM BATIDA' : ''}) e sem retrato em ${branch}`,
    estadoLocalAgora: 'estado local lido agora',
    retrato: (quando: string, idade: string, semBatida: boolean) => `retrato de ${quando} (há ${idade})${semBatida ? ', SEM BATIDA' : ''}`,
    resumoMaquina: (quem: string, ativas: number, semMaster: number, batida: string) =>
      `• ${quem}: ${ativas} ativa(s)${semMaster ? `, ${semMaster} entregue(s) sem MASTER` : ''}, ${batida}`,
    semItem: 'sem item',
    esperaVoce: (pergunta: string) => ` · espera você: ${pergunta}`,
    veredito: 'veredito',
    reservasNaoLidas: '• não lidas: veja as lacunas',
    nenhumaReserva: '• nenhuma reserva em ork/roadmap-reservas',
    reserva: (item: string, maquina: string, thread: string, desde: string) => `  ${item} · ${maquina} · ${thread} · desde ${desde}`,
    semThread: 'sem thread',
    redeLidaAgora: 'lida agora',
    redeLidaEm: (quando: string) => `lida ${quando}`,
    casaAusente: '• casa: nenhuma achada (veja as lacunas)',
    casaNaoLida: (casa: string) => `• casa: ${casa}, não lida (veja as lacunas)`,
    casaLida: (casa: string, ponta: string, estado: string) => `• casa: ${casa} @ ${ponta}, ${estado}`,
    semCommit: 'sem commit',
    casaUltimaCopia: 'última cópia desta máquina, sem leitura nova',
    nenhumRetrato: '• nenhum retrato lido na casa; isso não quer dizer que não há máquinas: veja as lacunas',
    membro: (maquina: string, esta: string, quando: string, idade: string, semBatida: boolean, versao: string, projetos: string) =>
      `• ${maquina}${esta}: retrato de ${quando}${idade}${semBatida ? ', SEM BATIDA' : ''}${versao}, ${projetos}`,
    batidaIlegivel: ' (batida ilegível)',
    idade: (idade: string) => ` (há ${idade})`,
    versao: (versao: string) => `, ork ${versao}`,
    projetos: (projetos: string) => `projetos: ${projetos}`,
    nenhumProjeto: 'nenhum projeto declarado aqui',
    lacuna: (tipo: string, alvo: string, detalhe: string, correcao: string) =>
      `• ${tipo}${alvo}: ${detalhe}. O que fazer: ${correcao}.`,
    lacunaDetalhe: (_tipo: string, _parte: string, _alvo: string | undefined, detalhe: string) => detalhe,
    lacunaCorrecao: (_tipo: string, correcao: string) => correcao,
  },
  // O CLI
  uso: 'uso: ork network [status] [--json] [--sem-remoto] | network entrar [--maquina NOME] [--forja github|gitlab] ' +
    '[--repositorio [DONO/]NOME] [--forcar] | network publicar [--forcar] [--json] | network sair | ' +
    'network roadmap [--projeto P] [--json] [--sem-remoto]',
  entrou: (maquina: string, dono: string, forja: string, ref: string, criado: boolean) =>
    `Rede: ${maquina} entrou na Orkastery Network de ${dono} (${forja}: ${ref}, privado${criado ? ', criado agora' : ''}).`,
  primeiroRetrato: (commit: string) => `  Primeiro retrato publicado (${commit}). Depois, esta maquina publica sozinha na batida do pulse`,
  tomouNome: (maquina: string) => `  Tomou o nome "${maquina}" de outra instalacao; o commit registra.`,
  eAoCriar: '  e ao criar thread, despachar fase, entregar e fechar. De qualquer maquina desta pessoa: ork network status',
  avisoDescartado: (padrao: string, campo: string) =>
    `  AVISO: um projeto ficou fora do retrato: padrao "${padrao}" em ${campo} (valor omitido de proposito).`,
  avisoOrkMaquina: (valor: string) => `  AVISO: ORK_MAQUINA=${valor} neste shell vence o nome gravado; alinhe os dois.`,
  saiu: (maquina: string, resto: string) => `Rede: ${maquina} saiu; nada mais e publicado daqui.${resto}`,
  retratoRemovido: (casa: string | null, commit: string) => ` Retrato removido de ${casa} (${commit}).`,
  retratoDeOutraInstalacao: (maquina: string, casa: string | null, mesmoHostname: boolean) =>
    ` O retrato "${maquina}" em ${casa} e de outra instalacao com o mesmo nome; nada foi removido.` +
    (mesmoHostname ? ' Ele tem o hostname desta maquina: se ~/.orkastery foi apagada, retome o nome com ork network entrar --forcar.' : ''),
  semRetrato: (casa: string | null) => ` Nao havia retrato desta maquina${casa ? ` em ${casa}` : ' numa casa alcancavel'}.`,
  fabricaContinua: '  A fabrica compartilhada dos projetos continua publicando daqui (ork/fabrica-estado); ork fabrica sair em cada um para parar.',
  publicou: (maquina: string, casa: string | null, commit: string | undefined, tentativas: number) =>
    `Rede: ${maquina} publicou o retrato em ${casa} (${commit}, ${tentativas} tentativa(s)).`,
  ocupado: 'Rede: outra publicacao desta maquina esta em andamento; tente de novo em instantes.',
  igual: (maquina: string, casa: string | null) =>
    `Rede: retrato de ${maquina} igual ao ultimo publicado em ${casa}; nada a enviar (use --forcar para publicar mesmo assim).`,
};

export type MensagensDeNetwork = typeof NETWORK_PT_BR;

export const NETWORK_EN: MensagensDeNetwork = {
  cabecalhoComCasa: (dono, forja, ref, estado) => `Orkastery Network of ${dono} · ${forja}: ${ref} · ${estado}`,
  casaLidaAgora: 'read now',
  casaUltimaCopia: 'last local copy',
  casaNaoLida: 'not read',
  semCasa: 'Orkastery Network · no home: no forge with a login on this machine',
  repositorioDaRede: (ponta) => `network repository (${ponta ?? 'empty'})`,
  fabricaDe: (projeto, ref, atualizado) => `factory of ${projeto} (${ref}, ${atualizado ? 'read now' : 'last copy'})`,
  consultado: (lista) => `Queried: ${lista ?? 'nothing (see the gaps)'}.`,
  naoConsultado: (lista) => `Not queried: ${lista}. The roadmap of a project comes from \`ork roadmap status\` in it.`,
  itemNaoConsultado: (item) => NAO_CONSULTADO_EN[item] ?? item,
  nenhumaMaquina: 'No machine read. That does not mean there are no machines: see the gaps.',
  outraInstalacao: ' (another installation with this machine\'s name)',
  estaMaquina: ' (this machine)',
  origemRede: (herdada) => `network${herdada ? ', membership inherited from the factory' : ''}`,
  origemFabrica: (projetos) => `seen only in the factory of ${projetos}; no snapshot in the network`,
  membro: (maquina, esta, origem, batida, idade) => `${maquina}${esta} · ${origem} · heartbeat ${batida} (${idade} ago)`,
  fichaHostname: (hostname) => `hostname ${hostname}`,
  fichaOrk: (versao) => `ork ${versao}`,
  fichaForja: (forja, usuario) => `${forja}: ${usuario ?? 'no login'}`,
  fichaPessoa: (pessoa) => `person ${pessoa}`,
  runtimes: (lista) => `  runtimes: ${lista}`,
  hosts: (lista) => `  hosts: ${lista}`,
  hostAdaptador: (adaptador) => ` (adapter ${adaptador})`,
  projetos: (lista) => `  projects: ${lista}`,
  projetoEm: (caminho) => ` in ${caminho}`,
  estaEMembro: (maquina, herdado, publicada) => `This machine (${maquina}) is a member` +
    `${herdado ? ', inherited from the factory' : ''}${publicada ? '.' : '; its snapshot is not in the home yet.'}`,
  foraDaRedeLinha: (maquina) => `This machine (${maquina}) is not in the network: \`ork network entrar\`.`,
  semLacunas: 'Gaps: none.',
  lacunas: (n) => `Gaps (${n}), what was not read:`,
  lacuna: (tipo, detalhe) => `  • ${tipo}: ${detalhe}`,
  semRedeSemCasa: 'no network and no known home on this machine: run without `--sem-remoto`',
  casaNaoExiste: (ref) => `${ref} does not exist yet: no machine has run \`ork network entrar\``,
  casaPublica: (ref) => `${ref} is not private: no machine publishes to it`,
  casaSemHttps: (ref) => `${ref}: the forge returned a URL without https; the network only talks over https (the last local copy counts, when there is one)`,
  comErro: (ref, erro) => `${ref}: ${erro}`,
  retratoInvalido: (arquivo, motivo) => `${arquivo}: ${motivo}`,
  retratoForaDoPadrao: 'file name outside the maquinas/<machine>.json pattern',
  retratoIlegivel: 'unreadable JSON',
  retratoForaDoContrato: (contrato) => `does not follow the ${contrato} contract`,
  retratoDeOutraMaquina: (maquina) => `claims to be machine "${maquina}", which does not own this file`,
  retratoProjetosOmitidos: (n, padrao) => `${n} project(s) left out of the read: pattern "${padrao}" (value omitted on purpose)`,
  retratoComSegredo: (padrao, onde) => `pattern "${padrao}" in ${onde} (value omitted on purpose)`,
  semLeituraNova: (ref, temCopia) => `${ref} not read again: ${temCopia ? 'showing the last local copy' : 'no local copy'}`,
  nuncaLida: (ref) => `${ref} was never read on this machine`,
  semClone: (nome, caminho) => `${nome}: ${caminho} no longer has the project on this machine`,
  remotoInvalido: (nome, remoto) => `${nome}: \`fabrica.remoto\` ${remoto} is not a git remote name; git read nothing`,
  semRemoto: (nome, remoto) => `${nome}: without the remote ${remoto}, there is no shared factory to read`,
  fabricaSemLeituraNova: (nome, branch) => `${nome}: ${branch} not read again; used the last local copy`,
  nomeEmUsoNaCasa: (maquina) => `the snapshot "${maquina}" in the home belongs to another installation: this machine does not ` +
    'publish until it changes its name (`ork network entrar --maquina NAME`) or takes this one back (`ork network entrar --forcar`)',
  batidaIlegivel: (maquina) => `${maquina}: unreadable heartbeat`,
  semBatidaHa: (maquina, idade) => `${maquina}: no heartbeat for ${idade}`,
  cliAusente: (forja) => `the ${forja} forge CLI is not on this machine`,
  nenhumaCli: 'no forge CLI (gh or glab) on this machine',
  loginNaoLido: (falhas) => `${falhas}; the login was not read, run again with the forge responding`,
  semLogin: (candidatas) => {
    const partes = candidatas.map((c) => (c.nome === 'gitlab' ? `${c.cli} without a login on ${c.host}` : `${c.cli} without a login on this machine`) + ` (\`${c.cli} auth login\`)`);
    const noPadrao = candidatas.some((c) => c.nome === 'gitlab' && c.host === 'gitlab.com');
    return partes.join('; ') + (noPadrao ? '; a self-hosted GitLab needs GITLAB_HOST=<host>' : '');
  },
  respostaSemLogin: (cli) => `${cli} api user returned a response without a readable login`,
  semRespostaNoPrazo: 'no answer from the forge in time',
  apiFalhou: (cli, rota, linha) => `rede.forja: ${cli} api ${rota} failed${linha ? `: ${linha}` : ''}`,
  repositorioIlegivel: 'rede.forja: gh returned an unreadable repository',
  projetoIlegivel: 'rede.forja: glab returned an unreadable project',
  projetoEmOutroCaminho: (pedido, criado) => `rede.forja: GitLab created the project at ${criado}, not at ${pedido}; check the group and delete the leftover`,
  foraDoContrato: (onde) => `rede.segredo: ${onde} is outside the contract; nothing was published`,
  campoForaDaLista: (campo) => `rede.segredo: field "${campo}" is not on the allow list; nothing was published`,
  campoLongo: (campo) => `rede.segredo: field "${campo}" is too long; nothing was published`,
  contratoDoRetrato: 'rede.contrato: this machine\'s snapshot does not pass the ork.rede-maquina/v1 contract; nothing was published',
  segredoNoRetrato: (padrao, onde) => `rede.segredo: pattern "${padrao}" in ${onde}; nothing was published (value left out on purpose)`,
  retratoAlheio: (maquina, caminho, proprio) => `rede.retrato-alheio: ${maquina} tried to write ${caminho}; each machine only writes ${proprio}`,
  semForja: (detalhe) => `rede.sem-forja: ${detalhe ?? 'no usable forge'}`,
  semRepositorio: (ref) => `rede.sem-repositorio: ${ref} does not exist yet; \`ork network entrar\` creates it, private`,
  repositorioAlheio: (ref, login) =>
    `rede.repositorio-alheio: ${ref} does not exist and does not belong to the login ${login}; create the private repository on the forge and run again`,
  gitlabNaoSuportado: (motivo) =>
    `rede.forja-nao-suportada: the network home on a GitLab ${motivo === 'ca' ? 'with its own CA (GLAB_CA_CERT)' : 'under a subpath (GITLAB_HOST with a path)'} ` +
    'is not supported yet; rede.json stores only host[:port]. Use a GitLab at the host root with a public certificate',
  grupoSemNivel: (ref, grupo, login, nivel) =>
    `rede.repositorio-alheio: ${ref} does not exist, and the login ${login} has level ${nivel} in the group ${grupo}; creating the ` +
    'network home in a group needs Maintainer (40) or above',
  repositorioPublico: (ref) => `rede.repositorio-publico: ${ref} is not private; nothing was published`,
  semUrl: (cli, ref) => `rede.forja: ${cli} did not return the URL of ${ref}`,
  semHttps: (cli, ref) => `rede.sem-https: ${cli} returned a URL without https for ${ref}; the network only talks to the forge over https, and nothing was published`,
  saiuDaRede: 'rede.fora: this machine left the network; nothing was published',
  semLeitura: (ref) => `rede.sem-leitura: could not read ${ref}; publishing needs the network`,
  nomeEmUso: (maquina, quem, dica) => `rede.nome-em-uso: another installation already publishes as "${maquina}"${quem}${dica}`,
  quemHostname: (hostname, batida) => ` (hostname ${hostname}, heartbeat ${batida})`,
  quemIlegivel: ' (in a snapshot this version does not read)',
  dicaMesmoHostname: '; the snapshot has this machine\'s hostname: if it is this machine, with ~/.orkastery deleted or copied, take the name back with ' +
    '`ork network entrar --forcar`; if it is another machine or installation with the same hostname, pick another name with `--maquina NAME`',
  dicaOutroNome: '; pick another name with `ork network entrar --maquina NAME`, or take this one with `--forcar`',
  concorrencia: (n) => `rede.concorrencia: ${n} pushes refused in a row; try again in a moment`,
  foraDaRede: 'rede.fora: this machine is not in the network; `ork network entrar`',
  nomeInvalido: (maquina) => `rede.maquina: invalid machine name ("${maquina}"); use \`ork network entrar --maquina NAME\` (letters, digits, dot, _ or -)`,
  nomeGenericoAusente: 'rede.maquina-generica: choose a generic name with `ork network entrar --maquina maquina-a`; ' +
    'the mapping stays only in ~/.orkastery/maquina.json, outside git',
  ocupadoAoEntrar: (trava) => `rede.ocupado: another publication from this machine is in progress (${trava}); run \`ork network entrar\` again in a moment`,
  semHttpsAoSair: (cli, ref) => `rede.sem-https: left the network here, but ${cli} returned a URL without https for ${ref}; the snapshot stays in the home`,
  ocupadoAoSair: (trava) => `rede.ocupado: left the network here, but another publication from this machine holds the home (${trava}); run \`ork network sair\` again`,
  semLeituraAoSair: (ref) => `rede.sem-leitura: left the network here, but could not read ${ref} to remove the snapshot; run \`ork network sair\` again with the network`,
  hostInvalido: (host) => `rede.config: invalid host ("${host}")`,
  campoInvalido: (campo, valor) => `rede.config: invalid ${campo} ("${valor}")`,
  idNaoGravou: (arquivo) => `rede.id: could not write or read ${arquivo}`,
  idNaoArquivo: (arquivo) => `rede.id: ${arquivo} is not a file; delete it and run again`,
  roadmap: {
    uso: 'usage: ork network roadmap [--projeto <path|github:owner/repo|gitlab:group/repo|name>] [--json] [--sem-remoto]',
    contratoInvalido: 'network roadmap: invalid contract',
    candidatos: 'Candidates:',
    recusaDetalhe: (codigo) => ({
      'projeto.desconhecido': 'the requested project is unknown from this machine',
      'projeto.ambiguo': 'the requested project matches more than one known project',
      'projeto.sem-manifesto': 'the requested project has no readable manifest',
    } as Record<string,string>)[codigo] ?? 'the project request was refused',
    recusaCorrecao: (codigo) => codigo === 'projeto.ambiguo'
      ? 'request the project by an exact registered name, clone path, or forge reference'
      : 'register the clone or request it as `github:owner/repo` or `gitlab:group/repo`',
    nadaForaDoPedido: '• nothing outside the request',
    naoConsultado: (item) => {
      const projeto = /^projeto (.+?): fora do pedido/.exec(item)?.[1];
      if (projeto) return `• project ${projeto}: outside the request (\`--projeto\`)`;
      if (item.startsWith('registro de projetos')) return '• this machine\'s project registry was not read because it is absent';
      if (item.startsWith('diretório do host')) return '• the host directory is outside this machine\'s project registry and was not read';
      if (item.startsWith('rede por pessoa')) return '• the person network was not read; machines may still exist in each project factory';
      if (item.startsWith('outros projetos desta máquina')) return '• other projects on this machine: this MCP server reads only its installed project';
      return '• an additional source was not queried; see the typed gaps below';
    },
    redePorPessoa: 'Person network (RM-053)',
    lacunasDaConsulta: 'Query gaps',
    roadmapNaoLido: (projeto, tipos) => `Roadmap of ${projeto}: not read (${tipos}).`,
    semFonte: 'no source',
    threadsPorMaquina: 'Threads by machine',
    reservas: 'Reservations',
    fontes: 'Sources',
    lacunas: 'Gaps',
    nenhumaFonte: '• no source read',
    nenhumaLacuna: '• none: all sources were read now',
    nesteProjeto: (legenda) => `In this project: ${legenda}`,
    fonteParte: (parte) => ({ roadmap: 'roadmap', reservas: 'reservations', fabrica: 'factory', 'estado-local': 'this machine' } as Record<string,string>)[parte] ?? parte,
    lidoAgora: 'read now',
    lidoEm: (quando) => `read ${quando}`,
    fonteLocal: (parte, onde, lido) => `• ${parte}: local state at ${onde}, ${lido}`,
    fonteInexistente: (parte, onde, lido) => `• ${parte}: ${onde} does not exist, ${lido}`,
    alvoDoRoadmap: (onde) => `${DIR_ROADMAP_LITERAL} in ${onde}`,
    fonteCommit: (parte, alvo, commit, data, estado) => `• ${parte}: ${alvo} @ ${commit} (commit from ${data}), ${estado}`,
    ultimaCopia: 'this machine\'s last copy, without a new read',
    maquinasNaoLidas: '• not read: see the gaps',
    nenhumaMaquinaNaFabrica: '• no machine has published to ork/fabrica-estado',
    estaMaquina: ' (this machine)',
    maquinaSoNaRede: (quem, retrato, idade, semBatida, branch) =>
      `• ${quem}: threads not read, seen in the person network (snapshot from ${retrato}, ${idade} ago${semBatida ? ', NO HEARTBEAT' : ''}) and no snapshot in ${branch}`,
    estadoLocalAgora: 'local state read now',
    retrato: (quando, idade, semBatida) => `snapshot from ${quando} (${idade} ago)${semBatida ? ', NO HEARTBEAT' : ''}`,
    resumoMaquina: (quem, ativas, semMaster, batida) =>
      `• ${quem}: ${ativas} active${semMaster ? `, ${semMaster} delivered without MASTER` : ''}, ${batida}`,
    semItem: 'no item',
    esperaVoce: (pergunta) => ` · waiting for you: ${pergunta}`,
    veredito: 'verdict',
    reservasNaoLidas: '• not read: see the gaps',
    nenhumaReserva: '• no reservation in ork/roadmap-reservas',
    reserva: (item, maquina, thread, desde) => `  ${item} · ${maquina} · ${thread} · since ${desde}`,
    semThread: 'no thread',
    redeLidaAgora: 'read now',
    redeLidaEm: (quando) => `read ${quando}`,
    casaAusente: '• home: none found (see the gaps)',
    casaNaoLida: (casa) => `• home: ${casa}, not read (see the gaps)`,
    casaLida: (casa, ponta, estado) => `• home: ${casa} @ ${ponta}, ${estado}`,
    semCommit: 'no commit',
    casaUltimaCopia: 'this machine\'s last copy, without a new read',
    nenhumRetrato: '• no snapshot read from the home; this does not mean there are no machines: see the gaps',
    membro: (maquina, esta, quando, idade, semBatida, versao, projetos) =>
      `• ${maquina}${esta}: snapshot from ${quando}${idade}${semBatida ? ', NO HEARTBEAT' : ''}${versao}, ${projetos}`,
    batidaIlegivel: ' (unreadable heartbeat)',
    idade: (idade) => ` (${idade} ago)`,
    versao: (versao) => `, ork ${versao}`,
    projetos: (projetos) => `projects: ${projetos}`,
    nenhumProjeto: 'no project declared here',
    lacuna: (tipo, alvo, detalhe, correcao) => `• ${tipo}${alvo}: ${detalhe}. What to do: ${correcao}.`,
    lacunaDetalhe: (tipo, idDaParte, alvo, detalhe) => {
      const alvoSeguro = alvo ? ` for ${alvo}` : '';
      const parte = PARTES_EN[idDaParte] ?? idDaParte;
      const texto = detalhe.toLowerCase();
      if (tipo === 'rede.sem-projeto') return texto.includes('registro está vazio')
        ? 'no project is known on this machine: the registry is empty, and the host directory does not count as a project'
        : 'no project is known on this machine: there is no manifest in the current directory and no registry entry';
      if (tipo === 'registro.invalido') {
        if (texto.includes('não é um json')) return 'the project registry is not readable JSON';
        if (texto.includes('não está no contrato')) return 'the project registry does not follow the `ork.projetos/v1` contract';
        if (texto.includes('não traz a lista')) return 'the project registry has no project list';
        if (texto.includes('sem clone')) return `a project registry entry has no clone on this machine and no recognized forge remote${alvoSeguro}`;
        return `the project registry entry is invalid${alvoSeguro}`;
      }
      if (tipo === 'projeto.remoto-invalido') return `the manifest's fabrica.remoto is not a Git remote name, so Git read nothing${alvoSeguro}`;
      if (tipo === 'projeto.base-invalida') return `the manifest's worktree.base_branch is not a branch name, so Git read nothing${alvoSeguro}`;
      if (tipo === 'projeto.sem-clone') return `the project has no clone on this machine; it was read from the forge in read-only mode${alvoSeguro}`;
      if (tipo === 'projeto.sem-fonte') return `the project has neither a clone on this machine nor a recognized forge remote${alvoSeguro}`;
      if (tipo === 'projeto.sem-leitura') return `reading the project stopped; its other sources were not read${alvoSeguro}`;
      if (tipo === 'roadmap.sem-base') return `the configured base branch does not exist${alvoSeguro}`;
      if (tipo === 'reservas.sem-branch') return `no reservation has been made yet: the reservations branch does not exist${alvoSeguro}`;
      if (tipo === 'fabrica.sem-branch') return `no machine has published yet: the factory branch does not exist${alvoSeguro}`;
      if (tipo === 'roadmap.sem-itens') return `no roadmap item page exists in ${DIR_ROADMAP_LITERAL} on the selected base${alvoSeguro}`;
      if (tipo === 'roadmap.pagina-invalida') return texto.includes('binária')
        ? `the roadmap page is binary or too large to read and was left out${alvoSeguro}`
        : `the roadmap page is invalid and was left out${alvoSeguro}`;
      if (tipo === 'roadmap.entregas-parciais') return texto.includes('começo do dia')
        ? `commits since the start of the project owner's day were not read, so "Delivered today" may be incomplete${alvoSeguro}`
        : `the base has more commits today than the forge returned, so "Delivered today" may be incomplete${alvoSeguro}`;
      if (tipo === 'reserva.invalida') return `the reservation is unreadable or follows another contract and was left out${alvoSeguro}`;
      if (tipo === 'retrato.invalido') return `the machine snapshot is unreadable or follows another contract and was left out${alvoSeguro}`;
      if (tipo === 'maquina.sem-batida') return `the machine has no recent heartbeat, so its threads may have moved${alvoSeguro}`;
      if (tipo === 'maquina.sem-fabrica') return `the machine is in the person network and declares this project, but has no factory snapshot; its project threads were not read${alvoSeguro}`;
      if (tipo === 'estado-local.sem-leitura') return texto.includes('threads legíveis')
        ? `the complete local snapshot could not be built; readable threads were included and unreadable threads were left out${alvoSeguro}`
        : `the local state could not be read; the published snapshot is used when available${alvoSeguro}`;
      if (tipo === 'forja.nao-consultada') return `the forge was not queried because of \`--sem-remoto\`, and this machine has no clone${alvoSeguro}`;
      if (tipo === 'forja.leitura-parcial') return `the forge limited the listing to 100 files, so the rest of the ${parte} source was not read${alvoSeguro}`;
      if (tipo === 'roadmap.sem-leitura' || tipo === 'reservas.sem-leitura' || tipo === 'fabrica.sem-leitura') {
        if (texto.includes('última cópia')) return `no fresh read of the ${parte} source; using this machine's last copy${alvoSeguro}`;
        if (texto.includes('não tem cópia')) return `the ${parte} source was not read, and this machine has no local copy${alvoSeguro}`;
        return `the ${parte} source was not read${alvoSeguro}`;
      }
      if (tipo.startsWith('forja.')) return `the forge could not read the ${parte} source${alvoSeguro}`;
      if (tipo.startsWith('rede.')) return `the person network could not read the ${parte} source${alvoSeguro}`;
      if (tipo.includes('invalida') || tipo.includes('invalido')) return `the ${parte} source is invalid${alvoSeguro}`;
      return `the ${parte} source has a typed query gap${alvoSeguro}`;
    },
    lacunaCorrecao: (tipo) => {
      if (tipo === 'maquina.sem-batida') return 'check that machine and its pulse heartbeat';
      if (tipo === 'maquina.sem-fabrica') return 'run `ork fabrica entrar` in the project clone on that machine';
      if (tipo === 'rede.sem-projeto') return 'register the clone or request the project by forge reference';
      if (tipo === 'registro.invalido') return 'inspect the registry with `ork projetos`, or request the project with `--projeto`';
      if (tipo === 'projeto.remoto-invalido') return 'fix fabrica.remoto in `orkastery.yaml` (default: origin)';
      if (tipo === 'projeto.base-invalida' || tipo === 'roadmap.sem-base') return 'fix worktree.base_branch in `orkastery.yaml` (default: main)';
      if (tipo === 'projeto.sem-clone') return 'work in a project clone to include this machine\'s threads';
      if (tipo === 'projeto.sem-fonte') return 'request the project as `github:owner/repo` or `gitlab:group/repo`';
      if (tipo === 'roadmap.sem-itens') return 'initialize roadmap as code with `ork docs init`';
      if (tipo === 'roadmap.pagina-invalida') return 'run `ork docs verificar` in the project and fix the named page';
      if (tipo === 'roadmap.entregas-parciais') return 'check today\'s deliveries in the project clone';
      if (tipo === 'reservas.sem-branch') return 'the first `ork roadmap pegar RM-NNN` creates the branch';
      if (tipo === 'fabrica.sem-branch') return 'run `ork fabrica entrar` on each machine that should publish';
      if (tipo === 'reserva.invalida') return 'inspect the ork/roadmap-reservas branch';
      if (tipo === 'retrato.invalido') return 'republish the machine with `ork fabrica publicar --forcar`';
      if (tipo === 'estado-local.sem-leitura') return 'inspect this machine\'s threads with `ork thread list` and fix the unreadable thread.json';
      if (tipo === 'forja.nao-consultada') return 'run again without `--sem-remoto`';
      if (tipo === 'forja.leitura-parcial') return 'read through the project clone, which has no 100-file limit';
      if (tipo.startsWith('forja.') || tipo.startsWith('rede.')) return 'check the forge login and run `ork network status`';
      if (tipo.endsWith('.sem-leitura')) return 'check network access and query the source again';
      return 'inspect the named source in its project and query again';
    },
  },
  uso: 'usage: ork network [status] [--json] [--sem-remoto] | network entrar [--maquina NAME] [--forja github|gitlab] ' +
    '[--repositorio [OWNER/]NAME] [--forcar] | network publicar [--forcar] [--json] | network sair | ' +
    'network roadmap [--projeto P] [--json] [--sem-remoto]',
  entrou: (maquina, dono, forja, ref, criado) =>
    `Network: ${maquina} joined the Orkastery Network of ${dono} (${forja}: ${ref}, private${criado ? ', created now' : ''}).`,
  primeiroRetrato: (commit) => `  First snapshot published (${commit}). From now on, this machine publishes by itself on the pulse heartbeat`,
  tomouNome: (maquina) => `  Took the name "${maquina}" from another installation; the commit records it.`,
  eAoCriar: '  and when it creates a thread, dispatches a phase, delivers and closes. From any machine of this person: `ork network status`',
  avisoDescartado: (padrao, campo) => `  WARNING: a project was left out of the snapshot: pattern "${padrao}" in ${campo} (value left out on purpose).`,
  avisoOrkMaquina: (valor) => `  WARNING: ORK_MAQUINA=${valor} in this shell wins over the recorded name; align the two.`,
  saiu: (maquina, resto) => `Network: ${maquina} left; nothing else is published from here.${resto}`,
  retratoRemovido: (casa, commit) => ` Snapshot removed from ${casa} (${commit}).`,
  retratoDeOutraInstalacao: (maquina, casa, mesmoHostname) =>
    ` The snapshot "${maquina}" in ${casa} belongs to another installation with the same name; nothing was removed.` +
    (mesmoHostname ? ' It has this machine\'s hostname: if ~/.orkastery was deleted, take the name back with `ork network entrar --forcar`.' : ''),
  semRetrato: (casa) => ` There was no snapshot of this machine${casa ? ` in ${casa}` : ' in a reachable home'}.`,
  fabricaContinua: '  The shared factory of the projects keeps publishing from here (ork/fabrica-estado); run `ork fabrica sair` in each one to stop.',
  publicou: (maquina, casa, commit, tentativas) => `Network: ${maquina} published the snapshot to ${casa} (${commit}, ${tentativas} attempt(s)).`,
  ocupado: 'Network: another publication from this machine is in progress; try again in a moment.',
  igual: (maquina, casa) => `Network: the snapshot of ${maquina} matches the last one published to ${casa}; nothing to send (use \`--forcar\` to publish anyway).`,
};
