'use client'

import { useState } from 'react'
import { ROLE_DESCRIPTIONS, ROLE_EMOJIS, ROLE_NAMES, ROLE_PRESETS, ROLE_TEAMS } from '../../lib/roles'
import type { Role } from '../../lib/types'

const ALL_ROLES: Role[] = ['werewolf', 'wolf_king', 'villager', 'seer', 'witch', 'hunter', 'guard', 'idiot']

interface Props {
  playerCount: number
  onConfirm: (roles: Role[]) => void
  onBack: () => void
}

export function RoleSetup({ playerCount, onConfirm, onBack }: Props) {
  const preset = ROLE_PRESETS.find((p) => p.playerCount === playerCount)
  const [counts, setCounts] = useState<Record<Role, number>>(() => {
    const initial: Record<Role, number> = {} as Record<Role, number>
    for (const r of ALL_ROLES) initial[r] = 0
    if (preset) {
      for (const r of preset.roles) initial[r] = (initial[r] || 0) + 1
    }
    return initial
  })

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const remaining = playerCount - total

  const applyPreset = (presetIdx: number) => {
    const p = ROLE_PRESETS[presetIdx]
    const newCounts: Record<Role, number> = {} as Record<Role, number>
    for (const r of ALL_ROLES) newCounts[r] = 0
    for (const r of p.roles) newCounts[r] = (newCounts[r] || 0) + 1
    setCounts(newCounts)
  }

  const adjust = (role: Role, delta: number) => {
    const newVal = (counts[role] || 0) + delta
    if (newVal < 0) return
    if (delta > 0 && remaining <= 0) return
    setCounts({ ...counts, [role]: newVal })
  }

  const buildRoles = (): Role[] => {
    const arr: Role[] = []
    for (const r of ALL_ROLES) {
      for (let i = 0; i < (counts[r] || 0); i++) arr.push(r)
    }
    return arr
  }

  const werewolfCount = (counts.werewolf || 0) + (counts.wolf_king || 0)
  const villagerCount = total - werewolfCount
  const isValid = total === playerCount && werewolfCount >= 1 && villagerCount > werewolfCount

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-white mb-4 text-center">角色配置</h2>

      {/* Presets */}
      <div className="mb-4">
        <p className="text-gray-400 text-sm mb-2">快速套餐</p>
        <div className="flex gap-2 flex-wrap">
          {ROLE_PRESETS.map((p, i) => (
            <button
              key={p.name}
              onClick={() => applyPreset(i)}
              disabled={p.playerCount !== playerCount}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                p.playerCount === playerCount
                  ? 'border-blue-500 text-blue-300 hover:bg-blue-900'
                  : 'border-gray-700 text-gray-600 cursor-not-allowed'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Role list */}
      <div className="space-y-2 mb-4">
        {ALL_ROLES.map((role) => (
          <div
            key={role}
            className="bg-gray-800 rounded-xl px-4 py-3 flex items-center gap-3"
          >
            <span className="text-2xl">{ROLE_EMOJIS[role]}</span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-white text-sm font-medium">{ROLE_NAMES[role]}</span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    ROLE_TEAMS[role] === 'werewolf'
                      ? 'bg-red-900 text-red-300'
                      : 'bg-green-900 text-green-300'
                  }`}
                >
                  {ROLE_TEAMS[role] === 'werewolf' ? '狼人' : '村民'}
                </span>
              </div>
              <p className="text-gray-500 text-xs mt-0.5">{ROLE_DESCRIPTIONS[role]}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => adjust(role, -1)}
                disabled={counts[role] === 0}
                className="w-7 h-7 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-white flex items-center justify-center font-bold"
              >
                −
              </button>
              <span className="w-5 text-center text-white font-semibold text-sm">
                {counts[role] || 0}
              </span>
              <button
                onClick={() => adjust(role, 1)}
                disabled={remaining <= 0}
                className="w-7 h-7 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-white flex items-center justify-center font-bold"
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Status */}
      <div className={`text-center text-sm mb-4 ${remaining === 0 ? 'text-green-400' : 'text-yellow-400'}`}>
        已选 {total}/{playerCount} 人
        {remaining > 0 && `，还需 ${remaining} 个角色`}
        {remaining < 0 && `，超出 ${-remaining} 个`}
      </div>

      {!isValid && total === playerCount && (
        <p className="text-red-400 text-xs text-center mb-2">
          狼人数必须小于好人数，且至少有 1 个狼人
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl py-3"
        >
          返回
        </button>
        <button
          onClick={() => onConfirm(buildRoles())}
          disabled={!isValid}
          className="flex-2 flex-grow bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white rounded-xl py-3 font-semibold"
        >
          开始游戏 →
        </button>
      </div>
    </div>
  )
}
