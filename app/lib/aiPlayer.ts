import type { AiRequestTrace, GameState, Player, Role, WolfCouncilOpinion, WolfPlan } from './types'
import { ROLE_NAMES, isWerewolf } from './roles'
import { computeRoundStrategy } from './strategy'

// 座位号+名字的统一格式，用于 AI prompt 中引用玩家
function seatName(p: Player): string {
  return `${p.seatNumber}号${p.name}`
}

// ───────────────────────── 私有视角构造 ─────────────────────────
// 每个 AI 只能看到：公开信息（发言、死亡公告、投票、出局翻牌）+ 自己角色的私密信息。
// 绝不包含其他玩家的私密信息（别人的身份、别人的夜晚行动）。
export function buildPlayerPerspective(player: Player, state: GameState): string {
  const lines: string[] = []
  const team = isWerewolf(player.role) ? '狼人阵营' : '村民阵营'
  lines.push(`你是玩家「${player.name}」，你的真实身份是${ROLE_NAMES[player.role]}（${team}）。`)

  // —— 你的私密信息（只有你自己知道）——
  const priv: string[] = []
  if (isWerewolf(player.role)) {
    const mates = state.players
      .filter((p) => p.id !== player.id && isWerewolf(p.role))
      .map((p) => `${p.name}${p.isAlive ? '' : '（已出局）'}`)
    priv.push(`你的狼人同伴：${mates.join('、') || '无，你是独狼'}`)
  }
  if (player.role === 'seer') {
    const checks = state.nightActions
      .filter((a) => a.actorId === player.id && a.actionType === 'check')
      .map((a) => {
        const t = state.players.find((p) => p.id === a.targetId)
        return t ? `第${a.round}晚验 ${t.name} = ${isWerewolf(t.role) ? '狼人🐺' : '好人✅'}` : ''
      })
      .filter(Boolean)
    priv.push(`你的查验记录：${checks.length ? checks.join('；') : '暂无'}`)
  }
  if (player.role === 'witch') {
    const killInfos = state.nightActions
      .filter((a) => a.actionType === 'kill' && a.targetId)
      .map((a) => {
        const t = state.players.find((p) => p.id === a.targetId)
        return t ? `第${a.round}晚刀口 ${t.name}` : ''
      })
      .filter(Boolean)
    const heals = state.nightActions
      .filter((a) => a.actorId === player.id && a.actionType === 'heal' && a.targetId)
      .map((a) => {
        const t = state.players.find((p) => p.id === a.targetId)
        return t ? `第${a.round}晚用解药救了 ${t.name}（你的银水/刀口信息）` : ''
      })
      .filter(Boolean)
    const poisons = state.nightActions
      .filter((a) => a.actorId === player.id && a.actionType === 'poison' && a.targetId)
      .map((a) => {
        const t = state.players.find((p) => p.id === a.targetId)
        return t ? `第${a.round}晚用毒药毒了 ${t.name}` : ''
      })
      .filter(Boolean)
    priv.push(
      `你的药剂：解药${state.witchPotions.heal ? '【可用】' : '【已用完】'}，毒药${state.witchPotions.poison ? '【可用】' : '【已用完】'}`
    )
    if (killInfos.length > 0) priv.push(`你看到的狼人刀口：${killInfos.join('；')}`)
    if (heals.length > 0) {
      priv.push(
        `你的救人记录：${heals.join('；')}。这是你的私密强信息；隐藏女巫身份时不要直接报银水，但判断发言/站边时要提高被救者可信度。`
      )
    }
    if (poisons.length > 0) priv.push(`你的毒药记录：${poisons.join('；')}`)
  }
  if (player.role === 'guard') {
    const guards = state.nightActions
      .filter((a) => a.actorId === player.id && a.actionType === 'protect')
      .map((a) => {
        const t = state.players.find((p) => p.id === a.targetId)
        return t ? `第${a.round}晚守护 ${t.name}` : ''
      })
      .filter(Boolean)
    priv.push(`你的守护记录：${guards.length ? guards.join('；') : '暂无'}`)
  }
  if (priv.length) {
    lines.push('')
    lines.push('【你的私密信息（仅你自己知道，不要在发言里直接暴露）】')
    priv.forEach((p) => lines.push('- ' + p))
  }

  // —— 公开局势 ——
  lines.push('')
  lines.push('【当前局势（所有人可见）】')
  // 打乱存活名单顺序：真人固定是 p0、永远排在第一，会让 LLM 因首位偏好而过度针对「玩家1」
  const alive = shuffleCopy(state.players.filter((p) => p.isAlive))
  lines.push(`第${state.round}天。存活玩家：${alive.map((p) => seatName(p)).join('、')}`)
  const dead = state.players.filter((p) => !p.isAlive)
  if (dead.length) {
    // 保密规则：出局者默认不公开身份，只有已翻牌的（白痴/开枪的猎人狼王）才标注角色
    lines.push(
      `已出局：${dead.map((p) => (p.isRoleRevealed ? `${seatName(p)}（${ROLE_NAMES[p.role]}）` : `${seatName(p)}（身份未知）`)).join('、')}`
    )
  }

  const publicSignals = buildPublicSignalSummary(state)
  if (publicSignals.length > 0) {
    lines.push('')
    lines.push('【公开关键信息摘要】')
    publicSignals.forEach((s) => lines.push('- ' + s))
  }
  const publicClaims = state.publicClaims.slice(-16)
  if (publicClaims.length > 0) {
    lines.push('')
    lines.push('【结构化公开声明】')
    publicClaims.forEach((claim) => {
      const claimant = state.players.find((p) => p.id === claim.claimantId)?.name ?? '未知'
      const target = claim.targetId ? state.players.find((p) => p.id === claim.targetId)?.name : null
      let resultText = ''
      if (claim.claimType === 'witch') {
        resultText = claim.witchAction === 'antidote' ? '解药/银水（非验人）'
          : claim.witchAction === 'poison' ? '毒药'
          : target ? '涉及' : ''
      } else {
        resultText = claim.result === 'werewolf' ? '查杀/狼人'
          : claim.result === 'villager' ? '金水/好人'
          : claim.result === 'unknown' ? '未知结果'
          : ''
      }
      lines.push(`- 第${claim.round}天 ${claimant} 声明 ${claim.claimType}${target ? ` -> ${target}` : ''}${resultText ? ` = ${resultText}` : ''}；${claim.summary}`)
    })
  }

  const factHints = buildFactCheckHints(state)
  if (factHints.length > 0) {
    lines.push('')
    lines.push('【客观事实锚点（用于核对其他玩家发言是否与事实矛盾）】')
    factHints.forEach((s) => lines.push('- ' + s))
  }

  const coordSignals = buildCoordinationSignal(state)
  if (coordSignals.length > 0) {
    lines.push('')
    lines.push('【票型相关性（仅供参考的线索，非定狼依据）】')
    coordSignals.forEach((s) => lines.push('- ' + s))
  }

  // —— 历史回顾 ——
  lines.push('')
  lines.push('【历史回顾】')
  let hasHistory = false
  for (let r = 1; r <= state.round; r++) {
    const nl = state.logs.find((l) => l.round === r && l.type === 'night_result')
    if (nl) {
      hasHistory = true
      const deaths = (nl.data.deaths as string[]) || []
      const names = deaths
        .map((id) => state.players.find((p) => p.id === id)?.name)
        .filter(Boolean)
      lines.push(`· 第${r}晚结果：${names.length ? names.join('、') + ' 死亡' : '平安夜，无人死亡'}`)
    }
    // 发言全文保留最近三轮，更早的轮次只提示有过讨论，避免 prompt 过长拖慢
    const sps = state.speeches.filter((s) => s.round === r)
    if (sps.length > 0) {
      hasHistory = true
      if (r >= state.round - 2) {
        sps.forEach((s) => {
          const sp = state.players.find((p) => p.id === s.playerId)
          lines.push(`  〔第${r}天发言〕${sp?.name}：${s.content}`)
        })
      } else {
        lines.push(`  〔第${r}天发言〕（较早轮次，发言略）`)
      }
    }
    const vs = state.votes.filter((v) => v.round === r)
    if (vs.length) {
      hasHistory = true
      const vstr = vs
        .map((v) => {
          const voter = state.players.find((p) => p.id === v.voterId)?.name
          const tgt = state.players.find((p) => p.id === v.targetId)?.name
          return `${voter}→${tgt}`
        })
        .join('，')
      lines.push(`  〔第${r}天投票〕${vstr}`)
    }
    const dl = state.logs.find((l) => l.round === r && l.type === 'death')
    if (dl) {
      hasHistory = true
      const dn = state.players.find((p) => p.id === dl.data.playerId)?.name
      if (dl.data.idiotSaved) lines.push(`  〔第${r}天结果〕${dn}（白痴）现身，免于出局`)
      else lines.push(`  〔第${r}天结果〕${dn} 被投票出局`)
    }
  }
  if (!hasHistory) lines.push('（游戏刚开始，暂无历史）')

  return lines.join('\n')
}

function buildPublicSignalSummary(state: GameState): string[] {
  const keywords = [
    '我是预言家', '预言家', '查杀', '金水', '银水', '验了', '查验',
    '女巫', '猎人', '守卫', '白痴', '站边', '怀疑', '可疑', '投',
  ]
  return state.speeches
    .filter((s) => keywords.some((k) => s.content.includes(k)))
    .slice(-12)
    .map((s) => {
      const p = state.players.find((pl) => pl.id === s.playerId)
      const content = s.content.length > 80 ? `${s.content.slice(0, 80)}...` : s.content
      return `第${s.round}天 ${p?.name ?? '未知'}：${content}`
    })
}

// 把客观可验证事实（每晚死亡、已翻牌身份）整理成列表，注入 prompt 作为事实锚点，
// 让 AI 有具体依据去核对其他玩家发言是否自相矛盾或与事实冲突。
function buildFactCheckHints(state: GameState): string[] {
  const hints: string[] = []
  for (let r = 1; r <= state.round; r++) {
    const nightResult = state.logs.find((l) => l.round === r && l.type === 'night_result')
    if (nightResult) {
      const deaths = (nightResult.data.deaths as string[]) || []
      if (deaths.length === 0) {
        hints.push(`第${r}晚：平安夜，无人夜间死亡`)
      } else {
        const names = deaths.map((id) => {
          const p = state.players.find((q) => q.id === id)
          return p ? seatName(p) : '???'
        })
        hints.push(`第${r}晚：夜间死亡 ${names.join('、')}`)
      }
    }
  }
  const revealed = state.players.filter((p) => !p.isAlive && p.isRoleRevealed)
  if (revealed.length > 0) {
    hints.push(`已翻牌确认身份：${revealed.map((p) => `${seatName(p)}=${ROLE_NAMES[p.role]}`).join('、')}`)
  }
  return hints
}

// 基于公开票型计算「抱团信号」：把 AI 不擅长的跨轮成对归纳替它做掉。
// 找出多轮共同投票、且从未互投的存活玩家对——狼队配合的常见痕迹（但好人共同找狼也会一致，仅供参考）。
function buildCoordinationSignal(state: GameState): string[] {
  const aliveIds = state.players.filter((p) => p.isAlive).map((p) => p.id)
  if (aliveIds.length < 2) return []
  const rounds = Array.from(new Set(state.votes.map((v) => v.round)))
  if (rounds.length < 2) return [] // 至少两轮投票才有「跨轮一致」可言

  // round -> voterId -> targetId
  const byRound: Record<number, Record<string, string>> = {}
  for (const v of state.votes) (byRound[v.round] ||= {})[v.voterId] = v.targetId
  const nameOfId = (id: string) => state.players.find((p) => p.id === id)?.name ?? '未知'

  const pairs: { a: string; b: string; co: number }[] = []
  for (let i = 0; i < aliveIds.length; i++) {
    for (let j = i + 1; j < aliveIds.length; j++) {
      const a = aliveIds[i]
      const b = aliveIds[j]
      let co = 0
      let mutual = 0
      for (const r of rounds) {
        const ta = byRound[r]?.[a]
        const tb = byRound[r]?.[b]
        if (ta && tb && ta === tb) co++
        if (ta === b || tb === a) mutual++
      }
      if (co >= 2 && mutual === 0) pairs.push({ a, b, co })
    }
  }

  return pairs
    .sort((x, y) => y.co - x.co)
    .slice(0, 4)
    .map((p) => `${nameOfId(p.a)} 与 ${nameOfId(p.b)}：共 ${p.co} 轮投了同一目标、且从未互投——留意是否抱团配合`)
}

