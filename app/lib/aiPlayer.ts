import type { AiLevel, GameState, Player, Role } from './types'
import { ROLE_NAMES, isWerewolf } from './roles'

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
    priv.push(
      `你的药剂：解药${state.witchPotions.heal ? '【可用】' : '【已用完】'}，毒药${state.witchPotions.poison ? '【可用】' : '【已用完】'}`
    )
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
  const alive = state.players.filter((p) => p.isAlive)
  lines.push(`第${state.round}天。存活玩家：${alive.map((p) => p.name).join('、')}`)
  const dead = state.players.filter((p) => !p.isAlive)
  if (dead.length) {
    lines.push(`已出局：${dead.map((p) => `${p.name}（${ROLE_NAMES[p.role]}）`).join('、')}`)
  }

  const publicSignals = buildPublicSignalSummary(state)
  if (publicSignals.length > 0) {
    lines.push('')
    lines.push('【公开关键信息摘要】')
    publicSignals.forEach((s) => lines.push('- ' + s))
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
    // 发言全文只保留最近两轮，更早的轮次只提示有过讨论，避免 prompt 过长拖慢
    const sps = state.speeches.filter((s) => s.round === r)
    if (sps.length > 0) {
      hasHistory = true
      if (r >= state.round - 1) {
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

// ───────────────────────── 角色 / 难度指令 ─────────────────────────
function getLevelInstruction(level: AiLevel, role: Role): string {
  if (level === 'easy') {
    return '你是新手玩家，逻辑不够严密，有时会判断失误、怀疑错人，发言比较直白简单。'
  }
  if (level === 'medium') {
    return '你是中等水平玩家，能进行基本的逻辑推理，发言较合理，偶有小失误。'
  }
  if (isWerewolf(role)) {
    return '你是高手级狼人，冷静理性，善于伪装成好人、构造合理的误导、带节奏让好人内斗，并保护狼同伴。'
  }
  return '你是高手级好人，高度理性，综合所有发言、死亡和投票信息进行严密推理，精准锁定狼人。'
}

function getRoleStrategy(role: Role): string {
  switch (role) {
    case 'werewolf':
      return `你的狼人策略：
- 白天优先伪装成闭眼好人，用公开信息做推理，不要显得知道太多。
- 根据局势选择倒钩、冲票或轻踩队友；不要无脑保护狼同伴。
- 如果场上预言家信息威胁狼队，可以质疑其验人逻辑、身份动机或站边关系。
- 狼人胜利条件是屠边：杀光所有神职或所有平民，而不是必须杀光全部好人。`
    case 'wolf_king':
      return `你的狼王策略：
- 白天按狼人打法伪装，尽量活到关键轮次。
- 被放逐时可以开枪，优先带走可信预言家、女巫、猎人、守卫，或发言最能带队的好人。
- 不要随意开枪带走疑似狼同伴。
- 狼人胜利条件是屠边：杀光所有神职或所有平民。`
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
- 发言时可以分析银水、死亡信息和疑点，但不要无必要暴露女巫身份。`
    case 'hunter':
      return `你的猎人策略：
- 白天主要像好人一样分析发言、票型和站边。
- 被杀或被放逐后开枪要谨慎，优先射击最高狼面玩家；信息不足时可以不开枪。
- 如果你已经明确怀疑某人是狼，可以在发言中留下枪口压力。`
    case 'guard':
      return `你的守卫策略：
- 守护目标应优先考虑疑似预言家、女巫、强势好人或可能被狼人刀的玩家。
- 不能连续两晚守同一个人。
- 发言时不要随意暴露守护记录，除非能帮助好人排坑或证明逻辑。`
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
- 区分“我知道的信息”和“我推测的信息”，不要把推测说成确定事实。
- 发言要像真实玩家：有立场、有理由，可以怀疑但不要机械罗列。
- 当前采用屠边规则：好人胜利=所有狼人出局；狼人胜利=所有神职出局或所有平民出局。`
}

function getInstruction(player: Player): string {
  return `你正在玩中文狼人杀游戏。${getLevelInstruction(player.aiLevel || 'medium', player.role)}

游戏规则：
- 好人胜利：所有狼人出局。
- 狼人胜利：屠边，即所有神职出局，或所有平民出局。
- 预言家每晚查验一人的好坏；女巫有1瓶解药和1瓶毒药，各用一次，每晚最多用一瓶；守卫每晚守护一人，不能连续两晚守同一人；猎人/狼王死亡时可开枪带走一人。

${getRoleStrategy(player.role)}

${getCommonReasoningInstruction()}

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

// ───────────────────────── 通用 AI 调用 ─────────────────────────
async function callAi(
  instruction: string,
  perspective: string,
  task: string,
  json = false
): Promise<string> {
  const resp = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction, perspective, task, json }),
  })
  if (!resp.ok) throw new Error('AI 调用失败')
  const data = await resp.json()
  return (data.content as string) || ''
}

async function callAiJson(
  instruction: string,
  perspective: string,
  task: string
): Promise<Record<string, unknown>> {
  let lastRaw = ''
  for (let i = 0; i < 2; i++) {
    const retryHint = i === 0
      ? ''
      : `\n\n上一次输出不是合法 JSON。请只返回一个 JSON 对象，不要 Markdown，不要解释。上一次输出：${lastRaw.slice(0, 200)}`
    lastRaw = await callAi(instruction, perspective, task + retryHint, true)
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

function matchPlayerByName(name: string, candidates: Player[]): Player | undefined {
  const n = (name || '').trim()
  if (!n) return undefined
  return candidates.find((c) => n.includes(c.name) || c.name.includes(n))
}

// ───────────────────────── 发言 ─────────────────────────
export async function generateAiSpeech(player: Player, state: GameState): Promise<string> {
  const perspective = buildPlayerPerspective(player, state)
  const wolfPlanNote =
    isWerewolf(player.role) && state.wolfPlan && state.wolfPlanRound === state.round
      ? `\n\n【狼队昨晚商定的作战计划（仅狼队知道，作为参考而非死命令）】\n${state.wolfPlan}\n注意：这是昨晚在不知道天亮结果时预先定的计划。如果天亮后的死亡情况、其他人的发言或当前票型与计划的设想不符，你要临场灵活调整、随机应变，不必机械照搬；用你自己的话表达，绝不能照搬原文，也不要暴露存在“计划”。`
      : ''
  const task = `现在是第${state.round}天白天讨论阶段，轮到你发言。
请基于你掌握的信息，以「${player.name}」的身份说一段话（第一人称、100字以内、中文）。
要符合你的角色立场和当前局势：好人要分析谁可疑、推动找狼；狼人要伪装好人、误导视线。
发言必须包含至少一个具体判断或倾向，例如：站边谁、怀疑谁、认可谁、为什么。
如果你是预言家/女巫/守卫/猎人等神职，可以在收益足够时选择起跳或给出压力，但不要无意义暴露身份。${wolfPlanNote}
直接输出发言内容，不要加前缀。`
  try {
    return await callAi(getInstruction(player), perspective, task)
  } catch {
    return '我再听听大家怎么说，先过。'
  }
}

// ───────────────────────── 狼队夜间作战计划 ─────────────────────────
// 真实规则：白天狼人无法私聊，协商只能发生在夜晚。狼队睁眼时商定一份次日计划
// （谁悍跳/谁深水/推谁/是否倒钩），但此时【还不知道天亮后的实际死亡结果】。
// 白天各 AI 狼把它当作参考、并根据真实局势临场应变（见 generateAiSpeech）。
export async function generateWolfPlan(wolves: Player[], state: GameState): Promise<string> {
  if (wolves.length === 0) return ''
  const leader = wolves[0]
  const wolfNames = wolves.map((w) => w.name).join('、')
  const killId = state.nightActions
    .filter((a) => a.round === state.round && a.actionType === 'kill')
    .map((a) => a.targetId)[0]
  const killName = killId ? state.players.find((p) => p.id === killId)?.name : null
  const task = `现在是第${state.round}天夜晚，狼队睁眼商议明天白天的作战计划。${killName ? `你们今晚决定击杀【${killName}】（但天亮前并不知道是否击杀成功，也不知道女巫/守卫是否干预）。` : ''}
存活狼队成员：${wolfNames}。
请在【还不知道天亮后实际死亡结果】的前提下，结合已有发言和局势，预先商定一个简短、可执行的次日计划：
1) 谁悍跳预言家或起跳神职（若需要），谁深水扮普通好人；
2) 明天重点把哪个好人推出局（嫁祸目标）；
3) 是否安排有人倒钩（假意踩狼同伴）来骗取信任；
4) 统一话术基调，避免狼队发言互相矛盾或暴露同伴。
注意：这只是预案，白天可能要根据真实死亡和发言临场调整。用 3-4 条要点中文输出，简洁直接，不要解释。`
  try {
    return await callAi(getInstruction(leader), buildPlayerPerspective(leader, state), task)
  } catch {
    return ''
  }
}

// ───────────────────────── 遗言 ─────────────────────────
export async function generateLastWords(player: Player, state: GameState): Promise<string> {
  const perspective = buildPlayerPerspective(player, state)
  const camp = isWerewolf(player.role)
    ? '你是狼人，遗言可以继续伪装、误导好人、嫁祸他人或为狼队争取利益（比如反咬可信好人、扰乱归票）。'
    : '你是好人，遗言要把你掌握的信息和判断清楚留给场上：表明身份、给出怀疑对象、建议大家归票谁。'
  const seerNote =
    player.role === 'seer'
      ? '你是预言家，务必报出你的全部查验结果（金水/查杀）和站边，这是好人最关键的信息。'
      : player.role === 'witch'
        ? '你是女巫，可以视情况公布解药/毒药的使用情况和由此得到的信息（如银水、毒杀结果）。'
        : ''
  const task = `你刚刚被投票放逐出局，现在是你的遗言时间（你出局后身份会公开）。
请以「${player.name}」的身份发表遗言（第一人称、100字以内、中文）。
${camp}
${seerNote}
直接输出遗言内容，不要加前缀。`
  try {
    return await callAi(getInstruction(player), perspective, task)
  } catch {
    return '我没什么好说的了，大家好好分析，找出狼人。'
  }
}

// ───────────────────────── 投票 ─────────────────────────
export async function generateAiVote(
  player: Player,
  state: GameState,
  candidates: Player[]
): Promise<string | null> {
  if (candidates.length === 0) return null
  const perspective = buildPlayerPerspective(player, state)

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

  const task = `现在是投票放逐阶段，本轮采用依次公开投票。候选人：${candidates.map((c) => c.name).join('、')}。
${tallyLine}
请基于你掌握的信息决定投票放逐谁，并参考当前票型：
- 好人要优先投最高狼面玩家，结合发言矛盾、对跳可信度、死亡信息；当票型已形成对某个高狼面玩家的合力时可以跟票归票，集中放逐。
- 狼人要优先推动放逐关键好人或错误焦点，可借票型把水搅浑、分票自保或假意跟好人票；可以倒钩狼同伴，但不能无脑保护或无脑卖队友。
必须选一个，不能弃票。
返回 JSON：{"target":"玩家名字","reason":"简短理由"}`
  try {
    const parsed = await callAiJson(getInstruction(player), perspective, task)
    const matched = matchPlayerByName(String(parsed.target ?? ''), candidates)
    if (matched) return matched.id
  } catch {
    // fall through to random
  }
  return pickRandom(candidates).id
}

// ───────────────────────── 夜晚行动（守卫/狼人/预言家）─────────────────────────
export async function decideNightAction(
  player: Player,
  state: GameState,
  actionType: 'protect' | 'kill' | 'check',
  candidates: Player[]
): Promise<string | null> {
  if (candidates.length === 0) return null

  const taskMap: Record<typeof actionType, string> = {
    protect: `现在是夜晚，你是守卫，请选择今晚守护的玩家。优先保护你判断可能是预言家/女巫等神职、发言能带队的好人、或今晚最可能被狼刀的人。不能守护你上一晚守过的人。`,
    kill: `现在是夜晚，狼队要选择今晚击杀的目标。目标是推进屠边：优先击杀可信神职、已跳预言家/女巫/守卫/猎人、报出强验人信息者、或能带队的强好人。也可以根据局势选择屠民路线。`,
    check: `现在是夜晚，你是预言家，请选择今晚查验的玩家。优先查验发言矛盾、站边摇摆、票型异常、或查验后最能打开局面的玩家，不要重复查验已验过的人。`,
  }

  const task = `${taskMap[actionType]}
可选目标：${candidates.map((c) => c.name).join('、')}。
返回 JSON：{"target":"玩家名字","reason":"简短理由"}`

  try {
    const parsed = await callAiJson(getInstruction(player), buildPlayerPerspective(player, state), task)
    const matched = matchPlayerByName(String(parsed.target ?? ''), candidates)
    if (matched) return matched.id
  } catch {
    // fall through to heuristic
  }

  // 兜底：狼人优先杀跳预言家者，否则随机
  if (actionType === 'kill') {
    const claimed = findClaimedSeers(state)
    const priority = candidates.filter((c) => claimed.includes(c.id))
    if (priority.length > 0) return pickRandom(priority).id
  }
  return pickRandom(candidates).id
}

export async function decideWerewolfKill(
  wolves: Player[],
  state: GameState,
  candidates: Player[]
): Promise<string | null> {
  if (wolves.length === 0 || candidates.length === 0) return null

  const leader = wolves[0]
  const wolfNames = wolves.map((w) => w.name).join('、')
  const task = `现在是狼人夜晚协商阶段。存活狼队成员：${wolfNames}。
可击杀目标：${candidates.map((c) => c.name).join('、')}。
请代表狼队选择今晚击杀目标。目标是推进屠边胜利：可以优先刀可信神职，也可以在平民较少时转向屠民。
判断时要结合白天发言、疑似身份、谁在带队、谁可能是预言家/女巫/守卫/猎人、以及击杀后是否接近屠神或屠民。
返回 JSON：{"target":"玩家名字","reason":"狼队协商后的简短理由","route":"屠神或屠民或压制强好人"}`

  try {
    const parsed = await callAiJson(getInstruction(leader), buildPlayerPerspective(leader, state), task)
    const matched = matchPlayerByName(String(parsed.target ?? ''), candidates)
    if (matched) return matched.id
  } catch {
    // fall through to heuristic
  }

  const claimed = findClaimedSeers(state)
  const priority = candidates.filter((c) => claimed.includes(c.id))
  if (priority.length > 0) return pickRandom(priority).id
  return pickRandom(candidates).id
}

// ───────────────────────── 女巫行动（救 / 毒）─────────────────────────
export async function decideWitchAction(
  witch: Player,
  state: GameState,
  killedId: string | null,
  poisonCandidates: Player[]
): Promise<{ heal: boolean; poisonTargetId: string | null }> {
  const canHeal = state.witchPotions.heal && !!killedId
  const canPoison = state.witchPotions.poison
  if (!canHeal && !canPoison) return { heal: false, poisonTargetId: null }

  const killedName = killedId ? state.players.find((p) => p.id === killedId)?.name : null

  const task = `现在是夜晚，你是女巫。${killedName ? `今晚被狼人袭击的是【${killedName}】。` : '今晚你没有获得袭击信息。'}
${canHeal ? `你可以用解药救活 ${killedName}（解药仅剩这一瓶）。` : '你的解药不可用（已用完或无人可救）。'}
${canPoison ? `你也可以用毒药毒杀一名你高度怀疑是狼人的玩家，可选：${poisonCandidates.map((c) => c.name).join('、')}。` : '你的毒药已用完。'}
注意：每晚最多只能用一瓶药。请综合局势谨慎决定，不确定时可以都不用、留着关键时刻。
请特别考虑轮次、被刀者价值、疑似神职/平民身份、谁的发言和票型最像狼人，以及药剂使用后是否能推进好人胜利。
返回 JSON：{"heal": true或false, "poisonTarget":"玩家名字或null", "reason":"简短理由"}`

  try {
    const parsed = await callAiJson(getInstruction(witch), buildPlayerPerspective(witch, state), task)
    const heal = canHeal && parsed.heal === true
    if (heal) return { heal: true, poisonTargetId: null } // 一晚只能用一瓶
    let poisonTargetId: string | null = null
    if (canPoison && parsed.poisonTarget && String(parsed.poisonTarget) !== 'null') {
      const matched = matchPlayerByName(String(parsed.poisonTarget), poisonCandidates)
      poisonTargetId = matched?.id ?? null
    }
    return { heal: false, poisonTargetId }
  } catch {
    // 兜底：第一晚有人被刀就救，其余不动
    return { heal: canHeal && state.round === 1, poisonTargetId: null }
  }
}

// ───────────────────────── 猎人 / 狼王开枪 ─────────────────────────
export async function decideShotTarget(
  shooter: Player,
  state: GameState,
  candidates: Player[]
): Promise<string | null> {
  if (candidates.length === 0) return null

  const isWolfShooter = isWerewolf(shooter.role)
  const task = `你已经死亡，现在可以选择是否开枪带走一名玩家。
可选目标：${candidates.map((c) => c.name).join('、')}。
${isWolfShooter
  ? '你是狼王，优先带走可信神职、强势好人或能带队的玩家，避免射击疑似狼同伴。'
  : '你是猎人，优先射击你最确定的狼人；如果信息不足、容易误伤好人，可以选择不开枪。'}
请结合公开发言、投票票型、死亡信息、站边关系和当前屠边局势判断。
返回 JSON：{"shoot": true或false, "target":"玩家名字或null", "reason":"简短理由"}`

  try {
    const parsed = await callAiJson(getInstruction(shooter), buildPlayerPerspective(shooter, state), task)
    if (parsed.shoot !== true) return null
    const matched = matchPlayerByName(String(parsed.target ?? ''), candidates)
    if (matched) return matched.id
  } catch {
    // fall through to heuristic
  }

  if (isWolfShooter) {
    const nonWolves = candidates.filter((p) => !isWerewolf(p.role))
    return (nonWolves[0] ?? candidates[0]).id
  }

  // 猎人兜底：没有足够把握时不开枪，避免随机误伤。
  return null
}
