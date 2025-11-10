import { describe, expect, it } from 'vitest'
import { flattenPackageScripts, prepareScriptMatch } from '../../src/scripts'

describe('flattenPackageScripts', () => {
  it('flattens nested script trees with metadata', () => {
    const scripts = flattenPackageScripts(
      {
        'build': 'pnpm build',
        'test': {
          '.': 'pnpm vitest',
          'ui': {
            '.': 'pnpm vitest --ui',
          },
          'unit': 'pnpm vitest run unit',
        },
        '?test': 'Run the full suite',
      },
      {
        test: {
          '.': 'Run tests',
          'ui': 'Run UI tests',
        },
      },
    )

    const byKey = Object.fromEntries(scripts.map(item => [item.key, item]))

    expect(Object.keys(byKey).sort()).toEqual([
      'build',
      'test',
      'test:ui',
      'test:unit',
    ])

    expect(byKey.test).toMatchObject({
      cmd: 'pnpm vitest',
      description: 'Run tests',
      segments: ['test'],
      display: 'test',
    })

    expect(byKey['test:ui']).toMatchObject({
      cmd: 'pnpm vitest --ui',
      description: 'Run UI tests',
      spaceKey: 'test ui',
      segments: ['test', 'ui'],
      display: 'test › ui',
    })
  })
})

describe('prepareScriptMatch', () => {
  const tree = flattenPackageScripts(
    {
      test: {
        '.': 'pnpm vitest',
        'ui': { '.': 'pnpm vitest --ui' },
      },
    },
    {},
  )

  it('joins space-separated segments when allowed', () => {
    const args = ['test', 'ui', '--', '--watch']
    const match = prepareScriptMatch(args, tree, 'both')
    expect(match?.script?.key).toBe('test:ui')
    expect(match?.consumed).toBe(2)
    expect(match?.startIndex).toBe(0)
  })

  it('flags space usage when separator is colon', () => {
    const args = ['test', 'ui']
    const match = prepareScriptMatch(args, tree, 'colon')
    expect(match?.reason).toBe('space-not-allowed')
  })

  it('matches colon form even when separator is space', () => {
    const args = ['test:ui']
    const match = prepareScriptMatch(args, tree, 'space')
    expect(match?.script?.key).toBe('test:ui')
  })

  it('handles nested-only roots gracefully', () => {
    const nestedOnly = flattenPackageScripts(
      {
        test: {
          ui: 'pnpm vitest --ui',
        },
      },
      {},
    )

    const args = ['test']
    const match = prepareScriptMatch(args, nestedOnly, 'both')
    expect(match?.reason).toBe('nested-only')
    expect(match?.related?.map(item => item.key)).toEqual(['test:ui'])
  })

  it('skips flag positions like -p', () => {
    const args = ['-p', 'test', 'ui']
    const match = prepareScriptMatch(args, tree, 'both')
    expect(match?.startIndex).toBe(1)
    expect(match?.script?.key).toBe('test:ui')
  })
})
