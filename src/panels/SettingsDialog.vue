<script setup lang="ts">
import { state, patchState } from '@shared/renderer-store'

const emit = defineEmits<{ (e: 'close'): void }>()

async function pickDir() {
  await window.api.pickDirectory()
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <div class="head">
        <span>设置</span>
        <button class="x" @click="emit('close')">✕</button>
      </div>

      <div class="row">
        <label>输出目录</label>
        <div class="dir">
          <input type="text" :value="state.outputDir" readonly />
          <button @click="pickDir">选择…</button>
        </div>
      </div>

      <div class="row">
        <label>分辨率</label>
        <select
          :value="state.resolution"
          @change="patchState({ resolution: ($event.target as HTMLSelectElement).value as '720p' | '1080p' | '1440p' | '2160p' | 'native' })"
        >
          <option value="720p">720p（CPU 友好）</option>
          <option value="1080p">1080p（全高清）</option>
          <option value="1440p">1440p（2K）</option>
          <option value="2160p">2160p（4K，需高码率）</option>
          <option value="native">跟随屏幕原始分辨率</option>
        </select>
      </div>

      <div class="row">
        <label>视频码率</label>
        <select :value="state.videoBitrateMbps" @change="patchState({ videoBitrateMbps: Number(($event.target as HTMLSelectElement).value) })">
          <option :value="4">4 Mbps</option>
          <option :value="6">6 Mbps</option>
          <option :value="8">8 Mbps</option>
          <option :value="12">12 Mbps（2K 建议）</option>
          <option :value="16">16 Mbps（4K 建议）</option>
        </select>
      </div>

      <div class="row">
        <label>自动分段</label>
        <select :value="state.segmentMinutes" @change="patchState({ segmentMinutes: Number(($event.target as HTMLSelectElement).value) })">
          <option :value="5">每 5 分钟</option>
          <option :value="10">每 10 分钟</option>
          <option :value="20">每 20 分钟</option>
          <option :value="0">不分段</option>
        </select>
      </div>

      <div class="row">
        <label>倒计时</label>
        <select :value="state.countdownSeconds" @change="patchState({ countdownSeconds: Number(($event.target as HTMLSelectElement).value) })">
          <option :value="3">3 秒</option>
          <option :value="5">5 秒</option>
          <option :value="0">不倒计时</option>
        </select>
      </div>

      <div class="row">
        <label>摄像头画中画</label>
        <label class="switch">
          <input type="checkbox" :checked="state.cameraEnabled" @change="patchState({ cameraEnabled: ($event.target as HTMLInputElement).checked })" />
          启用
        </label>
      </div>

      <div class="row" v-if="state.cameraEnabled">
        <label>PIP 位置</label>
        <select :value="state.cameraCorner" @change="patchState({ cameraCorner: ($event.target as HTMLSelectElement).value as never })">
          <option value="br">右下</option>
          <option value="bl">左下</option>
          <option value="tr">右上</option>
          <option value="tl">左上</option>
        </select>
      </div>

      <div class="row" v-if="state.cameraEnabled">
        <label>头像大小</label>
        <select :value="state.cameraSize" @change="patchState({ cameraSize: Number(($event.target as HTMLSelectElement).value) })">
          <option :value="0.12">小</option>
          <option :value="0.16">中</option>
          <option :value="0.22">大</option>
        </select>
      </div>

      <div class="row">
        <label>录制时隐藏面板</label>
        <label class="switch">
          <input type="checkbox" :checked="state.minimizePanelWhileRecording" @change="patchState({ minimizePanelWhileRecording: ($event.target as HTMLInputElement).checked })" />
          启用
        </label>
      </div>

      <div class="foot">
        <button class="primary" @click="emit('close')">完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  width: 520px;
  max-width: 92vw;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
}
.x {
  padding: 2px 10px;
}
.row {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 10px;
  align-items: center;
}
.row > label:first-child {
  color: var(--text-dim);
}
.dir {
  display: flex;
  gap: 8px;
}
.dir input {
  flex: 1;
}
.switch {
  display: flex;
  gap: 6px;
  align-items: center;
}
.foot {
  display: flex;
  justify-content: flex-end;
}
</style>
