// 修复验证脚本：模拟 localStorage，跑通校核动作、退回入口、版本持久化三条路径。
// 运行：npm run verify

const store = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
  addEventListener: () => undefined,
}

const STORAGE_KEY = 'field-archaeology-digital:entries'

const service = await import('@/api/local-service')
const store_api = await import('@/data/local-store')

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

function drawingRow(id: number) {
  const payload = service.listEntries('drawing')
  return payload.items.find((row) => Number(row.id) === id)
}

// 模拟另一个入口（另一个标签页）直接写共享存储
function writeAsOtherEntry(mutate: (entries: Record<string, any[]>) => void) {
  const entries = JSON.parse(store.get(STORAGE_KEY)!)
  mutate(entries)
  store.set(STORAGE_KEY, JSON.stringify(entries))
}

console.log('场景1：待校核 → 退回修改，清中间态 + 留档上一版')
{
  const result = service.runAction('drawing', 2, '退回修改', '张三')
  const row = drawingRow(2)!
  check('退回成功', result.ok, result.message)
  check('状态变为需修改', row.status === '需修改')
  check('校核人已清空', row['校核人'] === '', `实际=${row['校核人']}`)
  check('完成日期已清空', row['完成日期'] === '', `实际=${row['完成日期']}`)
  const versions = service.listDrawingVersionHistory(2)
  check('留档 1 条上一版', versions.length === 1)
  check('留档保留原校核人', versions[0]?.snapshot['校核人'] === '实测绘图样例2')
  check('留档保留原完成日期', versions[0]?.snapshot['完成日期'] === '2026-09-02')
  check('留档状态为待校核', versions[0]?.snapshot.status === '待校核')
  check('留档版本为第 1 版', versions[0]?.version === 1)
}

console.log('场景2：需修改 → 重新提交校核，不沿用旧值，版本 +1')
{
  const result = service.runAction('drawing', 2, '提交校核', '张三')
  const row = drawingRow(2)!
  check('提交成功', result.ok, result.message)
  check('状态回到待校核', row.status === '待校核')
  check('版本升为第 2 版', Number(row['版本']) === 2, `实际=${row['版本']}`)
  check('校核人仍为空（未沿用旧值）', row['校核人'] === '')
  check('完成日期仍为空（未沿用旧值）', row['完成日期'] === '')
}

console.log('场景3：待校核 → 确认校核，写入本次校核结论并留档')
{
  const result = service.runAction('drawing', 2, '确认校核', '李四')
  const row = drawingRow(2)!
  check('确认成功', result.ok, result.message)
  check('状态为已校核', row.status === '已校核')
  check('校核人写入当前操作人', row['校核人'] === '李四')
  check('完成日期写入今天', /^\d{4}-\d{2}-\d{2}$/.test(String(row['完成日期'])))
  const versions = service.listDrawingVersionHistory(2)
  check('留档 2 条（退回+确认）', versions.length === 2)
  check('确认留档含校核结论', versions[1]?.snapshot['校核人'] === '李四' && versions[1]?.snapshot.status === '已校核')
  check('确认留档为第 2 版', versions[1]?.version === 2)
}

console.log('场景4：已校核/已数字化的图纸，校核结论受保护')
{
  check('已校核不能重复确认', !service.runAction('drawing', 2, '确认校核', '王五').ok)
  check('已校核不能退回', !service.runAction('drawing', 2, '退回修改', '王五').ok)
  check('已校核不能重新提交', !service.runAction('drawing', 2, '提交校核', '王五').ok)
  const row2 = drawingRow(2)!
  check('已校核结论未被改动', row2['校核人'] === '李四')
  check('已数字化不能退回', !service.runAction('drawing', 4, '退回修改', '王五').ok)
  check('已数字化不能确认', !service.runAction('drawing', 4, '确认校核', '王五').ok)
  check('已数字化不能提交', !service.runAction('drawing', 4, '提交校核', '王五').ok)
  const row4 = drawingRow(4)!
  check('历史已数字化图纸按原校核结论保留', row4['校核人'] === '实测绘图样例4' && row4['完成日期'] === '2026-09-04' && row4.status === '已数字化')
}