// ───────────────────────── 角色 / 难度指令 ─────────────────────────
// 所有 AI 均为资深玩家（已去掉难度分级）
function getLevelInstruction(role: Role): string {
  if (isWerewolf(role)) {
    return '你是资深狼人，冷静理性，善于伪装成好人、构造合理的误导、带节奏让好人内斗，并保护狼同伴。'
  }
  return '你是资深好人，高度理性，综合所有发言、死亡和投票信息进行推理；信息充足时给出明确倾向，信息不足时承认不确定，不把推测包装成确定事实。'
}

function getRoleStrategy(role: Role): string {
  switch (role) {
    case 'werewolf':
      return `你的狼人策略：
	- 白天优先伪装成闭眼好人，用公开信息做推理，不要显得知道太多。
	- 根据局势选择倒钩、冲票或轻踩队友；不要无脑保护狼同伴。
	- 如果场上预言家信息威胁狼队，可以质疑其验人逻辑、身份动机或站边关系。
	- 公开发言和遗言都不能泄露真实狼队信息：不要承认“我是狼”，不要说某人是你的狼同伴，不要真心帮好人盘狼坑；即使你已翻牌，也只能假爆料、反向误导或搅乱视角。
	- 狼人胜利条件是屠边：杀光所有神职或所有平民，而不是必须杀光全部好人。`
    case 'wolf_king':
      return `你的狼王策略：
	- 白天按狼人打法伪装，尽量活到关键轮次。
	- 被放逐时可以开枪，优先带走可信预言家、女巫、猎人、守卫，或发言最能带队的好人。
	- 不要随意开枪带走疑似狼同伴。
	- 公开发言和遗言都不能泄露真实狼队信息：不要承认真实狼身份，不要说某人是你的狼同伴，不要真心帮好人盘狼坑。
	- 狼人胜利条件是屠边：杀光所有神职或所有平民。`
    case 'white_wolf_king':
      return `你的白狼王策略：
		- 白天按狼人打法伪装，不要轻易暴露身份。
		- 你可以在白天自爆并带走一名玩家；只有在被查杀、即将被放逐、能带走可信神职/强好人、或自爆能接近屠边时才使用。
		- 自爆目标优先可信预言家、女巫、守卫、猎人或强势带队好人，避免带走狼同伴。
		- 不自爆时继续伪装成好人，制造错误焦点。
		- 公开发言和遗言都不能泄露真实狼队信息。`
    case 'wolf_beauty':
      return `你的狼美人策略：
		- 夜晚魅惑一名非狼人；你死亡时最近被魅惑且仍存活的玩家会殉情。
		- 魅惑目标优先可信神职、强好人、能带队的人，或白天可能推动你出局的人。
		- 白天尽量深水伪装，不要暴露狼美人身份；被怀疑时用好人视角解释。
		- 狼人胜利条件是屠边，魅惑应服务于带走关键神职或强民。`
    case 'seer':
      return `你的预言家策略：
- 查验结果是你的核心信息。发言时要围绕验人结果、发言矛盾和投票行为建立逻辑链。
- 有查杀时通常要积极推动放逐；有金水时可用金水建立可信阵营。
- 起跳身份要看收益：能推出狼人或保护关键信息时可以跳；信息不足时可谨慎隐藏。
- 不要凭空知道未查验玩家身份。`
    case 'witch':
      return `你的女巫策略：
- 解药和毒药都是一次性资源，不确定时不要轻易浪费。
- 首夜救人通常收益较高，但后续要结合被刀者身份、发言强度和场上轮次判断。
- 毒药应优先给高狼面玩家，避免毒死强神或可信好人。
- 发言时可以分析银水、死亡信息和疑点，但不要无必要暴露女巫身份。
- 银水不等于预言家金水：解药救人只说明"第X晚刀口是TA"，不能断言TA是好人，只能说"可信度较高/银水"。
- 不能替狼人补全意图：你知道刀口和自己用药，但不知道狼人为什么刀某人、是否知道你的身份，不能把推测说成事实。
- claims 中被救目标 result 用 unknown，绝不用 villager，避免和预言家金水混淆；witchAction 填 antidote（解药）或 poison（毒药）。`
    case 'hunter':
      return `你的猎人策略：
- 白天主要像好人一样分析发言、票型和站边。
- 被杀或被放逐后开枪要谨慎，优先射击最高狼面玩家；信息不足时可以不开枪。
- 如果你已经明确怀疑某人是狼，可以在发言中留下枪口压力。`
    case 'guard':
      return `你的守卫策略：
- 守护目标应优先考虑疑似预言家、女巫、强势好人或可能被狼人刀的玩家。
- 不能连续两晚守同一个人。
- 发言时不要随意暴露守护记录，除非能帮助好人排坑或证明逻辑。
- 【铁律】如果发言中涉及守护对象，必须与你私密信息里的"守护记录"完全一致，绝对不能捏造或错报守护目标（包括自守）。`
    case 'idiot':
      return `你的白痴策略：
- 第一次被投票出局会免死并公开身份，但之后失去投票权。
- 前期应像普通好人一样找狼，不要过早暴露身份。
- 被强推时可以认真表水，必要时利用身份机制帮好人争取轮次。`
    case 'villager':
      return `你的村民策略：
- 你没有夜晚信息，只能依靠发言、死亡、投票和角色起跳来推理。
- 重点分析谁的逻辑前后矛盾、谁在强行带节奏、谁的票型和发言不一致。
- 不要装作知道隐藏身份。`
  }
}

function getCommonReasoningInstruction(): string {
  return `推理重点：
- 结合死亡信息、发言顺序、投票票型、对跳身份、站边关系和轮次收益。
- 重点识别「抱团/配合」：两个人若反复互相附和、互相洗白、从不互相怀疑、总是一起归票同一个好人，很可能是同一阵营（狼队）；反之互相对踩的两人通常不是同队。可参考上文【票型相关性】线索。
- 但这只是线索之一：好人也会因为共同找狼而投票一致，绝不能仅凭「投票一致/互不怀疑」就咬定是狼，必须结合验人、发言矛盾、身份起跳综合判断。
- 已出局狼人的发言不能按好人逻辑直接采信：他可能故意踩同伴做身份，也可能故意保好人制造反向关系；要结合票型、验人和收益判断。
- 区分“我知道的信息”和“我推测的信息”，不要把推测说成确定事实。
- 发言要像真实玩家：有立场、有理由，可以怀疑但不要机械罗列。
- 只能怀疑、归票、推动放逐当前【存活】玩家。已出局的玩家无法被投票，绝不要提议出局或归票一个已经死亡/出局的人。
- 本局没有「警长 / 警徽流 / 上警 / 警上发言」等机制，绝对不要提及警长、警徽、上警、退水、警下等任何与警长相关的概念。
- 当前采用屠边规则：好人胜利=所有狼人出局；狼人胜利=所有神职出局或所有平民出局。`
}

function getWerewolfCommonSenseInstruction(): string {
  return `狼人杀常识约束（必须遵守）：
- 不要引用不存在的信息：如果当前还没有公开发言/投票，不能说某人发言矛盾、站边、跟票、票型异常。
- 票型含义：票投给谁表示想放逐/怀疑谁；某人票数高表示他正在被抗推，不表示大家支持他。
- 私密信息隔离：只能使用自己身份能知道的信息。狼人知道狼同伴，预言家知道自己验人，女巫知道刀口和药，其他人不知道。
- 好人面对预言家查杀要判断可信度：单预言家也可能是狼悍跳，对跳时要比较发言、验人逻辑和票型。
- 神职被查杀时，自己知道对方是假预言家，可以拍身份挡推；旁观者不能无脑相信拍神。
- 已出局狼人的发言可能是倒钩、做身份或反向误导，不能直接当真。
- 当前游戏没有警长/警徽/上警机制，不要提及警长、警徽流、上警、退水、警下。
- 只能推动放逐当前存活玩家，不能建议投票或归票已出局玩家。
- 发言要像真人玩家：基于公开事实给倾向，不要编造不存在的事实。
- 守卫证伪规则：只有当守卫声称守了某人、但那个人当晚死亡，才能说明守卫是假的。若守卫守了A、死的是B（B≠A），两件事完全不矛盾——狼人可以刀其他人，不能以此推断守卫说谎。
- 半跳预言家更可疑：真预言家通常选择全跳（报出完整验人信息）或深水隐藏，「半跳」（模糊宣称但不给完整信息）更像狼人在试探、蹭对跳压力，不能把半跳当成可信度更高的表现。
- 神职收益原则：有查杀信息的真预言家通常会积极报出来推动局势；以"时机不对、怕被倒钩、再观望几轮"为由拖着不报，更像狼人在试探，不应轻易采信。
- 第1天对跳判断：第1晚双方都只有一次验人记录，无法靠记录数量区分真假；唯一依据是发言逻辑质量——验人选择是否有充分理由、前后是否一致。全票或大多数人同向投票在第1天对跳中是狼队控场的常见特征，好人应质疑而非跟票。`
}

function getInstruction(player: Player): string {
  return `你正在玩中文狼人杀游戏。${getLevelInstruction(player.role)}

游戏规则：
- 好人胜利：所有狼人出局。
- 狼人胜利：屠边，即所有神职出局，或所有平民出局。
- 预言家每晚查验一人的好坏；女巫有1瓶解药和1瓶毒药，各用一次，每晚最多用一瓶；守卫每晚守护一人，不能连续两晚守同一人；猎人/狼王死亡时可开枪带走一人。

	${getRoleStrategy(player.role)}
	
	${getCommonReasoningInstruction()}

${getWerewolfCommonSenseInstruction()}
	
	你只能根据自己掌握的信息（你的私密信息 + 公开的发言/死亡/投票）来推理，不要使用你不可能知道的信息。`
}

// 启发式兜底：找出疑似起跳预言家/报验人的玩家（狼人优先击杀目标）
function findClaimedSeers(state: GameState): string[] {
  const keywords = ['预言家', '查验', '验了', '验人', '我验', '金水', '查杀', '我是预言']
  const ids = new Set<string>()
  for (const s of state.speeches) {
    if (keywords.some((k) => s.content.includes(k))) ids.add(s.playerId)
  }
  return Array.from(ids)
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffleCopy<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ───────────────────────── 通用 AI 调用 ─────────────────────────
async function callAi(
  instruction: string,
  perspective: string,
  task: string,
  json = false,
  maxTokens?: number
): Promise<string> {
  const result = await callAiWithTrace(instruction, perspective, task, json, maxTokens)
  return result.content
}

async function callAiWithTrace(
  instruction: string,
  perspective: string,
  task: string,
  json = false,
  maxTokens?: number
): Promise<{ content: string; trace: AiRequestTrace }> {
  // 超时保护：挂住的请求会被中断并抛错，由各决策函数的 try/catch 落到兜底，避免整局永久卡在 aiThinking。
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    const resp = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction, perspective, task, json, maxTokens }),
      signal: controller.signal,
    })
    if (!resp.ok) throw new Error('AI 调用失败')
    const data = await resp.json()
    const content = (data.content as string) || ''
    return {
      content,
      trace: { instruction, perspective, task, json, maxTokens, rawResponse: content },
    }
  } finally {
    clearTimeout(timer)
  }
}

