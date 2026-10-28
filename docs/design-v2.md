# Desk-Video 实现方案设计 v0.2（第二版）

> 对应需求：`requirements.md` P2「自动字幕（Whisper 本地）」「多机位切换」
> 前置：MVP 已交付（见 `design.md` v0.1 与 `implementation-steps.md` Phase 1–4），本文档只描述**增量**设计。
> 关键既定约束（不可回退，来自 MVP 交接须知）：webm 流式落盘 → 停止后 ffmpeg remux mp4；canvas 合成 `captureStream(0)+requestFrame`；标注坐标归一化 0~1；Overlay `setContentProtection`；ffmpeg 路径走 `ffmpeg-path.ts`。

---

## 一、范围与目标

| 编号 | 特性 | 用户价值 | 交付形态 |
|---|---|---|---|
| V2-1 | 自动字幕（Whisper 本地） | 课程视频一键出 SRT 字幕，全程本地、不上传 | 停止录制后自动转写 → `.srt`/`.vtt`；预览窗可开关字幕；可选烧录进画面 |
| V2-2 | 多机位切换 | 录制中在"屏幕 / 摄像头特写 / 画中画 / 反画中画 / 分屏 / 第二源"间实时切换 | 成片内直接呈现切换效果 + 场景章节标记文件 |

**非目标（留 V3）**：云端 ASR、录制中实时字幕、多流独立录制+后期剪辑、直播推流。
**设计原则**：字幕是停止后的**后处理管线**，绝不进录制热路径（无独显笔记本上编码与转写抢 CPU 会掉帧）；多机位是合成层的**布局重构**，不改采集与编码链路。

---

## 二、总体架构增量

```
┌─ Main ────────────────────────────────────────────────────────┐
│  model-manager.ts   模型下载/镜像/进度（新增）                 │
│  subtitle.ts        抽音→whisper-cli→srt/vtt 队列（新增）     │
│  recorder-session   +场景标记 marks、finalize 触发字幕（扩展）│
│  recorded-protocol  MIME +.vtt/.srt（扩展）                    │
└──────────────────────────────────────────────────────────────┘
┌─ Compositor（渲染，隐藏窗口）────────────────────────────────┐
│  ScreenSource ×1~2   第二源机位（扩展）                       │
│  screenLayer 离屏canvas：屏幕+聚光灯+标注（重构，关键）       │
│  SceneRenderer：按场景布局把 screenLayer/camera 画进主canvas  │
└──────────────────────────────────────────────────────────────┘
┌─ Overlay 工具条：+「机位」按钮组（扩展）─┐  ┌─ Preview：+字幕轨/开关（扩展）─┐
```

---

## 三、V2-1 自动字幕（Whisper 本地）

### 3.1 技术选型

| 方案 | 打包 | 无独显 CPU 表现 | 中文效果 | 结论 |
|---|---|---|---|---|
| **whisper.cpp（ggml）sidecar** | 预编译 exe，随 extraResources 分发 | 好（量化模型 + Vulkan 可选） | base 起可用，small 推荐 | **选中**（与 ffmpeg sidecar 同模式） |
| faster-whisper（CTranslate2） | 需 Python 运行时 | 好 | 好 | 否，打包不可控 |
| nodejs-whisper / whisper-node | whisper.cpp 的封装，仍要编译工具链 | — | — | 否，直接用 whisper.cpp |
| 云端 API | — | — | — | 违背"本地"需求 |

### 3.2 运行时与模型管理

- **二进制**：`whisper-cli.exe`（whisper.cpp release `whisper-bin-x64.zip`；GPU 版 `whisper-vulkan-bin-x64.zip`）
  - dev 放 `tools/whisper/`（gitignore，README 说明下载）；打包 `extraResources/whisper/`
  - 路径解析仿照 `ffmpeg-path.ts`：`whisperPath()` 做 asar→unpacked 重映射，禁止运行时 require 本地模块（交接须知 12）
- **模型**（ggml `.bin`，存 `app.getPath('userData')/whisper-models/`）：

