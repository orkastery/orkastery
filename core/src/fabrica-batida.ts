/**
 * RM-063 (F1): a batida da fabrica, instalada e vigiada pelo proprio `ork`.
 *
 * Incidente do maquina-b, de 03/10 a 12/10/2026 (P1 e P7 da pagina da RM-063): o cron da varredura do
 * pulse nunca foi instalado, o `ork doctor` so conferia o crontab com `pulse-host.json` e, sem
 * transporte, calava; a correcao (editar o crontab) foi barrada como persistencia nao autorizada. A
 * maquina ficou nove dias sem batida e ninguem soube.
 *
 * `ork fabrica batida instalar|status|remover` e o comando que o dono autoriza uma vez: instala a linha
 * do template `monitor/pulse.cron` com o checkout canonico e o PATH que acha o `node`, o `claude` e o
 * transporte, preserva as outras entradas do crontab e grava o evento no ledger da maquina
 * (`~/.orkastery/ledger.jsonl`). A linha e marcada (`# ork-batida`) e diz o projeto
 * (`ORK_PULSE_PROJECT`): e por elas que o `remover` tira so a linha dela.
 *
 * O crontab nunca e gravado sem ter sido lido, e a gravacao so vale depois de relida. O executor e
 * injetado: os testes usam um crontab falso e nunca tocam no da maquina.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ATRASO_DA_BATIDA_MIN, BATIDA_DO_TEMPLATE, citarNoShell, entradaDoProjeto, entradasDaVarredura, intervaloEmMinutos, LeituraDoCrontab,
  lerCrontabDoSistema, RodadaDaVarredura, SCRIPT_DA_VARREDURA, scriptDaVarreduraDoOrk, ultimaRodadaDaVarredura,
} from './doctor-pulse-cron';

export { ATRASO_DA_BATIDA_MIN, ultimaRodadaDaVarredura } from './doctor-pulse-cron';
import { raizDoEstado } from './estado-thread';
import { registrar, TIPOS_DE_EVENTO } from './ledger';
import { nomeDaMaquina, pastaDoUsuario } from './maquina';
import { formatarHora, legendaDoFuso } from './horario';
import { noPath } from './util';
import { exigirHostLocal } from './procedencia';

/** O comentario no fim da linha que o `ork` instalou; o `sh` do cron o ignora. */
export const MARCA_DA_BATIDA = '# ork-batida';
/** Os binarios que a varredura chama, alem do `node`: o runtime, a forja e o git. */
const BINARIOS_DA_VARREDURA = ['claude', 'codex', 'gh', 'git'];
const PATH_DO_SISTEMA = ['/usr/local/bin', '/usr/bin', '/bin'];

export type GravacaoDoCrontab = { ok: true } | { ok: false; motivo: string };

/** Quem le e grava o crontab do usuario. O padrao e o `crontab` do sistema; os testes trocam. */
export interface ExecutorDoCrontab {
  ler: () => LeituraDoCrontab;
  gravar: (texto: string) => GravacaoDoCrontab;
}

/** `crontab -` com o texto no stdin, sem shell e com prazo. */
export function gravarCrontabDoSistema(texto: string): GravacaoDoCrontab {
  const r = spawnSync('crontab', ['-'], { input: texto, encoding: 'utf8', timeout: 5000 });
  if (r.status === 0) return { ok: true };
  const erro = r.error ? (r.error as NodeJS.ErrnoException).code ?? r.error.message : null;
  if (erro === 'ENOENT') return { ok: false, motivo: 'comando crontab ausente nesta maquina' };
  const primeira = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n')[0] ?? '';
  return { ok: false, motivo: primeira ? `crontab - falhou: ${primeira}` : `crontab - saiu ${r.status ?? erro ?? 'sem codigo'}` };
}

export const CRONTAB_DO_SISTEMA: ExecutorDoCrontab = { ler: lerCrontabDoSistema, gravar: gravarCrontabDoSistema };

