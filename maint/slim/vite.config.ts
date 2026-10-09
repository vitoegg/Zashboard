import { realpathSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin, type UserConfig } from 'vite'
import upstream from '../vite.config'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// EarthGlobeCard 是 defineAsyncComponent 动态引入，替换它即可摘掉整棵 three.js 依赖树。
// vuedraggable 只有 UMD 构建，require('vue') 会拉入带编译器的 CJS 完整版和第二份运行时；
// 指向 ESM 运行时（取真实路径，与应用自身的 vue 解析为同一模块）。
// tldts 仅用于连接历史的主域名归并，以轻量近似实现替换完整公共后缀表。
const REDIRECTS: Array<[string, string]> = [
  ['src/assets/load-fonts.ts', here('./stubs/load-fonts.ts')],
  ['src/components/overview/EarthGlobeCard.vue', here('./stubs/EarthGlobeCard.vue')],
  ['src/i18n/en.ts', here('../src/i18n/zh.ts')],
  ['src/i18n/ru.ts', here('../src/i18n/zh.ts')],
  ['src/i18n/zh-tw.ts', here('../src/i18n/zh.ts')],
  [
    'node_modules/vue/index.js',
    realpathSync(here('../node_modules/vue/dist/vue.runtime.esm-bundler.js')),
  ],
  ['tldts', here('./stubs/tldts.ts')],
]

function slimResolve(): Plugin {
  const hit = new Set<string>()

  return {
    name: 'slim-resolve',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null

      const id = resolved.id.split('?')[0].replace(/\\/g, '/')

      for (const [suffix, target] of REDIRECTS) {
        if (source === suffix || id.endsWith(suffix)) {
          hit.add(suffix)
          return target
        }
      }

      return null
    },
    closeBundle() {
      const missed = REDIRECTS.map(([suffix]) => suffix).filter((suffix) => !hit.has(suffix))

      if (missed.length) {
        this.error(`slim: 重定向锚点未命中 -> ${missed.join(', ')}`)
      }
    },
  }
}

const base = upstream as UserConfig
const plugins = ((base.plugins ?? []) as unknown[])
  .flat()
  .filter((p) => !String((p as Plugin | null)?.name ?? '').includes('pwa'))

export default defineConfig({
  ...base,
  plugins: [slimResolve(), ...(plugins as Plugin[])],
  resolve: {
    ...base.resolve,
    alias: {
      ...(base.resolve?.alias as Record<string, string>),
      // CSS @import 不经过插件的 resolveId，只能走 alias。
      './styles/theme/fonts.css': here('./stubs/fonts.css'),
    },
  },
  build: { ...base.build, cssCodeSplit: false },
})