async function callAiJson(
  instruction: string,
  perspective: string,
  task: string,
  maxTokens?: number
): Promise<Record<string, unknown>> {
  let lastRaw = ''
  for (let i = 0; i < 2; i++) {
    const retryHint = i === 0
      ? ''
      : `\n\n上一次输出不是合法 JSON。请只返回一个 JSON 对象，不要 Markdown，不要解释。上一次输出：${lastRaw.slice(0, 200)}`
    lastRaw = await callAi(instruction, perspective, task + retryHint, true, maxTokens)
    try {
      const parsed = JSON.parse(lastRaw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // retry once
    }
  }
  throw new Error('AI JSON 解析失败')
}

async function callAiJsonWithTrace(
  instruction: string,
  perspective: string,
  task: string,
  maxTokens?: number
): Promise<{ parsed: Record<string, unknown>; trace: AiRequestTrace }> {
  let lastRaw = ''
  for (let i = 0; i < 2; i++) {
    const retryHint = i === 0
      ? ''
      : `\n\n上一次输出不是合法 JSON。请只返回一个 JSON 对象，不要 Markdown，不要解释。上一次输出：${lastRaw.slice(0, 200)}`
    const finalTask = task + retryHint
    const result = await callAiWithTrace(instruction, perspective, finalTask, true, maxTokens)
    lastRaw = result.content
    try {
      const parsed = JSON.parse(lastRaw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { parsed: parsed as Record<string, unknown>, trace: result.trace }
      }
    } catch {
      // retry once
    }
  }
  throw new Error('AI JSON 解析失败')
}

export interface AiTargetDecision {
  targetId: string | null
  reason: string
  llmTrace?: AiRequestTrace
}

function matchPlayerByName(name: string, candidates: Player[]): Player | undefined {
  const n = (name || '').trim()
  if (!n) return undefined

  // 支持 "3号" 或 "3" 这样纯座位号的匹配
  const seatMatch = n.match(/^(\d+)号?$/)
  if (seatMatch) {
    const num = parseInt(seatMatch[1], 10)
    const bySeat = candidates.find((c) => c.seatNumber === num)
    if (bySeat) return bySeat
  }

  const exact = candidates.find((c) => c.name === n)
  if (exact) return exact

  // Prefer longer names first so "玩家10" never gets matched as "玩家1".
  return [...candidates]
    .sort((a, b) => b.name.length - a.name.length)
    .find((c) => n.includes(c.name) || c.name.includes(n))
}

function sanitizeDecisionReason(reason: unknown, state: GameState): string {
  let text = typeof reason === 'string' && reason.trim() ? reason.trim() : 'AI 未给出明确理由'
  const hasPublicSpeech = state.speeches.length > 0
  const hasPublicVote = state.votes.length > 0
  if (!hasPublicSpeech && /(发言矛盾|逻辑矛盾|表水|带节奏|悍跳|对跳|他跳|她跳|有人跳)/.test(text)) {
    return '当前还没有公开发言记录，属于信息不足下的覆盖式选择'
  }
  if (!hasPublicVote && /(票型|跟票|冲票|分票)/.test(text)) {
    return '当前还没有公开票型记录，不能依据票型判断，属于信息不足下的选择'
  }
  if (/(警长|警徽|上警|退水|警下)/.test(text)) {
    text = text.replace(/警长|警徽流|警徽|上警|退水|警下/g, '当前发言与票型')
  }
  for (const dead of state.players.filter((p) => !p.isAlive)) {
    if (text.includes(dead.name) && /(归票|投票|投出|放逐|抗推|推出)/.test(text)) {
      return `不能推动已出局玩家${dead.name}，改为根据当前存活玩家的发言和票型判断`
    }
  }
  return text
}

function sanitizeVoteReason(reason: unknown, state: GameState): string {
  let text = sanitizeDecisionReason(reason, state)
  const roundVotes = state.votes.filter((v) => v.round === state.round)
  if (roundVotes.length === 0) return text

  const tally: Record<string, number> = {}
  for (const v of roundVotes) {
    tally[v.targetId] = (tally[v.targetId] || 0) + 1
  }

  for (const [targetId, count] of Object.entries(tally)) {
    if (count <= 0) continue
    const targetName = state.players.find((p) => p.id === targetId)?.name
    if (!targetName || !text.includes(targetName)) continue
    if (/(站边|支持|保|认好|信任)/.test(text)) {
      text = text.replace(
        new RegExp(`多数玩家(站边|支持|保|认好|信任)${targetName}`, 'g'),
        `多数玩家正在投${targetName}`
      )
      text = text.replace(
        new RegExp(`大家(站边|支持|保|认好|信任)${targetName}`, 'g'),
        `大家正在投${targetName}`
      )
    }
  }
  return text
}

function validateSpeechAgainstStrategy(
  speech: string,
  strategy: ReturnType<typeof computeRoundStrategy>
): string | null {
  if (!strategy || !strategy.mustClaimRole) return null
  const roleWord = ROLE_NAMES[strategy.mustClaimRole]
  if (!speech.includes(roleWord)) {
    return `你必须明确表明自己是${roleWord}（例如“我是${roleWord}”）。`
  }
  // 预言家（含悍跳狼）必须报验人信息
  if (strategy.mustClaimRole === 'seer' && strategy.revealPrivateInfo && !/(验|查验|查杀|金水)/.test(speech)) {
    return '你必须报出验人信息（查杀/金水/查验结果）。'
  }
  if (strategy.pushTargetId) {
    const targetName = strategy.pushTargetId
    if (!speech.includes(targetName)) {
      return `你必须明确提到本轮要推动的目标 ${targetName}。`
    }
  }
  return null
}

function validateCommonSenseText(text: string, state: GameState): string | null {
  const hasPublicSpeech = state.speeches.length > 0
  const hasPublicVote = state.votes.length > 0
  if (!hasPublicSpeech && /(发言矛盾|逻辑矛盾|表水|带节奏|悍跳|对跳|他跳|她跳|有人跳)/.test(text)) {
    return '当前还没有公开发言记录，不能引用发言矛盾、表水、带节奏、悍跳、对跳等不存在的信息。'
  }
  if (!hasPublicVote && /(票型|跟票|冲票|分票)/.test(text)) {
    return '当前还没有公开投票记录，不能引用票型、跟票、冲票、分票等不存在的信息。'
  }
  if (/(警长|警徽|上警|退水|警下)/.test(text)) {
    return '本局没有警长、警徽、上警、退水、警下机制，不能提及这些概念。'
  }
  // 只拦「明确提议把已出局者投出/归票/放逐」的措辞；
  // 分析死者的过往票型、死因、身份是正常推理，不能误杀（否则有效发言会被替换成模板兜底）。
  for (const dead of state.players.filter((p) => !p.isAlive)) {
    const n = dead.name
    const proposesVoteOut =
      text.includes('归票' + n) ||
      text.includes('放逐' + n) ||
      text.includes('投出' + n) ||
      text.includes('票出' + n) ||
      text.includes('推出' + n) ||
      text.includes('带走' + n) ||
      text.includes('把' + n + '投') ||
      text.includes('把' + n + '推') ||
      text.includes('把' + n + '票') ||
      text.includes('把' + n + '放逐')
    if (proposesVoteOut) {
      return `玩家${n}已经出局，不能再提议归票或放逐他（分析他的过往票型/死因可以）。`
    }
  }
  return null
}

function validateWerewolfPublicSpeech(speech: string, player: Player, state: GameState): string | null {
  if (!isWerewolf(player.role)) return null
  if (/(我(确实|就是|是|认).*狼|我是狼人|我是狼王|我被.*炸出来了)/.test(speech)) {
    return '狼人不能在公开发言或遗言里承认真实狼身份；即使已翻牌，也要假爆料、反向误导或搅乱视角。'
  }
  const wolfMateNames = state.players
    .filter((p) => p.id !== player.id && isWerewolf(p.role))
    .map((p) => p.name)
  if (wolfMateNames.some((name) => speech.includes(name) && /(同伴|狼队友|队友|狼同伴)/.test(speech))) {
    return '狼人不能泄露真实狼同伴；可以假装踩人、保人或做反向误导，但不能说某人是你的同伴。'
  }
  if (/(建议好人|帮好人|别让狼人|狼人屠边成功|好人回头盘)/.test(speech)) {
    return '狼人发言目标是服务狼队胜利，不能真心站在好人阵营给好人正确建议；要用好人话术误导。'
  }
  return null
}

function fallbackPublicSpeech(state: GameState, isLastWords = false): string {
  const hasVotes = state.votes.some((v) => v.round === state.round)
  const hasRoundSpeech = state.speeches.some((s) => s.round === state.round)
  const hasPriorSpeech = state.speeches.some((s) => s.round < state.round)

  if (isLastWords) {
    return hasVotes
      ? '我最后留一下视角：这轮票型里有顺势推人的位置，大家回头看谁的理由最薄、谁借我的出局做身份。'
      : '我最后留一下视角：别只看单点结论，重点回头盘谁的怀疑有没有事实依据、谁的立场前后不一致。'
  }

  if (hasVotes) {
    return '我先给个倾向：现在票型已经起来了，但不能只看谁票多，还得看投票理由是否站得住。'
  }

  if (!hasRoundSpeech) {
    return hasPriorSpeech
      ? '我先开个头：结合前面几轮的信息和昨晚死亡情况，这轮重点看谁的立场前后不一致、谁借刀口强行带方向。'
      : '我先开个头：第一轮信息还少，我不急着定死谁，先看后面谁的发言有依据、谁在没有证据时强推人。'
  }

  return '我先给个倾向：现在信息还不多，先看谁的怀疑有事实支撑，谁只是在跟着已有说法下结论。'
}

// ───────────────────────── 发言 ─────────────────────────
// 发言时让 LLM 一并产出「本段发言里公开声明的、关于自己的身份/信息」，
// 由发言者自己声明，避免事后用关键词猜测造成张冠李戴或虚构查杀。
export interface RawClaim {
  claimType: 'seer' | 'witch' | 'hunter' | 'guard' | 'idiot'
  targetName?: string | null
  result?: 'werewolf' | 'villager' | 'unknown' | null
  witchAction?: 'antidote' | 'poison' | null
}

export interface AiSpeechResult {
  content: string
  claims: RawClaim[]
  llmTrace?: AiRequestTrace
}

function sanitizeRawClaims(raw: unknown): RawClaim[] {
  if (!Array.isArray(raw)) return []
  const types = ['seer', 'witch', 'hunter', 'guard', 'idiot']
  const results = ['werewolf', 'villager', 'unknown']
  const out: RawClaim[] = []
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue
    const ct = (c as Record<string, unknown>).claimType
    if (typeof ct !== 'string' || !types.includes(ct)) continue
    const tn = (c as Record<string, unknown>).targetName
    const rs = (c as Record<string, unknown>).result
    const wa = (c as Record<string, unknown>).witchAction
    out.push({
      claimType: ct as RawClaim['claimType'],
      targetName: typeof tn === 'string' && tn.trim() && tn !== 'null' ? tn.trim() : null,
      result: typeof rs === 'string' && results.includes(rs) ? (rs as RawClaim['result']) : null,
      witchAction: typeof wa === 'string' && (wa === 'antidote' || wa === 'poison') ? wa : null,
    })
  }
  return out
}

// 预言家自己的验人结论：金水（确认好人，绝不该投）与存活查杀（应优先投）。
function seerVerified(player: Player, state: GameState): { goodIds: string[]; aliveWolfIds: string[] } {
  if (player.role !== 'seer') return { goodIds: [], aliveWolfIds: [] }
  const goodIds = new Set<string>()
  const aliveWolfIds = new Set<string>()
  for (const a of state.nightActions) {
    if (a.actorId !== player.id || a.actionType !== 'check' || !a.targetId) continue
    const t = state.players.find((p) => p.id === a.targetId)
    if (!t) continue
    if (isWerewolf(t.role)) {
      if (t.isAlive) aliveWolfIds.add(t.id)
    } else {
      goodIds.add(t.id)
    }
  }
  return { goodIds: [...goodIds], aliveWolfIds: [...aliveWolfIds] }
}

