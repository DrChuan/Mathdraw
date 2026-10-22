# Windows EXE 打包

在 **Windows 10/11 x64** 上使用完整项目源码（保留 apps/mindmap-notes 和 scripts 的相对位置）。本脚本不在 macOS 上交叉编译 Windows 程序。

## 准备环境

- Node.js 22.12 以上，建议 Node 24 或 26。
- Rust 和 Cargo，安装 MSVC 目标：`rustup target add x86_64-pc-windows-msvc`。
- Visual Studio Build Tools，勾选“使用 C++ 的桌面开发”、MSVC 工具和 Windows SDK。
- 运行绘图程序需要 Microsoft Edge WebView2 Runtime。首次安装 npm、Tauri/NSIS 构建依赖时需要网络。

## 使用

在项目根目录双击 `打包数学绘图Windows.cmd`，默认只构建独立的 Mathdraw。也可在 PowerShell 中运行：

```powershell
.\scripts\build-mathdraw-windows.ps1
```

同时构建笔记程序：

```powershell
.\scripts\build-mathdraw-windows.ps1 -IncludeNotes
```

默认先按锁文件执行 npm ci，再构建 NSIS 安装包。如果依赖已安装且锁文件未变化，可以加 `-SkipInstall`。

## 输出

- `artifacts/mathdraw/windows/Mathdraw_…_x64-setup.exe`：安装程序。
- `artifacts/mathdraw/windows/mathdraw.exe`：单独启动的程序文件，需要已安装 WebView2 Runtime。
- `artifacts/mathdraw/windows/build-info.json`：本次成功输出的路径、构建时间、Node 版本与 SHA-256。
- 加 `-IncludeNotes` 时，Mindgrove 对应输出在 `artifacts/mindgrove/windows/`。

脚本在命令失败或输出缺失时停止，不把旧文件报告成本轮成功构建。输出没有代码签名。

## 2026-10-19 实际交付

已在 macOS 使用 cargo-xwin、微软 SDK、LLVM 23.1.1 与 NSIS 3.13 交叉编译 `x86_64-pc-windows-msvc`，生成上述两份 EXE。Windows 11 ARM 虚拟机已成功启动 x64 程序，传输后 SHA-256 与本机一致；经用户授权完成 NSIS 安装向导，安装后的程序也成功打开。此结果不代表 Intel/AMD Windows 实机或 Windows 10 验证；原有 PowerShell 脚本仍未在 Windows 开发环境执行。完整构建日志、文件大小与校验值位于输出目录。

交叉打包的核心调用如下，需要先准备对应工具并加入 PATH：

```sh
XWIN_ARCH=x86_64 XWIN_CACHE_DIR="$PWD/.build-cache/xwin" npm --prefix apps/mindmap-notes run bundle:drawing -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
```

本次 NSIS 安装在项目缓存；通过启动包装脚本显式指定 NSISDIR，避免打包器覆盖它后读取错误的内置路径。Homebrew 当前配方名为 makensis。

## 0.2.6 起：签名更新与 GitHub 发布

正式打包先设置 `TAURI_SIGNING_PRIVATE_KEY` 为原更新私钥的文件路径，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 为其密码（当前密钥无密码）。必须沿用同一密钥；更换密钥会导致已安装程序拒绝更新。私钥请离线备份，不得上传 GitHub 或放进源码压缩包。此机器的密钥位于项目 `.build-cache/signing/`，已从 Git 排除，文件仅当前用户可读。

仅本机开发、不发布更新时，可以使用 `-UnsignedDevelopment` 跳过更新产物签名。此类构建不可作为正式更新发布。

发布时将安装包、独立 EXE、Mac ZIP、Mac 更新 tar.gz 以及安装包和 tar.gz 对应的 `.sig` 放进 `artifacts/mathdraw/releases/<版本>/`，运行：

```sh
node scripts/publish-mathdraw.mjs artifacts/mathdraw/releases/0.2.6
# 检查清单和文件后发布：
node scripts/publish-mathdraw.mjs artifacts/mathdraw/releases/0.2.6 --publish
```

脚本只上传明确列出的安装文件、签名、SHA-256 和 `latest.json` 到 `DrChuan/Mathdraw`，先创建草稿，全部上传后才发布。版本由应用配置读取，修改版本需同步 package.json、package-lock.json、Cargo.toml、Cargo.lock 和 tauri.conf.json。EXE 的 Authenticode 证书与更新签名是两回事；目前仅配置更新签名。
