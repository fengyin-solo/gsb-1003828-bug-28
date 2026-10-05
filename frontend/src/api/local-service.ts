import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  appendDrawingVersion,
  listDrawingVersions,
  listRows,
  refreshCache,
  resetRows,
  saveRows,
} from '@/data/local-store'
import type { ActionResult, DrawingVersion, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const DRAWING_KEY = 'drawing'
// 已有校核结论落库的图纸状态：同图号再确认直接拒绝，已数字化更是终态，任何动作都不许动。
const DRAWING_SETTLED_STATUSES = ['已校核', '已数字化']

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

function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function runAction(key: string, id: number, action: string, operator = ''): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 写之前先对齐共享存储：两个入口同时操作时，后提交的一方必须看到对方刚落库的结果，
  // 否则各自拿旧快照互相覆盖，两个入口的校核结果就对不上。
  refreshCache()
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const sources = meta.actionSources?.[action]
  if (sources && !sources.includes(current)) {
    return { ok: false, message: `${meta.entity}当前状态「${current}」，不能执行「${action}」` }
  }
  if (key === DRAWING_KEY) {
    return runDrawingAction(meta, rows, index, action, target, operator)
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 实测图纸的校核流：退回要清掉本次校核中间态并留档上一版，确认要把校核结论写死，
// 同一图号只许先提交的版本落库。
function runDrawingAction(
  meta: ModuleMeta,
  rows: EntryRow[],
  index: number,
  action: string,
  target: string,
  operator: string,
): ActionResult {
  const row = rows[index]
  const version = Number(row['版本'] ?? 1) || 1
  const drawingNo = String(row['图纸编号'] ?? '')

  if (action === '确认校核') {
    // 同一图号已有校核结论落库（含历史已数字化版本），后提交的确认一律拒绝。
    const settled = rows.some(
      (item) =>
        Number(item.id) !== Number(row.id) &&
        String(item['图纸编号']) === drawingNo &&
        DRAWING_SETTLED_STATUSES.includes(String(item.status)),
    )
    if (settled) {
      return { ok: false, message: `图纸编号 ${drawingNo} 已有校核通过的版本落库，本次确认未落库` }
    }
    const reviewer = operator.trim() || '值班管理员'
    const updated: EntryRow = {
      ...row,
      status: target,
      pending: true,
      abnormal: false,
      版本: version,
      校核人: reviewer,
      完成日期: today(),
    }
    saveDrawing(rows, index, updated)
    // 校核结论留档：之后即使图纸再流转，这一版的结论也查得到。
    appendDrawingVersion({ drawingId: Number(row.id), drawingNo, version, action, snapshot: updated })
    return { ok: true, message: `${meta.entity}已确认校核（第 ${version} 版），校核人 ${reviewer}` }
  }

  if (action === '退回修改') {
    // 先把上一版图纸整行留档（含本次校核写下的校核人、完成日期），原图不被覆盖；
    // 再清掉本次校核中间态，重新提交时不会沿用旧值。
    appendDrawingVersion({ drawingId: Number(row.id), drawingNo, version, action, snapshot: row })
    const updated: EntryRow = {
      ...row,
      status: target,
      pending: true,
      abnormal: false,
      版本: version,
      校核人: '',
      完成日期: '',
    }
    saveDrawing(rows, index, updated)
    return { ok: true, message: `${meta.entity}已退回修改，本次校核的校核人与完成日期已清除，上一版图纸已留档为第 ${version} 版` }
  }

  // 提交校核：从「需修改」重新提交算新一版图纸；校核中间态一律清空，等确认校核时再写。
  const nextVersion = String(row.status) === '需修改' ? version + 1 : version
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: true,
    abnormal: false,
    版本: nextVersion,
    校核人: '',
    完成日期: '',
  }
  saveDrawing(rows, index, updated)
  return { ok: true, message: `${meta.entity}已提交校核（第 ${nextVersion} 版），当前状态「${target}」` }
}

function saveDrawing(rows: EntryRow[], index: number, updated: EntryRow): void {
  const next = [...rows]
  next[index] = updated
  saveRows(DRAWING_KEY, next)
}

export function listDrawingVersionHistory(id: number): DrawingVersion[] {
  return listDrawingVersions(id)
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
