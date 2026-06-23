import { shuffleRoles, isWerewolf, isDeity, isCivilian } from './roles'
import type { GameConfig, GameState, NightAction, Phase, Player, Role } from './types'

function genId(): string {
  return Math.random().toString(36).slice(2, 9)
}

function assignRoles(config: GameConfig): Role[] {
  const assigned: Array<Role | null> = config.players.map(() => null)
  const remaining = [...config.roles]

  config.players.forEach((p, i) => {
    if (!p.preferredRole) return
    const idx = remaining.indexOf(p.preferredRole)
    if (idx < 0) return
    assigned[i] = p.preferredRole
    remaining.splice(idx, 1)
  })

  const shuffledRemaining = shuffleRoles(remaining)
  return assigned.map((role) => role ?? (shuffledRemaining.shift() as Role))
}

export function initGame(config: GameConfig): GameState {
  const assignedRoles = assignRoles(config)
  const players: Player[] = config.players.map((p, i) => ({
    id: `p${i}`,
    name: p.name,
    role: assignedRoles[i],
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
    pendingExplode: null,
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


function applyWolfBeautyLoversDeath(
  state: GameState,
  deadIds: string[],
  phase: Phase,
  addToNightDeaths = false
): GameState {
  const deadSet = new Set(deadIds)
  const deadBeauties = state.players.filter((p) => deadSet.has(p.id) && p.role === 'wolf_beauty')
  if (deadBeauties.length === 0) return state

  let next = state
  for (const beauty of deadBeauties) {
    const charm = [...next.nightActions]
      .reverse()
      .find((a) => a.actorId === beauty.id && a.actionType === 'charm' && a.targetId)
    if (!charm?.targetId) continue
    const lover = next.players.find((p) => p.id === charm.targetId)
    if (!lover || !lover.isAlive) continue

    next = {
      ...next,
      players: next.players.map((p) => (p.id === lover.id ? { ...p, isAlive: false } : p)),
      nightDeaths:
        addToNightDeaths && !next.nightDeaths.includes(lover.id)
          ? [...next.nightDeaths, lover.id]
          : next.nightDeaths,
      logs: [
        ...next.logs,
        {
          id: genId(),
          type: 'death' as const,
          round: next.round,
          phase,
          data: { playerId: lover.id, role: lover.role, reason: 'wolf_beauty_lovers_death', wolfBeautyId: beauty.id },
          timestamp: Date.now(),
        },
      ],
    }
  }
  return next
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
  const order: Phase[] = ['night_guard', 'night_werewolf', 'night_wolf_beauty', 'night_seer', 'night_witch']
  const idx = order.indexOf(current)
  for (let i = idx + 1; i < order.length; i++) {
    const next = order[i]
    if (next === 'night_guard' && !hasRole(state, 'guard')) continue
    if (next === 'night_wolf_beauty' && !hasRole(state, 'wolf_beauty')) continue
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
      // 保密规则：死亡不翻牌（身份保密）
      return { ...p, isAlive: false }
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

  let newState: GameState = {
    ...state,
    players: newPlayers,
    nightDeaths,
    logs: newLogs,
    phase: 'day_announce',
    pendingHunter: null,
    pendingShotSource: null,
    pendingExplode: null,
    pendingLastWords: null,
    pendingLastWordsSource: null,
  }

  newState = applyWolfBeautyLoversDeath(newState, nightDeaths, 'day_announce', true)
  const win = checkWinCondition(newState)
  if (win) return { ...newState, winner: win, phase: 'game_over' }

  // 猎人夜晚被狼人击杀时，遗言结束后再开枪（被毒死不触发，狼王夜晚死亡不触发）
  const nightHunter =
    Array.from(killedByWerewolves).find((id) => {
      const p = newPlayers.find((pl) => pl.id === id)
      return p?.role === 'hunter'
    }) ?? null

  // 先进入天亮公告（报死讯）。玩家点「开始讨论」后再逐个发表夜死遗言（见 finishDiscussion / processLastWordsEnd）。
  if (nightDeaths.length > 0) {
    return {
      ...newState,
      phase: 'day_announce',
      pendingLastWordsSource: 'night', // 标记：公告后有夜死遗言待发表
      pendingHunter: nightHunter,
      pendingShotSource: nightHunter ? 'night' : null,
    }
  }

  // 平安夜，直接进入天亮公告
  return newState
}

// day_discuss 的起始发言者（与 useGame.getInitialSpeakerIndex 一致）
function initialSpeakerIndex(state: GameState): number {
  const aliveCount = state.players.filter((p) => p.isAlive).length
  return aliveCount > 0 ? Math.floor(Math.random() * aliveCount) : 0
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
    // 保密规则：被放逐者不翻牌（白痴例外，在上方分支已翻；猎人/狼王开枪时再翻）
    p.id === votedOut ? { ...p, isAlive: false } : p
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

  let newState: GameState = {
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

  newState = applyWolfBeautyLoversDeath(newState, [votedOut], 'day_vote')
  const loverWin = checkWinCondition(newState)
  if (loverWin) return { ...newState, winner: loverWin, phase: 'game_over', pendingHunter: null, pendingShotSource: null, pendingLastWords: null, pendingLastWordsSource: null }

  // 被放逐者先发表遗言，遗言结束后再处理开枪 / 胜负 / 进入黑夜
  return { ...newState, phase: 'day_last_words' }
}

// 遗言结束后的流转。夜死遗言：多名夜死者逐个发表，全部结束后若有猎人则开枪、再进入天亮公告；
// 放逐遗言：先开枪（如猎人/狼王），否则判定胜负或进入下一夜。
export function processLastWordsEnd(state: GameState): GameState {
  const source = state.pendingLastWordsSource

  if (source === 'night') {
    // 还有未发表遗言的夜死者 → 继续下一位
    const spokenLW = new Set(
      state.speeches.filter((s) => s.isLastWords && s.round === state.round).map((s) => s.playerId)
    )
    const loverDeaths = new Set(
      state.logs
        .filter((l) => l.round === state.round && l.type === 'death' && l.data.reason === 'wolf_beauty_lovers_death')
        .map((l) => l.data.playerId as string)
    )
    const next = state.nightDeaths.find((id) => !spokenLW.has(id) && !loverDeaths.has(id))
    if (next) {
      return { ...state, phase: 'day_last_words', pendingLastWords: next, pendingLastWordsSource: 'night' }
    }
    // 夜死者都说完了：清空遗言态，若有夜死猎人则开枪，否则判负/进入白天讨论（死讯已在公告阶段报过）
    const base: GameState = { ...state, pendingLastWords: null, pendingLastWordsSource: null }
    if (base.pendingHunter) {
      return { ...base, phase: 'hunter_shoot' }
    }
    const win = checkWinCondition(base)
    if (win) return { ...base, winner: win, phase: 'game_over' }
    return { ...base, phase: 'day_discuss', currentSpeakerIndex: initialSpeakerIndex(base) }
  }

  if (source === 'shot') {
    // 被开枪带走者的遗言结束 → 按原开枪来源继续：夜死流程回白天讨论，放逐流程进入下一夜
    const shotSource = state.pendingShotSource
    const base: GameState = { ...state, pendingLastWords: null, pendingLastWordsSource: null, pendingShotSource: null }
    const win = checkWinCondition(base)
    if (win) return { ...base, winner: win, phase: 'game_over' }
    if (shotSource === 'night') {
      return { ...base, phase: 'day_discuss', currentSpeakerIndex: initialSpeakerIndex(base) }
    }
    return { ...base, phase: 'night_guard', round: base.round + 1 }
  }

  // 放逐遗言
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
  // 进入开枪阶段即公开了开枪者身份（猎人/狼王）→ 翻开枪者的牌
  const revealShooter = (players: Player[]): Player[] =>
    players.map((p) => (p.id === state.pendingHunter ? { ...p, isRoleRevealed: true } : p))
  const continueState = (s: GameState): GameState => {
    const win = checkWinCondition(s)
    if (win) return { ...s, winner: win, phase: 'game_over', pendingHunter: null, pendingShotSource: null, pendingLastWordsSource: null }
    if (source === 'night') {
      // 夜死流程：死讯已在公告阶段报过，开枪后直接进入白天讨论
      return { ...s, pendingHunter: null, pendingShotSource: null, pendingLastWordsSource: null, phase: 'day_discuss', currentSpeakerIndex: initialSpeakerIndex(s) }
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
    // 放弃开枪：仍翻开枪者的牌（其身份已公开）
    return continueState({ ...state, players: revealShooter(state.players) })
  }

  const newPlayers = revealShooter(state.players).map((p) =>
    // 被枪杀者保密（不翻牌）
    p.id === targetId ? { ...p, isAlive: false } : p
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
  // 开枪已完成，清空 pendingHunter；但保留 pendingShotSource，供被枪杀者遗言结束后路由
  let shotState: GameState = {
    ...state,
    players: newPlayers,
    logs: newLogs,
    nightDeaths,
    pendingHunter: null,
  }
  shotState = applyWolfBeautyLoversDeath(shotState, [targetId], 'hunter_shoot', source === 'night')

  // 若这一枪直接结束游戏，则不再发表遗言
  const win = checkWinCondition(shotState)
  if (win) {
    return { ...shotState, winner: win, phase: 'game_over', pendingShotSource: null, pendingLastWordsSource: null }
  }

  // 被开枪带走的人也发表遗言；遗言结束后按原开枪来源（夜/票）继续流转（见 processLastWordsEnd 的 'shot' 分支）
  return {
    ...shotState,
    phase: 'day_last_words',
    pendingLastWords: targetId,
    pendingLastWordsSource: 'shot',
  }
}

export function processWhiteWolfKingExplode(state: GameState, actorId: string, targetId: string): GameState {
  const actor = state.players.find((p) => p.id === actorId)
  const target = state.players.find((p) => p.id === targetId)
  if (!actor || !target || actor.role !== 'white_wolf_king' || !actor.isAlive || !target.isAlive || actor.id === target.id) {
    return state
  }

  const newPlayers = state.players.map((p) => {
    if (p.id === actor.id) return { ...p, isAlive: false, isRoleRevealed: true }
    if (p.id === target.id) return { ...p, isAlive: false }
    return p
  })
  let next: GameState = {
    ...state,
    players: newPlayers,
    logs: [
      ...state.logs,
      {
        id: genId(),
        type: 'action' as const,
        round: state.round,
        phase: 'day_discuss' as Phase,
        data: { action: 'white_wolf_king_explode', actorId: actor.id, targetId: target.id },
        timestamp: Date.now(),
      },
    ],
    pendingHunter: null,
    pendingShotSource: null,
    pendingExplode: null,
    pendingLastWords: null,
    pendingLastWordsSource: null,
    currentSpeakerIndex: 0,
    currentVoterIndex: 0,
  }

  next = applyWolfBeautyLoversDeath(next, [actor.id, target.id], 'day_discuss')
  const win = checkWinCondition(next)
  if (win) return { ...next, winner: win, phase: 'game_over' }
  return { ...next, phase: 'night_guard', round: state.round + 1 }
}