/** Caminho que entra na linha do cron: absoluto, sem `%` (o cron o troca por quebra de linha) e sem controle. */
function caminhoAceito(caminho: string): boolean {
  return path.isAbsolute(caminho) && !/[%\p{Cc}]/u.test(caminho);
}

/** Diretorio aceito no PATH da linha: alem do caminho aceito, sem `:`, o separador do PATH. */
function diretorioAceito(dir: string): boolean {
  return caminhoAceito(dir) && !dir.includes(':');
}

/**
 * O executavel do transporte, so do `pulse-host.json` local desta maquina (RM-047, P2): o versionado no git, ou o link,
 * nao poe diretorio nenhum no PATH da batida.
 */
function transporteDoProjeto(raiz: string, dirMonitor: string): string | null {
  const arquivo = path.join(dirMonitor, 'pulse-host.json');
  try {
    exigirHostLocal(raiz, arquivo);
    const config = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { executavel?: unknown };
    return typeof config.executavel === 'string' && config.executavel.trim() ? config.executavel.trim() : null;
  } catch { return null; }
}

/**
 * O PATH da linha: o diretorio do `node` que roda este `ork`, os do `claude`, `codex`, `gh` e `git` achados
 * agora, o do executavel do transporte (`pulse-host.json`) e o PATH minimo do sistema. O cron nao carrega o
 * perfil do shell; sem isto a varredura nao acha o runtime nem o transporte (o template avisa).
 */
export function caminhoDaBatida(opcoes: { node?: string; transporte?: string | null; achar?: (bin: string) => string | null } = {}): string {
  const achar = opcoes.achar ?? ((bin: string) => noPath(bin));
  const dirs: string[] = [];
  const somar = (arquivo: string | null | undefined): void => {
    if (!arquivo || !path.isAbsolute(arquivo)) return;
    const dir = path.dirname(arquivo);
    if (diretorioAceito(dir) && !dirs.includes(dir)) dirs.push(dir);
  };
  somar(opcoes.node ?? process.execPath);
  for (const bin of BINARIOS_DA_VARREDURA) somar(achar(bin));
  if (opcoes.transporte) somar(path.isAbsolute(opcoes.transporte) ? opcoes.transporte : achar(opcoes.transporte));
  for (const dir of PATH_DO_SISTEMA) if (!dirs.includes(dir)) dirs.push(dir);
  return dirs.join(':');
}

/** O script da varredura que a linha roda: o do checkout do projeto, senao o do `ork` instalado. */
export function scriptDaBatida(raiz: string, scriptDoOrk: string | null = scriptDaVarreduraDoOrk()): string | null {
  const doProjeto = path.join(raiz, 'monitor', SCRIPT_DA_VARREDURA);
  return fs.existsSync(doProjeto) ? doProjeto : scriptDoOrk;
}

export interface OpcoesDaLinha {
  scriptDoOrk?: string | null;
  node?: string;
  achar?: (bin: string) => string | null;
}

/**
 * A linha que o `ork` instala: a batida do template (`*\/15`), o projeto alvo, o PATH e o script, com a
 * marca no fim. `raiz` e a raiz canonica (o checkout principal, nunca a worktree de uma thread).
 */
export function linhaDaBatida(raiz: string, opcoes: OpcoesDaLinha = {}): string {
  const script = scriptDaBatida(raiz, opcoes.scriptDoOrk === undefined ? scriptDaVarreduraDoOrk() : opcoes.scriptDoOrk);
  if (!script) {
    throw new Error(`fabrica.batida.sem-script: nem ${path.join(raiz, 'monitor', SCRIPT_DA_VARREDURA)} nem o ` +
      `${SCRIPT_DA_VARREDURA} do ork instalado existem; reinstale o ork (npm i -g @orkastery/cli)`);
  }
  for (const caminho of [raiz, script]) {
    if (!caminhoAceito(caminho)) {
      throw new Error(`fabrica.batida.caminho-invalido: ${JSON.stringify(caminho)} nao cabe numa linha do cron ` +
        '(precisa ser absoluto, sem % e sem caractere de controle)');
    }
  }
  const PATH = caminhoDaBatida({ node: opcoes.node, achar: opcoes.achar,
    transporte: transporteDoProjeto(raiz, path.join(raiz, '.orkastery', 'monitor')) });
  return `${BATIDA_DO_TEMPLATE} ORK_PULSE_PROJECT=${citarNoShell(raiz)} PATH=${citarNoShell(PATH)} ` +
    `${citarNoShell(script)} ${MARCA_DA_BATIDA}`;
}

