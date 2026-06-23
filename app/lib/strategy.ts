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
  // 本轮必须公开亮出的身份（真神职必亮/对跳，或狼队悍跳）——发言后会校验+重试
  mustClaimRole?: Role
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
      mustClaimRole: 'seer',
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
      mustClaimRole: 'seer',
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
      mustClaimRole: 'seer',
      pushTargetId: fakeId,
      talkingGoal: `场上有人（${nameOf(state, fakeId)}）跳了预言家，而你才是真预言家：必须对跳，报出你的全部验人结果${
        goldNames ? `（金水：${goldNames}）` : ''
      }，指出对方验人逻辑/站边的漏洞，把对方当成狼来推。`,
      reason: '遭遇对跳，真预言家必须对跳自证',
    }
  }

  // 4) 只有金水（还没查到狼、无人对跳）→ 也要起跳报金水建立好人链
  // 真人局里预言家验到金水照样会跳：早跳能立金水、带队，并抢在狼悍跳之前占住预言家位。
  if (golds.length > 0) {
    return {
      ...base,
      shouldClaim: true,
      claimUrgency: 'strong',
      revealPrivateInfo: true,
      mustClaimRole: 'seer',
      pushTargetId: null,
      talkingGoal: `你已验人但还没查到狼。真人局里预言家验到金水也会起跳——本轮请明确起跳预言家、公开你的金水（${goldNames}），把金水立成可信好人并带队找狼；同时提醒大家场上很可能有狼悍跳预言家，注意分辨真假对跳。`,
      reason: '仅金水也起跳报金水、抢占预言家位（贴合真人节奏，防狼悍跳）',
    }
  }

  // 5) 兜底：还没有任何验人结果（理论上白天不会发生）→ 暂不暴露
  return {
    ...base,
    shouldClaim: false,
    claimUrgency: 'hide',
    revealPrivateInfo: false,
    pushTargetId: null,
    talkingGoal: `你暂时还没有验人结果，本轮先做逻辑分析、表达怀疑倾向，不要暴露身份。`,
    reason: '暂无验人结果，先不起跳',
  }
}

// 狼人：分工(悍跳/深水/倒钩)由夜间 wolfPlan 的 talkingPointsByWolfId 覆盖；
// 策略层只在「计划没法预知的白天硬情况」上加强制导向，避免与 wolfPlan 重复指令。
function computeWerewolfStrategy(player: Player, state: GameState): PlayerRoundStrategy | null {
  const base = { role: player.role }
  const plan = state.wolfPlan && state.wolfPlanRound === state.round ? state.wolfPlan : null
  const wolfIds = new Set(state.players.filter((p) => isWerewolf(p.role)).map((p) => p.id))
  const realSeerClaim = state.publicClaims.find((c) => c.claimType === 'seer' && c.result === 'werewolf' && !!c.targetId && !wolfIds.has(c.claimantId))

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
      mustClaimRole: isFakeClaimer ? 'seer' : undefined,
      claimUrgency: 'must',
      revealPrivateInfo: isFakeClaimer,
      pushTargetId: isFakeClaimer ? plan?.pushTargetId ?? null : null,
      talkingGoal: isFakeClaimer
        ? `你被对方"预言家"查杀，而你正是狼队安排的悍跳预言家：直接对跳，报出你的"查验结果"（把${pushName ?? '一名好人'}报成查杀），坚称对方才是悍跳的狼，争夺预言家信任。${player.role === 'white_wolf_king' ? '你是白狼王，如果本轮对跳明显崩盘，后续应考虑自爆带走真预言家或强神。' : ''}`
        : player.role === 'white_wolf_king'
          ? `你是白狼王且被"预言家"查杀。先强势反咬对方是悍跳狼、争取白天话语权；如果场上明显站不住，准备自爆带走这个预言家或其他强神止损。`
          : `你被"预言家"查杀了，绝不能沉默装没事：强势回应——质疑对方验人逻辑与动机、反咬他是悍跳的狼，给出你不是狼的合理解释，把火引向别处。`,
      reason: '被预言家查杀，必须强势回应',
    }
  }

  // 2) 白狼王在计划未指定时，也适合作为主动悍跳/冲锋位
  if (player.role === 'white_wolf_king' && !plan?.fakeClaimWolfId && realSeerClaim && realSeerClaim.claimantId !== player.id) {
    const targetId = plan?.pushTargetId ?? realSeerClaim.claimantId
    const targetName = nameOf(state, targetId)
    return {
      ...base,
      shouldClaim: true,
      mustClaimRole: 'seer',
      claimUrgency: 'must',
      revealPrivateInfo: true,
      pushTargetId: targetId,
      talkingGoal: '你是白狼王，适合承担冲锋悍跳位。场上已有预言家信息威胁狼队：主动悍跳预言家，报' + targetName + '为查杀或强狼面，和对方抢预言家身份；如果后续悍跳失败，再考虑自爆带走真预言家/强神。',
      reason: '白狼王主动承担悍跳冲锋位',
    }
  }

  // 3) 狼美人默认深水，不抢悍跳；被迫悍跳时才执行计划
  if (player.role === 'wolf_beauty' && plan?.fakeClaimWolfId !== player.id) {
    const charm = [...state.nightActions].reverse().find((a) => a.actorId === player.id && a.actionType === 'charm' && a.targetId)
    const charmName = charm?.targetId ? nameOf(state, charm.targetId) : null
    const pushPart = pushName ? '（' + pushName + '）' : ''
    const charmPart = charmName ? '你昨晚魅惑了' + charmName + '，不要暴露这点；若你可能出局，白天尽量把焦点转向别人，让殉情收益留到关键时刻。' : ''
    return {
      ...base,
      shouldClaim: false,
      claimUrgency: 'hide',
      revealPrivateInfo: false,
      pushTargetId: plan?.pushTargetId ?? null,
      talkingGoal: '你是狼美人，本轮默认深水隐藏：不要悍跳、不要强冲在最前面，用谨慎好人视角分析；可以轻踩狼队主推目标' + pushPart + '，但重点是降低自己的处理优先级。' + charmPart,
      reason: '狼美人默认深水隐藏',
    }
  }
  // 4) 计划指定我悍跳预言家 → 强制真的跳出来
  if (isFakeClaimer) {
    return {
      ...base,
      shouldClaim: true,
      mustClaimRole: 'seer',
      claimUrgency: 'must',
      revealPrivateInfo: true,
      pushTargetId: plan?.pushTargetId ?? null,
      talkingGoal: `按狼队计划，本轮由你悍跳预言家：明确跳预言家身份，报一个"查杀"结果（首选把${pushName ?? '狼队主推的好人'}报成查杀）立住身份并带头归票他；若有真预言家对跳，咬死对方是狼。`,
      reason: '狼队计划指定悍跳预言家',
    }
  }

  // 5) 狼同伴被「预言家」查杀（我没被查杀）→ 按计划配合
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

  // 6) 深水/倒钩等常规分工 → 交给已注入的 wolfPlan，不重复指令
  return null
}

