'use client'

import { ROLE_NAMES } from '../../lib/roles'
import type { GameState } from '../../lib/types'

interface Props {
  state: GameState
  onClose: () => void
}

// 游戏进行中可随时翻看的历史记录：按轮次展示夜晚死亡、白天发言、投票与结果。
// 只展示公开信息——未出局玩家的身份不泄露（仅 isRoleRevealed 的玩家显示角色）。
export function HistoryModal({ state, onClose }: Props) {
  const { players, speeches, votes, logs, round } = state
  const nameOf = (id?: string | null) => (id ? players.find((p) => p.id === id)?.name ?? '未知' : '未知')
  const roleTag = (id?: string | null) => {
    const p = id ? players.find((pl) => pl.id === id) : undefined
    return p && p.isRoleRevealed ? `（${ROLE_NAMES[p.role]}）` : ''
  }

  const rounds = Array.from({ length: round }, (_, i) => i + 1)

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-t-2xl mt-auto max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h3 className="text-white font-semibold">📜 历史记录</h3>
          <button onClick={onClose} className="text-gray-400 text-sm bg-gray-800 rounded-full px-3 py-1">
            关闭
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-5">
          {rounds.map((r) => {
            const nightLog = logs.find((l) => l.round === r && l.type === 'night_result')
            const nightDeaths = (nightLog?.data.deaths as string[]) ?? []
            const roundSpeeches = speeches.filter((s) => s.round === r)
            const roundVotes = votes.filter((v) => v.round === r)
            const deathLog = logs.find((l) => l.round === r && l.type === 'death')
            const hasAny =
              nightLog || roundSpeeches.length > 0 || roundVotes.length > 0 || deathLog
            if (!hasAny) return null

            return (
              <div key={r}>
                <div className="text-amber-300 text-sm font-semibold mb-2">第 {r} 轮</div>

                {nightLog && (
                  <p className="text-sm mb-2">
                    🌙{' '}
                    {nightDeaths.length === 0 ? (
                      <span className="text-green-400">平安夜，无人死亡</span>
                    ) : (
                      <span className="text-red-300">
                        {nightDeaths.map((id) => `${nameOf(id)}${roleTag(id)}`).join('、')} 夜晚出局
                      </span>
                    )}
                  </p>
                )}

                {roundSpeeches.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {roundSpeeches.map((s) => {
                      const p = players.find((pl) => pl.id === s.playerId)
                      return (
                        <div key={s.id} className="text-sm">
                          <span className={`font-medium ${p?.isHuman ? 'text-blue-300' : 'text-gray-200'}`}>
                            {p?.name}
                            {s.isLastWords && <span className="text-purple-300 text-xs ml-1">[遗言]</span>}
                          </span>
                          <span className="text-gray-400">：{s.content}</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {roundVotes.length > 0 && (
                  <p className="text-sm text-gray-400 mb-1">
                    🗳️ 投票：
                    {roundVotes.map((v) => `${nameOf(v.voterId)}→${nameOf(v.targetId)}`).join('，')}
                  </p>
                )}

                {deathLog && (
                  <p className="text-sm text-red-300">
                    {deathLog.data.idiotSaved
                      ? `🃏 ${nameOf(deathLog.data.playerId as string)} 被投票但免于出局`
                      : `⚖️ ${nameOf(deathLog.data.playerId as string)}${roleTag(deathLog.data.playerId as string)} 被投票出局`}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
