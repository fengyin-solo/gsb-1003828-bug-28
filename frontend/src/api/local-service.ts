import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '退回', '停用', '忽略', '下线', '回滚']

// 校核结论落库时写上当前值班人；脱离应用环境（如脚本直调）时退回到默认值班员。
function currentOperator(): string {
  try {
    return useSessionStore().operator
  } catch {
    return '值班管理员'
  }
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 流转起点守卫：已落定结论的状态（如已数字化）不在任何动作的起点里，原校核结论保留。
  const sources = meta.actionSources?.[action]
  if (sources && !sources.includes(current)) {
    return { ok: false, message: `${meta.entity}当前状态「${current}」不能执行「${action}」` }
  }
  // 同一图号只允许一条结论落库：两人同时确认时，先提交的版本生效，后到的一律拒绝。
  if (meta.codeField && meta.finalStatuses?.includes(target)) {
    const code = String(row[meta.codeField] ?? '')
    const settled =
      code !== '' &&
      rows.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          String(other[meta.codeField as string] ?? '') === code &&
          (meta.finalStatuses as string[]).includes(String(other.status)),
      )
    if (settled) {
      return { ok: false, message: `${meta.codeField} ${code} 已有校核结论落库，本次「${action}」未生效` }
    }
  }
  const finalStatuses = meta.finalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: !finalStatuses.includes(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 校核中间态：确认时写入本次校核人与完成日期；退回或重新提交时清空，只保留图纸本身。
  if (meta.review) {
    const { personField, dateField, confirmAction, clearActions } = meta.review
    if (action === confirmAction) {
      updated[personField] = currentOperator()
      updated[dateField] = today()
    } else if (clearActions.includes(action)) {
      updated[personField] = ''
      updated[dateField] = ''
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
