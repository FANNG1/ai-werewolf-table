import { shuffleRoles, isWerewolf, isDeity, isCivilian } from './roles'
import type { GameConfig, GameState, NightAction, Phase, Player, Role } from './types'

function genId(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function initGame(config: GameConfig): GameState {
  const shuffled = shuffleRoles(config.roles)
  const players: Player[] = config.players.map((p, i) => ({
    id: `p${i}`,
    name: p.name,
    role: shuffled[i] as Role,
    isHuman: p.isHuman,
    isAlive: true,
    aiLevel: p.aiLevel,
    isRoleRevealed: false,
    idiotUsed: false,
  }))

  return {
    config,
    players,
    phase: 'night_guard',
    round: 1,
    speeches: [],
    votes: [],
    nightActions: [],
    logs: [
      {
        id: genId(),
        type: 'phase_change',
        round: 1,
        phase: 'night_guard',
        data: { message: '游戏开始，第一夜降临' },
        timestamp: Date.now(),
      },
    ],
    winner: null,
    witchPotions: { heal: true, poison: true },
    guardLastProtect: null,
    nightDeaths: [],
    pendingHunter: null,
    pendingShotSource: null,
    pendingLastWords: null,
    pendingLastWordsSource: null,
    wolfPlan: null,
    wolfPlanRound: 0,
    publicClaims: [],
    currentSpeakerIndex: 0,
    currentVoterIndex: 0,
    votedOutPlayerId: null,
  }
}

export function hasRole(state: GameState, role: Role): boolean {
  return state.players.some((p) => p.role === role && p.isAlive)
}

export function getAlivePlayers(state: GameState): Player[] {
  return state.players.filter((p) => p.isAlive)
}

export function getAliveWerewolves(state: GameState): Player[] {
  return state.players.filter((p) => p.isAlive && isWerewolf(p.role))
}

export function getAliveVillagers(state: GameState): Player[] {
  return state.players.filter((p) => p.isAlive && !isWerewolf(p.role))
}

export function checkWinCondition(state: GameState): 'werewolves' | 'villagers' | null {
  // 好人胜利：所有狼人出局
  if (getAliveWerewolves(state).length === 0) return 'villagers'

  // 屠边规则：狼人需杀光所有神职（屠神）或杀光所有平民（屠民）才获胜
  const deities = state.players.filter((p) => isDeity(p.role))
  const civilians = state.players.filter((p) => isCivilian(p.role))
  const aliveDeities = deities.filter((p) => p.isAlive).length
  const aliveCivilians = civilians.filter((p) => p.isAlive).length

  // 屠神：本局原本有神职，且现在神职全部出局
  if (deities.length > 0 && aliveDeities === 0) return 'werewolves'
  // 屠民：本局原本有平民，且现在平民全部出局
  if (civilians.length > 0 && aliveCivilians === 0) return 'werewolves'

  return null
}

// Returns the next phase after current night sub-phase, skipping roles not in game
export function nextNightPhase(state: GameState, current: Phase): Phase {
  const order: Phase[] = ['night_guard', 'night_werewolf', 'night_seer', 'night_witch']
  const idx = order.indexOf(current)
  for (let i = idx + 1; i < order.length; i++) {
    const next = order[i]
    if (next === 'night_guard' && !hasRole(state, 'guard')) continue
    if (next === 'night_seer' && !hasRole(state, 'seer')) continue
    if (next === 'night_witch' && !hasRole(state, 'witch')) continue
    return next
  }
  return 'day_announce'
}

export function processNightEnd(state: GameState): GameState {
  const kills = state.nightActions
    .filter((a) => a.round === state.round && a.actionType === 'kill')
    .map((a) => a.targetId)
    .filter(Boolean) as string[]

  const heals = state.nightActions
    .filter((a) => a.round === state.round && a.actionType === 'heal')
    .map((a) => a.targetId)
    .filter(Boolean) as string[]

  const poisons = state.nightActions
    .filter((a) => a.round === state.round && a.actionType === 'poison')
    .map((a) => a.targetId)
    .filter(Boolean) as string[]

  const protects = state.nightActions
    .filter((a) => a.round === state.round && a.actionType === 'protect')
    .map((a) => a.targetId)
    .filter(Boolean) as string[]

  const died = new Set<string>()
  const killedByWerewolves = new Set<string>()
  for (const id of kills) {
    if (!heals.includes(id) && !protects.includes(id)) {
      died.add(id)
      killedByWerewolves.add(id)
    }
  }
  for (const id of poisons) {
    died.add(id)
  }

  const newPlayers = state.players.map((p) => {
    if (died.has(p.id)) {
      return { ...p, isAlive: false, isRoleRevealed: true }
    }
    return p
  })

  const nightDeaths = Array.from(died)
  const newLogs = [
    ...state.logs,
    {
      id: genId(),
      type: 'night_result' as const,
      round: state.round,
      phase: 'day_announce' as Phase,
      data: { deaths: nightDeaths },
      timestamp: Date.now(),
    },
  ]

  const newState: GameState = {
    ...state,
    players: newPlayers,
    nightDeaths,
    logs: newLogs,
    phase: 'day_announce',
    pendingHunter: null,
    pendingShotSource: null,
    pendingLastWords: null,
    pendingLastWordsSource: null,
  }

  // 猎人夜晚被狼人击杀时触发开枪；被毒死不触发，狼王夜晚死亡不触发。
  const nightHunter = Array.from(killedByWerewolves).find((id) => {
    const p = newPlayers.find((pl) => pl.id === id)
    return p?.role === 'hunter'
  })
  if (nightHunter) {
    return {
      ...newState,
      phase: 'hunter_shoot',
      pendingHunter: nightHunter,
      pendingShotSource: 'night',
    }
  }

  const win = checkWinCondition(newState)
  if (win) return { ...newState, winner: win, phase: 'game_over' }

  // 夜晚死亡不留遗言，直接进入天亮公告
  return newState
}

export function processVote(state: GameState): GameState {
  const roundVotes = state.votes.filter((v) => v.round === state.round)
  const tally: Record<string, number> = {}
  for (const v of roundVotes) {
    tally[v.targetId] = (tally[v.targetId] || 0) + 1
  }

  let maxVotes = 0
  let votedOut: string | null = null
  let isTie = false
  for (const [id, count] of Object.entries(tally)) {
    if (count > maxVotes) {
      maxVotes = count
      votedOut = id
      isTie = false
    } else if (count === maxVotes) {
      isTie = true
    }
  }

  if (isTie || !votedOut) {
    // 平票无人出局
    const newLogs = [
      ...state.logs,
      {
        id: genId(),
        type: 'vote' as const,
        round: state.round,
        phase: 'day_vote' as Phase,
        data: { tally, result: 'tie', votedOut: null },
        timestamp: Date.now(),
      },
    ]
    return {
      ...state,
      logs: newLogs,
      votedOutPlayerId: null,
      pendingHunter: null,
      pendingShotSource: null,
      pendingLastWords: null,
      pendingLastWordsSource: null,
      phase: 'night_guard',
      round: state.round + 1,
      currentSpeakerIndex: 0,
      currentVoterIndex: 0,
    }
  }

  const target = state.players.find((p) => p.id === votedOut)!

  // 白痴特殊处理：首次被投出免死
  if (target.role === 'idiot' && !target.idiotUsed) {
    const newPlayers = state.players.map((p) =>
      p.id === votedOut ? { ...p, idiotUsed: true, isRoleRevealed: true } : p
    )
    const newLogs = [
      ...state.logs,
      {
        id: genId(),
        type: 'death' as const,
        round: state.round,
        phase: 'day_vote' as Phase,
        data: { playerId: votedOut, role: target.role, idiotSaved: true, tally },
        timestamp: Date.now(),
      },
    ]
    return {
      ...state,
      players: newPlayers,
      logs: newLogs,
      votedOutPlayerId: null,
      pendingHunter: null,
      pendingShotSource: null,
      pendingLastWords: null,
      pendingLastWordsSource: null,
      phase: 'night_guard',
      round: state.round + 1,
      currentSpeakerIndex: 0,
      currentVoterIndex: 0,
    }
  }

  const newPlayers = state.players.map((p) =>
    p.id === votedOut ? { ...p, isAlive: false, isRoleRevealed: true } : p
  )
  const newLogs = [
    ...state.logs,
    {
      id: genId(),
      type: 'death' as const,
      round: state.round,
      phase: 'day_vote' as Phase,
      data: { playerId: votedOut, role: target.role, tally },
      timestamp: Date.now(),
    },
  ]

  const needsHunterShot =
    target.role === 'hunter' || target.role === 'wolf_king'
      ? votedOut
      : null

  const newState: GameState = {
    ...state,
    players: newPlayers,
    logs: newLogs,
    votedOutPlayerId: votedOut,
    pendingHunter: needsHunterShot,
    pendingShotSource: needsHunterShot ? 'vote' : null,
    pendingLastWords: votedOut,
    pendingLastWordsSource: 'vote',
    currentSpeakerIndex: 0,
    currentVoterIndex: 0,
  }

  // 被放逐者先发表遗言，遗言结束后再处理开枪 / 胜负 / 进入黑夜
  return { ...newState, phase: 'day_last_words' }
}

// 遗言结束后的流转（仅放逐遗言会走到这里）：先开枪（如猎人/狼王），否则判定胜负或进入下一夜。
export function processLastWordsEnd(state: GameState): GameState {
  const base: GameState = { ...state, pendingLastWords: null, pendingLastWordsSource: null }

  if (base.pendingHunter) {
    return { ...base, phase: 'hunter_shoot' }
  }

  const win = checkWinCondition(base)
  if (win) return { ...base, winner: win, phase: 'game_over' }

  return { ...base, phase: 'night_guard', round: base.round + 1 }
}

export function processHunterShoot(state: GameState, targetId: string | null): GameState {
  const source = state.pendingShotSource
  const continueState = (s: GameState): GameState => {
    const win = checkWinCondition(s)
    if (win) return { ...s, winner: win, phase: 'game_over', pendingHunter: null, pendingShotSource: null, pendingLastWordsSource: null }
    if (source === 'night') {
      return { ...s, pendingHunter: null, pendingShotSource: null, pendingLastWordsSource: null, phase: 'day_announce' }
    }
    return {
      ...s,
      pendingHunter: null,
      pendingShotSource: null,
      pendingLastWordsSource: null,
      phase: 'night_guard',
      round: state.round + 1,
    }
  }

  if (!targetId) {
    return continueState(state)
  }

  const newPlayers = state.players.map((p) =>
    p.id === targetId ? { ...p, isAlive: false, isRoleRevealed: true } : p
  )
  const newLogs = [
    ...state.logs,
    {
      id: genId(),
      type: 'action' as const,
      round: state.round,
      phase: 'hunter_shoot' as Phase,
      data: { shooterId: state.pendingHunter, targetId },
      timestamp: Date.now(),
    },
  ]
  const nightDeaths =
    source === 'night' && !state.nightDeaths.includes(targetId)
      ? [...state.nightDeaths, targetId]
      : state.nightDeaths
  const newState: GameState = {
    ...state,
    players: newPlayers,
    logs: newLogs,
    nightDeaths,
  }
  return continueState(newState)
}
