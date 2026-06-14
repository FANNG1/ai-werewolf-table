'use client'

import { useCallback, useRef, useState } from 'react'
import { decideNightAction, decideShotTarget, decideWerewolfKill, decideWitchAction, generateAiSpeech, generateAiVote, generateLastWords, generateWolfPlan } from '../lib/aiPlayer'
import type { RawClaim } from '../lib/aiPlayer'
import {
  checkWinCondition,
  getAliveWerewolves,
  hasRole,
  initGame,
  nextNightPhase,
  processHunterShoot,
  processLastWordsEnd,
  processNightEnd,
  processVote,
} from '../lib/gameEngine'
import { isWerewolf } from '../lib/roles'
import type { AiLevel, GameConfig, GameState, NightAction, Phase, PublicClaim, Role } from '../lib/types'

function genId() {
  return Math.random().toString(36).slice(2, 9)
}

function getCheckedIds(state: GameState, seerId: string): Array<string | null> {
  return state.nightActions
    .filter((a) => a.actorId === seerId && a.actionType === 'check')
    .map((a) => a.targetId)
}

function getInitialSpeakerIndex(state: GameState): number {
  const aliveCount = state.players.filter((p) => p.isAlive).length
  return aliveCount > 0 ? (state.round - 1) % aliveCount : 0
}

function getEligibleVoters(state: GameState) {
  return state.players.filter((p) => p.isAlive && !(p.role === 'idiot' && p.idiotUsed))
}

function getInitialVoterIndex(state: GameState): number {
  const voters = getEligibleVoters(state)
  return voters.length > 0 ? (state.round - 1) % voters.length : 0
}

// 把 AI 发言时自己声明的结构化 claim 转成 PublicClaim（targetName → 玩家 id）。
// 由发言者自报，不再事后猜测，避免张冠李戴和虚构查杀。
function rawClaimsToPublic(
  raw: RawClaim[],
  speech: { id: string; playerId: string; round: number },
  state: GameState
): PublicClaim[] {
  return raw.map((c) => {
    const target = c.targetName
      ? state.players.find(
          (p) => p.id !== speech.playerId && (c.targetName!.includes(p.name) || p.name.includes(c.targetName!))
        )
      : undefined
    const resultText =
      c.claimType === 'seer'
        ? c.result === 'werewolf'
          ? '查杀'
          : c.result === 'villager'
            ? '金水'
            : '未知'
        : ''
    const summary =
      c.claimType === 'seer'
        ? target
          ? `声称预言家：${target.name}=${resultText}`
          : '声称预言家'
        : c.claimType === 'witch'
          ? target
            ? `声称女巫信息：涉及${target.name}`
            : '声称女巫'
          : `声称${c.claimType === 'hunter' ? '猎人' : c.claimType === 'guard' ? '守卫' : '白痴'}`
    return {
      id: genId(),
      round: speech.round,
      claimantId: speech.playerId,
      claimType: c.claimType,
      targetId: target?.id ?? null,
      result: c.result ?? null,
      rawSpeechId: speech.id,
      summary,
    }
  })
}

