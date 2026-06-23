'use client'

import { useState } from 'react'

interface PlayerConfig {
  name: string
  isHuman: boolean
}

interface Props {
  onConfirm: (players: PlayerConfig[]) => void
}

const AI_NAMES = [
  '小明', '小红', '小刚', '小丽', '小强', '小华', '小燕', '小龙', '小芳', '小虎'
]

export function PlayerSetup({ onConfirm }: Props) {
  const [humanPlayers, setHumanPlayers] = useState<{ name: string }[]>([
    { name: '' },
  ])
  const [aiCount, setAiCount] = useState(5)

  const totalCount = humanPlayers.length + aiCount

  const addHuman = () => {
    if (humanPlayers.length < 3) {
      setHumanPlayers([...humanPlayers, { name: '' }])
    }
  }

  const removeHuman = (i: number) => {
    if (humanPlayers.length > 1) {
      setHumanPlayers(humanPlayers.filter((_, idx) => idx !== i))
    }
  }

  const handleConfirm = () => {
    const humans = humanPlayers.map((p, i) => ({
      name: p.name.trim() || `玩家${i + 1}`,
      isHuman: true,
    }))

    const usedNames = new Set(humans.map((h) => h.name))
    const aiNames = AI_NAMES.filter((n) => !usedNames.has(n)).slice(0, aiCount)
    const ais = aiNames.map((name) => ({
      name,
      isHuman: false,
    }))

    onConfirm([...humans, ...ais])
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-white mb-6 text-center">玩家设置</h2>

      {/* Human players */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <label className="text-gray-300 font-medium">真人玩家</label>
          {humanPlayers.length < 3 && (
            <button
              onClick={addHuman}
              className="text-blue-400 text-sm hover:text-blue-300"
            >
              + 添加
            </button>
          )}
        </div>
        {humanPlayers.map((p, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input
              type="text"
              value={p.name}
              onChange={(e) => {
                const updated = [...humanPlayers]
                updated[i] = { name: e.target.value }
                setHumanPlayers(updated)
              }}
              placeholder={`玩家${i + 1}的名字`}
              className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-2 outline-none border border-gray-700 focus:border-blue-500"
            />
            {humanPlayers.length > 1 && (
              <button
                onClick={() => removeHuman(i)}
                className="text-red-400 hover:text-red-300 px-2"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {/* AI player count */}
      <div className="mb-6">
        <label className="text-gray-300 font-medium block mb-3">
          AI 玩家数量：{aiCount} 人
        </label>
        <input
          type="range"
          min={3}
          max={9 - humanPlayers.length}
          value={aiCount}
          onChange={(e) => setAiCount(Number(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>3</span>
          <span className="text-gray-300 font-medium">共 {totalCount} 人</span>
          <span>{9 - humanPlayers.length}</span>
        </div>
      </div>

      {/* 所有 AI 均为资深玩家（困难），不再提供难度选择 */}
      <div className="mb-8 rounded-xl border border-gray-700 bg-gray-800 p-3 text-center text-sm text-gray-400">
        🧠 所有 AI 玩家均为<span className="text-gray-200 font-medium">资深水平</span>，会认真推理与伪装
      </div>

      <button
        onClick={handleConfirm}
        disabled={totalCount < 4}
        className="w-full bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white rounded-xl py-4 font-bold text-lg"
      >
        下一步：选择角色 →
      </button>
    </div>
  )
}
