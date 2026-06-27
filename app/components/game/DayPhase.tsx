'use client'

import { useEffect, useRef, useState } from 'react'
import type { GameState } from '../../lib/types'
import { PlayerCard } from './PlayerCard'
import { SpeechBubble } from './SpeechBubble'

interface Props {
  state: GameState
  aiThinking: boolean
  onHumanSpeak: (content: string) => void
  onFinishDiscussion: () => void
  onVote: (targetId: string) => void
  onSubmitVote: () => void
  onHunterShoot: (targetId: string | null) => void
  onWhiteWolfKingExplode: (actorId: string, targetId: string) => void
  onSubmitLastWords: (content: string | null) => void
  onProceedLastWords: () => void
}

export function DayPhase({
  state,
  aiThinking,
  onHumanSpeak,
  onFinishDiscussion,
  onVote,
  onSubmitVote,
  onHunterShoot,
  onWhiteWolfKingExplode,
  onSubmitLastWords,
  onProceedLastWords,
}: Props) {
  const { phase, players, speeches, votes, round, nightDeaths, pendingHunter, pendingLastWords, pendingLastWordsSource } = state
  const [humanSpeech, setHumanSpeech] = useState('')
  const [humanLastWords, setHumanLastWords] = useState('')
  const [humanShootTarget, setHumanShootTarget] = useState<string | null>(null)
  const [humanVoteTarget, setHumanVoteTarget] = useState<string | null>(null)
  const [explodeTarget, setExplodeTarget] = useState<string | null>(null)
  const speechEndRef = useRef<HTMLDivElement>(null)

  const alivePlayers = players.filter((p) => p.isAlive)
  const humanPlayer = players.find((p) => p.isHuman)
  const roundSpeeches = speeches.filter((s) => s.round === round)
  const roundVotes = votes.filter((v) => v.round === round)
  const currentSpeaker =
    alivePlayers.length > 0 ? alivePlayers[state.currentSpeakerIndex % alivePlayers.length] : null
  const humanHasSpoken = roundSpeeches.some((s) => s.playerId === humanPlayer?.id)
  const allAlivePlayersSpoken = alivePlayers.every((p) =>
    roundSpeeches.some((s) => s.playerId === p.id)
  )
  const humanHasVoted = roundVotes.some((v) => v.voterId === humanPlayer?.id)
  const humanCanSpeak =
    !aiThinking &&
    !!humanPlayer?.isAlive &&
    currentSpeaker?.id === humanPlayer.id &&
    !humanHasSpoken
  const canProceedToVote = !aiThinking && allAlivePlayersSpoken
  const humanCanExplode =
    !aiThinking &&
    !!humanPlayer?.isAlive &&
    humanPlayer?.role === 'white_wolf_king' &&
    phase === 'day_discuss'

  useEffect(() => {
    speechEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [speeches.length])

  // ── 天亮公告 ──────────────────────────────────────────────────
  if (phase === 'day_announce') {
    return (
      <div className="bg-amber-950 min-h-full p-6 flex flex-col items-center justify-center">
        <div className="text-5xl mb-4">☀️</div>
        <h2 className="text-xl font-bold text-amber-200 mb-4">天亮了</h2>
        {nightDeaths.length === 0 ? (
          <p className="text-amber-300 text-center">昨晚是平安夜，没有玩家死亡。</p>
        ) : (
          <div className="text-center">
            <p className="text-amber-300 mb-2">昨晚，以下玩家不幸离世：</p>
            {nightDeaths.map((id) => {
              const p = players.find((pl) => pl.id === id)
              if (!p) return null
              return (
                <div key={id} className="text-red-300 font-semibold text-lg">
                  {p.seatNumber}号 {p.name} 出局（身份保密）
                </div>
              )
            })}
          </div>
        )}
        <button
          onClick={onFinishDiscussion}
          className="mt-8 bg-amber-700 hover:bg-amber-600 text-white rounded-xl px-8 py-3 font-semibold"
        >
          开始讨论 →
        </button>
      </div>
    )
  }

  // ── 遗言 ─────────────────────────────────────────────────────
  if (phase === 'day_last_words') {
    const dying = players.find((p) => p.id === pendingLastWords)
    const isDyingHuman = dying?.isHuman ?? false
    const lwSpeech = speeches.find(
      (s) => s.playerId === dying?.id && s.isLastWords && s.round === round
    )

    return (
      <div className="bg-purple-950 min-h-full p-6 flex flex-col items-center">
        <div className="text-5xl mb-3">🕯️</div>
        <h2 className="text-xl font-bold text-purple-200 mb-1">
          {dying?.seatNumber}号 {dying?.name} 的遗言
        </h2>
        <p className="text-purple-400 text-sm mb-6 text-center">
          {pendingLastWordsSource === 'night'
            ? '昨夜出局，请发表遗言'
            : pendingLastWordsSource === 'shot'
              ? '被开枪带走，请发表遗言'
              : '被放逐出局，请发表最后的发言'}
        </p>

        {isDyingHuman && !lwSpeech ? (
          <div className="w-full max-w-md">
            <textarea
              value={humanLastWords}
              onChange={(e) => setHumanLastWords(e.target.value)}
              placeholder="留下你的遗言（身份、查验/用药信息、怀疑谁、建议归票谁）..."
              rows={4}
              className="w-full bg-gray-800 text-white rounded-xl px-3 py-2 text-sm resize-none outline-none border border-purple-700 focus:border-purple-500 mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => onSubmitLastWords(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-xl py-3 text-sm"
              >
                放弃遗言
              </button>
              <button
                onClick={() => {
                  onSubmitLastWords(humanLastWords.trim() || null)
                  setHumanLastWords('')
                }}
                className="flex-grow bg-purple-700 hover:bg-purple-600 text-white rounded-xl py-3 text-sm font-semibold"
              >
                发表遗言
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-md flex flex-col items-center">
            {lwSpeech ? (
              <div className="w-full bg-purple-900/50 border border-purple-700 rounded-xl p-4 text-purple-100 mb-6 whitespace-pre-wrap">
                {lwSpeech.content}
              </div>
            ) : (
              <div className="text-purple-300 flex items-center gap-2 mb-6">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="w-2 h-2 rounded-full bg-purple-400 animate-bounce"
                      style={{ animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
                <span>正在思考遗言...</span>
              </div>
            )}
            {lwSpeech && (
              <button
                onClick={onProceedLastWords}
                className="w-full bg-purple-700 hover:bg-purple-600 text-white rounded-xl py-3 font-semibold"
              >
                继续 →
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── 猎人/狼王开枪 ────────────────────────────────────────────
  if (phase === 'hunter_shoot') {
    const hunter = players.find((p) => p.id === pendingHunter)
    const isHunterHuman = hunter?.isHuman ?? false

    return (
      <div className="bg-red-950 min-h-full p-6 flex flex-col items-center">
        <div className="text-5xl mb-4">🏹</div>
        <h2 className="text-xl font-bold text-red-200 mb-2">
          {hunter?.seatNumber}号 {hunter?.name} 正在行动
        </h2>
        <p className="text-red-300 text-sm mb-6 text-center">
          猎人/狼王可以开枪带走一名玩家，或选择放弃
        </p>
        {isHunterHuman ? (
          <>
            <div className="grid grid-cols-3 gap-2 w-full mb-4">
              {alivePlayers
                .filter((p) => p.id !== pendingHunter)
                .map((p) => (
                  <PlayerCard
                    key={p.id}
                    player={p}
                    selectable
                    selected={humanShootTarget === p.id}
                    onClick={() => setHumanShootTarget(humanShootTarget === p.id ? null : p.id)}
                  />
                ))}
            </div>
            <div className="flex gap-2 w-full">
              <button
                onClick={() => onHunterShoot(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-xl py-3"
              >
                放弃开枪
              </button>
              <button
                onClick={() => humanShootTarget && onHunterShoot(humanShootTarget)}
                disabled={!humanShootTarget}
                className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white rounded-xl py-3 font-semibold"
              >
                开枪！
              </button>
            </div>
          </>
        ) : (
          <div className="text-red-300 flex flex-col items-center gap-2">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-2 h-2 rounded-full bg-red-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.2}s` }} />
              ))}
            </div>
            <span>AI 正在决定...</span>
          </div>
        )}
      </div>
    )
  }

  // ── 白天讨论 ─────────────────────────────────────────────────
  if (phase === 'day_discuss') {
    return (
      <div className="bg-gray-900 flex flex-col h-full">
        {/* Scrollable speech area */}
        <div className="flex-1 overflow-y-auto p-4 pb-2">
          <h3 className="text-center text-gray-400 text-sm mb-4">
            第 {round} 轮 · 白天讨论
          </h3>

          {roundSpeeches.length === 0 && aiThinking && (
            <p className="text-center text-gray-500 text-sm mt-8">玩家发言中，请稍候...</p>
          )}

          {roundSpeeches.map((s, i) => {
            const p = players.find((pl) => pl.id === s.playerId)!
            return (
              <SpeechBubble
                key={s.id}
                speech={s}
                player={p}
                isNew={i === roundSpeeches.length - 1 && !p.isHuman}
              />
            )
          })}

          {aiThinking && (
            <div className="flex items-center gap-2 text-gray-400 text-sm my-3 px-2">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <span>AI 玩家正在发言...</span>
            </div>
          )}
          <div ref={speechEndRef} />
        </div>

        {/* Sticky bottom area — always visible */}
        <div className="flex-shrink-0 border-t border-gray-700">
          {/* Human input */}
          {humanCanExplode && (
            <div className="p-3 bg-red-950/30 border-b border-red-900">
              <p className="text-xs text-red-300 font-semibold mb-2">💥 白狼王自爆带人（可随时触发）</p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {alivePlayers.filter((p) => p.id !== humanPlayer?.id).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setExplodeTarget(explodeTarget === p.id ? null : p.id)}
                    className={`rounded-lg border px-2 py-2 text-xs ${explodeTarget === p.id ? 'border-red-400 bg-red-900 text-white' : 'border-gray-700 bg-gray-900 text-gray-300'}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  if (humanPlayer && explodeTarget) onWhiteWolfKingExplode(humanPlayer.id, explodeTarget)
                }}
                disabled={!explodeTarget}
                className="w-full rounded-lg bg-red-700 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                自爆并带走 {explodeTarget ? players.find((p) => p.id === explodeTarget)?.name : '...'}
              </button>
            </div>
          )}

          {humanCanSpeak && (
            <div className="p-4 bg-gray-800">
              <p className="text-xs text-blue-400 font-semibold mb-2">💬 轮到你发言了</p>
              <div className="flex gap-2">
                <textarea
                  value={humanSpeech}
                  onChange={(e) => setHumanSpeech(e.target.value)}
                placeholder="发表你的看法..."
                rows={2}
                className="flex-1 bg-gray-700 text-white rounded-xl px-3 py-2 text-sm resize-none outline-none border border-gray-600 focus:border-blue-500"
              />
              <button
                onClick={() => {
                  if (humanSpeech.trim()) {
                    onHumanSpeak(humanSpeech.trim())
                    setHumanSpeech('')
                  }
                }}
                disabled={!humanSpeech.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl px-4 text-sm font-semibold"
              >
                发言
              </button>
            </div>
          </div>
          )}

          {/* AI still thinking — show waiting hint */}
          {aiThinking && humanPlayer?.isAlive && !humanHasSpoken && (
            <div className="p-3 bg-gray-900 text-center text-gray-500 text-xs">
              等待其他玩家发言完毕后轮到你...
            </div>
          )}

          {/* Proceed to vote */}
          {canProceedToVote && humanPlayer?.isAlive && (
            <div className="p-4 bg-gray-900">
              <button
                onClick={onFinishDiscussion}
                className="w-full bg-amber-700 hover:bg-amber-600 text-white rounded-xl py-3 font-semibold"
              >
                进入投票阶段 →
              </button>
            </div>
          )}

          {!humanPlayer?.isAlive && canProceedToVote && (
            <div className="p-4 bg-gray-900">
              <p className="text-gray-500 text-xs text-center mb-2">你已出局，仅可旁观</p>
              <button
                onClick={onFinishDiscussion}
                className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-xl py-3"
              >
                进入投票阶段 →
              </button>
            </div>
          )}
        </div>{/* end sticky bottom */}
      </div>
    )
  }

  // ── 投票阶段 ─────────────────────────────────────────────────
  if (phase === 'day_vote') {
    const tally: Record<string, number> = {}
    for (const v of roundVotes) {
      tally[v.targetId] = (tally[v.targetId] || 0) + 1
    }
    const eligibleVoters = alivePlayers.filter(p => !(p.role === 'idiot' && p.idiotUsed))
    const currentVoter =
      eligibleVoters.length > 0 ? eligibleVoters[state.currentVoterIndex % eligibleVoters.length] : null
    const isHumanTurnToVote =
      !aiThinking &&
      !!humanPlayer?.isAlive &&
      currentVoter?.id === humanPlayer.id &&
      !humanHasVoted &&
      !(humanPlayer.role === 'idiot' && humanPlayer.idiotUsed)
    const allVotesIn = roundVotes.length === eligibleVoters.length

    return (
      <div className="bg-gray-900 min-h-full p-4">
        <h3 className="text-center text-amber-300 font-semibold mb-1">
          投票 · 处决最可疑的玩家
        </h3>
        <p className="text-center text-gray-500 text-xs mb-4">
          已投 {roundVotes.length} / {eligibleVoters.length} 人
        </p>

        <div className="grid grid-cols-3 gap-2 mb-6">
          {alivePlayers.map((p) => (
            <PlayerCard
              key={p.id}
              player={p}
              selectable={isHumanTurnToVote && p.id !== humanPlayer?.id}
              selected={humanVoteTarget === p.id}
              onClick={() => setHumanVoteTarget(humanVoteTarget === p.id ? null : p.id)}
              voteCount={tally[p.id]}
              hasVoted={roundVotes.some((v) => v.voterId === p.id)}
            />
          ))}
        </div>

        {/* 已投票明细：谁投了谁（顺序公投，逐张出现）*/}
        {roundVotes.length > 0 && (
          <div className="mb-4 bg-gray-800 rounded-xl p-3">
            <p className="text-xs text-gray-400 mb-2">投票情况</p>
            <div className="space-y-1">
              {roundVotes.map((v) => {
                const voter = players.find((p) => p.id === v.voterId)
                const target = players.find((p) => p.id === v.targetId)
                return (
                  <div key={v.voterId} className="text-sm text-gray-300 flex items-center gap-1">
                    <span className={voter?.isHuman ? 'text-blue-300' : ''}>{voter?.name}</span>
                    <span className="text-gray-500">→</span>
                    <span className="text-red-300">{target?.name}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {isHumanTurnToVote && (
          <button
            onClick={() => {
              if (humanVoteTarget) onVote(humanVoteTarget)
            }}
            disabled={!humanVoteTarget}
            className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white rounded-xl py-3 font-semibold mb-2"
          >
            投票给 {humanVoteTarget ? players.find(p => p.id === humanVoteTarget)?.name : '...'}
          </button>
        )}

        {!isHumanTurnToVote && !allVotesIn && !aiThinking && (
          <div className="text-center text-gray-500 text-xs py-2">
            等待 {currentVoter?.name ?? '其他玩家'} 投票...
          </div>
        )}

        {aiThinking && (
          <div className="flex items-center justify-center gap-2 text-gray-400 text-sm py-2">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
            <span>AI 玩家正在思考投票...</span>
          </div>
        )}

        {/* 公布结果：人类已投（或无需投票）且 AI 投票完成 */}
        {allVotesIn && !aiThinking && (
          <button
            onClick={onSubmitVote}
            className="w-full bg-red-900 hover:bg-red-800 text-white rounded-xl py-3 font-semibold mt-2"
          >
            公布投票结果 →
          </button>
        )}
      </div>
    )
  }

  return null
}
