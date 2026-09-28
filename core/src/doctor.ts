/**
 * `ork doctor`: o que vale nesta maquina agora.
 *
 * Cada check tem nivel (`ok`, `warn`, `fail`) e, quando falha, a acao de correcao.
 * Qualquer `fail` faz o comando sair com codigo diferente de zero: e um gate, nao um relatorio.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as adapter from './adapters/claude-bg';
import * as codexAdapter from './adapters/codex';
import { carregarManifesto, DIR_ESTADO, LIMITE_MANIFESTO_BYTES, NOME_MANIFESTO } from './manifest';
import { MODOS } from './modos';
import { resolverRegime } from './orkmind';
import { ETAPAS_ONBOARDING, lerOnboarding } from './onboarding';
import { ManifestoCarregado } from './manifest';
import { lerFilaDeRetomada } from './ratelimit';
import { validarAbbrev } from './slug';
import { CHAVE_DO_FUSO, formatarDataHoraRotulada, fusoDoManifesto, legendaDoFuso, localizarTexto, normalizarFuso,
  rotuloDoFuso } from './horario';
import { Check } from './types';
import { exec, noPath, simbolo } from './util';
import { inventariarSessoes } from './sessoes-inventario';
import { raizDoEstado } from './estado-thread';
import { memoryState } from './project-state';
import { nomesDeProviderAtivos } from './runtime-ambiente';
import { StatusDeAuth } from './adapters/claude-bg';
import { lerPerfisComContas, perfilDeDespacho, PerfilDeDespacho, perfilDisponivel, RUNTIMES_COM_PERFIL } from './runtime-profiles';
import { sondasDeAmbiente } from './preflight';

/**
 * I-33 (D7): check "contas por runtime". Cada perfil ativo tem o login conferido pelo proprio
 * CLI com o env dele (`claude auth status`, `codex login status`); o doctor so le e relata, sem
 * marcar o store. Runtime com perfis e nenhum pronto reprova: o despacho dele nao sairia.
 */
export function checarContas(raiz: string, auth: (p: PerfilDeDespacho) => StatusDeAuth =
  (p) => p.runtime === 'claude-bg' ? adapter.conferirAuth(p) : codexAdapter.conferirAuth(p)): Check {
  let perfis;
  try { perfis = lerPerfisComContas(raiz).perfis.filter(p => p.estado !== 'desativado'); }
  catch (e) {
    return { nome: 'contas por runtime', nivel: 'fail', detalhe: `store de perfis invalido: ${(e as Error).message}`,
      correcao: 'o store fica em .orkastery/private/runtime-profiles.json (arquivo 0600, pasta 0700)' };
  }
  if (perfis.length === 0) return { nome: 'contas por runtime', nivel: 'ok',
    detalhe: 'nenhum perfil configurado: cada runtime despacha pelo ambiente do processo' };
  const partes: string[] = [];
  let nivel: Check['nivel'] = 'ok';
  for (const runtime of RUNTIMES_COM_PERFIL) {
    const doRuntime = perfis.filter(p => p.runtime === runtime);
    if (doRuntime.length === 0) continue;
    const estados = doRuntime.map(p => {
      const a = auth(perfilDeDespacho(p));
      return { id: p.id, pronto: a.ok && perfilDisponivel(p),
        texto: !a.ok ? (a.pago ? 'provider pago (nunca despacha)' : a.transitorio ? 'conferencia de login inconclusiva' : 'sem login')
          : perfilDisponivel(p) ? 'pronto' : `${p.estado}${p.esgotadoAte ? ` ate ${p.esgotadoAte}` : ''}` };
    });
    const prontos = estados.filter(e => e.pronto).length;
    if (prontos === 0) nivel = 'fail';
    else if (prontos < estados.length && nivel === 'ok') nivel = 'warn';
    partes.push(`${runtime}: ${estados.map(e => `${e.id} ${e.texto}`).join(', ')}`);
  }
  return { nome: 'contas por runtime', nivel, detalhe: partes.join('; '),
    ...(nivel !== 'ok' ? { correcao: 'ork accounts check marca os perfis (sem-auth, provider-pago); ork accounts add refaz o login de assinatura pelo proprio CLI, nunca copiando credencial' } : {}) };
}

/**
 * Variaveis que REDIRECIONAM o despacho do `claude` para um provider pago.
 * Presenca delas com politica `subscription-only` e bloqueante: o despacho passaria a cobrar
 * por token, fora da assinatura, sem ninguem pedir.
 */
