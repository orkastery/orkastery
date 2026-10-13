/**
 * RM-053: a leitura da Orkastery Network, `ork network status` (contrato `ork.rede-status/v1`).
 *
 * Responde "quais maquinas desta pessoa existem e o que cada uma tem" de QUALQUER diretorio, e diz
 * sempre de onde leu, quando, e o que NAO leu. Lacuna e o que faltou ler, e ela nunca vira lista
 * vazia: no incidente de 29/09 o agente disse "nenhuma maquina publicou" quando so nao tinha olhado.
 *
 * D10: a branch `ork/fabrica-estado` dos projetos conhecidos continua lida. Maquina que so aparece
 * la entra com `origem: fabrica-estado` e `adesao: null` (vista, sem supor adesao), ate publicar na
 * rede; quando esta nos dois, o retrato da rede vence.
 * D15: maquina sem batida ha mais de 3 h vira a lacuna `maquina.sem-batida`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buscarBranch, git, pontaLocal, remotoRedigido, remotoValido } from './branch-de-estado';
import { BRANCH_DA_FABRICA, lerFabrica } from './fabrica-estado';
import { formatarDataHora, legendaDoFuso } from './horario';
import { ErroDoCatalogo, Mensagens, montadorDe, msg, remontar, textoDoCatalogo } from './locale';
import { carregarManifesto } from './manifest';
import { nomeDaMaquina } from './maquina';
import { arquivoDoRetrato, BRANCH_DA_REDE, cachePronto, CasaDaRede, dirDoCache, ForjaNoRetrato, HostNoRetrato, idNoArquivo, lerMarcaDaRede, nomeSeguro,
  prepararCache, refDaCasa, resolverCasa, RetratoDaMaquina, retratosDaPonta, RuntimeNoRetrato, urlDaCasaAceita } from './rede';
import { Adesao, adesaoDaRede, lerIdDaMaquina } from './rede-adesao';
import { AmbienteDaMaquina, comGitIsolado, ehNomeDeForja } from './rede-forja';
import { projetosConhecidos } from './rede-projetos';
import { jsonSemInvisivel, valoresEmUmaLinha } from './saida-segura';

export const CONTRATO_DO_STATUS = 'ork.rede-status/v1' as const;
/** D15: tres batidas perdidas. */
export const SEM_BATIDA_MS = 3 * 60 * 60 * 1000;
/** O que esta leitura nunca olha: quem conclui sobre isso a partir daqui erra. */
export const NAO_CONSULTADO: readonly string[] = ['roadmap', 'reservas', 'threads'];

export type TipoDeLacuna = 'forja.ausente' | 'forja.sem-login' | 'rede.sem-repositorio' | 'rede.repositorio-publico' |
  'rede.sem-leitura' | 'retrato.invalido' | 'maquina.sem-batida' | 'maquina.nome-em-uso' | 'fabrica.sem-leitura' | 'projeto.sem-clone';

export interface Lacuna { tipo: TipoDeLacuna; detalhe: string; maquina?: string; projeto?: string }

export interface FonteDaRede {
  fonte: 'rede' | 'fabrica-estado';
  ref: string;
  ponta: string | null;
  /** `false`: ultima copia local, sem leitura nova. */
  atualizado: boolean;
  projeto?: string;
}

export interface MembroDaRede {
  maquina: string;
  origem: 'rede' | 'fabrica-estado';
  publicadoEm: string;
  idadeMs: number;
  hostname: string | null;
  adesao: Adesao | null;
  /** Da fabrica legada: o `user.name` do git de quem publicou. */
  pessoa: string | null;
  forjas: ForjaNoRetrato[];
  runtimes: RuntimeNoRetrato[];
  hosts: HostNoRetrato[];
  projetos: { nome: string; remoto: string | null; caminho: string | null }[];
  versaoOrk: string | null;
}