// 识别场上"交叉验证好人"：单预言家（无对跳）+ 女巫声称毒了预言家查杀的死者。
// 这些人的身份已被至少两条独立信息线印证，好人不应将票投向他们。
function voteGuardrail(player: Player, state: GameState, candidates: Player[]): { instruction: string; fallbackId?: string } {
  const candidateIds = new Set(candidates.map((c) => c.id))
  const nameOf = (id?: string | null) => { const p = state.players.find((q) => q.id === id); return p ? seatName(p) : '未知' }
  const wolfIds = new Set(state.players.filter((p) => isWerewolf(p.role)).map((p) => p.id))

  // 预言家最高优先级：绝不投自己验过的金水；有存活查杀则优先投。
  if (player.role === 'seer') {
    const { goodIds, aliveWolfIds } = seerVerified(player, state)
    const liveWolfInCands = aliveWolfIds.find((id) => candidateIds.has(id))
    if (goodIds.length > 0 || liveWolfInCands) {
      const goodNames = goodIds.map(nameOf).join('、')
      const wolfNames = aliveWolfIds.filter((id) => candidateIds.has(id)).map(nameOf).join('、')
      return {
        instruction: `你是预言家，依据你自己的验人结果：${
          goodNames ? `你验过【${goodNames}】是金水（确认的好人），绝对不能投他们。` : ''
        }${
          wolfNames ? `你查杀过【${wolfNames}】，本轮应优先把票投给他。` : '你目前没有存活的查杀目标，就投你最怀疑的人，但绝不能投自己的金水。'
        }`,
        fallbackId: liveWolfInCands ?? undefined,
      }
    }
  }

  if (isWerewolf(player.role)) {
    const seerKillClaims = state.publicClaims.filter(
      (c) => c.claimType === 'seer' && c.result === 'werewolf' && !!c.targetId && candidateIds.has(c.claimantId)
    )
    const claimsAgainstMe = seerKillClaims.filter((c) => c.targetId === player.id)
    const nonWolfClaimAgainstMe = claimsAgainstMe.find((c) => !wolfIds.has(c.claimantId))
    const wolfClaimAgainstMe = claimsAgainstMe.find((c) => wolfIds.has(c.claimantId))
    if (nonWolfClaimAgainstMe) {
      return {
        instruction: `硬局势：${nameOf(nonWolfClaimAgainstMe.claimantId)}以预言家身份查杀了你。作为狼人，你投他属于正常自保/冲票；除非已有更好抗推位，否则不要投狼同伴。`,
        fallbackId: nonWolfClaimAgainstMe.claimantId,
      }
    }

    if (wolfClaimAgainstMe) {
      const busMe = state.wolfPlan?.busWolfId === player.id && state.wolfPlanRound === state.round
      return {
        instruction: busMe
          ? `硬局势：狼同伴${nameOf(wolfClaimAgainstMe.claimantId)}悍跳查杀你，这是狼队计划里的倒钩/弃车。你可以表面质疑他，但投票要服务整体计划：优先跟随狼队主推目标，不要无收益地反投同伴。`
          : `硬局势：狼同伴${nameOf(wolfClaimAgainstMe.claimantId)}查杀了你，但当前狼队计划没有安排弃车。不要机械反投同伴；优先把票导向可信好人或狼队主推目标。`,
        fallbackId:
          state.wolfPlan && state.wolfPlanRound === state.round && state.wolfPlan.pushTargetId && candidateIds.has(state.wolfPlan.pushTargetId)
            ? state.wolfPlan.pushTargetId
            : undefined,
      }
    }

    const teammateKilled = seerKillClaims.find((c) => c.targetId && wolfIds.has(c.targetId) && c.targetId !== player.id)
    if (teammateKilled) {
      const busMate = state.wolfPlan?.busWolfId === teammateKilled.targetId && state.wolfPlanRound === state.round
      return {
        instruction: busMate
          ? `硬局势：狼同伴${nameOf(teammateKilled.targetId)}被${nameOf(teammateKilled.claimantId)}查杀，且狼队计划允许弃车。可以跟票同伴做身份，但理由要像好人视角。`
          : `硬局势：狼同伴${nameOf(teammateKilled.targetId)}被${nameOf(teammateKilled.claimantId)}查杀。不要硬保同伴，也不要无脑卖；通常应质疑这个预言家的可信度或转推狼队主推目标。`,
        fallbackId:
          !busMate && candidateIds.has(teammateKilled.claimantId)
            ? teammateKilled.claimantId
            : undefined,
      }
    }
  }

  return { instruction: '' }
}

const CLAIM_INSTRUCTION = `同时，请如实标注你在这段话里【公开声明的、关于你自己的身份或信息】：
- 只有当你确实跳了某身份、或报了验人/用药结果时才填 claims；普通分析、只是怀疑别人、不亮身份时 claims 必须是空数组 []。
- claimType 必须是 seer/witch/hunter/guard/idiot 之一；targetName 是涉及的玩家名或 null；result 是 werewolf/villager/unknown 或 null。
- 女巫专用：witchAction 填 antidote（解药救人）或 poison（毒药毒人），result 固定填 unknown（不填 villager，银水不是验人金水）。
- 例：跳预言家并报查杀小明 → {"claimType":"seer","targetName":"小明","result":"werewolf"}；报金水小红 → result 填 villager。
- 例：跳女巫并报解药救了小明 → {"claimType":"witch","targetName":"小明","result":"unknown","witchAction":"antidote"}。`

export async function generateAiSpeech(player: Player, state: GameState): Promise<AiSpeechResult> {
  const perspective = buildPlayerPerspective(player, state)
  const wolfPlanNote =
    isWerewolf(player.role) && state.wolfPlan && state.wolfPlanRound === state.round
      ? `\n\n【狼队昨晚商定的作战计划（仅狼队知道，作为参考而非死命令）】\n${formatWolfPlanForPlayer(state.wolfPlan, player, state)}\n注意：这是昨晚在不知道天亮结果时预先定的计划。如果天亮后的死亡情况、其他人的发言或当前票型与计划的设想不符，你要临场灵活调整、随机应变，不必机械照搬；用你自己的话表达，绝不能照搬原文，也不要暴露存在“计划”。`
      : ''
  // 本轮发言进度：哪些人已经发言、哪些人还没轮到——避免 AI 评价尚未发言者
  const spokenThisRound = state.speeches.filter((s) => s.round === state.round)
  const spokenNames = spokenThisRound
    .map((s) => state.players.find((p) => p.id === s.playerId)?.name)
    .filter((n): n is string => !!n && n !== player.name)
  const notSpokenNames = state.players
    .filter((p) => p.isAlive && p.id !== player.id && !spokenThisRound.some((s) => s.playerId === p.id))
    .map((p) => p.name)
  const progressNote = `本轮发言进度：${
    spokenNames.length ? `在你之前已发言：${spokenNames.join('、')}` : '你是本轮第一个发言的人'
  }；${notSpokenNames.length ? `还没轮到发言：${notSpokenNames.join('、')}` : '其他人都已发言'}。
重要：你只能针对【本轮已经发言过】或【往轮已有记录】的内容做回应或评价；对【还没发言】的玩家，绝不要假设、捏造或评价他们这一轮“说了什么”——他们还没开口。如果你是前几位发言者，就主要依据昨晚死亡结果、历史信息和自己的身份来表态。`

  // 回合前策略：硬规则定下本轮该承担的任务，优先级高于下面的一般建议
  const strategy = computeRoundStrategy(player, state)
  const strategyNote = strategy
    ? `\n\n【本轮你的角色任务（最高优先级，务必执行）】\n${strategy.talkingGoal}`
    : ''
  const pushTargetName =
    strategy?.pushTargetId
      ? state.players.find((p) => p.id === strategy.pushTargetId)?.name ?? null
      : null

  // 预言家发言硬约束：绝不能把自己验过的金水说成可疑/狼；查杀才是要推的狼。
  const seerFact = player.role === 'seer' ? seerVerified(player, state) : null
  const nm = (id: string) => state.players.find((p) => p.id === id)?.name ?? '某玩家'
  const seerFactNote =
    seerFact && (seerFact.goodIds.length > 0 || seerFact.aliveWolfIds.length > 0)
      ? `\n\n【你的验人结论（铁的事实，发言必须遵守）】${
          seerFact.goodIds.length > 0
            ? `\n- 金水（你亲自验过=确认好人）：${seerFact.goodIds.map(nm).join('、')}。绝不能在发言里说他们可疑、像狼或提议推他们；只能为他们作证/站边（是否公开金水看你的起跳策略）。`
            : ''
        }${
          seerFact.aliveWolfIds.length > 0
            ? `\n- 查杀（你亲自验过=确认狼人）：${seerFact.aliveWolfIds.map(nm).join('、')}。这才是你要重点怀疑、推动放逐的狼。`
            : ''
        }`
      : ''

  const task = `现在是第${state.round}天白天讨论阶段，轮到你发言。
请基于你掌握的信息，以「${player.name}」的身份说一段话（第一人称、100字以内、中文）。
${progressNote}
要符合你的角色立场，基于公开信息和自身私密信息给出当前倾向。
发言必须包含至少一个具体判断或倾向，例如：站边谁、怀疑谁、认可谁、为什么。
如果你是预言家/女巫/守卫/猎人等神职，可以在收益足够时选择起跳或给出压力，但不要无意义暴露身份。${strategyNote}${seerFactNote}${wolfPlanNote}
${pushTargetName ? `\n本轮关键目标玩家名：${pushTargetName}。如果你的任务要求推动目标，发言里必须明确点名。` : ''}
  ${CLAIM_INSTRUCTION}
发言前必须在 analysis 字段做三步分析（每步1句，分析仅供系统使用不展示）：
① ${spokenThisRound.length === 0 ? '夜间结果解读：昨晚死了谁（或平安夜）？这意味着狼队在针对什么角色/打什么路线？对当前局势有什么影响？给出你的判断。' : '矛盾核查：对照【客观事实锚点】，本轮已发言的人里，谁的说法与夜晚死亡/夜间结果/已翻牌身份存在矛盾或无法自洽？请逐一点名并说明矛盾点。若无矛盾则写"暂无明显矛盾"。'}
② 可疑定位：综合${spokenThisRound.length === 0 ? '夜间结果、角色逻辑和你的私密信息，给出你目前对其他玩家的初始倾向——谁更可疑、谁更值得信任？即使没有发言，也可以基于夜死目标和位置关系给出初步判断' : '矛盾核查、票型抱团信号和发言逻辑，目前最可疑的1-2人是谁？为什么'}？
③ 本轮任务：结合你的角色任务（如有），这轮发言要达成什么目标（表态/站边/推人/反指）？
发言内容（speech）必须体现①②的结论，不能含糊过场；${spokenThisRound.length === 0 ? '绝不能说"信息不多先观察"这类空话——基于夜间结果和角色逻辑一定能给出初步判断。' : '若存在矛盾应在发言中直接指出。'}
重要约束：speech 中不得直接或间接暴露未公开的私密信息（守护记录、真实身份、夜间行动结果），除非你已决定起跳且收益足够。如果发言中提到夜晚行动（守护了谁、查验了谁、用药了谁），必须与你私密信息中的记录完全一致，严禁捏造或错报任何夜晚行动对象。
返回 JSON：{"analysis":"三步分析（①矛盾核查 ②可疑定位 ③本轮任务，仅供系统使用）","speech":"你的发言内容","claims":[{"claimType":"seer","targetName":"玩家名或null","result":"werewolf或villager或unknown或null"}]}`
  try {
    let result = await callAiJsonWithTrace(getInstruction(player), perspective, task, 900)
    let parsed = result.parsed
    let llmTrace = result.trace
    let content =
      typeof parsed.speech === 'string' && parsed.speech.trim()
        ? parsed.speech.trim()
        : '我先听听大家怎么说。'
    const targetAwareStrategy = strategy && pushTargetName
      ? { ...strategy, pushTargetId: pushTargetName }
      : strategy
    const violation =
      validateSpeechAgainstStrategy(content, targetAwareStrategy) ??
      validateCommonSenseText(content, state) ??
      validateWerewolfPublicSpeech(content, player, state)
    if (violation) {
      result = await callAiJsonWithTrace(
        getInstruction(player),
        perspective,
        `${task}\n\n上一次发言没有完成强制角色任务：${violation}\n请重写，必须完成任务，并仍然只返回指定 JSON。`,
        900
      )
      parsed = result.parsed
      llmTrace = result.trace
      content =
        typeof parsed.speech === 'string' && parsed.speech.trim()
          ? parsed.speech.trim()
          : content
    }
    if (validateCommonSenseText(content, state) || validateWerewolfPublicSpeech(content, player, state)) {
      content = fallbackPublicSpeech(state)
    }
    return { content, claims: sanitizeRawClaims(parsed.claims), llmTrace }
  } catch {
    return { content: '我再听听大家怎么说，先过。', claims: [] }
  }
}