// 女巫：拍身份风险高（暴露后易被刀），默认隐藏；仅在硬触发时才跳。
// 关键洞察：好人被「查杀」必然是狼悍跳（真预言家验女巫只会出好人），故被查杀=可反指对方悍跳。
function computeWitchStrategy(player: Player, state: GameState): PlayerRoundStrategy {
  const base = { role: 'witch' as const }
  const healUsed = !state.witchPotions.heal
  const poisonUsed = !state.witchPotions.poison
  const potionsLine = `解药${healUsed ? '已用' : '未用'}、毒药${poisonUsed ? '已用' : '未用'}`

  const selfClaimed = state.publicClaims.some((c) => c.claimantId === player.id && c.claimType === 'witch')
  const otherWitchClaims = state.publicClaims.filter((c) => c.claimType === 'witch' && c.claimantId !== player.id)
  // 我毒杀的人是否已翻牌证实为狼（公开硬证据）
  const myPoison = state.nightActions.find((a) => a.actorId === player.id && a.actionType === 'poison')
  const poisonedWolf = myPoison?.targetId
    ? state.players.find((p) => p.id === myPoison.targetId && isWerewolf(p.role) && p.isRoleRevealed) ?? null
    : null
  const myHeals = state.nightActions.filter((a) => a.actorId === player.id && a.actionType === 'heal' && a.targetId)
  const savedNames = myHeals
    .map((a) => state.players.find((p) => p.id === a.targetId)?.name)
    .filter((name): name is string => !!name)
  const savedInfoLine = savedNames.length > 0
    ? `你救过的刀口/银水是【${savedNames.join('、')}】。这属于女巫私密强信息；隐藏身份时不要直接报银水，但应私下提高其可信度，尤其当他起跳预言家或被强推时，不要像闭眼好人一样轻易踩他。`
    : ''
  const killedBySeer = state.publicClaims.some(
    (c) => c.claimType === 'seer' && c.result === 'werewolf' && c.targetId === player.id
  )

  // 1) 已跳 → 守住身份、保持用药信息一致
  if (selfClaimed) {
    return {
      ...base, shouldClaim: true, claimUrgency: 'must', revealPrivateInfo: true, mustClaimRole: 'witch', pushTargetId: null,
      talkingGoal: `你已公开女巫身份，本轮保持一致：清楚说明你的用药情况（${potionsLine}）和由此得到的信息，给出归票建议，不要改口。`,
      reason: '已公开跳女巫，保持一致',
    }
  }
  // 2) 有假女巫 → 必须对跳
  if (otherWitchClaims.length > 0) {
    const fakeId = otherWitchClaims[otherWitchClaims.length - 1].claimantId
    return {
      ...base, shouldClaim: true, claimUrgency: 'must', revealPrivateInfo: true, mustClaimRole: 'witch', pushTargetId: fakeId,
      talkingGoal: `场上有人（${nameOf(state, fakeId)}）跳了女巫，而你才是真女巫：必须对跳，亮出真实用药情况（${potionsLine}）与细节，质疑对方说不清的用药/被救者细节，把对方当狼推。`,
      reason: '遭遇假女巫，必须对跳',
    }
  }
  // 3) 毒杀了已证实的狼 → 强烈倾向跳，用硬证据立信
  if (poisonedWolf) {
    return {
      ...base, shouldClaim: true, claimUrgency: 'strong', revealPrivateInfo: true, pushTargetId: null,
      talkingGoal: `你毒杀的【${poisonedWolf.name}】已翻牌证实是狼，这是你女巫身份的硬证据：建议起跳女巫、公布用药（${potionsLine}），用这条信息建立可信好人阵营、带队找出剩余的狼。`,
      reason: '毒杀已证实的狼，跳出建立可信',
    }
  }
  // 4) 被「查杀」（必为悍跳狼）→ 跳女巫自证并反指
  if (killedBySeer) {
    return {
      ...base, shouldClaim: true, claimUrgency: 'strong', revealPrivateInfo: true, pushTargetId: null,
      talkingGoal: `你被"预言家"查杀，但你其实是女巫——真预言家验女巫只会出好人，所以这个"预言家"几乎必是悍跳的狼：跳出来自证（说明用药情况：${potionsLine}），并反指查杀你的人是狼。`,
      reason: '被查杀必为悍跳狼，跳女巫自证反指',
    }
  }
  // 5) 默认隐藏
  return {
    ...base, shouldClaim: false, claimUrgency: 'hide', revealPrivateInfo: false, pushTargetId: null,
    talkingGoal: `本轮先隐藏女巫身份：只做逻辑分析、表达怀疑，不要暴露你是女巫或用药情况，留到关键时刻再跳。${savedInfoLine ? `\n${savedInfoLine}` : ''}`,
    reason: '局势不急，隐藏女巫',
  }
}

