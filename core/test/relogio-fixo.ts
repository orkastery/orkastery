/**
 * RM-037 (ork-rm037esperas, D2): o relogio fixo do processo filho do CLI nos testes. Carregado por
 * `NODE_OPTIONS=--require` (`relogioFixo` em `locale-apoio.ts`): com `ORK_TESTE_AGORA` (ISO valido),
 * `Date.now()` e o `new Date()` sem argumento devolvem esse instante. Sem a variavel, nada muda.
 *
 * Existe para forcar, sem esperar o relogio, a virada do minuto entre duas leituras do `ork pulse`:
 * a comparacao do `--json` nas duas linguas caiu no CI quando o minuto virou entre elas.
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
