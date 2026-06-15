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
  // 本轮必须公开跳预言家（真预言家必跳，或狼队安排的悍跳）——发言后会校验+重试
  mustClaimSeer?: boolean
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
  // 是否有别人带验人结果跳了预言家（对跳局）。
  // 只认带 target/result 的硬声明，避免把“我觉得某人像预言家”这类分析误判为悍跳。
  const singleSeerGame = state.players.filter((p) => p.role === 'seer').length === 1
  const otherSeerClaims = state.publicClaims.filter(
    (c) =>
      c.claimType === 'seer' &&
      c.claimantId !== player.id &&
      !!c.targetId &&
      (c.result === 'werewolf' || c.result === 'villager')
  )

  // 1) 已经跳过 → 守住身份、保持验人一致（跨轮承诺）
  if (selfClaimed) {
    return {
      ...base,
      shouldClaim: true,
      claimUrgency: 'must',
      revealPrivateInfo: true,
      mustClaimSeer: true,
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
      mustClaimSeer: true,
      pushTargetId: pushKill,
      talkingGoal: `你查到了狼人，本轮必须立刻起跳预言家：公开全部验人结果，重点报查杀【${reportName}】${
        liveKill ? '并带头归票他' : '（他虽已出局，但仍能证明你的预言家身份可信）'
      }${otherSeer ? '；如果场上有人也跳了预言家，明确对跳并揭穿对方逻辑漏洞' : ''}。`,
      reason: otherSeer ? '有查杀且遭遇对跳，必跳对跳' : '查到狼人，必跳报查杀',
    }
  }

  // 3) 单预言家板子里有人带验人跳预言家而你没查杀 → 你是被冒充的真预言家，必须对跳
  if (singleSeerGame && otherSeerClaims.length > 0) {
    const fakeId = otherSeerClaims[otherSeerClaims.length - 1].claimantId
    return {
      ...base,
      shouldClaim: true,
      claimUrgency: 'must',
      revealPrivateInfo: true,
      mustClaimSeer: true,
      pushTargetId: fakeId,
      talkingGoal: `场上有人（${nameOf(state, fakeId)}）跳了预言家，而你才是真预言家：必须对跳，报出你的全部验人结果${
        goldNames ? `（金水：${goldNames}）` : ''
      }，指出对方验人逻辑/站边的漏洞，把对方当成狼来推。`,
      reason: '遭遇对跳，真预言家必须对跳自证',
    }
  }

  // 4) 中期且已验多晚、只有金水 → 强烈倾向起跳建立信息
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

  // 5) 仅金水、无人跳、前期 → 隐藏
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

// 狼人：分工(悍跳/深水/倒钩)由夜间 wolfPlan 的 talkingPointsByWolfId 覆盖；
// 策略层只在「计划没法预知的白天硬情况」上加强制导向，避免与 wolfPlan 重复指令。
function computeWerewolfStrategy(player: Player, state: GameState): PlayerRoundStrategy | null {
  const base = { role: player.role }
  const plan = state.wolfPlan && state.wolfPlanRound === state.round ? state.wolfPlan : null
  const wolfIds = new Set(state.players.filter((p) => isWerewolf(p.role)).map((p) => p.id))

  // 由「非狼」的预言家声明发出的查杀（真预言家或与本狼队无关的悍跳者）
  const seerKillClaims = state.publicClaims.filter(
    (c) => c.claimType === 'seer' && c.result === 'werewolf' && !!c.targetId && !wolfIds.has(c.claimantId)
  )
  const meKilled = seerKillClaims.some((c) => c.targetId === player.id)
  const teammateKill = seerKillClaims.find(
    (c) => c.targetId && wolfIds.has(c.targetId) && c.targetId !== player.id
  )

  const isFakeClaimer = plan?.fakeClaimWolfId === player.id
  const pushName = plan?.pushTargetId ? nameOf(state, plan.pushTargetId) : null

  // 1) 我被「预言家」查杀 → 必须强势回应（沉默=坐实）
  if (meKilled) {
    return {
      ...base,
      shouldClaim: isFakeClaimer,
      mustClaimSeer: isFakeClaimer,
      claimUrgency: 'must',
      revealPrivateInfo: isFakeClaimer,
      pushTargetId: isFakeClaimer ? plan?.pushTargetId ?? null : null,
      talkingGoal: isFakeClaimer
        ? `你被对方"预言家"查杀，而你正是狼队安排的悍跳预言家：直接对跳，报出你的"查验结果"（把${pushName ?? '一名好人'}报成查杀），坚称对方才是悍跳的狼，争夺预言家信任。`
        : `你被"预言家"查杀了，绝不能沉默装没事：强势回应——质疑对方验人逻辑与动机、反咬他是悍跳的狼，给出你不是狼的合理解释，把火引向别处。`,
      reason: '被预言家查杀，必须强势回应',
    }
  }

  // 2) 计划指定我悍跳预言家 → 强制真的跳出来
  if (isFakeClaimer) {
    return {
      ...base,
      shouldClaim: true,
      mustClaimSeer: true,
      claimUrgency: 'must',
      revealPrivateInfo: true,
      pushTargetId: plan?.pushTargetId ?? null,
      talkingGoal: `按狼队计划，本轮由你悍跳预言家：明确跳预言家身份，报一个"查杀"结果（首选把${pushName ?? '狼队主推的好人'}报成查杀）立住身份并带头归票他；若有真预言家对跳，咬死对方是狼。`,
      reason: '狼队计划指定悍跳预言家',
    }
  }

  // 3) 狼同伴被「预言家」查杀（我没被查杀）→ 按计划配合
  if (teammateKill) {
    const mateName = nameOf(state, teammateKill.targetId)
    const seerName = nameOf(state, teammateKill.claimantId)
    const dumpMate = plan?.busWolfId === teammateKill.targetId
    return {
      ...base,
      shouldClaim: false,
      claimUrgency: 'must',
      revealPrivateInfo: false,
      pushTargetId: dumpMate ? null : teammateKill.claimantId,
      talkingGoal: dumpMate
        ? `你的同伴${mateName}被"预言家"${seerName}查杀。按计划弃车保帅：不要硬保${mateName}，顺势显得客观，重点保住你自己的好人身份。`
        : `你的同伴${mateName}被"预言家"${seerName}查杀。不要硬保（会暴露），而是从逻辑上质疑${seerName}这个预言家的可信度（验人动机、站边、发言矛盾），把水搅浑、削弱这条查杀的杀伤力。`,
      reason: '狼同伴被查杀，按计划配合应对',
    }
  }

  // 4) 深水/倒钩等常规分工 → 交给已注入的 wolfPlan，不重复指令
  return null
}

// 入口：按角色分派。当前实现预言家与狼人，其余返回 null。
export function computeRoundStrategy(player: Player, state: GameState): PlayerRoundStrategy | null {
  if (player.role === 'seer') return computeSeerStrategy(player, state)
  if (isWerewolf(player.role)) return computeWerewolfStrategy(player, state)
  return null
}