console.log('场景5：两个入口同时确认同一图号，只允许先提交的落库')
{
  service.runAction('drawing', 1, '提交校核', '张三') // id=1 绘制中 → 待校核
  // 另一个入口（标签页）抢先确认并落库
  writeAsOtherEntry((entries) => {
    const target = entries.drawing.find((row) => Number(row.id) === 1)
    target.status = '已校核'
    target['校核人'] = '先提交的校核人'
    target['完成日期'] = '2026-10-05'
  })
  // 本入口内存里还是「待校核」旧快照，再点确认必须被拒绝，且不能覆盖对方落库结果
  const result = service.runAction('drawing', 1, '确认校核', '后提交的校核人')
  check('后提交的确认被拒绝', !result.ok)
  const row1 = drawingRow(1)!
  check('先提交的版本保留在库里', row1['校核人'] === '先提交的校核人' && row1.status === '已校核')
}

console.log('场景6：同一图号已有结论落库，另一版本的确认被拒绝')
{
  writeAsOtherEntry((entries) => {
    entries.drawing.push({
      id: 5, status: '待校核', pending: true, abnormal: false, 版本: 2,
      图纸编号: 'DRAW-0003', 绘图对象: 'x', 绘图类型: 'x', 比例尺: 'x',
      绘图人: 'x', 校核人: '', 完成日期: '', 图纸状态: 'x',
    })
  })
  const result = service.runAction('drawing', 5, '确认校核', '张三')
  check('同图号重复确认被拒绝', !result.ok)
  check('拒绝消息说明已有落库版本', result.message.includes('已有校核通过的版本落库'), result.message)
  const row5 = drawingRow(5)!
  check('重复版本状态未变', row5.status === '待校核')
}

console.log('场景7：刷新（缓存失效）后，跨模块校核结果保留且一致')
{
  const coord = service.runAction('coordinate', 1, '提交校核')
  check('三维坐标提交校核成功', coord.ok, coord.message)
  store_api.refreshCache() // 模拟刷新页面 / 重新进入
  const drawings = service.listEntries('drawing')
  const d2 = drawings.items.find((row) => Number(row.id) === 2)!
  const d4 = drawings.items.find((row) => Number(row.id) === 4)!
  check('刷新后图纸校核结果保留', d2.status === '已校核' && d2['校核人'] === '李四')
  check('刷新后已数字化结论保留', d4.status === '已数字化' && d4['校核人'] === '实测绘图样例4')
  const coords = service.listEntries('coordinate')
  check('跨模块校核结果保留', coords.items.find((row) => Number(row.id) === 1)!.status === '已校核')
  const versions = service.listDrawingVersionHistory(2)
  check('刷新后版本留档仍在', versions.length === 2)
  const overview = service.loadOverview()
  check('概览统计正常产出', overview.modules.length > 0)
}

console.log('场景8：旧数据兼容（无版本字段）+ 其他模块行为不变')
{
  writeAsOtherEntry((entries) => {
    const target = entries.drawing.find((row) => Number(row.id) === 1)
    target.status = '需修改'
    delete target['版本']
    target['校核人'] = '历史遗留校核人'
    target['完成日期'] = '2026-01-01'
  })
  const result = service.runAction('drawing', 1, '提交校核', '张三')
  const row1 = drawingRow(1)!
  check('旧数据提交成功', result.ok, result.message)
  check('无版本字段按第 1 版处理并升版', Number(row1['版本']) === 2, `实际=${row1['版本']}`)
  check('历史遗留校核人被清除', row1['校核人'] === '')
  check('历史遗留完成日期被清除', row1['完成日期'] === '')
  const trench = service.runAction('trench', 1, '开始发掘')
  check('其他模块动作不受影响', trench.ok && trench.message.includes('发掘中'))
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) {
  process.exit(1)
}
