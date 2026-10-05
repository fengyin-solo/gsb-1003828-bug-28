<template>
  <section class="page" data-module="drawing">
    <header class="page-head">
      <div>
        <h2>实测绘图管理</h2>
        <p class="page-desc">维护实测图纸，围绕图纸编号、绘图对象、绘图类型、比例尺做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记实测图纸</button>
        <button class="btn" type="button" @click="exportRows">导出实测绘图清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>版本</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>第 {{ row['版本'] ?? 1 }} 版</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openVersions(row)">版本记录</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无实测绘图数据，可先登记实测图纸</td>
        </tr>
      </tbody>
    </table>

    <section v-if="versionRow" class="version-panel">
      <header class="version-panel-head">
        <h3>版本记录：{{ versionRow['图纸编号'] }}（当前第 {{ versionRow['版本'] ?? 1 }} 版）</h3>
        <button class="btn ghost" type="button" @click="closeVersions">收起</button>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>留档版本</th>
            <th>留档动作</th>
            <th>图纸状态</th>
            <th>校核人</th>
            <th>完成日期</th>
            <th>留档时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in versions" :key="`${item.savedAt}-${item.action}`">
            <td>第 {{ item.version }} 版</td>
            <td>{{ item.action }}</td>
            <td>{{ item.snapshot.status }}</td>
            <td>{{ item.snapshot['校核人'] || '—' }}</td>
            <td>{{ item.snapshot['完成日期'] || '—' }}</td>
            <td>{{ item.savedAt }}</td>
          </tr>
          <tr v-if="!versions.length">
            <td colspan="6" class="empty-state">暂无历史版本，退回修改或确认校核后会自动留档，原图不会被覆盖</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条实测绘图记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listDrawingVersionHistory,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { DrawingVersion, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('drawing')
const session = useSessionStore()
const columns = ["图纸编号", "绘图对象", "绘图类型", "比例尺", "绘图人", "校核人", "完成日期", "图纸状态"]
const actions = ["提交校核", "确认校核", "退回修改"]
const statuses = ["绘制中", "待校核", "已校核", "已数字化", "需修改"]
const stats = [{"label": "图纸总数", "value": 0}, {"label": "已校核数", "value": 0}, {"label": "待校核数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const versionRow = ref<EntryRow | null>(null)
const versions = ref<DrawingVersion[]>([])
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '实测图纸登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, session.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  if (versionRow.value && Number(versionRow.value.id) === Number(row.id)) {
    versions.value = listDrawingVersionHistory(Number(row.id))
  }
  reload()
}

function openVersions(row: EntryRow) {
  versionRow.value = row
  versions.value = listDrawingVersionHistory(Number(row.id))
}

function closeVersions() {
  versionRow.value = null
  versions.value = []
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '实测绘图列表读取失败'
  }
}

onMounted(reload)
</script>