// 人类发言/遗言的 claim 提取：要求第一人称自跳标记（带否定词防护），只在高把握时记录，
// 宁可漏记也不虚构——避免把“怀疑别人是预言家”误记成“自己跳预言家”。
function extractPublicClaims(state: GameState, speech: { id: string; playerId: string; content: string; round: number }): PublicClaim[] {
  const content = speech.content
  const others = state.players.filter((p) => p.id !== speech.playerId)
  const claims: PublicClaim[] = []
  const addClaim = (claim: Omit<PublicClaim, 'id' | 'round' | 'claimantId' | 'rawSpeechId'>) => {
    claims.push({ id: genId(), round: speech.round, claimantId: speech.playerId, rawSpeechId: speech.id, ...claim })
  }

  // 第一人称自跳：标记必须连续出现，且前面不是否定词
  const selfClaim = (markers: string[]): boolean =>
    markers.some((m) => {
      let from = 0
      while (true) {
        const i = content.indexOf(m, from)
        if (i < 0) return false
        const before = content.slice(Math.max(0, i - 2), i)
        if (!/[不没非别假]/.test(before)) return true
        from = i + m.length
      }
    })

  // 在关键词附近（±6 字窗口）找被提到的其他玩家名，找不到再退回全文首个名字
  const nameNear = (keywords: string[]) => {
    for (const kw of keywords) {
      let i = content.indexOf(kw)
      while (i >= 0) {
        const window = content.slice(Math.max(0, i - 6), i + kw.length + 6)
        const hit = others.find((p) => window.includes(p.name))
        if (hit) return hit
        i = content.indexOf(kw, i + kw.length)
      }
    }
    return others.find((p) => content.includes(p.name))
  }

  if (selfClaim(['我是预言家', '我跳预言家', '我就是预言家', '我是预', '我验', '我查验', '我昨晚验', '我报查杀', '我的金水', '我查杀'])) {
    const isKill = content.includes('查杀')
    const isGold = content.includes('金水')
    const target = isKill || isGold ? nameNear(['查杀', '金水', '验']) : undefined
    addClaim({
      claimType: 'seer',
      targetId: target?.id ?? null,
      result: isKill ? 'werewolf' : isGold ? 'villager' : 'unknown',
      summary: target ? `声称预言家：${target.name}=${isKill ? '查杀' : isGold ? '金水' : '未知'}` : '声称预言家',
    })
  }
  if (selfClaim(['我是女巫', '我是女', '我用了解药', '我用了毒药', '我毒了', '我救了', '我的银水'])) {
    const isSilver = content.includes('银水')
    const target = isSilver ? nameNear(['银水', '救']) : nameNear(['毒'])
    addClaim({
      claimType: 'witch',
      targetId: target?.id ?? null,
      result: isSilver ? 'villager' : 'unknown',
      summary: target ? `声称女巫信息：涉及${target.name}` : '声称女巫',
    })
  }
  if (selfClaim(['我是猎人', '我是猎'])) addClaim({ claimType: 'hunter', targetId: null, result: null, summary: '声称猎人' })
  if (selfClaim(['我是守卫', '我守了', '我守的'])) {
    const target = nameNear(['守'])
    addClaim({ claimType: 'guard', targetId: target?.id ?? null, result: null, summary: target ? `声称守卫：守${target.name}` : '声称守卫' })
  }
  if (selfClaim(['我是白痴', '我是白'])) addClaim({ claimType: 'idiot', targetId: null, result: null, summary: '声称白痴' })

  return claims
}

// 狼队夜间协商：在夜里（不知道天亮结果前）预先商定次日计划。
// 每个轮次最多生成一次；有人类狼时也生成，AI 队友白天会按计划配合。
async function maybeGenerateWolfPlan(s: GameState): Promise<GameState> {
  if (s.wolfPlanRound === s.round) return s
  const wolves = getAliveWerewolves(s)
  if (wolves.length === 0) return s
  const hasKill = s.nightActions.some((a) => a.round === s.round && a.actionType === 'kill')
  if (!hasKill) return s
  const plan = await generateWolfPlan(wolves, s)
  return { ...s, wolfPlan: plan, wolfPlanRound: s.round }
}

