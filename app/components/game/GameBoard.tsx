'use client'

import { useEffect, useState } from 'react'
import { isWerewolf, ROLE_EMOJIS, ROLE_NAMES } from '../../lib/roles'
import type { GameState, Phase } from '../../lib/types'
import { DayPhase } from './DayPhase'
import { HistoryModal } from './HistoryModal'
import { NightPhase } from './NightPhase'
import { PhaseHeader } from './PhaseHeader'
import { PlayerCard } from './PlayerCard'

interface Props {
  state: GameState
  aiThinking: boolean
  onHumanSpeak: (content: string) => void
  onFinishDiscussion: () => void
  onVote: (targetId: string) => void
  onSubmitVote: () => void
  onHunterShoot: (targetId: string | null) => void
  onWhiteWolfKingExplode: (actorId: string, targetId: string) => void
  triggerAiHunterShoot: (state: GameState) => void
  onNightAction: (targetId: string | null, actionType: string) => void
  onSkipNight: () => void
  onReview: () => void
  triggerNightAi: (phase: Phase) => void
  triggerAiSpeeches: (state: GameState) => void
  triggerAiVotes: (state: GameState) => void
  triggerAiLastWords: (state: GameState) => void
  onSubmitLastWords: (content: string | null) => void
  onProceedLastWords: () => void
}