const ENVS_QUE_REDIRECIONAM = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
];

function versaoNode(): number {
  return Number(process.versions.node.split('.')[0]);
}

/** Checks locais; ler a entrevista não abre driver, banco, runtime ou rede. */
export function checarOnboarding(carregado: ManifestoCarregado): Check[] {
  const estado = lerOnboarding(carregado.raiz);
  const pendentes = ETAPAS_ONBOARDING.filter(e => estado.etapas[e] === null);
  const checks: Check[] = [{ nome: 'onboarding', nivel: pendentes.length ? 'warn' : 'ok',
    detalhe: pendentes.length ? `${pendentes.length} etapa(s) pendente(s): ${pendentes.join(', ')}` : '9 etapas respondidas',
    ...(pendentes.length ? { correcao: 'ork onboarding' } : {}) }];
  const escolha = estado.etapas.memoria?.conteudo;
  const modo = escolha === 'sim' || escolha === true ? 'orkmind' :
    escolha === 'orkmind' || escolha === 'files' ? escolha :
    escolha && typeof escolha === 'object' && !Array.isArray(escolha) ? escolha.modo : null;
  if ((modo === 'orkmind' || modo === 'files') && modo !== carregado.manifesto.memory.mode) {
    checks.push({ nome: 'onboarding memoria', nivel: 'warn', detalhe: `entrevista escolheu ${modo}; manifesto declara ${carregado.manifesto.memory.mode}`,
      correcao: `revise memory.mode: ${modo} em orkastery.yaml; a entrevista não altera o manifesto` });
  }
  // I-35: o fuso respondido na etapa maestro orienta owner.timezone, sem editar o manifesto.
  const maestro = estado.etapas.maestro?.conteudo;
  const fusoDaEntrevista = maestro && typeof maestro === 'object' && !Array.isArray(maestro) ? normalizarFuso(maestro.fuso) : undefined;
  if (fusoDaEntrevista && fusoDaEntrevista !== carregado.manifesto.owner?.timezone) {
    checks.push({ nome: 'onboarding fuso', nivel: 'warn',
      detalhe: `entrevista informou ${fusoDaEntrevista}; manifesto declara ${carregado.manifesto.owner?.timezone ?? `${CHAVE_DO_FUSO} ausente`}`,
      correcao: `revise ${CHAVE_DO_FUSO}: "${fusoDaEntrevista}" em orkastery.yaml; a entrevista não altera o manifesto` });
  }
  return checks;
}

