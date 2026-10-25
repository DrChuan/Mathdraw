#!/bin/zsh
cd "$(dirname "$0")"
node scripts/release-windows.mjs --publish
read '?按回车关闭'
