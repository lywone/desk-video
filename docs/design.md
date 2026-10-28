# Desk-Video 实现方案设计 v0.1

> 对应需求：`requirements.md` v0.2（MVP 含摄像头 PIP + 标注工具条 + 聚光灯）

---

## 一、总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron Main                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Tray     │ │ Global   │ │ Source   │ │ IPC Router   │  │
│  │ 托盘     │ │ Shortcut │ │ Enumer-  │ │ (main <->    │  │
│  │          │ │ 热键     │ │ ate      │ │  renderer)   │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────┬───────┘  │
└──────────────────────────────────────────────────┼──────────┘
                                                   │
        ┌──────────────────────────────────────────┼─────────────────────┐
        │                                          │                     │
        ▼                                          ▼                     ▼
┌───────────────┐              ┌──────────────────────────┐   ┌──────────────────┐
│ ControlPanel   │              │ Compositor Window         │   │ Overlay Window    │
│ (Vue, 普通面板)│  IPC/IPC     │ (hidden/offscreen)        │   │ (always-on-top,   │
│ 开始/暂停/停止 │◄────────────►│ 采集+合成+编码           │   │ 透明, 点击穿透,   │
│ 设置/源选择    │              │ - screen captureStream    │   │  content-        │
│               │              │ - camera stream          │   │  protection=on)   │
└───────────────┘              │ - mic stream              │   │ 工具栏+画布      │
                               │ - system audio (ffmpeg)    │   │ 鼠标绘制         │
                               │ - canvas 2D 合成           │   │ 聚光灯遮罩       │
                               │ - MediaRecorder -> mp4     │   │ 不被录屏捕获      │
                               └──────────────────────────┘   └──────────────────┘
```

**三个渲染窗口的分工：**

| 窗口 | 是否可见 | 作用 | 关键属性 |
|---|---|---|---|
| ControlPanel | 可见，普通窗口 | 用户操作主入口 | 普通窗口 |
| Compositor | 不可见（`show: false` 或离屏） | 所有采集流在这里合流、编码、写盘 | 无 |
| Overlay | 可见，置顶透明 | 给用户画标注、显示工具栏、聚光灯遮罩 | `alwaysOnTop=true`、`transparent=true`、`setContentProtection(true)`（关键：从 DXGI 桌面捕获中排除，这样录屏里不会重复出现我们自己的标注层）、`setIgnoreMouseEvents(true, {forward:true})` 配合工具栏区域穿透 |

---

## 二、核心采集与合成管线

### 2.1 数据流

```
屏幕流 (desktopCapturer + getUserMedia)
   │
   ▼
drawImage(screen) ─────────────────────────────┐
                                              │
摄像头流 (getUserMedia) ── drawImage 圆角 PIP ─┤
                                              ├─► canvas (1920x1080 or 1280x720)
标注层 (IPC 共享的 stroke 列表) ── draw paths ─┤        │
                                              │        │
聚光灯 (cursor pos) ── 半透明黑圆洞 ────────────┘        │
                                                       ▼
                                            canvas.captureStream(30)
                                                       │
麦克风流 (getUserMedia) ──┐                            │
                          ├─► AudioContext 混音 ──► MediaStreamDestination
系统声流 (ffmpeg wasapi loopback, pipe PCM) ──┘
                                                       │
                                                       ▼
                                              MediaRecorder (video/mp4;codecs=avc1.42E01E,mp4a.40.2)
                                                       │
                                                       ▼
                                              分段写入 out_YYYYMMDD_HHmm_001.mp4
```

### 2.2 屏幕采集

```ts
// main 进程
const sources = await desktopCapturer.getSources({
  types: ['screen', 'window'],
  thumbnailSize: { width: 320, height: 200 },
});

