import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { instruction, perspective, task, json } = await req.json()

    const body: Record<string, unknown> = {
      model: 'deepseek-chat',
      // JSON 决策（投票/夜晚行动）只需短输出；自由发言给多一些
      max_tokens: json ? 320 : 280,
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: `${perspective}\n\n${task}` },
      ],
    }
    if (json) body.response_format = { type: 'json_object' }

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const err = await resp.text()
      console.error('DeepSeek error:', err)
      return NextResponse.json({ error: 'AI 调用失败' }, { status: 500 })
    }

    const data = await resp.json()
    const content: string = data.choices?.[0]?.message?.content ?? ''
    return NextResponse.json({ content })
  } catch (err) {
    console.error('AI route error:', err)
    return NextResponse.json({ error: 'AI 调用失败' }, { status: 500 })
  }
}
