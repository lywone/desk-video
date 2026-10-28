# CLAUDE.md — AI 协作上下文

本文件供 AI 助手快速理解本项目。修改代码前请先阅读「架构」「关键机制」「已知坑点」三节。

## 项目概述

**Desk-Video**：面向讲师/教程作者的 Windows 桌面录屏工具（MVP v0.2）。一条流程录出「屏幕 + 人声 + 系统声音 + 摄像头画中画 + 实时标注」的讲解视频，录完无损裁剪导出 MP4。

- 平台：Windows 10/11，软编码（无独显约束）
- 技术栈：Electron 33 + Vue 3 + TypeScript + electron-vite (Vite 5) + ffmpeg-static（sidecar）
- 打包：electron-builder → NSIS 安装包（`npm run dist` → `release/Desk-Video-Setup-<版本>.exe`）

## 常用命令

```powershell
npm run dev      # 开发模式（验证功能的唯一入口，见「开发约束」）
npm run build    # 构建产物到 out/
npm run start    # 运行构建产物（electron-vite preview）
npm run dist     # 打包 NSIS 安装包
```

- 在 TRAE IDE 内置终端启动 dev 需加：`npx electron-vite dev -- --user-data-dir=D:\code\desk-video\.userdata-smoke`
- 全局 git 配置了本地代理 `127.0.0.1:31181`（常未运行），git 联网操作加 `-c http.proxy= -c https.proxy=` 临时绕过，**禁止改全局 git 配置**
- GitHub 仓库：https://github.com/lywone/desk-video（凭据走 GCM/Windows 凭据管理器）

## 开发约束（硬性）

1. **先验证后提交**：功能改动必须先通过 `npm run dev` 实际运行验证，禁止提前构建打包
2. **保留诊断日志**：录制链路的 console.error 诊断日志必须保留，便于定位问题（如 `recorder-session.ts` 的写盘错误日志）
3. 用户偏好：关注实际运行效果与交互异常，优先修复交互问题

## 架构

### 进程与窗口模型

主进程（`electron/main/`）是唯一状态源；4 个渲染页面各自独立入口（见 `electron.vite.config.ts` renderer.input）：

| 窗口 | 入口 | 职责 |
|---|---|---|
| 控制面板 | `src/panels/index.html` → ControlPanel.vue | 主操作 UI：源选择、音频、设置、开始/停止 |
| 预览/裁剪 | `src/panels/preview.html` → Preview.vue | 录后播放、起点/终点滑块、ffmpeg 裁剪 |
| 标注层 overlay | `src/overlay/overlay.html` → OverlayRoot.vue | 顶部悬浮工具条 + 全屏画布；非 select 工具时接收鼠标，select 时点击穿透 |
| 合成器 compositor | `src/compositor/compositor.html` → CompositorRoot.vue | 隐藏窗口：采集+合成+编码核心，**不显示 UI** |

另有：托盘（tray.ts，关窗不退出）、全局热键（F9/F10/F8）、单实例锁、`rec://` 特权协议。

### 录制数据流（核心链路）

```
ControlPanel ──recorder:start──▶ main(main-flow)
    main 启动倒计时 ──▶ compositor 开始采集
compositor 内部（全部在渲染进程）：
  ScreenSource (getDisplayMedia 屏/窗口流)
  + CameraSource (摄像头 PIP 圆形头像)
  + AudioMixer (mic MediaStream + 系统声；系统声优先取屏幕流音轨，
    失败降级 ffmpeg WASAPI loopback —— ipc LoopbackStart/Stop/Data)
  + StrokeRenderer / SpotlightRenderer (标注与聚光灯烧录进帧)
  ─▶ canvas.captureStream(0) 手动推帧 ─▶ SegmentRecorder (MediaRecorder webm,
     timeslice 1s) ──segment:chunk──▶ main
main.RecorderSession：
  webm 流式 append 写盘（崩溃最多丢 1s）+ 按 segmentMinutes 分段
    （compositor 发 segment:request 换文件，避免空文件）
停止后：ffmpeg remux webm→mp4（h264 直接 remux，vp8/vp9 转码）
    ──▶ ShowPreview 弹预览窗（rec:// 协议加载本地文件）
```

### 状态管理

- 主进程 `store.ts`：持全量 `RecorderState`（类型见 `src/shared/types.ts`），任何 patch 广播 `state:changed` 增量
- 渲染端 `src/shared/renderer-store.ts`：启动拉全量，之后吃广播增量；`strokes` 数组同理（`strokes:changed` 全量镜像）
- 标注坐标为**归一化坐标 0~1**（相对录制目标屏幕，`targetBounds`），规避 DPI 缩放；`width` 基准 1920 宽
- 录制进度 tick（时长/大小/分段/磁盘）每 500ms 广播；音频电平经 main 广播

