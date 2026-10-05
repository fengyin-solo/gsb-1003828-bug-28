import { SEED_ROWS } from './seed'
import type { DrawingVersion, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'
// 图纸版本留档单独走一条持久化路径：只追加、不覆盖，原图快照永远保留。
const VERSION_STORAGE_KEY = 'field-archaeology-digital:drawing-versions'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

// 别的入口（另一个标签页/窗口）写入共享存储后，本页的内存快照立即作废，
// 下次读取以共享存储为准，两个入口看到的校核结果才一致。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      cache = null
    }
  })
}

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

// 写操作前强制对齐共享存储：两个入口同时操作时，后写的一方必须基于最新状态判断，
// 不能拿自己手里的旧快照把对方刚落库的校核结果覆盖掉。
export function refreshCache(): void {
  cache = readStorage()
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

function timestamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function readVersions(): DrawingVersion[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(VERSION_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as DrawingVersion[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function listDrawingVersions(drawingId: number): DrawingVersion[] {
  return readVersions().filter((item) => Number(item.drawingId) === drawingId)
}

// 版本留档：先读最新留档再追加，原图快照只增不改，几个入口同时留档也互不覆盖。
export function appendDrawingVersion(entry: Omit<DrawingVersion, 'savedAt'>): DrawingVersion {
  const saved: DrawingVersion = { ...entry, snapshot: clone(entry.snapshot), savedAt: timestamp() }
  if (typeof window !== 'undefined' && window.localStorage) {
    const next = [...readVersions(), saved]
    window.localStorage.setItem(VERSION_STORAGE_KEY, JSON.stringify(next))
  }
  return saved
}