// 纯 AI 夜晚：守卫/狼人/预言家互不依赖，并行决策；女巫依赖狼刀结果，最后处理。
// 把原本 4 次串行 LLM 调用压缩为「3 并行 + 1」，显著缩短「天黑请闭眼」等待。
async function resolvePureAiNight(s0: GameState): Promise<GameState> {
  let s = s0
  const tasks: Promise<NightAction | null>[] = []

  const guard = s.players.find((p) => p.isAlive && p.role === 'guard' && !p.isHuman)
  if (guard) {
    const cands = s.players.filter((p) => p.isAlive && p.id !== s.guardLastProtect)
    tasks.push(
      decideNightAction(guard, s, 'protect', cands).then((t) =>
        t ? ({ round: s.round, actorId: guard.id, targetId: t, actionType: 'protect' } as NightAction) : null
      )
    )
  }
  const wolves = getAliveWerewolves(s).filter((p) => !p.isHuman)
  if (wolves.length > 0) {
    const killer = wolves[0]
    const cands = s.players.filter((p) => p.isAlive && !isWerewolf(p.role))
    tasks.push(
      decideWerewolfKill(wolves, s, cands).then((t) =>
        t ? ({ round: s.round, actorId: killer.id, targetId: t, actionType: 'kill' } as NightAction) : null
      )
    )
  }
  const seer = s.players.find((p) => p.isAlive && p.role === 'seer' && !p.isHuman)
  if (seer) {
    const checkedIds = getCheckedIds(s, seer.id)
    const cands = s.players.filter(
      (p) => p.isAlive && p.id !== seer.id && !checkedIds.includes(p.id)
    )
    tasks.push(
      decideNightAction(seer, s, 'check', cands).then((t) =>
        t ? ({ round: s.round, actorId: seer.id, targetId: t, actionType: 'check' } as NightAction) : null
      )
    )
  }

  const batch = (await Promise.all(tasks)).filter((a): a is NightAction => a !== null)
  const protectAction = batch.find((a) => a.actionType === 'protect')
  s = {
    ...s,
    nightActions: [...s.nightActions, ...batch],
    guardLastProtect: protectAction ? protectAction.targetId : s.guardLastProtect,
  }

  // 狼刀已定，趁天亮前商定次日计划（此刻还不知道女巫是否会救、最终谁死）
  s = await maybeGenerateWolfPlan(s)

  const witch = s.players.find((p) => p.isAlive && p.role === 'witch' && !p.isHuman)
  if (witch) {
    const killedId =
      s.nightActions
        .filter((a) => a.round === s.round && a.actionType === 'kill')
        .map((a) => a.targetId)[0] ?? null
    const poisonCands = s.players.filter((p) => p.isAlive && p.id !== witch.id)
    const decision = await decideWitchAction(witch, s, killedId, poisonCands)
    if (decision.heal && killedId) {
      s = {
        ...s,
        witchPotions: { ...s.witchPotions, heal: false },
        nightActions: [...s.nightActions, { round: s.round, actorId: witch.id, targetId: killedId, actionType: 'heal' }],
      }
    } else if (decision.poisonTargetId) {
      s = {
        ...s,
        witchPotions: { ...s.witchPotions, poison: false },
        nightActions: [...s.nightActions, { round: s.round, actorId: witch.id, targetId: decision.poisonTargetId, actionType: 'poison' }],
      }
    }
  }

  return processNightEnd(s)
}