### IPC 通道

全部常量在 `src/shared/ipc-channels.ts`（唯一来源，勿散落字符串）。命名空间：`state:*`、`recorder:*`、`segment:*`、`strokes:*`、`loopback:*`、`source:*`、`preview/trim` 等。`window.api.*` 由 `electron/preload/index.ts` 暴露。

### 关键机制

- **`rec://` 协议**（`recorded-protocol.ts`）：dev 下 http 源页面无法加载 `file://` 媒体，预览页必须用 `rec://` 承载本地录制文件。在 app ready 前通过 `protocol.registerSchemesAsPrivileged` 注册（standard/secure/stream/supportFetchAPI）
- **写盘预检**：开始录制前检查输出目录可写，失败置 `state.error` 并回到 idle，防止状态卡死、按钮永久禁用
- **overlay 自动重建**：`window-all-closed` 不退出应用（托盘常驻）；overlay 窗口异常时有自动重建逻辑
- **ffmpeg 路径**：dev 取 `node_modules/ffmpeg-static`；打包后从 `app.asar.unpacked` 解析（`ffmpeg-path.ts`，asarUnpack 已配置）

## 代码结构

```
├── electron/
│   ├── main/                  # 主进程
│   │   ├── index.ts               # 启动：协议注册/单实例锁/窗口编排
│   │   ├── main-flow.ts           # 录制状态机编排（倒计时/启停/错误处理）
│   │   ├── recorder-session.ts    # 落盘会话：webm append、分段、remux
│   │   ├── audio-loopback.ts      # ffmpeg WASAPI 系统声兜底
│   │   ├── recorded-protocol.ts   # rec:// 特权协议
│   │   ├── store.ts               # 主进程唯一状态源
│   │   ├── ipc.ts / ipc-helpers.ts# IPC 注册与广播
│   │   ├── global-shortcuts.ts    # F9/F10/F8
│   │   ├── tray.ts / cursor-watcher.ts / ffmpeg-path.ts
│   │   └── windows/               # 各窗口创建（control-panel/overlay/preview/compositor/win-utils）
│   └── preload/index.ts       # contextBridge 暴露 window.api
├── src/
│   ├── panels/                # 控制面板 + 预览页（Vue）
│   ├── overlay/               # 工具条 Toolbar.vue + 画布 DrawingCanvas.vue + SpotlightMask.vue
│   ├── compositor/            # ScreenSource/CameraSource/AudioMixer/StrokeRenderer/
│   │                          #   SpotlightRenderer/Recorder(SegmentRecorder)/PcmWorklet.js
│   └── shared/                # types.ts / ipc-channels.ts / renderer-store.ts（主渲染共用）
├── docs/                      # requirements / design / design-v2 / implementation-steps / usage
└── resources/                 # icon.ico / icon.png
```

## 编码约定

- 语言：TypeScript，注释与文档用中文
- 路径别名：主/preload 用 `@shared` → `src/shared`；渲染端另有 `@` → `src`
- 渲染进程不得直接碰 Node API，一律走 `window.api`（preload 桥）
- 新增 IPC 必须先在 `ipc-channels.ts` 定义常量，preload 桥同步补方法
- 标注/坐标一律归一化（0~1），像素换算放渲染边界处

## 已知坑点（勿重蹈）

1. **UTF-8 BOM**：PS5 写配置文件会带 BOM，毒化 JSON 解析导致录制按钮禁用
2. **contentProtection 窗口**：GDI 截屏模式下不可见，导致录制区域异常
3. **Preview seekTo**：只设置 currentTime 不调用 play() 会导致点击时间点后不播放（已改为 previewFrom：跳转+自动播放）
4. **输出目录不可写**：常见于 IDE 内置终端沙箱禁止写 `视频\` 目录——已有预检报错机制；输出目录可改到项目内（如 `out-video/`，已 gitignore）
5. **ffmpeg 组件损坏**（下载不完整）→ 全部文件留 .webm：用 npmmirror 重装 ffmpeg-static（见 docs/usage.md 末尾）
6. **透明窗捕获排除**：Windows 透明 overlay 窗的 show 后需重设 contentProtection，否则录出两层标注

## 文档索引

- [docs/requirements.md](docs/requirements.md) — 需求分析 v0.2（功能分层 P0/P1/P2）
- [docs/design.md](docs/design.md) / [docs/design-v2.md](docs/design-v2.md) — 设计文档
- [docs/implementation-steps.md](docs/implementation-steps.md) — 实施台账（缺陷修复记录）
- [docs/usage.md](docs/usage.md) — 用户操作文档 + FAQ
- [README.md](README.md) — 项目介绍（GitHub 展示用）
