'use client'

import { useEffect, useState } from 'react'
import { isWerewolf, ROLE_NAMES } from '../../lib/roles'
import type { GameState, Phase, Player } from '../../lib/types'
import { decideWerewolfKill } from '../../lib/aiPlayer'
import { PlayerCard } from './PlayerCard'

interface Props {
  state: GameState
  aiThinking: boolean
  onAction: (targetId: string | null, actionType: string) => void
  onSkip: () => void
  triggerNightAi: (phase: Phase) => void
}

export function NightPhase({ state, aiThinking, onAction, onSkip, triggerNightAi }: Props) {
  const { phase, players, round, witchPotions, nightActions, guardLastProtect } = state
  const [selected, setSelected] = useState<string | null>(null)
  const [witchMode, setWitchMode] = useState<'choose' | 'heal' | 'poison'>('choose')
  const [seerResultTarget, setSeerResultTarget] = useState<string | null>(null)
  const [wolfAdvice, setWolfAdvice] = useState<{ targetId: string; targetName: string } | null>(null)
  const [wolfAdviceLoading, setWolfAdviceLoading] = useState(false)

  const humanPlayer = players.find((p) => p.isHuman && p.isAlive)
  const alivePlayers = players.filter((p) => p.isAlive)

  const isHumansTurn = (): boolean => {
    if (!humanPlayer) return false
    if (phase === 'night_guard') return humanPlayer.role === 'guard'
    if (phase === 'night_werewolf') return isWerewolf(humanPlayer.role)
    if (phase === 'night_seer') return humanPlayer.role === 'seer'
    if (phase === 'night_witch') return humanPlayer.role === 'witch'
    return false
  }

  // Trigger AI for phases where human isn't acting (short delay just for the "天黑" transition)
  useEffect(() => {
    setSelected(null)
    setWitchMode('choose')
    setSeerResultTarget(null)
    setWolfAdvice(null)
    setWolfAdviceLoading(false)
  }, [phase, round])

  useEffect(() => {
    if (!isHumansTurn() && !aiThinking) {
      const timer = setTimeout(() => triggerNightAi(phase), 250)
      return () => clearTimeout(timer)
    }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'night_werewolf' || !humanPlayer || !isWerewolf(humanPlayer.role)) return
    const aiWolves = players.filter((p) => p.isAlive && !p.isHuman && isWerewolf(p.role))
    if (aiWolves.length === 0 || wolfAdvice || wolfAdviceLoading) return

    let cancelled = false
    setWolfAdviceLoading(true)
    const candidates = players.filter((p) => p.isAlive && !isWerewolf(p.role))
    decideWerewolfKill(aiWolves, state, candidates)
      .then((decision) => {
        if (cancelled || !decision.targetId) return
        const target = players.find((p) => p.id === decision.targetId)
        if (target) setWolfAdvice({ targetId: decision.targetId, targetName: target.name })
      })
      .finally(() => {
        if (!cancelled) setWolfAdviceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [phase, round, humanPlayer?.id, wolfAdvice, wolfAdviceLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  const getTargetablePlayers = (): Player[] => {
    if (phase === 'night_werewolf') {
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
    if (phase === 'night_seer') return '预言家：选择今晚查验的玩家'
    if (phase === 'night_witch') return '女巫：使用你的药水'
    return ''
  }

  const handleConfirm = () => {
    if (phase === 'night_seer' && selected) {
      setSeerResultTarget(selected)
      return
    }

    if (phase === 'night_witch') {
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
      night_seer: 'check',
    }
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

      {phase === 'night_seer' && seerResultPlayer && seerResult && (
        <div className="bg-gray-900 border border-indigo-700 rounded-xl p-5 mb-5 text-center">
          <p className="text-indigo-300 text-sm mb-2">查验结果</p>
          <div className="text-white text-xl font-bold mb-1">{seerResultPlayer.name}</div>
          <div className={`text-lg font-semibold mb-4 ${seerResult === '狼人' ? 'text-red-300' : 'text-green-300'}`}>
            {seerResult}
          </div>
          <button
            onClick={() => {
              onAction(seerResultTarget, 'check')
              setSeerResultTarget(null)
            }}
            className="w-full bg-indigo-700 hover:bg-indigo-600 text-white rounded-xl py-3 text-sm font-semibold"
          >
            记住结果，继续
          </button>
        </div>
      )}

      {/* Show wolf teammates when it's the werewolf phase */}
      {phase === 'night_werewolf' && wolfTeammates.length > 0 && (
        <div className="mb-4 bg-red-950 border border-red-800 rounded-xl p-3">
          <p className="text-red-300 text-xs font-semibold mb-1">🐺 你的狼人同伴</p>
          <div className="flex gap-2 flex-wrap">
            {wolfTeammates.map((p) => (
              <span key={p.id} className="bg-red-900 text-red-200 text-sm px-3 py-1 rounded-full">
                {p.name}
              </span>
            ))}
          </div>
          {(wolfAdviceLoading || wolfAdvice) && (
            <div className="mt-3 border-t border-red-800 pt-2 text-xs text-red-200">
              {wolfAdviceLoading ? 'AI 队友正在给出刀人建议...' : `AI 队友建议袭击：${wolfAdvice?.targetName}`}
            </div>
          )}
        </div>
      )}

      {phase === 'night_werewolf' && wolfTeammates.length === 0 && humanPlayer && isWerewolf(humanPlayer.role) && (
        <div className="mb-4 bg-gray-800 border border-gray-700 rounded-xl p-3 text-center">
          <p className="text-gray-400 text-xs">你是唯一的狼人</p>
        </div>
      )}

      {/* Witch special UI */}
      {phase === 'night_witch' && witchMode === 'choose' && (
        <div className="space-y-3 mb-6">
          {witchPotions.heal && killedPlayer() && (
            <button
              onClick={() => setWitchMode('heal')}
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
              className="w-full bg-purple-900 hover:bg-purple-800 text-white rounded-xl p-4 text-left"
            >
              <div className="font-semibold">☠️ 使用毒药</div>
              <div className="text-sm text-purple-300">选择一名玩家毒杀</div>
            </button>
          )}
          <button
            onClick={onSkip}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-xl p-3 text-sm"
          >
            不使用药水，跳过
          </button>
        </div>
      )}

      {/* Player selection grid */}
      {!seerResultTarget && (phase !== 'night_witch' || witchMode !== 'choose') && (
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
              disabled={!selected}
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
