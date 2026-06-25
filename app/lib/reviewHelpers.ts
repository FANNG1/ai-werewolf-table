import { isCivilian, isDeity, isWerewolf, ROLE_NAMES } from './roles'
import type { GameState, NightAction } from './types'


export function getVictoryReason(state: GameState): string {
  const aliveWolves = state.players.filter((p) => p.isAlive && isWerewolf(p.role))
  const deities = state.players.filter((p) => isDeity(p.role))
  const aliveDeities = deities.filter((p) => p.isAlive)
  const civilians = state.players.filter((p) => isCivilian(p.role))
  const aliveCivilians = civilians.filter((p) => p.isAlive)

  if (state.winner === 'villagers') {
    return aliveWolves.length === 0
      ? '所有狼人都已出局，村民阵营获胜。'
      : '村民阵营获胜。'
  }

  if (state.winner === 'werewolves') {
    if (deities.length > 0 && aliveDeities.length === 0) {
      return `神职已全部出局（屠神）：${deities.map((p) => p.name).join('、')} 都已死亡。`
    }
    if (civilians.length > 0 && aliveCivilians.length === 0) {
      return `平民已全部出局（屠民）：${civilians.map((p) => p.name).join('、')} 都已死亡。`
    }
    return '狼人阵营获胜。'
  }

  return '游戏尚未结束。'
}

export interface NightActionDetail {
  icon: string
  actorName: string
  roleName: string
  description: string
  reason?: string
  llmPrompt?: string
  llmResponse?: string
  isWolf: boolean
}

function nameOf(state: GameState, id: string | null): string {
  if (!id) return '（无）'
  return state.players.find((p) => p.id === id)?.name ?? '未知'
}

function compact(text?: string): string {
  if (!text) return ''
  return text.length > 500 ? `${text.slice(0, 500)}...` : text
}