// ───────────────────────── 狼队夜间作战计划 ─────────────────────────
// 真实规则：白天狼人无法私聊，协商只能发生在夜晚。狼队睁眼时商定一份次日计划
// （谁悍跳/谁深水/推谁/是否倒钩），但此时【还不知道天亮后的实际死亡结果】。
// 白天各 AI 狼把它当作参考、并根据真实局势临场应变（见 generateAiSpeech）。
function planPlayerName(state: GameState, id?: string | null): string {
  if (!id) return '无'
  return state.players.find((p) => p.id === id)?.name ?? '未知'
}

function playerIndexLabel(state: GameState, player: Player): string {
  const idx = state.players.findIndex((p) => p.id === player.id)
  const left = idx >= 0 ? state.players[(idx - 1 + state.players.length) % state.players.length] : null
  const right = idx >= 0 ? state.players[(idx + 1) % state.players.length] : null
  return `${seatName(player)}${left ? `，左邻${seatName(left)}` : ''}${right ? `，右邻${seatName(right)}` : ''}`
}

function nextDaySpeakingOrder(state: GameState, assumedKillId?: string | null): Player[] {
  return state.players.filter((p) => p.isAlive && p.id !== assumedKillId)
}

function buildWolfPositionSummary(state: GameState, wolves: Player[], assumedKillId?: string | null): string {
  const wolfIds = new Set(wolves.map((w) => w.id))
  const speaking = nextDaySpeakingOrder(state, assumedKillId)
  const lines = [
    `座位顺序：${state.players.map((p) => `${seatName(p)}${wolfIds.has(p.id) ? '(狼)' : ''}${p.isAlive ? '' : '(已出局)'}`).join(' -> ')}`,
    `次日存活发言轮转（若刀口成立，实际起点天亮后随机）：${speaking.map((p) => `${seatName(p)}${wolfIds.has(p.id) ? '(狼)' : ''}`).join(' -> ') || '无'}`,
  ]
  for (const wolf of wolves) {
    const speakIndex = speaking.findIndex((p) => p.id === wolf.id)
    const band = speakIndex < 0
      ? '不发言'
      : speakIndex < Math.ceil(speaking.length / 3)
        ? '前置位'
        : speakIndex >= Math.floor((speaking.length * 2) / 3)
          ? '后置位'
          : '中置位'
    lines.push(`${playerIndexLabel(state, wolf)}；轮转位置：${band}${speakIndex >= 0 ? `（座位轮转第${speakIndex + 1}个，实际前后置需天亮后按随机起点调整）` : ''}`)
  }
  return lines.join('\n')
}

function formatWolfPlanForPlayer(plan: WolfPlan, player: Player, state: GameState): string {
  const ownPoint = plan.talkingPointsByWolfId[player.id] || '按狼队整体策略伪装好人，结合场上局势临场应变。'
  const ownPosition = plan.positionNotesByWolfId?.[player.id] || '结合自己的发言顺序和座位关系，不要和同伴重复同一种踩保逻辑。'
  return [
    `整体策略：${plan.tactic}`,
    `最终刀口：${planPlayerName(state, plan.finalKillTargetId)}`,
    `裁决理由：${plan.decisionReason || '按狼队夜间协商综合决定。'}`,
    `策略推理：${plan.strategyReason || '根据刀口、座位和次日发言轮转安排狼队分工。'}`,
    `主推目标：${planPlayerName(state, plan.pushTargetId)}`,
    `悍跳狼：${planPlayerName(state, plan.fakeClaimWolfId)}`,
    `保护同伴：${planPlayerName(state, plan.protectWolfId)}`,
    `倒钩/卖队友对象：${planPlayerName(state, plan.busWolfId)}`,
    `你的个人话术：${ownPoint}`,
    `你的位置策略：${ownPosition}`,
    `备注：${plan.notes}`,
  ].join('\n')
}

function normalizeWolfPlan(raw: Record<string, unknown>, wolves: Player[], state: GameState): WolfPlan {
  const validWolfIds = new Set(wolves.map((w) => w.id))
  const validPlayerIds = new Set(state.players.map((p) => p.id))
  const tacticValues: WolfPlan['tactic'][] = ['fake_claim', 'deep_cover', 'bus', 'rush_vote', 'misdirect']
  const tactic = tacticValues.includes(raw.tactic as WolfPlan['tactic'])
    ? raw.tactic as WolfPlan['tactic']
    : 'misdirect'
  const wolfId = (value: unknown): string | null => {
    const id = typeof value === 'string' ? value : null
    return id && validWolfIds.has(id) ? id : null
  }
  const playerId = (value: unknown): string | null => {
    const id = typeof value === 'string' ? value : null
    return id && validPlayerIds.has(id) ? id : null
  }
  const rawPoints =
    raw.talkingPointsByWolfId && typeof raw.talkingPointsByWolfId === 'object' && !Array.isArray(raw.talkingPointsByWolfId)
      ? raw.talkingPointsByWolfId as Record<string, unknown>
      : {}
  const talkingPointsByWolfId: Record<string, string> = {}
  for (const wolf of wolves) {
    const point = rawPoints[wolf.id]
    talkingPointsByWolfId[wolf.id] =
      typeof point === 'string' && point.trim()
        ? point.trim().slice(0, 120)
        : '伪装好人，结合发言和票型找机会推动错误焦点。'
  }
  const rawPositionNotes =
    raw.positionNotesByWolfId && typeof raw.positionNotesByWolfId === 'object' && !Array.isArray(raw.positionNotesByWolfId)
      ? raw.positionNotesByWolfId as Record<string, unknown>
      : {}
  const positionNotesByWolfId: Record<string, string> = {}
  for (const wolf of wolves) {
    const note = rawPositionNotes[wolf.id]
    positionNotesByWolfId[wolf.id] =
      typeof note === 'string' && note.trim()
        ? note.trim().slice(0, 160)
        : '根据自己的发言顺序和座位相邻关系调整力度，避免和狼同伴重复同一套逻辑。'
  }
  return {
    round: state.round,
    tactic,
    finalKillTargetId: playerId(raw.finalKillTargetId),
    decisionReason: typeof raw.decisionReason === 'string' ? raw.decisionReason.slice(0, 180) : 'AI 综合狼队意见后确定。',
    strategyReason: typeof raw.strategyReason === 'string' ? raw.strategyReason.slice(0, 220) : '根据狼队意见、刀口收益、座位关系和次日发言轮转安排分工。',
    fakeClaimWolfId: wolfId(raw.fakeClaimWolfId),
    pushTargetId: playerId(raw.pushTargetId),
    protectWolfId: wolfId(raw.protectWolfId),
    busWolfId: wolfId(raw.busWolfId),
    talkingPointsByWolfId,
    positionNotesByWolfId,
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 160) : '保持发言一致，避免暴露狼队视角。',
  }
}

export function fallbackWolfPlan(wolves: Player[], state: GameState): WolfPlan {
  const candidates = state.players.filter((p) => p.isAlive && !isWerewolf(p.role))
  const pushTarget = candidates[0]?.id ?? null
  const whiteWolf = wolves.find((w) => w.role === 'white_wolf_king')
  const fakeClaimWolfId = whiteWolf?.id ?? null
  return {
    round: state.round,
    tactic: fakeClaimWolfId ? 'fake_claim' : 'misdirect',
    finalKillTargetId: pushTarget,
    decisionReason: '裁决失败时按兜底逻辑选择存活好人作为刀口，并生成基础狼队分工。',
    strategyReason: '兜底策略优先保持狼队发言一致，并根据特殊狼身份安排冲锋或深水。',
    fakeClaimWolfId,
    pushTargetId: pushTarget,
    protectWolfId: wolves[0]?.id ?? null,
    busWolfId: null,
    talkingPointsByWolfId: Object.fromEntries(
      wolves.map((w) => [w.id, w.role === 'white_wolf_king' && fakeClaimWolfId === w.id
        ? `承担冲锋位，可悍跳预言家并把 ${pushTarget ? planPlayerName(state, pushTarget) : '强势好人'} 报成查杀；若局势崩盘再考虑自爆带走强神。`
        : w.role === 'wolf_beauty'
          ? '深水隐藏，不主动悍跳，发言像谨慎好人，夜晚魅惑关键神职或最可能推你的人。'
          : `伪装好人，质疑 ${pushTarget ? planPlayerName(state, pushTarget) : '强势好人'} 的发言逻辑。`])
    ),
    positionNotesByWolfId: Object.fromEntries(
      wolves.map((w) => {
        const speaking = nextDaySpeakingOrder(state, pushTarget)
        const idx = speaking.findIndex((p) => p.id === w.id)
        return [w.id, idx >= 0 && idx < speaking.length / 2
          ? '你预计偏前置发言，先铺身份和怀疑方向，不要暴露狼队知道刀口。'
          : '你预计偏后置发言，观察前置发言后补强狼队主线或适度倒钩。']
      })
    ),
    notes: fakeClaimWolfId ? '白狼王承担悍跳/冲锋，狼美人和普通狼配合做深水或站边。' : '统一把焦点推向好人，避免互相矛盾。',
  }
}

function matchPlayerByIdOrName(value: unknown, candidates: Player[]): Player | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return undefined
  return candidates.find((p) => p.id === text) ?? matchPlayerByName(text, candidates)
}

function fallbackWolfCouncilOpinion(wolf: Player, state: GameState, candidates: Player[]): WolfCouncilOpinion {
  const target = candidates.find((p) => state.publicClaims.some((c) => c.claimType === 'seer' && c.claimantId === p.id)) ?? candidates[0] ?? null
  return {
    round: state.round,
    wolfId: wolf.id,
    targetId: target?.id ?? null,
    reason: target ? `信息不足时优先压制${target.name}，避免强好人带队。` : '没有可刀目标。',
    dayStrategy: wolf.role === 'wolf_beauty'
      ? '深水隐藏，轻踩狼队主推目标，重点降低自身处理优先级。'
      : '伪装好人视角分析死亡和发言，把焦点引向狼队主推目标。',
    positionStrategy: '根据自己的发言顺序和座位相邻关系调整力度，避免和同伴重复同一种发言。',
  }
}

export async function generateWolfCouncilOpinion(
  wolf: Player,
  wolves: Player[],
  state: GameState,
  candidates: Player[]
): Promise<WolfCouncilOpinion> {
  if (candidates.length === 0) return fallbackWolfCouncilOpinion(wolf, state, candidates)
  const wolfNames = wolves.map((w) => `${w.name}(${ROLE_NAMES[w.role]})`).join('、')
  const candidateLine = shuffleCopy(candidates).map((c) => `${c.name}(${c.id})`).join('、')
  const positionSummary = buildWolfPositionSummary(state, wolves)
  const evidenceNote = `公开信息约束：${
    state.speeches.length > 0 ? '可以引用真实发言。' : '目前没有公开发言，不要编造发言矛盾、带队、跳身份。'
  }${
    state.votes.length > 0 ? '可以引用真实票型。' : '目前没有投票记录，不要编造票型。'
  }`
  const task = `现在是狼人夜晚会议。你是${wolf.name}，请独立给狼队提出今晚刀人建议和明天发言策略。
存活狼队：${wolfNames}。
可刀目标：${candidateLine}。
位置信息：
${positionSummary}
${evidenceNote}
要求：
- 给出你建议的刀口和明确理由。
- 明天发言策略必须结合你的发言顺序位置（前置/中置/后置）和座位相邻关系。
- 不能公开承认狼人身份或暴露真实狼同伴；策略要能伪装成好人视角。
返回 JSON：{"targetId":"玩家id","reason":"建议刀这个人的理由","dayStrategy":"明天你建议狼队如何发言/分工","positionStrategy":"结合发言顺序和座位相邻的位置策略"}`

  try {
    const { parsed, trace } = await callAiJsonWithTrace(getInstruction(wolf), buildPlayerPerspective(wolf, state), task, 520)
    const matched = matchPlayerByIdOrName(parsed.targetId ?? parsed.target, candidates)
    return {
      round: state.round,
      wolfId: wolf.id,
      targetId: matched?.id ?? null,
      reason: sanitizeDecisionReason(parsed.reason, state),
      dayStrategy: typeof parsed.dayStrategy === 'string' && parsed.dayStrategy.trim()
        ? parsed.dayStrategy.trim().slice(0, 180)
        : '伪装好人视角，围绕狼队目标组织发言。',
      positionStrategy: typeof parsed.positionStrategy === 'string' && parsed.positionStrategy.trim()
        ? parsed.positionStrategy.trim().slice(0, 180)
        : '结合发言顺序和座位相邻关系调整发言力度。',
      llmTrace: trace,
    }
  } catch {
    return fallbackWolfCouncilOpinion(wolf, state, candidates)
  }
}

