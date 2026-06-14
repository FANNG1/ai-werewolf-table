#!/bin/bash
set -e

cd "$(dirname "$0")"

# Check for .env.local
if [ ! -f .env.local ]; then
  echo "⚠️  未找到 .env.local，请先配置 DeepSeek API Key："
  echo ""
  echo "  echo 'DEEPSEEK_API_KEY=sk-你的密钥' > .env.local"
  echo ""
  exit 1
fi

# Install dependencies if node_modules is missing
if [ ! -d node_modules ]; then
  echo "📦 安装依赖..."
  npm install
fi

echo "🐺 启动狼人杀服务器..."
echo "   访问 http://localhost:3000"
echo "   按 Ctrl+C 停止"
echo ""
npm run dev
