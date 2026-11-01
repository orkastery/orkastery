/**
 * `ork eval`: o runner de avaliacao do bloco B4.
 *
 * Ele julga duas coisas, e diz em voz alta que so uma delas ele consegue julgar.
 *
 *  1. **Os cenarios** (`eval/fixtures/fx-*`): comportamento real do nucleo, exercitado ponta a
 *     ponta contra git de verdade, comparado com o que a fixture declara esperar.
 *  2. **O corpus das skills** (`eval/casos/*.json`): as regras que precisam EXISTIR no arquivo
 *     da skill para o comportamento ser possivel. Isso e deterministico, e e o que o runner
 *     verifica: apague a regra da separacao no reviewer e o caso dele fica vermelho.
 *
 * O que o runner NAO julga e a metade comportamental de cada caso, aquela em que um agente e
 * posto na situacao e alguem ve se ele resiste a desculpa. Essa metade sai `unavailable` em
 * toda execucao, nunca `passing`. Regra herdada do catalogo original e mantida de proposito:
 * **lacuna e publicada como lacuna**, porque um runner que chamasse isso de verde estaria
 * medindo a propria vontade.
 *
 * Regra de catalogo que este runner torna executavel: skill sem eval nao entra, e eval sem
 * skill tambem nao fica.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CENARIOS, cenarioPorId, gitDisponivel, Observado } from './cenarios';
import { skillsDoCatalogo } from './catalogo';
import { tabela } from './util';
import { msg } from './locale';

// ---------------------------------------------------------------------------
// Contratos do corpus
// ---------------------------------------------------------------------------

export type TipoDeCaso = 'caminho-feliz' | 'racionalizacao' | 'borda';
export type TipoDeAssercao = 'contem' | 'casa' | 'ausente';

/** Os tres tipos que toda skill precisa cobrir. Menos que isso e cobertura de fachada. */
export const TIPOS_DE_CASO: readonly TipoDeCaso[] = ['caminho-feliz', 'racionalizacao', 'borda'];

/** Minimo de casos por skill, para o corpus nao virar uma linha por skill. */
export const MINIMO_DE_CASOS = 3;

export interface Assercao {
  tipo: TipoDeAssercao;
  valor: string;
  /** Por que esta passagem precisa existir. Assercao sem `porque` e reprovada pelo runner. */
  porque: string;
}

export interface CasoDeSkill {
  id: string;
  tipo: TipoDeCaso;
  gravidade: 'maior' | 'menor';
  cenario: string;
  esperado: string;
  /** A desculpa que o agente usaria. Obrigatoria nos casos do tipo `racionalizacao`. */
  racionalizacao?: string;
  assercoes: Assercao[];
}

export interface ArquivoDeCasos {
  skill: string;
  casos: CasoDeSkill[];
}

/** Uma reprovacao do runner, sempre com codigo do catalogo fixo. */
export interface Falha {
  codigo:
    | 'skill-sem-eval'
    | 'eval-sem-skill'
    | 'cobertura-minima'
    | 'tipo-faltando'
    | 'id-duplicado'
    | 'id-sem-prefixo'
    | 'racionalizacao-sem-desculpa'
    | 'assercao-sem-porque'
    | 'ancora-fora-da-tabela'
    | 'assercao'
    | 'padrao-invalido'
    | 'cenario'
    | 'cenario-sem-executor'
    | 'fixture-invalida';
  skill?: string;
  caso?: string;
  detalhe: string;
}

// ---------------------------------------------------------------------------
// A tabela de racionalizacoes, e por que ela nao pode ser a unica ancora
// ---------------------------------------------------------------------------

/**
 * Normaliza o texto da skill para casamento: toda sequencia de espaco em branco vira um
 * espaco so.
 *
 * Sem isso, reflowar um paragrafo de markdown (mover uma palavra para a linha seguinte)
 * deixaria uma assercao vermelha sem que regra nenhuma tivesse mudado. Um eval que reprova
 * por causa de quebra de linha treina o time a ignorar o eval, que e o pior resultado
 * possivel para um corpus de regressao.
 */
