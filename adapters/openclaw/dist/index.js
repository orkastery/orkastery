/**
 * Plugin Orkastery para OpenClaw, no formato de extensao 2026.7.1.
 *
 * Zero regra de negocio no host: cada tool monta um VETOR argv e chama o CLI
 * `ork`. O parse da #TAG, a validacao de modo, gates e verificacao vivem no
 * nucleo, com teste. Tool nova que precisa de logica e sinal de que a logica
 * pertence ao `ork`.
 */
import { registerHitlIngress } from './hitl-ingress.js';
import { execFile } from 'node:child_process';
import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
/**
 * Renderizado pelo `ork adapter install openclaw` para o caminho absoluto do
 * `ork` desta maquina. Se a copia nao passou pelo instalador, o placeholder
 * sobrevive e o fallback abaixo usa ORK_BIN do ambiente ou o `ork` do PATH.
 */
const ORK_RENDERIZADO = '{{ork_bin}}';
/**
 * Abre-chaves duplo montado por concatenacao: o arquivo instalado nao pode
 * conter o par literal fora do placeholder, porque a prova do pitfall 1 e o
 * grep pelo par devolvendo 0 no dist renderizado.
 */
const MARCA_DE_PLACEHOLDER = '{' + '{';
function resolverOrkBin() {
    if (!ORK_RENDERIZADO.startsWith(MARCA_DE_PLACEHOLDER))
        return ORK_RENDERIZADO;
    const doAmbiente = process.env.ORK_BIN;
    if (doAmbiente && doAmbiente.trim() !== '')
        return doAmbiente;
    return 'ork';
}
/** Limite generoso para saidas de board/ledger sem estourar o buffer padrao. */
const MAX_BUFFER = 16 * 1024 * 1024;
/**
 * Roda o `ork` com argv em vetor (nunca string de shell: um pedido com espaco,
 * aspas ou quebra de linha chega inteiro em --prompt). Devolve stdout+stderr
 * como texto; exit diferente de zero vira texto prefixado, nunca excecao, para
 * o agente ler o erro tipado do nucleo em vez de um stack trace do host.
 */
