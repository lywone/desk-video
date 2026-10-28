# Desk-Video 实施步骤文档（AI 交接用）

> 对应需求：`docs/requirements.md` v0.2（MVP：屏幕+麦克风+系统声+摄像头PIP+标注烧录+聚光灯）
> 对应设计：`docs/design.md` v0.1
> 本文档是**实施进度台账**：每完成一个步骤，把状态改为 `done` 并填写"完成记录"。任何 AI 接手时，按状态从未完成步骤继续。
> 技术栈：Electron 33 + Vue 3 + TypeScript + electron-vite + ffmpeg-static（sidecar）

## 状态图例
- `pending` 未开始 / `in_progress` 进行中 / `done` 已完成并验证 / `skipped` 经确认跳过

---

## Phase 1 工程骨架

### Step 1.1 初始化项目配置 — `done`
- 产物：`package.json`、`electron.vite.config.ts`、`tsconfig.json`、`.gitignore`
- 要点：electron-vite 三段构建（main/preload/renderer），renderer root=src 多 HTML 入口（index/preview/overlay/compositor）
- 完成记录：2026-10-28 写入，npm install 后台完成，依赖含 electron@^33.2 / electron-vite@^2.3 / ffmpeg-static@^5.2 / vue@^3.5

### Step 1.2 共享类型与 IPC 通道定义 — `done`
- 产物：`src/shared/types.ts`、`src/shared/ipc-channels.ts`
- 要点：strokes 用归一化坐标（0~1 相对目标屏幕）规避 DPI 缩放错位；RecorderState = AppSettings + 运行时状态
- 完成记录：2026-10-28 完成

## Phase 2 主进程（electron/main）

### Step 2.1 主进程状态中心 store — `done`
- 产物：`electron/main/store.ts`
- 要点：settings 持久化到 userData/desk-video-config.json；patch() 局部更新并广播所有窗口；strokes 保存在主进程
- 完成记录：2026-10-28 完成

### Step 2.2 三个窗口 — `done`
- 产物：`electron/main/windows/control-panel.ts`、`compositor.ts`、`overlay.ts`、`win-utils.ts`
- 要点：
  - Compositor：show:false + backgroundThrottling:false + paintWhenInitiallyHidden（视频帧用 captureStream(0)+requestFrame 手动推，不依赖窗口可见性）
  - Overlay：transparent + frame:false + alwaysOnTop(screen-saver) + setContentProtection(true)（关键：不被桌面捕获拍到）+ 默认 setIgnoreMouseEvents(true,{forward:true})
- 完成记录：2026-10-28 完成

### Step 2.3 托盘 + 全局热键 + 光标轮询 — `done`
- 产物：`electron/main/tray.ts`、`global-shortcuts.ts`、`cursor-watcher.ts`、`ipc-helpers.ts`
- 要点：F9 启停（开始/暂停/继续）、F10 停止、F8 摄像头显隐；光标 50ms 轮询，变化才广播
- 完成记录：2026-10-28 完成

### Step 2.4 录制会话与 ffmpeg 落盘 — `done`
- 产物：`electron/main/recorder-session.ts`
- 要点：webm 流式 append（1s chunk，崩溃最多丢 1s）；10 分钟分段；停止后 ffmpeg remux → mp4（copy 优先，失败转码 libx264 兜底）；trimVideo 头尾裁剪；statfs 磁盘余量
- 完成记录：2026-10-28 完成

### Step 2.5 录制主流程（倒计时/暂停/停止收尾） — `done`
- 产物：`electron/main/main-flow.ts`
- 要点：idle→countdown(3s)→recording→paused→stopping→idle 状态机；录制中按设置隐藏控制面板；停止收尾后自动弹预览裁剪
- 完成记录：2026-10-28 完成

### Step 2.6 IPC 路由 + 主进程入口 — `done`
- 产物：`electron/main/ipc.ts`、`electron/main/index.ts`、`electron/main/windows/preview.ts`
- 要点：desktopCapturer 源枚举（screen/window+缩略图）；segment:chunk 增量写盘；窗口穿透控制转发；preview 窗口管理；错误事件回 idle
- 完成记录：2026-10-28 完成；修复：getCompositor 从 windows/compositor 导出、SourceSelect 通道携带 displayId 联动 overlay 定位

