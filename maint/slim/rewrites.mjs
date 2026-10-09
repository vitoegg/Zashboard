import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const root = process.argv[2]
if (!root) throw new Error('usage: node rewrites.mjs <upstream-root>')
const require = createRequire(resolve(root, 'package.json'))
const ts = require('typescript')
const { parse } = require('vue/compiler-sfc')
const repo = process.env.UPDATE_REPO || 'vitoegg/Zashboard'
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('invalid UPDATE_REPO')

// 值为写入上游的 TypeScript 表达式。
const defaults = {
  'config/dark-theme': "'dark-daisyui5'",
  'config/font': 'FONTS.SYSTEM_UI',
  'config/auto-ip-check': 'false',
  'config/auto-connection-check': 'false',
  'config/number-of-charts-in-sidebar': '2',
  'config/two-columns': 'false',
  'config/speedtest-url': 'TEST_URL',
  'config/speedtest-timeout': '1000',
  'config/speedtest-mode': 'SPEEDTEST_MODE.CORE',
  'config/display-global-by-mode': 'true',
  'config/connection-table-columns': `[
    CONNECTIONS_TABLE_ACCESSOR_KEY.Close,
    CONNECTIONS_TABLE_ACCESSOR_KEY.SourceIP,
    CONNECTIONS_TABLE_ACCESSOR_KEY.Host,
    CONNECTIONS_TABLE_ACCESSOR_KEY.Type,
    CONNECTIONS_TABLE_ACCESSOR_KEY.Rule,
    CONNECTIONS_TABLE_ACCESSOR_KEY.Chains,
    CONNECTIONS_TABLE_ACCESSOR_KEY.DlSpeed,
    CONNECTIONS_TABLE_ACCESSOR_KEY.UlSpeed,
    CONNECTIONS_TABLE_ACCESSOR_KEY.Download,
    CONNECTIONS_TABLE_ACCESSOR_KEY.Upload,
    CONNECTIONS_TABLE_ACCESSOR_KEY.ConnectTime,
  ]`,
  'config/hidden-settings-items':
    '{ [SETTINGS_MENU_KEY.backend]: true, [SETTINGS_MENU_KEY.overview]: true }',
}
const settings = 'src/store/settings.ts'
const constants = 'src/constant/index.ts'
const printer = ts.createPrinter()
const files = new Map()

function text(file) {
  if (!files.has(file)) files.set(file, readFileSync(resolve(root, file), 'utf8'))
  return files.get(file)
}

function parseTS(name, code) {
  const ast = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  // parseDiagnostics 不在公开类型中；接口变化时明确中止，而不是误判为无语法错误。
  if (!Array.isArray(ast.parseDiagnostics)) throw new Error('slim: TypeScript 解析接口改变')
  if (ast.parseDiagnostics.length) throw new Error(`slim: ${name} 存在语法错误`)
  return ast
}

// 每次修改后单元即失效，需重新调用 source() 获取最新偏移。
function source(file) {
  const code = text(file)
  let script = code
  let offset = 0
  if (file.endsWith('.vue')) {
    const { descriptor, errors } = parse(code, { filename: file })
    if (errors.length || (descriptor.script && descriptor.scriptSetup)) {
      throw new Error(`slim: 无法安全解析 ${file}`)
    }
    const block = descriptor.scriptSetup || descriptor.script
    if (!block || !['ts', undefined].includes(block.lang)) {
      throw new Error(`slim: ${file} 缺少支持的脚本块`)
    }
    script = block.content
    offset = block.loc.start.offset
  }
  return { file, ast: parseTS(file, script), offset }
}

function expression(code) {
  return parseTS('value.ts', `const value = ${code}`).statements[0].declarationList.declarations[0]
    .initializer
}

function printed(node) {
  return printer.printNode(ts.EmitHint.Expression, node, node.getSourceFile())
}