| 模型 | 体积 | 中文效果 | 定位 |
|---|---|---|---|
| ggml-tiny.bin | ~75 MB | 差 | 试水/极慢机器 |
| ggml-base.bin | ~142 MB | 一般 | 默认下载档 |
| ggml-small.bin | ~466 MB | 可用 | **推荐档**（默认选中） |
| ggml-medium.bin | ~1.5 GB | 好 | 慢机器慎选 |
| large-v3-turbo | ~1.6 GB | 好 | 质量上限 |

- **下载**（`model-manager.ts`）：面板「字幕模型管理」列出模型/大小/已下载状态；用 Electron `net` 下载 + Range 断点续传（rec:// 已有 206 经验）；进度事件广播。镜像可配置：默认 `hf-mirror.com`（国内可达），备选 `huggingface.co`、ModelScope。
- **首次使用引导**：开启"自动字幕"但无模型时，错误栏提示一键下载推荐模型。

### 3.3 转写数据流（停止后异步队列）

```
finalize 完成（mp4s + 保留 webm）
   └► subtitle.ts 队列（串行、可取消，不阻塞预览弹出）
        1) ffmpeg 抽音:  ffmpeg -y -i <file> -vn -ac 1 -ar 16000 -c:a pcm_s16le <tmp>.wav
        2) whisper-cli -m <model> -f <tmp>.wav -l auto|zh|en -osrt -ovtt -of <file基名> -t <线程数> [-np -pp]
        3) 产物: <file>.srt + <file>.vtt（若只产出一种，另一种由主进程文本转换生成）
        4) 删除临时 wav → 广播 subtitle:done {file, srt, vtt}
```

- **进度**：按已输出 segment 估算百分比（兼容解析 stderr 中的百分数行），广播 `subtitle:status {file, state, pct}`；面板显示"字幕转写中 42%"。
- **多分段**：每个分段文件独立转写，时间轴相对本段起点（与预览/裁剪的文件粒度一致）。
- **失败降级**：仅记录错误与提示，绝不影响视频文件产出。

### 3.4 预览与裁剪集成

- `recorded-protocol.ts` MIME 表扩展：`.vtt: text/vtt`、`.srt: text/plain`。
- `Preview.vue`：`<track kind="captions" :src="vttUrl">`；新增「字幕」开关按钮（有轨才显示）；监听 `subtitle:done` 动态挂轨（转写晚于预览打开时无感补上）。
- **裁剪同步**：`trimVideo` 扩展——若源文件存在 `.srt`，生成 `trimmed.srt/.vtt`：时间轴整体平移 `-startSec`，丢弃完全在区间外的条目，跨界条目截断；裁剪结果一并广播。
- **可选烧录**（默认关）：`ffmpeg -vf "subtitles=<srt>:force_style='FontName=Microsoft YaHei,Fontsize=16,Outline=1,MarginV=24'"`。Windows 路径冒号需转义（`D\:/...`）；若 ffmpeg-static 构建不含 libass（实测确认），降级为仅 sidecar 字幕并在设置中隐藏烧录项。

### 3.5 设置项（AppSettings 扩展）

| 设置 | 默认 | 说明 |
|---|---|---|
| `subtitle.enabled` | off | 停止录制后自动转写 |
| `subtitle.modelId` | `small` | 模型档位（联动下载管理） |
| `subtitle.language` | `auto` | auto / zh / en（zh 时可加 initial prompt 提升标点） |
| `subtitle.gpu` | on | Vulkan 加速（失败自动回退 CPU） |
| `subtitle.burnIn` | off | 烧录进画面 |

### 3.6 性能与边界

- 转写只在 `idle` 状态运行；若用户此时开始新录制，队列**暂停**，录制结束恢复（防 CPU 争抢）。
- 内存：16k mono wav ≈ 115 MB/10min，转写完即删；small 模型 ≈ 500 MB 进程内存，可接受。
- 中文路径：whisper.cpp 对非 ASCII 路径需实测，风险见 §6。

### 3.7 新增 IPC / 类型

| 通道 | 方向 | 用途 |
|---|---|---|
| `models:list` | panel→main | 模型清单（大小/已下载/推荐标记） |
| `models:download` / `models:cancel` | panel→main | 下载/取消 |
| `models:progress` | main→广播 | `{id, received, total}` |
| `subtitle:status` / `subtitle:done` | main→广播 | 转写进度与产物路径 |