export function normalizar(texto: string): string {
  return texto.replace(/\s+/g, ' ');
}

/**
 * Intervalo da secao "Racionalizacoes comuns" dentro do texto JA NORMALIZADO da skill.
 *
 * Existe porque uma skill pode LISTAR a desculpa na tabela e nao ter, em lugar nenhum, a regra
 * que responde a ela. O caso passaria, e a skill nao seguraria nada. Por isso todo caso de
 * racionalizacao precisa de ao menos uma ancora FORA desta tabela.
 */
export function intervaloDaTabelaDeDesculpas(texto: string): { inicio: number; fim: number } | null {
  const normalizado = normalizar(texto);
  const inicio = normalizado.indexOf('## Racionalizacoes comuns');
  if (inicio < 0) return null;
  const resto = normalizado.indexOf('## ', inicio + 25);
  return { inicio, fim: resto < 0 ? normalizado.length : resto };
}

/** Todas as posicoes em que a assercao casa no texto normalizado da skill. */
export function posicoesDaAssercao(a: Assercao, texto: string): number[] {
  const alvo = normalizar(texto);
  const achadas: number[] = [];
  if (a.tipo === 'casa') {
    const regex = new RegExp(normalizar(a.valor), 'g');
    let casado: RegExpExecArray | null;
    while ((casado = regex.exec(alvo)) !== null) {
      achadas.push(casado.index);
      if (casado[0].length === 0) regex.lastIndex++;
    }
    return achadas;
  }
  const valor = normalizar(a.valor);
  let de = alvo.indexOf(valor);
  while (de >= 0) {
    achadas.push(de);
    de = alvo.indexOf(valor, de + 1);
  }
  return achadas;
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export interface LinhaDeSkill {
  skill: string;
  casos: number;
  assercoes: number;
  falhas: number;
}

export interface ResultadoDeCenario {
  id: string;
  sobre: string;
  estado: 'passou' | 'falhou' | 'unavailable';
  /** Chaves comparadas e o veredito de cada uma. */
  divergencias: { chave: string; esperado: unknown; observado: unknown }[];
  motivo: string;
  observado: Observado;
}

export interface ResultadoDoEval {
  catalogo: string;
  skills: LinhaDeSkill[];
  cenarios: ResultadoDeCenario[];
  falhas: Falha[];
  totalDeCasos: number;
  totalDeAssercoes: number;
  /** Sempre `unavailable`: o runner nao julga a metade comportamental. */
  metadeComportamental: 'unavailable';
  ok: boolean;
}

export interface OpcoesDoEval {
  catalogo: string;
  /** So estas skills (nomes). */
  skills?: string[];
  /** So estes cenarios (ids). */
  cenarios?: string[];
  soCenarios?: boolean;
  soSkills?: boolean;
}

// ---------------------------------------------------------------------------
// Corpus das skills
// ---------------------------------------------------------------------------

export function dirDeCasos(catalogo: string): string {
  return path.join(catalogo, 'eval', 'casos');
}

export function dirDeFixtures(catalogo: string): string {
  return path.join(catalogo, 'eval', 'fixtures');
}

/** Le os arquivos de caso do disco. Arquivo ilegivel e falha, nunca zero casos em silencio. */
export function lerCasos(catalogo: string): { arquivos: ArquivoDeCasos[]; falhas: Falha[] } {
  const dir = dirDeCasos(catalogo);
  const arquivos: ArquivoDeCasos[] = [];
  const falhas: Falha[] = [];
  if (!fs.existsSync(dir)) return { arquivos, falhas };
  for (const nome of fs.readdirSync(dir).sort()) {
    if (!nome.endsWith('.json')) continue;
    const caminho = path.join(dir, nome);
    try {
      const lido = JSON.parse(fs.readFileSync(caminho, 'utf8')) as ArquivoDeCasos;
      if (!lido.skill || !Array.isArray(lido.casos)) {
        falhas.push({ codigo: 'fixture-invalida', detalhe: msg().operacao.restante.eval.fixtureFormato(nome) });
        continue;
      }
      arquivos.push(lido);
    } catch (e) {
      falhas.push({ codigo: 'fixture-invalida', detalhe: `${nome}: ${(e as Error).message}` });
    }
  }
  return { arquivos, falhas };
}

function avaliarSkill(
  arquivo: ArquivoDeCasos,
  textoDaSkill: string,
  vistos: Set<string>
): { linha: LinhaDeSkill; falhas: Falha[] } {
  const falhas: Falha[] = [];
  const m = msg().operacao.restante.eval;
  const skill = arquivo.skill;
  const tabelaDeDesculpas = intervaloDaTabelaDeDesculpas(textoDaSkill);
  let assercoes = 0;

  if (arquivo.casos.length < MINIMO_DE_CASOS) {
    falhas.push({
      codigo: 'cobertura-minima',
      skill,
      detalhe: m.casosMinimos(arquivo.casos.length, MINIMO_DE_CASOS),
    });
  }
  for (const tipo of TIPOS_DE_CASO) {
    if (!arquivo.casos.some((c) => c.tipo === tipo)) {
      falhas.push({ codigo: 'tipo-faltando', skill, detalhe: m.tipoFaltando(tipo) });
    }
  }

  for (const caso of arquivo.casos) {
    if (vistos.has(caso.id)) {
      falhas.push({ codigo: 'id-duplicado', skill, caso: caso.id, detalhe: m.idRepetido });
    }
    vistos.add(caso.id);
    if (!caso.id.startsWith(`${skill}/`)) {
      falhas.push({
        codigo: 'id-sem-prefixo',
        skill,
        caso: caso.id,
        detalhe: m.idPrefixo(skill),
      });
    }
    if (caso.tipo === 'racionalizacao' && !(caso.racionalizacao ?? '').trim()) {
      falhas.push({
        codigo: 'racionalizacao-sem-desculpa',
        skill,
        caso: caso.id,
        detalhe: m.racionalizacao,
      });
    }

    let ancoraForaDaTabela = false;
    for (const a of caso.assercoes) {
      assercoes++;
      if (!(a.porque ?? '').trim()) {
        falhas.push({
          codigo: 'assercao-sem-porque',
          skill,
          caso: caso.id,
          detalhe: m.assercaoPorque(a.valor),
        });
      }
      let posicoes: number[];
      try {
        posicoes = posicoesDaAssercao(a, textoDaSkill);
      } catch (e) {
        falhas.push({
          codigo: 'padrao-invalido',
          skill,
          caso: caso.id,
          detalhe: m.padraoInvalido(a.valor, (e as Error).message),
        });
        continue;
      }
      if (a.tipo === 'ausente') {
        if (posicoes.length > 0) {
          falhas.push({
            codigo: 'assercao',
            skill,
            caso: caso.id,
            detalhe: m.deveriaAusente(a.valor, posicoes.length),
          });
        }
        continue;
      }
      if (posicoes.length === 0) {
        falhas.push({
          codigo: 'assercao',
          skill,
          caso: caso.id,
          detalhe: m.naoExiste(a.valor, skill, a.porque),
        });
        continue;
      }
      if (
        !tabelaDeDesculpas ||
        posicoes.some((p) => p < tabelaDeDesculpas.inicio || p >= tabelaDeDesculpas.fim)
      ) {
        ancoraForaDaTabela = true;
      }
    }

    if (caso.tipo === 'racionalizacao' && caso.assercoes.length > 0 && !ancoraForaDaTabela) {
      falhas.push({
        codigo: 'ancora-fora-da-tabela',
        skill,
        caso: caso.id,
        detalhe: m.ancora,
      });
    }
  }

  return {
    linha: { skill, casos: arquivo.casos.length, assercoes, falhas: falhas.length },
    falhas,
  };
}

// ---------------------------------------------------------------------------
// Cenarios
// ---------------------------------------------------------------------------

interface FixtureDeCenario {
  id: string;
  sobre?: string;
  esperado: Record<string, unknown>;
}

function comparar(
  esperado: Record<string, unknown>,
  observado: Observado
): { chave: string; esperado: unknown; observado: unknown }[] {
  const divergencias: { chave: string; esperado: unknown; observado: unknown }[] = [];
  for (const [chave, valor] of Object.entries(esperado)) {
    const veio = observado[chave];
    if (JSON.stringify(veio) !== JSON.stringify(valor)) {
      divergencias.push({ chave, esperado: valor, observado: veio });
    }
  }
  return divergencias;
}

/** Roda os cenarios cujas fixtures existem em `eval/fixtures/fx-*`. */
export function rodarCenarios(
  catalogo: string,
  filtro?: string[]
): { resultados: ResultadoDeCenario[]; falhas: Falha[] } {
  const dir = dirDeFixtures(catalogo);
  const resultados: ResultadoDeCenario[] = [];
  const falhas: Falha[] = [];
  const m = msg().operacao.restante.eval;
  const temGit = gitDisponivel();
  const nomes = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];

  if (filtro && filtro.length === 0) {
    falhas.push({ codigo: 'fixture-invalida', detalhe: m.filtroVazio });
  }
  for (const id of new Set(filtro ?? [])) {
    if (!nomes.includes(id) || !cenarioPorId(id)) {
      falhas.push({ codigo: 'cenario-sem-executor', caso: id, detalhe: m.cenarioAusente(id) });
    }
  }

  for (const nome of nomes) {
    if (!nome.startsWith('fx-')) continue;
    if (filtro && !filtro.includes(nome)) continue;
    const caminho = path.join(dir, nome, 'caso.json');
    if (!fs.existsSync(caminho)) {
      falhas.push({ codigo: 'fixture-invalida', detalhe: m.casoAusente(nome) });
      continue;
    }
    let fixture: FixtureDeCenario;
    try {
      fixture = JSON.parse(fs.readFileSync(caminho, 'utf8')) as FixtureDeCenario;
    } catch (e) {
      falhas.push({ codigo: 'fixture-invalida', detalhe: `${nome}: ${(e as Error).message}` });
      continue;
    }
    const cenario = cenarioPorId(fixture.id ?? nome);
    if (fixture.id !== nome) {
      falhas.push({ codigo: 'fixture-invalida', caso: nome, detalhe: m.fixtureDiverge });
      continue;
    }
    if (!cenario) {
      falhas.push({
        codigo: 'cenario-sem-executor',
        detalhe: m.semExecutor(nome, fixture.id ?? nome),
      });
      continue;
    }
    if (cenario.precisaDeGit && !temGit) {
      resultados.push({
        id: cenario.id,
        sobre: cenario.sobre,
        estado: 'unavailable',
        divergencias: [],
        motivo: m.semGit,
        observado: {},
      });
      continue;
    }
    try {
      const observado = cenario.rodar({ catalogo });
      const divergencias = comparar(fixture.esperado ?? {}, observado);
      resultados.push({
        id: cenario.id,
        sobre: cenario.sobre,
        estado: divergencias.length === 0 ? 'passou' : 'falhou',
        divergencias,
        motivo: divergencias.length === 0 ? '' : `${divergencias.length} chave(s) divergente(s)`,
        observado,
      });
      for (const d of divergencias) {
        falhas.push({
          codigo: 'cenario',
          caso: `${cenario.id}/${d.chave}`,
          detalhe: m.divergencia(JSON.stringify(d.esperado), JSON.stringify(d.observado)),
        });
      }
    } catch (e) {
      resultados.push({
        id: cenario.id,
        sobre: cenario.sobre,
        estado: 'falhou',
        divergencias: [],
        motivo: (e as Error).message,
        observado: {},
      });
      falhas.push({ codigo: 'cenario', caso: cenario.id, detalhe: (e as Error).message });
    }
  }

  // Cenario registrado no codigo e sem fixture em disco tambem e defeito: a expectativa
  // precisa ser dado versionado, revisavel por quem nao le TypeScript.
  if (!filtro) {
    for (const c of CENARIOS) {
      if (!fs.existsSync(path.join(dir, c.id, 'caso.json'))) {
        falhas.push({
          codigo: 'fixture-invalida',
          caso: c.id,
          detalhe: m.cenarioSemFixture(c.id),
        });
      }
    }
  }

  return { resultados, falhas };
}

