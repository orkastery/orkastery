/**
 * RM-061, fatia F2a: a familia `onboarding` do catalogo de mensagens (`ork onboarding` e
 * `ork experiencia show`). O pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo: o que
 * vem do estado (fuso de exemplo, chave do manifesto, contrato) entra por parametro.
 *
 * O nome de cada etapa (`maestro`, `credenciais`...) e os valores de preferencia (`curta`,
 * `detalhada`) sao identificadores que a pessoa digita: nao mudam com a lingua.
 */

export const ONBOARDING_PT_BR = {
  /** Onde ficam os segredos: a mesma frase de `ONDE_FICAM_OS_SEGREDOS`, que docs e hosts repetem. */
  segredos: 'no ambiente do processo ou no cofre do host (no Hermes, ~/.hermes/.env)',
  /** A pergunta de cada etapa da pauta, na ordem de `PAUTA_ONBOARDING`. */
  perguntas: {
    maestro: (fuso: string, chave: string) => `Quem conduz o projeto, quais são seus objetivos e preferências, e em qual fuso horário o Orkastery deve mostrar horários? Informe o fuso como nome IANA, ex.: {"fuso":"${fuso}"}; ele orienta ${chave} no manifesto, sem editá-lo. Preferências em {"owner":{...}} gravam owner no manifesto.`,
    credenciais: (segredos: string) => `Quais provedores públicos e nomes de variáveis em env serão usados? Segredos ficam ${segredos}; nunca informe valores.`,
    bancos: (segredos: string) => `Quais bancos públicos e nomes de variáveis em env configuram as conexões? Nunca informe DSN ou senha; valores ficam ${segredos}.`,
    memoria: 'Deseja OrkMind? Informe {"modo":"orkmind"} ou {"modo":"files"}; a escolha orienta memory.mode no manifesto, sem editá-lo.',
    produtos: 'Quais produtos e repositórios públicos pertencem ao projeto?',
    topologia: 'Como se distribuem ambientes e serviços? Informe identificadores públicos.',
    arquitetura: 'Quais decisões e restrições de arquitetura devem orientar o trabalho?',
    skills: 'Quais capacidades e skills serão necessárias?',
    auditores: 'Quais auditorias e cadências são desejadas?',
  },
  titulo: (contrato: string) => 'Onboarding do projeto (' + contrato + ')',
  recomendada: (language: string, timezone: string, depth: string) =>
    `Experiência recomendada: ${language}, ${timezone}, resposta ${depth}. Ativar com esses valores, configurar ou desativar?`,
  registre: (language: string, timezone: string, depth: string) => 'Registre a escolha em maestro com {"owner":{"language":"' +
    language + '","timezone":"' + timezone + '","depth":"' + depth + '","experience":true}}; use experience:false para desativar. ' +
    'Consulta não registra resposta.',
  respondida: '[respondida]',
  pendente: '[pendente]',
  responda: 'Responda com ork onboarding set <etapa> --conteudo <JSON> --por <quem>.',
  /** Recusa de entrada antes de persistir; nunca inclui a entrada recebida. */
  entradaInvalida: (segredos: string) => `onboarding.input.invalid: use JSON público e referências de variáveis; segredos ficam ${segredos}`,
  usoInvalido: 'onboarding.input.invalid: use ork onboarding [show|set <etapa>|reset [etapa]] --conteudo <JSON> [--por Q] [--json]',
  experienciaUso: 'uso: ork experiencia show [--json]',
  experiencia: (ativa: boolean, language: string, timezone: string, depth: string) =>
    `Experiência ${ativa ? 'ativa' : 'desativada'}: ${language}, ${timezone}, profundidade ${depth}.`,
  experienciaOrigens: (origens: string) => `Origens: ${origens}`,
  /** De onde veio cada preferencia (dado do `resolverExperiencia`); o ingles so troca o rotulo. */
  origemDaPreferencia: (origem: string) => origem,
  /** Aviso de preferencia invalida que o manifesto gravou ao carregar (pt-BR): traduzido so na impressao (D14). */
  avisoDaPreferencia: (aviso: string) => aviso,
  experienciaAviso: (aviso: string) => `Aviso: ${aviso}; o adapter install pula o pacote até ork onboarding set maestro corrigir.`,
  syncPor: 'onboarding.input.invalid: sync não aceita --por; informe autoria em set ou reset.',
  syncResultado: (regime: string, motivo: string | null, respondidas: number, gravadas: number, duplicadas: number, falhas: number) =>
    `${regime}${motivo ? ` (${motivo})` : ''}: ${regime === 'orkmind' && falhas === 0
      ? `${gravadas} nova(s), ${duplicadas} já existente(s); ${respondidas} etapa(s) publicada(s).`
      : 'Entrevista preservada em arquivos; publicação semântica não concluída. Consulte ork memory status.'}`,
  experienciaUninstallUso: 'uso: ork experiencia uninstall claude-code|codex [--dry-run] [--json]',
  experienciaUninstall: (dryRun: boolean, arquivos: number) =>
    `${dryRun ? 'Simulação de remoção' : 'Remoção concluída'}: ${arquivos} arquivo(s). O adaptador permanece instalado. ` +
    'Para manter o pacote desativado, configure owner.experience:false no onboarding.',
};