/** 把某一夜的所有角色行动整理成可读明细 */
export function getNightActionsForRound(state: GameState, round: number): NightActionDetail[] {
  const actions = state.nightActions.filter((a) => a.round === round)
  const details: NightActionDetail[] = []

  // 守卫
  for (const a of actions.filter((x) => x.actionType === 'protect')) {
    const actor = state.players.find((p) => p.id === a.actorId)
    details.push({
      icon: '🛡️',
      actorName: actor?.name ?? '守卫',
      roleName: '守卫',
      description: `守护了 ${nameOf(state, a.targetId)}`,
      reason: a.reason,
      llmPrompt: a.llmTrace ? `${a.llmTrace.instruction}\n\n${a.llmTrace.perspective}\n\n${a.llmTrace.task}` : undefined,
      llmResponse: a.llmTrace?.rawResponse,
      isWolf: false,
    })
  }

  // 狼人（合并显示一次刀）
  const kill = actions.find((x) => x.actionType === 'kill')
  if (kill) {
    const wolves = state.players
      .filter((p) => isWerewolf(p.role))
      .map((p) => p.name)
      .join('、')
    details.push({
      icon: '🐺',
      actorName: wolves || '狼人',
      roleName: '狼人',
      description: `袭击了 ${nameOf(state, kill.targetId)}`,
      reason: kill.reason,
      llmPrompt: kill.llmTrace ? `${kill.llmTrace.instruction}\n\n${kill.llmTrace.perspective}\n\n${kill.llmTrace.task}` : undefined,
      llmResponse: kill.llmTrace?.rawResponse,
      isWolf: true,
    })
  }


  // 狼美人
  for (const a of actions.filter((x) => x.actionType === 'charm')) {
    const actor = state.players.find((p) => p.id === a.actorId)
    details.push({
      icon: '🌹',
      actorName: actor?.name ?? '狼美人',
      roleName: '狼美人',
      description: `魅惑了 ${nameOf(state, a.targetId)}`,
      reason: a.reason,
      llmPrompt: a.llmTrace ? `${a.llmTrace.instruction}\n\n${a.llmTrace.perspective}\n\n${a.llmTrace.task}` : undefined,
      llmResponse: a.llmTrace?.rawResponse,
      isWolf: true,
    })
  }

  // 预言家
  for (const a of actions.filter((x) => x.actionType === 'check')) {
    const actor = state.players.find((p) => p.id === a.actorId)
    const target = state.players.find((p) => p.id === a.targetId)
    const result = target ? (isWerewolf(target.role) ? '狼人 🐺' : '好人 ✅') : '未知'
    details.push({
      icon: '🔮',
      actorName: actor?.name ?? '预言家',
      roleName: '预言家',
      description: `查验了 ${nameOf(state, a.targetId)}，结果是 ${result}`,
      reason: a.reason,
      llmPrompt: a.llmTrace ? `${a.llmTrace.instruction}\n\n${a.llmTrace.perspective}\n\n${a.llmTrace.task}` : undefined,
      llmResponse: a.llmTrace?.rawResponse,
      isWolf: false,
    })
  }

  // 女巫
  for (const a of actions.filter((x) => x.actionType === 'heal')) {
    const actor = state.players.find((p) => p.id === a.actorId)
    details.push({
      icon: '💊',
      actorName: actor?.name ?? '女巫',
      roleName: '女巫',
      description: `使用解药救了 ${nameOf(state, a.targetId)}`,
      reason: a.reason,
      llmPrompt: a.llmTrace ? `${a.llmTrace.instruction}\n\n${a.llmTrace.perspective}\n\n${a.llmTrace.task}` : undefined,
      llmResponse: a.llmTrace?.rawResponse,
      isWolf: false,
    })
  }
  for (const a of actions.filter((x) => x.actionType === 'poison')) {
    const actor = state.players.find((p) => p.id === a.actorId)
    details.push({
      icon: '☠️',
      actorName: actor?.name ?? '女巫',
      roleName: '女巫',
      description: `使用毒药毒杀了 ${nameOf(state, a.targetId)}`,
      reason: a.reason,
      llmPrompt: a.llmTrace ? `${a.llmTrace.instruction}\n\n${a.llmTrace.perspective}\n\n${a.llmTrace.task}` : undefined,
      llmResponse: a.llmTrace?.rawResponse,
      isWolf: false,
    })
  }

  // 猎人/狼王开枪
  for (const a of actions.filter((x) => x.actionType === 'shoot')) {
    const actor = state.players.find((p) => p.id === a.actorId)
    const isWolfRole = actor?.role === 'wolf_king' || actor?.role === 'white_wolf_king'
    details.push({
      icon: '🔫',
      actorName: actor?.name ?? '猎人',
      roleName: isWolfRole ? '狼王' : '猎人',
      description: a.targetId ? `开枪带走了 ${nameOf(state, a.targetId)}` : '选择不开枪',
      reason: a.reason,
      llmPrompt: a.llmTrace ? `${a.llmTrace.instruction}\n\n${a.llmTrace.perspective}\n\n${a.llmTrace.task}` : undefined,
      llmResponse: a.llmTrace?.rawResponse,
      isWolf: !!isWolfRole,
    })
  }

  // 白狼王自爆
  for (const a of actions.filter((x) => x.actionType === 'explode')) {
    const actor = state.players.find((p) => p.id === a.actorId)
    details.push({
      icon: '💥',
      actorName: actor?.name ?? '白狼王',
      roleName: '白狼王',
      description: `自爆带走了 ${nameOf(state, a.targetId)}`,
      reason: a.reason,
      llmPrompt: a.llmTrace ? `${a.llmTrace.instruction}\n\n${a.llmTrace.perspective}\n\n${a.llmTrace.task}` : undefined,
      llmResponse: a.llmTrace?.rawResponse,
      isWolf: true,
    })
  }

  return details
}