### Step 2.7 preload 桥接 — `done`
- 产物：`electron/preload/index.ts`
- 要点：contextBridge 白名单通道；收发都经封装；修复 import 路径为 ../../src/shared/ipc-channels
- 完成记录：2026-10-28 完成

## Phase 3 渲染端（src）

### Step 3.1 控制面板 ControlPanel — `done`
- 产物：`src/panels/index.html`、`main.ts`、`base.css`、`ControlPanel.vue`、`SourcePicker.vue`、`SettingsDialog.vue`
- 要点：状态卡（状态/时长/大小/磁盘/分段）、源选择缩略图、麦克风/系统声开关+音量条+电平、开始/暂停/停止按钮、设置（输出目录/分辨率/码率/分段/PIP 位置大小）
- 完成记录：2026-10-28 完成；模板经 setup 暴露 api 引用（Vue 模板白名单不含 window）

### Step 3.2 合成窗口 Compositor — `done`
- 产物：`src/compositor/compositor.html`、`CompositorRoot.vue`、`ScreenSource.ts`、`CameraSource.ts`、`AudioMixer.ts`、`PcmWorklet.js`、`StrokeRenderer.ts`、`SpotlightRenderer.ts`、`Recorder.ts`
- 要点：
  - 屏幕流 getUserMedia(chromeMediaSource=desktop) + 系统声同请求拿桌面音频；失败降级 ffmpeg loopback（PcmWorklet 环形缓冲）
  - canvas 合成顺序：屏幕→聚光灯→标注→PIP；captureStream(0)+requestFrame，setInterval 33ms 驱动
  - MediaRecorder webm(h264/vp8+opus 优先后者兜底) 1s timeslice → chunk IPC 落盘；10 分钟自动换段
  - AnalyserNode 电平 200ms 上报
- 完成记录：2026-10-28 完成并验证；注意合成顺序为聚光灯先于标注（聚光灯压暗底层，标注始终在最上层），与设计文档顺序略有出入但视觉合理

### Step 3.3 标注 Overlay — `done`
- 产物：`src/overlay/overlay.html`、`OverlayRoot.vue`、`Toolbar.vue`、`DrawingCanvas.vue`、`SpotlightMask.vue`
- 要点：工具条可拖动/always-on-top/不进成片（contentProtection 由窗口保证）；select 工具=穿透；画笔类工具=接收事件；文字工具 inline 输入；倒计时大数字显示在 overlay（不进视频）
- 完成记录：2026-10-28 完成并验证；穿透策略为「非 select 工具或 hover 工具条时接收事件」，经 IPC SetIgnoreMouse 转发主进程

### Step 3.4 预览裁剪 Preview — `done`
- 产物：`src/panels/preview.html`、`preview-main.ts`、`Preview.vue`
- 要点：video 预览 + 头尾双滑块 + ffmpeg trim
- 完成记录：2026-10-28 完成并验证；停止录制后自动弹出（main-flow openPreview），也支持手动触发

## Phase 4 验证与打磨

### Step 4.1 构建通过（typecheck/build 0 error） — `done`
- 完成记录：2026-10-28 `npx tsc --noEmit` 0 error、`npm run build` 0 error。共修复 16 处类型错误：
  - main-flow.ts：`openPreviewWindow` 笔误 → `openPreview`（preview.ts 实际导出名）
  - store.ts：AppSettings → Record 转换加 `as unknown as` 中转
  - tray.ts：Tray 无 `getContextMenu()` API → 抽出 buildMenuTemplate()/rebuildMenu() 重建菜单
  - windows/compositor.ts：`paintWhenInitiallyHidden` 是 BrowserWindow 顶层选项，不是 webPreferences 子项（行为不变）
  - preload/index.ts：`on()` 泛型化 `<T extends unknown[]>`，修正回调参数逆变报错
  - AudioMixer.ts：`Float32Array` 注解为 `Float32Array<ArrayBuffer>`（TS 5.7 泛型 TypedArray）
  - ScreenSource.ts / renderer-store.ts：回调与 find 参数补显式类型