// 猎人：早跳暴露强神不划算；默认像好人、留枪口压力，仅硬触发时拍身份。
function computeHunterStrategy(player: Player, state: GameState): PlayerRoundStrategy {
  const base = { role: 'hunter' as const }
  const selfClaimed = state.publicClaims.some((c) => c.claimantId === player.id && c.claimType === 'hunter')
  const otherHunterClaims = state.publicClaims.filter((c) => c.claimType === 'hunter' && c.claimantId !== player.id)
  const killedBySeer = state.publicClaims.some(
    (c) => c.claimType === 'seer' && c.result === 'werewolf' && c.targetId === player.id
  )

  // 1) 已跳 → 守住身份、维持枪口压力
  if (selfClaimed) {
    return {
      ...base, shouldClaim: true, claimUrgency: 'must', revealPrivateInfo: false, mustClaimRole: 'hunter', pushTargetId: null,
      talkingGoal: `你已公开猎人身份，本轮保持一致：表明立场，用枪口压力威慑你怀疑的狼（放逐你或夜里刀你都会触发开枪），给出明确的归票建议。`,
      reason: '已公开跳猎人，保持一致',
    }
  }
  // 2) 有假猎人 → 必须对跳
  if (otherHunterClaims.length > 0) {
    const fakeId = otherHunterClaims[otherHunterClaims.length - 1].claimantId
    return {
      ...base, shouldClaim: true, claimUrgency: 'must', revealPrivateInfo: false, mustClaimRole: 'hunter', pushTargetId: fakeId,
      talkingGoal: `场上有人（${nameOf(state, fakeId)}）跳了猎人，而你才是真猎人：必须对跳，表明真实身份并施加枪口压力，指出对方是冒充的狼。`,
      reason: '遭遇假猎人，必须对跳',
    }
  }
  // 3) 被「查杀」（必为悍跳狼）→ 拍猎人挡推
  if (killedBySeer) {
    return {
      ...base, shouldClaim: true, claimUrgency: 'strong', revealPrivateInfo: false, pushTargetId: null,
      talkingGoal: `你被"预言家"查杀、面临被放逐，但你是猎人：可以拍出猎人身份挡推（放逐我=触发我开枪带人，对好人不划算），并反指这个"预言家"很可能是悍跳的狼。`,
      reason: '被查杀必为悍跳狼，拍猎人挡推',
    }
  }
  // 4) 默认：像好人，留枪口压力但不乱跳
  return {
    ...base, shouldClaim: false, claimUrgency: 'hide', revealPrivateInfo: false, pushTargetId: null,
    talkingGoal: `本轮像普通好人一样分析发言、票型与站边找狼；不要主动跳猎人身份，但可以在发言里留下"枪口压力"威慑你高度怀疑的人。`,
    reason: '常规局势，隐藏猎人、保留枪口压力',
  }
}

