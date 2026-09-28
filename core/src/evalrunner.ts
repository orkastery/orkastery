/**
 * `ork eval`: o runner de avaliacao do bloco B4.
 *
 * Ele julga duas coisas, e diz em voz alta que so uma delas ele consegue julgar.
 *
 *  1. **Os canarios** (`eval/fixtures/fx-*`): comportamento real do nucleo, exercitado ponta a
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
import { CANARIOS, canarioPorId, gitDisponivel, Observado } from './canarios';
import { skillsDoCatalogo } from './catalogo';
import { tabela } from './util';

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
    | 'canario'
    | 'canario-sem-executor'
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

export interface ResultadoDeCanario {
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
  canarios: ResultadoDeCanario[];
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
  /** So estes canarios (ids). */
  canarios?: string[];
  soCanarios?: boolean;
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
        falhas.push({ codigo: 'fixture-invalida', detalhe: `${nome}: esperado { skill, casos[] }` });
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
  const skill = arquivo.skill;
  const tabelaDeDesculpas = intervaloDaTabelaDeDesculpas(textoDaSkill);
  let assercoes = 0;

  if (arquivo.casos.length < MINIMO_DE_CASOS) {
    falhas.push({
      codigo: 'cobertura-minima',
      skill,
      detalhe: `${arquivo.casos.length} caso(s); o minimo do catalogo e ${MINIMO_DE_CASOS}`,
    });
  }
  for (const tipo of TIPOS_DE_CASO) {
    if (!arquivo.casos.some((c) => c.tipo === tipo)) {
      falhas.push({ codigo: 'tipo-faltando', skill, detalhe: `nenhum caso do tipo "${tipo}"` });
    }
  }

  for (const caso of arquivo.casos) {
    if (vistos.has(caso.id)) {
      falhas.push({ codigo: 'id-duplicado', skill, caso: caso.id, detalhe: 'id repetido no corpus' });
    }
    vistos.add(caso.id);
    if (!caso.id.startsWith(`${skill}/`)) {
      falhas.push({
        codigo: 'id-sem-prefixo',
        skill,
        caso: caso.id,
        detalhe: `o id precisa comecar com "${skill}/"`,
      });
    }
    if (caso.tipo === 'racionalizacao' && !(caso.racionalizacao ?? '').trim()) {
      falhas.push({
        codigo: 'racionalizacao-sem-desculpa',
        skill,
        caso: caso.id,
        detalhe: 'caso de racionalizacao sem o campo `racionalizacao` com a desculpa',
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
          detalhe: `assercao "${a.valor}" sem o campo \`porque\``,
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
          detalhe: `padrao "${a.valor}" invalido: ${(e as Error).message}`,
        });
        continue;
      }
      if (a.tipo === 'ausente') {
        if (posicoes.length > 0) {
          falhas.push({
            codigo: 'assercao',
            skill,
            caso: caso.id,
            detalhe: `"${a.valor}" deveria estar AUSENTE da skill e aparece ${posicoes.length}x`,
          });
        }
        continue;
      }
      if (posicoes.length === 0) {
        falhas.push({
          codigo: 'assercao',
          skill,
          caso: caso.id,
          detalhe: `"${a.valor}" nao existe em skills/.../${skill}/SKILL.md (${a.porque})`,
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
        detalhe:
          'todas as ancoras deste caso estao dentro da tabela de racionalizacoes: a skill lista a desculpa mas nao carrega a regra que responde a ela',
      });
    }
  }

  return {
    linha: { skill, casos: arquivo.casos.length, assercoes, falhas: falhas.length },
    falhas,
  };
}

// ---------------------------------------------------------------------------
// Canarios
// ---------------------------------------------------------------------------

interface FixtureDeCanario {
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

/** Roda os canarios cujas fixtures existem em `eval/fixtures/fx-*`. */
export function rodarCanarios(
  catalogo: string,
  filtro?: string[]
): { resultados: ResultadoDeCanario[]; falhas: Falha[] } {
  const dir = dirDeFixtures(catalogo);
  const resultados: ResultadoDeCanario[] = [];
  const falhas: Falha[] = [];
  const temGit = gitDisponivel();
  const nomes = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];

  if (filtro && filtro.length === 0) {
    falhas.push({ codigo: 'fixture-invalida', detalhe: 'filtro de canários vazio: nenhuma prova foi executada' });
  }
  for (const id of new Set(filtro ?? [])) {
    if (!nomes.includes(id) || !canarioPorId(id)) {
      falhas.push({ codigo: 'canario-sem-executor', caso: id, detalhe: `canário solicitado ausente: ${id}` });
    }
  }

