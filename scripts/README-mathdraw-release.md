# Mathdraw 一键发布

在当前 Mac 构建机上，双击项目根目录的 **发布Mathdraw.command**。

1. 选择“发布新版本”。
2. 选择升级第一、第二或第三位。按通常版本规则，升级前一位会把后面的位数清零，例如 `0.2.13 → 0.3.0`。
3. 可填写一句更新说明，确认后自动构建、签名并发布 Windows x64 与 Mac 通用版到 GitHub 和 Gitee。

用户下次启动软件或点击“文件 → 检查更新”即可获取新版本。发布内容包括安装包、独立 EXE、Mac ZIP、签名更新包、更新清单及校验值。不会上传源码、密钥或用户草稿，也不会关闭正在运行的绘图窗口。

## 失败后继续

入口选择“继续上次未完成的发布”：沿用当前版本继续。已有完整安装包时先复用并重新验证签名与版本；安装包不完整才重新构建。GitHub 草稿通过发布 ID 校验，已匹配的附件跳过上传；如果 GitHub 已公开、只有 Gitee 镜像未完成，会校验并复用原签名包，只补传镜像，不重建或覆盖公开安装包。输出和日志保存在 `产物/releases/<版本号>/`。构建失败后保留已提升的版本，避免重试时又提升一次。

如果进程被强制终止、留下 `.build-cache/mathdraw-release.lock`，先确认没有发布脚本在运行，再删除该锁文件重试。

## 构建机要求

本入口复用当前 Mac 的 Node.js、Apple Command Line Tools（编译器和 macOS SDK，无需完整 Xcode）、Rust、cargo-xwin、LLVM、NSIS、GitHub CLI 和 Windows SDK 缓存。需要安装 Mac ARM64、Mac x64、Windows x64 的 Rust 目标及前端依赖；`gh` 已登录且拥有 `DrChuan/Mathdraw` 发布权限。前置检查失败时不会修改版本，应重新选择“发布新版本”；只有已经提升版本、开始构建的流程才选择“继续上次发布”。

NSIS 如已安装到本项目 `.build-cache/nsis/makensis/<版本>/`，发布入口会自动生成使用相对路径的启动包装脚本，并设置正确的资源目录；移动项目文件夹后无需重新安装。

缓存 LLVM 如仍引用旧项目 `.build-cache` 中的动态库，发布入口会自动改为相对动态库路径并重新签名缓存工具；同时在构建前检查 `clang-cl` 能否运行。移动项目时须一并保留缓存中的依赖库（例如 Z3）。缺少依赖会在发布前明确提示，不会等到 Windows 编译中途才失败。

更新签名密钥默认使用 `.build-cache/signing/mathdraw.key`，也可用 `TAURI_SIGNING_PRIVATE_KEY` 指定**密钥文件路径**，密码使用 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。迁移机器时须安全迁移原密钥，不能生成新密钥替代。密钥不进入 GitHub。

发布前校验更新签名和版本，上传后核对 GitHub SHA-256，通过后才公开 Release。随后向 Gitee 上传同一组文件并匿名下载校验，全部通过后才更新 Gitee 的 latest.json。Windows 产物在 Mac 上交叉编译；不代表 Windows 实际运行检查。此流程不自动运行测试，macOS 未公证，Windows 没有 Authenticode 证书。

Windows 本机仅打包的入口仍是 `scripts/build-mathdraw-windows.ps1`。

## Gitee 镜像与更新检查

镜像仓库：https://gitee.com/liu_chuanning/mathdraw 。GitHub 仍使用 DrChuan/Mathdraw。

首次使用请在 Gitee 创建仅 `projects` 权限的私人令牌，然后双击 **配置Gitee发布.command** 粘贴。令牌保存到 macOS 钥匙串 `lab.chuan.mathdraw.gitee-publish`，不会写进源码、安装包或日志。发布机也可使用 `GITEE_TOKEN` 环境变量。令牌权限可访问账号的项目，应妥善保管；不需要时可在 Gitee 撤销。

新构建的程序启动后先查 Gitee（最多 4 秒）；没有新版本或连接失败，再在后台查 GitHub（最多 8 秒），不会锁住编辑区。Gitee 更新清单中的下载地址也指向 Gitee，两个来源继续使用同一套更新签名校验。旧版程序需要先更新一次，才能使用新检查顺序。

仅将已有签名版本补传至 Gitee（不会修改 GitHub 或提升版本）：

```sh
node 数学绘图/scripts/publish-mathdraw.mjs 数学绘图/产物/releases/0.3.2 --gitee-only
```
