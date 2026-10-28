# Desk-Video 桌面讲解录制工具

面向讲师 / 教程作者的 Windows 桌面录屏工具：一条命令录出「屏幕 + 人声 + 系统声音 + 摄像头画中画 + 实时标注」的讲解视频，录完直接裁剪导出 MP4。

基于 **Electron + Vue 3 + TypeScript** 构建，使用 ffmpeg sidecar 完成音频回环采集与无损转封装，全程软编码，无需独立显卡。

## 功能特性

### 录制
- **录制源**：整个屏幕或指定应用窗口，支持多显示器；不选则自动录主屏
- **双路音频**：麦克风（回声消除 / 降噪 / 自动增益）+ 系统声音（WASAPI 回环）独立开关与音量，带实时电平条
- **摄像头画中画**：圆形头像叠加到画面四角，位置与大小可调，录制中一键显隐
- **全局热键**：`F9` 开始/暂停/继续、`F10` 停止、`F8` 摄像头显隐，面板隐藏到托盘也能操作
- **3 秒倒计时**：开始前缓冲，倒计时不录进视频
- **崩溃安全**：WebM 流式写盘 + 每 N 分钟自动分段，中途崩溃最多丢最后 1 秒
- **输出设置**：输出目录 / 720p–4K 分辨率 / 4–16 Mbps 码率 / 分段时长均可配置

### 标注（实时烧录进视频）
- 画笔、荧光笔、箭头、矩形、文字、橡皮擦、撤销、清屏
- 红 / 黄 / 绿 / 蓝 / 白五色，三档粗细
- **聚光灯模式**：屏幕压暗，只亮光标周围圆形区域
- 标注与画面同帧合成；标注工具条本身不会被录进视频

### 录制后
- 自动弹出预览窗口，拖动起点 / 终点滑块（或点击时间文字）边看边对齐切点
- **ffmpeg 无损裁剪**，秒级生成新文件
- WebM 自动无损转封装为 MP4（H.264 直接 remux，VP8/VP9 自动转码）

## 快速开始

环境要求：Windows 10/11，Node.js 18+

```powershell
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 打包 Windows 安装包（NSIS）
npm run dist
```

> 国内网络已配置 npmmirror 镜像下载 Electron 与 ffmpeg 二进制（见 `.npmrc`），无需额外设置。

### 30 秒上手

1. 启动 → 面板「更换…」选择录制源（或直接开始 = 主屏）
2. 确认麦克风电平条会动
3. 按 `F9` → 倒计时 3 秒 → 开始讲解
4. 需要强调时：顶部工具条选画笔画几笔 → 切回选择模式
5. 讲完按 `F10` → 预览窗口裁掉头尾 → 「裁剪并另存」→ 打开文件夹拿 MP4

详细操作说明见 [docs/usage.md](docs/usage.md)。

## 项目结构

```
├── electron/
│   ├── main/              # 主进程
│   │   ├── main-flow.ts       # 应用生命周期与窗口编排
│   │   ├── recorder-session.ts# 录制会话（分段写盘、状态机）
│   │   ├── audio-loopback.ts  # WASAPI 系统声音回环
│   │   ├── compositor.ts      # 屏幕/摄像头/标注帧合成
│   │   ├── recorded-protocol.ts# rec:// 特权协议（本地媒体加载）
│   │   ├── global-shortcuts.ts# 全局热键
│   │   └── tray.ts            # 托盘
│   └── preload/           # 预加载脚本（IPC 桥）
├── src/
│   ├── panels/            # 渲染进程页面
│   │   ├── ControlPanel.vue   # 主控制面板
│   │   ├── Preview.vue        # 录后预览与裁剪
│   │   ├── SettingsDialog.vue # 输出设置
│   │   └── SourcePicker.vue   # 录制源选择
│   ├── overlay/           # 屏幕标注工具条与画布
│   ├── compositor/        # 帧合成逻辑
│   └── shared/            # 主/渲染进程共享类型与常量
├── resources/             # 应用图标
└── docs/                  # 需求 / 设计 / 实施台账 / 使用文档
```

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Electron 33 + Vue 3 + TypeScript |
| 构建 | electron-vite (Vite 5) |
| 音视频 | ffmpeg-static（软编码 x264 / AAC） |
| 安装包 | electron-builder (NSIS) |

## 文档

- [需求分析](docs/requirements.md)
- [设计文档](docs/design.md)
- [实施台账](docs/implementation-steps.md)
- [使用文档](docs/usage.md)

## License

MIT