```ts
// types.ts 追加
export interface SubtitleSettings {
  enabled: boolean; modelId: string
  language: 'auto' | 'zh' | 'en'; gpu: boolean; burnIn: boolean
}
export interface SubtitleStatus {
  file: string
  state: 'queued' | 'extracting' | 'transcribing' | 'done' | 'error'
  pct: number; error?: string
}
```

---

## 四、V2-2 多机位切换

### 4.1 概念与场景表

**机位 = 一路视频源；场景 = 机位的布局方式。**

| 场景 | 布局 | 说明 |
|---|---|---|
| S0 | 屏幕全屏 | 屏幕机位（含标注/聚光灯层） |
| S1 | 摄像头特写全屏 | 讲师特写 |
| S2 | PIP（默认，现状） | 屏幕主 + 摄像头圆窗 |
| S3 | 反 PIP | 摄像头全屏主 + 屏幕小窗 |
| S4 | 分屏 | 左 2/3 屏幕 + 右 1/3 摄像头 |
| S5 | 第二源全屏 | 第二显示器/窗口机位（需启用第二源） |

音频链路不变（麦克风+系统声混音与场景无关），切换零声音中断。

### 4.2 图层重构（关键决策）

**现状**：CompositorRoot 直接把 屏幕→聚光灯→标注→PIP 依次画进主 canvas。
**重构为两层**：

```
screenLayer（离屏 canvas，采集分辨率）         camLayer（video 元素）
   = 屏幕帧 + 聚光灯遮罩 + 标注笔画               = 摄像头帧
          │                                            │
          ▼                                            ▼
     SceneRenderer：查 LAYOUTS[activeScene] 得目标矩形 → drawImage(cover 对齐) → 主 canvas
```

理由：标注坐标（归一化 0~1 相对屏幕）在 screenLayer 内部渲染完毕，任何场景下 ScreenLayer 被缩放/摆到哪，标注都跟随屏幕画面正确变换——**切换场景不需要动标注/聚光灯代码**；切换只是改两个 drawImage 的目标矩形，零额外开销。

```ts
type Rect = { x: number; y: number; w: number; h: number } // 归一化
interface SceneLayout { screen: Rect | null; cam: Rect | null; camShape: 'circle' | 'rounded' }
const LAYOUTS: Record<SceneId, SceneLayout> = {
  S0: { screen: { x: 0, y: 0, w: 1, h: 1 }, cam: null, camShape: 'circle' },
  S1: { screen: null, cam: { x: 0, y: 0, w: 1, h: 1 }, camShape: 'rounded' },
  S2: { screen: { x: 0, y: 0, w: 1, h: 1 }, cam: { x: 0.895, y: 0.70, w: 0.09, h: 0.16 }, camShape: 'circle' },
  S3: { screen: { x: 0.68, y: 0.68, w: 0.28, h: 0.28 }, cam: { x: 0, y: 0, w: 1, h: 1 }, camShape: 'rounded' },
  S4: { screen: { x: 0.01, y: 0.02, w: 0.64, h: 0.96 }, cam: { x: 0.67, y: 0.02, w: 0.32, h: 0.96 }, camShape: 'rounded' },
  S5: { screen: { x: 0, y: 0, w: 1, h: 1 }, cam: null, camShape: 'circle' } // screen 槽画第二源
}
```

- PIP 圆窗尺寸沿用现有设置（占高比例、四角位置）；S3 小窗位置可复用四角设置（对角）。
- cover 对齐：源宽高比与目标矩形不一致时等比放大裁剪，禁止拉伸变形。

### 4.3 切换交互

- **Overlay 工具条**新增「机位」按钮组（S0~S5 图标；第二源未启用时 S5 置灰）。Overlay 有 contentProtection，按钮组不进成片。
- **热键**：`F6` = 按序循环切换；`Ctrl+1..5` = 直选 S0..S4（S5=Ctrl+6）；`F8` 保持"当前场景内摄像头显隐"。
- **过渡**：默认硬切（0 开销）；可选 200ms 交叉淡入（切换后 6 帧内对旧布局做 alpha 衰减，仅在过渡区间多一次 drawImage）。
- 生效即时（下一渲染帧），影响仅在合成层。

