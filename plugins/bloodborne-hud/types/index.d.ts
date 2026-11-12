export type Hud = {
  /** % do contexto já usado (0-100), ou null se ainda sem leitura */
  contextUsed: number | null
  /** % do limite de 5h já usado (0-100), ou null */
  fiveHourUsed: number | null
  /** % do limite semanal já usado (0-100), ou null */
  sevenDayUsed: number | null
  /** Blood Echoes: quantas ferramentas o Claude usou nesta conversa */
  echoes: number
}

declare module 'claude-code' {
  interface PluginState {
    'bloodborne-hud': {
      hud: Hud
    }
  }
}