export interface StatusDaRede {
  contrato: typeof CONTRATO_DO_STATUS;
  consultadoEm: string;
  casa: (Omit<CasaDaRede, 'origem'> & { origem: CasaDaRede['origem'] | 'marca' }) | null;
  estaMaquina: { maquina: string; membro: boolean; adesao: Adesao | null; publicada: boolean; nomeEmUso: boolean };
  fontes: FonteDaRede[];
  membros: MembroDaRede[];
  lacunas: Lacuna[];
  naoConsultado: string[];
}

export interface OpcoesDaLeitura {
  amb?: AmbienteDaMaquina;
  /** Sem rede: so a ultima copia local da casa e das fabricas. */
  semRemoto?: boolean;
  /** O diretorio de onde o `ork` foi chamado. */
  diretorio?: string | null;
  agora?: string;
  maquina?: string;
  arquivoDeProjetos?: string;
  timeoutMs?: number;
  /**
   * Suspeitas da revisao de 03/10: o servidor MCP fixado le a fabrica so do projeto dele. Sem isto, a
   * batida de uma maquina vista em dois projetos vinha do outro, e o servidor buscava no clone alheio.
   */
  soRaiz?: string;
}

const mensagem = (e: unknown) => (e as Error).message.replace(/^[a-z.-]+: /, '');
/**
 * RM-061 (F3b, G4): o detalhe da lacuna vai ao `--json` em pt-BR e nasce pelo catalogo; o erro de dentro (do catalogo
 * ou nao) e remontado com ela.
 */
const lacunaDoCatalogo = (montar: (m: Mensagens['network']) => string): string => textoDoCatalogo((m) => montar(m.network));
/**
 * RM-061 (F3b, GO-FIX 1 do CHECK): o montador do texto de um erro, sem o codigo do comeco. O erro do catalogo guarda o
 * proprio montador (o texto dele nao fica no registro); o resto sai como veio, ou pelo montador do texto embutido.
 */
function montadorDoErro(e: unknown): (m: Mensagens) => string {
  if (e instanceof ErroDoCatalogo) return (m) => e.montar(m).replace(/^[a-z.-]+: /, '');
  return montadorDe(mensagem(e));
}

/** Sem rede, a casa vem da adesao gravada ou da ultima publicacao desta maquina. */
function casaSemRede(): StatusDaRede['casa'] {
  const cfg = adesaoDaRede().config;
  if (cfg?.forja && cfg.host && cfg.dono && cfg.repositorio) {
    return { forja: cfg.forja, host: cfg.host, dono: cfg.dono, repositorio: cfg.repositorio, origem: 'rede.json' };
  }
  const marca = lerMarcaDaRede();
  const partes = marca?.casa?.split('/') ?? [];
  if (marca && ehNomeDeForja(marca.forja) && partes.length === 3) {
    return { forja: marca.forja, host: partes[0], dono: partes[1], repositorio: partes[2], origem: 'marca' };
  }
  return null;
}

function membroDoRetrato(r: RetratoDaMaquina, agoraMs: number): MembroDaRede {
  return { maquina: r.maquina, origem: 'rede', publicadoEm: r.publicadoEm, idadeMs: Math.max(0, agoraMs - Date.parse(r.publicadoEm)),
    hostname: r.hostname ?? null, adesao: r.adesao ?? null, pessoa: null, forjas: r.forjas, runtimes: r.runtimes, hosts: r.hosts,
    projetos: r.projetos.map((p) => ({ nome: p.nome, remoto: p.remoto, caminho: p.caminho })), versaoOrk: r.versaoOrk ?? null };
}

