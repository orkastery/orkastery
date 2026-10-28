/**
 * RM-058 (N6, T8 da ork-rm058n6): o ensaio do piloto (`core/scripts/ensaio-noctum.cjs`) roda sobre o `core/dist` num
 * processo filho, em pastas descartáveis, com o runtime, as contas, a parada e o canal simulados. O aceite da N6 vira
 * teste: o relógio controlado prova prazo e fuso, o teto com sessões em voo, a ausência de recibo e o reenvio sem
 * duplicação, e a correção explícita; a sabotagem prova que o ensaio reprova quando o canal duplica. RM-058, integração
 * (T7 da ork-rm058integra, D11): os cenários integrados (a cadeia ligada, o condutor que morre e a base que anda) e as marcas
 * de simulação que o aceite do piloto recusa. RM-057 (resposta curta, T8 da ork-rm057respost): os arcos do ensaio abrem pela
 * resposta curta do dono, e o cenário `resposta-curta` prova a pergunta no canal, o reply, o código, a palavra solta, o
 * número, o terminal e os negativos. GO-FIX 2 (D22): o terminal desligado não grava nada, nem com a origem perfeita, e a
 * palavra solta em reply a outra mensagem não vira palavra solta.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { kernelDisponivel } from '../src/fila-pesada';

const semKernel = !kernelDisponivel();
const ENSAIO = path.resolve(__dirname, '../../scripts/ensaio-noctum.cjs');

interface Expectativa { texto: string; ok: boolean; detalhe?: string }
interface Cenario { nome: string; titulo: string; ok: boolean; expectativas: Expectativa[] }
interface Resultado { contrato: string; ok: boolean; simulado: boolean; marcas: Record<string, unknown>; raiz: string; mantida: boolean;
  sabotagem: string | null; cenarios: Cenario[] }

function ensaio(args: string[]) {
  const env = { ...process.env };
  // Sob `node --test`, o filho não herda a marca do runner nem a autoridade HITL de quem roda a suíte.
  delete env.NODE_TEST_CONTEXT;
  for (const nome of Object.keys(env)) if (nome.startsWith('ORK_HITL_')) delete env[nome];
  return spawnSync(process.execPath, [ENSAIO, ...args], { encoding: 'utf8', timeout: 600_000, env, maxBuffer: 16 * 1024 * 1024 });
}

let completo: { status: number | null; json: Resultado; stderr: string } | null = null;
/** O ensaio inteiro roda uma vez, e os testes do aceite leem o mesmo resultado. */
function ensaioCompleto() {
  if (!completo) {
    const r = ensaio(['--json']);
    completo = { status: r.status, json: JSON.parse(r.stdout) as Resultado, stderr: r.stderr };
  }
  return completo;
}

const cenario = (nome: string): Cenario => {
  const c = ensaioCompleto().json.cenarios.find(x => x.nome === nome);
  assert.ok(c, `o cenário ${nome} não rodou`);
  return c;
};

/** A expectativa que casa com o texto passou. */
function provada(c: Cenario, padrao: RegExp): void {
  const e = c.expectativas.find(x => padrao.test(x.texto));
  assert.ok(e, `${c.nome}: nenhuma expectativa casa com ${padrao}`);
  assert.equal(e.ok, true, `${c.nome}: ${e.texto}\n${e.detalhe ?? ''}`);
}

