# 枝间 Windows 发布

独立安装包仓库：https://github.com/DrChuan/Mindgrove 。仅上传安装包和更新清单，不上传源码、笔记或签名私钥，不发布 Gitee。

在当前 Mac 上双击 `发布枝间Windows.command`，使用 Mathdraw 已安装的交叉编译工具缓存，构建 Windows x64 NSIS 安装包、独立 EXE 和签名更新清单。产物位于 `产物/releases/<版本>/`。发布需要 gh 已登录且可联网。

发布新版本前同步修改 package.json、package-lock.json、Cargo.toml、Cargo.lock、tauri.conf.json 的版本。每个版本仅发布一次。

更新私钥位于 `.build-cache/signing/mindgrove.key`，应安全备份并持续沿用，禁止上传。程序启动及每四小时检查 GitHub，发现新版本提示打开下载页，由用户保存笔记后运行安装包。签名用于验证更新清单对应的更新包，不是 Windows Authenticode 证书。

Windows 包在 Mac 上交叉编译，尚未进行 Windows 实机运行验证。
