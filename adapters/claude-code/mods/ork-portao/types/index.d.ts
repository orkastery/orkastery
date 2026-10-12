// Contrato de tipos do Portão de Tarefas (RM-059, fatia F10). O Portão não acrescenta noun ao `$`: este arquivo
// declara o estado dele (`PluginState['ork-portao']`) e os tipos que os módulos puros e os testes usam.
// Sem import nem referência, como o motor exige de um contrato.

/** Uma tarefa do plano como o Portão a usa: o id, o título, os `touch_paths` e o verify pela regra do núcleo. */
export type PortaoTarefa = {
  /** `T2.1`, como o cabeçalho do plano escreve. */
  id: string
  /** O resto da linha do cabeçalho. */
  titulo: string
  /** Os trechos entre crases do item `touch_paths`, normalizados. */
  touchPaths: string[]
  /** O comando do verify, quando o núcleo o aceita (`ork claims conferir --tarefa`). */
  verify: string | null
  /** Por que o núcleo recusaria a conferência dessa tarefa, ou `null`. */
  problema: null | 'tarefa-sem-verify' | 'tarefa-ambigua' | 'tarefa-sem-comando' | 'tarefa-repetida'
}

/** Uma falha do próprio Portão: onde, o motivo e quando (ms desde a época). */
export type PortaoFalha = {
  onde: string
  motivo: string
  em: number
}

/** O quadro que o Portão guarda da sessão de fase (D9 do plano da thread). */
export type PortaoQuadro = {
  /** A thread do despacho, do contexto da ponte. */
  thread: string
  /** A tarefa nativa (`task_id`) para a tarefa do plano, gravada quando a criação passou. */
  tarefas: Record<string, string>
  /** A última falha do Portão, para a linha de status e o log. */
  ultimaFalha: PortaoFalha | null
}

declare module 'claude-code' {
  interface PluginState {
    'ork-portao': {
      /** O quadro do Portão nesta sessão de fase. */
      quadro: PortaoQuadro
    }
  }
}
