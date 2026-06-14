import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { transcript, humanNames } = await req.json()

    const systemPrompt = `你是一位资深的狼人杀教练，擅长复盘对局、分析玩家的发言逻辑与决策。
现在游戏已经结束，所有玩家的真实身份都已公开。请你站在上帝视角，对真人玩家的表现进行深度复盘分析。

分析时请重点关注真人玩家（${humanNames}）：
1. **发言逻辑**：发言是否有理有据？有没有逻辑漏洞、前后矛盾、或暴露身份的失误？
2. **关键决策**：夜晚行动（如验人、用药、守护、刀人）和白天投票的选择是否合理？错过了哪些信息？
3. **阵营配合**：是否打出了角色应有的价值？（好人有没有抓对狼，狼有没有藏好、带对节奏）
4. **改善建议**：给出 2-4 条具体、可操作的提升建议。

要求：
- 用中文，语气友好鼓励（可能是和孩子一起玩），先肯定做得好的地方再指出不足
- 用 Markdown 分段，配合小标题和要点
- 结合具体的回合和发言来举例，不要泛泛而谈
- 总字数控制在 600 字以内`

    const userPrompt = `以下是完整对局记录，请复盘分析：\n\n${transcript}`

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 1500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!resp.ok) {
      const err = await resp.text()
      console.error('DeepSeek analyze error:', err)
      return NextResponse.json({ error: '分析失败' }, { status: 500 })
    }

    const data = await resp.json()
    const content: string = data.choices?.[0]?.message?.content ?? ''
    return NextResponse.json({ content })
  } catch (err) {
    console.error('Analyze error:', err)
    return NextResponse.json({ error: '分析失败' }, { status: 500 })
  }
}
