'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { GameBoard } from '../components/game/GameBoard'
import { GameReview } from '../components/review/GameReview'
import { useGame } from '../hooks/useGame'
import type { GameConfig } from '../lib/types'

function GamePageInner() {
  const searchParams = useSearchParams()
  const { state, aiThinking, startGame, addSpeech, addVote, submitNightAction, skipNightAction,
    finishDiscussion, submitVoteAndProcess, submitHunterShoot, submitWhiteWolfKingExplode, startReview,
    triggerNightAi, triggerAiSpeeches, triggerAiVotes, triggerAiHunterShoot,
    triggerAiLastWords, proceedAfterLastWords, submitHumanLastWords } = useGame()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const raw = searchParams.get('config')
    if (raw && !loaded) {
      try {
        const config: GameConfig = JSON.parse(decodeURIComponent(raw))
        startGame(config)
        setLoaded(true)
      } catch (e) {
        console.error('Failed to parse config', e)
      }
    }
  }, [searchParams, loaded, startGame])

  if (!state) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-center">
          <div className="text-4xl mb-4">🐺</div>
          <p>正在加载游戏...</p>
        </div>
      </div>
    )
  }

  if (state.phase === 'review') {
    return (
      <div className="min-h-screen bg-gray-900">
        <div className="flex items-center gap-3 p-4 border-b border-gray-800">
          <h1 className="text-white font-semibold">游戏复盘</h1>
        </div>
        <GameReview state={state} onNewGame={() => (window.location.href = '/')} />
      </div>
    )
  }

  return (
    <GameBoard
      state={state}
      aiThinking={aiThinking}
      onHumanSpeak={(content) => {
        const human = state.players.find((p) => p.isHuman)
        if (human) addSpeech(human.id, content)
      }}
      onFinishDiscussion={finishDiscussion}
      onVote={(targetId) => {
        const human = state.players.find((p) => p.isHuman)
        if (human) addVote(human.id, targetId)
      }}
      onSubmitVote={submitVoteAndProcess}
      onHunterShoot={submitHunterShoot}
      onWhiteWolfKingExplode={submitWhiteWolfKingExplode}
      triggerAiHunterShoot={triggerAiHunterShoot}
      onNightAction={(targetId, actionType) =>
        submitNightAction(
          state.players.find((p) => p.isHuman)?.id || '',
          targetId,
          actionType as Parameters<typeof submitNightAction>[2]
        )
      }
      onSkipNight={skipNightAction}
      onReview={startReview}
      triggerNightAi={triggerNightAi}
      triggerAiSpeeches={triggerAiSpeeches}
      triggerAiVotes={triggerAiVotes}
      triggerAiLastWords={triggerAiLastWords}
      onSubmitLastWords={submitHumanLastWords}
      onProceedLastWords={proceedAfterLastWords}
    />
  )
}

export default function GamePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
          加载中...
        </div>
      }
    >
      <GamePageInner />
    </Suspense>
  )
}
