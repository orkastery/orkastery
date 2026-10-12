/**
 * RM-026 K7, fatia 2: a familia `conhecimento` do catalogo de mensagens (o conhecimento escrito,
 * `ork.conhecimento/v1`). O pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * O detalhe de cada lacuna vai ao `--json` e a resposta das tools MCP em pt-BR: o leitor e a consulta o montam por
 * `textoDoCatalogo`, e so a impressao o remonta no locale (o padrao da F2b da RM-061). O pt-BR das lacunas da fatia 1
 * e o de antes, byte a byte. Sai como veio: o codigo da lacuna, o id, o arquivo, a referencia, o titulo e o corpo do
 * documento (dado do repositorio) e a mensagem do `lerYaml` (o modulo dono a escreve, como o validador do manifesto
 * na D14 da F2a).
 */

export const CONHECIMENTO_PT_BR = {
  uso: 'uso: ork conhecimento [listar [--colecao C]|mostrar <doc-id>|colecoes|verificar] [--json]',
  // ork conhecimento: o texto para gente (D13). O titulo, o id, o arquivo e o corpo sao dado do repositorio.
  naoLido: 'Conhecimento: a pasta não foi lida.',
  listar: (dir: string, n: number, colecao: string | null) =>
    `Conhecimento em ${dir}${colecao === null ? '' : `, coleção ${colecao}`}: ${n} documento(s).`,
  documento: (id: string, titulo: string, colecoes: string) => `  ${id}  ${titulo} (${colecoes})`,
  nenhumDocumento: '  (nenhum documento)',
  paraLer: 'Para ler um documento: ork conhecimento mostrar <doc-id>.',
  colecoes: (dir: string, n: number) => `Coleções em ${dir}: ${n}.`,
  colecao: (nome: string, documentos: string) => `  ${nome}  ${documentos}`,
  nenhumaColecao: '  (nenhuma coleção)',
  mostrar: (id: string, titulo: string) => `${id}: ${titulo}`,
  semDocumento: (id: string) => `${id}: nenhum documento válido com este id.`,
  colecoesDoDocumento: (colecoes: string) => `  coleções   ${colecoes}`,
  arquivo: (arquivo: string) => `  arquivo    ${arquivo}`,
  versao: (sha256: string, bytes: number) => `  versão     sha256 ${sha256}, ${bytes} bytes`,
  brain: (id: string, titulo: string, kind: string, versao: number, fonte: string) =>
    `  Brain      ${id}: ${titulo} (${kind}, versão ${versao}, fonte ${fonte})`,
  decisao: (ref: string, tipo: string, fonte: string) => `  decisão    ${ref}: ${tipo} (fonte ${fonte})`,
  semReferencia: '  referências nenhuma',
  corpo: 'Corpo do documento:',
  verificar: (dir: string, documentos: number, brain: number, decisoes: number) =>
    `Conhecimento em ${dir}: ${documentos} documento(s) válido(s), ${brain} id(s) do Brain e ${decisoes} decisão(ões) conferido(s).`,
  aprovado: 'Verificação aprovada: nenhuma lacuna.',
  reprovado: (n: number) => `Verificação reprovada: ${n} lacuna(s).`,
  lacunasTitulo: (n: number) => `${n} lacuna(s), o que ficou fora da resposta:`,
  lacuna: (codigo: string, onde: string, detalhe: string) => `  ${codigo}  ${onde}: ${detalhe}`,
  pasta: 'a pasta',
  naReferencia: (referencia: string) => `referência ${referencia}`,
  lacunas: {
    naoDeclarado: 'o orkastery.yaml não declara conhecimento.dir',
    dirForma: 'conhecimento.dir precisa ser uma pasta relativa à raiz, sem "..", fora de .git e .orkastery, como ' +
      'docs/conhecimento; nada foi lido',
    dirNaoAbre: 'a pasta de conhecimento.dir não existe ou não abre',
    dirForaDaRaiz: 'pelo caminho real (links resolvidos), conhecimento.dir sai da raiz do projeto; o manifesto vem com o ' +
      'repositório e não escolhe caminho fora dela; nada foi lido',
    dirReal: 'pelo caminho real, conhecimento.dir é a própria raiz, cai em .git ou .orkastery, ou tem caractere invisível; ' +
      'nada foi lido',
    dirNaoEPasta: 'conhecimento.dir não é uma pasta',
    limiteEntradas: (n: number) => `a pasta passa de ${n} entradas; nenhum documento foi devolvido`,
    limiteNiveis: (n: number) => `a pasta passa de ${n} níveis; nenhum documento foi devolvido`,
    limiteTotal: (mib: number) => `os documentos passam de ${mib} MiB no total; nenhum documento foi devolvido`,
    link: 'link simbólico não é seguido; o documento é o arquivo versionado',
    pastaNaoAbriu: 'a pasta não abriu para leitura; o que está nela não foi lido',
    nomeInvalido: 'nome fora de UTF-8 ou com caractere invisível; não foi lido',
    entradaNaoAbriu: 'a entrada não abriu para leitura; não foi lida',
    naoRegular: 'não é arquivo comum; não foi lido',
    naoAbriuComoArquivo: 'não abriu como arquivo comum, ou mudou durante a leitura',
    grandeDemais: (kib: number) => `o documento passa de ${kib} KiB`,
    codificacao: 'o arquivo não é UTF-8',
    semFrontmatter: 'o arquivo não começa com o frontmatter entre duas linhas ---',
    frontmatterGrande: (kib: number) => `o frontmatter passa de ${kib} KiB`,
    /** A mensagem do `lerYaml`, que diz a linha do arquivo; no pt-BR ela e o detalhe inteiro. */
    frontmatterYaml: (erro: string) => erro,
    frontmatterNaoEMapa: 'o frontmatter precisa ser um mapa de chaves',
    idInvalido: 'id precisa ser doc- seguido de 3 a 48 letras minúsculas, números ou hífens, começando por letra ou número',
    chaveDesconhecida: (chaves: string, doContrato: string) => `chave fora do contrato: ${chaves} (o frontmatter tem só ${doContrato})`,
    tituloInvalido: (n: number) => `titulo precisa ser texto de 1 a ${n} caracteres, sem caractere de controle`,
    colecoesInvalidas: (n: number) => `colecoes precisa listar de 1 a ${n} nomes de 1 a 48 letras minúsculas, números ou hífens, ` +
      'sem repetir',
    referenciasInvalidas: (n: number) => `referencias é um mapa só com brain e decisoes, cada uma uma lista de até ${n} textos`,
    idRepetido: (n: number) => `o id aparece em ${n} arquivos; nenhum deles vale até sobrar um`,
    brainForma: 'id do Brain é prod-, proj- ou init-, na regra dos ids do portfólio',
    decisaoForma: 'decisão é <thread>#<linha>, com o id da thread e a linha do ledger a partir de 1',
    ledgerLinkOuId: 'a pasta da thread no estado do projeto é link ou fica fora da regra de id',
    ledgerNaoAbriu: (thread: string) => `o ledger da thread ${thread} não abriu para leitura`,
    semLedger: (thread: string) => `a thread ${thread} não tem ledger neste projeto`,
    ledgerNaoRegular: (thread: string, mib: number) => `o ledger da thread ${thread} não é arquivo comum de até ${mib} MiB`,
    ledgerNaoUtf8: (thread: string) => `o ledger da thread ${thread} não é UTF-8`,
    ledgersDemais: (mib: number) => `a leitura passa de ${mib} MiB de ledger lido; a decisão não foi conferida`,
    linhasCompletas: (thread: string, n: number) => `o ledger da thread ${thread} tem ${n} linha(s) completa(s)`,
    naoEJson: (linha: number, thread: string) => `a linha ${linha} do ledger da thread ${thread} não é um evento JSON`,
    outraThread: (linha: number, thread: string) => `a linha ${linha} do ledger da thread ${thread} é de outra thread`,
    /** `tipo` e o tipo do evento quando ele tem a forma de um; `null`, sem tipo conhecido. */
    naoEDecisao: (linha: number, thread: string, tipo: string | null, decisoes: string) =>
      `a linha ${linha} do ledger da thread ${thread} é ${tipo ?? 'sem tipo conhecido'}, não decisão (${decisoes})`,
    // Fatia 2: a conferencia do id do Brain por `get` (D12) e o `mostrar` de um id sem documento (D13).
    brainInexistente: 'o Company Brain não tem este id (o get respondeu unknown)',
    brainRetido: 'o Company Brain tem este id, mas o retém para esta leitura (o get respondeu withheld); a referência não é citável aqui',
    brainNaoRespondeu: (estado: string, erro: string | null) =>
      `o Company Brain não respondeu ao get (${estado}${erro ? `, ${erro}` : ''}); a referência não foi conferida`,
    brainForaDoContrato: 'o get do Company Brain respondeu fora do contrato da entidade (orkmind.company-brain-entity/v1); ' +
      'a referência não foi conferida',
    brainSemConfiguracao: (codigo: string | null) =>
      `a configuração do Company Brain não foi lida (${codigo ?? 'sem código'}); a referência não foi conferida`,
    brainTeto: (n: number) => `a consulta passa de ${n} ids do Brain conferidos por get; a referência não foi conferida`,
    brainPrazo: (s: number) => `a conferência do Brain passou do prazo de ${s} s da consulta; a referência não foi conferida`,
    documentoInexistente: (id: string, semId: number) => `nenhum documento válido da pasta tem o id ${id}` +
      (semId ? `; ${semId} arquivo(s) da pasta viraram lacuna antes de o id ser lido (ork conhecimento verificar)` : ''),
  },
};

