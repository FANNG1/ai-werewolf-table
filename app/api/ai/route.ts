import { NextRequest, NextResponse } from 'next/server'
import { applyProviderTuning, resolveAiProvider } from '../../lib/aiProvider'

export async function POST(req: NextRequest) {
  try {
    const { instruction, perspective, task, json, maxTokens } = await req.json()
    const cfg = resolveAiProvider()

    const body: Record<string, unknown> = {
      model: cfg.model,
      // 调用方可按类型指定预算：发言/遗言/计划需要更多 token；短决策（投票/夜晚）保持精简
      max_tokens: typeof maxTokens === 'number' ? maxTokens : json ? 320 : 280,
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: `${perspective}\n\n${task}` },
      ],
    }
    if (json) body.response_format = { type: 'json_object' }
    applyProviderTuning(body, cfg)

    // 超时保护：模型挂住时中断，避免服务端路由无限等待
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 40000)
    let resp: Response
    try {
      resp = await fetch(cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!resp.ok) {
      const err = await resp.text()
      console.error(`${cfg.provider} error:`, err)
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
