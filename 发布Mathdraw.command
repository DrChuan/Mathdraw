#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print '找不到 Node.js，请先安装 Node.js 后重试。'
else
  print '1. 发布新版本（选择升级第几位版本号）'
  print '2. 继续上次未完成的发布（不增加版本号）'
  print '0. 取消'
  read 'choice?请选择 [1]：'
  case "${choice:-1}" in
    1) node scripts/release-mathdraw.mjs ;;
    2) node scripts/release-mathdraw.mjs --resume ;;
    0) print '已取消。' ;;
    *) print '无效选项。' ;;
  esac
fi
read '?按回车关闭窗口…'