/** `ork network status`: a rede inteira, de qualquer diretorio, com fontes e lacunas. */
export function lerRede(o: OpcoesDaLeitura = {}): StatusDaRede {
  const consultadoEm = o.agora ?? new Date().toISOString();
  const agoraMs = Date.parse(consultadoEm);
  const eu = nomeSeguro(nomeDaMaquina(o.maquina));
  const adesao = adesaoDaRede();
  const lacunas: Lacuna[] = [], fontes: FonteDaRede[] = [];
  const membros = new Map<string, MembroDaRede>();

  // 1. A casa: resolvida pela forja (com rede) ou pela adesao e pela marca (sem rede).
  let casa: StatusDaRede['casa'] = null;
  let ler = true;
  let semHttps = false;
  if (o.semRemoto) {
    casa = casaSemRede();
    if (!casa) lacunas.push({ tipo: 'rede.sem-leitura', detalhe: lacunaDoCatalogo((m) => m.semRedeSemCasa) });
  } else {
    const r = resolverCasa({ amb: o.amb });
    casa = r.casa;
    if (r.motivo) lacunas.push({ tipo: r.motivo.tipo, detalhe: r.motivo.detalhe });
    if (r.casa && r.forja) {
      try {
        const repo = r.forja.repositorio(r.casa.dono, r.casa.repositorio);
        if (!repo.existe) {
          ler = false;
          const ref = refDaCasa(r.casa);
          lacunas.push({ tipo: 'rede.sem-repositorio', detalhe: lacunaDoCatalogo((m) => m.casaNaoExiste(ref)) });
        } else {
          const ref = refDaCasa(r.casa);
          if (repo.privado !== true) lacunas.push({ tipo: 'rede.repositorio-publico', detalhe: lacunaDoCatalogo((m) => m.casaPublica(ref)) });
          if (repo.url && urlDaCasaAceita(repo.url)) prepararCache(r.casa, repo.url, r.forja.helperDeCredencial(), eu);
          else if (repo.url) {
            // W10 da revisao 5: sem https nao ha leitura nova; o cache fica com a URL antiga e so a copia local vale.
            semHttps = true;
            lacunas.push({ tipo: 'rede.sem-leitura', detalhe: lacunaDoCatalogo((m) => m.casaSemHttps(ref)) });
          }
        }
      } catch (e) {
        const ref = refDaCasa(r.casa), erro = montadorDoErro(e);
        lacunas.push({ tipo: 'rede.sem-leitura', detalhe: textoDoCatalogo((m) => m.network.comErro(ref, erro(m))) });
      }
    }
  }

  // 2. Os retratos da casa.
  let retratos: RetratoDaMaquina[] = [];
  let lida: { cache: string; ponta: string | null } | null = null;
  if (casa && ler) {
    const cache = dirDoCache(casa);
    if (cachePronto(cache) && comGitIsolado(() => git(cache, ['config', 'remote.origin.url']).ok)) {
      const soLocal = o.semRemoto || semHttps;
      const { ponta, atualizado } = comGitIsolado(() => soLocal
        ? { ponta: pontaLocal(cache, 'origin', BRANCH_DA_REDE), atualizado: false }
        : buscarBranch(cache, 'origin', BRANCH_DA_REDE, 'rede', o.timeoutMs ?? 30000));
      fontes.push({ fonte: 'rede', ref: `${refDaCasa(casa)}#${BRANCH_DA_REDE}`, ponta, atualizado });
      if (!atualizado && !soLocal) {
        const ref = refDaCasa(casa);
        lacunas.push({ tipo: 'rede.sem-leitura', detalhe: lacunaDoCatalogo((m) => m.semLeituraNova(ref, !!ponta)) });
      }
      const lidos = retratosDaPonta(cache, ponta);
      lida = { cache, ponta };
      retratos = lidos.retratos;
      for (const inv of lidos.invalidos) {
        const motivo = montadorDe(inv.motivo);
        lacunas.push({ tipo: 'retrato.invalido', detalhe: textoDoCatalogo((m) => m.network.retratoInvalido(inv.arquivo, motivo(m))) });
      }
    } else if (!lacunas.some((l) => l.tipo === 'rede.sem-leitura')) {
      const ref = refDaCasa(casa);
      lacunas.push({ tipo: 'rede.sem-leitura', detalhe: lacunaDoCatalogo((m) => m.nuncaLida(ref)) });
    }
  }
  for (const r of retratos) membros.set(r.maquina, membroDoRetrato(r, agoraMs));

  // 3. A fabrica legada dos projetos conhecidos (D10).
  const marca = lerMarcaDaRede();
  const anteriores = retratos.find((r) => r.maquina === eu)?.projetos ?? (marca?.maquina === eu ? marca.projetos : undefined);
  const conhecidos = projetosConhecidos({ arquivo: o.arquivoDeProjetos, diretorio: o.diretorio, anteriores }).projetos;
  const raizDe = (c: string) => { try { return fs.realpathSync(c); } catch { return path.resolve(c); } };
  const projetos = o.soRaiz === undefined ? conhecidos : conhecidos.filter((p) => raizDe(p.caminho) === raizDe(o.soRaiz!));
  for (const p of projetos) {
    if (!p.presente) {
      lacunas.push({ tipo: 'projeto.sem-clone', projeto: p.nome, detalhe: lacunaDoCatalogo((m) => m.semClone(p.nome, p.caminho)) });
      continue;
    }
    let remoto = 'origin';
    try { remoto = carregarManifesto(p.caminho)?.manifesto.fabrica.remoto ?? 'origin'; } catch { /* manifesto ruim: origin */ }
    // RM-047: o `fabrica.remoto` vem do manifesto versionado; so nome de remoto vai ao git (depois do `--`),
    // e o valor recusado sai redigido, sem a credencial de uma URL, no texto e no JSON.
    if (!remotoValido(remoto)) {
      lacunas.push({ tipo: 'fabrica.sem-leitura', projeto: p.nome,
        detalhe: lacunaDoCatalogo((m) => m.remotoInvalido(p.nome, remotoRedigido(remoto))) });
      continue;
    }
    if (!comGitIsolado(() => git(p.caminho, ['remote', 'get-url', '--', remoto]).ok)) {
      lacunas.push({ tipo: 'fabrica.sem-leitura', projeto: p.nome, detalhe: lacunaDoCatalogo((m) => m.semRemoto(p.nome, remoto)) });
      continue;
    }
    try {
      // M5: sem prompt de senha; um remoto que pediria senha vira lacuna, nao trava o status. S4: o
      // `core.sshCommand` do projeto (chave propria, proxy) continua valendo.
      const sshProprio = comGitIsolado(() => git(p.caminho, ['config', '--get', 'core.sshCommand']).stdout.trim() !== '');
      const painel = comGitIsolado(() => lerFabrica(p.caminho, { remoto, semRemoto: o.semRemoto, timeoutMs: o.timeoutMs ?? 10000 }),
        undefined, { ssh: sshProprio ? 'herdado' : 'lote' });
      fontes.push({ fonte: 'fabrica-estado', projeto: p.nome, ref: BRANCH_DA_FABRICA, ponta: painel.ponta, atualizado: painel.atualizado });
      if (!painel.atualizado && !o.semRemoto) {
        lacunas.push({ tipo: 'fabrica.sem-leitura', projeto: p.nome, detalhe: lacunaDoCatalogo((m) => m.fabricaSemLeituraNova(p.nome, BRANCH_DA_FABRICA)) });
      }
      for (const bruto of painel.maquinas) {
        // U4 da revisao 3: a fabrica guarda o nome cru, a rede o saneado; casam pelo saneado.
        const m = { ...bruto, maquina: nomeSeguro(bruto.maquina) };
        const atual = membros.get(m.maquina);
        if (atual?.origem === 'rede') continue;
        const idadeMs = Math.max(0, agoraMs - Date.parse(m.publicadoEm));
        if (atual) {
          if (!atual.projetos.some((x) => x.nome === m.projeto)) atual.projetos.push({ nome: m.projeto, remoto: null, caminho: null });
          // Y1 da revisao 7: a batida ilegivel (NaN) guardada antes perde para qualquer batida legivel.
          if (Number.isFinite(idadeMs) && !(atual.idadeMs <= idadeMs)) Object.assign(atual, { publicadoEm: m.publicadoEm, idadeMs, versaoOrk: m.versaoOrk ?? null });
          continue;
        }
        // B11 do CHECK 1: quem so aparece na fabrica nao e dado como membro. Pode ser um `ork` antigo, uma
        // maquina que saiu da rede ou uma sem forja: a leitura diz o que viu, nao o que supoe.
        membros.set(m.maquina, { maquina: m.maquina, origem: 'fabrica-estado', publicadoEm: m.publicadoEm, idadeMs, hostname: null,
          adesao: null, pessoa: m.por ?? null, forjas: [], runtimes: [], hosts: [],
          projetos: [{ nome: m.projeto, remoto: null, caminho: null }], versaoOrk: m.versaoOrk ?? null });
      }
    } catch (e) {
      const erro = montadorDoErro(e);
      lacunas.push({ tipo: 'fabrica.sem-leitura', projeto: p.nome, detalhe: textoDoCatalogo((m) => m.network.comErro(p.nome, erro(m))) });
    }
  }

  // S7 da revisao 2: o retrato com o nome desta maquina pode ser de outra instalacao (tomou o nome).
  const meuId = lerIdDaMaquina();
  const comMeuNome = retratos.find((r) => r.maquina === eu);
  // V7 da revisao 4: o arquivo com este nome num contrato mais novo, com outro `id`, tambem e de outra instalacao.
  let idDeOutraVersao: string | null = null;
  if (!comMeuNome && lida) { try { idDeOutraVersao = idNoArquivo(lida.cache, lida.ponta, arquivoDoRetrato(eu)); } catch { /* nome impossivel */ } }
  const idNaCasa = comMeuNome?.id ?? idDeOutraVersao;
  // Revisao de 03/10: sem id local (nunca publicou, ou ~/.orkastery apagada), a proxima publicacao cria um id novo
  // e o `publicarRede` recusa com `rede.nome-em-uso`; o status diz o mesmo, em vez de chamar de "esta maquina".
  const nomeEmUso = !!idNaCasa && idNaCasa !== meuId;
  if (nomeEmUso) {
    lacunas.push({ tipo: 'maquina.nome-em-uso', maquina: eu, detalhe: lacunaDoCatalogo((m) => m.nomeEmUsoNaCasa(eu)) });
  }

  // 4. O frescor de cada maquina (D15).
  const lista = [...membros.values()].sort((a, b) => a.maquina.localeCompare(b.maquina));
  for (const m of lista) {
    // X5 da revisao 6: batida ilegivel (a fabrica legada aceita qualquer texto) nao passa por fresca.
    if (!Number.isFinite(m.idadeMs)) lacunas.push({ tipo: 'maquina.sem-batida', maquina: m.maquina, detalhe: lacunaDoCatalogo((t) => t.batidaIlegivel(m.maquina)) });
    else if (m.idadeMs > SEM_BATIDA_MS) {
      const idadeMs = m.idadeMs;
      lacunas.push({ tipo: 'maquina.sem-batida', maquina: m.maquina, detalhe: lacunaDoCatalogo((t) => t.semBatidaHa(m.maquina, duracao(idadeMs))) });
    }
  }
  return {
    contrato: CONTRATO_DO_STATUS, consultadoEm, casa: casa ? { ...casa } : null,
    estaMaquina: { maquina: eu, membro: adesao.membro, adesao: adesao.adesao, publicada: !!comMeuNome && !nomeEmUso, nomeEmUso },
    fontes, membros: lista, lacunas, naoConsultado: [...NAO_CONSULTADO],
  };
}

