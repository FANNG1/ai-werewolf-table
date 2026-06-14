import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const {
      roleContext,
      levelInstruction,
      playerName,
      round,
      aliveNames,
      lastNightDeaths,
      recentSpeeches,
      extraContext,
    } = await req.json()

    const systemPrompt = `你是一个狼人杀游戏AI玩家。
${levelInstruction}
${roleContext}

游戏规则：狼人阵营消灭好人阵营即胜利，好人找出所有狼人即胜利。
不要在发言中暴露你的角色。发言要真实自然，像真人玩家。`

    const userPrompt = `现在是第${round}天白天讨论阶段。

昨晚：${lastNightDeaths}
存活玩家：${aliveNames}

本轮已有发言：
${recentSpeeches || '（你是第一个发言的）'}

${extraContext ? `额外信息：${extraContext}` : ''}

请以玩家「${playerName}」的身份发言，100字以内，中文，直接给出发言内容，不要加前缀。`

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!resp.ok) {
      const err = await resp.text()
      console.error('DeepSeek error:', err)
      return NextResponse.json({ error: 'AI发言失败' }, { status: 500 })
    }

    const data = await resp.json()
    const content: string = data.choices?.[0]?.message?.content ?? ''
    return NextResponse.json({ content })
  } catch (err) {
    console.error('AI speak error:', err)
    return NextResponse.json({ error: 'AI发言失败' }, { status: 500 })
  }
}