  for (const nome of nomes) {
    if (!nome.startsWith('fx-')) continue;
    if (filtro && !filtro.includes(nome)) continue;
    const caminho = path.join(dir, nome, 'caso.json');
    if (!fs.existsSync(caminho)) {
      falhas.push({ codigo: 'fixture-invalida', detalhe: `${nome}: falta caso.json` });
      continue;
    }
    let fixture: FixtureDeCanario;
    try {
      fixture = JSON.parse(fs.readFileSync(caminho, 'utf8')) as FixtureDeCanario;
    } catch (e) {
      falhas.push({ codigo: 'fixture-invalida', detalhe: `${nome}: ${(e as Error).message}` });
      continue;
    }
    const canario = canarioPorId(fixture.id ?? nome);
    if (fixture.id !== nome) {
      falhas.push({ codigo: 'fixture-invalida', caso: nome, detalhe: 'id da fixture diverge do canário solicitado' });
      continue;
    }
    if (!canario) {
      falhas.push({
        codigo: 'canario-sem-executor',
        detalhe: `${nome}: nenhum executor registrado para o canario "${fixture.id ?? nome}"`,
      });
      continue;
    }
    if (canario.precisaDeGit && !temGit) {
      resultados.push({
        id: canario.id,
        sobre: canario.sobre,
        estado: 'unavailable',
        divergencias: [],
        motivo: 'git nao esta nesta maquina: o canario sai unavailable, nunca passing',
        observado: {},
      });
      continue;
    }
    try {
      const observado = canario.rodar({ catalogo });
      const divergencias = comparar(fixture.esperado ?? {}, observado);
      resultados.push({
        id: canario.id,
        sobre: canario.sobre,
        estado: divergencias.length === 0 ? 'passou' : 'falhou',
        divergencias,
        motivo: divergencias.length === 0 ? '' : `${divergencias.length} chave(s) divergente(s)`,
        observado,
      });
      for (const d of divergencias) {
        falhas.push({
          codigo: 'canario',
          caso: `${canario.id}/${d.chave}`,
          detalhe: `esperado ${JSON.stringify(d.esperado)}, observado ${JSON.stringify(d.observado)}`,
        });
      }
    } catch (e) {
      resultados.push({
        id: canario.id,
        sobre: canario.sobre,
        estado: 'falhou',
        divergencias: [],
        motivo: (e as Error).message,
        observado: {},
      });
      falhas.push({ codigo: 'canario', caso: canario.id, detalhe: (e as Error).message });
    }
  }

  // Canario registrado no codigo e sem fixture em disco tambem e defeito: a expectativa
  // precisa ser dado versionado, revisavel por quem nao le TypeScript.
  if (!filtro) {
    for (const c of CANARIOS) {
      if (!fs.existsSync(path.join(dir, c.id, 'caso.json'))) {
        falhas.push({
          codigo: 'fixture-invalida',
          caso: c.id,
          detalhe: `o canario ${c.id} existe no codigo e nao tem eval/fixtures/${c.id}/caso.json`,
        });
      }
    }
  }

  return { resultados, falhas };
}

// ---------------------------------------------------------------------------
// Orquestracao
// ---------------------------------------------------------------------------

/** Roda o eval inteiro: canarios mais corpus das skills. */
export function rodarEval(opcoes: OpcoesDoEval): ResultadoDoEval {
  const { catalogo } = opcoes;
  const falhas: Falha[] = [];
  const linhas: LinhaDeSkill[] = [];
  let canarios: ResultadoDeCanario[] = [];

  if (!opcoes.soSkills) {
    const r = rodarCanarios(catalogo, opcoes.canarios);
    canarios = r.resultados;
    falhas.push(...r.falhas);
  }

  let totalDeCasos = 0;
  let totalDeAssercoes = 0;

  if (!opcoes.soCanarios) {
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
          detalhe: `skill sem eval nao entra no catalogo: falta eval/casos/${skill.nome}.json`,
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
          detalhe: 'ha casos para uma skill que nao existe no catalogo',
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
    canarios,
    falhas,
    totalDeCasos,
    totalDeAssercoes,
    metadeComportamental: 'unavailable',
    ok: falhas.length === 0,
  };
}

/** Texto de `ork eval`. */
export function textoDoEval(r: ResultadoDoEval): string {
  const linhas: string[] = [];
  linhas.push(`ork eval, catalogo em ${r.catalogo}`);
  linhas.push('');

  if (r.canarios.length > 0) {
    linhas.push('Canarios (comportamento real do nucleo, contra git de verdade)');
    linhas.push('');
    linhas.push(
      tabela(
        ['CANARIO', 'ESTADO', 'SOBRE'],
        r.canarios.map((c) => [c.id, c.estado, c.estado === 'passou' ? c.sobre : c.motivo || c.sobre])
      )
    );
    linhas.push('');
  }

  if (r.skills.length > 0) {
    linhas.push('Corpus das skills (a metade estatica: as regras que precisam existir no arquivo)');
    linhas.push('');
    linhas.push(
      tabela(
        ['SKILL', 'CASOS', 'ASSERCOES', 'FALHAS'],
        r.skills.map((s) => [s.skill, String(s.casos), String(s.assercoes), String(s.falhas)])
      )
    );
    linhas.push('');
  }

  if (r.falhas.length > 0) {
    linhas.push('Falhas');
    for (const f of r.falhas) {
      const onde = [f.skill, f.caso].filter(Boolean).join(' :: ');
      linhas.push(`  [${f.codigo}] ${onde}`);
      linhas.push(`           ${f.detalhe}`);
    }
    linhas.push('');
  }

  const passaram = r.canarios.filter((c) => c.estado === 'passou').length;
  const indisponiveis = r.canarios.filter((c) => c.estado === 'unavailable').length;
  linhas.push(
    `canarios: ${passaram}/${r.canarios.length} verdes` +
      (indisponiveis > 0 ? ` (${indisponiveis} unavailable)` : '')
  );
  linhas.push(
    `skills: ${r.skills.length} | casos: ${r.totalDeCasos} | assercoes: ${r.totalDeAssercoes} | falhas: ${r.falhas.length}`
  );
  linhas.push(
    'metade comportamental (o agente resiste a desculpa?): unavailable, julgada por humano ou por modelo, nunca por este runner'
  );
  linhas.push(r.ok ? 'VEREDITO: verde' : 'VEREDITO: vermelho');
  return linhas.join('\n');
}