// ---------------------------------------------------------------------------
// Orquestracao
// ---------------------------------------------------------------------------

/** Roda o eval inteiro: cenarios mais corpus das skills. */
export function rodarEval(opcoes: OpcoesDoEval): ResultadoDoEval {
  const { catalogo } = opcoes;
  const falhas: Falha[] = [];
  const linhas: LinhaDeSkill[] = [];
  let cenarios: ResultadoDeCenario[] = [];

  if (!opcoes.soSkills) {
    const r = rodarCenarios(catalogo, opcoes.cenarios);
    cenarios = r.resultados;
    falhas.push(...r.falhas);
  }

  let totalDeCasos = 0;
  let totalDeAssercoes = 0;

  if (!opcoes.soCenarios) {
    const { arquivos, falhas: falhasDeLeitura } = lerCasos(catalogo);
    falhas.push(...falhasDeLeitura);
    const doCatalogo = skillsDoCatalogo(catalogo);
    const comEval = new Set(arquivos.map((a) => a.skill));
    const vistos = new Set<string>();

    for (const skill of doCatalogo) {
      if (!comEval.has(skill.nome)) {
        falhas.push({
          codigo: 'skill-sem-eval',
          skill: skill.nome,
          detalhe: msg().operacao.restante.eval.skillSemEval(skill.nome),
        });
      }
    }

    for (const arquivo of arquivos) {
      if (opcoes.skills && !opcoes.skills.includes(arquivo.skill)) continue;
      const skill = doCatalogo.find((s) => s.nome === arquivo.skill);
      if (!skill) {
        falhas.push({
          codigo: 'eval-sem-skill',
          skill: arquivo.skill,
          detalhe: msg().operacao.restante.eval.evalSemSkill,
        });
        continue;
      }
      const texto = fs.readFileSync(skill.caminho, 'utf8');
      const avaliada = avaliarSkill(arquivo, texto, vistos);
      linhas.push(avaliada.linha);
      falhas.push(...avaliada.falhas);
      totalDeCasos += avaliada.linha.casos;
      totalDeAssercoes += avaliada.linha.assercoes;
    }
  }

  return {
    catalogo,
    skills: linhas,
    cenarios,
    falhas,
    totalDeCasos,
    totalDeAssercoes,
    metadeComportamental: 'unavailable',
    ok: falhas.length === 0,
  };
}

