// Lightweight source reader: finds types and their member blocks in every language Claude Code meets (C#, the
// C family, Java and its relatives, Go, Rust, TS/JS and their templates, Python, Ruby, Lua, Elixir, ML languages,
// shells, PowerShell, SQL, shaders, HTML/CSS, config files, and a generic fallback for any other text), plus the
// references between types. Regex and brace/indent scanning only, so it is fast and forgiving.
import type { NodeKind } from './protocol'

export type MemberFacts = { name: string; start: number; end: number; callback: boolean }
export type TypeFacts = {
  id: string
  name: string
  kind: NodeKind
  start: number
  end: number
  base?: string
  members: MemberFacts[]
  refs: string[]
}
export type FileFacts = { rel: string; hash: number; lines: number; lineHashes: number[]; types: TypeFacts[]; includes: string[] }

// families: 'cs' C#; 'js' TS/JS (and the script block of Vue/Svelte); 'java' Java/Kotlin/Scala/Swift/Dart/PHP;
// 'c' C/C++/Objective C; 'go'; 'rust'; 'py' Python; 'ruby'; 'lua'; 'elixir'; 'ml' Haskell/OCaml/F#/Elm;
// 'sh' shells; 'ps' PowerShell; 'sql'; 'shader'; 'css'; 'html'; 'vue'; 'json'; 'yaml'; 'toml'; 'ini'; 'md';
// 'text' anything else that is text
type Lang = 'cs' | 'js' | 'java' | 'c' | 'go' | 'rust' | 'py' | 'ruby' | 'lua' | 'elixir' | 'ml' | 'sh' | 'ps' | 'sql' | 'shader' | 'css' | 'html' | 'vue' | 'json' | 'yaml' | 'toml' | 'ini' | 'md' | 'text'

const EXT: Record<string, Lang> = {
  cs: 'cs',
  shader: 'shader', hlsl: 'shader', cginc: 'shader', compute: 'shader', glsl: 'shader', vert: 'shader', frag: 'shader', wgsl: 'shader',
  ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', mts: 'js', cts: 'js',
  vue: 'vue', svelte: 'vue',
  java: 'java', kt: 'java', kts: 'java', scala: 'java', swift: 'java', dart: 'java', php: 'java', groovy: 'java',
  c: 'c', h: 'c', cpp: 'c', cc: 'c', cxx: 'c', hpp: 'c', hh: 'c', hxx: 'c', m: 'c', mm: 'c', ino: 'c',
  go: 'go', rs: 'rust', py: 'py', pyw: 'py', rb: 'ruby', rake: 'ruby', lua: 'lua', ex: 'elixir', exs: 'elixir',
  hs: 'ml', ml: 'ml', mli: 'ml', fs: 'ml', fsx: 'ml', elm: 'ml',
  sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh', ps1: 'ps', psm1: 'ps', psd1: 'ps',
  sql: 'sql', css: 'css', scss: 'css', sass: 'css', less: 'css', html: 'html', htm: 'html', xml: 'html', svg: 'html', xaml: 'html', uxml: 'html',
  json: 'json', jsonc: 'json', json5: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini', properties: 'ini',
  md: 'md', markdown: 'md', txt: 'text', rst: 'text', csv: 'text', tsv: 'text', bat: 'sh', cmd: 'sh', mk: 'text', cmake: 'text', gradle: 'java',
}

export const SKIP_DIRS = new Set([
  'Library', 'Temp', 'Logs', 'obj', 'bin', 'Build', 'Builds', 'UserSettings', 'node_modules', 'MemoryCaptures',
  'Recordings', 'PackageCache', 'dist', 'out', 'build', 'target', 'coverage', '__pycache__', 'venv', 'packages',
  'vendor', 'Pods', 'DerivedData', 'bower_components', 'Generated', 'generated',
])

// binaries, archives, media and generated bundles are never read as text
const BINARY = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'psd', 'tga', 'tif', 'tiff', 'exr', 'hdr', 'pdf', 'zip', '7z', 'rar', 'gz', 'tgz', 'tar', 'bz2', 'xz',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'wav', 'mp3', 'ogg', 'flac', 'mp4', 'mov', 'avi', 'webm', 'ttf', 'otf', 'woff', 'woff2', 'eot', 'class', 'jar',
  'pyc', 'pyo', 'o', 'a', 'lib', 'pdb', 'db', 'sqlite', 'sqlite3', 'unitypackage', 'fbx', 'blend', 'obj', 'glb', 'gltf', 'cubemap', 'asset', 'prefab',
  'unity', 'mat', 'anim', 'controller', 'meta', 'nupkg', 'apk', 'ipa', 'dmg', 'iso', 'img', 'bc', 'wasm', 'lock', 'map', 'min.js', 'min.css',
])
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'cargo.lock', 'composer.lock', 'gemfile.lock', 'poetry.lock'])

const NOT_NAMES = new Set([
  'if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'return', 'new', 'base', 'this', 'typeof', 'nameof',
  'sizeof', 'default', 'when', 'get', 'set', 'fixed', 'checked', 'unchecked', 'await', 'throw', 'stackalloc', 'in', 'is', 'as',
  'out', 'ref', 'var', 'where', 'else', 'do', 'try', 'finally', 'function', 'constructor', 'super', 'synchronized', 'elif', 'with',
  'match', 'loop', 'unless', 'until', 'case', 'select', 'defer', 'go', 'println', 'printf', 'echo', 'require', 'import', 'export', 'then',
])

const CALLBACKS = new Set([
  'Awake', 'Start', 'Update', 'FixedUpdate', 'LateUpdate', 'OnEnable', 'OnDisable', 'OnDestroy', 'OnValidate', 'OnGUI',
  'OnDrawGizmos', 'OnDrawGizmosSelected', 'OnTriggerEnter', 'OnTriggerExit', 'OnTriggerStay', 'OnCollisionEnter',
  'OnCollisionExit', 'OnCollisionStay', 'Reset', 'OnApplicationQuit', 'OnApplicationFocus', 'OnBecameVisible',
  'OnBecameInvisible', 'OnInspectorGUI', 'OnSceneGUI', 'OnPreRender', 'OnPostRender', 'OnRenderImage', 'OnMouseDown',
  'OnMouseUp', 'OnTriggerEnter2D', 'OnCollisionEnter2D', 'OnRenderObject', 'OnWillRenderObject',
])

const BEHAVIOUR_BASES = new Set([
  'MonoBehaviour', 'ScriptableObject', 'Editor', 'EditorWindow', 'NetworkBehaviour', 'StateMachineBehaviour',
  'PropertyDrawer', 'ScriptableWizard', 'AssetPostprocessor', 'UIBehaviour', 'SettingsProvider', 'ScriptableRendererFeature',
])