export function GameBoard({
  state,
  aiThinking,
  onHumanSpeak,
  onFinishDiscussion,
  onVote,
  onSubmitVote,
  onHunterShoot,
  onWhiteWolfKingExplode,
  triggerAiHunterShoot,
  onNightAction,
  onSkipNight,
  onReview,
  triggerNightAi,
  triggerAiSpeeches,
  triggerAiVotes,
  triggerAiLastWords,
  onSubmitLastWords,
  onProceedLastWords,
}: Props) {
  const { phase, players, round, winner } = state
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const humanPlayer = players.find((p) => p.isHuman)
  const isNight = phase.startsWith('night')

  // Auto-trigger AI speeches while the current speaker is an AI player.
  useEffect(() => {
    if (phase === 'day_discuss' && !aiThinking) {
      const alivePlayers = state.players.filter((p) => p.isAlive)
      const currentSpeaker =
        alivePlayers.length > 0 ? alivePlayers[state.currentSpeakerIndex % alivePlayers.length] : null
      const spokenIds = new Set(
        state.speeches.filter((s) => s.round === state.round).map((s) => s.playerId)
      )
      if (!currentSpeaker || currentSpeaker.isHuman || alivePlayers.every((p) => spokenIds.has(p.id))) {
        return
      }
      triggerAiSpeeches(state)
    }
  }, [phase, round, state.currentSpeakerIndex, state.speeches.length, aiThinking]) // eslint-disable-line react-hooks/exhaustive-deps

  // 顺序公投：轮到 AI 时自动投；轮到真人时等待用户输入。
  useEffect(() => {
    if (phase !== 'day_vote' || aiThinking) return
    const voters = state.players.filter((p) => p.isAlive && !(p.role === 'idiot' && p.idiotUsed))
    if (voters.length === 0) return
    const votedIds = new Set(state.votes.filter((v) => v.round === round).map((v) => v.voterId))
    if (voters.every((p) => votedIds.has(p.id))) return
    const currentVoter = voters[state.currentVoterIndex % voters.length]
    if (!currentVoter || currentVoter.isHuman || votedIds.has(currentVoter.id)) return
    triggerAiVotes(state)
  }, [phase, round, state.currentVoterIndex, state.votes.length, aiThinking]) // eslint-disable-line react-hooks/exhaustive-deps

  // 自动触发 AI 被放逐者的遗言
  useEffect(() => {
    if (phase !== 'day_last_words' || !state.pendingLastWords) return
    const dying = players.find((p) => p.id === state.pendingLastWords)
    if (!dying || dying.isHuman) return
    const hasLW = state.speeches.some(
      (s) => s.playerId === dying.id && s.isLastWords && s.round === round
    )
    if (hasLW) return
    triggerAiLastWords(state)
  }, [phase, state.pendingLastWords, state.speeches.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-trigger AI hunter/wolf_king shoot
  useEffect(() => {
    if (phase !== 'hunter_shoot' || !state.pendingHunter) return
    const hunter = players.find((p) => p.id === state.pendingHunter)
    if (!hunter || hunter.isHuman) return
    const timer = setTimeout(() => {
      triggerAiHunterShoot(state)
    }, 1500)
    return () => clearTimeout(timer)
  }, [phase, state.pendingHunter]) // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'game_over') {
    return (
      <div className="bg-gray-900 min-h-screen flex flex-col items-center justify-center p-6">
        <div className="text-5xl mb-4">{winner === 'werewolves' ? '🐺' : '🏡'}</div>
        <h2 className="text-2xl font-bold text-white mb-2">
          {winner === 'werewolves' ? '狼人阵营' : '村民阵营'}获胜！
        </h2>
        <div className="grid grid-cols-3 gap-2 w-full max-w-xs my-6">
          {players.map((p) => (
            <PlayerCard key={p.id} player={p} showRole />
          ))}
        </div>
        <button
          onClick={onReview}
          className="w-full max-w-xs bg-blue-700 hover:bg-blue-600 text-white rounded-xl py-4 font-semibold text-lg"
        >
          查看复盘 📖
        </button>
      </div>
    )
  }

  const isNightPhase = ['night_guard', 'night_werewolf', 'night_wolf_beauty', 'night_seer', 'night_witch'].includes(phase)
  const isDayPhase = ['day_announce', 'day_discuss', 'day_vote', 'day_last_words', 'hunter_shoot'].includes(phase)

  return (
    <div className={`h-[100dvh] flex flex-col overflow-hidden ${isNight ? 'bg-indigo-950' : 'bg-gray-900'}`}>
      <div className="flex-shrink-0">
        <PhaseHeader phase={phase} round={round} />
      </div>

      {/* Player overview bar (collapsed during night) */}
      {!isNightPhase && (
        <div className="px-3 py-2 overflow-x-auto flex-shrink-0">
          <div className="flex gap-2 min-w-max">
            {players.map((p) => (
              <div
                key={p.id}
                className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg ${
                  p.isAlive ? 'bg-gray-800' : 'bg-gray-900 opacity-40'
                }`}
              >
                <span className="text-sm">
                  {p.isRoleRevealed ? ROLE_EMOJIS[p.role] : '🎭'}
                </span>
                <span className="text-xs text-gray-400">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main phase content — fills remaining height; phases scroll internally */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isNightPhase && (
          <NightPhase
            state={state}
            aiThinking={aiThinking}
            onAction={onNightAction}
            onSkip={onSkipNight}
            triggerNightAi={triggerNightAi}
          />
        )}
        {isDayPhase && (
          <DayPhase
            state={state}
            aiThinking={aiThinking}
            onHumanSpeak={onHumanSpeak}
            onFinishDiscussion={onFinishDiscussion}
            onVote={onVote}
            onSubmitVote={onSubmitVote}
            onHunterShoot={onHunterShoot}
            onWhiteWolfKingExplode={onWhiteWolfKingExplode}
            onSubmitLastWords={onSubmitLastWords}
            onProceedLastWords={onProceedLastWords}
          />
        )}
      </div>

      {/* History peek button */}
      <div className="fixed bottom-4 left-4">
        <button
          onClick={() => setShowHistory(true)}
          className="bg-gray-800 border border-gray-600 text-white rounded-full px-4 py-2 text-sm shadow-lg"
        >
          📜 记录
        </button>
      </div>

      {/* Role peek button */}
      {humanPlayer && (
        <div className="fixed bottom-4 right-4">
          <button
            onClick={() => setShowRoleModal(true)}
            className="bg-gray-800 border border-gray-600 text-white rounded-full px-4 py-2 text-sm shadow-lg"
          >
            我的角色 {ROLE_EMOJIS[humanPlayer.role]}
          </button>
        </div>
      )}

      {showHistory && <HistoryModal state={state} onClose={() => setShowHistory(false)} />}

      {/* Role modal */}
      {showRoleModal && humanPlayer && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          onClick={() => setShowRoleModal(false)}
        >
          <div
            className="bg-gray-800 rounded-2xl p-8 text-center mx-4 max-w-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-6xl mb-3">{ROLE_EMOJIS[humanPlayer.role]}</div>
            <h3 className="text-xl font-bold text-white mb-1">
              {ROLE_NAMES[humanPlayer.role]}
            </h3>
            <p
              className={`text-sm mb-4 ${
                isWerewolf(humanPlayer.role) ? 'text-red-400' : 'text-green-400'
              }`}
            >
              {isWerewolf(humanPlayer.role) ? '狼人阵营' : '村民阵营'}
            </p>
            {isWerewolf(humanPlayer.role) && (
              <div className="mb-4 text-sm text-gray-300">
                狼人同伴：
                {players
                  .filter((p) => p.id !== humanPlayer.id && isWerewolf(p.role))
                  .map((p) => p.name)
                  .join('、') || '无'}
              </div>
            )}
            <button
              onClick={() => setShowRoleModal(false)}
              className="bg-gray-700 text-white rounded-xl px-6 py-2 text-sm"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
