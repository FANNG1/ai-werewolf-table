'use client'

import { useEffect, useState } from 'react'
import type { Player, Speech } from '../../lib/types'
import { ROLE_EMOJIS, ROLE_NAMES } from '../../lib/roles'

interface Props {
  speech: Speech
  player: Player
  isNew?: boolean
}

export function SpeechBubble({ speech, player, isNew }: Props) {
  const [displayed, setDisplayed] = useState(isNew ? '' : speech.content)

  useEffect(() => {
    if (!isNew) return
    let i = 0
    const timer = setInterval(() => {
      i++
      setDisplayed(speech.content.slice(0, i))
      if (i >= speech.content.length) clearInterval(timer)
    }, 30)
    return () => clearInterval(timer)
  }, [speech.content, isNew])

  return (
    <div className={`flex gap-3 mb-4 ${player.isHuman ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-xl">
        {player.isRoleRevealed ? ROLE_EMOJIS[player.role] : '🎭'}
      </div>
      <div className={`max-w-[75%] ${player.isHuman ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-gray-400">
            {player.name}
            {player.isRoleRevealed && (
              <span className="ml-1 text-yellow-400">
                [{ROLE_NAMES[player.role]}]
              </span>
            )}
          </span>
        </div>
        <div
          className={`px-4 py-2 rounded-2xl text-sm leading-relaxed ${
            player.isHuman
              ? 'bg-blue-600 text-white rounded-tr-sm'
              : 'bg-gray-700 text-gray-100 rounded-tl-sm'
          }`}
        >
          {displayed}
          {isNew && displayed.length < speech.content.length && (
            <span className="animate-pulse">▋</span>
          )}
        </div>
      </div>
    </div>
  )
}
