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
  /** 每个动作允许的起始状态；登记后不在起点集合里的状态一律拒绝流转（终态结论不可被覆盖） */
  actionSources?: Record<string, string[]>
  /** 已有最终结论的状态：不再允许流转，看板 pending 置 false */
  finalStatuses?: string[]
  /** 业务编号字段：同一编号只允许一条结论落库，同时确认时先提交者胜 */
  codeField?: string
  /** 校核中间态字段的生命周期：确认动作落结论，退回/重新提交时清空 */
  review?: {
    personField: string
    dateField: string
    confirmAction: string
    clearActions: string[]
  }
  metrics: string[]
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
