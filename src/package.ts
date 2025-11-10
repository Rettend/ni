import type { RunnerContext } from '.'
import type { PackageScript } from './scripts'
import { getPackageJSON } from './fs'
import { promptSelectPackage } from './monorepo'
import { flattenPackageScripts } from './scripts'

export async function readWorkspaceScripts(ctx: RunnerContext | undefined, args: string[]): Promise<PackageScript[]> {
  const index = args.findIndex(i => i === '-p')
  const commandTokens: string[] = []
  if (index !== -1) {
    let pointer = index + 1
    while (pointer < args.length) {
      const value = args[pointer]
      if (value === '--' || value.startsWith('-'))
        break
      commandTokens.push(value)
      pointer += 1
    }
  }

  const context = await promptSelectPackage(ctx, commandTokens)
  // Change cwd to the selected package
  if (ctx && context?.cwd)
    ctx.cwd = context.cwd

  const scripts = readPackageScripts(context)
  if (!commandTokens.length)
    return scripts

  const candidates = new Set<string>()
  const [first] = commandTokens
  if (first)
    candidates.add(first)
  const spaceKey = commandTokens.join(' ')
  if (spaceKey)
    candidates.add(spaceKey)
  const colonKey = commandTokens.join(':')
  if (colonKey)
    candidates.add(colonKey)

  const cmdIndex = scripts.findIndex((script) => {
    for (const candidate of candidates) {
      if (script.key === candidate || script.spaceKey === candidate)
        return true
    }
    return false
  })

  if (cmdIndex !== -1)
    return [scripts[cmdIndex]]

  return scripts
}

export function readPackageScripts(ctx: RunnerContext | undefined): PackageScript[] {
  // support https://www.npmjs.com/package/npm-scripts-info conventions
  const pkg = getPackageJSON(ctx)
  const scripts = flattenPackageScripts(pkg?.scripts, pkg?.['scripts-info'])

  if (scripts.length === 0 && !ctx?.programmatic) {
    console.warn('No scripts found in package.json')
  }

  return scripts
}

export { flattenPackageScripts }
export type { PackageScript }