export async function judgeWolfCouncilDecision(
  wolves: Player[],
  state: GameState,
  opinions: WolfCouncilOpinion[],
  forcedTargetId?: string | null
): Promise<{ targetId: string | null; plan: WolfPlan; reason: string; llmTrace?: AiRequestTrace }> {
  const candidates = state.players.filter((p) => p.isAlive && !isWerewolf(p.role))
  if (wolves.length === 0 || candidates.length === 0) {
    const plan = fallbackWolfPlan(wolves, state)
    return { targetId: null, plan, reason: '没有存活狼人或可刀目标' }
  }
  const forcedTarget = forcedTargetId ? candidates.find((p) => p.id === forcedTargetId) ?? null : null

  const leader = wolves[0]
  const opinionLine = opinions.map((o) => {
    const wolf = state.players.find((p) => p.id === o.wolfId)
    const target = o.targetId ? state.players.find((p) => p.id === o.targetId) : null
    return `- ${wolf?.name ?? o.wolfId}建议刀${target?.name ?? '无'}；理由：${o.reason}；明天策略：${o.dayStrategy}；位置策略：${o.positionStrategy}`
  }).join('\n')
  const positionSummary = buildWolfPositionSummary(state, wolves)
  const task = `现在是狼人夜晚会议的最终裁决。你是逻辑裁判，不是任一玩家。请综合所有狼队意见，决定最终刀口和明天发言计划。
候选刀口：${candidates.map((p) => `${p.name}(${p.id})`).join('、')}。
存活狼队：${wolves.map((w) => `${w.name}(${w.id}, ${ROLE_NAMES[w.role]})`).join('、')}。
狼队意见：
${opinionLine || '无有效意见'}
位置信息：
${positionSummary}
${forcedTarget ? `真人狼人已拍板最终刀口为【${forcedTarget.name}(${forcedTarget.id})】。你必须尊重这个刀口，只负责生成配套的理由、分工和明天发言计划。` : '本局由 AI 裁决最终刀口，请综合意见自行选择最优目标。'}
裁决要求：
- finalKillTargetId 必须是候选刀口 id。${forcedTarget ? `本次必须填 ${forcedTarget.id}。` : ''}
- decisionReason 要解释最终刀口的推理理由：为什么采纳/否定各意见、为什么这个目标收益最高。
- strategyReason 要解释明天行动策略的推理理由：为什么这样分工、如何结合刀口、座位相邻和发言轮转。
- 明天发言计划必须同时考虑发言顺序位置和座位相邻位置。
- talkingPointsByWolfId 和 positionNotesByWolfId 必须覆盖每只狼的 id，且每只狼分工不同。
- 若安排悍跳，优先考虑白狼王；狼美人默认深水隐藏，除非局势要求。
返回 JSON：{"finalKillTargetId":"玩家id","decisionReason":"刀人推理理由","strategyReason":"明天策略推理理由","tactic":"fake_claim/deep_cover/bus/rush_vote/misdirect","fakeClaimWolfId":"狼人id或null","pushTargetId":"玩家id或null","protectWolfId":"狼人id或null","busWolfId":"狼人id或null","talkingPointsByWolfId":{"狼人id":"个人话术"},"positionNotesByWolfId":{"狼人id":"位置策略"},"notes":"简短备注"}`

  try {
    const { parsed, trace } = await callAiJsonWithTrace(
      '你是狼人杀狼队夜晚会议的普通 AI 仲裁者。你只输出合法 JSON，且必须遵守游戏当前规则和隐藏信息边界。',
      buildPlayerPerspective(leader, state),
      task,
      900
    )
    const target = forcedTarget ?? matchPlayerByIdOrName(parsed.finalKillTargetId ?? parsed.targetId ?? parsed.target, candidates)
    if (!target) throw new Error('裁决刀口非法')
    const plan = normalizeWolfPlan({ ...parsed, finalKillTargetId: target.id }, wolves, state)
    return {
      targetId: target.id,
      plan: { ...plan, finalKillTargetId: target.id },
      reason: plan.decisionReason || sanitizeDecisionReason(parsed.decisionReason, state),
      llmTrace: trace,
    }
  } catch {
    const tally: Record<string, number> = {}
    for (const opinion of opinions) {
      if (opinion.targetId && candidates.some((p) => p.id === opinion.targetId)) {
        tally[opinion.targetId] = (tally[opinion.targetId] || 0) + 1
      }
    }
    const fallbackTargetId =
      forcedTarget?.id ??
      Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      candidates.find((p) => state.publicClaims.some((c) => c.claimType === 'seer' && c.claimantId === p.id))?.id ??
      candidates[0]?.id ??
      null
    const plan = {
      ...fallbackWolfPlan(wolves, state),
      finalKillTargetId: fallbackTargetId,
      pushTargetId: fallbackTargetId,
      decisionReason: 'AI 仲裁失败，按狼队意见和兜底逻辑确定刀口。',
      strategyReason: 'AI 仲裁失败，按兜底逻辑生成基础狼队分工。',
    }
    return { targetId: fallbackTargetId, plan, reason: 'AI 仲裁失败，按狼队意见和兜底逻辑确定刀口' }
  }
}

export async function generateWolfPlan(wolves: Player[], state: GameState): Promise<WolfPlan> {
  if (wolves.length === 0) return fallbackWolfPlan(wolves, state)
  const leader = wolves[0]
  const wolfNames = wolves.map((w) => `${w.name}(${w.id}, ${ROLE_NAMES[w.role]})`).join('、')
  const specialWolfNotes = [
    wolves.some((w) => w.role === 'white_wolf_king')
      ? '白狼王适合承担高风险悍跳/冲锋位：优先考虑让白狼王悍跳预言家或强势带队；如果悍跳失败或被真预言家查杀，白天可自爆带走真预言家/强神止损。'
      : '',
    wolves.some((w) => w.role === 'wolf_beauty')
      ? '狼美人更适合深水隐藏位：不要优先安排她悍跳；让她白天低调做身份，夜晚魅惑真预言家、女巫、守卫、猎人或最可能推她出局的强好人。'
      : '',
  ].filter(Boolean).join('\n')
  const aliveNames = state.players.filter((p) => p.isAlive).map((p) => `${p.name}(${p.id})`).join('、')
  const killId = state.nightActions
    .filter((a) => a.round === state.round && a.actionType === 'kill')
    .map((a) => a.targetId)[0]
  const killName = killId ? state.players.find((p) => p.id === killId)?.name : null
  const task = `现在是第${state.round}天夜晚，狼队睁眼商议明天白天的作战计划。${killName ? `你们今晚决定击杀【${killName}】（但天亮前并不知道是否击杀成功，也不知道女巫/守卫是否干预）。` : ''}
存活狼队成员：${wolfNames}。
存活玩家：${aliveNames}。
${specialWolfNotes ? `特殊狼人分工建议：\n${specialWolfNotes}` : ''}
请在【还不知道天亮后实际死亡结果】的前提下，结合已有发言和局势，预先商定一个结构化计划。
字段说明：
- tactic 必须是 fake_claim/deep_cover/bus/rush_vote/misdirect 之一。
- fakeClaimWolfId/protectWolfId/busWolfId 必须填狼人的 id 或 null。若有白狼王且需要悍跳，优先把 fakeClaimWolfId 给白狼王；若有狼美人，通常不要把 fakeClaimWolfId 给狼美人，除非别无选择。
- pushTargetId 必须填存活玩家 id 或 null。
- talkingPointsByWolfId 必须给每个狼 id 一句个人话术，避免两只狼做同一件事。
返回 JSON：{"tactic":"misdirect","fakeClaimWolfId":null,"pushTargetId":"玩家id或null","protectWolfId":"狼人id或null","busWolfId":"狼人id或null","talkingPointsByWolfId":{"狼人id":"个人话术"},"notes":"简短备注"}`
  try {
    const parsed = await callAiJson(getInstruction(leader), buildPlayerPerspective(leader, state), task, 600)
    return normalizeWolfPlan(parsed, wolves, state)
  } catch {
    return fallbackWolfPlan(wolves, state)
  }
}

// ───────────────────────── 遗言 ─────────────────────────
// 放逐与夜死都有遗言。同样让 LLM 一并产出结构化 claim。
export async function generateLastWords(player: Player, state: GameState): Promise<AiSpeechResult> {
  const perspective = buildPlayerPerspective(player, state)
  const camp = isWerewolf(player.role)
    ? '你是狼人，遗言必须继续服务狼队：可以假爆料、反咬可信好人、扰乱归票、制造反向身份，但绝不能承认真实狼身份、泄露真实狼同伴，或真心帮好人盘狼坑。'
    : '你是好人，遗言要把你掌握的信息和判断清楚留给场上：表明身份、给出怀疑对象、建议大家归票谁。'
  const seerNote =
    player.role === 'seer'
      ? '你是预言家，务必报出你的全部查验结果（金水/查杀）和站边，这是好人最关键的信息。'
      : player.role === 'witch'
        ? '你是女巫，可以视情况公布解药/毒药的使用情况和由此得到的信息（如银水、毒杀结果）。'
        : ''
  const outReason =
    state.pendingLastWordsSource === 'night'
      ? '昨晚被杀出局'
      : state.pendingLastWordsSource === 'shot'
        ? '被猎人/狼王开枪带走'
        : '被投票放逐出局'
  const task = `你刚刚${outReason}，现在是你的遗言时间（你出局后身份会公开）。
请以「${player.name}」的身份发表遗言（第一人称、100字以内、中文）。
${camp}
${seerNote}
${CLAIM_INSTRUCTION}
  返回 JSON：{"speech":"你的遗言内容","claims":[{"claimType":"seer","targetName":"玩家名或null","result":"werewolf或villager或unknown或null"}]}`
  try {
    let result = await callAiJsonWithTrace(getInstruction(player), perspective, task, 600)
    let parsed = result.parsed
    let trace = result.trace
    let content =
      typeof parsed.speech === 'string' && parsed.speech.trim()
        ? parsed.speech.trim()
        : '我没什么好说的了，大家好好分析，找出狼人。'
    const violation = validateCommonSenseText(content, state) ?? validateWerewolfPublicSpeech(content, player, state)
    if (violation) {
      result = await callAiJsonWithTrace(
        getInstruction(player),
        perspective,
        `${task}\n\n上一次遗言违反狼人公开发言约束：${violation}\n请重写遗言：继续伪装或误导，不能承认真实狼身份、不能泄露真实狼同伴、不能真心帮好人。仍然只返回指定 JSON。`,
        600
      )
      parsed = result.parsed
      trace = result.trace
      content =
        typeof parsed.speech === 'string' && parsed.speech.trim()
          ? parsed.speech.trim()
          : content
    }
    if (validateCommonSenseText(content, state) || validateWerewolfPublicSpeech(content, player, state)) {
      content = fallbackPublicSpeech(state, true)
    }
    return { content, claims: sanitizeRawClaims(parsed.claims), llmTrace: trace }
  } catch {
    return { content: '我没什么好说的了，大家好好分析，找出狼人。', claims: [] }
  }
}

