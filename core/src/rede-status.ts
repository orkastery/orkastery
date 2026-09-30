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
import { buscarBranch, git, pontaLocal } from './branch-de-estado';
import { BRANCH_DA_FABRICA, lerFabrica } from './fabrica-estado';
import { formatarDataHora, legendaDoFuso } from './horario';
import { carregarManifesto } from './manifest';
import { nomeDaMaquina } from './maquina';
import { BRANCH_DA_REDE, cachePronto, CasaDaRede, dirDoCache, ForjaNoRetrato, HostNoRetrato, lerMarcaDaRede, nomeSeguro, prepararCache, refDaCasa,
  resolverCasa, RetratoDaMaquina, retratosDaPonta, RuntimeNoRetrato } from './rede';
import { Adesao, adesaoDaRede, lerIdDaMaquina } from './rede-adesao';
import { AmbienteDaMaquina, comGitIsolado, ehNomeDeForja } from './rede-forja';
import { projetosConhecidos } from './rede-projetos';

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
}

const mensagem = (e: unknown) => (e as Error).message.replace(/^[a-z.-]+: /, '');

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
  if (o.semRemoto) {
    casa = casaSemRede();
    if (!casa) lacunas.push({ tipo: 'rede.sem-leitura', detalhe: 'sem rede e sem casa conhecida nesta maquina: rode sem --sem-remoto' });
  } else {
    const r = resolverCasa({ amb: o.amb });
    casa = r.casa;
    if (r.motivo) lacunas.push({ tipo: r.motivo.tipo, detalhe: r.motivo.detalhe });
    if (r.casa && r.forja) {
      try {
        const repo = r.forja.repositorio(r.casa.dono, r.casa.repositorio);
        if (!repo.existe) {
          ler = false;
          lacunas.push({ tipo: 'rede.sem-repositorio', detalhe: `${refDaCasa(r.casa)} ainda nao existe: nenhuma maquina rodou ork network entrar` });
        } else {
          if (repo.privado !== true) lacunas.push({ tipo: 'rede.repositorio-publico', detalhe: `${refDaCasa(r.casa)} nao e privado: nenhuma maquina publica nele` });
          if (repo.url) prepararCache(r.casa, repo.url, r.forja.helperDeCredencial(), eu);
        }
      } catch (e) {
        lacunas.push({ tipo: 'rede.sem-leitura', detalhe: `${refDaCasa(r.casa)}: ${mensagem(e)}` });
      }
    }
  }

  // 2. Os retratos da casa.
  let retratos: RetratoDaMaquina[] = [];
  if (casa && ler) {
    const cache = dirDoCache(casa);
    if (cachePronto(cache) && comGitIsolado(() => git(cache, ['config', 'remote.origin.url']).ok)) {
      const { ponta, atualizado } = comGitIsolado(() => o.semRemoto
        ? { ponta: pontaLocal(cache, 'origin', BRANCH_DA_REDE), atualizado: false }
        : buscarBranch(cache, 'origin', BRANCH_DA_REDE, 'rede', o.timeoutMs ?? 30000));
      fontes.push({ fonte: 'rede', ref: `${refDaCasa(casa)}#${BRANCH_DA_REDE}`, ponta, atualizado });
      if (!atualizado && !o.semRemoto) {
        lacunas.push({ tipo: 'rede.sem-leitura', detalhe: `${refDaCasa(casa)} sem leitura nova: ${ponta ? 'mostrando a ultima copia local' : 'nenhuma copia local'}` });
      }
      const lidos = retratosDaPonta(cache, ponta);
      retratos = lidos.retratos;
      for (const inv of lidos.invalidos) lacunas.push({ tipo: 'retrato.invalido', detalhe: `${inv.arquivo}: ${inv.motivo}` });
    } else if (!lacunas.some((l) => l.tipo === 'rede.sem-leitura')) {
      lacunas.push({ tipo: 'rede.sem-leitura', detalhe: `${refDaCasa(casa)} nunca foi lida nesta maquina` });
    }
  }
  for (const r of retratos) membros.set(r.maquina, membroDoRetrato(r, agoraMs));

  // 3. A fabrica legada dos projetos conhecidos (D10).
  const marca = lerMarcaDaRede();
  const anteriores = retratos.find((r) => r.maquina === eu)?.projetos ?? (marca?.maquina === eu ? marca.projetos : undefined);
  const { projetos } = projetosConhecidos({ arquivo: o.arquivoDeProjetos, diretorio: o.diretorio, anteriores });
  for (const p of projetos) {
    if (!p.presente) {
      lacunas.push({ tipo: 'projeto.sem-clone', projeto: p.nome, detalhe: `${p.nome}: ${p.caminho} nao tem mais o projeto nesta maquina` });
      continue;
    }
    let remoto = 'origin';
    try { remoto = carregarManifesto(p.caminho)?.manifesto.fabrica.remoto ?? 'origin'; } catch { /* manifesto ruim: origin */ }
    if (!comGitIsolado(() => git(p.caminho, ['remote', 'get-url', remoto]).ok)) {
      lacunas.push({ tipo: 'fabrica.sem-leitura', projeto: p.nome, detalhe: `${p.nome}: sem o remoto ${remoto}, nao ha fabrica compartilhada para ler` });
      continue;
    }
    try {
      // M5: sem prompt de senha e com SSH em lote; um remoto que pediria senha vira lacuna, nao trava o status.
      const painel = comGitIsolado(() => lerFabrica(p.caminho, { remoto, semRemoto: o.semRemoto, timeoutMs: o.timeoutMs ?? 10000 }));
      fontes.push({ fonte: 'fabrica-estado', projeto: p.nome, ref: BRANCH_DA_FABRICA, ponta: painel.ponta, atualizado: painel.atualizado });
      if (!painel.atualizado && !o.semRemoto) {
        lacunas.push({ tipo: 'fabrica.sem-leitura', projeto: p.nome, detalhe: `${p.nome}: ${BRANCH_DA_FABRICA} sem leitura nova; usei a ultima copia local` });
      }
      for (const m of painel.maquinas) {
        const atual = membros.get(m.maquina);
        if (atual?.origem === 'rede') continue;
        const idadeMs = Math.max(0, agoraMs - Date.parse(m.publicadoEm));
        if (atual) {
          if (!atual.projetos.some((x) => x.nome === m.projeto)) atual.projetos.push({ nome: m.projeto, remoto: null, caminho: null });
          if (idadeMs < atual.idadeMs) Object.assign(atual, { publicadoEm: m.publicadoEm, idadeMs, versaoOrk: m.versaoOrk ?? null });
          continue;
        }
        // B11 do CHECK 1: quem so aparece na fabrica nao e dado como membro. Pode ser um `ork` antigo, uma
        // maquina que saiu da rede ou uma sem forja: a leitura diz o que viu, nao o que supoe.
        membros.set(m.maquina, { maquina: m.maquina, origem: 'fabrica-estado', publicadoEm: m.publicadoEm, idadeMs, hostname: null,
          adesao: null, pessoa: m.por ?? null, forjas: [], runtimes: [], hosts: [],
          projetos: [{ nome: m.projeto, remoto: null, caminho: null }], versaoOrk: m.versaoOrk ?? null });
      }
    } catch (e) {
      lacunas.push({ tipo: 'fabrica.sem-leitura', projeto: p.nome, detalhe: `${p.nome}: ${mensagem(e)}` });
    }
  }

  // S7 da revisao 2: o retrato com o nome desta maquina pode ser de outra instalacao (tomou o nome).
  const meuId = lerIdDaMaquina();
  const comMeuNome = retratos.find((r) => r.maquina === eu);
  const nomeEmUso = !!comMeuNome?.id && !!meuId && comMeuNome.id !== meuId;
  if (nomeEmUso) {
    lacunas.push({ tipo: 'maquina.nome-em-uso', maquina: eu, detalhe: `o retrato "${eu}" na casa e de outra instalacao: esta maquina nao ` +
      'publica ate trocar de nome (ork network entrar --maquina NOME) ou retomar este (ork network entrar --forcar)' });
  }

  // 4. O frescor de cada maquina (D15).
  const lista = [...membros.values()].sort((a, b) => a.maquina.localeCompare(b.maquina));
  for (const m of lista) {
    if (m.idadeMs > SEM_BATIDA_MS) lacunas.push({ tipo: 'maquina.sem-batida', maquina: m.maquina, detalhe: `${m.maquina}: sem batida ha ${duracao(m.idadeMs)}` });
  }
  return {
    contrato: CONTRATO_DO_STATUS, consultadoEm, casa: casa ? { ...casa } : null,
    estaMaquina: { maquina: eu, membro: adesao.membro, adesao: adesao.adesao, publicada: !!comMeuNome && !nomeEmUso, nomeEmUso },
    fontes, membros: lista, lacunas, naoConsultado: [...NAO_CONSULTADO],
  };
}

