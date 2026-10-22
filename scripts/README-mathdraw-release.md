# Mathdraw 一键发布

在当前 Mac 构建机上，双击项目根目录的 **发布Mathdraw.command**。

1. 选择“发布新版本”。
2. 选择升级第一、第二或第三位。按通常版本规则，升级前一位会把后面的位数清零，例如 `0.2.13 → 0.3.0`。
3. 可填写一句更新说明，确认后自动构建、签名并发布 Windows x64 与 Mac 通用版。

用户下次启动软件或点击“文件 → 检查更新”即可获取新版本。发布内容包括安装包、独立 EXE、Mac ZIP、签名更新包、更新清单及校验值。不会上传源码、密钥或用户草稿，也不会关闭正在运行的绘图窗口。

## 失败后继续

入口选择“继续上次未完成的发布”：沿用当前版本重建并继续上传，只能覆盖未公开的同版本草稿，不能覆盖公开版本。输出和日志保存在 `artifacts/mathdraw/releases/<版本号>/`。构建失败后保留已提升的版本，避免重试时又提升一次。

如果进程被强制终止、留下 `.build-cache/mathdraw-release.lock`，先确认没有发布脚本在运行，再删除该锁文件重试。

## 构建机要求

本入口复用当前 Mac 的 Node.js、Apple Command Line Tools（编译器和 macOS SDK，无需完整 Xcode）、Rust、cargo-xwin、LLVM、NSIS、GitHub CLI 和 Windows SDK 缓存。需要安装 Mac ARM64、Mac x64、Windows x64 的 Rust 目标及前端依赖；`gh` 已登录且拥有 `DrChuan/Mathdraw` 发布权限。前置检查失败时不会修改版本，应重新选择“发布新版本”；只有已经提升版本、开始构建的流程才选择“继续上次发布”。

更新签名密钥默认使用 `.build-cache/signing/mathdraw.key`，也可用 `TAURI_SIGNING_PRIVATE_KEY` 指定**密钥文件路径**，密码使用 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。迁移机器时须安全迁移原密钥，不能生成新密钥替代。密钥不进入 GitHub。

发布前校验更新签名和版本，上传后核对 GitHub SHA-256，通过后才公开 Release。Windows 产物在 Mac 上交叉编译；不代表 Windows 实际运行检查。此流程不自动运行测试，macOS 未公证，Windows 没有 Authenticode 证书。

Windows 本机仅打包的入口仍是 `scripts/build-mathdraw-windows.ps1`。
