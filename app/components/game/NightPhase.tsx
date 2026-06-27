'use client'

import { useEffect, useState } from 'react'
import { isWerewolf, ROLE_NAMES } from '../../lib/roles'
import type { GameState, Phase, Player, WolfCouncilOpinion } from '../../lib/types'
import { generateWolfCouncilOpinion } from '../../lib/aiPlayer'
import { PlayerCard } from './PlayerCard'

interface Props {
  state: GameState
  aiThinking: boolean
  onAction: (
    targetId: string | null,
    actionType: string,
    wolfCouncilInput?: { reason: string; dayStrategy: string; positionStrategy: string; opinions?: WolfCouncilOpinion[]; decisionMode?: 'ai' | 'human' }
  ) => void
  onSkip: () => void
  triggerNightAi: (phase: Phase) => void
}

export function NightPhase({ state, aiThinking, onAction, onSkip, triggerNightAi }: Props) {
  const { phase, players, round, witchPotions, nightActions, guardLastProtect } = state
  const [selected, setSelected] = useState<string | null>(null)
  const [witchMode, setWitchMode] = useState<'choose' | 'heal' | 'poison'>('choose')
  const [seerResultTarget, setSeerResultTarget] = useState<string | null>(null)
  const [wolfOpinions, setWolfOpinions] = useState<WolfCouncilOpinion[]>([])
  const [wolfOpinionsLoading, setWolfOpinionsLoading] = useState(false)
  const [humanWolfReason, setHumanWolfReason] = useState('')
  const [humanWolfStrategy, setHumanWolfStrategy] = useState('')
  const [humanWolfPositionStrategy, setHumanWolfPositionStrategy] = useState('')
  const [wolfDecisionMode, setWolfDecisionMode] = useState<'ai' | 'human'>('ai')
  const [nightSubmitting, setNightSubmitting] = useState(false)

  const humanPlayer = players.find((p) => p.isHuman && p.isAlive)
  const alivePlayers = players.filter((p) => p.isAlive)

  const isHumansTurn = (): boolean => {
    if (!humanPlayer) return false
    if (phase === 'night_guard') return humanPlayer.role === 'guard'
    if (phase === 'night_werewolf') return isWerewolf(humanPlayer.role)
    if (phase === 'night_wolf_beauty') return humanPlayer.role === 'wolf_beauty'
    if (phase === 'night_seer') return humanPlayer.role === 'seer'
    if (phase === 'night_witch') return humanPlayer.role === 'witch'
    return false
  }

  // Trigger AI for phases where human isn't acting (short delay just for the "天黑" transition)
  useEffect(() => {
    setSelected(null)
    setWitchMode('choose')
    setSeerResultTarget(null)
    setWolfOpinions([])
    setWolfOpinionsLoading(false)
    setHumanWolfReason('')
    setHumanWolfStrategy('')
    setHumanWolfPositionStrategy('')
    setWolfDecisionMode('ai')
    setNightSubmitting(false)
  }, [phase, round])

  useEffect(() => {
    if (!isHumansTurn() && !aiThinking) {
      const timer = setTimeout(() => triggerNightAi(phase), 250)
      return () => clearTimeout(timer)
    }
  }, [phase, round, aiThinking, humanPlayer?.id, humanPlayer?.role, triggerNightAi]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'night_werewolf' || !humanPlayer || !isWerewolf(humanPlayer.role)) return
    const aiWolves = players.filter((p) => p.isAlive && !p.isHuman && isWerewolf(p.role))
    if (aiWolves.length === 0 || wolfOpinions.length > 0 || wolfOpinionsLoading) return

    let cancelled = false
    setWolfOpinionsLoading(true)
    const candidates = players.filter((p) => p.isAlive && !isWerewolf(p.role))
    const wolves = players.filter((p) => p.isAlive && isWerewolf(p.role))
    const fallbackOpinions = (): WolfCouncilOpinion[] =>
      aiWolves.map((wolf) => {
        const target = candidates[0] ?? null
        return {
          round,
          wolfId: wolf.id,
          targetId: target?.id ?? null,
          reason: target ? `AI 队友响应超时，临时建议压制${target.name}。` : 'AI 队友响应超时，且没有可刀目标。',
          dayStrategy: '先按好人视角发言，围绕最终裁决目标找疑点，不暴露狼队夜间信息。',
          positionStrategy: '根据自己的发言顺序和座位相邻关系调整力度，避免和同伴重复同一套逻辑。',
        }
      })
    const timeout = setTimeout(() => {
      if (cancelled) return
      setWolfOpinions(fallbackOpinions())
      setWolfOpinionsLoading(false)
    }, 20000)
    Promise.all(aiWolves.map((wolf) => generateWolfCouncilOpinion(wolf, wolves, state, candidates)))
      .then((opinions) => {
        if (cancelled) return
        clearTimeout(timeout)
        setWolfOpinions(opinions)
      })
      .finally(() => {
        clearTimeout(timeout)
        if (!cancelled) setWolfOpinionsLoading(false)
      })

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [phase, round, humanPlayer?.id, wolfOpinions.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const getTargetablePlayers = (): Player[] => {
    if (phase === 'night_werewolf') {
      return alivePlayers.filter((p) => !isWerewolf(p.role))
    }
    if (phase === 'night_wolf_beauty') {
      return alivePlayers.filter((p) => !isWerewolf(p.role))
    }
    if (phase === 'night_guard') {
      return alivePlayers.filter((p) => p.id !== guardLastProtect)
    }
    if (phase === 'night_seer') {
      const checked = nightActions
        .filter((a) => a.actorId === humanPlayer?.id && a.actionType === 'check')
        .map((a) => a.targetId)
      return alivePlayers.filter((p) => p.id !== humanPlayer?.id && !checked.includes(p.id))
    }
    if (phase === 'night_witch') {
      if (witchMode === 'heal') {
        const killed = nightActions
          .filter((a) => a.round === round && a.actionType === 'kill')
          .map((a) => a.targetId)[0]
        return players.filter((p) => p.id === killed)
      }
      if (witchMode === 'poison') {
        return alivePlayers.filter((p) => p.id !== humanPlayer?.id)
      }
    }
    return []
  }

  const getSeerResult = (targetId: string): string | null => {
    const check = nightActions.find(
      (a) => a.actorId === humanPlayer?.id && a.actionType === 'check' && a.targetId === targetId
    )
    if (!check) return null
    const target = players.find((p) => p.id === targetId)
    return target ? (isWerewolf(target.role) ? '狼人' : '好人') : null
  }

  const killedPlayer = (): Player | null => {
    const killedId = nightActions
      .filter((a) => a.round === round && a.actionType === 'kill')
      .map((a) => a.targetId)[0]
    return killedId ? players.find((p) => p.id === killedId) || null : null
  }

  const getPhaseDesc = (): string => {
    if (phase === 'night_guard') return '守卫：选择今晚守护的玩家'
    if (phase === 'night_werewolf') return '狼人：选择今晚击杀的目标'
    if (phase === 'night_wolf_beauty') return '狼美人：选择今晚魅惑的目标'
    if (phase === 'night_seer') return '预言家：选择今晚查验的玩家'
    if (phase === 'night_witch') return '女巫：使用你的药水'
    return ''
  }

  const handleConfirm = () => {
    if (nightSubmitting) return
    if (phase === 'night_werewolf') {
      setNightSubmitting(true)
      onAction(selected, 'kill', {
        reason: humanWolfReason,
        dayStrategy: humanWolfStrategy,
        positionStrategy: humanWolfPositionStrategy,
        opinions: wolfOpinions,
        decisionMode: wolfDecisionMode,
      })
      setSelected(null)
      return
    }

    if (phase === 'night_seer' && selected) {
      setSeerResultTarget(selected)
      return
    }

    if (phase === 'night_witch') {
      setNightSubmitting(true)
      if (witchMode === 'heal' && selected) {
        onAction(selected, 'heal')
      } else if (witchMode === 'poison' && selected) {
        onAction(selected, 'poison')
      }
      setSelected(null)
      setWitchMode('choose')
      return
    }
    const actionMap: Record<string, string> = {
      night_guard: 'protect',
      night_werewolf: 'kill',
      night_wolf_beauty: 'charm',
      night_seer: 'check',
    }
    setNightSubmitting(true)
    onAction(selected, actionMap[phase] || 'kill')
    setSelected(null)
  }

  const bgClass = 'bg-indigo-950 min-h-full'

  if (!isHumansTurn() || aiThinking) {
    return (
      <div className={`${bgClass} flex flex-col items-center justify-center p-8 text-center`}>
        <div className="text-5xl mb-4">🌙</div>
        <h2 className="text-xl font-bold text-indigo-200 mb-2">天黑请闭眼</h2>
        <p className="text-indigo-400 text-sm mb-6">正在等待其他玩家行动...</p>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
      </div>
    )
  }

  // Werewolf teammates banner
  const wolfTeammates = humanPlayer && isWerewolf(humanPlayer.role)
    ? players.filter((p) => p.id !== humanPlayer.id && isWerewolf(p.role))
    : []
  const seerResultPlayer = seerResultTarget
    ? players.find((p) => p.id === seerResultTarget) ?? null
    : null
  const seerResult = seerResultPlayer
    ? isWerewolf(seerResultPlayer.role) ? '狼人' : '好人'
    : null
  const nameOf = (id: string | null | undefined) => id ? players.find((p) => p.id === id)?.name ?? '未知' : '无'
  const wolfMeetingBlockedReason =
    wolfOpinionsLoading
      ? '等待 AI 狼发言完成'
      : aiThinking
        ? '等待当前 AI 动作完成'
        : nightSubmitting
          ? '正在提交狼队会议'
          : wolfDecisionMode === 'human' && !selected
            ? '你来拍板时需要先选择刀口'
            : null
  const seerCheckRecords =
    humanPlayer?.role === 'seer'
      ? nightActions
          .filter((a) => a.actorId === humanPlayer.id && a.actionType === 'check' && a.targetId)
          .map((a) => {
            const target = players.find((p) => p.id === a.targetId)
            return target
              ? { round: a.round, name: target.name, result: isWerewolf(target.role) ? '狼人' : '好人' }
              : null
          })
          .filter((r): r is { round: number; name: string; result: string } => r !== null)
      : []
  const witchActionRecords =
    humanPlayer?.role === 'witch'
      ? nightActions
          .filter((a) => a.actorId === humanPlayer.id && (a.actionType === 'heal' || a.actionType === 'poison') && a.targetId)
          .map((a) => ({
            round: a.round,
            type: a.actionType,
            name: nameOf(a.targetId),
          }))
      : []

  return (
    <div className={`${bgClass} p-4`}>
      <div className="text-center mb-4">
        <div className="text-5xl mb-2">🌙</div>
        <h2 className="text-lg font-bold text-indigo-200">{getPhaseDesc()}</h2>
        {humanPlayer && (
          <p className="text-sm text-indigo-400">
            你的身份：{ROLE_NAMES[humanPlayer.role]}
          </p>
        )}
      </div>

      {humanPlayer?.role === 'seer' && (
        <div className="mb-4 rounded-xl border border-indigo-700 bg-indigo-950/70 p-3">
          <p className="mb-2 text-xs font-semibold text-indigo-200">你的查验记录</p>
          {seerCheckRecords.length === 0 ? (
            <p className="text-xs text-indigo-400">暂无查验结果</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {seerCheckRecords.map((record) => (
                <span
                  key={`${record.round}-${record.name}`}
                  className={`rounded-full px-3 py-1 text-xs ${
                    record.result === '狼人'
                      ? 'bg-red-900 text-red-200'
                      : 'bg-green-900 text-green-200'
                  }`}
                >
                  第{record.round}晚 {record.name}：{record.result}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {humanPlayer?.role === 'witch' && (
        <div className="mb-4 rounded-xl border border-purple-800 bg-purple-950/60 p-3">
          <p className="mb-2 text-xs font-semibold text-purple-200">你的女巫信息</p>
          <div className="space-y-1 text-xs text-purple-100">
            <p>解药：{witchPotions.heal ? '可用' : '已用'}；毒药：{witchPotions.poison ? '可用' : '已用'}</p>
            {(!witchPotions.heal || witchMode !== 'choose') && (
              <p>今晚刀口：{killedPlayer()?.name ?? '暂无刀口信息'}</p>
            )}
            {witchActionRecords.length === 0 ? (
              <p className="text-purple-400">暂无用药记录</p>
            ) : (
              <div className="flex flex-wrap gap-2 pt-1">
                {witchActionRecords.map((record) => (
                  <span
                    key={`${record.round}-${record.type}-${record.name}`}
                    className={`rounded-full px-3 py-1 ${
                      record.type === 'heal'
                        ? 'bg-green-900 text-green-200'
                        : 'bg-purple-900 text-purple-100'
                    }`}
                  >
                    第{record.round}晚 {record.type === 'heal' ? '救' : '毒'} {record.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'night_seer' && seerResultPlayer && seerResult && (
        <div className="bg-gray-900 border border-indigo-700 rounded-xl p-5 mb-5 text-center">
          <p className="text-indigo-300 text-sm mb-2">查验结果</p>
          <div className="text-white text-xl font-bold mb-1">{seerResultPlayer.name}</div>
          <div className={`text-lg font-semibold mb-4 ${seerResult === '狼人' ? 'text-red-300' : 'text-green-300'}`}>
            {seerResult}
          </div>
          <button
            onClick={() => {
              if (nightSubmitting) return
              setNightSubmitting(true)
              onAction(seerResultTarget, 'check')
              setSeerResultTarget(null)
            }}
            disabled={nightSubmitting}
            className="w-full bg-indigo-700 hover:bg-indigo-600 text-white rounded-xl py-3 text-sm font-semibold"
          >
            记住结果，继续
          </button>
        </div>
      )}

      {/* Show wolf teammates when it's the werewolf phase */}
      {(phase === 'night_werewolf' || phase === 'night_wolf_beauty') && wolfTeammates.length > 0 && (
        <div className="mb-4 bg-red-950 border border-red-800 rounded-xl p-3">
          <p className="text-red-300 text-xs font-semibold mb-1">🐺 你的狼人同伴</p>
          <div className="flex gap-2 flex-wrap">
            {wolfTeammates.map((p) => (
              <span key={p.id} className="bg-red-900 text-red-200 text-sm px-3 py-1 rounded-full">
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {(phase === 'night_werewolf' || phase === 'night_wolf_beauty') && wolfTeammates.length === 0 && humanPlayer && isWerewolf(humanPlayer.role) && (
        <div className="mb-4 bg-gray-800 border border-gray-700 rounded-xl p-3 text-center">
          <p className="text-gray-400 text-xs">你是唯一的狼人</p>
        </div>
      )}

      {phase === 'night_werewolf' && humanPlayer && isWerewolf(humanPlayer.role) && (
        <div className="space-y-4">
          <div className="bg-red-950 border border-red-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-red-200 text-sm font-semibold">狼队夜晚会议</p>
              {wolfOpinionsLoading && <span className="text-xs text-red-300">AI 狼并行发言中...</span>}
            </div>
            {wolfOpinions.length === 0 && !wolfOpinionsLoading ? (
              <p className="text-xs text-red-300">没有 AI 狼队友，你需要给出自己的刀口和明天打法。</p>
            ) : (
              <div className="space-y-2">
                {wolfOpinions.map((opinion) => {
                  const wolf = players.find((p) => p.id === opinion.wolfId)
                  return (
                    <div key={opinion.wolfId} className="rounded-lg bg-red-900/50 border border-red-800 p-3 text-xs text-red-100">
                      <div className="font-semibold mb-1">{wolf?.name ?? 'AI 狼'} 建议刀 {nameOf(opinion.targetId)}</div>
                      <p className="mb-1">理由：{opinion.reason}</p>
                      <p className="mb-1">明天策略：{opinion.dayStrategy}</p>
                      <p className="text-red-200">位置策略：{opinion.positionStrategy}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setWolfDecisionMode('ai')}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  wolfDecisionMode === 'ai'
                    ? 'border-red-500 bg-red-800 text-white'
                    : 'border-red-900 bg-gray-900 text-red-200'
                }`}
              >
                AI 裁决
              </button>
              <button
                type="button"
                onClick={() => setWolfDecisionMode('human')}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  wolfDecisionMode === 'human'
                    ? 'border-red-500 bg-red-800 text-white'
                    : 'border-red-900 bg-gray-900 text-red-200'
                }`}
              >
                我来拍板
              </button>
            </div>
            <textarea
              value={humanWolfReason}
              onChange={(e) => setHumanWolfReason(e.target.value)}
              placeholder="你的刀人理由"
              className="w-full bg-gray-900 border border-red-800 rounded-lg p-3 text-sm text-white placeholder:text-gray-500 min-h-20"
            />
            <textarea
              value={humanWolfStrategy}
              onChange={(e) => setHumanWolfStrategy(e.target.value)}
              placeholder="你建议狼队明天怎么发言/分工"
              className="w-full bg-gray-900 border border-red-800 rounded-lg p-3 text-sm text-white placeholder:text-gray-500 min-h-20"
            />
            <textarea
              value={humanWolfPositionStrategy}
              onChange={(e) => setHumanWolfPositionStrategy(e.target.value)}
              placeholder="结合发言顺序和座位相邻的策略"
              className="w-full bg-gray-900 border border-red-800 rounded-lg p-3 text-sm text-white placeholder:text-gray-500 min-h-20"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {getTargetablePlayers().map((p) => (
              <PlayerCard
                key={p.id}
                player={p}
                selectable
                selected={selected === p.id}
                onClick={() => setSelected(selected === p.id ? null : p.id)}
              />
            ))}
          </div>
          {wolfDecisionMode === 'ai' && !selected && (
            <p className="text-xs text-red-200">AI 裁决模式下可以不选刀口；你填写的意见会作为会议输入。</p>
          )}
          {wolfMeetingBlockedReason && (
            <p className="text-xs text-yellow-300">暂不能提交：{wolfMeetingBlockedReason}</p>
          )}

          <button
            onClick={handleConfirm}
            disabled={!!wolfMeetingBlockedReason}
            className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl py-3 text-sm font-semibold"
          >
            {wolfDecisionMode === 'human' ? '我来拍板，提交狼队会议' : '提交狼队会议，交给 AI 裁决'}
          </button>
        </div>
      )}

      {/* Witch special UI */}
      {phase === 'night_witch' && witchMode === 'choose' && (
        <div className="space-y-3 mb-6">
          {witchPotions.heal && killedPlayer() && (
            <button
              onClick={() => setWitchMode('heal')}
              disabled={nightSubmitting}
              className="w-full bg-green-800 hover:bg-green-700 text-white rounded-xl p-4 text-left"
            >
              <div className="font-semibold">💊 使用解药</div>
              <div className="text-sm text-green-300">
                今晚被袭击的是：{killedPlayer()?.name}
              </div>
            </button>
          )}
          {witchPotions.poison && (
            <button
              onClick={() => setWitchMode('poison')}
              disabled={nightSubmitting}
              className="w-full bg-purple-900 hover:bg-purple-800 text-white rounded-xl p-4 text-left"
            >
              <div className="font-semibold">☠️ 使用毒药</div>
              <div className="text-sm text-purple-300">选择一名玩家毒杀</div>
            </button>
          )}
            <button
              onClick={onSkip}
              disabled={nightSubmitting}
              className="w-full bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-xl p-3 text-sm"
            >
            不使用药水，跳过
          </button>
        </div>
      )}

      {/* Player selection grid */}
      {!seerResultTarget && phase !== 'night_werewolf' && (phase !== 'night_witch' || witchMode !== 'choose') && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {getTargetablePlayers().map((p) => {
              const seerResult = phase === 'night_seer' ? getSeerResult(p.id) : null
              return (
                <div key={p.id} className="relative">
                  <PlayerCard
                    player={p}
                    selectable
                    selected={selected === p.id}
                    onClick={() => setSelected(selected === p.id ? null : p.id)}
                  />
                  {seerResult && (
                    <div
                      className={`absolute inset-0 rounded-xl flex items-center justify-center text-sm font-bold ${
                        seerResult === '狼人' ? 'bg-red-900/80 text-red-300' : 'bg-green-900/80 text-green-300'
                      }`}
                    >
                      {seerResult}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex gap-2">
            <button
              onClick={onSkip}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-xl py-3 text-sm"
            >
              跳过
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selected || nightSubmitting}
              className="flex-2 flex-grow bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl py-3 text-sm font-semibold"
            >
              确认
            </button>
          </div>
        </>
      )}
    </div>
  )
}