export function duracao(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'menos de 1 min';
  if (min < 120) return `${min} min`;
  const h = Math.round(ms / 3600000);
  return h < 48 ? `${h} h` : `${Math.round(ms / 86400000)} d`;
}

/** O texto de `ork network status`: fonte e o que nao foi lido primeiro, lacunas sempre no fim. */
export function textoDaRede(s: StatusDaRede): string {
  const linhas: string[] = [];
  const rede = s.fontes.find((f) => f.fonte === 'rede');
  const estadoDaCasa = rede ? (rede.atualizado ? 'lida agora' : 'última cópia local') : 'não lida';
  linhas.push(s.casa
    ? `Orkastery Network de ${s.casa.dono} · ${s.casa.forja}: ${refDaCasa(s.casa)} · ${estadoDaCasa}`
    : 'Orkastery Network · sem casa: nenhuma forja com login nesta máquina');
  const consultado = [
    ...(rede ? [`repositório da rede (${rede.ponta ? rede.ponta.slice(0, 7) : 'vazio'})`] : []),
    ...s.fontes.filter((f) => f.fonte === 'fabrica-estado')
      .map((f) => `fábrica de ${f.projeto} (${f.ref}, ${f.atualizado ? 'lida agora' : 'última cópia'})`),
  ];
  linhas.push(`Consultado: ${consultado.length ? consultado.join('; ') : 'nada (veja as lacunas)'}.`);
  linhas.push(`Não consultado: ${s.naoConsultado.join(', ')}. O roadmap de um projeto sai do ork roadmap status nele.`);
  linhas.push('');
  if (s.membros.length === 0) linhas.push('Nenhuma máquina lida. Isso não quer dizer que não há máquinas: veja as lacunas.');
  for (const m of s.membros) {
    const esta = m.maquina !== s.estaMaquina.maquina ? ''
      : m.origem === 'rede' && s.estaMaquina.nomeEmUso ? ' (outra instalação com o nome desta máquina)' : ' (esta máquina)';
    const origem = m.origem === 'rede' ? `rede${m.adesao === 'fabrica' ? ', adesão herdada da fábrica' : ''}`
      : `vista só na fábrica de ${m.projetos.map((p) => p.nome).join(', ')}; não publica na rede`;
    linhas.push(`${m.maquina}${esta} · ${origem} · batida ${formatarDataHora(m.publicadoEm)} (há ${duracao(m.idadeMs)})`);
    const ficha = [m.hostname ? `hostname ${m.hostname}` : null, m.versaoOrk ? `ork ${m.versaoOrk}` : null,
      ...m.forjas.map((f) => `${f.forja}: ${f.usuario ?? 'sem login'}`), m.pessoa ? `pessoa ${m.pessoa}` : null].filter(Boolean);
    if (ficha.length) linhas.push(`  ${ficha.join(' · ')}`);
    if (m.runtimes.length) linhas.push(`  runtimes: ${m.runtimes.map((r) => `${r.runtime} ${r.versao ?? '?'}`).join(', ')}`);
    if (m.hosts.length) {
      linhas.push(`  hosts: ${m.hosts.map((h) => `${h.host} ${h.versao ?? '?'}${h.adaptador ? ` (adaptador ${h.adaptador})` : ''}`).join(', ')}`);
    }
    if (m.projetos.length) {
      linhas.push(`  projetos: ${m.projetos.map((p) => `${p.nome}${p.remoto ? ` (${p.remoto})` : ''}${p.caminho ? ` em ${p.caminho}` : ''}`).join('; ')}`);
    }
  }
  linhas.push('');
  const aqui = s.estaMaquina;
  linhas.push(aqui.membro
    ? `Esta máquina (${aqui.maquina}) é membro${aqui.adesao === 'fabrica' ? ', herdado da fábrica' : ''}${aqui.publicada ? '.' : '; o retrato dela ainda não está na casa.'}`
    : `Esta máquina (${aqui.maquina}) não está na rede: ork network entrar.`);
  if (s.lacunas.length === 0) linhas.push('Lacunas: nenhuma.');
  else {
    linhas.push(`Lacunas (${s.lacunas.length}), o que faltou ler:`);
    for (const l of s.lacunas) linhas.push(`  • ${l.tipo}: ${l.detalhe}`);
  }
  linhas.push(legendaDoFuso());
  return linhas.join('\n');
}
