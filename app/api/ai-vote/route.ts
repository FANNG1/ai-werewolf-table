import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const {
      roleContext,
      levelInstruction,
      playerName,
      round,
      allSpeeches,
      candidateNames,
      lastNightDeaths,
    } = await req.json()

    const systemPrompt = `你正在玩狼人杀，你是玩家「${playerName}」。
${levelInstruction}
${roleContext}

现在是第${round}天的投票阶段，你要根据白天的发言和场上局势，决定投票放逐谁。

投票原则：
- 如果你是好人阵营：投出你认为最可能是狼人的玩家。重点关注谁的发言有逻辑漏洞、谁在带歪节奏、谁的验人/起跳信息可信。如果有人跳预言家并给出验人结果，要认真判断他的真假，可信就跟投他指认的狼。
- 如果你是狼人阵营：投票陷害好人，优先把水搅浑或把矛头引向跳预言家的好人/关键神职，保护自己和同伴。但不要太明显。
- 必须从候选人中选一个，不能弃票。

只返回 JSON，格式：{"target": "玩家名字", "reason": "你投票的简短理由"}`

    const userPrompt = `本轮可投票的候选人：${candidateNames}

昨晚情况：${lastNightDeaths}

今天所有人的发言记录：
${allSpeeches || '（暂无发言）'}

请决定你要投谁出局，只返回 JSON。`

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!resp.ok) {
      const err = await resp.text()
      console.error('DeepSeek vote error:', err)
      return NextResponse.json({ error: '投票决策失败' }, { status: 500 })
    }

    const data = await resp.json()
    const raw: string = data.choices?.[0]?.message?.content ?? '{}'
    let target = ''
    let reason = ''
    try {
      const parsed = JSON.parse(raw)
      target = parsed.target ?? ''
      reason = parsed.reason ?? ''
    } catch {
      // ignore parse error, caller will fall back to random
    }
    return NextResponse.json({ target, reason })
  } catch (err) {
    console.error('Vote decision error:', err)
    return NextResponse.json({ error: '投票决策失败' }, { status: 500 })
  }
}
