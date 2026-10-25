#!/bin/zsh
cd -- "$(dirname "$0")"
node scripts/launch-notes.mjs
if [ $? -ne 0 ]; then
  read "?按回车关闭窗口…"
fi