### Step 4.2 应用启动冒烟（dev 启动、三窗口出现、无控制台致命错误） — `done`
- 完成记录：2026-10-28 完成。`npm run dev` 启动后：6 个 electron 进程（main+GPU+network+3 渲染）全部存活；EnumWindows 确认 `Desk-Video` 面板与 `overlay` 置顶窗口可见，`compositor` 按设计隐藏（show:false）；完整日志中无应用代码致命错误（仅 IDE 沙箱对搜狗输入法日志/系统字体读取的噪音报错，与本应用无关）。
- 注意：在 TRAE IDE 沙箱内启动需重定向用户数据目录，否则 lockfile 写不进 AppData 直接退出：
  `npx electron-vite dev -- --user-data-dir=D:\code\desk-video\.userdata-smoke`（正常终端直接 `npm run dev` 即可，冒烟后临时目录已删除）

### Step 4.3 托盘图标 resources/icon.png — `done`
- 完成记录：2026-10-28 generate_image 生成 1K 图标并缩小到 256x256，tray.js 按 app.getAppPath() 解析路径

### Step 4.4 已知限制记录 — `done`
- 完成记录：2026-10-28 记录如下
- 全局鼠标点击波纹（uiohook-native 依赖）暂缓，仅在标注时产生波纹
- 自定义区域录制 = 全屏录 + 后期裁剪（设计文档 2.2 约定）
- MediaRecorder mp4 直写未启用，统一 webm 落盘 + ffmpeg remux（更稳）
- Windows 上透明窗的 contentProtection 必须在 show 之后重设一次才生效（探针实测结论，见 win-utils.applyContentProtection；纯 show 前设置会被捕获泄漏）

## 待用户实测项（真机录制验证）

- [x] 系统声捕获正常 → 2026-10-28 实测通过
- [x] overlay（工具条/标注）不进成片 → 2026-10-28 实测发现泄漏，已修复：根因是透明窗 setContentProtection 在 show 前设置无效，探针验证 show 后重设有效，修复落在 win-utils.applyContentProtection 并应用到全部 4 个窗口。待用户复测确认
- [x] 摄像头 PIP 显示正常、F8 显隐 → 非缺陷：默认关闭，需在面板「设置…」勾选开启摄像头后生效，录制中 F8 显隐
- [x] h264-webm remux mp4 正常 → 2026-10-28 实测失败已修复：根因是 ffmpeg-static 二进制下载损坏（MZ/PE 头有效但内容损坏，"不是有效应用程序"），从 npmmirror（FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static）重装后，remux（copy）与转码（libx264）两条路径均用合成 webm 端到端验证通过

---

## 交接须知（给下一个 AI）
1. 先读本文件与 `docs/design.md`，按最靠前的 `pending/in_progress` 步骤继续，完成即更新本文件。
2. 常用命令：`npm run dev`（开发）、`npm run build`（构建）、`npm run start`（运行构建产物）；产物在 `out/`。
3. Electron 二进制下载慢时：`$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"` 后在 node_modules/electron 里跑 `node install.js`。
4. 关键设计决策不可回退：
   - Overlay 必须 `setContentProtection(true)`，否则视频里标注会重复两层
   - Compositor 不能依赖 rAF + 可见性，必须 `captureStream(0) + requestFrame` 手动推帧
   - 标注坐标一律归一化（0~1），渲染时乘以目标尺寸
   - 落盘统一 webm 流式 append，停止后 remux mp4；第一个文件由 compositor 的 segment:request 打开（避免空段）