export function duracao(ms: number): string {
  if (!Number.isFinite(ms)) return msg().horario.duracaoDesconhecida;
  const min = Math.round(ms / 60000);
  if (min < 1) return msg().horario.menosDeUmMin;
  if (min < 120) return `${min} min`;
  const h = Math.round(ms / 3600000);
  return h < 48 ? `${h} h` : `${Math.round(ms / 86400000)} d`;
}

/** O texto de `ork network status`: fonte e o que nao foi lido primeiro, lacunas sempre no fim. */
export function textoDaRede(status: StatusDaRede): string {
  // V2 da revisao 4 e W4 da revisao 5: a fabrica legada vem do remoto de um projeto, onde outras pessoas
  // escrevem. Cada VALOR vai numa linha so e sem nada que o terminal execute ou que ninguem ve, antes de
  // entrar no texto: um `\n` num valor nao abre uma linha que parece do `ork`.
  // X5 da revisao 6: um mapa que so troca texto (a ida e volta em JSON trocava `NaN` por `null`).
  // RM-061 (F3b): a moldura pelo catalogo; o detalhe da lacuna (pt-BR no --json) e remontado e limpo do mesmo jeito.
  const s = valoresEmUmaLinha(status);
  const t = msg().network;
  const linhas: string[] = [];
  const rede = s.fontes.find((f) => f.fonte === 'rede');
  const estadoDaCasa = rede ? (rede.atualizado ? t.casaLidaAgora : t.casaUltimaCopia) : t.casaNaoLida;
  linhas.push(s.casa ? t.cabecalhoComCasa(s.casa.dono, s.casa.forja, refDaCasa(s.casa), estadoDaCasa) : t.semCasa);
  const consultado = [
    ...(rede ? [t.repositorioDaRede(rede.ponta ? rede.ponta.slice(0, 7) : null)] : []),
    ...s.fontes.filter((f) => f.fonte === 'fabrica-estado').map((f) => t.fabricaDe(String(f.projeto), f.ref, f.atualizado)),
  ];
  linhas.push(t.consultado(consultado.length ? consultado.join('; ') : null));
  linhas.push(t.naoConsultado(s.naoConsultado.map(t.itemNaoConsultado).join(', ')));
  linhas.push('');
  if (s.membros.length === 0) linhas.push(t.nenhumaMaquina);
  for (const m of s.membros) {
    const esta = m.maquina !== s.estaMaquina.maquina ? ''
      : m.origem === 'rede' && s.estaMaquina.nomeEmUso ? t.outraInstalacao : t.estaMaquina;
    const origem = m.origem === 'rede' ? t.origemRede(m.adesao === 'fabrica') : t.origemFabrica(m.projetos.map((p) => p.nome).join(', '));
    linhas.push(t.membro(m.maquina, esta, origem, formatarDataHora(m.publicadoEm), duracao(m.idadeMs)));
    const ficha = [m.hostname ? t.fichaHostname(m.hostname) : null, m.versaoOrk ? t.fichaOrk(m.versaoOrk) : null,
      ...m.forjas.map((f) => t.fichaForja(f.forja, f.usuario ?? null)), m.pessoa ? t.fichaPessoa(m.pessoa) : null].filter(Boolean);
    if (ficha.length) linhas.push(`  ${ficha.join(' · ')}`);
    if (m.runtimes.length) linhas.push(t.runtimes(m.runtimes.map((r) => `${r.runtime} ${r.versao ?? '?'}`).join(', ')));
    if (m.hosts.length) {
      linhas.push(t.hosts(m.hosts.map((h) => `${h.host} ${h.versao ?? '?'}${h.adaptador ? t.hostAdaptador(h.adaptador) : ''}`).join(', ')));
    }
    if (m.projetos.length) {
      linhas.push(t.projetos(m.projetos.map((p) => `${p.nome}${p.remoto ? ` (${p.remoto})` : ''}${p.caminho ? t.projetoEm(p.caminho) : ''}`).join('; ')));
    }
  }
  linhas.push('');
  const aqui = s.estaMaquina;
  linhas.push(aqui.membro ? t.estaEMembro(aqui.maquina, aqui.adesao === 'fabrica', aqui.publicada) : t.foraDaRedeLinha(aqui.maquina));
  if (s.lacunas.length === 0) linhas.push(t.semLacunas);
  else {
    linhas.push(t.lacunas(s.lacunas.length));
    s.lacunas.forEach((l, i) => linhas.push(t.lacuna(l.tipo, valoresEmUmaLinha(remontar(status.lacunas[i].detalhe)))));
  }
  linhas.push(legendaDoFuso());
  return linhas.join('\n');
}

/**
 * `ork network status --json`: o mesmo JSON, com os caracteres invisiveis escritos como `\uXXXX`
 * (o valor lido e o mesmo; so o terminal deixa de executa-los). A quebra de linha da indentacao fica.
 */
export function jsonDaRede(s: StatusDaRede): string {
  return jsonSemInvisivel(s);
}