export const CONHECIMENTO_EN: typeof CONHECIMENTO_PT_BR = {
  uso: 'usage: ork conhecimento [listar [--colecao C]|mostrar <doc-id>|colecoes|verificar] [--json]',
  naoLido: 'Knowledge: the folder was not read.',
  listar: (dir, n, colecao) => `Knowledge in ${dir}${colecao === null ? '' : `, collection ${colecao}`}: ${n} document(s).`,
  documento: (id, titulo, colecoes) => `  ${id}  ${titulo} (${colecoes})`,
  nenhumDocumento: '  (no document)',
  paraLer: 'To read a document: `ork conhecimento mostrar <doc-id>`.',
  colecoes: (dir, n) => `Collections in ${dir}: ${n}.`,
  colecao: (nome, documentos) => `  ${nome}  ${documentos}`,
  nenhumaColecao: '  (no collection)',
  mostrar: (id, titulo) => `${id}: ${titulo}`,
  semDocumento: (id) => `${id}: no valid document with this id.`,
  colecoesDoDocumento: (colecoes) => `  collections  ${colecoes}`,
  arquivo: (arquivo) => `  file         ${arquivo}`,
  versao: (sha256, bytes) => `  version      sha256 ${sha256}, ${bytes} bytes`,
  brain: (id, titulo, kind, versao, fonte) => `  Brain        ${id}: ${titulo} (${kind}, version ${versao}, source ${fonte})`,
  decisao: (ref, tipo, fonte) => `  decision     ${ref}: ${tipo} (source ${fonte})`,
  semReferencia: '  references   none',
  corpo: 'Document body:',
  verificar: (dir, documentos, brain, decisoes) =>
    `Knowledge in ${dir}: ${documentos} valid document(s), ${brain} Brain id(s) and ${decisoes} decision(s) checked.`,
  aprovado: 'Check passed: no gap.',
  reprovado: (n) => `Check failed: ${n} gap(s).`,
  lacunasTitulo: (n) => `${n} gap(s), what was left out of the answer:`,
  lacuna: (codigo, onde, detalhe) => `  ${codigo}  ${onde}: ${detalhe}`,
  pasta: 'the folder',
  naReferencia: (referencia) => `reference ${referencia}`,
  lacunas: {
    naoDeclarado: 'the orkastery.yaml does not declare conhecimento.dir',
    dirForma: 'conhecimento.dir must be a folder relative to the root, without "..", outside .git and .orkastery, like ' +
      'docs/conhecimento; nothing was read',
    dirNaoAbre: 'the conhecimento.dir folder does not exist or does not open',
    dirForaDaRaiz: 'by the real path (links resolved), conhecimento.dir leaves the project root; the manifest comes with the ' +
      'repository and does not choose a path outside it; nothing was read',
    dirReal: 'by the real path, conhecimento.dir is the root itself, falls in .git or .orkastery, or has an invisible character; ' +
      'nothing was read',
    dirNaoEPasta: 'conhecimento.dir is not a folder',
    limiteEntradas: (n) => `the folder has more than ${n} entries; no document was returned`,
    limiteNiveis: (n) => `the folder has more than ${n} levels; no document was returned`,
    limiteTotal: (mib) => `the documents add up to more than ${mib} MiB; no document was returned`,
    link: 'symbolic links are not followed; the document is the versioned file',
    pastaNaoAbriu: 'the folder did not open for reading; what is in it was not read',
    nomeInvalido: 'name outside UTF-8 or with an invisible character; not read',
    entradaNaoAbriu: 'the entry did not open for reading; not read',
    naoRegular: 'not a regular file; not read',
    naoAbriuComoArquivo: 'did not open as a regular file, or changed during the read',
    grandeDemais: (kib) => `the document is larger than ${kib} KiB`,
    codificacao: 'the file is not UTF-8',
    semFrontmatter: 'the file does not start with the frontmatter between two --- lines',
    frontmatterGrande: (kib) => `the frontmatter is larger than ${kib} KiB`,
    frontmatterYaml: (erro) => `invalid YAML in the frontmatter (${erro})`,
    frontmatterNaoEMapa: 'the frontmatter must be a map of keys',
    idInvalido: 'id must be doc- followed by 3 to 48 lowercase letters, digits or hyphens, starting with a letter or digit',
    chaveDesconhecida: (chaves, doContrato) => `key outside the contract: ${chaves} (the frontmatter only has ${doContrato})`,
    tituloInvalido: (n) => `titulo must be text of 1 to ${n} characters, without a control character`,
    colecoesInvalidas: (n) => `colecoes must list 1 to ${n} names of 1 to 48 lowercase letters, digits or hyphens, ` +
      'without repeating',
    referenciasInvalidas: (n) => `referencias is a map with only brain and decisoes, each a list of up to ${n} texts`,
    idRepetido: (n) => `the id appears in ${n} files; none of them counts until only one is left`,
    brainForma: 'a Brain id is prod-, proj- or init-, by the rule of the portfolio ids',
    decisaoForma: 'a decision is <thread>#<line>, with the thread id and the ledger line counted from 1',
    ledgerLinkOuId: 'the thread folder in the project state is a link or breaks the id rule',
    ledgerNaoAbriu: (thread) => `the ledger of thread ${thread} did not open for reading`,
    semLedger: (thread) => `thread ${thread} has no ledger in this project`,
    ledgerNaoRegular: (thread, mib) => `the ledger of thread ${thread} is not a regular file of up to ${mib} MiB`,
    ledgerNaoUtf8: (thread) => `the ledger of thread ${thread} is not UTF-8`,
    ledgersDemais: (mib) => `the read goes past ${mib} MiB of ledger read; the decision was not checked`,
    linhasCompletas: (thread, n) => `the ledger of thread ${thread} has ${n} complete line(s)`,
    naoEJson: (linha, thread) => `line ${linha} of the ledger of thread ${thread} is not a JSON event`,
    outraThread: (linha, thread) => `line ${linha} of the ledger of thread ${thread} belongs to another thread`,
    naoEDecisao: (linha, thread, tipo, decisoes) =>
      `line ${linha} of the ledger of thread ${thread} is ${tipo ?? 'of no known type'}, not a decision (${decisoes})`,
    brainInexistente: 'the Company Brain does not have this id (get answered unknown)',
    brainRetido: 'the Company Brain has this id but withholds it from this read (get answered withheld); the reference is not citable here',
    brainNaoRespondeu: (estado, erro) =>
      `the Company Brain did not answer the get (${estado}${erro ? `, ${erro}` : ''}); the reference was not checked`,
    brainForaDoContrato: 'the Company Brain get answered outside the entity contract (orkmind.company-brain-entity/v1); ' +
      'the reference was not checked',
    brainSemConfiguracao: (codigo) =>
      `the Company Brain configuration was not read (${codigo ?? 'no code'}); the reference was not checked`,
    brainTeto: (n) => `the query goes past ${n} Brain ids checked by get; the reference was not checked`,
    brainPrazo: (s) => `the Brain check went past the query deadline of ${s} s; the reference was not checked`,
    documentoInexistente: (id, semId) => `no valid document in the folder has the id ${id}` +
      (semId ? `; ${semId} file(s) in the folder became gaps before the id was read (\`ork conhecimento verificar\`)` : ''),
  },
};