5. ffmpeg 路径来自 `require('ffmpeg-static')`，不要写死路径。
6. Windows 上不要用 PowerShell Get-Content/Set-Content 读写含中文的源码文件（PS 5.1 默认 ANSI 会把 UTF-8 搞坏），一律用专用文件编辑工具。
7. getUserMedia 屏幕约束只设 maxWidth/maxHeight 上限，设精确 min 会 OverconstrainedError。
8. 在 TRAE IDE 沙箱里跑 dev 必须重定向用户数据目录（否则 Chromium lockfile 写 AppData 被拦直接退出）：`npx electron-vite dev -- --user-data-dir=D:\code\desk-video\.userdata-smoke`；系统字体/输入法日志的沙箱报错是噪音可忽略。
9. 透明窗（overlay）的 setContentProtection 在 Windows 上必须在 show 之后重设一次才生效（已用桌面捕获探针实测对比验证），统一走 win-utils.applyContentProtection，别直接调 win.setContentProtection。
10. ffmpeg-static 二进制容易下载损坏（症状：MZ 头有效但报"不是有效应用程序"），重装命令：`Remove-Item node_modules\ffmpeg-static\ffmpeg.exe; $env:FFMPEG_BINARIES_URL="https://registry.npmmirror.com/-/binary/ffmpeg-static"; cd node_modules\ffmpeg-static; node install.js`（记得先删 %LOCALAPPDATA%\ffmpeg-static-nodejs 缓存）。
11. 打包已配置：`npm run dist` → `release\Desk-Video-Setup-<版本>.exe`。要点：ffmpeg-static 必须在 dependencies（否则 builder 剔除）；asarUnpack 后 spawn 用不了 asar 内路径，统一走 ffmpeg-path.ts 的 ffmpegPath()（做 app.asar→app.asar.unpacked 重映射）；win.icon 用 resources/icon.ico（预生成，跳过 builder 的 png→ico 转换器）；.npmrc 配了 electron 与 electron-builder-binaries 的 npmmirror 镜像。TRAE 沙箱内跑 dist 建议加 dangerouslyDisableSandbox（builder 要写 %LOCALAPPDATA%\electron-builder 缓存）。
12. electron-vite 主进程代码里**禁止运行时 require('./本地模块')**——Rollup 不会把运行时 require 的本地 TS 文件打进 bundle（dev 恰好能跑、打包后直接 Cannot find module），一律用 ESM import。教训来自 ffmpeg-path 首次打包报错。
13. dev 与打包的 CSS 层叠顺序可能不同：dev 按注入顺序（import 执行序），打包按 chunk 分包结果——共享 base.css 可能被排到页面私有 CSS 之后。跨文件的覆盖规则必须加 !important（案例：overlay 的透明背景被 base.css 深色 body 盖掉 → 打包版整屏黑幕、dev 正常）。
14. **沙箱终端内跑 dev 的录制失败链**：IDE 内置终端沙箱禁写 `视频\` 目录 → 旧代码在录制中段 EPERM 未捕获 → 状态卡 recording → 开始按钮永久禁用+面板自动隐藏，用户看似"无法录制"。已修：handleRecorderStart 前置写探针预检（失败显示可读错误并保持 idle）+ 写盘流 error 监听（onFatal 回调→handleRecorderError）。另外两点坑：PowerShell 5 `Set-Content -Encoding utf8` 带 BOM 会毒化 JSON 配置（JSON.parse 失败静默回落默认设置）；GDI 截屏（CopyFromScreen/PrintWindow）看不到设置了 contentProtection 的窗口——诊断 overlay 时别被"截屏没有工具条"误导。dev 全流程已实测通过：F9→webm 分片→F10→mp4（h264+音轨）。

## 待用户实测项（首轮真机录制后回填）

首轮结果见上文「待用户实测项（真机录制验证）」：系统声 ✓、工具条泄漏已修、remux 已修。

**第二轮反馈（2026-10-28）处理**：
- 摄像头无法开启/开启后无画面 → 1) 面板新增「摄像头」卡片快捷开关（开启立即连接，失败原因 NotFound/NotAllowed/NotReadable 显示到错误栏）；2) CameraSource 分辨率提到 720p ideal、video 挂 DOM 防隐藏窗口解码节流、close 释放 srcObject；3) CompositorRoot watch cameraEnabled 响应式开关。待复测
- 分辨率低、无选择项 → 分辨率扩展为 720p/1080p/1440p/2160p/native（native=跟随屏幕原始分辨率，取偶数），码率增加 12/16 Mbps；types.ts/store.ts/CompositorRoot/SettingsDialog 同步更新。默认值仍是 720p，**用户需在设置里调高**。待复测

**第三轮反馈（2026-10-28）处理**：
- 录制后预览与裁剪失败 → 根因：dev 下预览页是 http://localhost 源，`<video src="file://...">` 被 Chromium 拦截 → 视频不加载、duration=0 → 裁剪区（v-if duration>0）不出现，"预览和裁剪都失败"实为同一根因。修复：新增特权协议 rec://（standard+secure+stream，[recorded-protocol.ts](file:///d:/code/desk-video/electron/main/recorded-protocol.ts)，net.fetch(file://) 自动支持 Range 拖动），Preview.vue 改用 `rec://local/<encodeURIComponent(路径)>`。待复测
- 预览起点/终点点击跳转播放失效（后续轮次）→ 1) Preview.vue 增加 webm duration=Infinity 时长解析（1e101 跳转法）+ seekable 兜底 + play() 失败显式提示；2) rec:// 协议重写为手动 206 Range 分段响应（seek 可靠性根因修复）；3) autoplay-policy: no-user-gesture-required；4) 预览渲染进程 console 经 console-message 转发到主进程终端（[preview-web] 前缀），停止/finalize/openPreview 链路补日志。待复测