### 4.4 第二源机位（S5）

- SourcePicker 支持"第二源"选择（screen/window，缩略图同现流程）；Compositor 内再起一路 `ScreenSource` 实例。
- 上限：额外 1 路桌面流（共 3 路解码：主屏+副源+摄像头），无独显笔记本预算内；副源采集帧率允许降到 15fps（仅切换到 S5 时全屏观看）。
- 主/副源可交换（对调 sourceId）。

### 4.5 场景标记 → 章节文件（与 P1-11 联动）

- 录制中每次切换，compositor 经 IPC 上报 `scene:mark {tMs, scene}`，recorder-session 追加。
- finalize 时生成 `<base>_scenes.txt`：`00:00:00 屏幕演示` / `00:03:12 摄像头特写` …（Ogg Chapters 兼容格式），供后期软件/剪停顿时定位。

### 4.6 可选实验项（默认关闭，不上验收主线）

- 声控自动切特写：mic RMS 超阈值 3s → 切 S1，静默 10s → 切回。设置项 `autoFocusCam`。
- 双流备份（摄像头独立录制文件）：CPU 预算外，仅在 1080p 以下允许开启。

### 4.7 新增 IPC / 类型

| 通道 | 方向 | 用途 |
|---|---|---|
| `scene:set` | overlay/panel→main→广播 | 切场景（主进程校验场景可用性） |
| `scene:mark` | compositor→main | 录制中的场景标记 |
| `hotkey:f6` / `hotkey:scene-N` | main→广播 | 全局热键 |
| `source:secondary` | panel→main | 第二源选择 |

```ts
// types.ts 追加
export type SceneId = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5'
export interface SceneMark { tMs: number; scene: SceneId }
```

---

## 五、里程碑与验收

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| M-V2-1 | 字幕管线：模型管理 + 转写队列 + 预览字幕轨 | 下载 small 模型 → 开启自动字幕 → 录 2 分钟 → 停止后面板出现转写进度 → 预览窗「字幕」开关可切换、时间对齐误差 < 0.5s |
| M-V2-2 | 裁剪字幕同步 + 可选烧录 | 裁剪 00:10~01:00 → `trimmed.mp4 + trimmed.srt` 字幕从 0 对应；开烧录后画面内嵌中文字幕 |
| M-V2-3 | 图层重构 + 场景 S0~S4 + 热键/工具条 | 录制中 Ctrl+1/2/3/4 与 F6 切换 → 成片画面正确布局、标注始终贴合屏幕画面、音频无中断 |
| M-V2-4 | 第二源机位 + 场景章节标记 | 选第二显示器 → Ctrl+6 切全屏第二源；停止后生成 `_scenes.txt` 且时间正确 |

实施顺序：M-V2-1 → M-V2-2 可与 M-V2-3 并行；图层重构（M-V2-3 第一步）必须先回归验证 S2 现状不劣化。

---

## 六、风险与开放问题

1. **whisper.cpp 中文路径/中文输出编码**：非 ASCII 路径需实测，必要时把 wav 与输出先放 `%TEMP%` 短路径再回移；输出 UTF-8 由 srt/vtt 解析方保证。
2. **ffmpeg-static 是否含 libass**（烧录依赖）：需实测 `-vf subtitles`；缺则隐藏烧录设置项（不阻塞 M-V2-2 主体）。
3. **Vulkan whisper 在老 Intel 核显的兼容性**：失败自动回退 CPU（进程退出码非 0 即重跑 CPU 版）。
4. **双桌面流帧率**：Chromium 同时捕获两路桌面在高分屏可能降帧，第二源限定 15fps 缓解；切换到 S5 才真正显示。
5. **热键冲突**：Ctrl+数字 可能与用户应用冲突 → 全部热键做成可配置（沿用 global-shortcuts 的注册模式）。
6. **模型下载大文件**：国内网络对 huggingface 直连不稳 → 默认 hf-mirror + Range 断点续传 + 失败重试 3 次。
7. **实时字幕（录制中轻量滑窗）**：列为 V2.1 实验项，需 tiny 模型 + 独立音频缓冲，暂不设计。
