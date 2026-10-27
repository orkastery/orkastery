/**
 * A familia `forja` do catalogo: o motivo de cada erro tipado da forja (`forja.*`), para a pessoa. O codigo sai igual
 * nas duas linguas, no comeco da frase; o detalhe e dado (status HTTP, metodo, caminho, host) e sai como veio. O
 * pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 */

type ErroLegivel = { codigo: string; detalhe: string; tentarEm?: string };

export const FORJA_PT_BR = {
  motivo: (e: ErroLegivel, tipo: string | null): string => {
    const d = e.detalhe;
    switch (e.codigo) {
      case 'forja.desconhecida': return `forja.desconhecida: nenhuma CLI com login em ${d} respondeu como forja; declare forja.tipo no orkastery.yaml`;
      case 'forja.ambigua': return `forja.ambigua: ${d} respondeu como mais de uma forja; declare forja.tipo no orkastery.yaml`;
      case 'forja.remoto-divergente': return `forja.remoto-divergente: o remoto não é da forja que o orkastery.yaml declara (${d})`;
      case 'forja.sem-login': return `forja.sem-login: a CLI da forja não tem login no host (${d})`;
      case 'forja.sem-permissao': return `forja.sem-permissao: o login da CLI não tem permissão para isto (${d})`;
      case 'forja.nao-achei': return tipo === 'gitlab'
        ? `forja.nao-achei: ${d}; no GitLab, projeto privado sem acesso também responde 404`
        : `forja.nao-achei: ${d}`;
      case 'forja.limite': return `forja.limite: a cota de requisições da forja acabou (${d})${e.tentarEm ? `; tente depois de ${e.tentarEm}` : ''}`;
      case 'forja.conflito': return `forja.conflito: a forja recusou por conflito com o estado atual (${d})`;
      case 'forja.indisponivel': return `forja.indisponivel: a forja não respondeu (${d})`;
      case 'forja.pedido-recusado': return `forja.pedido-recusado: a forja recusou o pedido (${d})`;
      case 'forja.incompleto': return `forja.incompleto: a lista passou do teto de leitura e não foi lida inteira (${d})`;
      case 'forja.resposta-invalida': return `forja.resposta-invalida: resposta fora do formato esperado (${d})`;
      case 'forja.versao-abaixo-do-piso': return `forja.versao-abaixo-do-piso: ${d}; o ork não opera esta versão`;
      case 'forja.sem-capacidade': return `forja.sem-capacidade: o adaptador não implementa ${d}`;
      case 'forja.ausente': return `forja.ausente: a CLI da forja não está instalada nesta máquina (${d})`;
      default: return `${e.codigo}: ${d}`;
    }
  },
  /** As linhas da secao "forja" do `ork doctor` (`doctor-forja.ts`). */
  doctor: {
    flagComValor: 'erro: ork doctor --forja não leva valor (uso: ork doctor --json [--forja]); sem a flag, a seção forja não roda',
    origens: { manifesto: 'manifesto', remoto: 'remoto', sondagem: 'sondagem', padrao: 'padrão' } as Record<string, string>,
    identidade: (tipo: string, host: string, porta: number, base: string, repo: string, origens: string) =>
      `${tipo} em ${host}, porta ${porta}, caminho base ${base}; projeto ${repo} (${origens})`,
    origensDosCampos: (tipo: string, host: string, porta: string, base: string) => `tipo: ${tipo}; host: ${host}; porta: ${porta}; caminho base: ${base}`,
    semHostComBloco: (remoto: string) => `o orkastery.yaml declara o bloco forja, mas o remoto ${remoto} não aponta uma forja (sem remoto, ou caminho local)`,
    semHostCorrecao: (remoto: string) => `aponte o remoto para a forja (git remote set-url ${remoto} <url>) ou retire o bloco forja do orkastery.yaml`,
    identidadeCorrecao: 'declare forja.tipo no orkastery.yaml (e forja.host, se a web tem outro nome que o remoto), ou faça o login da CLI ' +
      'no host: gh auth login ou glab auth login',
    divergenteCorrecao: 'confira forja.host, forja.ssh_host e forja.caminho_base do orkastery.yaml contra o remoto',
    portas: { aberta: 'aberta', recusada: 'recusada', 'sem-resposta': 'sem resposta' } as Record<string, string>,
    alcance: (web: string, ssh: string) => `HTTPS ${web}; SSH ${ssh}`,
    alcanceDe: (host: string, porta: number, estado: string) => `${host}:${porta} ${estado}`,
    webForaCorrecao: (host: string, porta: number) => `confira a rede até ${host}:${porta} (firewall, proxy, VPN) e forja.porta no orkastery.yaml`,
    sshForaCorrecao: 'sem SSH, a entrega vai pelo HTTPS: o transporte forja-https usa o login da CLI',
    tlsHttp: (host: string) => `o remoto usa http: ${host} sem TLS`,
    tlsHttpCorrecao: 'use o endereço https da forja no remoto',
    caAusente: (ca: string) => `forja.ca aponta ${ca}, que não existe ou não é legível nesta máquina`,
    caAusenteCorrecao: 'corrija forja.ca no orkastery.yaml ou instale o PEM nesse caminho nesta máquina',
    tlsFalhou: (host: string, motivo: string) => `a cadeia TLS de ${host} não valida (${motivo}); a verificação nunca é desligada`,
    tlsCorrecao: 'instale a CA interna no sistema ou declare forja.ca com o arquivo PEM dela',
    tlsOk: (host: string, ca: string | null) => (ca ? `a cadeia TLS de ${host} valida com a CA ${ca}` : `a cadeia TLS de ${host} valida com a CA do sistema`),
    tlsCaForaDoLinux: (host: string, ca: string) => `a cadeia TLS de ${host} valida com a CA ${ca}, mas fora do Linux ela não chega ao gh (SSL_CERT_FILE só vale no Linux)`,
    tlsCaForaDoLinuxCorrecao: 'instale a CA interna no armazenamento de certificados do sistema',
    cli: (cmd: string, versao: string, minima: string) => `${cmd} ${versao} (mínimo ${minima})`,
    cliAusente: (cmd: string, minima: string) => `${cmd} não está instalado nesta máquina (mínimo ${minima})`,
    cliIlegivel: (cmd: string) => `${cmd} --version não disse a versão`,
    cliAbaixo: (cmd: string, versao: string, minima: string) => `${cmd} ${versao} abaixo do mínimo ${minima}`,
    cliCorrecao: (cmd: string, minima: string) => `instale ou atualize o ${cmd} para ${minima} ou acima`,
    login: (cmd: string, alvo: string) => `${cmd} com login em ${alvo}`,
    semLogin: (cmd: string, alvo: string) => `${cmd} sem login em ${alvo}`,
    loginCorrecao: (comando: string) => `rode ${comando}`,
    subcaminho: (base: string) => `${base}/api/v4/metadata responde`,
    subcaminhoFalhou: (base: string, motivo: string) => `${base}/api/v4/metadata não respondeu: ${motivo}`,
    subcaminhoCorrecao: 'confira forja.caminho_base contra o relative_url_root da instância',
    faixas: { testada: 'testada', compativel: 'compatível', 'abaixo-do-piso': 'abaixo do piso', 'sem-faixa': 'sem faixa' } as Record<string, string>,
    servidor: (versao: string, edicao: string, faixa: string) => `${versao} ${edicao}, faixa ${faixa}`,
    servidorSemFaixa: (host: string, versao: string | null) => (versao ? `${host} ${versao}` : host),
    servidorFalhou: (motivo: string) => `a versão do servidor não foi lida: ${motivo}`,
    servidorFalhouCorrecao: 'confira o alcance, o login e a permissão da CLI no host',
    servidorAbaixo: (versao: string, piso: string) => `${versao} abaixo do piso ${piso}: o ork não opera esta versão`,
    servidorCorrecao: (piso: string) => `atualize a instância para ${piso} ou acima`,
    doCache: 'lido há menos de 24 h',
    nenhum: 'nenhum',
    escopo: (lista: string) => `escopos do token: ${lista}`,
    escopoSemLeitura: (lista: string) => `o token não lê a API (escopos: ${lista}); falta api ou read_api`,
    escopoCorrecao: 'refaça o login da CLI com um token que tenha api ou read_api',
    escopoSemEscrita: (lista: string) => `o SHIP do MCP empurra pelo forja-https, e o token não escreve no repositório (escopos: ${lista}); falta write_repository ou api`,
    escopoSemEscritaCorrecao: 'refaça o login da CLI com um token que tenha write_repository (ou api), ou instale o SHIP com --ship-transport forja-ssh',
    escopoNaoMedivel: (motivo: string) => `não medível: ${motivo}`,
    escopoNaoMedivelCorrecao: 'com token de acesso pessoal o doctor mede os escopos; com OAuth, confira-os na forja',
    escopoFineGrained: 'não medível: token fine-grained ou de GitHub App não declara escopos',
    escopoSemRepo: (lista: string) => `escopos do token: ${lista}; sem repo, repositório privado não é lido`,
    escopoSemRepoCorrecao: 'rode gh auth refresh -s repo',
    projetoFalhou: (repo: string, motivo: string) => `o projeto ${repo} não foi lido: ${motivo}`,
    projetoFalhouCorrecao: 'confira o caminho do projeto no remoto e a permissão do login da CLI nele',
    naoDisponivel: 'não disponível nesta edição',
    naoMedivel: 'não medível',
    ligado: 'ligado',
    desligado: 'desligado',
    permitido: 'permitido',
    projetoGitlab: (metodo: string, squash: string, mergedResults: string, mergeTrain: string) =>
      `merge ${metodo}; squash ${squash}; merged results ${mergedResults}; merge train ${mergeTrain}`,
    projetoGithub: (merge: string, squash: string, rebase: string) => `merge commit ${merge}; squash ${squash}; rebase ${rebase}`,
    avisoFf: 'com fast-forward não há commit de merge: o assunto ship(<thread>) não chega à base',
    avisoSquash: (opcao: string) => `squash ${opcao}: a entrega por squash não se liga ao head verificado (entrega.sem-vinculo)`,
    avisoSemMergeCommit: 'sem merge commit, a entrega por PR não se liga ao head verificado (entrega.sem-vinculo)',
    projetoGitlabCorrecao: 'em Settings > Merge requests, use merge commit e deixe squash desativado',
    projetoGithubCorrecao: 'em Settings > General > Pull Requests, permita merge commits',
    capacidades: (ligadas: string) => `ligadas: ${ligadas}`,
    capacidadesDesligadas: (ligadas: string, desligadas: string) => `ligadas: ${ligadas}; desligadas (o adaptador não implementa): ${desligadas}`,
    capacidadesCorrecao: 'cada capacidade desligada segue o caminho de reserva do ork, como hoje',
  },
  /** O transporte do `ork_ship` do MCP: a frase de cada recusa e as linhas da instalacao. */
  transporteShip: {
    recusa: (codigo: string, d: string): string => {
      const frase = ((): string => {
        switch (codigo) {
          case 'mcp.ship.transport.urls': return `o origin precisa de uma URL só, de forja ou de bare local (${d})`;
          case 'mcp.ship.transport.modo': return `o origin não serve a este transporte; use --ship-transport ${d}`;
          case 'mcp.ship.transport.forja': return `a forja do origin não foi resolvida (${d})`;
          case 'mcp.ship.transport.ssh.divergente': return `o origin e a forja resolvida apontam SSH diferente (${d}); acerte forja.ssh_host e forja.ssh_porta ou a URL do origin`;
          case 'mcp.ship.transport.ssh.sem-resposta': return `${d} não entregou chave de servidor SSH; se a forja não abre SSH, use --ship-transport forja-https`;
          case 'mcp.ship.transport.ssh.revogada': return `o seu known_hosts revoga uma chave que ${d} apresentou; não instale até saber por quê`;
          case 'mcp.ship.transport.ssh.nao-confirmada': return `confira a impressão com quem administra a forja e rode de novo com --ssh-fingerprint <impressão> (${d})`;
          case 'mcp.ship.transport.ssh.impressao-divergente': return `a impressão dita não é de nenhuma chave que o servidor apresentou (${d}); não instale até saber por quê`;
          case 'mcp.ship.transport.ssh.known-hosts-ilegivel': return `o seu known_hosts existe e não pôde ser lido (${d}); sem ele, uma chave revogada passaria; acerte o arquivo e rode de novo`;
          case 'mcp.ship.transport.ssh.caminho': return `o known_hosts fixado precisa de caminho absoluto sem espaço nem caractere especial (${d})`;
          case 'mcp.ship.transport.ssh.known-hosts-alterado': return `o known_hosts fixado mudou depois da instalação (${d}); reinstale o MCP`;
          case 'mcp.ship.transport.ssh.credencial-na-url': return `o ${d} leva senha ou token na URL SSH; tire-os com git remote set-url origin ssh://<usuário>@<host>/<caminho>.git`;
          case 'mcp.ship.transport.https.sem-tls': return `HTTP sem TLS levaria a credencial em claro; use https:// no origin (${d})`;
          case 'mcp.ship.transport.https.credencial-na-url': return `o ${d} leva usuário ou token na URL; tire-os com git remote set-url origin https://<host>/<caminho>.git`;
          case 'mcp.ship.transport.https.divergente': return `o origin e a forja resolvida apontam HTTPS diferente (${d}); acerte forja.host e forja.porta ou a URL do origin`;
          case 'mcp.ship.transport.sem-cli': return `a CLI da forja não está instalada; instale ${d} ou acima`;
          case 'mcp.ship.transport.sem-helper': return `a CLI instalada não tem auth git-credential (${d}); atualize até a versão mínima`;
          case 'mcp.ship.transport.sem-login': return `a CLI não tem login no host (${d}); faça o login e rode de novo (o ork doctor mostra o comando)`;
          case 'mcp.ship.transport.binario': return `a CLI precisa ser arquivo executável seu ou do root, sem escrita de grupo ou de outros (${d})`;
          case 'mcp.ship.transport.ca': return `a CA de forja.ca precisa ser um PEM legível, seu ou do root, sem escrita de grupo ou de outros (${d})`;
          case 'mcp.ship.transport.ca-alterada': return `a CA mudou depois da instalação (${d}); reinstale o MCP`;
          case 'mcp.ship.transport.fixacao-ausente': return `este transporte não foi instalado nesta máquina; rode ${d}`;
          case 'mcp.ship.transport.fixacao-insegura': return `a fixação do transporte precisa ser sua, sem link e sem acesso de grupo ou de outros (${d})`;
          case 'mcp.ship.transport.fixacao-divergente': return `a instalação fixou outro transporte ou outro origin (${d}); reinstale o MCP`;
          case 'mcp.ship.transport.cli-config': return `${d} precisa ser um caminho absoluto sem caractere de controle; é a pasta de config da CLI da forja, que o push leva ao helper de credencial`;
          case 'mcp.ship.transport.mudou-no-push': return `o ${d} ou a config do git mudou durante o push; o push pode ter sido feito, mas a entrega não foi provada: confira o remoto, a branch e a config antes de repetir`;
          default: return d;
        }
      })();
      return `${codigo}: ${frase}`;
    },
    fixadoSsh: (nome: string, chaves: string, arquivo: string): string =>
      `SHIP por forja-ssh: a chave de ${nome} (${chaves}) ficou fixada em ${arquivo}; cada push confere essa chave, sem perguntar.`,
    fixadoHttps: (origem: string, cli: string, ca: string | null): string =>
      `SHIP por forja-https: o git pede a credencial de ${origem} só ao ${cli} (auth git-credential)${ca ? `, com a CA ${ca} conferida pelo hash a cada push` : ''}.`,
    fixariaSsh: (nome: string, chaves: string, arquivo: string): string =>
      `SHIP por forja-ssh: a chave de ${nome} (${chaves}) seria fixada em ${arquivo}; nada foi gravado.`,
    fixariaHttps: (origem: string, cli: string, ca: string | null): string =>
      `SHIP por forja-https: o git pediria a credencial de ${origem} só ao ${cli} (auth git-credential)${ca ? `, com a CA ${ca} conferida pelo hash a cada push` : ''}; nada foi gravado.`,
    consultaNoFixado: (modo: string): string =>
      `mcp.experiencia.transporte-fixado: consulta indisponível no transporte fixado ${modo}: o fetch das consultas ainda não leva a chave, o helper e as travas fixados, e sem eles iria à rede pela config do usuário`,
    proposta: (modo: string): string =>
      `SHIP: o origin deste projeto pede --ship-transport ${modo}; com o transporte padrão, o ork_ship fica indisponível. Para trocar, remova a entrada orkastery e reinstale com a opção.`,
  },
};