function nodes(root, predicate) {
  const found = []
  const visit = (node) => {
    if (predicate(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function one(matches, desc) {
  if (matches.length !== 1) throw new Error(`slim: ${desc} 命中 ${matches.length} 次（应为 1 次）`)
  return matches[0]
}

function variable(unit, name) {
  const matches = nodes(
    unit.ast,
    (n) => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name,
  )
  return one(matches, `${unit.file}: ${name}`)
}

function splice(unit, start, end, replacement) {
  const code = text(unit.file)
  files.set(
    unit.file,
    code.slice(0, unit.offset + start) + replacement + code.slice(unit.offset + end),
  )
}

function edit(unit, node, replacement) {
  splice(unit, node.getStart(unit.ast), node.end, replacement)
}

function exact(file, before, after) {
  const code = text(file)
  const count = code.split(before).length - 1
  if (count !== 1) throw new Error(`slim: ${file} 锚点命中 ${count} 次（应为 1 次）`)
  files.set(
    file,
    code.replace(before, () => after),
  )
}

function value(node, seen = new Set()) {
  if (!node || seen.has(node)) throw new Error('slim: 无法确认默认值')
  const next = new Set(seen).add(node)
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return value(node.expression, next)
  }
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => value(item, next))
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties.map((p) => {
        if (!ts.isPropertyAssignment(p)) throw new Error('slim: 不支持的默认对象结构')
        const key = ts.isComputedPropertyName(p.name) ? value(p.name.expression, next) : p.name.text
        return [key, value(p.initializer, next)]
      }),
    )
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const name = node.expression.text
    const unit = source(constants)
    const enums = nodes(unit.ast, (n) => ts.isEnumDeclaration(n) && n.name.text === name)
    const members = one(enums, `枚举 ${name}`).members
    const member = one(
      members.filter((m) => m.name.text === node.name.text),
      `${name}.${node.name.text}`,
    )
    return value(member.initializer, next)
  }
  if (ts.isIdentifier(node)) return value(variable(source(constants), node.text).initializer, next)
  throw new Error('slim: 不支持的动态默认表达式')
}

function replaceValue(unit, node, replacement) {
  const current = value(node)
  const target = value(expression(replacement))
  if (Array.isArray(current) !== Array.isArray(target) || typeof current !== typeof target) {
    throw new Error(`slim: ${unit.file} 默认值类型改变：${node.getText(unit.ast)}`)
  }
  if (!isDeepStrictEqual(current, target)) edit(unit, node, replacement)
}

