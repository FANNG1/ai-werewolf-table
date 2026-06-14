'use client'

import type { Player } from '../../lib/types'
import { ROLE_EMOJIS, ROLE_NAMES } from '../../lib/roles'

interface Props {
  player: Player
  selectable?: boolean
  selected?: boolean
  onClick?: () => void
  showRole?: boolean
  voteCount?: number
  hasVoted?: boolean
}

export function PlayerCard({ player, selectable, selected, onClick, showRole, voteCount, hasVoted }: Props) {
  const isClickable = selectable && player.isAlive

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      className={`
        relative rounded-xl p-3 flex flex-col items-center gap-1 transition-all duration-200
        ${player.isAlive ? 'bg-gray-800' : 'bg-gray-900 opacity-50'}
        ${isClickable ? 'cursor-pointer hover:bg-gray-700' : ''}
        ${selected ? 'ring-2 ring-blue-400 bg-gray-700' : ''}
        ${hasVoted ? 'ring-2 ring-yellow-400' : ''}
      `}
    >
      <div className={`text-2xl ${player.isAlive ? '' : 'grayscale'}`}>
        {showRole || !player.isAlive ? ROLE_EMOJIS[player.role] : '🎭'}
      </div>
      <div className="text-xs font-medium text-center text-gray-200 truncate w-full text-center">
        {player.name}
      </div>
      {(showRole || !player.isAlive) && (
        <div className="text-xs text-yellow-400">{ROLE_NAMES[player.role]}</div>
      )}
      {!player.isAlive && (
        <div className="text-xs text-red-400">已出局</div>
      )}
      {voteCount !== undefined && voteCount > 0 && (
        <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
          {voteCount}
        </div>
      )}
      {player.isHuman && (
        <div className="text-xs text-blue-400">（你）</div>
      )}
    </div>
  )
}