export type MensagensDeForja = typeof FORJA_PT_BR;

export const FORJA_EN: MensagensDeForja = {
  motivo: (e, tipo) => {
    const d = e.detalhe;
    switch (e.codigo) {
      case 'forja.desconhecida': return `forja.desconhecida: no CLI logged in to ${d} answered as a forge; declare forja.tipo in orkastery.yaml`;
      case 'forja.ambigua': return `forja.ambigua: ${d} answered as more than one forge; declare forja.tipo in orkastery.yaml`;
      case 'forja.remoto-divergente': return `forja.remoto-divergente: the remote is not on the forge that orkastery.yaml declares (${d})`;
      case 'forja.sem-login': return `forja.sem-login: the forge CLI is not logged in to the host (${d})`;
      case 'forja.sem-permissao': return `forja.sem-permissao: the CLI login is not allowed to do this (${d})`;
      case 'forja.nao-achei': return tipo === 'gitlab'
        ? `forja.nao-achei: ${d}; on GitLab, a private project you cannot access also answers 404`
        : `forja.nao-achei: ${d}`;
      case 'forja.limite': return `forja.limite: the forge request quota ran out (${d})${e.tentarEm ? `; try again after ${e.tentarEm}` : ''}`;
      case 'forja.conflito': return `forja.conflito: the forge refused because of a conflict with the current state (${d})`;
      case 'forja.indisponivel': return `forja.indisponivel: the forge did not answer (${d})`;
      case 'forja.pedido-recusado': return `forja.pedido-recusado: the forge refused the request (${d})`;
      case 'forja.incompleto': return `forja.incompleto: the list went past the read cap and was not read in full (${d})`;
      case 'forja.resposta-invalida': return `forja.resposta-invalida: the response is not in the expected format (${d})`;
      case 'forja.versao-abaixo-do-piso': return `forja.versao-abaixo-do-piso: ${d}; ork does not operate this version`;
      case 'forja.sem-capacidade': return `forja.sem-capacidade: the adapter does not implement ${d}`;
      case 'forja.ausente': return `forja.ausente: the forge CLI is not installed on this machine (${d})`;
      default: return `${e.codigo}: ${d}`;
    }
  },
  doctor: {
    flagComValor: 'error: ork doctor --forja takes no value (usage: ork doctor --json [--forja]); without the flag, the forge section does not run',
    origens: { manifesto: 'manifest', remoto: 'remote', sondagem: 'probe', padrao: 'default' },
    identidade: (tipo, host, porta, base, repo, origens) => `${tipo} at ${host}, port ${porta}, base path ${base}; project ${repo} (${origens})`,
    origensDosCampos: (tipo, host, porta, base) => `type: ${tipo}; host: ${host}; port: ${porta}; base path: ${base}`,
    semHostComBloco: (remoto) => `orkastery.yaml declares the forja block, but remote ${remoto} does not point to a forge (no remote, or a local path)`,
    semHostCorrecao: (remoto) => `point the remote to the forge (git remote set-url ${remoto} <url>) or remove the forja block from orkastery.yaml`,
    identidadeCorrecao: 'declare forja.tipo in orkastery.yaml (and forja.host, if the web uses another name than the remote), or log the CLI ' +
      'in to the host: gh auth login or glab auth login',
    divergenteCorrecao: 'check forja.host, forja.ssh_host and forja.caminho_base in orkastery.yaml against the remote',
    portas: { aberta: 'open', recusada: 'refused', 'sem-resposta': 'no answer' },
    alcance: (web, ssh) => `HTTPS ${web}; SSH ${ssh}`,
    alcanceDe: (host, porta, estado) => `${host}:${porta} ${estado}`,
    webForaCorrecao: (host, porta) => `check the network to ${host}:${porta} (firewall, proxy, VPN) and forja.porta in orkastery.yaml`,
    sshForaCorrecao: 'without SSH, delivery goes over HTTPS: the forja-https transport uses the CLI login',
    tlsHttp: (host) => `the remote uses http: ${host} without TLS`,
    tlsHttpCorrecao: 'use the https address of the forge in the remote',
    caAusente: (ca) => `forja.ca points to ${ca}, which does not exist or is not readable on this machine`,
    caAusenteCorrecao: 'fix forja.ca in orkastery.yaml or install the PEM at that path on this machine',
    tlsFalhou: (host, motivo) => `the TLS chain of ${host} does not validate (${motivo}); verification is never turned off`,
    tlsCorrecao: 'install the internal CA in the system or declare forja.ca with its PEM file',
    tlsOk: (host, ca) => (ca ? `the TLS chain of ${host} validates with the CA ${ca}` : `the TLS chain of ${host} validates with the system CA`),
    tlsCaForaDoLinux: (host, ca) => `the TLS chain of ${host} validates with the CA ${ca}, but outside Linux it does not reach gh (SSL_CERT_FILE only works on Linux)`,
    tlsCaForaDoLinuxCorrecao: 'install the internal CA in the system certificate store',
    cli: (cmd, versao, minima) => `${cmd} ${versao} (minimum ${minima})`,
    cliAusente: (cmd, minima) => `${cmd} is not installed on this machine (minimum ${minima})`,
    cliIlegivel: (cmd) => `${cmd} --version did not tell the version`,
    cliAbaixo: (cmd, versao, minima) => `${cmd} ${versao} below the minimum ${minima}`,
    cliCorrecao: (cmd, minima) => `install or upgrade ${cmd} to ${minima} or later`,
    login: (cmd, alvo) => `${cmd} logged in to ${alvo}`,
    semLogin: (cmd, alvo) => `${cmd} not logged in to ${alvo}`,
    loginCorrecao: (comando) => `run ${comando}`,
    subcaminho: (base) => `${base}/api/v4/metadata answers`,
    subcaminhoFalhou: (base, motivo) => `${base}/api/v4/metadata did not answer: ${motivo}`,
    subcaminhoCorrecao: 'check forja.caminho_base against the relative_url_root of the instance',
    faixas: { testada: 'tested', compativel: 'compatible', 'abaixo-do-piso': 'below the floor', 'sem-faixa': 'no range' },
    servidor: (versao, edicao, faixa) => `${versao} ${edicao}, range ${faixa}`,
    servidorSemFaixa: (host, versao) => (versao ? `${host} ${versao}` : host),
    servidorFalhou: (motivo) => `the server version was not read: ${motivo}`,
    servidorFalhouCorrecao: 'check the reach, the login and the permission of the CLI on the host',
    servidorAbaixo: (versao, piso) => `${versao} below the floor ${piso}: ork does not operate this version`,
    servidorCorrecao: (piso) => `upgrade the instance to ${piso} or later`,
    doCache: 'read less than 24 h ago',
    nenhum: 'none',
    escopo: (lista) => `token scopes: ${lista}`,
    escopoSemLeitura: (lista) => `the token cannot read the API (scopes: ${lista}); api or read_api is missing`,
    escopoCorrecao: 'log the CLI in again with a token that has api or read_api',
    escopoSemEscrita: (lista) => `the MCP SHIP pushes over forja-https, and the token cannot write to the repository (scopes: ${lista}); write_repository or api is missing`,
    escopoSemEscritaCorrecao: 'log the CLI in again with a token that has write_repository (or api), or install the SHIP with --ship-transport forja-ssh',
    escopoNaoMedivel: (motivo) => `not measurable: ${motivo}`,
    escopoNaoMedivelCorrecao: 'with a personal access token the doctor measures the scopes; with OAuth, check them on the forge',
    escopoFineGrained: 'not measurable: a fine-grained or GitHub App token does not declare scopes',
    escopoSemRepo: (lista) => `token scopes: ${lista}; without repo, a private repository is not read`,
    escopoSemRepoCorrecao: 'run gh auth refresh -s repo',
    projetoFalhou: (repo, motivo) => `project ${repo} was not read: ${motivo}`,
    projetoFalhouCorrecao: 'check the project path in the remote and the permission of the CLI login on it',
    naoDisponivel: 'not available in this edition',
    naoMedivel: 'not measurable',
    ligado: 'on',
    desligado: 'off',
    permitido: 'allowed',
    projetoGitlab: (metodo, squash, mergedResults, mergeTrain) => `merge ${metodo}; squash ${squash}; merged results ${mergedResults}; merge train ${mergeTrain}`,
    projetoGithub: (merge, squash, rebase) => `merge commit ${merge}; squash ${squash}; rebase ${rebase}`,
    avisoFf: 'with fast-forward there is no merge commit: the ship(<thread>) subject does not reach the base',
    avisoSquash: (opcao) => `squash ${opcao}: a squash delivery is not linked to the verified head (entrega.sem-vinculo)`,
    avisoSemMergeCommit: 'without merge commits, a PR delivery is not linked to the verified head (entrega.sem-vinculo)',
    projetoGitlabCorrecao: 'in Settings > Merge requests, use merge commits and leave squash disabled',
    projetoGithubCorrecao: 'in Settings > General > Pull Requests, allow merge commits',
    capacidades: (ligadas) => `on: ${ligadas}`,
    capacidadesDesligadas: (ligadas, desligadas) => `on: ${ligadas}; off (the adapter does not implement them): ${desligadas}`,
    capacidadesCorrecao: 'each capability that is off follows the ork fallback path, as today',
  },
  transporteShip: {
    recusa: (codigo, d) => {
      const frase = ((): string => {
        switch (codigo) {
          case 'mcp.ship.transport.urls': return `origin needs a single URL, of a forge or of a local bare repository (${d})`;
          case 'mcp.ship.transport.modo': return `origin does not fit this transport; use --ship-transport ${d}`;
          case 'mcp.ship.transport.forja': return `the forge of origin could not be resolved (${d})`;
          case 'mcp.ship.transport.ssh.divergente': return `origin and the resolved forge point to different SSH (${d}); fix forja.ssh_host and forja.ssh_porta or the origin URL`;
          case 'mcp.ship.transport.ssh.sem-resposta': return `${d} did not offer an SSH host key; if the forge has no SSH, use --ship-transport forja-https`;
          case 'mcp.ship.transport.ssh.revogada': return `your known_hosts revokes a key that ${d} offered; do not install until you know why`;
          case 'mcp.ship.transport.ssh.nao-confirmada': return `check the fingerprint with whoever runs the forge and run again with --ssh-fingerprint <fingerprint> (${d})`;
          case 'mcp.ship.transport.ssh.impressao-divergente': return `the given fingerprint matches no key the server offered (${d}); do not install until you know why`;
          case 'mcp.ship.transport.ssh.known-hosts-ilegivel': return `your known_hosts exists but could not be read (${d}); without it, a revoked key would pass; fix the file and run again`;
          case 'mcp.ship.transport.ssh.caminho': return `the pinned known_hosts needs an absolute path without spaces or special characters (${d})`;
          case 'mcp.ship.transport.ssh.known-hosts-alterado': return `the pinned known_hosts changed after the install (${d}); reinstall the MCP`;
          case 'mcp.ship.transport.ssh.credencial-na-url': return `${d} carries a password or token in the SSH URL; remove them with git remote set-url origin ssh://<user>@<host>/<path>.git`;
          case 'mcp.ship.transport.https.sem-tls': return `HTTP without TLS would send the credential in clear text; use https:// in origin (${d})`;
          case 'mcp.ship.transport.https.credencial-na-url': return `${d} carries a user or token in the URL; remove them with git remote set-url origin https://<host>/<path>.git`;
          case 'mcp.ship.transport.https.divergente': return `origin and the resolved forge point to different HTTPS (${d}); fix forja.host and forja.porta or the origin URL`;
          case 'mcp.ship.transport.sem-cli': return `the forge CLI is not installed; install ${d} or later`;
          case 'mcp.ship.transport.sem-helper': return `the installed CLI has no auth git-credential (${d}); upgrade to the minimum version`;
          case 'mcp.ship.transport.sem-login': return `the CLI is not logged in to the host (${d}); log in and run again (ork doctor shows the command)`;
          case 'mcp.ship.transport.binario': return `the CLI must be an executable file owned by you or root, not writable by group or others (${d})`;
          case 'mcp.ship.transport.ca': return `the CA in forja.ca must be a readable PEM, owned by you or root, not writable by group or others (${d})`;
          case 'mcp.ship.transport.ca-alterada': return `the CA changed after the install (${d}); reinstall the MCP`;
          case 'mcp.ship.transport.fixacao-ausente': return `this transport was not installed on this machine; run ${d}`;
          case 'mcp.ship.transport.fixacao-insegura': return `the transport pin must be yours, with no link and no group or other access (${d})`;
          case 'mcp.ship.transport.fixacao-divergente': return `the install pinned another transport or another origin (${d}); reinstall the MCP`;
          case 'mcp.ship.transport.cli-config': return `${d} must be an absolute path without control characters; it is the config folder of the forge CLI, which the push hands to the credential helper`;
          case 'mcp.ship.transport.mudou-no-push': return `the ${d} or the git config changed during the push; the push may have gone out, but the delivery was not proved: check the remote, the branch and the config before trying again`;
          default: return d;
        }
      })();
      return `${codigo}: ${frase}`;
    },
    fixadoSsh: (nome, chaves, arquivo) =>
      `SHIP over forja-ssh: the key of ${nome} (${chaves}) is pinned in ${arquivo}; every push checks this key, without asking.`,
    fixadoHttps: (origem, cli, ca) =>
      `SHIP over forja-https: git asks only ${cli} (auth git-credential) for the credential of ${origem}${ca ? `, with the CA ${ca} checked by hash on every push` : ''}.`,
    fixariaSsh: (nome, chaves, arquivo) =>
      `SHIP over forja-ssh: the key of ${nome} (${chaves}) would be pinned in ${arquivo}; nothing was written.`,
    fixariaHttps: (origem, cli, ca) =>
      `SHIP over forja-https: git would ask only ${cli} (auth git-credential) for the credential of ${origem}${ca ? `, with the CA ${ca} checked by hash on every push` : ''}; nothing was written.`,
    consultaNoFixado: (modo) =>
      `mcp.experiencia.transporte-fixado: lookup unavailable on the pinned transport ${modo}: the lookup fetch does not carry the pinned key, helper and locks yet, and without them it would reach the network through the user's config`,
    proposta: (modo) =>
      `SHIP: this project's origin needs --ship-transport ${modo}; with the default transport, ork_ship is unavailable. To switch, remove the orkastery entry and reinstall with the option.`,
  },
};
