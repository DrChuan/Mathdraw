# Mathdraw 数学绘图

用于高中数学试卷、讲义的本地桌面绘图工具，支持平面与空间几何。

## 下载

请到 [Releases](https://github.com/DrChuan/Mathdraw/releases/latest) 下载最新版本。

- Windows 10/11 x64：推荐使用 `Mathdraw_版本_x64-setup.exe` 安装包。安装时会检查 WebView2 运行环境。
- `mathdraw.exe` 为单独的程序文件，需要系统已有 WebView2；后续更新仍使用安装包。建议先安装再使用自动更新。
- macOS 12 及以上：使用通用版 ZIP。

0.2.6 起，程序启动时检查新版，确认后下载已签名的更新包，保留本机恢复草稿并重新启动。也可从文件菜单选择“检查更新”。旧版需要先手动安装一次。

## 源码与开发

桌面工程位于 `apps/mindmap-notes/`，包含 Mathdraw 绘图模块及其共享的笔记框架。源码分支可能包含尚未发布的修改；安装包以 Releases 为准。

需要 Node.js 22.12 及以上、Rust。Windows 需要 MSVC C++ 构建工具及 Windows SDK；Mac 需要 Apple Command Line Tools 和 macOS SDK。

```sh
cd apps/mindmap-notes
npm ci
npm run drawing:dev
```

前端构建：`npm run build`。本地打包（不生成签名更新包）：

```sh
# macOS
npm run bundle:drawing -- --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Windows 可双击根目录“打包数学绘图Windows.cmd”，附加 `-UnsignedDevelopment` 参数进行本地开发打包；详情见 [Windows 打包说明](scripts/README-windows-packaging.md)。

## 发布

当前 Mac 构建机可双击根目录“发布Mathdraw.command”，选择版本位数后打包并发布到 GitHub 和 Gitee。配置和重试说明见 [一键发布说明](scripts/README-mathdraw-release.md)。

签名密钥和本机构建缓存不随源码分发。发布更新必须安全配置原签名密钥，不能用新密钥替代。


条件作图用法见 [平面条件作图说明](docs/平面条件作图说明.md) 和 [曲线与度量](docs/按条件作图-曲线与度量.md)；计算实现与限制见 [计算逻辑与解析求解演进](docs/按条件作图计算逻辑与解析求解演进.md)。