/** Os avisos de `validarPreferencias` (`core/src/experiencia.ts`), pela frase exata que o manifesto grava. */
const AVISOS_DA_PREFERENCIA_EN: Readonly<Record<string, string>> = {
  'experiencia.config.invalid: owner deve ser um objeto': 'experiencia.config.invalid: `owner` must be an object',
  'experiencia.config.invalid: owner.language exige locale BCP-47': 'experiencia.config.invalid: `owner.language` requires a BCP 47 locale',
  'experiencia.config.invalid: owner.timezone exige fuso IANA': 'experiencia.config.invalid: `owner.timezone` requires an IANA time zone',
  'experiencia.config.invalid: owner.depth exige curta ou detalhada': 'experiencia.config.invalid: `owner.depth` requires `curta` or `detalhada`',
  'experiencia.config.invalid: owner.experience exige booleano': 'experiencia.config.invalid: `owner.experience` requires a boolean',
};

export const ONBOARDING_EN: typeof ONBOARDING_PT_BR = {
  segredos: 'in the process environment or in the host vault (with Hermes, ~/.hermes/.env)',
  perguntas: {
    maestro: (fuso, chave) => 'Who runs the project, what are their goals and preferences, and in which time zone should Orkastery ' +
      `show times? Give the time zone as an IANA name, e.g. {"fuso":"${fuso}"}; it guides ${chave} in the manifest without editing it. ` +
      'Preferences in {"owner":{...}} write owner to the manifest.',
    credenciais: (segredos) => `Which public providers and environment variable names will be used? Secrets live ${segredos}; never give values.`,
    bancos: (segredos) => 'Which public databases and environment variable names set up the connections? Never give a DSN or a ' +
      `password; values live ${segredos}.`,
    memoria: 'Do you want OrkMind? Answer {"modo":"orkmind"} or {"modo":"files"}; the choice guides memory.mode in the manifest without editing it.',
    produtos: 'Which public products and repositories belong to the project?',
    topologia: 'How are environments and services laid out? Give public identifiers.',
    arquitetura: 'Which architecture decisions and constraints should guide the work?',
    skills: 'Which capabilities and skills will be needed?',
    auditores: 'Which audits and cadences do you want?',
  },
  titulo: (contrato) => 'Project onboarding (' + contrato + ')',
  recomendada: (language, timezone, depth) =>
    `Recommended experience: ${language}, ${timezone}, depth ${depth}. Turn it on with these values, configure it or turn it off?`,
  registre: (language, timezone, depth) => 'Record the choice in maestro with {"owner":{"language":"' + language + '","timezone":"' +
    timezone + '","depth":"' + depth + '","experience":true}}; use experience:false to turn it off. Viewing does not record an answer.',
  respondida: '[answered]',
  pendente: '[pending]',
  responda: 'Answer with `ork onboarding set <step> --conteudo <JSON> --por <who>`.',
  entradaInvalida: (segredos) => `onboarding.input.invalid: use public JSON and variable references; secrets live ${segredos}`,
  usoInvalido: 'onboarding.input.invalid: use `ork onboarding [show|set <step>|reset [step]] --conteudo <JSON> [--por WHO] [--json]`',
  experienciaUso: 'usage: ork experiencia show [--json]',
  experiencia: (ativa, language, timezone, depth) =>
    `Experience ${ativa ? 'on' : 'off'}: ${language}, ${timezone}, depth ${depth}.`,
  experienciaOrigens: (origens) => `Sources: ${origens}`,
  origemDaPreferencia: (origem) => ({ manifesto: 'manifest', sistema: 'system', padrao: 'default' } as Record<string, string>)[origem] ?? origem,
  avisoDaPreferencia: (aviso) => {
    const sufixo = '; vale o padrão até corrigir';
    const texto = aviso.endsWith(sufixo) ? aviso.slice(0, -sufixo.length) : aviso;
    const traduzido = AVISOS_DA_PREFERENCIA_EN[texto];
    // Aviso que o catalogo nao conhece sai inteiro como foi gravado, sem meia traducao.
    return traduzido === undefined ? aviso : traduzido + (texto === aviso ? '' : '; the default is used for now');
  },
  experienciaAviso: (aviso) => `Warning: ${aviso}; \`ork adapter install\` skips the package until \`ork onboarding set maestro\` fixes it.`,
  syncPor: 'onboarding.input.invalid: sync does not accept --por; record authorship with set or reset.',
  syncResultado: (regime, motivo, respondidas, gravadas, duplicadas, falhas) =>
    `${regime}${motivo ? ` (${motivo})` : ''}: ${regime === 'orkmind' && falhas === 0
      ? `${gravadas} new, ${duplicadas} already present; ${respondidas} step(s) published.`
      : 'Interview preserved in files; semantic publication did not finish. See ork memory status.'}`,
  experienciaUninstallUso: 'usage: ork experiencia uninstall claude-code|codex [--dry-run] [--json]',
  experienciaUninstall: (dryRun, files) =>
    `${dryRun ? 'Removal dry run' : 'Removal complete'}: ${files} file(s). The adapter remains installed. ` +
    'To keep the package disabled, set owner.experience:false in onboarding.',
};
