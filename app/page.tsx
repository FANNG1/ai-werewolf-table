'use client'

import { useState } from 'react'
import { PlayerSetup } from './components/setup/PlayerSetup'
import { RoleSetup } from './components/setup/RoleSetup'
import type { AiLevel, GameConfig, Role } from './lib/types'

type SetupStep = 'landing' | 'players' | 'roles'

interface PlayerConfig {
  name: string
  isHuman: boolean
  aiLevel?: AiLevel
}

export default function Home() {
  const [step, setStep] = useState<SetupStep>('landing')
  const [players, setPlayers] = useState<PlayerConfig[]>([])

  const handlePlayersConfirm = (p: PlayerConfig[]) => {
    setPlayers(p)
    setStep('roles')
  }

  const handleRolesConfirm = (roles: Role[]) => {
    const config: GameConfig = { players, roles }
    const encoded = encodeURIComponent(JSON.stringify(config))
    window.location.href = `/game?config=${encoded}`
  }

  if (step === 'landing') {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6">
        <div className="text-center mb-12">
          <div className="text-6xl mb-4">🐺</div>
          <h1 className="text-3xl font-bold text-white mb-2">狼人杀</h1>
          <p className="text-gray-400">与 AI 一起玩经典推理游戏</p>
        </div>

        <div className="w-full max-w-xs space-y-3">
          <button
            onClick={() => setStep('players')}
            className="w-full bg-blue-700 hover:bg-blue-600 text-white rounded-xl py-4 font-bold text-lg"
          >
            开始新游戏
          </button>
        </div>

        <div className="mt-12 text-center text-xs text-gray-600">
          <p>支持角色：狼人 🐺 · 狼王 👑 · 村民 🧑‍🌾</p>
          <p>预言家 🔮 · 女巫 🧙‍♀️ · 猎人 🏹 · 守卫 🛡️ · 白痴 🃏</p>
        </div>
      </div>
    )
  }

  if (step === 'players') {
    return (
      <div className="min-h-screen bg-gray-900">
        <div className="flex items-center gap-3 p-4 border-b border-gray-800">
          <button onClick={() => setStep('landing')} className="text-gray-400 hover:text-white text-xl">
            ←
          </button>
          <h1 className="text-white font-semibold">设置玩家</h1>
        </div>
        <PlayerSetup onConfirm={handlePlayersConfirm} />
      </div>
    )
  }

  if (step === 'roles') {
    return (
      <div className="min-h-screen bg-gray-900">
        <div className="flex items-center gap-3 p-4 border-b border-gray-800">
          <button onClick={() => setStep('players')} className="text-gray-400 hover:text-white text-xl">
            ←
          </button>
          <h1 className="text-white font-semibold">角色配置</h1>
        </div>
        <RoleSetup
          playerCount={players.length}
          onConfirm={handleRolesConfirm}
          onBack={() => setStep('players')}
        />
      </div>
    )
  }

  return null
}
