import { ENV_HITL_VERIFIERS, publicHitlVerifiers } from './hitl-public-receipt';
/**
 * Lista explícita removida dos runtimes homologados. Nunca registra valores.
 * Não é uma lista de todas as formas de redirecionamento: proxies genéricos,
 * cabeçalhos personalizados e credenciais de outros serviços ficam fora do contrato.
 */
export const ENVS_DE_PROVIDER_PAGO = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT',
  'MISTRAL_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'TOGETHER_API_KEY',
] as const;

/** Retrato de presença, sem guardar valores ou credenciais. */
export function nomesDeProviderAtivos(base: NodeJS.ProcessEnv = process.env): string[] {
  return ENVS_DE_PROVIDER_PAGO.filter(nome => (base[nome] ?? '').trim() !== '');
}

/**
 * Identidade do despacho no ambiente da sessao filha (I-36, D4). RM-037 (defeitosdeco D-4): o domicilio
 * dos nomes e aqui porque nenhum filho de runtime herda a identidade de quem despachou; o despacho
 * acrescenta a sua explicitamente, e o `claude --bg` a leva por sessao em `--settings`.
 */
export const ENV_IDENTIDADE_DE_DESPACHO = 'ORK_DISPATCH_ID';
export const ENV_THREAD_DO_DESPACHO = 'ORK_DISPATCH_THREAD';

/** Copia, sem alterar o ambiente em que as policies ainda precisam ser avaliadas. */
export function ambienteDeAssinatura(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  const publicVerifiers = publicHitlVerifiers(base);
  for (const nome of ENVS_DE_PROVIDER_PAGO) delete env[nome];
  // A autoridade de ingresso pertence ao processo do host/núcleo. Um executor
  // de código não recebe chaves, bindings ou allowlists de respostas humanas.
  for (const nome of Object.keys(env)) if (nome.startsWith('ORK_HITL_')) delete env[nome];
  // RM-037 (defeitosdeco D-4): a identidade herdada e de OUTRO despacho (o daemon do `claude --bg`
  // guardava a do primeiro despacho e a passava a todas as sessoes reserva da conta).
  delete env[ENV_IDENTIDADE_DE_DESPACHO]; delete env[ENV_THREAD_DO_DESPACHO];
  delete env[ENV_HITL_VERIFIERS];
  if (publicVerifiers) env[ENV_HITL_VERIFIERS] = publicVerifiers;
  return env;
}
