import { isWerewolf } from './roles'
import type { GameState, Player, Role } from './types'

// 回合前策略：硬规则（纯函数、零 LLM）先定下本轮该承担的任务，
// 再把 talkingGoal 注入发言 prompt，让 AI「带着明确目标发言」而非自由发挥。
// 当前仅实现预言家；其余角色返回 null（后续逐角色铺开）。
export interface PlayerRoundStrategy {
  role: Role
  shouldClaim: boolean
  claimUrgency: 'must' | 'strong' | 'optional' | 'hide'
  revealPrivateInfo: boolean
  pushTargetId?: string | null
  talkingGoal: string
  reason: string
}

interface SeerCheck {
  targetId: string
  targetName: string
  isWolf: boolean
}

function seerChecks(player: Player, state: GameState): SeerCheck[] {
  return state.nightActions
    .filter((a) => a.actorId === player.id && a.actionType === 'check' && a.targetId)
    .map((a) => {
      const t = state.players.find((p) => p.id === a.targetId)
      return t ? { targetId: t.id, targetName: t.name, isWolf: isWerewolf(t.role) } : null
    })
    .filter((c): c is SeerCheck => c !== null)
}

function nameOf(state: GameState, id?: string | null): string {
  return id ? state.players.find((p) => p.id === id)?.name ?? '某玩家' : '某玩家'
}

function computeSeerStrategy(player: Player, state: GameState): PlayerRoundStrategy {
  const base = { role: 'seer' as const }
  const checks = seerChecks(player, state)
  const kills = checks.filter((c) => c.isWolf) // 查杀
  const golds = checks.filter((c) => !c.isWolf) // 金水
  const goldNames = golds.map((g) => g.targetName).join('、')
  const liveKill =
    kills.find((c) => state.players.find((p) => p.id === c.targetId)?.isAlive) ?? null
  const pushKill = liveKill?.targetId ?? null

  // 本局是否已公开跳过预言家
  const selfClaimed = state.publicClaims.some(
    (c) => c.claimantId === player.id && c.claimType === 'seer'
  )
  // 是否有别人跳了预言家（对跳局）
  const otherSeerClaims = state.publicClaims.filter(
    (c) => c.claimType === 'seer' && c.claimantId !== player.id
  )
  // 当前轮针对自己的票数（讨论阶段通常为 0，投票阶段才有意义）
  const votesOnSelf = state.votes.filter(
    (v) => v.round === state.round && v.targetId === player.id
  ).length

  // 1) 已经跳过 → 守住身份、保持验人一致（跨轮承诺）
  if (selfClaimed) {
    return {
      ...base,
      shouldClaim: true,
      claimUrgency: 'must',
      revealPrivateInfo: true,
      pushTargetId: pushKill,
      talkingGoal: `你已经公开了预言家身份，本轮必须保持一致：复述并更新你的验人结果${
        liveKill ? `，继续带头归票查杀【${liveKill.targetName}】` : '，给出今天明确的归票建议'
      }，绝不能改口、回避或弱化自己的预言家身份。`,
      reason: '本局已公开跳预言家，需保持身份与验人一致',
    }
  }

  // 2) 有查杀 → 必跳报查杀
  if (kills.length > 0) {
    const reportName = (liveKill ?? kills[kills.length - 1]).targetName
    const otherSeer = otherSeerClaims.length > 0
    return {
      ...base,
      shouldClaim: true,
      claimUrgency: 'must',
      revealPrivateInfo: true,
      pushTargetId: pushKill,
      talkingGoal: `你查到了狼人，本轮必须立刻起跳预言家：公开全部验人结果，重点报查杀【${reportName}】${
        liveKill ? '并带头归票他' : '（他虽已出局，但仍能证明你的预言家身份可信）'
      }${otherSeer ? '；如果场上有人也跳了预言家，明确对跳并揭穿对方逻辑漏洞' : ''}。`,
      reason: otherSeer ? '有查杀且遭遇对跳，必跳对跳' : '查到狼人，必跳报查杀',
    }
  }

  // 3) 有人跳预言家而你没查杀 → 你是被冒充的真预言家，必须对跳
  if (otherSeerClaims.length > 0) {
    const fakeId = otherSeerClaims[otherSeerClaims.length - 1].claimantId
    return {
      ...base,
      shouldClaim: true,
      claimUrgency: 'must',
      revealPrivateInfo: true,
      pushTargetId: fakeId,
      talkingGoal: `场上有人（${nameOf(state, fakeId)}）跳了预言家，而你才是真预言家：必须对跳，报出你的全部验人结果${
        goldNames ? `（金水：${goldNames}）` : ''
      }，指出对方验人逻辑/站边的漏洞，把对方当成狼来推。`,
      reason: '遭遇对跳，真预言家必须对跳自证',
    }
  }

  // 4) 高票位被集中针对 → 跳出来自救
  if (votesOnSelf >= 2) {
    return {
      ...base,
      shouldClaim: true,
      claimUrgency: 'must',
      revealPrivateInfo: true,
      pushTargetId: pushKill,
      talkingGoal: `你正被集中投票，再不跳就会被错误放逐：起跳预言家、亮出验人结果自证清白，把票引向真正可疑的人。`,
      reason: '处于高票位，需跳预言家自救',
    }
  }

  // 5) 中期且已验多晚、只有金水 → 强烈倾向起跳建立信息
  if (state.round >= 2 && checks.length >= 2) {
    return {
      ...base,
      shouldClaim: true,
      claimUrgency: 'strong',
      revealPrivateInfo: true,
      pushTargetId: null,
      talkingGoal: `已到中期、你已积累多晚验人但还没查到狼：强烈建议本轮起跳预言家，公开金水（${
        goldNames || '暂无'
      }）建立可信好人阵营，带大家缩小狼人范围。`,
      reason: '中期多晚验人，倾向起跳建立信息',
    }
  }

  // 6) 仅金水、无人跳、前期 → 隐藏
  return {
    ...base,
    shouldClaim: false,
    claimUrgency: 'hide',
    revealPrivateInfo: false,
    pushTargetId: null,
    talkingGoal: `本轮先隐藏预言家身份：只做逻辑分析、表达怀疑倾向，绝不要暴露你是预言家或你的验人结果，避免过早被狼人锁定击杀。`,
    reason: '仅金水且无人跳预言家，前期隐藏',
  }
}

// 入口：按角色分派。当前仅预言家有策略，其余返回 null。
export function computeRoundStrategy(player: Player, state: GameState): PlayerRoundStrategy | null {
  if (player.role === 'seer') return computeSeerStrategy(player, state)
  return null
}