/** 构造完整对局文本，供 AI 深度分析使用（含全部隐藏信息） */
export function buildGameTranscript(state: GameState): string {
  const { players, round, winner } = state
  const lines: string[] = []

  lines.push('【对局信息】')
  lines.push(`获胜方：${winner === 'werewolves' ? '狼人阵营' : '村民阵营'}`)
  lines.push(`胜负原因：${getVictoryReason(state)}`)
  lines.push(`总轮数：${round} 轮`)
  lines.push('')

  lines.push('【全部玩家身份】')
  for (const p of players) {
    const tag = p.isHuman ? '（真人玩家）' : '（AI·资深）'
    const team = isWerewolf(p.role) ? '狼人阵营' : '村民阵营'
    lines.push(`- ${p.name}${tag}：${ROLE_NAMES[p.role]}（${team}）${p.isAlive ? '存活' : '出局'}`)
  }
  lines.push('')

  for (let r = 1; r <= round; r++) {
    lines.push(`========== 第 ${r} 轮 ==========`)

    // 夜晚行动
    const night = getNightActionsForRound(state, r)
    lines.push('〔夜晚行动〕')
    if (night.length === 0) {
      lines.push('  无特殊行动')
    } else {
      for (const d of night) {
        lines.push(`  ${d.roleName}（${d.actorName}）：${d.description}`)
        if (d.reason) lines.push(`    理由：${d.reason}`)
        if (d.llmPrompt) lines.push(`    LLM请求摘要：${compact(d.llmPrompt)}`)
      }
    }

    // 夜晚死亡
    const nightLog = state.logs.find((l) => l.round === r && l.type === 'night_result')
    const nightDeaths = (nightLog?.data.deaths as string[]) ?? []
    if (nightDeaths.length > 0) {
      lines.push(`  天亮后发现：${nightDeaths.map((id) => nameOf(state, id)).join('、')} 死亡`)
    } else {
      lines.push('  平安夜，无人死亡')
    }

    // 白天发言
    const speeches = state.speeches.filter((s) => s.round === r)
    if (speeches.length > 0) {
      lines.push('〔白天发言〕')
      for (const s of speeches) {
        lines.push(`  ${nameOf(state, s.playerId)}${s.isLastWords ? '（遗言）' : ''}：${s.content}`)
        if (s.llmTrace) {
          lines.push(`    LLM请求摘要：${compact(`${s.llmTrace.instruction}\n\n${s.llmTrace.perspective}\n\n${s.llmTrace.task}`)}`)
        }
      }
    }

    // 投票
    const votes = state.votes.filter((v) => v.round === r)
    if (votes.length > 0) {
      lines.push('〔投票〕')
      for (const v of votes) {
        lines.push(`  ${nameOf(state, v.voterId)} → ${nameOf(state, v.targetId)}`)
        if (v.reason) lines.push(`    理由：${v.reason}`)
        if (v.llmTrace) {
          lines.push(`    LLM请求摘要：${compact(`${v.llmTrace.instruction}\n\n${v.llmTrace.perspective}\n\n${v.llmTrace.task}`)}`)
        }
      }
    }

    // 出局（列出本轮全部 death 日志，并按 reason 区分；不再只取第一条/一律当投票出局）
    const deathLogs = state.logs.filter((l) => l.round === r && l.type === 'death')
    for (const dl of deathLogs) {
      const name = nameOf(state, dl.data.playerId as string)
      const reason = dl.data.reason as string | undefined
      if (dl.data.idiotSaved) {
        lines.push(`  投票结果：${name}（白痴）现身免死`)
      } else if (reason === 'wolf_beauty_lovers_death') {
        lines.push(`  ${name} 与狼美人殉情出局`)
      } else if (reason === 'white_wolf_king_explode') {
        lines.push(`  ${name}（白狼王）自爆`)
      } else if (reason === 'white_wolf_king_explode_victim') {
        lines.push(`  ${name} 被白狼王自爆带走`)
      } else {
        lines.push(`  投票出局：${name}`)
      }
    }

    lines.push('')
  }

  return lines.join('\n')
}
