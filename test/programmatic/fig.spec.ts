import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildFigSpec, buildFigSpecJSON } from '../../src/intellisense/fig'

const fixtureRoot = resolve(fileURLToPath(new URL('../fixtures/nested', import.meta.url)))

describe('fig spec generation', () => {
  it('includes dynamic nr script suggestions', async () => {
    const spec = await buildFigSpec({ ctx: { cwd: fixtureRoot, programmatic: true } })
    expect(spec.name).toBe('ni-toolchain')

    const nrCommand = spec.subcommands.find(command => command.name === 'nr')
    expect(nrCommand).toBeDefined()

    const arg = Array.isArray(nrCommand?.args)
      ? nrCommand?.args[0]
      : nrCommand?.args

    expect(arg?.generators && arg.generators.length).toBeGreaterThan(0)

    const suggestions = await arg!.generators![0].custom!([])
    expect(suggestions).toEqual([
      {
        name: 'build',
        insertValue: 'build',
        description: 'tsc -b',
      },
      {
        name: 'test',
        insertValue: 'test',
        description: 'Run all tests',
      },
      {
        name: 'test › ui',
        insertValue: 'test:ui',
        description: 'UI runner',
      },
    ])
  })

  it('serialises the spec to JSON', async () => {
    const json = await buildFigSpecJSON({ ctx: { cwd: fixtureRoot, programmatic: true } })
    const parsed = JSON.parse(json)
    expect(parsed.name).toBe('ni-toolchain')
    expect(Array.isArray(parsed.subcommands)).toBe(true)
  })
})
