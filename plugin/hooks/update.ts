// The update check: a published plugin.json is compared with the installed one by version. Pure helpers, so the
// comparison can be tested without a network.

/** The numeric parts of a version like "0.7.16" (a leading "v" and anything after a dash or plus are ignored). */
export function parseVersion(s: string): number[] | undefined {
  const m = /^\s*v?(\d+(?:\.\d+)*)/.exec(s)
  if (!m) return undefined
  return m[1].split('.').map(n => parseInt(n, 10))
}

/** Whether `remote` is a higher version than `installed`; unparsable versions never count as newer. */
export function isNewer(remote: string, installed: string): boolean {
  const a = parseVersion(remote), b = parseVersion(installed)
  if (!a || !b) return false
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** The "version" field of a plugin manifest's text, or undefined when the text is not such a manifest. */
export function versionFromManifest(text: string): string | undefined {
  try {
    const o = JSON.parse(text) as { version?: unknown }
    return typeof o.version === 'string' && parseVersion(o.version) ? o.version : undefined
  } catch {
    return undefined
  }
}
