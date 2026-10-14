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
    avisoMensagemPadrao: 'a mensagem de merge padrão (Merge branch …) não começa por ship(<thread>)',
    avisoSquash: (opcao: string) => `squash ${opcao}: a entrega por squash não se liga ao head verificado (entrega.sem-vinculo)`,
    avisoSemMergeCommit: 'sem merge commit, a entrega por PR não se liga ao head verificado (entrega.sem-vinculo)',
    projetoGitlabCorrecao: 'em Settings > Merge requests, use merge commit e um modelo de mensagem de merge que comece por %{title}',
    projetoGithubCorrecao: 'em Settings > General > Pull Requests, permita merge commits',
    capacidades: (ligadas: string) => `ligadas: ${ligadas}`,
    capacidadesDesligadas: (ligadas: string, desligadas: string) => `ligadas: ${ligadas}; desligadas (o adaptador não implementa): ${desligadas}`,
    capacidadesCorrecao: 'cada capacidade desligada segue o caminho de reserva do ork, como hoje',
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
    avisoMensagemPadrao: 'the default merge message (Merge branch …) does not start with ship(<thread>)',
    avisoSquash: (opcao) => `squash ${opcao}: a squash delivery is not linked to the verified head (entrega.sem-vinculo)`,
    avisoSemMergeCommit: 'without merge commits, a PR delivery is not linked to the verified head (entrega.sem-vinculo)',
    projetoGitlabCorrecao: 'in Settings > Merge requests, use merge commit and a merge message template that starts with %{title}',
    projetoGithubCorrecao: 'in Settings > General > Pull Requests, allow merge commits',
    capacidades: (ligadas) => `on: ${ligadas}`,
    capacidadesDesligadas: (ligadas, desligadas) => `on: ${ligadas}; off (the adapter does not implement them): ${desligadas}`,
    capacidadesCorrecao: 'each capability that is off follows the ork fallback path, as today',
  },
};