// renderer 里
const stream = await navigator.mediaDevices.getUserMedia({
  audio: false,
  video: {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: source.id,
      minWidth: 1920, maxWidth: 1920,
      minHeight: 1080, maxHeight: 1080,
      minFrameRate: 30, maxFrameRate: 30,
    },
  },
});
```

**自定义区域录制**：MVP 阶段先做"全屏/窗口"，自定义区域通过组合实现——先全屏录制，后期裁切（`--crop=w:h:x:y`）。第一版不做实时区域裁剪，复杂度太高。

### 2.3 摄像头 PIP

```ts
const cam = await navigator.mediaDevices.getUserMedia({
  video: { width: 1280, height: 720, facingMode: 'user' },
  audio: false,
});
// 画到合成 canvas 右下角，圆角 24px，占画面宽 1/6
```

- 位置设置：四角可选（右下/左下/右上/左上）
- 大小：设置里 30%/40%/50% 三档
- 开关：录制中可热键切换 `F8` 显隐

### 2.4 音频

**麦克风**：
```ts
navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
});
```

**系统声音**（Windows WASAPI loopback）：
- 方案：spawn ffmpeg sidecar，从默认渲染设备抓 loopback PCM，通过 stdout 管道喂回 Node，再用 `MediaStreamDestination` / Web Audio 拼成 MediaStream 进入 MediaRecorder。
- 命令：`ffmpeg -f wasapi -i "audio=@loopback" -f s16le -ar 48000 -ac 1 pipe:1`
- 降级：ffmpeg wasapi 不可用时，提示用户安装虚拟声卡（VB-Cable）或 Stereo Mix。

**混音**：
```ts
const ctx = new AudioContext();
const micNode = ctx.createMediaStreamSource(micStream);
const sysNode = ctx.createMediaStreamSource(sysStream);
const micGain = ctx.createGain(); // 0.0 ~ 1.0，用户可调
const sysGain = ctx.createGain();
const dest = ctx.createMediaStreamDestination();
micNode.connect(micGain).connect(dest);
sysNode.connect(sysGain).connect(dest);
```

### 2.5 编码输出

- **首选**：Chromium 自带 MediaRecorder 直接写 MP4（Electron ≥ 28 支持 `video/mp4;codecs=avc1.42E01E,mp4a.40.2`）
  - 优点：边录边写，停止即得文件，无需二次转码
  - 码率：视频 6 Mbps，音频 128 kbps
- **兜底**：若 MediaRecorder mp4 不支持（旧 Electron），录成 webm 后停止时调 ffmpeg 转 mp4
- **分段**：每 10 分钟自动 `mediaRecorder.stop()` → 启新的 recorder 写新文件，文件命名 `rec_20261028_143000_001.mp4`、`_002.mp4`

### 2.6 性能与无独显

- 合成 canvas 用 2D Context（1080p 每帧 drawImage + 几条 path，性能足够）
- `canvas.captureStream(30)` 会自动掉帧，CPU 紧张时允许降到 24fps
- 录制时实时显示 CPU 占用（`process.getCPUUsage()`），超 80% 弹提示降码率

---

## 三、标注层与聚光灯

### 3.1 关键设计决策

**标注要同时满足两件事：**
1. 用户在自己屏幕上能看到自己画的东西（画的时候有反馈）
2. 录制文件里要包含这些标注（烧录进视频）

**实现：双份绘制 + 排除自身窗口**

- 标注数据（stroke list：点、颜色、粗细、类型）保存在主进程的一个 store 里，通过 IPC 广播
- **Overlay Window**（用户看到的）：监听 store 变化，把 strokes 画到透明 canvas 上。这个窗口设 `setContentProtection(true)`，DXGI 桌面捕获时它**不会被录进屏幕流**——所以我们自己的屏幕流里是"干净的桌面"
- **Compositor Window**（录制用）：监听同一份 strokes，画到合成 canvas 上——于是最终 mp4 里就有了标注
- 用户在 Overlay 的画布上用鼠标/笔画图，pointer 事件直接产生新 stroke，写回 store

> 为什么要 `setContentProtection`？
> 如果不加，桌面捕获会把 Overlay 窗口也拍进去，合成 canvas 又画一遍 strokes，视频里出现两份标注叠在一起。加了 content-protection，桌面捕获看到的 Overlay 是黑色（或直接透明不拍），合成端自己画一份就行。

### 3.2 工具栏

- 浮在屏幕顶部，可拖动
- 按钮：选择/画笔/荧光笔/箭头/矩形/文字/橡皮/清屏/撤销/聚光灯开关/相机开关
- 颜色板：红、黄、绿、蓝、白 5 色快捷 + 自定义
- 粗细：3 档
- 工具栏区域鼠标不穿透（可点击），其余 overlay 区域 `setIgnoreMouseEvents(true, {forward: true})`，让鼠标事件透传到桌面（这样不影响用户操作 PPT/代码）

### 3.3 聚光灯

- Overlay 窗口全屏覆盖整个屏幕，画一层半透明黑色（alpha 0.6），中间用 `globalCompositeOperation = 'destination-out'` 抠一个圆形洞（半径 180px，跟随鼠标）
- 鼠标位置用全局轮询（`screen.getCursorScreenPoint()` 每 50ms 一次）
- 合成 canvas 同步画同样的暗层 + 圆洞，保证视频里效果一致

### 3.4 鼠标点击波纹

- 监听全局鼠标按下（`electron` 主进程 `globalShortcut` 不行，用 `mouse` 库或 Node 原生 hook；MVP 阶段先在 Overlay 窗口里监听——因为 Overlay 是全屏透明置顶，按下时即使事件穿透也能通过 `forward` 拿到？不行，穿透事件到不了 window。
- **MVP 妥协方案**：只在"用户正在用标注笔画图"时才画点；全局点击波纹用 Node 端 `iohook`/`uiohook-napi` 监听，stroke 列表里加一个 `type: 'ripple'` 的瞬时元素，300ms 后自动清除。

---

## 四、IPC 与状态管理

### 4.1 状态（pinia，主进程 via `@electron/remote` 或直接 IPC）

```ts
interface RecorderState {
  status: 'idle' | 'countdown' | 'recording' | 'paused' | 'stopping';
  sourceId: string | null;
  sourceType: 'screen' | 'window' | 'region';
  cameraEnabled: boolean;
  cameraCorner: 'br' | 'bl' | 'tr' | 'tl';
  micVolume: number;       // 0-1
  systemVolume: number;     // 0-1
  spotlightOn: boolean;
  cursorPos: { x: number; y: number };
  strokes: Stroke[];
  outputDir: string;
  resolution: '720p' | '1080p';
  elapsedMs: number;
  currentFile: string;
}
```

### 4.2 主要 IPC 通道

| 通道 | 方向 | 用途 |
|---|---|---|
| `recorder:start` | panel → main → compositor | 开始录制 |
| `recorder:pause` | panel → main | 暂停/继续 |
| `recorder:stop` | panel → main | 停止 |
| `recorder:status` | main → 所有窗口广播 | 状态变化 |
| `source:list` | panel → main | 列出屏幕/窗口 |
| `strokes:add` / `strokes:undo` / `strokes:clear` | overlay → main → 广播 | 标注同步 |
| `cursor:move` | main → 广播 | 光标位置 |
| `hotkey:f9` / `hotkey:f10` | main → 广播 | 全局热键 |

---

## 五、目录结构

```
desk-video/
├── package.json
├── electron/
│   ├── main/
│   │   ├── index.ts              # 主进程入口
│   │   ├── windows/
│   │   │   ├── control-panel.ts
│   │   │   ├── compositor.ts
│   │   │   └── overlay.ts
│   │   ├── tray.ts
│   │   ├── global-shortcuts.ts
│   │   ├── ipc.ts
│   │   ├── cursor-watcher.ts     # 全局光标轮询
│   │   └── audio-loopback.ts     # spawn ffmpeg 抓 WASAPI loopback
│   └── preload/index.ts
├── src/
│   ├── panels/
│   │   ├── ControlPanel.vue
│   │   ├── SourcePicker.vue
│   │   └── SettingsDialog.vue
│   ├── overlay/
│   │   ├── OverlayRoot.vue
│   │   ├── Toolbar.vue
│   │   ├── DrawingCanvas.vue
│   │   └── SpotlightMask.vue
│   ├── compositor/
│   │   ├── CompositorRoot.vue
│   │   ├── ScreenSource.ts
│   │   ├── CameraSource.ts
│   │   ├── AudioMixer.ts
│   │   ├── StrokeRenderer.ts
│   │   ├── SpotlightRenderer.ts
│   │   └── Recorder.ts
│   ├── stores/
│   │   └── recorder.ts
│   └── shared/
│       ├── types.ts
│       └── ipc-channels.ts
├── resources/
│   └── ffmpeg.exe                # sidecar，随包发布
└── docs/
    ├── requirements.md
    └── design.md
