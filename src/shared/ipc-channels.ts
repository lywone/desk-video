export const IPC = {
  // 状态
  StateGet: 'state:get',
  StateSet: 'state:set',
  StateChanged: 'state:changed',

  // 录制控制（panel → main）
  RecorderStart: 'recorder:start',
  RecorderPause: 'recorder:pause',
  RecorderResume: 'recorder:resume',
  RecorderStop: 'recorder:stop',

  // compositor → main
  RecorderReady: 'recorder:ready',
  RecorderEvent: 'recorder:event',
  SegmentChunk: 'segment:chunk',
  RequestSegment: 'segment:request',

  // main → compositor
  SegmentStarted: 'segment:started',

  // 源选择
  SourceList: 'source:list',
  SourceSelect: 'source:select',

  // 标注
  StrokesAdd: 'strokes:add',
  StrokesRemove: 'strokes:remove',
  StrokesUndo: 'strokes:undo',
  StrokesClear: 'strokes:clear',
  StrokesChanged: 'strokes:changed',

  // 光标（main → 广播）
  CursorMove: 'cursor:move',

  // 音频电平（compositor → main → 广播）
  AudioLevels: 'audio:levels',

  // ffmpeg 系统声兜底（compositor → main → compositor）
  LoopbackStart: 'loopback:start',
  LoopbackStop: 'loopback:stop',
  LoopbackData: 'loopback:data',

  // 输出 / 预览 / 裁剪
  OpenOutputDir: 'output:open',
  PickDirectory: 'dialog:pick-dir',
  ShowPreview: 'preview:show',
  TrimRequest: 'trim:request',
  TrimDone: 'trim:done',

  // overlay 窗口穿透控制
  SetIgnoreMouse: 'window:ignore-mouse',

  // 应用
  AppQuit: 'app:quit',
  TogglePanel: 'panel:toggle'
} as const