function storageCall(unit, key) {
  const imports = nodes(
    unit.ast,
    (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === '@/composables/use-storage',
  )
  const bindings = one(imports, `${unit.file}: useStorage 导入`).importClause?.namedBindings
  if (!bindings || !ts.isNamedImports(bindings)) {
    throw new Error(`slim: ${unit.file} 的 useStorage 导入结构改变`)
  }
  const local = one(
    bindings.elements.filter((e) => (e.propertyName || e.name).text === 'useStorage'),
    'useStorage 绑定',
  ).name.text
  const call = one(
    nodes(
      unit.ast,
      (n) =>
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === local &&
        n.arguments[0] &&
        ts.isStringLiteral(n.arguments[0]) &&
        n.arguments[0].text === key,
    ),
    key,
  )
  if (call.arguments.length < 2 || call.arguments.length > 4) {
    throw new Error(`slim: ${key} 参数结构改变`)
  }
  return call
}

function storageDefault(file, key, replacement) {
  const unit = source(file)
  replaceValue(unit, storageCall(unit, key).arguments[1], replacement)
}

function rewriteInFunction(file, name, from, to) {
  const unit = source(file)
  const scope = one(
    nodes(unit.ast, (n) => ts.isFunctionDeclaration(n) && n.name?.text === name),
    `${file}: ${name}`,
  )
  const pattern = expression(from)
  const match = one(
    nodes(scope, (n) => n.kind === pattern.kind && printed(n) === printed(pattern)),
    `${file}: ${name} 中的 ${from}`,
  )
  edit(unit, match, to)
}

let unit = source(constants)
replaceValue(
  unit,
  variable(unit, 'TEST_URL').initializer,
  "'http://www.apple.com/library/test/success.html'",
)

for (const [key, replacement] of Object.entries(defaults)) {
  storageDefault(settings, key, replacement)
}
storageDefault(
  'src/components/connections/ConnectionTable.vue',
  'config/table-sorting',
  '[{ id: CONNECTIONS_TABLE_ACCESSOR_KEY.DlSpeed, desc: true }]',
)

// 固定语言保留可写 .value 接口，但外部赋值不会改变有效语言。
unit = source(settings)
const languageCall = storageCall(unit, 'config/language')
if (variable(unit, 'language').initializer !== languageCall) {
  throw new Error('slim: language 初始化结构改变')
}
edit(unit, languageCall, 'computed<LANG>({ get: () => LANG.ZH_CN, set: () => {} })')

const registry = 'src/config/settings-items.ts'
const fixedItems = ['fonts', 'emoji', 'language']
unit = source(registry)
if (
  printed(variable(unit, 'GENERAL_ITEM_KEYS').initializer) !==
  printed(expression('keyMapByLabel(SETTINGS_MENU_KEY.general)'))
) {
  throw new Error('slim: GENERAL_ITEM_KEYS 生成方式改变')
}
const categories = variable(unit, 'SETTINGS_CATEGORIES').initializer
if (!categories || !ts.isArrayLiteralExpression(categories)) {
  throw new Error('slim: SETTINGS_CATEGORIES 结构改变')
}
const isKeyProperty = (p, key) =>
  ts.isPropertyAssignment(p) && p.name.getText(unit.ast) === 'key' && printed(p.initializer) === key
const general = one(
  categories.elements.filter(
    (c) =>
      ts.isObjectLiteralExpression(c) &&
      c.properties.some((p) => isKeyProperty(p, 'SETTINGS_MENU_KEY.general')),
  ),
  '通用设置分类',
)
for (const label of fixedItems) {
  const matches = nodes(
    general,
    (n) =>
      ts.isPropertyAssignment(n) &&
      n.name.getText(unit.ast) === 'label' &&
      ts.isStringLiteral(n.initializer) &&
      n.initializer.text === label,
  )
  one(matches, `通用设置条目 ${label}`)
}
files.set(
  registry,
  text(registry) +
    `
export const SLIM_HIDDEN_SETTINGS_KEYS = new Set([
${fixedItems.map((k) => `  GENERAL_ITEM_KEYS.${k},`).join('\n')}
])
for (const category of SETTINGS_CATEGORIES) {
  category.items = category.items.filter((item) => !SLIM_HIDDEN_SETTINGS_KEYS.has(item.key))
}
`,
)

const helper = 'src/helper/settings.ts'
unit = source(helper)
const settingsImport = one(
  nodes(
    unit.ast,
    (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === '@/config/settings-items',
  ),
  '设置键导入',
).importClause?.namedBindings
if (!settingsImport || !ts.isNamedImports(settingsImport) || !settingsImport.elements.length) {
  throw new Error('slim: 设置键导入结构改变')
}
const lastImport = settingsImport.elements.at(-1)
splice(unit, lastImport.end, lastImport.end, ', SLIM_HIDDEN_SETTINGS_KEYS')
rewriteInFunction(
  helper,
  'isSettingHidden',
  '!!hiddenSettingsItems.value[key]',
  'SLIM_HIDDEN_SETTINGS_KEYS.has(key) || !!hiddenSettingsItems.value[key]',
)
rewriteInFunction(
  helper,
  'isSettingVisible',
  '!hiddenSettingsItems.value[key]',
  '!isSettingHidden(key)',
)

const visibility = 'src/composables/use-setting-visibility.ts'
exact(
  visibility,
  "import { hiddenSettingsItems } from '@/store/settings'",
  "import { isSettingVisible } from '@/helper/settings'",
)
rewriteInFunction(
  visibility,
  'useIsSettingVisible',
  '!hiddenSettingsItems.value[unref(key)]',
  'isSettingVisible(unref(key))',
)

exact('index.html', '<html lang="">', '<html lang="zh-CN">')
exact(
  'src/assembly/version.ts',
  "'https://api.github.com/repos/Zephyruso/zashboard/releases/latest'",
  `'https://api.github.com/repos/${repo}/releases/latest'`,
)
exact(
  'src/components/settings/general/ZashboardSettings.vue',
  'href="https://github.com/Zephyruso/zashboard"',
  `href="https://github.com/${repo}"`,
)

for (const file of files.keys()) if (/\.(ts|vue)$/.test(file)) source(file)
let written = 0
for (const [file, code] of files) {
  const path = resolve(root, file)
  if (readFileSync(path, 'utf8') === code) continue
  writeFileSync(path, code)
  written += 1
}
console.log(`slim: 写入 ${written} 个文件`)
