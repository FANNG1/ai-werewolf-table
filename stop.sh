#!/bin/bash

PID=$(lsof -ti tcp:3000)
if [ -z "$PID" ]; then
  echo "服务器未运行"
else
  kill "$PID"
  echo "已停止 (PID $PID)"
fi
