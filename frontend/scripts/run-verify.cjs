// 把 scripts/verify.ts 打成可独立运行的 ESM：数据层不依赖 Vue，直接跑在 Node 上。
const path = require('node:path')

require('esbuild').buildSync({
  entryPoints: [path.resolve(__dirname, 'verify.ts')],
  bundle: true,
  outfile: path.resolve(__dirname, 'verify.mjs'),
  format: 'esm',
  platform: 'node',
  alias: { '@': path.resolve(__dirname, '../src') },
  logLevel: 'warning',
})
