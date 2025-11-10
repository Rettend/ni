import type { RunnerContext } from '../runner'
import { getNestedSeparator } from '../config'
import { readPackageScripts } from '../package'

export interface FigSuggestion {
  name: string
  insertValue?: string
  description?: string
}

export interface FigGenerator {
  custom: (context: string[]) => Promise<FigSuggestion[]>
}

export interface FigArg {
  name: string
  description?: string
  isVariadic?: boolean
  isOptional?: boolean
  generators?: FigGenerator[]
}

export interface FigOption {
  name: string | string[]
  description?: string
  args?: FigArg | FigArg[]
}

export interface FigCommand {
  name: string | string[]
  description?: string
  options?: FigOption[]
  args?: FigArg | FigArg[]
  subcommands?: FigCommand[]
}

export interface FigSpec {
  name: string
  description?: string
  subcommands: FigCommand[]
}

export interface FigSpecOptions {
  ctx?: RunnerContext
}

function resolveContext(ctx?: RunnerContext): RunnerContext {
  return {
    programmatic: true,
    cwd: ctx?.cwd,
  }
}

async function buildScriptSuggestions(ctx?: RunnerContext): Promise<FigSuggestion[]> {
  const scripts = readPackageScripts(resolveContext(ctx))
  if (!scripts.length)
    return []

  const separator = await getNestedSeparator()

  return scripts.map((script) => {
    const value = separator === 'space' && script.spaceKey
      ? script.spaceKey
      : script.key

    return {
      name: script.display,
      insertValue: value,
      description: script.description,
    }
  })
}

export function createScriptsGenerator(ctx?: RunnerContext): FigGenerator {
  return {
    async custom() {
      return buildScriptSuggestions(ctx)
    },
  }
}

function createNiCommand(): FigCommand {
  return {
    name: 'ni',
    description: 'Install dependencies using the detected package manager',
    options: [
      { name: '-g', description: 'Install globally' },
      { name: '-P', description: 'Install in production mode' },
      { name: '--frozen', description: 'Use frozen lockfile' },
      { name: '--frozen-if-present', description: 'Freeze install when a lockfile is available' },
      { name: '-i', description: 'Interactive dependency selection' },
    ],
    args: {
      name: 'dependency',
      description: 'Packages to install',
      isVariadic: true,
      isOptional: true,
    },
  }
}

function createNrCommand(ctx?: RunnerContext): FigCommand {
  return {
    name: 'nr',
    description: 'Run npm scripts with automatic agent detection',
    options: [
      { name: '-p', description: 'Select a package in a monorepo', args: { name: 'package' } },
      { name: '--if-present', description: 'Ignore missing scripts' },
      { name: '--completion', description: 'Emit dynamic completion suggestions' },
      { name: '--completion-bash', description: 'Print the Bash completion script' },
      { name: '--completion-zsh', description: 'Print the Zsh completion script' },
    ],
    args: {
      name: 'script',
      description: 'Script name to execute',
      generators: [createScriptsGenerator(ctx)],
      isOptional: true,
    },
  }
}

function createSimpleCommand(name: string, description: string, options: FigOption[] = [], args?: FigArg | FigArg[]): FigCommand {
  return {
    name,
    description,
    options,
    args,
  }
}

function getToolchainCommands(ctx?: RunnerContext): FigCommand[] {
  return [
    createNiCommand(),
    createSimpleCommand('nci', 'Run a clean install', [
      { name: '--frozen', description: 'Install using a frozen lockfile when supported' },
    ]),
    createNrCommand(ctx),
    createSimpleCommand('nlx', 'Download and execute temporary commands', [], {
      name: 'command',
      description: 'Command and arguments to execute',
      isVariadic: true,
      isOptional: false,
    }),
    createSimpleCommand('nup', 'Upgrade dependencies with the detected agent', [
      { name: '-i', description: 'Interactive upgrade (agent dependent)' },
    ]),
    createSimpleCommand('nun', 'Uninstall dependencies', [
      { name: '-m', description: 'Select multiple dependencies interactively' },
      { name: '-g', description: 'Uninstall globally' },
    ], {
      name: 'dependency',
      description: 'Packages to remove',
      isVariadic: true,
      isOptional: true,
    }),
    createSimpleCommand('nd', 'Dedupe dependencies', [
      { name: '-c', description: 'Run in check mode when supported by the agent' },
    ]),
    createSimpleCommand('na', 'Forward commands to the detected agent', [], {
      name: 'args',
      description: 'Arguments forwarded to the agent',
      isVariadic: true,
      isOptional: true,
    }),
  ]
}

export async function buildFigSpec(options: FigSpecOptions = {}): Promise<FigSpec> {
  const { ctx } = options
  const root: FigSpec = {
    name: 'ni-toolchain',
    description: 'Completion spec for ni, nr, and related commands',
    subcommands: getToolchainCommands(ctx),
  }

  return root
}

export async function buildFigSpecJSON(options: FigSpecOptions = {}): Promise<string> {
  const spec = await buildFigSpec(options)
  return JSON.stringify(spec, null, 2)
}
