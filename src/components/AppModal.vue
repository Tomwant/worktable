<script setup>
// AppModal：记录/编辑发现弹窗，底层换成 Naive n-modal（遮罩/ESC/聚焦/滚动锁定全内置）
// 对外接口不变：仍由 domain 的 discoverOpen / editingDiscover / discoverForm / saveDiscover 驱动
import { NModal, NInput, NDatePicker, NButton } from 'naive-ui'
import { discoverOpen, editingDiscover, discoverForm, saveDiscover } from '../stores/domain.js'
</script>

<template>
  <n-modal
    v-model:show="discoverOpen"
    preset="card"
    :title="editingDiscover ? '编辑发现' : '记录新发现'"
    class="app-modal glass"
    :mask-closable="true"
    :close-on-esc="true"
    style="width:560px;max-width:92vw"
  >
    <div class="modal-form">
      <label>记录日期
        <n-date-picker v-model:formatted-value="discoverForm.recordDate" type="date" value-format="yyyy-MM-dd" format="yyyy-MM-dd" :clearable="false" />
      </label>
      <label>标题
        <n-input v-model:value="discoverForm.title" placeholder="这个发现的标题是什么？" />
      </label>
      <div class="split">
        <label>来源备注<n-input v-model:value="discoverForm.source" placeholder="如：抖音" /></label>
        <label>链接（可选）<n-input v-model:value="discoverForm.link" placeholder="https://" /></label>
      </div>
      <label>内容
        <n-input v-model:value="discoverForm.content" type="textarea" :rows="7" placeholder="记录商业项目细节、你的分析与逻辑闭环…" />
      </label>
      <label>标签
        <n-input v-model:value="discoverForm.tagsText" placeholder="商业模式、项目机会（用逗号分隔）" />
      </label>
      <div class="modal-actions">
        <n-button quaternary @click="discoverOpen = false">取消</n-button>
        <n-button type="primary" @click="saveDiscover">保存并沉淀</n-button>
      </div>
    </div>
  </n-modal>
</template>