/** Roda todos os checks a partir do diretorio informado. */
export function checar(dirInicial: string = process.cwd(), nomesHerdados = nomesDeProviderAtivos()): Check[] {
  const checks: Check[] = [];

  const major = versaoNode();
  checks.push({
    nome: 'node',
    nivel: major >= 20 ? 'ok' : 'fail',
    detalhe: `v${process.versions.node}`,
    correcao: major >= 20 ? undefined : 'instale Node 20 ou superior',
  });

  const git = noPath('git');
  checks.push({
    nome: 'git',
    nivel: git ? 'ok' : 'fail',
    detalhe: git ?? 'nao encontrado no PATH',
    correcao: git ? undefined : 'instale o git',
  });

  const repo = exec('git', ['rev-parse', '--is-inside-work-tree'], dirInicial);
  const dentroDeRepo = repo.ok && repo.stdout.trim() === 'true';
  const branch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dirInicial);
  checks.push({
    nome: 'repositorio',
    nivel: dentroDeRepo ? 'ok' : 'fail',
    detalhe: dentroDeRepo ? `branch ${branch.stdout.trim()}` : 'fora de um repositorio git',
    correcao: dentroDeRepo ? undefined : 'rode o ork dentro de um repositorio git',
  });

  const claude = adapter.disponivel();
  const v = claude ? adapter.versao() : null;
  checks.push({
    nome: 'runtime claude-bg',
    nivel: claude ? 'ok' : 'fail',
    detalhe: claude ? `${claude} (${v ?? 'versao desconhecida'})` : 'binario `claude` fora do PATH',
    correcao: claude ? undefined : 'instale o Claude Code e garanta `claude` no PATH',
  });

  // Segundo runtime homologado. Ausente e `warn`, nao `fail`: o claude-bg segue sendo o
  // padrao, e um projeto que nunca pediu codex nao pode ficar bloqueado por ele.
  const codex = codexAdapter.disponivel();
  const codexVersao = codex ? codexAdapter.versao() : null;
  checks.push({
    nome: 'runtime codex',
    nivel: codex ? 'ok' : 'warn',
    detalhe: codex
      ? `${codex} (${codexVersao ?? 'versao desconhecida'})`
      : 'binario `codex` fora do PATH (opcional: claude-bg e o runtime padrao)',
    correcao: codex
      ? undefined
      : 'para despachar pelo codex, instale o Codex CLI e autentique com `codex login`',
  });

  // Pitfall MEDIDO em 06/09/2026: com o sandbox quebrado, o `codex exec` sai 0 e o agente
  // NARRA sucesso sem executar nada. A sonda e deterministica (roda `true`, sem LLM).
  let sondaDoCodex: { ok: boolean; detalhe: string } | null = null;
  if (codex) {
    sondaDoCodex = codexAdapter.sondarSandbox();
    checks.push({
      nome: 'sandbox do codex',
      nivel: sondaDoCodex.ok ? 'ok' : 'warn',
      detalhe: sondaDoCodex.ok
        ? '`codex sandbox true` executa nesta maquina'
        : `sonda \`codex sandbox true\` falhou: ${sondaDoCodex.detalhe}`,
      correcao: sondaDoCodex.ok
        ? undefined
        : 'instale o pacote bubblewrap do sistema (o bwrap embutido nao cria user namespace ' +
          'nesta maquina) ou declare runtime.sandbox: danger-full-access ciente do risco',
    });
  }

  const carregado = carregarManifesto(dirInicial);
  if (!carregado) {
    checks.push({
      nome: 'manifesto',
      nivel: 'fail',
      detalhe: `${NOME_MANIFESTO} nao encontrado a partir de ${dirInicial}`,
      correcao: 'ork init',
    });
  } else {
    checks.push({
      nome: 'manifesto',
      nivel: carregado.erros.length > 0 ? 'fail' : carregado.avisos.length > 0 ? 'warn' : 'ok',
      detalhe:
        carregado.erros.length > 0
          ? `${carregado.caminho}: ${carregado.erros.join('; ')}`
          : `${carregado.caminho} (${carregado.bytes} B de ${LIMITE_MANIFESTO_BYTES})` +
            (carregado.avisos.length > 0 ? `; ${carregado.avisos.join('; ')}` : ''),
      correcao: carregado.erros.length > 0 ? 'corrija o manifesto e rode ork doctor de novo' : undefined,
    });

    checks.push(...checarOnboarding(carregado));
    const abbrev = carregado.manifesto.project.abbrev;
    const checkAbbrev = validarAbbrev(abbrev);
    checks.push({
      nome: 'abbrev do projeto',
      nivel: checkAbbrev.ok ? 'ok' : 'fail',
      detalhe: checkAbbrev.ok
        ? `"${abbrev}" (parte 1 do slug de sessao)`
        : (checkAbbrev.erro as string),
      correcao: checkAbbrev.ok ? undefined : 'defina project.abbrev com ate 3 caracteres [a-z0-9]',
    });

    const cond = carregado.manifesto.conduction;
    checks.push({
      nome: 'modos de conducao',
      nivel: 'ok',
      detalhe:
        `padrao ${MODOS[cond.default_mode].tag}; ` +
        `permitidos ${cond.allowed_modes.map((m) => MODOS[m].tag).join(', ')}`,
    });

    // I-35: o fuso em que todo horario chega ao dono; valor invalido avisa e nao para nada.
    const fuso = fusoDoManifesto(carregado);
    checks.push({
      nome: 'fuso do dono',
      nivel: fuso.aviso ? 'warn' : 'ok',
      detalhe: fuso.aviso ?? (fuso.origem === 'manifesto'
        ? `${fuso.fuso} (${CHAVE_DO_FUSO}); horarios para pessoas em ${rotuloDoFuso(fuso.fuso)}`
        : `${fuso.fuso} (fuso do sistema; ${CHAVE_DO_FUSO} nao configurado)`),
      correcao: fuso.aviso ? `corrija ${CHAVE_DO_FUSO} com um nome IANA` : undefined,
    });

    // Quando o manifesto ELEGE o codex como runtime de despacho, a ausencia dele (ou um
    // sandbox que nao executa) deixa de ser aviso: e exatamente o que bloquearia a fase.
    if (carregado.manifesto.runtime.adapter === 'codex') {
      const sandboxConfigurado = carregado.manifesto.runtime.sandbox;
      const sandboxQuebrado =
        sondaDoCodex !== null && !sondaDoCodex.ok && sandboxConfigurado !== 'danger-full-access';
      checks.push({
        nome: 'despacho pelo codex',
        nivel: !codex ? 'fail' : sandboxQuebrado ? 'fail' : 'ok',
        detalhe: !codex
          ? 'runtime.adapter: codex, mas o binario `codex` esta fora do PATH'
          : sandboxQuebrado
            ? `runtime.adapter: codex com sandbox "${sandboxConfigurado}", mas o sandbox nao executa nesta maquina (o agente narraria sucesso sem rodar nada)`
            : `runtime.adapter: codex com sandbox "${sandboxConfigurado}"`,
        correcao: !codex
          ? 'instale o Codex CLI e autentique com `codex login` (assinatura, nunca API key)'
          : sandboxQuebrado
            ? 'instale o bubblewrap do sistema, ou declare runtime.sandbox: danger-full-access ciente do risco'
            : undefined,
      });
    }

    const politica = carregado.manifesto.runtime.provider_policy;
    const soAssinatura = politica === 'subscription-only';
    const redirecionam = ENVS_QUE_REDIRECIONAM.filter(e => nomesHerdados.includes(e));
    const pagas = nomesHerdados;
    const bloqueia = soAssinatura && redirecionam.length > 0;
    checks.push({
      nome: 'custo e provider herdado',
      nivel: bloqueia ? 'fail' : soAssinatura && pagas.length > 0 ? 'warn' : 'ok',
      detalhe: bloqueia
        ? `politica ${politica} violada: ${redirecionam.join(', ')} redireciona o despacho do claude`
        : pagas.length > 0
          ? `politica ${politica}; despacho segue na assinatura local, mas ha credencial paga no ambiente: ${pagas.join(', ')}`
          : `politica ${politica}; nenhuma variavel de provider pago ativa`,
      correcao: bloqueia
        ? `remova do ambiente: ${redirecionam.join(', ')} (o despacho usa a assinatura Claude local)`
        : pagas.length > 0
          ? `nenhuma acao obrigatoria; nunca despache fase por ${pagas.join(', ')}`
          : undefined,
    });
    const efetivas = nomesDeProviderAtivos();
    checks.push({
      nome: 'provider efetivo da fabrica',
      nivel: soAssinatura && efetivas.length ? 'warn' : 'ok',
      detalhe: efetivas.length ? `nomes ativos: ${efetivas.join(', ')}` : 'nenhum nome da lista de provider ativo',
    });

    // Bloco B6: o regime de memoria e um CHECK, nao um detalhe do manifesto. Manifesto
    // que pede `orkmind` e nao consegue liga-lo vira `warn` com a correcao, nunca `fail`:
    // memoria semantica melhora o produto, e nao e requisito dele.
    const context = memoryState(carregado);
    const { estado } = resolverRegime(context.loaded.manifesto, null);
    checks.push({ nome: 'fonte da memoria', nivel: context.divergent ? 'warn' : 'ok',
      detalhe: `${context.source}${context.divergent ? ' (cópia da worktree divergente preservada)' : ''}` });
    checks.push({
      nome: 'regime de memoria',
      nivel: estado.efetivo === 'orkmind' ? 'ok' : estado.pedido === 'orkmind' ? 'warn' : 'ok',
      detalhe:
        estado.pedido === 'orkmind' && estado.efetivo === 'files'
          ? `pedido orkmind, efetivo files (${estado.motivo}): ${estado.detalhe}`
          : estado.efetivo === 'orkmind'
            ? `orkmind ativo no tenant "${estado.tenant}" pela variavel ${estado.variavel}`
            : 'files (fallback honesto: handoff por arquivos, ponteiro path#ancora)',
      correcao: estado.pedido === 'orkmind' && estado.efetivo === 'files' ? estado.correcao : undefined,
    });

    // Bloco B3: a fila de rate limit e estado do mundo, nao detalhe interno. Uma fase
    // esperando janela e uma fase que NAO esta rodando, e quem olha o doctor precisa
    // saber disso antes de concluir que a thread travou.
    const fila = lerFilaDeRetomada(carregado.raiz);
    const esperando = fila.filter((p) => p.estado === 'aguardando');
    const escalados = fila.filter((p) => p.estado === 'escalado');
    checks.push({
      nome: 'fila de rate limit',
      nivel: escalados.length > 0 ? 'warn' : 'ok',
      detalhe:
        fila.length === 0
          ? 'vazia: nenhuma fase morreu por limite de uso neste projeto'
          : `${esperando.length} aguardando janela, ${escalados.length} escalado(s) para humano` +
            (esperando.length > 0 ? `; proxima janela em ${formatarDataHoraRotulada(esperando[0].liberaEm)}` : ''),
      correcao:
        escalados.length > 0
          ? `pedido escalado alem do limite de retry.max_tentativas: ork retry list e ork gate approve`
          : esperando.length > 0
            ? 'ork retry resume retoma o que ja liberou'
            : undefined,
    });

    const dirEstadoProjeto = path.join(raizDoEstado(carregado.raiz), DIR_ESTADO);
    const threads = path.join(dirEstadoProjeto, 'threads');
    const qtd = fs.existsSync(threads)
      ? fs.readdirSync(threads, { withFileTypes: true }).filter((e) => e.isDirectory()).length
      : 0;
    checks.push({
      nome: 'estado do projeto',
      nivel: fs.existsSync(dirEstadoProjeto) ? 'ok' : 'warn',
      detalhe: fs.existsSync(dirEstadoProjeto)
        ? `${dirEstadoProjeto} (${qtd} thread(s))`
        : `${dirEstadoProjeto} ausente`,
      correcao: fs.existsSync(dirEstadoProjeto) ? undefined : 'ork init cria o diretorio de estado',
    });

    checks.push(checarContas(carregado.raiz));
    // I-33 (D7): umask e permissoes do estado, na mesma regra do sensor (sem bits 0o022).
    checks.push(...sondasDeAmbiente(carregado.raiz));

    {
      const inventario = inventariarSessoes(carregado.raiz, { global: true, todas: true });
      checks.push({
        nome: 'governanca de sessoes',
        nivel: inventario.ok && inventario.semThread === 0 ? 'ok' : 'warn',
        detalhe: `${inventario.escopo.usuario}, Claude e Codex, global com histórico: ${inventario.total} sessões; ` +
          `${inventario.semThread} sem thread; ${inventario.ambiguas} ambíguas; ` +
          `inventário ${inventario.ok ? 'válido' : 'INCOMPLETO (zero não comprovado)'}`,
        correcao: inventario.ok && inventario.semThread === 0 ? undefined :
          'ork sessions --global --all --json; adote identidades sem vínculo com ork sessions adopt <id>',
      });
    }
  }

  return checks;
}