// ───────────────────────── 投票 ─────────────────────────
export async function generateAiVote(
  player: Player,
  state: GameState,
  candidates: Player[]
): Promise<AiTargetDecision> {
  if (candidates.length === 0) return { targetId: null, reason: '没有可投票候选人' }
  const perspective = buildPlayerPerspective(player, state)
  const guardrail = voteGuardrail(player, state, candidates)

  // 当前轮已经投出的票（顺序公投：后投者能看到前面的票型，形成跟票/归票/抗推）
  const priorVotes = state.votes.filter((v) => v.round === state.round)
  let tallyLine = '你是本轮第一个投票的人，目前还没有人投票。'
  if (priorVotes.length > 0) {
    const tally: Record<string, string[]> = {}
    for (const v of priorVotes) {
      const voterName = state.players.find((p) => p.id === v.voterId)?.name ?? '某人'
      const tgtName = state.players.find((p) => p.id === v.targetId)?.name ?? '某人'
      ;(tally[tgtName] ||= []).push(voterName)
    }
    tallyLine =
      '当前票型：' +
      Object.entries(tally)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([tgt, voters]) => `${tgt} ${voters.length}票（${voters.join('、')}）`)
        .join('；')
  }
  const voteMeaning =
    priorVotes.length > 0
      ? '注意：票投给谁，表示投票者想放逐/怀疑谁；某人票数领先，表示他当前是主要抗推位，不表示大家支持或站边他。'
      : '当前还没有票型，不要编造“多数玩家站边/投票支持某人”。'

  // 场上公开声称且无人对跳的神职，附带发言位置信心标注
  const allRoundSpeeches = state.speeches.filter((s) => !s.isLastWords)
  const uncontestednClaimedRoles = (['seer', 'witch', 'hunter', 'guard'] as const).flatMap((role) => {
    const claimants = Array.from(new Set(state.publicClaims.filter((c) => c.claimType === role).map((c) => c.claimantId)))
    if (claimants.length !== 1) return []
    const claimantId = claimants[0]
    // 找到该玩家第一次跳身份所在轮次的发言顺序
    const firstClaimRound = state.publicClaims.find((c) => c.claimType === role && c.claimantId === claimantId)?.round ?? 1
    const speechesInClaimRound = allRoundSpeeches.filter((s) => s.round === firstClaimRound)
    const speakerIndex = speechesInClaimRound.findIndex((s) => s.playerId === claimantId)
    const totalSpeakers = speechesInClaimRound.length
    let positionLabel: string
    if (speakerIndex < 0 || totalSpeakers === 0) {
      positionLabel = '发言位置未知'
    } else if (speakerIndex < Math.ceil(totalSpeakers / 3)) {
      positionLabel = `前置位（第${speakerIndex + 1}/${totalSpeakers}位发言，主动起跳可信度较高）`
    } else if (speakerIndex >= Math.floor((totalSpeakers * 2) / 3)) {
      positionLabel = `后置位（第${speakerIndex + 1}/${totalSpeakers}位发言，看完大多数人再跳，悍跳嫌疑相对更高，需结合发言逻辑审慎判断）`
    } else {
      positionLabel = `中置位（第${speakerIndex + 1}/${totalSpeakers}位发言，可信度居中）`
    }
    return [{ id: claimantId, positionLabel }]
  })
  const uncontestednLine = uncontestednClaimedRoles.length > 0
    ? `【已公开跳身份且无人对跳的玩家】：${uncontestednClaimedRoles.map(({ id, positionLabel }) => { const p = state.players.find((q) => q.id === id); return `${p ? seatName(p) : id}（${positionLabel}）` }).join('、')}。好人阵营不应以"信息不足"为由投票放逐前置位起跳者；后置位起跳者可信度打折，若其发言存在漏洞则可作为怀疑目标；信息不足时应转投发言逻辑最差的其他候选人。\n`
    : ''
  const guardrailLine = guardrail.instruction ? `【角色私密约束（最高优先级）】\n${guardrail.instruction}\n` : ''
  const task = `现在是投票放逐阶段，本轮采用依次公开投票。候选人：${candidates.map((c) => seatName(c)).join('、')}。
${tallyLine}
${voteMeaning}
${uncontestednLine}${guardrailLine}投票前必须在 analysis 字段做三步推理（每步1-2句，仅供系统使用）：
① 好人清单：基于公开发言、跳身份声明和已知夜间结果，有哪些候选人已被交叉验证或有充分理由认定为好人？这些人不应作为投票目标。若暂无明确证据则写"暂无"。
② 矛盾定位：候选人中谁的发言与客观事实（夜间死亡时间线/已翻牌身份/自己声称的角色行动）存在无法自洽的矛盾？列出最可疑的1-2人及矛盾原因。若无明显矛盾则写"暂无"。
③ 投票决策：综合①排除好人、②找出狼嫌，结合当前票型，投谁最合理？若信息确实不足，投发言逻辑最差的人，而不是已跳身份的神职。
好人要优先投最高狼面玩家，结合发言矛盾、对跳可信度、死亡信息；当票型已形成对某个高狼面玩家的合力时可以跟票归票，集中放逐。
狼人要优先推动放逐关键好人或错误焦点，可借票型把水搅浑、分票自保或假意跟好人票；可以倒钩狼同伴，但不能无脑保护或无脑卖队友。
必须选一个，不能弃票。
返回 JSON：{"analysis":"三步推理（①好人清单 ②矛盾定位 ③投票决策，仅供系统使用）","target":"玩家名字","reason":"简短理由"}`
  // 预言家硬约束：绝不投自己验过的金水（即使 LLM 选了也强制改掉）
  const seerInfo = seerVerified(player, state)
  const overrideSeerGoodVote = (targetId: string): { targetId: string; reason: string } | null => {
    if (player.role !== 'seer' || !seerInfo.goodIds.includes(targetId)) return null
    const liveWolf = seerInfo.aliveWolfIds.find((id) => candidates.some((c) => c.id === id))
    const safe = candidates.filter((c) => !seerInfo.goodIds.includes(c.id))
    const fixedId = liveWolf ?? (safe.length ? pickRandom(safe).id : targetId)
    return { targetId: fixedId, reason: '预言家不投自己的金水，改投查杀/其他可疑玩家' }
  }

  try {
    const { parsed, trace } = await callAiJsonWithTrace(getInstruction(player), perspective, task)
    const matched = matchPlayerByName(String(parsed.target ?? ''), candidates)
    if (matched) {
      const override = overrideSeerGoodVote(matched.id)
      if (override) return { ...override, llmTrace: trace }
      return {
        targetId: matched.id,
        reason: sanitizeVoteReason(parsed.reason, state),
        llmTrace: trace,
      }
    }
  } catch {
    // fall through to deterministic fallback
  }
  // 兜底也要排除预言家自己的金水
  const fallbackPool = candidates.filter((c) => !seerInfo.goodIds.includes(c.id))
  return {
    targetId: guardrail.fallbackId ?? pickRandom(fallbackPool.length ? fallbackPool : candidates).id,
    reason: guardrail.fallbackId ? `AI 输出无效，按关键局势兜底：${guardrail.instruction}` : 'AI 输出无效，随机选择候选人兜底',
  }
}

// ───────────────────────── 夜晚行动（守卫/狼人/预言家）─────────────────────────
export async function decideNightAction(
  player: Player,
  state: GameState,
  actionType: 'protect' | 'kill' | 'check',
  candidates: Player[]
): Promise<AiTargetDecision> {
  if (candidates.length === 0) return { targetId: null, reason: '没有可行动目标' }

  const hasPublicSpeech = state.speeches.length > 0
  const hasPublicVote = state.votes.length > 0
  const evidenceNote = `公开信息约束：${
    hasPublicSpeech ? '场上已有公开发言，可以引用真实发言内容。' : '目前还没有任何公开发言，理由里绝不能说某人“发言矛盾、站边摇摆、带节奏、跳身份”。'
  }${
    hasPublicVote ? '场上已有投票记录，可以引用真实票型。' : '目前还没有任何投票记录，理由里绝不能引用票型、跟票、冲票或归票。'
  }如果信息不足，请直接说明“首夜/信息不足下的覆盖式选择”，不要编造不存在的依据。`

  const taskMap: Record<typeof actionType, string> = {
    protect: `现在是夜晚，你是守卫，请选择今晚守护的玩家。优先保护你判断可能是预言家/女巫等神职、发言能带队的好人、或今晚最可能被狼刀的人。不能守护你上一晚守过的人。`,
    kill: `现在是夜晚，狼队要选择今晚击杀的目标。目标是推进屠边：优先击杀可信神职、已跳预言家/女巫/守卫/猎人、报出强验人信息者、或能带队的强好人。也可以根据局势选择屠民路线。`,
    check: `现在是夜晚，你是预言家，请选择今晚查验的玩家。若已有公开信息，优先查验发言矛盾、站边摇摆、票型异常、或查验后最能打开局面的玩家；若是首夜没有公开信息，就选择一个未验过的覆盖位，并如实说明信息不足。不要重复查验已验过的人。`,
  }

  const task = `${taskMap[actionType]}
${evidenceNote}
可选目标：${candidates.map((c) => c.name).join('、')}。
返回 JSON：{"target":"玩家名字","reason":"简短理由"}`

  try {
    const perspective = buildPlayerPerspective(player, state)
    const { parsed, trace } = await callAiJsonWithTrace(getInstruction(player), perspective, task)
    const matched = matchPlayerByName(String(parsed.target ?? ''), candidates)
    if (matched) {
      return {
        targetId: matched.id,
        reason: sanitizeDecisionReason(parsed.reason, state),
        llmTrace: trace,
      }
    }
  } catch {
    // fall through to heuristic
  }

  // 兜底：狼人优先杀跳预言家者，否则随机
  if (actionType === 'kill') {
    const claimed = findClaimedSeers(state)
    const priority = candidates.filter((c) => claimed.includes(c.id))
    if (priority.length > 0) {
      return { targetId: pickRandom(priority).id, reason: 'AI 输出无效，兜底选择疑似起跳预言家的目标' }
    }
  }
  return { targetId: pickRandom(candidates).id, reason: 'AI 输出无效，随机选择候选人兜底' }
}

export async function decideWerewolfKill(
  wolves: Player[],
  state: GameState,
  candidates: Player[]
): Promise<AiTargetDecision> {
  if (wolves.length === 0 || candidates.length === 0) return { targetId: null, reason: '没有存活狼人或可击杀目标' }

  const leader = wolves[0]
  const wolfNames = wolves.map((w) => w.name).join('、')
  const displayedCandidates = shuffleCopy(candidates)
  const hasPublicSpeech = state.speeches.length > 0
  const hasPublicVote = state.votes.length > 0
  const evidenceNote = `公开信息约束：${
    hasPublicSpeech ? '场上已有公开发言，可以引用真实发言内容。' : '目前还没有任何公开发言，理由里绝不能说某人“发言像神、带队、跳身份、逻辑矛盾”。'
  }${
    hasPublicVote ? '场上已有投票记录，可以引用真实票型。' : '目前还没有任何投票记录，理由里绝不能引用票型、跟票、冲票或归票。'
  }如果信息不足，请直接说明“首夜/信息不足下的刀法选择”，不要编造不存在的依据；不要因为某人排在列表前面或叫“玩家1”就默认选择他。`
  const task = `现在是狼人夜晚协商阶段。存活狼队成员：${wolfNames}。
可击杀目标：${displayedCandidates.map((c) => c.name).join('、')}。
请代表狼队选择今晚击杀目标。目标是推进屠边胜利：可以优先刀可信神职，也可以在平民较少时转向屠民。
判断时要结合白天发言、疑似身份、谁在带队、谁可能是预言家/女巫/守卫/猎人、以及击杀后是否接近屠神或屠民。
${evidenceNote}
返回 JSON：{"target":"玩家名字","reason":"狼队协商后的简短理由","route":"屠神或屠民或压制强好人"}`

  try {
    const perspective = buildPlayerPerspective(leader, state)
    const { parsed, trace } = await callAiJsonWithTrace(getInstruction(leader), perspective, task)
    const matched = matchPlayerByName(String(parsed.target ?? ''), candidates)
    if (matched) {
      const reason = sanitizeDecisionReason(parsed.reason, state)
      const route = typeof parsed.route === 'string' && parsed.route.trim() ? `；路线：${parsed.route.trim()}` : ''
      return { targetId: matched.id, reason: `${reason}${route}`, llmTrace: trace }
    }
  } catch {
    // fall through to heuristic
  }

  const claimed = findClaimedSeers(state)
  const priority = candidates.filter((c) => claimed.includes(c.id))
  if (priority.length > 0) return { targetId: pickRandom(priority).id, reason: 'AI 输出无效，兜底优先击杀疑似预言家' }
  return { targetId: pickRandom(candidates).id, reason: 'AI 输出无效，随机选择击杀目标兜底' }
}