test('EP1: o ensaio inteiro sai 0 com todas as expectativas dos doze cenários, e a pasta descartável some no fim', { skip: semKernel }, () => {
  const { status, json, stderr } = ensaioCompleto();
  assert.equal(status, 0, stderr + JSON.stringify(json.cenarios.flatMap(c => c.expectativas.filter(e => !e.ok))));
  assert.equal(json.contrato, 'ork.noctum-ensaio/v1');
  assert.equal(json.ok, true);
  assert.deepEqual(json.cenarios.map(c => c.nome), ['ligar-o-modo', 'resposta-curta', 'arco-curto', 'prazo-e-fuso', 'teto-com-sessoes-em-voo',
    'teto-medido', 'sem-recibo-e-reenvio', 'correcao-explicita', 'cadeia-ligada', 'condutor-morto', 'base-que-anda', 'duas-maquinas']);
  for (const c of json.cenarios) {
    assert.equal(c.ok, true, c.nome);
    assert.ok(c.expectativas.length >= 7, `${c.nome}: ${c.expectativas.length} expectativas`);
    // Cada cenário prova que nada de verdade rodou: as sentinelas do runtime, da forja e dos gateways ficaram paradas.
    provada(c, /^nenhum runtime, forja ou gateway de verdade foi chamado \(sentinelas claude, codex, gh/);
  }
  assert.ok(json.cenarios.reduce((s, c) => s + c.expectativas.length, 0) >= 100);
  assert.equal(json.mantida, false);
  assert.equal(fs.existsSync(json.raiz), false, 'a pasta do ensaio foi apagada');
  assert.ok(!json.raiz.startsWith(path.resolve(__dirname, '../../..')), 'a pasta do ensaio nunca fica no repositório');
});

test('EP2: o relógio controlado prova prazo e fuso: vence no primeiro HH:MM do fuso, nada antes, e fechar cedo não antecipa', { skip: semKernel }, () => {
  const c = cenario('prazo-e-fuso');
  provada(c, /^o relatório vence no primeiro \d\d:\d\d de Asia\/Tokyo depois do início da janela/);
  provada(c, /^com a fila vazia confirmada, o arco fecha cedo \(fila-vazia\)/);
  provada(c, /^fechar cedo não antecipa o relatório/);
  provada(c, /^um minuto antes do vencimento, ainda nada sai/);
  provada(c, /^no vencimento a versão 1 é composta e entregue pelo canal do envelope \(openclaw\)/);
  provada(c, /^o texto diz o fuso e dá os horários nele/);
  provada(c, /^no domingo em que Nova York adianta o relógio/);
  provada(c, /^o 02:30 que o salto pula vence depois do salto/);
  const curto = cenario('arco-curto');
  provada(curto, /^um minuto antes do fim o arco segue/);
  provada(curto, /^no fim do envelope o arco fecha por hora e pede a parada da sessão em voo uma vez/);
  provada(curto, /^no tique seguinte a lista do runtime confirma a parada/);
});

test('EP3: o teto com sessões em voo não admite mais nada, sem retry nem troca de conta, e as sessões contadas terminam; o teto medido fecha sem chamar lacuna de zero', { skip: semKernel }, () => {
  const c = cenario('teto-com-sessoes-em-voo');
  provada(c, /^dois despachos alcançam o teto do arco \(2 sessões\), com as duas sessões em voo/);
  provada(c, /^com o teto alcançado, nenhuma reserva nova passa: o t3 é recusado \(noctum\.orcamento\.esgotado\)/);
  provada(c, /^as sessões já contadas no teto seguem: nenhuma é parada/);
  provada(c, /^sem troca de conta para contornar: nenhuma das duas contas reserva/);
  provada(c, /^quando a última sessão admitida acaba, o arco fecha por custo, sem nada a parar/);
  provada(c, /^depois do fechamento nada reserva, em conta nenhuma/);
  provada(c, /^o estado deixado para retomar identifica o consumo/);
  provada(c, /^com o teto alcançado e a sessão passando do fim, a hora final fecha o arco e pede a parada dela/);
  const m = cenario('teto-medido');
  provada(m, /^com 33 de 30 minutos medidos, o arco fecha por custo com as três sessões em voo/);
  provada(m, /^sem transcrição legível, tokens ficam como lacuna/);
  provada(m, /^com a sessão em voo sem transcrição, o consumo em tokens é lacuna: a reserva recusa \(noctum\.orcamento\.sem-medicao\)/);
  provada(m, /^lacuna não prova o teto alcançado/);
});

test('EP4: sem recibo, a lacuna aparece no retrato; o reenvio é limitado e nunca duplica a página que já tem recibo', { skip: semKernel }, () => {
  const c = cenario('sem-recibo-e-reenvio');
  provada(c, /^sem o transporte do canal configurado, nada é tentado nem contado/);
  provada(c, /^sem recibo, a lacuna aparece no retrato seguinte do arco/);
  provada(c, /^antes de 5 minutos da falha, o tique não tenta de novo/);
  provada(c, /^com o canal de volta, a página sai e ganha recibo: chegou ao canal uma vez só/);
  provada(c, /^nem o tique seguinte nem o reenvio do dono repetem a página que já tem recibo/);
  provada(c, /^o transporte que morre no meio deixa o envio incerto, e nenhum tique o repete sozinho/);
  provada(c, /^ork noctum relatorio arco-incerto --reenviar telegram manda a página uma vez/);
  provada(c, /^o segundo reenvio do dono não duplica/);
  provada(cenario('arco-curto'), /^cada página chegou ao canal uma vez só, e o tique seguinte não manda nada de novo/);
});

test('EP5: a alegação que deixou de valer volta corrigida, explícita e sem apagar o rastro, e só a prova do push conta como entrega', { skip: semKernel }, () => {
  const c = cenario('correcao-explicita');
  provada(c, /^a versão 1 dá o t1 como entregue, com a prova do push/);
  provada(c, /^o t2, com a entrega registrada sem a prova do push, fica em curso, nunca em Entregue/);
  provada(c, /^revertida a entrega, o tique seguinte compõe a versão 2 com a correção explícita/);
  provada(c, /^o rastro fica: a versão 1 continua no registro do relatório, ao lado da 2/);
  provada(c, /^nada é entregue de novo: cada versão chegou uma vez, e o tique seguinte não cria a versão 3/);
  const modo = cenario('ligar-o-modo');
  provada(modo, /^sem envelope vigente, o #Noctum é recusado tipado/);
  provada(modo, /^o envelope assinado pelo gateway, entregue a ork noctum responder pela entrada, autoriza o arco/);
  provada(modo, /^a mensagem assinada com outra chave é recusada/);
});

test('EP6: cada cenário roda isolado, pela escolha no argumento, e o resumo diz o total', { skip: semKernel }, () => {
  const r = ensaio(['--cenario', 'correcao-explicita', '--resumo']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^\[ok\] correcao-explicita: .+ \(7 de 7\)$/m);
  assert.doesNotMatch(r.stdout, /prazo-e-fuso|arco-curto/);
  assert.match(r.stdout, /^Ensaio aprovado: 1 cenário\(s\), 7 de 7 expectativas\./m);
});

test('EP7: o ensaio reprova quando o canal duplica (sabotagem), e o uso errado sai 2 sem rodar nada', { skip: semKernel }, () => {
  const r = ensaio(['--cenario', 'sem-recibo-e-reenvio', '--sabotar', 'duplicar-envio', '--json']);
  assert.equal(r.status, 1, r.stderr);
  const j = JSON.parse(r.stdout) as Resultado;
  assert.deepEqual([j.ok, j.sabotagem], [false, 'duplicar-envio']);
  const falhas = j.cenarios[0].expectativas.filter(e => !e.ok).map(e => e.texto);
  assert.ok(falhas.some(t => /chegou ao canal uma vez só/.test(t)), falhas.join('\n'));
  // Só caem as expectativas que contam as mensagens no canal: a entrega única e a mensagem igual na entrada e no argumento.
  assert.ok(falhas.every(t => /uma vez|repetem|duplica|igual pela entrada/.test(t)), `só as expectativas de entrega única caem: ${falhas.join('\n')}`);
  const desconhecido = ensaio(['--cenario', 'inexistente']);
  assert.equal(desconhecido.status, 2);
  assert.match(desconhecido.stderr, /cenário desconhecido: inexistente/);
  const sabotagem = ensaio(['--sabotar', 'outra']);
  assert.equal(sabotagem.status, 2);
  const lista = ensaio(['--listar']);
  assert.equal(lista.status, 0);
  assert.equal(lista.stdout.trim().split('\n').length, 12);
});

test('EP8: a cadeia ligada vai do pedido do dono à integração na base, ao MASTER por omissão e ao relatório, pelo vigia e pelo condutor', { skip: semKernel }, () => {
  const c = cenario('cadeia-ligada');
  provada(c, /^o pedido do dono vira a thread #Auto do item, com o pedido guardado e a worktree/);
  provada(c, /^no tique, o vigia não grava a baseline: o passo espera o condutor \(baseline-pendente\)/);
  provada(c, /^o condutor grava a baseline real da thread e despacha o GOAL pelo runtime, com a linha do arco no pedido da sessão/);
  provada(c, /^com o bloco concluído pela própria sessão, a entrega pede a revisão independente/);
  provada(c, /^com a revisão PASSOU e o verify no SHA, a entrega publica: a branch no remoto de fixture e o PR na forja SIMULADA/);
  provada(c, /^com o CI SIMULADO verde no SHA publicado, a entrega integra na base do remoto, e o ship_done leva a prova do push e o arco/);
  provada(c, /^o tique seguinte faz o MASTER por omissão da entrega do arco \(a thread fecha\), e só então a fila vazia fecha o arco/);
  provada(c, /^o relatório da manhã sai no horário pelo canal combinado e dá o t1 como entregue, com o push provado/);
  provada(c, /^a cadeia inteira saiu sem falha de etapa no tique e sem exceção da entrega/);
});

test('EP9: o condutor que morre: o vigia assume, retoma a sessão morta, atualiza sem o verify, e o condutor relançado entrega', { skip: semKernel }, () => {
  const c = cenario('condutor-morto');
  provada(c, /^o condutor grava a baseline real de cada thread, despacha os dois trabalhos e sai no meio, com a trava solta/);
  provada(c, /^com o condutor fora, o vigia assume no tique e retoma a sessão morta do t2 pelo passo do arco, numa sessão nova/);
  provada(c, /^no mesmo tique, a entrega do vigia pede a revisão independente do t1/);
  provada(c, /^a base anda e a atualização sai no tique, sobre a base nova, sem o verify: ele fica para o condutor/);
  provada(c, /^no tique seguinte o verify espera o condutor: a entrega aguarda \(ocupada\)/);
  provada(c, /^o condutor relançado roda o verify real no SHA atualizado, publica, integra na base nova e faz o MASTER por omissão/);
  provada(c, /^o trabalho retomado segue em curso: o arco não fecha com o t2 na sessão nova, nem no tique depois do condutor, e o t2 não é parado/);
});

test('EP10: a base que anda: o condutor atualiza o candidato, roda o verify real no SHA novo, publica de novo e integra na base nova', { skip: semKernel }, () => {
  const c = cenario('base-que-anda');
  provada(c, /^o candidato chega publicado no remoto de fixture, com o PR aberto na forja SIMULADA/);
  provada(c, /^com a base nova, o condutor atualiza o candidato sobre ela, com a linha da thread em "Não publicado" e o bundle regravado/);
  provada(c, /^o condutor roda o verify real no SHA novo, na mesma atualização/);
  provada(c, /^a entrega publica de novo o SHA atualizado: a branch do remoto anda até ele/);
  provada(c, /^com o CI verde no SHA novo, a integração mescla na base nova, e o ship_done leva a prova do push/);
  provada(c, /^o CI SIMULADO foi lido nos dois SHAs publicados, e nenhum outro PR foi aberto/);
});

test('EP11: o resultado do ensaio leva simulado e as marcas que o aceite do piloto recusa, também no recorte de um cenário', { skip: semKernel }, () => {
  const { json } = ensaioCompleto();
  assert.equal(json.simulado, true);
  assert.deepEqual(json.marcas, { maquina: 'maquina-do-ensaio', remoto: 'fixture', forja: 'simulada', ci: 'simulado', runtime: 'simulado',
    canal: 'simulado', sentinelas: ['claude', 'codex', 'gh', 'glab', 'openclaw', 'hermes'] });
  const r = ensaio(['--cenario', 'base-que-anda', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const recorte = JSON.parse(r.stdout) as Resultado;
  assert.deepEqual([recorte.simulado, recorte.marcas], [true, json.marcas]);
});

test('EP12: o dono aprova onde estiver, com resposta curta: reply, código, palavra solta, número e o terminal desligado, com os negativos', { skip: semKernel }, () => {
  const c = cenario('resposta-curta');
  assert.equal(c.ok, true, JSON.stringify(c.expectativas.filter(e => !e.ok)));
  provada(c, /^a proposta vira a pergunta ao dono: sai uma vez no canal, numerada, .* sem o hash e sem linha para copiar/);
  provada(c, /^o "sim" em reply à mensagem da pergunta, assinado no endereço do reply, autoriza o arco/);
  provada(c, /^a mesma mensagem de novo não autoriza duas vezes/);
  provada(c, /^sem pergunta pendente, o "sim" solto não grava nada/);
  provada(c, /^sem reply, a palavra solta vale quando só uma pergunta espera no chat em que ela saiu/);
  provada(c, /^com duas perguntas esperando no chat, o "sim" solto volta perguntando qual/);
  provada(c, /^a palavra solta de outro chat autorizado não responde/);
  provada(c, /^o código vindo de um chat fora da lista do canal é recusado/);
  provada(c, /^o "ok" em reply à confirmação do "b\) Adiar" não autoriza/);
  provada(c, /^o "ok" em reply a uma mensagem que não é a pergunta .* volta dizendo por onde responder, e nada é gravado/);
  provada(c, /^depois do prazo da pergunta, a resposta volta dizendo que ela venceu/);
  provada(c, /^no terminal, a sessão despachada pelo ork que digita "sim" ouve que o ingresso do terminal está desligado/);
  provada(c, /^na sessão do dono, o prompt que a tarefa agendada injeta também não grava/);
  provada(c, /^na sessão interativa do dono, com a pergunta mostrada e a origem perfeita .* o "sim" não grava/);
  provada(c, /^o terminal puro segue recusado/);
  provada(c, /^ork noctum revogar só pergunta/);
  provada(c, /^o "a" em reply à pergunta de revogação revoga o arco/);
});

test('EP13: o cenário duas-maquinas prova partição, perda, retomada, trabalho preso e entrega única', { skip: semKernel }, () => {
  const r = ensaio(['--cenario', 'duas-maquinas', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout) as Resultado;
  const c = j.cenarios.find(x => x.nome === 'duas-maquinas')!;
  assert.equal(c.ok, true, JSON.stringify(c.expectativas.filter(e => !e.ok)));
  assert.ok(c.expectativas.length >= 8);
  provada(c, /^há uma autoridade por geração/);
  provada(c, /^nenhum trabalho tem vagas ativas em duas máquinas ao mesmo tempo/);
  provada(c, /^cada trabalho tem uma única entrega na rede/);
  provada(c, /^na F10, a máquina volta aos 15 min e nenhuma ordem é cancelada/);
  provada(c, /^na F11, a autoridade é tomada e a ordem flexível é cancelada/);
  provada(c, /^depois do recibo de fim, o trabalho flexível é retomado na primeira máquina com outra ordem e outra branch/);
  provada(c, /^o trabalho preso à segunda máquina não é reordenado/);
});

test('EP14: o resultado e o aceite de duas máquinas permanecem explicitamente simulados', { skip: semKernel }, () => {
  const r = ensaio(['--cenario', 'duas-maquinas', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout) as Resultado;
  assert.equal(j.simulado, true);
  const c = j.cenarios[0];
  provada(c, /^o aceite da primeira, combinado com o da segunda por --outra-maquina, fica simulado e mede F10 e F11 por máquina/);
  provada(c, /^nenhum runtime, forja ou gateway de verdade foi chamado/);
});