/** Texto do relatorio, com o resumo "o que vale nesta maquina agora". */
export function relatorio(checks: Check[]): string {
  const linhas: string[] = [];
  linhas.push('ork doctor: o que vale nesta maquina agora');
  linhas.push('');
  const largura = Math.max(...checks.map((c) => c.nome.length));
  // I-35: o Check guarda o ISO (dado de maquina, tambem lido por teste); quem imprime para o dono
  // localiza. Vale para todo check, nao so o de contas: nenhum horario chega cru ao relatorio.
  let localizou = false;
  const local = (t: string): string => {
    const l = localizarTexto(t);
    if (l !== t) localizou = true;
    return l;
  };
  for (const c of checks) {
    linhas.push(`  ${simbolo(c.nivel)} ${c.nome.padEnd(largura)}  ${local(c.detalhe)}`);
    if (c.nivel !== 'ok' && c.correcao) {
      linhas.push(`         ${' '.repeat(largura)}  correcao: ${local(c.correcao)}`);
    }
  }
  // O fuso sai uma vez por mensagem, antes do veredito, que segue sendo a ultima linha.
  if (localizou && !linhas.some((l) => l.includes(legendaDoFuso()))) linhas.push(legendaDoFuso());
  const falhas = checks.filter((c) => c.nivel === 'fail').length;
  const avisos = checks.filter((c) => c.nivel === 'warn').length;
  linhas.push('');
  linhas.push(
    falhas > 0
      ? `Veredito: BLOQUEADO (${falhas} fail, ${avisos} warn). Corrija os itens acima antes de despachar fase.`
      : `Veredito: PRONTO (${avisos} warn). Despacho de fase liberado por \`ork phase run\`.`
  );
  return linhas.join('\n');
}

/** Executa o doctor e devolve o codigo de saida (0 = pronto). */
export function doctor(dirInicial: string = process.cwd(), nomesHerdados = nomesDeProviderAtivos()): { texto: string; codigo: number } {
  const checks = checar(dirInicial, nomesHerdados);
  const falhas = checks.filter((c) => c.nivel === 'fail').length;
  return { texto: relatorio(checks), codigo: falhas > 0 ? 1 : 0 };
}