/** A linha foi instalada pelo `ork fabrica batida instalar` (traz a marca no fim)? */
export function linhaGerenciada(linha: string): boolean {
  return linha.trimEnd().endsWith(MARCA_DA_BATIDA);
}

export interface EstadoDaBatida {
  /** A raiz canonica do projeto: o alvo da varredura. */
  projeto: string;
  maquina: string;
  leitura: { ok: true } | { ok: false; motivo: string };
  /** A linha que o `ork` instalou para este projeto. */
  gerenciada: string | null;
  /** Outras linhas da varredura deste projeto, postas a mao. */
  manuais: string[];
  instalada: boolean;
  /** O ritmo da linha que vale (a gerenciada, senao a manual mais rapida); `null` quando o cron nao e lido. */
  intervaloMin: number | null;
  ultimaRodada: (RodadaDaVarredura & { haMin: number }) | null;
}

/**
 * As entradas da varredura DESTE projeto, separadas pela marca. O projeto efetivo considera a linha de ambiente do
 * crontab acima da entrada: o template abaixo de `ORK_PULSE_PROJECT=/outro` e a batida do outro, e fica.
 */
function separar(texto: string, raiz: string): { gerenciadas: string[]; manuais: string[] } {
  const doProjeto = entradasDaVarredura(texto).filter((e) => entradaDoProjeto(e, raiz)).map((e) => e.linha);
  return { gerenciadas: doProjeto.filter(linhaGerenciada), manuais: doProjeto.filter((l) => !linhaGerenciada(l)) };
}

function ritmoDa(linha: string): number | null {
  const t = linha.trim();
  const m = t.startsWith('@') ? /^(@\S+)\s/.exec(t) : /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s/.exec(t);
  return m ? intervaloEmMinutos(m[1]) : null;
}

/** `ork fabrica batida status`: o que o crontab desta maquina diz da batida deste projeto, e a ultima rodada. */
export function estadoDaBatida(raizDoProjeto: string, opcoes: { executor?: ExecutorDoCrontab; quando?: string } = {}): EstadoDaBatida {
  const raiz = raizDoEstado(raizDoProjeto);
  const executor = opcoes.executor ?? CRONTAB_DO_SISTEMA;
  const quando = opcoes.quando ?? new Date().toISOString();
  const leitura = executor.ler();
  const { gerenciadas, manuais } = leitura.ok ? separar(leitura.texto, raiz) : { gerenciadas: [], manuais: [] };
  const ritmos = [...gerenciadas, ...manuais].map(ritmoDa).filter((r): r is number => r !== null);
  const rodada = ultimaRodadaDaVarredura(path.join(raiz, '.orkastery', 'monitor'));
  return {
    projeto: raiz, maquina: nomeDaMaquina(),
    leitura: leitura.ok ? { ok: true } : { ok: false, motivo: leitura.motivo },
    gerenciada: gerenciadas[0]?.trim() ?? null, manuais: manuais.map((l) => l.trim()),
    instalada: gerenciadas.length + manuais.length > 0,
    intervaloMin: ritmos.length ? Math.min(...ritmos) : null,
    ultimaRodada: rodada ? { ...rodada, haMin: Math.max(0, Math.floor((Date.parse(quando) - Date.parse(rodada.em)) / 60000)) } : null,
  };
}

export interface ResultadoDaBatida {
  acao: 'instalou' | 'ja-instalada' | 'removeu' | 'nao-instalada';
  projeto: string;
  linha: string | null;
  /** As linhas que sairam do crontab nesta operacao (a gerenciada antiga, a manual substituida). */
  retiradas: string[];
  /** No `remover`: as linhas postas a mao que continuam (nao sao da batida do `ork`). */
  manuais: string[];
  /** O `eventId` no ledger da maquina, quando o crontab mudou. */
  eventId: string | null;
}