// 村民/白痴：无夜晚信息，靠公开信息推理。给具体任务，避免「先观察」式空话。
function computeVillagerStrategy(player: Player, state: GameState): PlayerRoundStrategy {
  const base = { role: player.role }
  const seerClaims = state.publicClaims.filter(
    (c) => c.claimType === 'seer' && !!c.targetId && (c.result === 'werewolf' || c.result === 'villager')
  )
  const seerClaimantIds = Array.from(new Set(seerClaims.map((c) => c.claimantId)))
  const killClaim = seerClaims.find((c) => c.result === 'werewolf')
  // 自己是否被「查杀」（好人被查杀必是狼悍跳）
  const killedMe = state.publicClaims.some(
    (c) => c.claimType === 'seer' && c.result === 'werewolf' && c.targetId === player.id
  )

  // 1) 自己被查杀 → 表水自证、反指悍跳
  if (killedMe) {
    return {
      ...base, shouldClaim: false, claimUrgency: 'optional', revealPrivateInfo: false, pushTargetId: null,
      talkingGoal: `你被"预言家"查杀了：你只是普通村民，要认真表水自证（说清你的推理、为什么不是狼），并指出这个查杀你的"预言家"很可能是悍跳的狼，呼吁大家别被带偏。`,
      reason: '被查杀，普通村民表水自证、反指悍跳',
    }
  }
  // 2) 预言家对跳（≥2 人跳预言家）→ 必须站边
  if (seerClaimantIds.length >= 2) {
    return {
      ...base, shouldClaim: false, claimUrgency: 'optional', revealPrivateInfo: false, pushTargetId: null,
      talkingGoal: `场上有预言家对跳（${seerClaimantIds.map((id) => nameOf(state, id)).join(' / ')}）：你必须明确站边——比较双方的验人逻辑、发言一致性、票型和站边关系，说清你认为谁是真预言家、为什么；不能含糊说"再看看"。`,
      reason: '预言家对跳，村民必须站边',
    }
  }
  // 3) 单预言家报了查杀 → 讨论可信度并表态
  if (killClaim) {
    return {
      ...base, shouldClaim: false, claimUrgency: 'optional', revealPrivateInfo: false, pushTargetId: null,
      talkingGoal: `${nameOf(state, killClaim.claimantId)}以预言家身份查杀了${nameOf(state, killClaim.targetId)}：你要明确表态——这个预言家可信吗？要不要归票被查杀者？给出你的判断和理由（单预言家也可能是狼悍跳，但不能无理由否定）。`,
      reason: '有查杀，村民需表态是否跟票',
    }
  }
  // 4) 默认：给明确倾向，不要说空话
  return {
    ...base, shouldClaim: false, claimUrgency: 'optional', revealPrivateInfo: false, pushTargetId: null,
    talkingGoal: `你是普通村民、没有夜晚信息。本轮给出一个明确倾向：点名一个你目前最怀疑的人并给出具体理由（发言前后矛盾、票型异常、强行带节奏、和谁抱团），不要只说"信息不多、先观察"这类空话。`,
    reason: '常规局势，村民给明确怀疑倾向',
  }
}

// 入口：按角色分派。已实现预言家/狼人/女巫/猎人/村民/白痴，其余返回 null。
export function computeRoundStrategy(player: Player, state: GameState): PlayerRoundStrategy | null {
  if (player.role === 'seer') return computeSeerStrategy(player, state)
  if (player.role === 'witch') return computeWitchStrategy(player, state)
  if (player.role === 'hunter') return computeHunterStrategy(player, state)
  if (isWerewolf(player.role)) return computeWerewolfStrategy(player, state)
  if (player.role === 'villager' || player.role === 'idiot') return computeVillagerStrategy(player, state)
  return null
}
