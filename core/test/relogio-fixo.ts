/**
 * RM-037 (ork-rm037esperas, D2): o relogio fixo do processo filho do CLI nos testes. Carregado por
 * `NODE_OPTIONS=--require` (`relogioFixo` em `locale-apoio.ts`): com `ORK_TESTE_AGORA` (ISO valido),
 * `Date.now()` e o `new Date()` sem argumento devolvem esse instante. Sem a variavel, nada muda.
 *
 * Existe para forcar, sem esperar o relogio, a virada do minuto entre duas leituras do `ork pulse`:
 * a comparacao do `--json` nas duas linguas caiu no CI quando o minuto virou entre elas.
 *
 * Limites (S4 do CHECK): `Date()` sem `new` lanca; datas que o Node cria por dentro (o `mtime` do `fs.statSync`)
 * nao sao `instanceof` da classe trocada; e um laco com prazo por `Date.now()` nunca vence no filho. Serve a
 * comandos que leem o relogio uma vez, como o `ork pulse --sem-runtime --json`.
 */

const fixo = Date.parse(process.env.ORK_TESTE_AGORA ?? '');

if (Number.isFinite(fixo)) {
  const DataReal = Date;
  class DataFixa extends DataReal {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixo);
      else super(...(args as [string | number | Date]));
    }
    static override now(): number { return fixo; }
  }
  globalThis.Date = DataFixa as DateConstructor;
}

export {};
