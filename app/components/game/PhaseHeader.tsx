'use client'

import type { Phase } from '../../lib/types'

const PHASE_LABELS: Record<Phase, string> = {
  setup: '准备中',
  night_guard: '第一夜 · 守卫行动',
  night_werewolf: '深夜 · 狼人行动',
  night_seer: '深夜 · 预言家行动',
  night_witch: '深夜 · 女巫行动',
  day_announce: '天亮了',
  day_discuss: '白天 · 讨论',
  day_vote: '白天 · 投票',
  day_last_words: '遗言',
  hunter_shoot: '猎人/狼王 开枪',
  game_over: '游戏结束',
  review: '复盘',
}

const PHASE_ICONS: Record<string, string> = {
  night: '🌙',
  day: '☀️',
  game_over: '🏁',
  review: '📖',
}

function getIcon(phase: Phase): string {
  if (phase.startsWith('night')) return '🌙'
  if (phase === 'game_over') return '🏁'
  if (phase === 'review') return '📖'
  return '☀️'
}

interface Props {
  phase: Phase
  round: number
}

export function PhaseHeader({ phase, round }: Props) {
  const isNight = phase.startsWith('night')

  return (
    <div
      className={`flex items-center justify-between px-4 py-3 ${
        isNight ? 'bg-indigo-950' : 'bg-amber-950'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl">{getIcon(phase)}</span>
        <div>
          <div className="text-xs text-gray-400">第 {round} 轮</div>
          <div className="text-sm font-semibold text-white">
            {PHASE_LABELS[phase] || phase}
          </div>
        </div>
      </div>
    </div>
  )
}
