import { expect, it } from 'vitest'
import { parseNr, serializeCommand } from '../../src/commands'
import { flattenPackageScripts, prepareScriptMatch } from '../../src/scripts'

const agent = 'npm'
function _(arg: string, expected: string) {
  return async () => {
    expect(
      serializeCommand(await parseNr(agent, arg.split(' ').filter(Boolean))),
    ).toBe(
      expected,
    )
  }
}

it('empty', _('', 'npm run start'))

it('if-present', _('test --if-present', 'npm run --if-present test'))

it('script', _('dev', 'npm run dev'))

it('script with arguments', _('build --watch -o', 'npm run build -- --watch -o'))

it('colon', _('build:dev', 'npm run build:dev'))

const nestedScripts = flattenPackageScripts(
  {
    test: {
      '.': 'vitest',
      'ui': { '.': 'vitest --ui' },
    },
  },
  {},
)

async function parseNormalized(input: string, separator: 'colon' | 'space' | 'both' = 'both') {
  const args = input.split(' ').filter(Boolean)
  const match = prepareScriptMatch(args, nestedScripts, separator)
  if (match?.script)
    args.splice(match.startIndex, match.consumed, match.script.key)
  if (match?.script) {
    const separatorIndex = match.startIndex + 1
    if (args[separatorIndex] === '--')
      args.splice(separatorIndex, 1)
  }

  return serializeCommand(await parseNr(agent, args))
}

it('space separated nested script', async () => {
  await expect(parseNormalized('test ui')).resolves.toBe('npm run test:ui')
})

it('nested script with args', async () => {
  await expect(parseNormalized('test ui -- --watch')).resolves.toBe('npm run test:ui -- --watch')
})

it('escape hatch keeps literal args', async () => {
  const result = await parseNormalized('test -- ui')
  expect(result).toBe('npm run test -- ui')
})

it('space separator disabled by preference', async () => {
  const args = 'test ui'.split(' ')
  const match = prepareScriptMatch(args, nestedScripts, 'colon')
  expect(match?.reason).toBe('space-not-allowed')
})

it('normalises nested scripts with -p flag', () => {
  const args = ['-p', 'test', 'ui']
  const match = prepareScriptMatch(args, nestedScripts, 'both')
  expect(match?.startIndex).toBe(1)
  if (match?.script)
    args.splice(match.startIndex, match.consumed, match.script.key)
  expect(args).toEqual(['-p', 'test:ui'])
})