export function useGame() {
  const [state, setState] = useState<GameState | null>(null)
  const [aiThinking, setAiThinking] = useState(false)
  const processingRef = useRef(false)

  const startGame = useCallback((config: GameConfig) => {
    setState(initGame(config))
  }, [])

  const addSpeech = useCallback(
    (playerId: string, content: string, reasoning?: string) => {
      setState((prev) => {
        if (!prev) return prev
        const alivePlayers = prev.players.filter((p) => p.isAlive)
        const speakerIndex = alivePlayers.findIndex((p) => p.id === playerId)
        const nextSpeakerIndex =
          prev.phase === 'day_discuss' && speakerIndex >= 0 && alivePlayers.length > 0
            ? (speakerIndex + 1) % alivePlayers.length
            : prev.currentSpeakerIndex
        const speech = {
          id: genId(),
          playerId,
          content,
          timestamp: Date.now(),
          round: prev.round,
          reasoning,
        }
        const publicClaims = extractPublicClaims(prev, speech)
        return {
          ...prev,
          speeches: [...prev.speeches, speech],
          publicClaims: [...prev.publicClaims, ...publicClaims],
          currentSpeakerIndex: nextSpeakerIndex,
          logs: [
            ...prev.logs,
            {
              id: genId(),
              type: 'speech' as const,
              round: prev.round,
              phase: prev.phase,
              data: { playerId, content },
              timestamp: Date.now(),
            },
          ],
        }
      })
    },
    []
  )

  const addNightAction = useCallback((action: Omit<NightAction, never>) => {
    setState((prev) => {
      if (!prev) return prev
      return { ...prev, nightActions: [...prev.nightActions, action] }
    })
  }, [])

  const addVote = useCallback((voterId: string, targetId: string) => {
    setState((prev) => {
      if (!prev) return prev
      const existing = prev.votes.find(
        (v) => v.voterId === voterId && v.round === prev.round
      )
      if (existing) return prev
      const voters = getEligibleVoters(prev)
      const voterIndex = voters.findIndex((p) => p.id === voterId)
      const nextVoterIndex =
        prev.phase === 'day_vote' && voterIndex >= 0 && voters.length > 0
          ? (voterIndex + 1) % voters.length
          : prev.currentVoterIndex
      return {
        ...prev,
        votes: [...prev.votes, { voterId, targetId, round: prev.round }],
        currentVoterIndex: nextVoterIndex,
      }
    })
  }, [])

  const advancePhase = useCallback((newPhase: Phase) => {
    setState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        phase: newPhase,
        logs: [
          ...prev.logs,
          {
            id: genId(),
            type: 'phase_change' as const,
            round: prev.round,
            phase: newPhase,
            data: {},
            timestamp: Date.now(),
          },
        ],
      }
    })
  }, [])

  const triggerNightAi = useCallback(
    async (phase: Phase) => {
      if (processingRef.current) return
      processingRef.current = true
      setAiThinking(true)
      try {
        setState((prev) => {
          if (!prev) return prev
          // Determine which AI players act in this phase and queue their actions
          return prev
        })

        // We read current state via a promise trick
        await new Promise<void>((resolve) => {
          setState((prev) => {
            if (!prev) { resolve(); return prev }

            const doActions = async () => {
              // 快速路径：人类没有夜晚行动角色（村民/猎人/白痴）→ 整夜全 AI，一次性并行处理
              const human = prev.players.find((p) => p.isHuman && p.isAlive)
              const humanHasNightRole =
                !!human &&
                (human.role === 'guard' ||
                  isWerewolf(human.role) ||
                  human.role === 'seer' ||
                  human.role === 'witch')
              if (!humanHasNightRole && phase === 'night_guard') {
                const result = await resolvePureAiNight(prev)
                setState(result)
                resolve()
                return
              }

              let s = prev
              if (phase !== 'night_werewolf') {
                s = await maybeGenerateWolfPlan(s)
              }
              if (phase === 'night_guard') {
                const guard = s.players.find((p) => p.isAlive && p.role === 'guard' && !p.isHuman)
                if (guard) {
                  // 守卫可守任何存活玩家（含自己），但不能连守上一晚的人
                  const candidates = s.players.filter(
                    (p) => p.isAlive && p.id !== s.guardLastProtect
                  )
                  const targetId = await decideNightAction(guard, s, 'protect', candidates)
                  if (targetId) {
                    s = {
                      ...s,
                      guardLastProtect: targetId,
                      nightActions: [
                        ...s.nightActions,
                        { round: s.round, actorId: guard.id, targetId, actionType: 'protect' },
                      ],
                    }
                  }
                }
                const nextPhase = nextNightPhase(s, 'night_guard')
                s = { ...s, phase: nextPhase }
              } else if (phase === 'night_werewolf') {
                const wolves = getAliveWerewolves(s).filter((p) => !p.isHuman)
                const alreadyKilling = s.nightActions.some(
                  (a) => a.round === s.round && a.actionType === 'kill'
                )
                if (wolves.length > 0 && !alreadyKilling) {
                  // 由存活的第一个 AI 狼代表狼队决策，目标为存活的好人
                  const killer = wolves[0]
                  const candidates = s.players.filter((p) => p.isAlive && !isWerewolf(p.role))
                  const targetId = await decideWerewolfKill(wolves, s, candidates)
                  if (targetId) {
                    s = {
                      ...s,
                      nightActions: [
                        ...s.nightActions,
                        { round: s.round, actorId: killer.id, targetId, actionType: 'kill' },
                      ],
                    }
                  }
                  // 狼刀已定，趁天亮前商定次日计划
                  s = await maybeGenerateWolfPlan(s)
                }
                const nextPhase = nextNightPhase(s, 'night_werewolf')
                s = { ...s, phase: nextPhase }
              } else if (phase === 'night_seer') {
                const seer = s.players.find((p) => p.isAlive && p.role === 'seer' && !p.isHuman)
                if (seer) {
                  const checkedIds = getCheckedIds(s, seer.id)
                  const candidates = s.players.filter(
                    (p) => p.isAlive && p.id !== seer.id && !checkedIds.includes(p.id)
                  )
                  const targetId = await decideNightAction(seer, s, 'check', candidates)
                  if (targetId) {
                    s = {
                      ...s,
                      nightActions: [
                        ...s.nightActions,
                        { round: s.round, actorId: seer.id, targetId, actionType: 'check' },
                      ],
                    }
                  }
                }
                const nextPhase = nextNightPhase(s, 'night_seer')
                s = { ...s, phase: nextPhase }
              } else if (phase === 'night_witch') {
                const witch = s.players.find((p) => p.isAlive && p.role === 'witch' && !p.isHuman)
                if (witch) {
                  const killedId =
                    s.nightActions
                      .filter((a) => a.round === s.round && a.actionType === 'kill')
                      .map((a) => a.targetId)[0] ?? null
                  const poisonCandidates = s.players.filter((p) => p.isAlive && p.id !== witch.id)
                  const decision = await decideWitchAction(witch, s, killedId, poisonCandidates)
                  if (decision.heal && killedId) {
                    s = {
                      ...s,
                      witchPotions: { ...s.witchPotions, heal: false },
                      nightActions: [
                        ...s.nightActions,
                        { round: s.round, actorId: witch.id, targetId: killedId, actionType: 'heal' },
                      ],
                    }
                  } else if (decision.poisonTargetId) {
                    s = {
                      ...s,
                      witchPotions: { ...s.witchPotions, poison: false },
                      nightActions: [
                        ...s.nightActions,
                        { round: s.round, actorId: witch.id, targetId: decision.poisonTargetId, actionType: 'poison' },
                      ],
                    }
                  }
                }
                s = processNightEnd(s)
              }
              setState(s)
              resolve()
            }

            doActions().catch(console.error)
            return prev // return prev synchronously
          })
        })
      } finally {
        processingRef.current = false
        setAiThinking(false)
      }
    },
    []
  )

  const triggerAiSpeeches = useCallback(async (currentState: GameState) => {
    if (processingRef.current) return
    processingRef.current = true
    setAiThinking(true)
    try {
      const alivePlayers = currentState.players.filter((p) => p.isAlive)
      if (alivePlayers.length === 0) return

      const spokenIds = new Set(
        currentState.speeches
          .filter((s) => s.round === currentState.round)
          .map((s) => s.playerId)
      )
      if (alivePlayers.every((p) => spokenIds.has(p.id))) return

      let localState = currentState
      let index = currentState.currentSpeakerIndex % alivePlayers.length
      let visited = 0

      while (visited < alivePlayers.length) {
        const player = alivePlayers[index]

        if (!spokenIds.has(player.id)) {
          if (player.isHuman) {
            setState((prev) => prev ? { ...prev, currentSpeakerIndex: index } : prev)
            return
          }

          const { content, claims } = await generateAiSpeech(player, localState)
          const speech = {
            id: genId(),
            playerId: player.id,
            content,
            timestamp: Date.now(),
            round: localState.round,
          }
          const log = {
            id: genId(),
            type: 'speech' as const,
            round: localState.round,
            phase: localState.phase,
            data: { playerId: player.id, content },
            timestamp: Date.now(),
          }
          const publicClaims = rawClaimsToPublic(claims, speech, localState)
          const nextIndex = (index + 1) % alivePlayers.length

          spokenIds.add(player.id)
          localState = {
            ...localState,
            speeches: [...localState.speeches, speech],
            publicClaims: [...localState.publicClaims, ...publicClaims],
            logs: [...localState.logs, log],
            currentSpeakerIndex: nextIndex,
          }
          setState((prev) => {
            if (!prev || prev.phase !== 'day_discuss' || prev.round !== localState.round) return prev
            return {
              ...prev,
              speeches: [...prev.speeches, speech],
              publicClaims: [...prev.publicClaims, ...publicClaims],
              logs: [...prev.logs, log],
              currentSpeakerIndex: nextIndex,
            }
          })
        }

        index = (index + 1) % alivePlayers.length
        visited += 1
      }
      setState((prev) => prev ? { ...prev, currentSpeakerIndex: index } : prev)
    } finally {
      processingRef.current = false
      setAiThinking(false)
    }
  }, [])

  const triggerAiVotes = useCallback(async (currentState: GameState) => {
    if (processingRef.current) return
    processingRef.current = true
    setAiThinking(true)
    try {
      const round = currentState.round
      const voters = getEligibleVoters(currentState)
      if (voters.length === 0) return

      const votedIds = new Set(
        currentState.votes.filter((v) => v.round === round).map((v) => v.voterId)
      )
      if (voters.every((p) => votedIds.has(p.id))) return

      let localState = currentState
      let index = currentState.currentVoterIndex % voters.length
      let visited = 0

      while (visited < voters.length) {
        const voter = voters[index]
        if (votedIds.has(voter.id)) {
          index = (index + 1) % voters.length
          visited += 1
          continue
        }

        if (voter.isHuman) {
          setState((prev) => prev ? { ...prev, currentVoterIndex: index } : prev)
          return
        }

        const candidates = localState.players.filter((p) => p.isAlive && p.id !== voter.id)
        if (candidates.length === 0) {
          index = (index + 1) % voters.length
          visited += 1
          continue
        }

        let targetId = await generateAiVote(voter, localState, candidates)
        if (!targetId) {
          targetId = candidates[Math.floor(Math.random() * candidates.length)].id
        }
        const vote = { voterId: voter.id, targetId, round }
        const nextIndex = (index + 1) % voters.length
        votedIds.add(voter.id)
        localState = { ...localState, votes: [...localState.votes, vote], currentVoterIndex: nextIndex }
        setState((prev) => {
          if (!prev || prev.phase !== 'day_vote' || prev.round !== round) return prev
          if (prev.votes.some((v) => v.voterId === voter.id && v.round === round)) return prev
          return { ...prev, votes: [...prev.votes, vote], currentVoterIndex: nextIndex }
        })

        index = nextIndex
        visited += 1
      }
      setState((prev) => prev ? { ...prev, currentVoterIndex: index } : prev)
    } finally {
      processingRef.current = false
      setAiThinking(false)
    }
  }, [])

  const submitNightAction = useCallback(
    (actorId: string, targetId: string | null, actionType: NightAction['actionType']) => {
      setState((prev) => {
        if (!prev) return prev
        let newState = {
          ...prev,
          nightActions: [
            ...prev.nightActions,
            { round: prev.round, actorId, targetId, actionType },
          ],
        }

        if (actionType === 'heal') {
          newState = { ...newState, witchPotions: { ...prev.witchPotions, heal: false } }
        } else if (actionType === 'poison') {
          newState = { ...newState, witchPotions: { ...prev.witchPotions, poison: false } }
        } else if (actionType === 'protect') {
          newState = { ...newState, guardLastProtect: targetId }
        }

        if (prev.phase === 'night_witch') {
          return processNightEnd(newState)
        }

        const nextPhase = nextNightPhase(newState, prev.phase)
        return { ...newState, phase: nextPhase }
      })
    },
    []
  )

  const skipNightAction = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev
      if (prev.phase === 'night_witch') {
        return processNightEnd(prev)
      }
      const nextPhase = nextNightPhase(prev, prev.phase)
      return { ...prev, phase: nextPhase }
    })
  }, [])

  const finishDiscussion = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev
      // day_announce → day_discuss, day_discuss → day_vote
      const nextPhase = prev.phase === 'day_announce' ? 'day_discuss' : 'day_vote'
      return {
        ...prev,
        phase: nextPhase,
        currentSpeakerIndex:
          nextPhase === 'day_discuss' ? getInitialSpeakerIndex(prev) : prev.currentSpeakerIndex,
        currentVoterIndex:
          nextPhase === 'day_vote' ? getInitialVoterIndex(prev) : prev.currentVoterIndex,
      }
    })
  }, [])

  const submitVoteAndProcess = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev
      return processVote(prev)
    })
  }, [])

  const submitHunterShoot = useCallback((targetId: string | null) => {
    setState((prev) => {
      if (!prev) return prev
      return processHunterShoot(prev, targetId)
    })
  }, [])

  const triggerAiHunterShoot = useCallback(async (currentState: GameState) => {
    if (processingRef.current || !currentState.pendingHunter) return
    const shooter = currentState.players.find((p) => p.id === currentState.pendingHunter)
    if (!shooter || shooter.isHuman) return

    processingRef.current = true
    setAiThinking(true)
    try {
      const candidates = currentState.players.filter(
        (p) => p.isAlive && p.id !== currentState.pendingHunter
      )
      const targetId = await decideShotTarget(shooter, currentState, candidates)
      setState((prev) => {
        if (!prev || prev.phase !== 'hunter_shoot' || prev.pendingHunter !== shooter.id) return prev
        return processHunterShoot(prev, targetId)
      })
    } finally {
      processingRef.current = false
      setAiThinking(false)
    }
  }, [])

  // AI 被放逐者自动生成遗言（只生成并展示，不推进阶段，等待「继续」）
  const triggerAiLastWords = useCallback(async (currentState: GameState) => {
    if (processingRef.current || !currentState.pendingLastWords) return
    const dying = currentState.players.find((p) => p.id === currentState.pendingLastWords)
    if (!dying || dying.isHuman) return
    const already = currentState.speeches.some(
      (s) => s.playerId === dying.id && s.isLastWords && s.round === currentState.round
    )
    if (already) return

    processingRef.current = true
    setAiThinking(true)
    try {
      const { content, claims } = await generateLastWords(dying, currentState)
      setState((prev) => {
        if (!prev || prev.phase !== 'day_last_words' || prev.pendingLastWords !== dying.id) return prev
        if (prev.speeches.some((s) => s.playerId === dying.id && s.isLastWords && s.round === prev.round)) {
          return prev
        }
        const speech = {
          id: genId(),
          playerId: dying.id,
          content,
          timestamp: Date.now(),
          round: prev.round,
          isLastWords: true,
        }
        const publicClaims = rawClaimsToPublic(claims, speech, prev)
        const log = {
          id: genId(),
          type: 'speech' as const,
          round: prev.round,
          phase: prev.phase,
          data: { playerId: dying.id, content, lastWords: true },
          timestamp: Date.now(),
        }
        return {
          ...prev,
          speeches: [...prev.speeches, speech],
          publicClaims: [...prev.publicClaims, ...publicClaims],
          logs: [...prev.logs, log],
        }
      })
    } finally {
      processingRef.current = false
      setAiThinking(false)
    }
  }, [])

  // 遗言展示完毕后推进（开枪 / 判定胜负 / 进入黑夜）
  const proceedAfterLastWords = useCallback(() => {
    setState((prev) => (prev ? processLastWordsEnd(prev) : prev))
  }, [])

  // 人类被放逐者提交遗言（content 为 null 表示放弃发言），随后推进
  const submitHumanLastWords = useCallback((content: string | null) => {
    setState((prev) => {
      if (!prev || !prev.pendingLastWords) return prev
      let next = prev
      if (content && content.trim()) {
        const speech = {
          id: genId(),
          playerId: prev.pendingLastWords,
          content: content.trim(),
          timestamp: Date.now(),
          round: prev.round,
          isLastWords: true,
        }
        const publicClaims = extractPublicClaims(prev, speech)
        const log = {
          id: genId(),
          type: 'speech' as const,
          round: prev.round,
          phase: prev.phase,
          data: { playerId: prev.pendingLastWords, content: content.trim(), lastWords: true },
          timestamp: Date.now(),
        }
        next = {
          ...prev,
          speeches: [...prev.speeches, speech],
          publicClaims: [...prev.publicClaims, ...publicClaims],
          logs: [...prev.logs, log],
        }
      }
      return processLastWordsEnd(next)
    })
  }, [])

  const startReview = useCallback(() => {
    setState((prev) => prev ? { ...prev, phase: 'review' } : prev)
  }, [])

  return {
    state,
    aiThinking,
    startGame,
    addSpeech,
    addVote,
    addNightAction,
    advancePhase,
    triggerNightAi,
    triggerAiSpeeches,
    triggerAiVotes,
    submitNightAction,
    skipNightAction,
    finishDiscussion,
    submitVoteAndProcess,
    submitHunterShoot,
    triggerAiHunterShoot,
    triggerAiLastWords,
    proceedAfterLastWords,
    submitHumanLastWords,
    startReview,
  }
}