function lerParaEditar(executor: ExecutorDoCrontab): string {
  const leitura = executor.ler();
  // Nunca gravar sem ter lido: um crontab que nao foi lido seria apagado pela gravacao.
  if (!leitura.ok) throw new Error(`fabrica.batida.sem-leitura: ${leitura.motivo}; nada foi gravado`);
  return leitura.texto;
}

function gravarEConferir(executor: ExecutorDoCrontab, lido: string, texto: string, confere: (relido: string) => boolean): void {
  // O crontab que mudou entre a leitura e a gravacao (um `crontab -e`, outro `instalar`) nao e sobrescrito.
  const antes = executor.ler();
  if (!antes.ok || antes.texto !== lido) {
    throw new Error('fabrica.batida.concorrencia: o crontab mudou durante a operacao; nada foi gravado, rode de novo');
  }
  const gravacao = executor.gravar(texto);
  if (!gravacao.ok) throw new Error(`fabrica.batida.sem-gravacao: ${gravacao.motivo}`);
  const relido = executor.ler();
  if (!relido.ok || !confere(relido.texto)) {
    throw new Error(`fabrica.batida.nao-confirmada: o crontab relido nao traz o que foi gravado` +
      (relido.ok ? '' : ` (${relido.motivo})`) + '; confira com crontab -l');
  }
}

/** O texto do crontab sem as linhas pedidas, com o fim de linha que o cron exige. */
function semAsLinhas(texto: string, sair: ReadonlySet<string>): string {
  const ficam = texto.split('\n').filter((l) => !sair.has(l));
  while (ficam.length && ficam[ficam.length - 1].trim() === '') ficam.pop();
  return ficam.length ? `${ficam.join('\n')}\n` : '';
}

function noLedgerDaMaquina(tipo: string, dados: Record<string, unknown>): string {
  return registrar(pastaDoUsuario(), 'maquina', tipo, { maquina: nomeDaMaquina(), ...dados }).eventId as string;
}

/**
 * `ork fabrica batida instalar`: idempotente. A linha igual ja instalada nao muda nada; a linha antiga do
 * `ork` e a linha posta a mao da varredura deste projeto saem, e a linha do template entra no lugar. As
 * outras entradas do crontab ficam como estavam.
 */
export function instalarBatida(raizDoProjeto: string, opcoes: OpcoesDaLinha & { executor?: ExecutorDoCrontab; por?: string } = {}): ResultadoDaBatida {
  const raiz = raizDoEstado(raizDoProjeto);
  const executor = opcoes.executor ?? CRONTAB_DO_SISTEMA;
  const linha = linhaDaBatida(raiz, opcoes);
  const texto = lerParaEditar(executor);
  const { gerenciadas, manuais } = separar(texto, raiz);
  if (manuais.length === 0 && gerenciadas.length === 1 && gerenciadas[0].trim() === linha) {
    return { acao: 'ja-instalada', projeto: raiz, linha, retiradas: [], manuais: [], eventId: null };
  }
  const retiradas = [...gerenciadas, ...manuais];
  const base = semAsLinhas(texto, new Set(retiradas));
  gravarEConferir(executor, texto, `${base}${linha}\n`, (relido) => relido.split('\n').some((l) => l.trim() === linha));
  const eventId = noLedgerDaMaquina(TIPOS_DE_EVENTO.batidaInstalada, {
    projeto: raiz, linha, retiradas: retiradas.map((l) => l.trim()), por: opcoes.por ?? null,
    evidencia: 'crontab -l relido depois da gravacao traz a linha',
  });
  return { acao: 'instalou', projeto: raiz, linha, retiradas: retiradas.map((l) => l.trim()), manuais: [], eventId };
}

