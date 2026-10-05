/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  // 动作允许的前置状态：登记了的动作只有在当前状态命中时才放行，其余入口直接拒绝。
  actionSources?: Record<string, string[]>
  metrics: string[]
}

// 实测图纸的版本留档：每次退回/确认都把当时整行快照追加进来，原图永不覆盖。
export type DrawingVersion = {
  drawingId: number
  drawingNo: string
  version: number
  action: string
  savedAt: string
  snapshot: EntryRow
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
