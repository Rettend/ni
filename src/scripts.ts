type ScriptNode = string | Record<string, unknown>

type SourceKind = 'string' | 'node'

type DescriptionMap = Map<string, string>

type ScriptAccumulator = Map<string, { script: PackageScript, source: SourceKind }>

export type NestedSeparator = 'colon' | 'space' | 'both'

export interface PackageScript {
  key: string
  cmd: string
  description: string
  segments: string[]
  spaceKey?: string
  display: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function splitKey(key: string | undefined): string[] {
  if (!key)
    return []
  return key.split(':').filter(Boolean)
}

function joinSegments(segments: string[]): string {
  return segments.join(':')
}

export function formatDisplay(segments: string[]): string {
  return segments.length > 1
    ? segments.join(' › ')
    : segments[0] ?? ''
}

function collectInfoDescriptions(value: unknown, segments: string[], map: DescriptionMap) {
  if (typeof value === 'string') {
    const key = joinSegments(segments)
    if (key && !map.has(key))
      map.set(key, value)
    return
  }

  if (!isPlainObject(value))
    return

  const dot = value['.']
  if (typeof dot === 'string') {
    const key = joinSegments(segments)
    if (key && !map.has(key))
      map.set(key, dot)
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    if (childKey === '.')
      continue
    const nextSegments = [...segments, ...splitKey(childKey)]
    collectInfoDescriptions(childValue, nextSegments, map)
  }
}

function collectScriptDescriptions(node: unknown, segments: string[], map: DescriptionMap) {
  if (!isPlainObject(node))
    return

  for (const [key, value] of Object.entries(node)) {
    if (key === '.')
      continue

    if (key.startsWith('?')) {
      const suffix = key.slice(1)
      const targetSegments = suffix === '.'
        ? segments
        : [...segments, ...splitKey(suffix)]
      collectInfoDescriptions(value, targetSegments, map)
      continue
    }

    if (isPlainObject(value))
      collectScriptDescriptions(value, [...segments, ...splitKey(key)], map)
  }
}

function addScriptEntry(
  accumulator: ScriptAccumulator,
  descriptions: DescriptionMap,
  segments: string[],
  value: unknown,
  source: SourceKind,
) {
  if (typeof value !== 'string')
    return

  const key = joinSegments(segments)
  if (!key)
    return

  const description = descriptions.get(key) ?? value

  const existing = accumulator.get(key)
  if (existing) {
    if (existing.source === 'node' && source !== 'node')
      return
    if (existing.source !== 'node' && source === 'node') {
      existing.script.cmd = value
      existing.script.description = description
      existing.source = source
      return
    }
    existing.script.cmd = value
    existing.script.description = description
    return
  }

  const spaceKey = segments.length > 1 ? segments.join(' ') : undefined

  accumulator.set(key, {
    source,
    script: {
      key,
      cmd: value,
      description,
      segments: [...segments],
      spaceKey,
      display: formatDisplay(segments),
    },
  })
}

export function flattenPackageScripts(
  rawScripts: Record<string, unknown> | undefined,
  scriptsInfo: Record<string, unknown> | undefined,
): PackageScript[] {
  if (!rawScripts || Object.keys(rawScripts).length === 0)
    return []

  const entries = Object.entries(rawScripts)
  const hasNested = entries.some(([, value]) => isPlainObject(value))

  const descriptions: DescriptionMap = new Map()

  if (scriptsInfo && isPlainObject(scriptsInfo)) {
    for (const [key, value] of Object.entries(scriptsInfo))
      collectInfoDescriptions(value, splitKey(key), descriptions)
  }

  collectScriptDescriptions(rawScripts, [], descriptions)

  if (!hasNested) {
    return entries
      .filter(([key, value]) => {
        if (key.startsWith('?'))
          return false
        return typeof value === 'string'
      })
      .map(([key, value]) => {
        const segments = splitKey(key)
        const description = descriptions.get(key) ?? (value as string)
        return {
          key,
          cmd: value as string,
          description,
          segments,
          spaceKey: segments.length > 1 ? segments.join(' ') : undefined,
          display: formatDisplay(segments),
        }
      })
  }

  const accumulator: ScriptAccumulator = new Map()

  const visit = (segments: string[], value: ScriptNode, source: SourceKind) => {
    if (typeof value === 'string') {
      addScriptEntry(accumulator, descriptions, segments, value, source)
      return
    }

    if (!isPlainObject(value))
      return

    const dot = value['.']
    if (typeof dot === 'string')
      addScriptEntry(accumulator, descriptions, segments, dot, 'node')

    for (const [childKey, childValue] of Object.entries(value)) {
      if (childKey === '.' || childKey.startsWith('?'))
        continue
      const nextSegments = [...segments, ...splitKey(childKey)]
      visit(nextSegments, childValue as ScriptNode, 'node')
    }
  }

  for (const [key, value] of entries) {
    if (key.startsWith('?'))
      continue
    visit(splitKey(key), value as ScriptNode, 'string')
  }

  return Array.from(accumulator.values()).map(({ script }) => script)
}

export interface ScriptLookup {
  byKey: Map<string, PackageScript>
  bySpaceKey: Map<string, PackageScript>
  byFirstSegment: Map<string, PackageScript[]>
}

export function buildScriptLookup(scripts: PackageScript[]): ScriptLookup {
  const byKey = new Map<string, PackageScript>()
  const bySpaceKey = new Map<string, PackageScript>()
  const byFirstSegment = new Map<string, PackageScript[]>()

  for (const script of scripts) {
    byKey.set(script.key, script)

    if (script.spaceKey)
      bySpaceKey.set(script.spaceKey, script)

    const first = script.segments[0]
    if (first) {
      const list = byFirstSegment.get(first) || []
      list.push(script)
      byFirstSegment.set(first, list)
    }
  }

  return { byKey, bySpaceKey, byFirstSegment }
}

export interface ResolveScriptResult {
  script?: PackageScript
  consumed: number
  reason?: 'space-not-allowed' | 'nested-only'
  related?: PackageScript[]
  attempted?: string
}

interface ResolveOptions {
  tokens: string[]
  lookup: ScriptLookup
  separator: NestedSeparator
}

export function resolveScriptFromTokens({ tokens, lookup, separator }: ResolveOptions): ResolveScriptResult {
  if (!tokens.length)
    return { consumed: 0 }

  const allowSpace = separator !== 'colon'
  const tokensLength = tokens.length

  if (tokensLength > 1) {
    let spaceMatch: PackageScript | undefined
    let spaceConsumed = 0

    for (let length = tokensLength; length > 1; length--) {
      const spaceKey = tokens.slice(0, length).join(' ')
      const script = lookup.bySpaceKey.get(spaceKey)
      if (script) {
        spaceMatch = script
        spaceConsumed = length
        break
      }
    }

    if (spaceMatch) {
      if (allowSpace)
        return { script: spaceMatch, consumed: spaceConsumed }

      return {
        consumed: spaceConsumed,
        reason: 'space-not-allowed',
        related: [spaceMatch],
        attempted: spaceMatch.spaceKey ?? spaceMatch.key,
      }
    }

    if (allowSpace) {
      for (let length = tokensLength; length > 1; length--) {
        const colonKey = tokens.slice(0, length).join(':')
        const script = lookup.byKey.get(colonKey)
        if (script)
          return { script, consumed: length }
      }
    }
  }

  const [firstToken] = tokens
  if (!firstToken)
    return { consumed: 0 }

  const direct = lookup.byKey.get(firstToken)
  if (direct)
    return { script: direct, consumed: 1 }

  const nestedCandidates = lookup.byFirstSegment.get(firstToken) ?? []
  const nestedOnly = nestedCandidates.filter(item => item.segments.length > 1)
  const hasDirectVariant = nestedCandidates.some(item => item.segments.length === 1)

  if (nestedOnly.length && !hasDirectVariant) {
    return {
      consumed: 1,
      reason: 'nested-only',
      related: nestedOnly,
    }
  }

  return { consumed: 1 }
}

export interface PreparedScriptMatch extends ResolveScriptResult {
  startIndex: number
  tokens: string[]
}

export function prepareScriptMatch(
  args: string[],
  scripts: PackageScript[],
  separator: NestedSeparator,
): PreparedScriptMatch | undefined {
  if (!scripts.length)
    return undefined

  const lookup = buildScriptLookup(scripts)
  const doubleDashIndex = args.indexOf('--')
  const limit = doubleDashIndex >= 0 ? doubleDashIndex : args.length

  let startIndex = -1
  for (let i = 0; i < limit; i++) {
    const token = args[i]
    if (token === '-p' || token === '--if-present')
      continue
    if (!token.startsWith('-')) {
      startIndex = i
      break
    }
  }

  if (startIndex === -1)
    return undefined

  const tokens = args.slice(startIndex, limit)
  const result = resolveScriptFromTokens({ tokens, lookup, separator })

  return {
    ...result,
    startIndex,
    tokens,
  }
}