const TYPE_RX = /\b(record\s+struct|record\s+class|class|struct|interface|enum|record|object|trait|protocol|union)\s+([A-Za-z_$][\w$]*)/
const INC_RX = /#include(?:_with_pragmas)?\s+["<]([^">]+)[">]/g
const SHADER_FN_RX = /^[ \t]*(?:inline[ \t]+)?[A-Za-z_]\w*[ \t]+([A-Za-z_]\w*)[ \t]*\([^;{}]*?\)[ \t]*(?::[ \t]*\w+[ \t]*)?\r?$/gm
const JS_FN_RX = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>/
const JS_ARROW_LINE_RX = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)\n]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=>/gm
const JS_IMPORT_RX = /\bimport\s+[^;]*?from\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
// a TypeScript type alias is a type of its own (an interface on the map); an exported object literal at the top
// of a module is one of its members, like a loose function
const TS_ALIAS_RX = /^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/
const JS_OBJ_RX = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*$/
const PS_FN_RX = /^[ \t]*(?:function|filter|workflow)\s+([A-Za-z_][\w-]*)/
const SH_FN_RX = /^[ \t]*(?:function\s+([A-Za-z_][\w-]*)\s*(?:\(\s*\))?|([A-Za-z_][\w-]*)\s*\(\s*\))\s*\{?/
const GO_TYPE_RX = /\btype\s+([A-Za-z_]\w*)\s+(struct|interface)\b/
const GO_METHOD_RX = /\bfunc\s*\(\s*\w*\s*\*?\s*([A-Za-z_]\w*)\s*\)\s*([A-Za-z_]\w*)\s*\(/
const RUST_IMPL_RX = /\bimpl\b(?:\s*<[^>]*>)?\s*(?:[A-Za-z_][\w:]*(?:\s*<[^>]*>)?\s+for\s+)?([A-Za-z_]\w*)/
const TRANSPARENT_RX = /^(?:namespace\b|extern\s+"C"|mod\s+[A-Za-z_]\w*\s*$|package\s+[A-Za-z_][\w.]*\s*$)/
const SQL_RX = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:MATERIALIZED\s+)?(TABLE|VIEW|FUNCTION|PROCEDURE|INDEX|TRIGGER|TYPE|SCHEMA)\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."\[\]`]+)/gi
const GENERIC_INC: Partial<Record<Lang, RegExp>> = {
  c: INC_RX,
  py: /^\s*(?:from\s+\.?([\w.]+)\s+import|import\s+([\w.]+))/gm,
  rust: /^\s*(?:pub\s+)?mod\s+(\w+)\s*;|\buse\s+(?:crate|self|super)::([\w]+)/gm,
  ruby: /\brequire(?:_relative)?\s*\(?\s*['"]([^'"]+)['"]/g,
  lua: /\brequire\s*\(?\s*['"]([^'"]+)['"]/g,
  sh: /^\s*(?:source|\.)\s+([^\s;]+)/gm,
  ps: /^\s*\.\s+["']?([^\s"';]+)/gm,
  css: /@(?:import|use|forward)\s+['"]([^'"]+)['"]/g,
  java: /^\s*(?:require|require_once|include|include_once)\s*\(?\s*['"]([^'"]+)['"]/gm,
  elixir: /\b(?:alias|import|use)\s+([A-Z][\w.]*)/g,
  ml: /^\s*(?:import|open)\s+(?:qualified\s+)?([A-Z][\w.]*)/gm,
}

export function langOf(rel: string): Lang | undefined {
  const dot = rel.lastIndexOf('.')
  const name = rel.slice(rel.lastIndexOf('/') + 1).toLowerCase()
  if (SKIP_FILES.has(name)) return undefined
  if (dot < 0) {
    // extensionless text files (Makefile, Dockerfile, Rakefile, scripts) are still text
    return /^(makefile|dockerfile|rakefile|gemfile|procfile|vagrantfile|justfile|cmakelists)$/.test(name) ? (name === 'rakefile' || name === 'gemfile' ? 'ruby' : 'text') : undefined
  }
  const ext = rel.slice(dot + 1).toLowerCase()
  if (BINARY.has(ext) || name.endsWith('.min.js') || name.endsWith('.min.css') || name.endsWith('.d.ts')) return undefined
  return EXT[ext] ?? (/^[a-z0-9]{1,12}$/.test(ext) ? 'text' : undefined)
}

export function isTracked(rel: string): boolean {
  if (!langOf(rel)) return false
  const parts = rel.split('/')
  for (let i = 0; i < parts.length - 1; i++) if (parts[i].startsWith('.') || SKIP_DIRS.has(parts[i])) return false
  return true
}

export function fnv(s: string, a = 0, b = s.length): number {
  let h = 2166136261
  for (let i = a; i < b; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

function lineHashes(text: string): number[] {
  const out: number[] = []
  let ls = 0
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) {
      let a = ls, b = i
      while (a < b && text.charCodeAt(a) <= 32) a++
      while (b > a && text.charCodeAt(b - 1) <= 32) b--
      out.push(fnv(text, a, b))
      ls = i + 1
    }
  }
  return out
}

export function lineDelta(a: number[] | undefined, b: number[]): { added: number; removed: number } {
  const counts = new Map<number, number>()
  if (a) for (const h of a) counts.set(h, (counts.get(h) ?? 0) + 1)
  let added = 0
  for (const h of b) {
    const c = counts.get(h) ?? 0
    if (c > 0) counts.set(h, c - 1); else added++
  }
  let removed = 0
  for (const c of counts.values()) removed += c
  return { added, removed }
}

const BRACE_LANGS = new Set<Lang>(['cs', 'js', 'java', 'c', 'go', 'rust', 'sh'])

export function analyze(rel: string, text: string): FileFacts {
  const lh = lineHashes(text)
  const f: FileFacts = { rel, hash: fnv(text), lines: lh.length, lineHashes: lh, types: [], includes: [] }
  const lang = langOf(rel) ?? 'text'
  const fileName = rel.slice(rel.lastIndexOf('/') + 1)

  if (lang === 'shader') {
    const t: TypeFacts = { id: '', name: fileName, kind: 'shader', start: 1, end: f.lines, members: [], refs: [] }
    for (const m of text.matchAll(SHADER_FN_RX)) {
      const name = m[1]
      if (NOT_NAMES.has(name)) continue
      const line = lineAt(text, m.index ?? 0)
      if (t.members.length) t.members[t.members.length - 1].end = line - 1
      t.members.push({ name, start: line, end: f.lines, callback: false })
    }
    f.types.push(t)
    for (const m of text.matchAll(INC_RX)) f.includes.push(m[1])
  } else if (lang === 'py') {
    parsePy(text, f, fileName)
  } else if (lang === 'ps' || lang === 'sh') {
    parseFnBlocks(text, f, fileName, lang === 'ps' ? PS_FN_RX : SH_FN_RX)
  } else if (lang === 'ruby' || lang === 'lua' || lang === 'elixir') {
    parseEndBlocks(text, f, fileName, lang)
  } else if (lang === 'ml') {
    parseColumnZero(text, f, fileName)
  } else if (lang === 'sql') {
    parseSql(text, f, fileName)
  } else if (lang === 'css') {
    parseCss(text, f, fileName)
  } else if (lang === 'html') {
    parseHtml(text, f, fileName)
  } else if (lang === 'vue') {
    parseVue(text, f, fileName)
  } else if (lang === 'json' || lang === 'yaml' || lang === 'toml' || lang === 'ini') {
    parseConfig(text, f, fileName, lang)
  } else if (lang === 'md') {
    parseMarkdown(text, f, fileName)
  } else if (lang === 'text') {
    parseText(text, f, fileName)
  } else if (lang === 'c' && /^\s*@(?:interface|implementation)\b/m.test(text)) {
    parseObjc(text, f, fileName)
  } else {
    parseBraceFile(text, f, fileName, lang)
  }

  // includes shared by family
  const inc = GENERIC_INC[lang]
  if (inc) for (const m of text.matchAll(inc)) { const v = m[1] || m[2]; if (v) f.includes.push(v) }
  if (lang === 'js' || lang === 'vue') for (const m of text.matchAll(JS_IMPORT_RX)) { const v = m[1] || m[2] || m[3]; if (v && v.startsWith('.')) f.includes.push(v) }

  mergeTypes(f)
  const seen = new Map<string, number>()
  for (const t of f.types) {
    const c = seen.get(t.name) ?? 0
    seen.set(t.name, c + 1)
    t.id = rel + '#' + t.name + (c > 0 ? '~' + (c + 1) : '')
    if (t.end < t.start) t.end = t.start
    if (t.members.length > 400) t.members.length = 400
  }
  return f
}

// brace languages: types with members, loose functions gathered into one module node
function parseBraceFile(text: string, f: FileFacts, fileName: string, lang: Lang): void {
  const s = strip(text, lang)
  const spans: [number, number][] = []
  const loose = parseBraces(s, f, spans, lang)
  if (lang === 'js') {
    // one-line arrows at column 0 have no braces for the parser to see
    const have = new Set(loose.map(m => m.name))
    for (const m of s.matchAll(JS_ARROW_LINE_RX)) {
      if (have.has(m[1])) continue
      const ln = lineAt(s, m.index ?? 0)
      loose.push({ name: m[1], start: ln, end: ln, callback: false })
    }
    loose.sort((a, b) => a.start - b.start)
  }
  if (loose.length || f.types.length === 0) {
    // file-level functions (TS/JS modules, C files, Go packages, scripts) become one parchment node
    f.types.unshift({ id: '', name: fileName, kind: loose.length ? 'function' : 'script', start: 1, end: f.lines, members: loose, refs: [] })
    spans.unshift([0, s.length])
  }
  for (let i = 0; i < f.types.length; i++) f.types[i].refs = idents(s, spans[i][0], Math.min(s.length, spans[i][1] + 1))
}

// same-named types in one file (Rust impl blocks, Swift extensions, Objective C interface plus implementation,
// partial classes) become one type with all their members
function mergeTypes(f: FileFacts): void {
  const byName = new Map<string, TypeFacts>()
  const out: TypeFacts[] = []
  for (const t of f.types) {
    const key = t.name + '|' + (t.kind === 'script' || t.kind === 'function' ? 'file' : 'type')
    const prev = byName.get(key)
    if (prev && key.endsWith('|type')) {
      prev.members.push(...t.members)
      prev.start = Math.min(prev.start, t.start); prev.end = Math.max(prev.end, t.end)
      if (!prev.base && t.base) prev.base = t.base
      if (prev.kind === 'class' && t.kind !== 'class') prev.kind = t.kind
      for (const r of t.refs) if (!prev.refs.includes(r)) prev.refs.push(r)
      continue
    }
    byName.set(key, t)
    out.push(t)
  }
  for (const t of out) t.members.sort((a, b) => a.start - b.start)
  f.types = out
}

function lineAt(s: string, idx: number): number {
  let n = 1
  for (let i = 0; i < idx && i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  return n
}

// removes comments, string contents and preprocessor lines while keeping newlines so line numbers stay valid
function strip(s: string, lang: Lang): string {
  const out: string[] = []
  const n = s.length
  const js = lang === 'js' || lang === 'java' || lang === 'rust' || lang === 'go' || lang === 'sh'
  const hashComments = lang === 'sh'
  let i = 0
  let lineStart = true
  while (i < n) {
    const c = s[i]
    if (lineStart && c === '#' && (lang === 'cs' || lang === 'c')) { while (i < n && s[i] !== '\n') i++; continue }
    if (c === '#' && hashComments) { while (i < n && s[i] !== '\n') i++; continue }
    if (c === '\n') { out.push('\n'); i++; lineStart = true; continue }
    if (c > ' ') lineStart = false
    if (c === '/' && s[i + 1] === '/' && !hashComments) { while (i < n && s[i] !== '\n') i++; continue }
    if (c === '/' && s[i + 1] === '*' && !hashComments) {
      i += 2
      while (i + 1 < n && !(s[i] === '*' && s[i + 1] === '/')) { if (s[i] === '\n') out.push('\n'); i++ }
      i += 2
      continue
    }
    if (c === '"' || c === '`' || (js && c === "'")) {
      const verbatim = c === '"' && lang === 'cs' && (s[i - 1] === '@' || (s[i - 1] === '$' && s[i - 2] === '@'))
      const multi = verbatim || c === '`'
      i++
      while (i < n) {
        const d = s[i]
        if (d === '\n') { out.push('\n'); if (!multi) break }
        if (verbatim) {
          if (d === '"') { if (s[i + 1] === '"') { i += 2; continue } break }
        } else {
          if (d === '\\') { i += 2; continue }
          if (d === c) break
        }
        i++
      }
      i++
      out.push('""')
      continue
    }
    if (c === "'") {
      let j = i + 1
      j += s[j] === '\\' ? 2 : 1
      while (j < n && j < i + 10 && s[j] !== "'" && s[j] !== '\n') j++
      if (s[j] === "'") { i = j + 1; out.push("' '"); continue }
    }
    out.push(c)
    i++
  }
  return out.join('')
}

type Frame = { t: TypeFacts | null; bodyDepth: number; span: number }

function parseBraces(s: string, f: FileFacts, spans: [number, number][], lang: Lang): MemberFacts[] {
  const stack: Frame[] = []
  const loose: MemberFacts[] = []
  const goMethods: { type: string; m: MemberFacts }[] = []
  let open: MemberFacts | undefined
  let openDepth = -1
  let depth = 0, line = 1, hs = -1, hl = 1

  const memberFrom = (header: string, start: number, end: number): MemberFacts | undefined => {
    const p = header.indexOf('('), eq = header.indexOf('=')
    if (p <= 0 || (eq >= 0 && eq < p && !header.includes('=>')) || header.includes('delegate')) return undefined
    const name = methodName(header)
    return name ? { name, start, end, callback: CALLBACKS.has(name) } : undefined
  }
  // the nearest frame that is a real type (namespaces and modules are transparent)
  const typeTop = (): Frame | undefined => { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].t) return stack[k]; return undefined }
  const atTop = (): boolean => { const top = stack[stack.length - 1]; return !top || depth === top.bodyDepth }
  // a loose declaration at file level: a function (any brace language), an object literal (JS), a Go method
  const looseFrom = (header: string, start: number, end: number): MemberFacts | undefined => {
    const cut = Math.max(header.lastIndexOf('function'), header.lastIndexOf('const '), header.lastIndexOf('let '), header.lastIndexOf('var '), header.lastIndexOf('func '), header.lastIndexOf('fn '))
    const hdr = cut >= 0 ? header.slice(cut) : header
    const st = cut > 0 ? start + (header.slice(0, cut).split(String.fromCharCode(10)).length - 1) : start
    if (lang === 'go') {
      const gm = GO_METHOD_RX.exec(hdr)
      if (gm) { const m = { name: gm[2], start: st, end, callback: false }; goMethods.push({ type: gm[1], m }); return m }
    }
    if (lang === 'js') {
      const jm = JS_FN_RX.exec(hdr)
      const om = jm ? null : JS_OBJ_RX.exec(hdr)
      const name = jm ? (jm[1] || jm[2]) : om ? om[1] : undefined
      return name ? { name, start: st, end, callback: false } : undefined
    }
    if (/^(?:if|for|while|switch|else|do|try|catch|match|loop|select|unsafe|static|return)\b/.test(hdr.trim()) && !hdr.includes('(') ) return undefined
    return memberFrom(hdr, st, end)
  }

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\n') { line++; continue }
    if (hs < 0 && c > ' ' && c !== '{' && c !== '}' && c !== ';') { hs = i; hl = line }

    if (c === '{') {
      if (!open && hs >= 0) {
        const header = stripAttr(s.slice(hs, i))
        const top = stack[stack.length - 1]
        const memberLevel = atTop()
        const tf = memberLevel ? matchType(header, lang) : undefined
        if (tf) {
          tf.start = hl
          f.types.push(tf)
          spans.push([hs, s.length - 1])
          stack.push({ t: tf, bodyDepth: depth + 1, span: spans.length - 1 })
        } else if (memberLevel && TRANSPARENT_RX.test(header.trim())) {
          stack.push({ t: null, bodyDepth: depth + 1, span: -1 })
        } else if (top && top.t && depth === top.bodyDepth) {
          const m = memberFrom(header, hl, hl)
          if (m) { open = m; openDepth = depth + 1; top.t.members.push(m) }
        } else if (memberLevel) {
          const m = looseFrom(header, hl, hl)
          if (m) { open = m; openDepth = depth + 1; if (!goMethods.length || goMethods[goMethods.length - 1].m !== m) loose.push(m) }
        }
      }
      depth++
      hs = -1
      continue
    }
    if (c === '}') {
      // members written without semicolons (TypeScript interfaces, one per line) end at the closing brace
      if (!open && hs >= 0) {
        const top0 = stack[stack.length - 1]
        if (top0 && top0.t && depth === top0.bodyDepth) {
          const rows = s.slice(hs, i).split(String.fromCharCode(10))
          for (let r = 0; r < rows.length; r++) { const m = memberFrom(stripAttr(rows[r]), hl + r, hl + r); if (m) top0.t.members.push(m) }
        }
      }
      depth--
      if (open && depth === openDepth - 1) { open.end = line; open = undefined }
      const top = stack[stack.length - 1]
      if (top && top.bodyDepth === depth + 1) {
        if (top.t) { top.t.end = line; spans[top.span][1] = i }
        stack.pop()
      }
      hs = -1
      continue
    }
    if (c === ';') {
      if (!open && hs >= 0) {
        const top = stack[stack.length - 1]
        if (atTop()) {
          const header = stripAttr(s.slice(hs, i))
          const tf = matchType(header, lang)
          if (tf) {
            tf.start = hl; tf.end = line
            f.types.push(tf)
            spans.push([hs, i])
          } else if (top && top.t) {
            const m = memberFrom(header, hl, line)
            if (m) top.t.members.push(m)
          } else if (lang === 'js' || lang === 'go' || lang === 'rust') {
            const m = looseFrom(header, hl, line)
            if (m && (!goMethods.length || goMethods[goMethods.length - 1].m !== m)) loose.push(m)
          }
        }
      }
      hs = -1
      continue
    }
  }
  for (const fr of stack) { if (fr.t) { fr.t.end = line; spans[fr.span][1] = s.length - 1 } }
  // Go methods go onto their receiver's type when it is in this file, else they stay loose
  for (const gm of goMethods) {
    const t = f.types.find(x => x.name === gm.type)
    if (t) t.members.push(gm.m); else loose.push(gm.m)
  }
  return loose
}

function matchType(header: string, lang: Lang): TypeFacts | undefined {
  const h = header.trim()
  if (lang === 'js') {
    const ta = TS_ALIAS_RX.exec(h)
    if (ta && !NOT_NAMES.has(ta[1])) return { id: '', name: ta[1], kind: 'interface', start: 0, end: 0, members: [], refs: [] }
  }
  if (lang === 'go') {
    const gt = GO_TYPE_RX.exec(h)
    if (gt) return { id: '', name: gt[1], kind: gt[2] === 'interface' ? 'interface' : 'struct', start: 0, end: 0, members: [], refs: [] }
    return undefined
  }
  if (lang === 'rust') {
    const im = /^(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?impl\b/.test(h) ? RUST_IMPL_RX.exec(h) : null
    if (im) return { id: '', name: im[1], kind: 'class', start: 0, end: 0, members: [], refs: [] }
  }
  if (lang === 'java' && /^(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+)?extension\s+([A-Za-z_]\w*)/.test(h)) {
    const em = /extension\s+([A-Za-z_]\w*)/.exec(h)
    if (em) return { id: '', name: em[1], kind: 'class', start: 0, end: 0, members: [], refs: [] }
  }
  const m = TYPE_RX.exec(header)
  if (!m) return undefined
  const p = header.indexOf('(')
  if (p >= 0 && p < m.index) return undefined
  // "new class" style expressions and JS "object" keys are not declarations
  if ((m[1] === 'object' || m[1] === 'trait') && lang !== 'java' && lang !== 'rust') return undefined
  if (m[1] === 'protocol' && lang !== 'java') return undefined
  if (m[1] === 'union' && lang !== 'c' && lang !== 'rust') return undefined
  const kw = m[1]
  const name = m[2]
  if (NOT_NAMES.has(name)) return undefined
  const pre = header.slice(0, m.index)
  if (/[=(,]\s*$/.test(pre)) return undefined
  const isStatic = pre.includes('static')
  const tf: TypeFacts = { id: '', name, kind: 'class', start: 0, end: 0, members: [], refs: [] }

  const rest = header.slice(m.index + m[0].length)
  const ext = /^\s*(?:<[^{]*?>)?\s*(?::|extends\b|\()\s*(?:public\s+|private\s+|protected\s+|virtual\s+)?([A-Za-z_$][\w$.]*)/.exec(rest)
  if (ext) {
    const b = ext[1]
    tf.base = b.slice(b.lastIndexOf('.') + 1)
  }

  if (kw === 'interface' || kw === 'protocol' || kw === 'trait') tf.kind = 'interface'
  else if (kw.endsWith('struct') || kw === 'union') tf.kind = 'struct'
  else if (kw === 'enum') tf.kind = 'enum'
  else if (kw.startsWith('record')) tf.kind = 'record'
  else if (isStatic || kw === 'object') tf.kind = 'static'
  else if (tf.base && BEHAVIOUR_BASES.has(tf.base)) tf.kind = 'behaviour'
  return tf
}

function stripAttr(h: string): string {
  h = h.trim()
  while (h.startsWith('[') || h.startsWith('@') || h.startsWith('#[')) {
    if (h.startsWith('@')) {
      // decorators / annotations: @Name or @Name(...)
      const m = /^@[\w.]+(\s*\([^)]*\))?\s*/.exec(h)
      if (!m) return h
      h = h.slice(m[0].length)
      continue
    }
    if (h.startsWith('#[')) h = h.slice(1)
    let d = 0, k = 0
    for (; k < h.length; k++) {
      if (h[k] === '[') d++
      else if (h[k] === ']') { d--; if (d === 0) break }
    }
    if (k >= h.length) return ''
    h = h.slice(k + 1).trimStart()
  }
  return h
}

function isWord(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '$'
}

function methodName(header: string): string | undefined {
  const p = header.indexOf('(')
  if (p <= 0) return undefined
  let j = p - 1
  while (j >= 0 && header[j] <= ' ') j--
  if (header[j] === '>') {
    let d = 0
    for (; j >= 0; j--) {
      if (header[j] === '>') d++
      else if (header[j] === '<') { d--; if (d === 0) { j--; break } }
    }
    while (j >= 0 && header[j] <= ' ') j--
  }
  const e = j
  while (j >= 0 && isWord(header[j])) j--
  if (e <= j) return header.includes('operator') ? 'operator' : undefined
  const name = header.slice(j + 1, e + 1)
  if (!name || (name[0] >= '0' && name[0] <= '9')) return undefined
  // a keyword name is fine when a function keyword declares it (Rust fn new, Lua function set)
  if (NOT_NAMES.has(name) && !/\b(?:fn|func|def|function)\s+$/.test(header.slice(0, j + 1))) return undefined
  return name
}

// PowerShell and shells: the script is one node whose members are its functions; a function closes with the
// brace that balances its own. Comments start with '#' (PowerShell also has <# #> blocks).
function parseFnBlocks(text: string, f: FileFacts, fileName: string, rx: RegExp): void {
  const t: TypeFacts = { id: '', name: fileName, kind: 'script', start: 1, end: f.lines, members: [], refs: [] }
  const lines = text.split('\n')
  let open: MemberFacts | undefined, depth = 0, openDepth = 0, block = false
  for (let i = 0; i < lines.length; i++) {
    let ln = lines[i]
    if (block) { const e = ln.indexOf('#>'); if (e < 0) continue; ln = ln.slice(e + 2); block = false }
    for (;;) { const b = ln.indexOf('<#'); if (b < 0) break; const e = ln.indexOf('#>', b + 2); if (e < 0) { ln = ln.slice(0, b); block = true; break } ln = ln.slice(0, b) + ln.slice(e + 2) }
    const h = ln.indexOf('#'); if (h >= 0 && (h === 0 || ln[h - 1] !== '$')) ln = ln.slice(0, h)
    if (!open) {
      const m = rx.exec(ln)
      const name = m ? (m[1] || m[2]) : undefined
      if (name && !NOT_NAMES.has(name)) { open = { name, start: i + 1, end: i + 1, callback: false }; t.members.push(open); openDepth = depth }
    }
    for (let k = 0; k < ln.length; k++) {
      const c = ln[k]
      if (c === '{') depth++
      else if (c === '}') { depth--; if (open && depth === openDepth) { open.end = i + 1; open = undefined } }
    }
    if (open && open.start === i + 1 && depth === openDepth && !/\{/.test(ln)) {
      // "name() {" on the next line: wait for it; a one-line body without braces closes at once
      if (!/^\s*(?:function\s+)?[A-Za-z_][\w-]*\s*(?:\(\s*\))?\s*$/.test(lines[i])) { open.end = i + 1; open = undefined }
    }
  }
  if (open) open.end = lines.length
  if (t.members.length) t.kind = 'function'
  t.refs = idents(text, 0, text.length)
  f.types.push(t)
}

// Ruby, Lua and Elixir: blocks close with 'end'. Each line's block openers and closers are counted (a one-line
// "if x then y end" nets to nothing); classes and modules are types, defs and functions are members.
function parseEndBlocks(text: string, f: FileFacts, fileName: string, lang: Lang): void {
  const lines = text.split('\n')
  const loose: MemberFacts[] = []
  type Blk = { kind: 'type' | 'member' | 'other'; t?: TypeFacts; m?: MemberFacts }
  const stack: Blk[] = []
  const typeRx = lang === 'ruby' ? /^\s*(class|module)\s+([A-Z][\w:]*)/ : lang === 'elixir' ? /^\s*(defmodule|defprotocol|defimpl)\s+([A-Z][\w.]*)/ : null
  const memRx = lang === 'ruby' ? /^\s*def\s+(?:self\.)?([A-Za-z_][\w?!=]*)/ : lang === 'elixir' ? /^\s*(?:def|defp|defmacro|defmacrop|defguard|defguardp)\s+([a-z_][\w?!]*)/ : /^\s*(?:local\s+)?function\s+([A-Za-z_][\w.:]*)\s*\(|^\s*(?:local\s+)?([A-Za-z_][\w.]*)\s*=\s*function\s*\(/
  const count = (ln: string): [number, number] => {
    let opens = 0, closes = 0
    if (lang === 'lua') {
      opens = (ln.match(/\bfunction\b|\brepeat\b/g) || []).length
      if (!/^\s*elseif\b/.test(ln)) opens += (ln.match(/\bthen\b/g) || []).length
      opens += (ln.match(/\bdo\b/g) || []).length
      closes = (ln.match(/\bend\b|\buntil\b/g) || []).length
    } else if (lang === 'ruby') {
      if (/^\s*(?:if|unless|while|until|case|begin|for|class|module|def)\b/.test(ln)) opens++
      opens += (ln.match(/\bdo\b(?!\s*:)/g) || []).length
      closes = (ln.match(/\bend\b/g) || []).length
    } else {
      opens = (ln.match(/\bdo\s*$|\bdo\b(?=\s*\|)|\bfn\b/g) || []).length
      if (/\bdo:/.test(ln) && !/\bdo\s*$/.test(ln)) opens = (ln.match(/\bfn\b/g) || []).length
      closes = (ln.match(/\bend\b/g) || []).length
    }
    return [opens, closes]
  }
  for (let i = 0; i < lines.length; i++) {
    let ln = lines[i].replace(/"[^"]*"|'[^']*'/g, '""')
    ln = ln.replace(lang === 'lua' ? /--.*$/ : /#.*$/, '')
    if (!ln.trim()) continue
    const tm = typeRx ? typeRx.exec(ln) : null
    const mm = tm ? null : memRx.exec(ln)
    let [opens, closes] = count(ln)
    if (tm) {
      const t: TypeFacts = { id: '', name: tm[2].replace(/^.*::/, ''), kind: tm[1] === 'module' || tm[1] === 'defmodule' ? 'static' : 'class', start: i + 1, end: lines.length, members: [], refs: [] }
      f.types.push(t); stack.push({ kind: 'type', t }); opens = Math.max(0, opens - 1)
    } else if (mm) {
      const m: MemberFacts = { name: (mm[1] || mm[2]).replace(/^.*[.:]/, ''), start: i + 1, end: lines.length, callback: false }
      let owner: TypeFacts | undefined
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].kind === 'type') { owner = stack[k].t; break }
      if (owner) owner.members.push(m); else loose.push(m)
      // Elixir's one-line "def x, do: y" has no block at all
      if (lang === 'elixir' && /\bdo:/.test(ln) && !/\bdo\s*$/.test(ln)) { m.end = i + 1; opens = Math.max(0, opens - (ln.match(/\bfn\b/g) || []).length); closes = 0 }
      else { stack.push({ kind: 'member', m }); opens = Math.max(0, opens - 1) }
    }
    for (let k = 0; k < opens; k++) stack.push({ kind: 'other' })
    for (let k = 0; k < closes; k++) {
      const b = stack.pop()
      if (!b) break
      if (b.kind === 'type' && b.t) b.t.end = i + 1; else if (b.kind === 'member' && b.m) b.m.end = i + 1
    }
  }
  for (const b of stack) { if (b.kind === 'type' && b.t) b.t.end = lines.length; if (b.kind === 'member' && b.m) b.m.end = lines.length }
  if (loose.length || !f.types.length) f.types.unshift({ id: '', name: fileName, kind: loose.length ? 'function' : 'script', start: 1, end: f.lines, members: loose, refs: [] })
  for (const t of f.types) { const body = lines.slice(t.start - 1, t.end).join('\n'); t.refs = idents(body, 0, body.length) }
}

// Haskell, OCaml, F#, Elm: definitions start at column 0; consecutive lines naming the same thing (signature
// plus equations) are one member; data/type declarations are types of their own
function parseColumnZero(text: string, f: FileFacts, fileName: string): void {
  const lines = text.split('\n')
  const loose: MemberFacts[] = []
  let last: MemberFacts | undefined, lastType: TypeFacts | undefined
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (!ln.trim() || ln[0] === ' ' || ln[0] === '\t' || ln.startsWith('--') || ln.startsWith('//') || ln.startsWith('(*')) continue
    const tm = /^(?:data|newtype|type|class|instance|module)\s+(?:rec\s+)?(?:[A-Za-z_][\w'.]*\s*=>\s*)?([A-Za-z_][\w'.]*)/.exec(ln)
    const dm = /^(?:let\s+(?:rec\s+)?(?:inline\s+)?|and\s+)?([a-z_][\w']*)\b/.exec(ln)
    if (tm && !/^module\b/.test(ln)) {
      if (last) { last.end = i; last = undefined }
      if (lastType) lastType.end = i
      lastType = { id: '', name: tm[1].replace(/^.*\./, ''), kind: /^(?:class|instance)/.test(ln) ? 'interface' : 'record', start: i + 1, end: lines.length, members: [], refs: [] }
      f.types.push(lastType)
      continue
    }
    if (dm && !/^(?:import|open|module|where|in|then|else|let\s*$|if|match|with|do)\b/.test(ln)) {
      const name = dm[1]
      if (last && last.name === name) continue
      if (last) last.end = i
      if (lastType) { lastType.end = i; lastType = undefined }
      last = { name, start: i + 1, end: lines.length, callback: false }
      loose.push(last)
    }
  }
  f.types.unshift({ id: '', name: fileName, kind: loose.length ? 'function' : 'script', start: 1, end: f.lines, members: loose, refs: [] })
  for (const t of f.types) { const body = lines.slice(t.start - 1, t.end).join('\n'); t.refs = idents(body, 0, body.length) }
}

// SQL: every CREATE statement is a member, running to the next one
function parseSql(text: string, f: FileFacts, fileName: string): void {
  const t: TypeFacts = { id: '', name: fileName, kind: 'script', start: 1, end: f.lines, members: [], refs: [] }
  for (const m of text.matchAll(SQL_RX)) {
    const line = lineAt(text, m.index ?? 0)
    if (t.members.length) t.members[t.members.length - 1].end = line - 1
    t.members.push({ name: m[2].replace(/["`\[\]]/g, '').replace(/^.*\./, ''), start: line, end: f.lines, callback: false })
  }
  if (t.members.length) t.kind = 'function'
  t.refs = idents(text, 0, text.length)
  f.types.push(t)
}

// CSS, SCSS, LESS: every top-level rule is a member named by its selector
function parseCss(text: string, f: FileFacts, fileName: string): void {
  const t: TypeFacts = { id: '', name: fileName, kind: 'script', start: 1, end: f.lines, members: [], refs: [] }
  const s = strip(text, 'java') // no preprocessor lines: '#' starts id selectors
  let depth = 0, hs = -1, hl = 1, line = 1, open: MemberFacts | undefined
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\n') { line++; continue }
    if (hs < 0 && c > ' ' && c !== '{' && c !== '}' && c !== ';') { hs = i; hl = line }
    if (c === '{') {
      if (depth === 0 && hs >= 0) {
        const name = s.slice(hs, i).replace(/\s+/g, ' ').trim().slice(0, 40)
        if (name) { open = { name, start: hl, end: hl, callback: false }; t.members.push(open) }
      }
      depth++; hs = -1
    } else if (c === '}') { depth--; if (depth === 0 && open) { open.end = line; open = undefined }; hs = -1 }
    else if (c === ';') hs = -1
  }
  if (t.members.length) t.kind = 'function'
  f.types.push(t)
}

// HTML and XML: elements with an id, scripts and styles, and top-level sections are members
function parseHtml(text: string, f: FileFacts, fileName: string): void {
  const t: TypeFacts = { id: '', name: fileName, kind: 'script', start: 1, end: f.lines, members: [], refs: [] }
  const rx = /<(script|style|template|section|article|main|header|footer|nav|aside|form|dialog|svg|canvas|table|ul|ol|div|body|head)\b([^>]*)>/gi
  for (const m of text.matchAll(rx)) {
    const idm = /\bid\s*=\s*["']([^"']+)["']/i.exec(m[2])
    const tag = m[1].toLowerCase()
    if (!idm && tag !== 'script' && tag !== 'style' && tag !== 'template' && tag !== 'body' && tag !== 'head' && tag !== 'main') continue
    const line = lineAt(text, m.index ?? 0)
    const name = idm ? '#' + idm[1] : tag
    if (t.members.length && t.members[t.members.length - 1].start === line) continue
    t.members.push({ name, start: line, end: line, callback: false })
    if (t.members.length > 200) break
  }
  for (let i = 0; i < t.members.length; i++) t.members[i].end = i + 1 < t.members.length ? Math.max(t.members[i].start, t.members[i + 1].start - 1) : f.lines
  if (t.members.length) t.kind = 'function'
  f.types.push(t)
}

// Vue and Svelte: the script block is read as TS/JS (line numbers kept), the template and style are members
function parseVue(text: string, f: FileFacts, fileName: string): void {
  const lines = text.split('\n')
  const blank = lines.map(l => '')
  let inScript = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/<script\b/i.test(l)) { inScript = true; blank[i] = l.replace(/^.*<script\b[^>]*>/i, ''); continue }
    if (/<\/script>/i.test(l)) { inScript = false; blank[i] = l.replace(/<\/script>.*$/i, ''); continue }
    if (inScript) blank[i] = l
  }
  parseBraceFile(blank.join('\n'), f, fileName, 'js')
  const mod = f.types[0]
  const tplRx = /<(template|style)\b[^>]*>/gi
  for (const m of text.matchAll(tplRx)) {
    const line = lineAt(text, m.index ?? 0)
    const close = text.indexOf('</' + m[1].toLowerCase() + '>', m.index ?? 0)
    mod.members.push({ name: m[1].toLowerCase(), start: line, end: close >= 0 ? lineAt(text, close) : line, callback: false })
  }
  mod.members.sort((a, b) => a.start - b.start)
  if (mod.members.length) mod.kind = 'function'
}

// JSON, YAML, TOML, INI: the top-level keys (or sections) are members
function parseConfig(text: string, f: FileFacts, fileName: string, lang: Lang): void {
  const t: TypeFacts = { id: '', name: fileName, kind: 'script', start: 1, end: f.lines, members: [], refs: [] }
  const lines = text.split('\n')
  if (lang === 'json') {
    // keys at the first nesting level of the root object
    let depth = 0, inStr = false
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      let keyAt = -1
      for (let k = 0; k < ln.length; k++) {
        const c = ln[k]
        if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue }
        if (c === '"') { inStr = true; if (depth === 1 && keyAt < 0) keyAt = k; continue }
        if (c === '{' || c === '[') depth++
        else if (c === '}' || c === ']') depth--
      }
      if (keyAt >= 0) { const km = /"((?:[^"\\]|\\.)*)"\s*:/.exec(ln.slice(keyAt)); if (km) t.members.push({ name: km[1].slice(0, 40), start: i + 1, end: i + 1, callback: false }) }
    }
  } else if (lang === 'yaml') {
    for (let i = 0; i < lines.length; i++) { const m = /^([A-Za-z0-9_.$-]+)\s*:/.exec(lines[i]); if (m) t.members.push({ name: m[1], start: i + 1, end: i + 1, callback: false }) }
  } else {
    let before = true
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      const sm = /^\s*\[([^\]]+)\]/.exec(ln)
      if (sm) { before = false; t.members.push({ name: sm[1].trim(), start: i + 1, end: i + 1, callback: false }); continue }
      if (before) { const km = /^\s*([A-Za-z0-9_.-]+)\s*=/.exec(ln); if (km) t.members.push({ name: km[1], start: i + 1, end: i + 1, callback: false }) }
    }
  }
  for (let i = 0; i < t.members.length; i++) t.members[i].end = i + 1 < t.members.length ? Math.max(t.members[i].start, t.members[i + 1].start - 1) : f.lines
  if (t.members.length > 200) t.members.length = 200
  if (t.members.length) t.kind = 'function'
  f.types.push(t)
}

// Markdown: headings are members
function parseMarkdown(text: string, f: FileFacts, fileName: string): void {
  const t: TypeFacts = { id: '', name: fileName, kind: 'script', start: 1, end: f.lines, members: [], refs: [] }
  const lines = text.split('\n')
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (/^\s*```/.test(ln)) { fence = !fence; continue }
    if (fence) continue
    const m = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(ln)
    if (m) t.members.push({ name: m[1].slice(0, 40), start: i + 1, end: i + 1, callback: false })
  }
  for (let i = 0; i < t.members.length; i++) t.members[i].end = i + 1 < t.members.length ? Math.max(t.members[i].start, t.members[i + 1].start - 1) : f.lines
  if (t.members.length) t.kind = 'function'
  f.types.push(t)
}

// anything else that is text: top-level brace blocks, else indentation blocks, else blank-line chunks
function parseText(text: string, f: FileFacts, fileName: string): void {
  const t: TypeFacts = { id: '', name: fileName, kind: 'script', start: 1, end: f.lines, members: [], refs: [] }
  const lines = text.split('\n')
  const braces = (text.match(/\{/g) || []).length
  const label = (s: string) => s.trim().replace(/[{:]+\s*$/, '').replace(/\s+/g, ' ').slice(0, 32)
  if (braces >= 2 && braces === (text.match(/\}/g) || []).length) {
    let depth = 0, head = -1, open: MemberFacts | undefined
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      if (depth === 0 && ln.trim() && head < 0) head = i
      for (const c of ln) {
        if (c === '{') { if (depth === 0 && head >= 0) { const name = label(lines[head]) || 'block'; open = { name, start: head + 1, end: head + 1, callback: false }; t.members.push(open) }; depth++ }
        else if (c === '}') { depth--; if (depth === 0 && open) { open.end = i + 1; open = undefined; head = -1 } }
      }
      if (depth === 0 && !open && ln.trim() === '') head = -1
    }
  }
  if (!t.members.length) {
    // indentation blocks: a column-0 line followed by indented lines
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      if (!ln.trim() || ln[0] === ' ' || ln[0] === '\t') continue
      let j = i + 1
      while (j < lines.length && (!lines[j].trim() || lines[j][0] === ' ' || lines[j][0] === '\t')) j++
      if (j - i >= 2 && lines.slice(i + 1, j).some(l => l.trim())) t.members.push({ name: label(ln) || 'block', start: i + 1, end: j, callback: false })
      i = j - 1
    }
  }
  if (!t.members.length) {
    // blank-line separated chunks
    let start = -1
    for (let i = 0; i <= lines.length; i++) {
      const blank = i === lines.length || !lines[i].trim()
      if (!blank && start < 0) start = i
      if (blank && start >= 0) { if (i - start >= 2) t.members.push({ name: label(lines[start]) || 'chunk', start: start + 1, end: i, callback: false }); start = -1 }
    }
  }
  if (t.members.length > 120) t.members.length = 120
  if (t.members.length) t.kind = 'function'
  f.types.push(t)
}

// Objective C: @interface and @implementation blocks are the type (merged), their methods the members
function parseObjc(text: string, f: FileFacts, fileName: string): void {
  const lines = text.split('\n')
  const loose: MemberFacts[] = []
  let cur: TypeFacts | undefined, open: MemberFacts | undefined, depth = 0, openDepth = 0
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].replace(/\/\/.*$/, '')
    const tm = /^\s*@(interface|implementation|protocol)\s+([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_]\w*))?/.exec(ln)
    if (tm) {
      cur = { id: '', name: tm[2], kind: tm[1] === 'protocol' ? 'interface' : 'class', start: i + 1, end: lines.length, base: tm[3], members: [], refs: [] }
      f.types.push(cur)
      continue
    }
    if (/^\s*@end\b/.test(ln)) { if (cur) cur.end = i + 1; cur = undefined; continue }
    const mm = /^\s*[-+]\s*\([^)]*\)\s*([A-Za-z_]\w*)/.exec(ln)
    if (mm && !open) {
      open = { name: mm[1], start: i + 1, end: i + 1, callback: false }
      if (cur) cur.members.push(open); else loose.push(open)
      openDepth = depth
      if (/;\s*$/.test(ln)) { open = undefined; continue }
    } else if (!open && !cur && depth === 0) {
      const cm = /^[A-Za-z_][\w\s*]*?\b([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?\s*$/.exec(ln)
      if (cm && !NOT_NAMES.has(cm[1])) { open = { name: cm[1], start: i + 1, end: i + 1, callback: false }; loose.push(open); openDepth = depth }
    }
    for (const c of ln) { if (c === '{') depth++; else if (c === '}') { depth--; if (open && depth === openDepth) { open.end = i + 1; open = undefined } } }
  }
  if (loose.length || !f.types.length) f.types.unshift({ id: '', name: fileName, kind: loose.length ? 'function' : 'script', start: 1, end: f.lines, members: loose, refs: [] })
  for (const t of f.types) { const body = lines.slice(t.start - 1, t.end).join('\n'); t.refs = idents(body, 0, body.length) }
}

function idents(s: string, a: number, b: number): string[] {
  const set = new Set<string>()
  let i = Math.max(0, a)
  while (i < b) {
    const c = s[i]
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
      let j = i + 1
      while (j < b && isWord(s[j])) j++
      if (j - i >= 2 && c >= 'A' && c <= 'Z') set.add(s.slice(i, j))
      i = j
    } else if (c >= '0' && c <= '9') {
      while (i < b && (isWord(s[i]) || s[i] === '.')) i++
    } else i++
  }
  return [...set]
}

function parsePy(text: string, f: FileFacts, fileName: string): void {
  const lines = text.split('\n')
  const loose: MemberFacts[] = []
  let cur: TypeFacts | undefined
  let curIndent = -1
  let last: MemberFacts | undefined
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    const m = /^(\s*)(class|def|async\s+def)\s+([A-Za-z_]\w*)\s*(\(([^)]*)\))?/.exec(ln)
    if (!m) continue
    const indent = m[1].length
    if (last) last.end = i
    last = undefined
    if (cur && indent <= curIndent) { cur.end = i; cur = undefined }
    if (m[2] === 'class') {
      const base = m[5]?.split(',')[0]?.trim()
      cur = { id: '', name: m[3], kind: 'class', start: i + 1, end: lines.length, base: base || undefined, members: [], refs: [] }
      curIndent = indent
      f.types.push(cur)
    } else if (cur && indent > curIndent) {
      last = { name: m[3], start: i + 1, end: lines.length, callback: false }
      cur.members.push(last)
    } else if (indent === 0) {
      last = { name: m[3], start: i + 1, end: lines.length, callback: false }
      loose.push(last)
    }
  }
  if (loose.length || !f.types.length) f.types.unshift({ id: '', name: fileName, kind: loose.length ? 'function' : 'script', start: 1, end: f.lines, members: loose, refs: [] })
  for (const t of f.types) {
    const body = lines.slice(t.start - 1, t.end).join('\n')
    t.refs = idents(body, 0, body.length)
  }
}

// Unity: classes deriving from a behaviour become behaviours too
export function resolveKinds(files: Map<string, FileFacts>): void {
  const names = new Set<string>()
  for (const f of files.values()) for (const t of f.types) if (t.kind === 'behaviour') names.add(t.name)
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    for (const f of files.values()) {
      for (const t of f.types) {
        if (t.kind !== 'class' || !t.base || !names.has(t.base)) continue
        t.kind = 'behaviour'
        names.add(t.name)
        changed = true
      }
    }
    if (!changed) break
  }
}

// "fromId\ntoId" for every type that mentions another type by name, plus includes and imports resolved to known
// files by their base name
export function computeEdges(files: Map<string, FileFacts>): Set<string> {
  const owners = new Map<string, string[]>()
  const byBase = new Map<string, FileFacts>()
  for (const [rel, f] of files) {
    const base = rel.slice(rel.lastIndexOf('/') + 1)
    byBase.set(base.toLowerCase(), f)
    byBase.set(base.replace(/\.[^.]+$/, '').toLowerCase(), f)
    for (const t of f.types) {
      if (t.kind === 'script' || t.kind === 'shader' || t.kind === 'function') continue
      const l = owners.get(t.name)
      if (l) l.push(t.id); else owners.set(t.name, [t.id])
    }
  }
  const out = new Set<string>()
  for (const f of files.values()) {
    for (const t of f.types) {
      for (const r of t.refs) {
        const l = owners.get(r)
        if (!l || l.length > 4) continue // ambiguous common names make noise
        for (const id of l) if (id !== t.id) out.add(t.id + '\n' + id)
      }
    }
    if (f.types.length) {
      for (const inc of f.includes) {
        const base = inc.replace(/\\/g, '/').replace(/::/g, '/').replace(/\./g, '/').slice(inc.replace(/\\/g, '/').replace(/::/g, '/').replace(/\./g, '/').lastIndexOf('/') + 1).toLowerCase()
        const plain = inc.slice(inc.lastIndexOf('/') + 1).toLowerCase()
        const target = byBase.get(plain) ?? byBase.get(plain.replace(/\.[^.]+$/, '')) ?? byBase.get(base)
        if (target && target !== f && target.types.length) out.add(f.types[0].id + '\n' + target.types[0].id)
      }
    }
  }
  return out
}