---

## Phase 5 第二版 V2（自动字幕 + 多机位切换）— 设计见 `docs/design-v2.md`

### Step 5.1 字幕模型管理器 — `pending`
- 产物：`electron/main/model-manager.ts`、`whisper-path.ts`（仿 ffmpeg-path）、面板「字幕模型管理」UI、types（SubtitleSettings）
- 要点：模型清单/大小/已下载状态；net 下载 + Range 断点续传 + 进度广播（models:progress）；镜像默认 hf-mirror.com；whisper-cli.exe dev 放 tools/whisper/、打包 extraResources/whisper（asar 重映射同 ffmpeg）

### Step 5.2 转写管线 — `pending`
- 产物：`electron/main/subtitle.ts`、finalize 后挂接（main-flow）、ipc（subtitle:status/done）
- 要点：串行队列可取消；ffmpeg 抽 16k mono wav → whisper-cli -osrt -ovtt → `<file>.srt/.vtt` → 删 wav；进度按 segment 估算广播；录制中暂停队列；失败仅报错不影响视频

### Step 5.3 预览字幕轨 + 设置项 — `pending`
- 产物：recorded-protocol MIME 加 .vtt/.srt；Preview.vue 加 `<track>`+「字幕」开关+监听 subtitle:done；SettingsDialog 加字幕设置组
- 要点：转写晚于预览打开时无感补挂轨道

### Step 5.4 裁剪字幕同步 + 可选烧录 — `pending`
- 产物：trimVideo 扩展（生成 trimmed.srt/.vtt，平移 -startSec、区间过滤）；烧录 `-vf subtitles`（ffmpeg-static libass 实测，缺则隐藏设置项）

### Step 5.5 图层重构 + 场景布局 S0~S4 — `pending`
- 产物：compositor 新增 screenLayer 离屏 canvas（屏幕+聚光灯+标注先合到这层）、`SceneRenderer.ts`/`SceneLayout.ts`（LAYOUTS 表 + cover 对齐）
- 要点：重构后先回归 S2 现状（标注/聚光灯位置不劣化）再切场景；PIP 圆窗参数沿用现有设置

### Step 5.6 切换交互 + 场景标记 — `pending`
- 产物：global-shortcuts 加 F6 循环 + Ctrl+1..6 直选；Overlay 工具条「机位」按钮组；store activeScene + ipc scene:set / scene:mark；finalize 生成 `<base>_scenes.txt`
- 要点：热键可配置防冲突；可选 200ms 交叉淡入默认硬切

### Step 5.7 第二源机位 S5 — `pending`
- 产物：SourcePicker 第二源选择（screen/window）、compositor 第二路 ScreenSource（限 15fps）、主/副源交换
- 要点：最多 3 路解码（主屏+副源+摄像头）；S5 未启用第二源时置灰