/** `ork fabrica batida remover`: tira so a linha que o `ork` instalou para este projeto. */
export function removerBatida(raizDoProjeto: string, opcoes: { executor?: ExecutorDoCrontab; por?: string } = {}): ResultadoDaBatida {
  const raiz = raizDoEstado(raizDoProjeto);
  const executor = opcoes.executor ?? CRONTAB_DO_SISTEMA;
  const texto = lerParaEditar(executor);
  const { gerenciadas, manuais } = separar(texto, raiz);
  const ficam = manuais.map((l) => l.trim());
  if (gerenciadas.length === 0) return { acao: 'nao-instalada', projeto: raiz, linha: null, retiradas: [], manuais: ficam, eventId: null };
  const sair = new Set(gerenciadas);
  gravarEConferir(executor, texto, semAsLinhas(texto, sair), (relido) => separar(relido, raiz).gerenciadas.length === 0);
  const eventId = noLedgerDaMaquina(TIPOS_DE_EVENTO.batidaRemovida, {
    projeto: raiz, retiradas: gerenciadas.map((l) => l.trim()), manuaisQueFicaram: ficam, por: opcoes.por ?? null,
    evidencia: 'crontab -l relido depois da gravacao nao traz a linha do ork',
  });
  return { acao: 'removeu', projeto: raiz, linha: null, retiradas: gerenciadas.map((l) => l.trim()), manuais: ficam, eventId };
}

export function textoDoEstadoDaBatida(e: EstadoDaBatida, quando: string = new Date().toISOString()): string {
  const linhas = [`Batida da fábrica em ${e.maquina}, projeto ${e.projeto}`];
  if (!e.leitura.ok) linhas.push(`  crontab: não lido (${e.leitura.motivo}); não dá para dizer se a batida está instalada`);
  else if (!e.instalada) linhas.push('  instalada: não; instale com: ork fabrica batida instalar');
  else {
    const ritmo = e.intervaloMin === null ? 'com horário que o ork não lê' : `a cada ${e.intervaloMin} min`;
    linhas.push(`  instalada: sim, ${ritmo}${e.gerenciada ? ', pelo ork fabrica batida instalar' : ', por linha posta à mão'}`);
    for (const l of [...(e.gerenciada ? [e.gerenciada] : []), ...e.manuais]) linhas.push(`  linha: ${l}`);
  }
  const r = e.ultimaRodada;
  if (!r) linhas.push('  última rodada: nenhuma registrada (.orkastery/monitor/hitl.log)');
  else {
    linhas.push(`  última rodada: ${formatarHora(r.em, { agora: quando })} (há ${r.haMin} min), ` +
      `${r.code === 0 ? 'ok' : `código ${r.code ?? '?'}`}: ${r.detalhe || 'sem detalhe'}`);
    if (e.instalada && r.haMin > ATRASO_DA_BATIDA_MIN) {
      linhas.push(`  atrasada: nenhuma rodada há ${r.haMin} min com a batida instalada; confira crontab -l e o hitl.log`);
    }
  }
  linhas.push(legendaDoFuso());
  return linhas.join('\n');
}

export function textoDoResultadoDaBatida(r: ResultadoDaBatida): string {
  switch (r.acao) {
    case 'ja-instalada': return `Batida já instalada para ${r.projeto}; nada mudou no crontab.\n  linha: ${r.linha}`;
    case 'instalou': return [`Batida instalada para ${r.projeto} (evento ${r.eventId} no ledger da máquina).`, `  linha: ${r.linha}`,
      ...r.retiradas.map((l) => `  saiu: ${l}`), '  confira com: ork fabrica batida status'].join('\n');
    case 'removeu': return [`Batida removida de ${r.projeto} (evento ${r.eventId} no ledger da máquina).`,
      ...r.retiradas.map((l) => `  saiu: ${l}`), ...r.manuais.map((l) => `  ficou (posta à mão, não é do ork): ${l}`)].join('\n');
    case 'nao-instalada': return [`Nenhuma batida do ork instalada para ${r.projeto}; nada mudou no crontab.`,
      ...r.manuais.map((l) => `  ficou (posta à mão, não é do ork): ${l}`)].join('\n');
  }
}