// ───────────────────────── 女巫行动（救 / 毒）─────────────────────────
export async function decideWitchAction(
  witch: Player,
  state: GameState,
  killedId: string | null,
  poisonCandidates: Player[]
): Promise<{ heal: boolean; poisonTargetId: string | null; reason?: string; llmTrace?: AiRequestTrace }> {
  const canHeal = state.witchPotions.heal && !!killedId
  const canPoison = state.witchPotions.poison
  if (!canHeal && !canPoison) return { heal: false, poisonTargetId: null, reason: '解药和毒药都不可用' }

  const killedName = killedId ? state.players.find((p) => p.id === killedId)?.name : null
  const hasPublicSpeech = state.speeches.length > 0
  const hasPublicVote = state.votes.length > 0
  const evidenceNote = `公开信息约束：${
    hasPublicSpeech ? '场上已有公开发言，可以引用真实发言内容。' : '目前还没有任何公开发言，理由里绝不能说某人“发言可疑、带队、逻辑矛盾”。'
  }${
    hasPublicVote ? '场上已有投票记录，可以引用真实票型。' : '目前还没有任何投票记录，理由里绝不能引用票型。'
  }如果信息不足，请直接说明“不确定，保守用药/不用药”，不要编造不存在的依据。`

  const task = `现在是夜晚，你是女巫。${killedName ? `今晚被狼人袭击的是【${killedName}】。` : '今晚你没有获得袭击信息。'}
${canHeal ? `你可以用解药救活 ${killedName}（解药仅剩这一瓶）。` : '你的解药不可用（已用完或无人可救）。'}
${canPoison ? `你也可以用毒药毒杀一名你高度怀疑是狼人的玩家，可选：${poisonCandidates.map((c) => c.name).join('、')}。` : '你的毒药已用完。'}
注意：每晚最多只能用一瓶药。请综合局势谨慎决定，不确定时可以都不用、留着关键时刻。
请特别考虑轮次、被刀者价值、疑似神职/平民身份、谁的发言和票型最像狼人，以及药剂使用后是否能推进好人胜利。
${evidenceNote}
返回 JSON：{"heal": true或false, "poisonTarget":"玩家名字或null", "reason":"简短理由"}`

  try {
    const perspective = buildPlayerPerspective(witch, state)
    const { parsed, trace } = await callAiJsonWithTrace(getInstruction(witch), perspective, task)
    const reason = sanitizeDecisionReason(parsed.reason, state)
    const heal = canHeal && parsed.heal === true
    if (heal) return { heal: true, poisonTargetId: null, reason, llmTrace: trace } // 一晚只能用一瓶
    let poisonTargetId: string | null = null
    if (canPoison && parsed.poisonTarget && String(parsed.poisonTarget) !== 'null') {
      const matched = matchPlayerByName(String(parsed.poisonTarget), poisonCandidates)
      poisonTargetId = matched?.id ?? null
    }
    return { heal: false, poisonTargetId, reason, llmTrace: trace }
  } catch {
    // 兜底：第一晚有人被刀就救，其余不动
    return { heal: canHeal && state.round === 1, poisonTargetId: null, reason: canHeal && state.round === 1 ? 'AI 输出无效，首夜有人被刀按兜底使用解药' : 'AI 输出无效，女巫选择不用药兜底' }
  }
}

export async function decideWolfBeautyCharm(
  wolfBeauty: Player,
  state: GameState,
  candidates: Player[]
): Promise<AiTargetDecision> {
  if (candidates.length === 0) return { targetId: null, reason: '没有可魅惑目标' }
  const displayedCandidates = shuffleCopy(candidates)
  const publicClaimTargetIds = new Set(state.publicClaims.filter((c) => ['seer', 'witch', 'hunter', 'guard'].includes(c.claimType)).map((c) => c.claimantId))
  const pressureOnMe = state.votes.filter((v) => v.round === state.round && v.targetId === wolfBeauty.id).map((v) => state.players.find((p) => p.id === v.voterId)?.name).filter(Boolean).join('、')
  const priorityNames = candidates.filter((c) => publicClaimTargetIds.has(c.id)).map((c) => c.name).join('、')
  const task = `现在是夜晚，你是狼美人，请选择今晚魅惑的一名非狼人玩家。
如果你之后死亡，最近被魅惑且仍存活的玩家会殉情出局。
可选目标：${displayedCandidates.map((c) => c.name).join('、')}。
优先级：1）已跳预言家/女巫/守卫/猎人的关键神职；2）白天投你或强推你的人；3）强势带队好人；4）能帮助狼队接近屠神/屠民的关键边。${priorityNames ? `\n公开跳身份/报强信息者：${priorityNames}。` : ''}${pressureOnMe ? `\n本轮投你或明显给你压力的人：${pressureOnMe}。` : ''}不要因为列表顺序默认选择玩家1。
返回 JSON：{"target":"玩家名字","reason":"简短理由"}`

  try {
    const { parsed, trace } = await callAiJsonWithTrace(getInstruction(wolfBeauty), buildPlayerPerspective(wolfBeauty, state), task)
    const matched = matchPlayerByName(String(parsed.target ?? ''), candidates)
    if (matched) {
      return { targetId: matched.id, reason: sanitizeDecisionReason(parsed.reason, state), llmTrace: trace }
    }
  } catch {
    // fall through to heuristic
  }

  const claimed = findClaimedSeers(state)
  const claimPriority = candidates.filter((c) => claimed.includes(c.id) || state.publicClaims.some((pc) => pc.claimantId === c.id && ['seer', 'witch', 'hunter', 'guard'].includes(pc.claimType)))
  const pressurePriority = candidates.filter((c) => state.votes.some((v) => v.round === state.round && v.voterId === c.id && v.targetId === wolfBeauty.id))
  const fallback = claimPriority[0] ?? pressurePriority[0] ?? pickRandom(candidates)
  return { targetId: fallback.id, reason: claimPriority.length > 0 ? 'AI 输出无效，兜底魅惑公开强身份/疑似神职' : pressurePriority.length > 0 ? 'AI 输出无效，兜底魅惑白天给自己压力的玩家' : 'AI 输出无效，随机选择魅惑目标兜底' }
}

export async function decideWhiteWolfKingExplosion(
  whiteWolf: Player,
  state: GameState,
  candidates: Player[]
): Promise<AiTargetDecision & { explode: boolean }> {
  if (candidates.length === 0) return { explode: false, targetId: null, reason: '没有可自爆目标' }
  const wolfIds = new Set(state.players.filter((p) => isWerewolf(p.role)).map((p) => p.id))
  const claimedByRealSeer = state.publicClaims.some(
    (c) => c.claimType === 'seer' && c.result === 'werewolf' && c.targetId === whiteWolf.id && !wolfIds.has(c.claimantId)
  )
  const aliveWolves = state.players.filter((p) => p.isAlive && isWerewolf(p.role)).length
  const aliveVillagers = state.players.filter((p) => p.isAlive && !isWerewolf(p.role)).length
  const votesOnMe = state.votes.filter((v) => v.round === state.round && v.targetId === whiteWolf.id).length
  const maxOtherVotes = Math.max(0, ...state.players.filter((p) => p.isAlive && p.id !== whiteWolf.id).map((p) => state.votes.filter((v) => v.round === state.round && v.targetId === p.id).length))
  const highVotePressure = votesOnMe > 0 && votesOnMe >= maxOtherVotes
  const exposedPowerTargets = candidates.filter((c) => state.publicClaims.some((pc) => pc.claimantId === c.id && ['seer', 'witch', 'hunter', 'guard'].includes(pc.claimType)))
  const endgamePressure = aliveWolves <= 1 || aliveVillagers <= aliveWolves + 2
  // 只看到预言家/神职起跳，不足以立刻自爆；白狼王应先悍跳、冲锋或搅浑局势。
  // 只有自己被查杀、高票将出局、或接近屠边关键轮，才进入自爆评估。
  const urgency = claimedByRealSeer || highVotePressure || endgamePressure
  if (!urgency) return { explode: false, targetId: null, reason: '只是看到强身份起跳还不该立刻自爆，继续悍跳/冲锋或伪装发言' }

  const displayedCandidates = shuffleCopy(candidates)
  const task = `现在是白天讨论阶段，你是白狼王，可以选择是否自爆并带走一名玩家。
当前局势${claimedByRealSeer ? '：你已被真预言家查杀，身份压力很高。' : highVotePressure ? '：你当前处在高票/被推出风险中。' : endgamePressure ? '：狼队接近关键屠边轮，需要判断自爆是否能换掉关键好人。' : '：需要判断自爆是否能换掉关键好人。'}
可带走目标：${displayedCandidates.map((c) => c.name).join('、')}。${exposedPowerTargets.length ? `\n公开强身份/关键目标：${exposedPowerTargets.map((p) => p.name).join('、')}。` : ''}
只有当自爆能明显服务狼队时才爆；目标优先可信预言家、女巫、守卫、猎人或强势带队好人，避免带走狼同伴。
返回 JSON：{"explode": true或false, "target":"玩家名字或null", "reason":"简短理由"}`

  try {
    const { parsed, trace } = await callAiJsonWithTrace(getInstruction(whiteWolf), buildPlayerPerspective(whiteWolf, state), task)
    if (parsed.explode !== true) return { explode: false, targetId: null, reason: sanitizeDecisionReason(parsed.reason, state), llmTrace: trace }
    const matched = matchPlayerByName(String(parsed.target ?? ''), candidates)
    if (matched) return { explode: true, targetId: matched.id, reason: sanitizeDecisionReason(parsed.reason, state), llmTrace: trace }
  } catch {
    // fall through to heuristic
  }

  if (claimedByRealSeer) {
    const seerClaim = state.publicClaims.find((c) => c.claimType === 'seer' && c.result === 'werewolf' && c.targetId === whiteWolf.id && !wolfIds.has(c.claimantId))
    if (seerClaim && candidates.some((c) => c.id === seerClaim.claimantId)) {
      return { explode: true, targetId: seerClaim.claimantId, reason: '被真预言家查杀，兜底自爆带走预言家' }
    }
  }
  if (highVotePressure && exposedPowerTargets[0]) {
    return { explode: true, targetId: exposedPowerTargets[0].id, reason: '处在高票压力，兜底自爆带走公开强身份' }
  }
  return { explode: false, targetId: null, reason: 'AI 输出无效，且没有明确自爆收益，继续发言' }
}

// ───────────────────────── 猎人 / 狼王开枪 ─────────────────────────
export async function decideShotTarget(
  shooter: Player,
  state: GameState,
  candidates: Player[]
): Promise<AiTargetDecision & { shoot: boolean }> {
  if (candidates.length === 0) return { shoot: false, targetId: null, reason: '没有可射击目标' }

  const isWolfShooter = isWerewolf(shooter.role)
  const task = `你已经死亡，现在可以选择是否开枪带走一名玩家。
可选目标：${candidates.map((c) => c.name).join('、')}。
${isWolfShooter
  ? '你是狼王，优先带走可信神职、强势好人或能带队的玩家，避免射击疑似狼同伴。'
  : '你是猎人，优先射击你最确定的狼人；如果信息不足、容易误伤好人，可以选择不开枪。'}
请结合公开发言、投票票型、死亡信息、站边关系和当前屠边局势判断。
返回 JSON：{"shoot": true或false, "target":"玩家名字或null", "reason":"简短理由"}`

  try {
    const { parsed, trace } = await callAiJsonWithTrace(getInstruction(shooter), buildPlayerPerspective(shooter, state), task)
    if (parsed.shoot !== true) return { shoot: false, targetId: null, reason: sanitizeDecisionReason(parsed.reason, state), llmTrace: trace }
    const matched = matchPlayerByName(String(parsed.target ?? ''), candidates)
    if (matched) return { shoot: true, targetId: matched.id, reason: sanitizeDecisionReason(parsed.reason, state), llmTrace: trace }
  } catch {
    // fall through to heuristic
  }

  if (isWolfShooter) {
    const nonWolves = candidates.filter((p) => !isWerewolf(p.role))
    return { shoot: true, targetId: (nonWolves[0] ?? candidates[0]).id, reason: 'AI 输出无效，兜底射击非狼玩家' }
  }

  // 猎人兜底：没有足够把握时不开枪，避免随机误伤。
  return { shoot: false, targetId: null, reason: 'AI 输出无效，猎人保守不开枪' }
}