async function rodarOrk(args, signal, entrada) {
    const bin = resolverOrkBin();
    const parentEnv = { ...process.env };
    const hasPrivateHitlAuthority = Object.keys(parentEnv).some((name) => /^ORK_HITL_(?:INGRESS_KEY|NATIVE_KEY)/.test(name));
    // O núcleo prepara recibos legados do ORK_HITL_ROOT confiável e deriva a raiz
    // pública antes de sanitizar. Nenhum argumento do modelo chega ao helper.
    let verifiers;
    try {
        verifiers = await new Promise((resolve, reject) => {
            execFile(bin, ['receipt-verifiers', '--json'], { env: parentEnv, signal, timeout: 5000, maxBuffer: 4096 }, (error, stdout) => {
                if (error)
                    return reject(error);
                try {
                    const value = JSON.parse(stdout);
                    if (value !== null && value.schema !== 'ork.hitl-verifiers/v1')
                        throw Error('invalid');
                    if (hasPrivateHitlAuthority && (!value || !value.verifiers || !Object.keys(value.verifiers).length))
                        throw Error('missing');
                    resolve(value === null ? undefined : JSON.stringify(value));
                }
                catch (error) {
                    reject(error);
                }
            });
        });
    }
    catch {
        // Sem autoridade HITL não há segredo a transformar: comandos comuns seguem
        // com o ambiente sanitizado. Com autoridade presente, falhamos fechado para
        // nunca entregar ao executor uma sessão incapaz de verificar seus recibos.
        if (hasPrivateHitlAuthority)
            return '[ork recusou] hitl.receipt.verifiers-unavailable';
    }
    // Tools do modelo não herdam a autoridade da callback humana no mesmo host.
    const env = Object.fromEntries(Object.entries(parentEnv).filter(([name]) => !name.startsWith('ORK_HITL_') && name !== 'ORK_RECEIPT_VERIFIERS'));
    if (verifiers)
        env.ORK_RECEIPT_VERIFIERS = verifiers;
    // I-36 (D6): o adaptador declara o proprio canal de conducao. Descreve a porta, nao concede autoridade.
    env.ORK_CANAL = 'openclaw';
    return new Promise((resolve) => {
        const filho = execFile(bin, args, { maxBuffer: MAX_BUFFER, signal, env }, (erro, stdout, stderr) => {
            const partes = [stdout, stderr].map((t) => (t ?? '').trim()).filter((t) => t !== '');
            const saida = partes.join('\n');
            if (!erro) {
                resolve(saida === '' ? 'ok (sem saida)' : saida);
                return;
            }
            const codigo = typeof erro.code === 'string'
                ? erro.code
                : (erro.code ?? 'desconhecido');
            if (codigo === 'ENOENT') {
                resolve(`ork nao encontrado em "${bin}". Instale o adapter com ` +
                    '`ork adapter install openclaw` (que renderiza o caminho) ou exporte ORK_BIN.');
                return;
            }
            resolve(`[ork saiu com ${String(codigo)}]\n${saida}`);
        });
        if (entrada !== undefined)
            filho.stdin?.end(entrada);
    });
}
/** Schema de objeto JSON com todas as propriedades obrigatorias. */
function schema(propriedades) {
    return {
        type: 'object',
        properties: propriedades,
        required: Object.keys(propriedades),
        additionalProperties: false,
    };
}
function texto(params, chave) {
    const valor = params[chave];
    if (typeof valor === 'string')
        return valor;
    return String(valor ?? '');
}
/** O gateway fornece o update original; o agente não pode sintetizar evidência humana. */
function argvDaResposta(p, alvo) {
    const update = p.updateTelegram;
    const callback = update?.callback_query;
    const mensagem = callback?.message ?? update?.message;
    const remetente = callback?.from ?? mensagem?.from;
    const usuario = String(remetente?.id ?? '');
    const chat = String(mensagem?.chat?.id ?? '');
    const permitidos = (nome) => (process.env[nome] ?? '').split(',').map(v => v.trim()).filter(Boolean);
    if (!usuario || !chat || remetente?.is_bot !== false || mensagem?.forward_origin ||
        !permitidos('ORK_HITL_TELEGRAM_USERS').includes(usuario) ||
        !permitidos('ORK_HITL_TELEGRAM_CHATS').includes(chat)) {
        throw new Error('origem humana não autorizada pelo gateway');
    }
    const thread = texto(p, 'thread'), pedido = texto(p, 'pedido');
    if (![thread, pedido].every(v => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(v))) {
        throw new Error('thread ou pedido inválido');
    }
    let resposta, referencia;
    if (callback) {
        const prefixo = `ork:${thread}:${pedido}:`;
        if (typeof callback.data !== 'string' || !callback.data.startsWith(prefixo)) {
            throw new Error('callback não corresponde ao pedido');
        }
        resposta = callback.data.slice(prefixo.length);
        if (!/^[1-9][0-9]?$/.test(String(resposta)))
            throw new Error('opção inválida');
        referencia = callback.id;
    }
    else {
        const origem = mensagem?.reply_to_message?.text;
        if (typeof origem !== 'string' || !origem.split('\n').includes(`ork-hitl ${thread} ${pedido}`)) {
            throw new Error('responda à mensagem do pedido HITL');
        }
        resposta = mensagem.text;
        referencia = mensagem.message_id;
    }
    if (typeof resposta !== 'string' || !resposta.trim() || resposta.length > 4096 ||
        resposta.includes('\0') || !referencia)
        throw new Error('resposta ou mensagem inválida');
    return [alvo, 'answer', thread, pedido, '--resposta-stdin', '--por', `telegram:${usuario}`,
        '--mensagem', `telegram:${chat}:${referencia}`, '--origem', 'telegram'];
}
const FERRAMENTAS = [
    {
        name: 'ork_maestro',
        description: 'Ao receber a frase exata orkastery maestro, consulte o panorama somente leitura. Não cria thread. Apresente fontes, lacunas e HITL com recomendação e opções claras; horários para o dono vêm dos campos *Local (fuso do dono), nunca do ISO. Ação posterior exige operação autorizada e readback.',
        parameters: { type: 'object', additionalProperties: false, properties: {
                thread: { type: 'string' }, section: { type: 'string', enum: ['portfolio', 'demands', 'threads', 'sessions', 'blockers', 'leases', 'retries', 'hitl', 'ship', 'master', 'nextActions'] },
                offset: { type: 'integer', minimum: 0, maximum: 100000 },
            } },
        argv: p => {
            if (Object.keys(p).some(k => !['thread', 'section', 'offset'].includes(k)) ||
                (p.thread !== undefined && (typeof p.thread !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(p.thread))) ||
                (p.section === undefined) !== (p.offset === undefined) ||
                (p.offset !== undefined && (!Number.isSafeInteger(p.offset) || Number(p.offset) < 0 || Number(p.offset) > 100000)))
                throw Error('maestro.arguments.invalid');
            return ['maestro', '--json', ...(p.thread === undefined ? [] : ['--thread', String(p.thread)]),
                ...(p.section === undefined ? [] : ['--section', String(p.section), '--offset', String(p.offset)])];
        },
    },
    {
        name: 'ork_onboarding',
        description: 'Consulta a pauta do núcleo e registra respostas públicas. Credenciais somente como nomes de variáveis; valores ficam em ~/.hermes/.env. Sync publica opcionalmente e relata degradação.',
        parameters: {
            type: 'object', additionalProperties: false, required: ['acao'],
            properties: {
                acao: { type: 'string', enum: ['show', 'set', 'reset', 'sync'] },
                etapa: { type: 'string', description: 'Etapa devolvida pela pauta do CLI; omita para reset total.' },
                conteudo: { type: 'string', description: 'JSON público serializado; nunca valores secretos.' },
                por: { type: 'string', description: 'Autoria da resposta; omitido usa owner.' },
            },
        },
        argv: (p) => ['onboarding', texto(p, 'acao'),
            ...(p.etapa === undefined ? [] : [texto(p, 'etapa')]),
            ...(p.conteudo === undefined ? [] : ['--conteudo', texto(p, 'conteudo')]),
            ...(p.por === undefined ? [] : ['--por', texto(p, 'por')]), '--json'],
    },
    {
        name: 'ork_doctor',
        description: 'O que vale nesta maquina agora: runtime, assinatura, provider de custo. Sai diferente de zero quando o despacho nao vale.',
        parameters: schema({}),
        argv: () => ['doctor'],
    },
    {
        name: 'ork_modo_do_pedido',
        description: 'Le a #TAG de conducao do pedido do builder (#Classic, #Maestro, #Auto, #Fast) e devolve o modo. #TAG aposentada (#Look, #Ork) recebe recusa tipada modo.aposentado, com saida != 0, em vez de virar o default em silencio. Sem tag, devolve o conduction.default_mode do manifesto. Use SEMPRE este tool em vez de reconhecer a tag no host.',
        parameters: schema({
            pedido: { type: 'string', description: 'O texto inteiro do pedido do builder' },
        }),
        argv: (p) => ['modos', '--do-pedido', texto(p, 'pedido'), '--json'],
    },
    {
        name: 'ork_thread_new',
        description: 'Cria a thread, o slug de 3 partes e o ledger. O modo vem de ork_modo_do_pedido; o nucleo valida contra conduction.allowed_modes e recusa o que o projeto nao permite.',
        parameters: schema({
            nome: { type: 'string', description: 'Nome curto da demanda' },
            modo: {
                type: 'string',
                description: 'classic|maestro|auto|fast, vindo de ork_modo_do_pedido',
            },
        }),
        argv: (p) => [
            'thread',
            'new',
            texto(p, 'nome'),
            '--mode',
            texto(p, 'modo'),
            '--worktree',
            'auto',
        ],
    },
    {
        name: 'ork_thread_status',
        description: 'Estado da thread lido do disco e cruzado com o runtime real.',
        parameters: schema({ thread: { type: 'string' } }),
        argv: (p) => ['thread', 'status', texto(p, 'thread')],
    },
    {
        name: 'ork_phase_run',
        description: 'Despacha uma fase (GOAL PLAN GO CHECK SHIP MASTER) pelo runtime adapter, gravando o prompt exato com sha256 no ledger.',
        parameters: schema({
            thread: { type: 'string' },
            fase: { type: 'string', enum: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'] },
            prompt: { type: 'string', description: 'O pedido do builder para esta fase' },
        }),
        argv: (p) => [
            'phase',
            'run',
            texto(p, 'thread'),
            texto(p, 'fase'),
            '--prompt',
            texto(p, 'prompt'),
        ],
    },
    {
        name: 'ork_phase_list',
        description: 'O ledger da thread, evento a evento, com quem decidiu e a evidencia.',
        parameters: schema({ thread: { type: 'string' } }),
        argv: (p) => ['phase', 'list', texto(p, 'thread')],
    },
    {
        name: 'ork_portfolio_list',
        description: 'Lista produtos, projetos e iniciativas do catálogo canônico usado pelo Kanban.',
        parameters: schema({}),
        argv: () => ['portfolio', 'list', '--json'],
    },
    {
        name: 'ork_brain_status',
        description: 'Confere contrato, disponibilidade e tenant do Company Brain sem aceitar identidade ou DSN nos argumentos.',
        parameters: schema({ thread: { type: 'string' } }),
        argv: (p) => ['brain', 'status', '--thread', texto(p, 'thread')],
    },
    {
        name: 'ork_brain_query',
        description: 'Consulta a ontologia do Company Brain pela identidade autenticada no transporte.',
        parameters: schema({
            thread: { type: 'string' },
            kinds: { type: 'string', description: 'prod,proj,init,assertion' },
        }),
        argv: (p) => ['brain', 'query', '--thread', texto(p, 'thread'), '--kinds', texto(p, 'kinds'), '--limit', '50'],
    },
    {
        name: 'ork_brain_get',
        description: 'Lê uma entidade exata do Company Brain; ausência e retenção permanecem explícitas.',
        parameters: schema({ thread: { type: 'string' }, id: { type: 'string' } }),
        argv: (p) => ['brain', 'get', texto(p, 'id'), '--thread', texto(p, 'thread')],
    },
    {
        name: 'ork_brain_context',
        description: 'Pacote de contexto citável do Company Brain: entidades pedidas e seus pais, cada uma com a citação da fonte, o frescor contra o portfólio e as lacunas. Só leitura.',
        parameters: schema({
            thread: { type: 'string' },
            ids: { type: 'string', description: 'ids do portfólio separados por vírgula (prod-, proj-, init-)' },
        }),
        argv: (p) => ['brain', 'context', '--thread', texto(p, 'thread'), '--ids', texto(p, 'ids')],
    },
    {
        name: 'ork_claims_add',
        description: 'Registra uma alegacao verificavel com o comando que a comprova. Toda citacao de arquivo ou teste vira claim.',
        parameters: schema({
            thread: { type: 'string' },
            arquivo: { type: 'string' },
            alegacao: { type: 'string' },
            comando: { type: 'string' },
        }),
        argv: (p) => [
            'claims',
            'add',
            texto(p, 'thread'),
            texto(p, 'arquivo'),
            '--claim',
            texto(p, 'alegacao'),
            '--verificar',
            texto(p, 'comando'),
        ],
    },
    {
        name: 'ork_verify',
        description: 'Reexecuta claims e comandos do manifesto no HEAD real e compara com a baseline. Passagem relatada nao e passagem.',
        parameters: schema({ thread: { type: 'string' } }),
        argv: (p) => ['verify', texto(p, 'thread')],
    },
    {
        name: 'ork_verify_baseline',
        description: 'Grava a baseline: o estado do mundo ANTES do GO, que separa regressao de divida pre-existente.',
        parameters: schema({ thread: { type: 'string' } }),
        argv: (p) => ['verify', texto(p, 'thread'), '--baseline'],
    },
    {
        name: 'ork_worktree_ensure',
        description: 'Garante a worktree isolada da thread, com a base resolvida pelo nucleo.',
        parameters: schema({ thread: { type: 'string' } }),
        argv: (p) => ['worktree', 'ensure', texto(p, 'thread')],
    },
    {
        name: 'ork_worktree_audit',
        description: 'Confere a worktree no proprio git. Sai diferente de zero quando ela divergiu ou a base avancou.',
        parameters: schema({ thread: { type: 'string' } }),
        argv: (p) => ['worktree', 'audit', texto(p, 'thread')],
    },
    ...['gate', 'sessions'].map((alvo) => ({
        name: alvo === 'gate' ? 'ork_gate_answer' : 'ork_session_answer',
        description: 'Transporta uma resposta humana do Telegram ao pedido HITL correlacionado. Use o update original do gateway autenticado; nunca crie update em nome do builder. O núcleo verifica modo, prazo e idempotência.',
        parameters: schema({
            thread: { type: 'string' },
            pedido: { type: 'string' },
            updateTelegram: { type: 'object', description: 'Update original recebido pelo gateway Telegram autenticado' },
        }),
        argv: p => argvDaResposta(p, alvo),
        entrada: p => {
            const update = p.updateTelegram;
            return update.callback_query ? update.callback_query.data.split(':').at(-1) : update.message.text;
        },
    })),
    {
        name: 'ork_ship',
        description: 'Merge serializado por lease e push PROVADO comparando o sha local com o que o remoto reporta.',
        parameters: schema({
            thread: { type: 'string' },
            base: { type: 'string' },
            quem: { type: 'string' },
        }),
        argv: (p) => [
            'ship',
            texto(p, 'thread'),
            '--para',
            texto(p, 'base'),
            '--autorizar-push',
            texto(p, 'quem'),
        ],
    },
    {
        name: 'ork_master',
        description: 'Fecha a thread: POSTMORTEM tipado, MASTER log no contrato congelado e o score HUMANO de 0 a 5 com justificativa. Nunca invente a nota.',
        parameters: schema({
            thread: { type: 'string' },
            score: { type: 'string', description: 'inteiro de 0 a 5, dado pelo humano' },
            justificativa: { type: 'string' },
            quem: { type: 'string' },
        }),
        argv: (p) => [
            'master',
            texto(p, 'thread'),
            '--score',
            texto(p, 'score'),
            '--justificativa',
            texto(p, 'justificativa'),
            '--por',
            texto(p, 'quem'),
        ],
    },
    {
        name: 'ork_board',
        description: 'Todas as threads em uma visao, e o escalonador dizendo quem avanca agora e quem espera.',
        parameters: schema({}),
        argv: () => ['board', 'plan'],
    },
    {
        name: 'ork_master_batch',
        description: 'Todas as entregas em JSON, com o indice derivado do ledger, as ja pontuadas e as aceitas por omissao. Roda ork master --todas; o nome e da antiga fila de score (ork master --batch), aposentada na I-43.',
        parameters: schema({}),
        argv: () => ['master', '--todas', '--json'],
    },
];
const plugin = defineToolPlugin({
    id: 'orkastery',
    name: 'Orkastery',
    description: 'Conducao de looping threads em 6 fases pelo nucleo `ork`, exposta ao OpenClaw como tools `ork_*`. Zero regra de negocio no host: cada tool e uma chamada de CLI.',
    tools: (tool) => FERRAMENTAS.map((f) => tool({
        name: f.name,
        description: f.description,
        parameters: f.parameters,
        execute: (params, _config, contexto) => {
            try {
                return rodarOrk(f.argv(params), contexto.signal, f.entrada?.(params));
            }
            catch {
                return '[ork recusou] resposta humana não confirmada; confira origem e correlação do pedido';
            }
        },
    })),
});
// Preserve SDK metadata and its tool registration; add only a native ingress hook.
const entry = plugin;
const registerTools = entry.register;
entry.register = (api) => {
    const result = registerTools?.(api);
    registerHitlIngress(api, resolverOrkBin());
    return result;
};
export default plugin;
