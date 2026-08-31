import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.argv[2]
if (!root) {
  console.error('usage: node rewrites.mjs <upstream-root>')
  process.exit(1)
}

const repo = process.env.UPDATE_REPO || 'vitoegg/Zashboard'

const hidden = ['fonts', 'emoji', 'language']
  .map((k) => `    'generalSettings.zashboardSettings.${k}': true,`)
  .join('\n')

const rules = [
  {
    desc: 'index.html 锁定 zh-CN',
    file: 'index.html',
    find: '<html lang="">',
    replace: '<html lang="zh-CN">',
  },
  {
    desc: '更新检查指向本仓库',
    file: 'src/assembly/version.ts',
    find: "'https://api.github.com/repos/Zephyruso/zashboard/releases/latest'",
    replace: `'https://api.github.com/repos/${repo}/releases/latest'`,
  },
  {
    desc: '关于页链接指向本仓库',
    file: 'src/components/settings/general/ZashboardSettings.vue',
    find: 'href="https://github.com/Zephyruso/zashboard"',
    replace: `href="https://github.com/${repo}"`,
  },
  {
    // 不锁死会退回 navigator.language：非中文浏览器下 GeoIP 地名和 dayjs 时间会变英文。
    desc: '语言锁定为简体中文',
    file: 'src/store/settings.ts',
    find: /export const language = useStorage<LANG>\([\s\S]*?\n\)/,
    replace: [
      "export const language = useStorage<LANG>('config/language', LANG.ZH_CN)",
      'if (language.value !== LANG.ZH_CN) {',
      '  language.value = LANG.ZH_CN',
      '}',
    ].join('\n'),
  },
  {
    desc: '默认隐藏字体 / emoji / 语言设置项',
    file: 'src/store/settings.ts',
    find: /export const hiddenSettingsItems = useStorage<Record<string, boolean>>\([\s\S]*?\n\)/,
    replace: [
      'export const hiddenSettingsItems = useStorage<Record<string, boolean>>(',
      "  'config/hidden-settings-items',",
      '  {',
      hidden,
      '  },',
      ')',
    ].join('\n'),
  },
  {
    desc: '默认测速地址',
    file: 'src/constant/index.ts',
    find: "export const TEST_URL = 'https://www.gstatic.com/generate_204'",
    replace: "export const TEST_URL = 'http://www.apple.com/library/test/success.html'",
  },
  {
    desc: '默认测速方式为核心控制',
    file: 'src/store/settings.ts',
    find: 'SPEEDTEST_MODE.DASHBOARD,',
    replace: 'SPEEDTEST_MODE.CORE,',
  },
  {
    desc: '默认测速超时 1000ms',
    file: 'src/store/settings.ts',
    find: "useStorage<number>('config/speedtest-timeout', 5000)",
    replace: "useStorage<number>('config/speedtest-timeout', 1000)",
  },
  {
    desc: '默认关闭双列代理组',
    file: 'src/store/settings.ts',
    find: "useStorage('config/two-columns', true)",
    replace: "useStorage('config/two-columns', false)",
  },
  {
    desc: '默认按模式显示 GLOBAL',
    file: 'src/store/settings.ts',
    find: "useStorage('config/display-global-by-mode', false)",
    replace: "useStorage('config/display-global-by-mode', true)",
  },
]

let failed = 0

for (const rule of rules) {
  const path = resolve(root, rule.file)
  const source = readFileSync(path, 'utf8')
  const count =
    rule.find instanceof RegExp
      ? (source.match(new RegExp(rule.find.source, 'g')) ?? []).length
      : source.split(rule.find).length - 1

  if (count !== 1) {
    console.error(`✗ ${rule.desc}：锚点在 ${rule.file} 命中 ${count} 次（应为 1 次）`)
    failed += 1
    continue
  }

  writeFileSync(path, source.replace(rule.find, rule.replace))
  console.log(`✓ ${rule.desc}`)
}

if (failed) {
  console.error(`\nrewrites: ${failed} 条规则失效，构建中止`)
  process.exit(1)
}