/** Texto de `ork eval`. */
export function textoDoEval(r: ResultadoDoEval): string {
  const m = msg().operacao.restante.eval;
  const linhas: string[] = [];
  linhas.push(m.titulo(r.catalogo));
  linhas.push('');

  if (r.cenarios.length > 0) {
    linhas.push(m.cenarios);
    linhas.push('');
    linhas.push(
      tabela(
        [...m.colunasCenarios],
        r.cenarios.map((c) => [c.id, m.estados[c.estado] ?? c.estado, c.estado === 'passou' ? c.sobre : c.motivo || c.sobre])
      )
    );
    linhas.push('');
  }

  if (r.skills.length > 0) {
    linhas.push(m.skills);
    linhas.push('');
    linhas.push(
      tabela(
        [...m.colunasSkills],
        r.skills.map((s) => [s.skill, String(s.casos), String(s.assercoes), String(s.falhas)])
      )
    );
    linhas.push('');
  }

  if (r.falhas.length > 0) {
    linhas.push(m.falhas);
    for (const f of r.falhas) {
      const onde = [f.skill, f.caso].filter(Boolean).join(' :: ');
      linhas.push(`  [${f.codigo}] ${onde}`);
      linhas.push(`           ${f.detalhe}`);
    }
    linhas.push('');
  }

  const passaram = r.cenarios.filter((c) => c.estado === 'passou').length;
  const indisponiveis = r.cenarios.filter((c) => c.estado === 'unavailable').length;
  linhas.push(m.resumoCenarios(passaram, r.cenarios.length, indisponiveis));
  linhas.push(m.resumoSkills(r.skills.length, r.totalDeCasos, r.totalDeAssercoes, r.falhas.length));
  linhas.push(m.metade);
  linhas.push(m.veredito(r.ok));
  return linhas.join('\n');
}