```

---

## 六、里程碑

| 周次 | 目标 | 验收 |
|---|---|---|
| W1 | 脚手架 + 三窗口骨架 + 托盘 + 热键 + 屏幕录制 MP4 直出 | 能录一段 720p 屏幕+麦克风，播放正常 |
| W2 | 系统声音 loopback + 音频混音 + 分段 + 输出目录 + 头尾裁剪 | 录出的 mp4 有系统声，10 分钟自动分段 |
| W3 | 摄像头 PIP + Overlay 工具栏 + 画笔/箭头/矩形/橡皮 | 画的标注烧录进视频，Overlay 不在录制里重复 |
| W4 | 聚光灯 + 鼠标波纹 + 设置面板 + CPU 监控 + 打包 | 1080p 录 30 分钟不崩，整体打磨 |

---

## 七、风险与开放问题

1. **MediaRecorder mp4 支持**：需在 Electron 28+ 实测，不行就走 ffmpeg 转码兜底
2. **Overlay content-protection 与透明置顶叠加**：Windows 上 `transparent + setContentProtection(true)` 是否生效需要实测，不生效的备选方案是"Overlay 截图自身的标注 layer，用 IPC 把像素传到 compositor 合成"（成本高）
3. **WASAPI loopback 权限**：少数企业机器可能禁用，需要在设置里加"无法抓取系统声时"的降级提示
4. **全局鼠标监听**：`uiohook-napi` 在 Node 新版本的 ABI 兼容要打补丁，备选是写个小 Rust sidecar
5. **多显示器 DPI 缩放**：Windows 125%/150% 缩放下，屏幕坐标和 canvas 坐标要对齐，容易出错位
