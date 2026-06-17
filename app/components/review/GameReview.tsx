'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { isWerewolf, ROLE_EMOJIS, ROLE_NAMES } from '../../lib/roles'
import { buildGameTranscript, getNightActionsForRound } from '../../lib/reviewHelpers'
import type { GameState } from '../../lib/types'

interface Props {
  state: GameState
  onNewGame: () => void
}

export function GameReview({ state, onNewGame }: Props) {
  const [expandedRound, setExpandedRound] = useState<number | null>(1)
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(false)

  const { players, logs, winner, round } = state

  const speechLogs = (r: number) => state.speeches.filter((s) => s.round === r)
  const deathLogs = (r: number) => logs.filter((l) => l.round === r && l.type === 'death')
  const nightDeathLog = (r: number) => logs.find((l) => l.round === r && l.type === 'night_result')

  const winnerTeam = winner === 'werewolves' ? '狼人' : '村民'
  const humanPlayers = players.filter((p) => p.isHuman)

  const runAnalysis = async () => {
    setAnalyzing(true)
    setAnalyzeError(false)
    try {
      const transcript = buildGameTranscript(state)
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          humanNames: humanPlayers.map((p) => p.name).join('、'),
        }),
      })
      if (!resp.ok) throw new Error('failed')
      const data = await resp.json()
      setAnalysis(data.content)
    } catch {
      setAnalyzeError(true)
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="bg-gray-900 min-h-screen p-4">
      {/* Summary */}
      <div className="bg-gray-800 rounded-2xl p-4 mb-6 text-center">
        <div className="text-4xl mb-2">{winner === 'werewolves' ? '🐺' : '🏡'}</div>
        <h2 className="text-xl font-bold text-white mb-1">{winnerTeam}阵营获胜！</h2>
        <p className="text-gray-400 text-sm">共 {round} 轮</p>
      </div>

      {/* Deep analysis */}
      <div className="mb-6">
        <h3 className="text-gray-300 font-semibold mb-3">🎓 教练深度复盘</h3>
        {!analysis && !analyzing && (
          <button
            onClick={runAnalysis}
            className="w-full bg-purple-700 hover:bg-purple-600 text-white rounded-xl py-3 font-semibold"
          >
            分析我的发言和决策 ✨
          </button>
        )}
        {analyzing && (
          <div className="bg-gray-800 rounded-xl p-6 flex flex-col items-center gap-3">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-purple-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
            <p className="text-gray-400 text-sm">教练正在分析整局对战，请稍候...</p>
          </div>
        )}
        {analyzeError && (
          <div className="bg-gray-800 rounded-xl p-4 text-center">
            <p className="text-red-400 text-sm mb-2">分析失败，请检查网络或 API Key</p>
            <button
              onClick={runAnalysis}
              className="text-purple-400 text-sm hover:text-purple-300"
            >
              重试
            </button>
          </div>
        )}
        {analysis && (
          <div className="bg-gray-800 rounded-xl p-4 text-sm text-gray-200 markdown-body">
            <ReactMarkdown
              components={{
                h1: ({ children }) => <h1 className="text-lg font-bold text-purple-300 mt-3 mb-2">{children}</h1>,
                h2: ({ children }) => <h2 className="text-base font-bold text-purple-300 mt-3 mb-1">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-semibold text-purple-200 mt-2 mb-1">{children}</h3>,
                p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
                ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
                strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
              }}
            >
              {analysis}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* All players reveal */}
      <div className="mb-6">
        <h3 className="text-gray-300 font-semibold mb-3">所有玩家身份</h3>
        <div className="grid grid-cols-3 gap-2">
          {players.map((p) => (
            <div
              key={p.id}
              className={`rounded-xl p-3 text-center ${p.isAlive ? 'bg-gray-800' : 'bg-gray-800 opacity-60'}`}
            >
              <div className="text-2xl">{ROLE_EMOJIS[p.role]}</div>
              <div className="text-sm text-white font-medium">{p.name}</div>
              <div className={`text-xs mt-1 ${isWerewolf(p.role) ? 'text-red-400' : 'text-green-400'}`}>
                {ROLE_NAMES[p.role]}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{p.isAlive ? '存活' : '出局'}</div>
              {p.isHuman && <div className="text-xs text-blue-400">（你）</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Round timeline */}
      <div className="mb-6">
        <h3 className="text-gray-300 font-semibold mb-3">游戏过程</h3>
        {Array.from({ length: round }, (_, i) => i + 1).map((r) => {
          const deaths = deathLogs(r)
          const spks = speechLogs(r)
          const nightActions = getNightActionsForRound(state, r)
          const roundVotes = state.votes.filter((v) => v.round === r)
          const nightDeaths = (nightDeathLog(r)?.data.deaths as string[]) || []
          const isExpanded = expandedRound === r

          return (
            <div key={r} className="mb-2">
              <button
                onClick={() => setExpandedRound(isExpanded ? null : r)}
                className="w-full bg-gray-800 rounded-xl px-4 py-3 flex justify-between items-center"
              >
                <span className="text-white font-medium">第 {r} 轮</span>
                <div className="flex items-center gap-2">
                  {(deaths.length > 0 || nightDeaths.length > 0) && (
                    <span className="text-xs text-red-400">
                      {nightDeaths.length + deaths.filter((d) => !d.data.idiotSaved).length} 人出局
                    </span>
                  )}
                  <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="bg-gray-800/50 rounded-b-xl px-4 py-3 border-t border-gray-700">
                  {/* Night actions detail */}
                  <div className="mb-3">
                    <p className="text-indigo-400 text-sm font-medium mb-1">🌙 夜晚行动</p>
                    {nightActions.length === 0 ? (
                      <p className="text-gray-500 text-sm">无特殊行动</p>
                    ) : (
                      <div className="space-y-1">
	                        {nightActions.map((d, i) => (
	                          <div key={i} className="text-sm">
	                            <div className="flex items-start gap-1.5">
	                            <span>{d.icon}</span>
	                            <span>
	                              <span className={d.isWolf ? 'text-red-300' : 'text-gray-300'}>
	                                {d.roleName}（{d.actorName}）
	                              </span>
	                              <span className="text-gray-400">：{d.description}</span>
	                            </span>
	                            </div>
	                            {d.reason && <div className="text-xs text-gray-500 ml-6">理由：{d.reason}</div>}
	                            {d.llmPrompt && (
	                              <details className="ml-6 mt-1">
	                                <summary className="text-xs text-blue-300 cursor-pointer">LLM 请求</summary>
	                                <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-500 bg-gray-950 rounded p-2 max-h-48 overflow-y-auto">{d.llmPrompt}</pre>
	                                {d.llmResponse && (
	                                  <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-500 bg-gray-950 rounded p-2 max-h-24 overflow-y-auto">返回：{d.llmResponse}</pre>
	                                )}
	                              </details>
	                            )}
	                          </div>
	                        ))}
	                      </div>
                    )}
                    <p className="text-sm mt-1.5">
                      {nightDeaths.length === 0 ? (
                        <span className="text-green-400">→ 平安夜，无人死亡</span>
                      ) : (
                        <span className="text-red-300">
                          → 天亮后 {nightDeaths.map((id) => players.find((p) => p.id === id)?.name).join('、')} 死亡
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Speeches */}
                  {spks.length > 0 && (
                    <div className="mb-3">
                      <p className="text-amber-400 text-sm font-medium mb-1">☀️ 白天发言</p>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
	                        {spks.map((s) => {
	                          const p = players.find((pl) => pl.id === s.playerId)
	                          const prompt = s.llmTrace ? `${s.llmTrace.instruction}\n\n${s.llmTrace.perspective}\n\n${s.llmTrace.task}` : null
	                          return (
	                            <div key={s.id} className="text-sm">
	                              <div>
	                                <span className="text-gray-300 font-medium">
	                                  {p?.name}
	                                  {s.isLastWords && <span className="text-purple-300 text-xs ml-1">[遗言]</span>}
	                                  {p && (
	                                    <span className={`ml-1 text-xs ${isWerewolf(p.role) ? 'text-red-400' : 'text-green-400'}`}>
	                                      [{ROLE_NAMES[p.role]}]
	                                    </span>
	                                  )}
	                                </span>
	                                <span className="text-gray-400 ml-1">：{s.content}</span>
	                              </div>
	                              {prompt && (
	                                <details className="mt-1">
	                                  <summary className="text-xs text-blue-300 cursor-pointer">LLM 请求 / 返回</summary>
	                                  <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-500 bg-gray-950 rounded p-2 max-h-48 overflow-y-auto">{prompt}</pre>
	                                  <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-500 bg-gray-950 rounded p-2 max-h-24 overflow-y-auto">返回：{s.llmTrace?.rawResponse}</pre>
	                                </details>
	                              )}
	                            </div>
	                          )
	                        })}
                      </div>
	                    </div>
	                  )}

	                  {/* Votes */}
	                  {roundVotes.length > 0 && (
	                    <div className="mb-3">
	                      <p className="text-cyan-400 text-sm font-medium mb-1">🗳️ 投票</p>
	                      <div className="space-y-1.5">
	                        {roundVotes.map((v) => {
	                          const voter = players.find((p) => p.id === v.voterId)
	                          const target = players.find((p) => p.id === v.targetId)
	                          const prompt = v.llmTrace ? `${v.llmTrace.instruction}\n\n${v.llmTrace.perspective}\n\n${v.llmTrace.task}` : null
	                          return (
	                            <div key={`${v.round}-${v.voterId}`} className="text-sm">
	                              <div className="text-gray-400">
	                                <span className="text-gray-300">{voter?.name}</span> → <span className="text-gray-300">{target?.name}</span>
	                              </div>
	                              {v.reason && <div className="text-xs text-gray-500">理由：{v.reason}</div>}
	                              {prompt && (
	                                <details className="mt-1">
	                                  <summary className="text-xs text-blue-300 cursor-pointer">LLM 请求 / 返回</summary>
	                                  <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-500 bg-gray-950 rounded p-2 max-h-48 overflow-y-auto">{prompt}</pre>
	                                  <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-500 bg-gray-950 rounded p-2 max-h-24 overflow-y-auto">返回：{v.llmTrace?.rawResponse}</pre>
	                                </details>
	                              )}
	                            </div>
	                          )
	                        })}
	                      </div>
	                    </div>
	                  )}

	                  {/* Deaths by vote */}
                  {deaths.map((log) => {
                    if (log.data.idiotSaved as boolean) {
                      const p = players.find((pl) => pl.id === log.data.playerId)
                      return (
                        <p key={log.id} className="text-yellow-300 text-sm">
                          🃏 {p?.name}（白痴）被投票但免于出局！
                        </p>
                      )
                    }
                    const p = players.find((pl) => pl.id === log.data.playerId)
                    const tally = (log.data.tally as Record<string, number>) || {}
                    return (
                      <div key={log.id}>
                        <p className="text-red-300 text-sm">
                          🗳️ 投票出局：{p?.name}（{p ? ROLE_NAMES[p.role] : ''}）
                        </p>
                        <p className="text-gray-500 text-xs">
                          票数：
                          {Object.entries(tally)
                            .map(([id, cnt]) => {
                              const pl = players.find((pl) => pl.id === id)
                              return `${pl?.name}:${cnt}票`
                            })
                            .join(' ')}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        onClick={onNewGame}
        className="w-full bg-blue-700 hover:bg-blue-600 text-white rounded-xl py-4 font-semibold text-lg"
      >
        再来一局 🎮
      </button>
    </div>
  )
}
