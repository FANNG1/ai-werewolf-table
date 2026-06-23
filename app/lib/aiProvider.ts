// AI 服务商配置：默认 DeepSeek，设 AI_PROVIDER=qwen 即切换到千问（阿里云百炼 OpenAI 兼容端点）。
// 两个端点都兼容 OpenAI Chat Completions 格式，所以只需切换 url/key/model。
export interface ProviderConfig {
  url: string
  key: string | undefined
  model: string
  provider: 'deepseek' | 'qwen'
}

function baseProvider(): ProviderConfig {
  const provider = (process.env.AI_PROVIDER || 'deepseek').toLowerCase()
  if (provider === 'qwen') {
    return {
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      key: process.env.DASHSCOPE_API_KEY,
      model: process.env.AI_MODEL || 'qwen-plus',
      provider: 'qwen',
    }
  }
  return {
    url: 'https://api.deepseek.com/chat/completions',
    key: process.env.DEEPSEEK_API_KEY,
    model: process.env.AI_MODEL || 'deepseek-chat',
    provider: 'deepseek',
  }
}

// 游戏内决策/发言用的模型（要求快 + JSON，走非思考快档）
export function resolveAiProvider(): ProviderConfig {
  return baseProvider()
}

// 赛后教练复盘用的模型（可单独配更强的模型，慢一点无所谓）
export function resolveAnalyzeProvider(): ProviderConfig {
  const base = baseProvider()
  const model =
    process.env.AI_ANALYZE_MODEL || (base.provider === 'qwen' ? 'qwen-max' : 'deepseek-chat')
  return { ...base, model }
}

// 千问(Qwen3)默认可能开启思考模式，而思考模式通常要求流式输出，
// 与我们「非流式 + JSON」的游戏内调用冲突，所以显式关闭以走快档。
export function applyProviderTuning(body: Record<string, unknown>, cfg: ProviderConfig): void {
  if (cfg.provider === 'qwen') {
    body.enable_thinking = false
  }
}
