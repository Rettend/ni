import type { Choice } from '@posva/prompts'
import type { PackageScript } from '../package'
import type { RunnerContext } from '../runner'
import type { NestedSeparator } from '../scripts'
import process from 'node:process'
import prompts from '@posva/prompts'
import { byLengthAsc, Fzf } from 'fzf'
import { getCompletionSuggestions, rawBashCompletionScript, rawZshCompletionScript } from '../completion'
import { getNestedSeparator } from '../config'
import { readPackageScripts, readWorkspaceScripts } from '../package'
import { parseNr } from '../parse'
import { runCli } from '../runner'
import { prepareScriptMatch } from '../scripts'
import { dump, load } from '../storage'
import { limitText } from '../utils'

runCli(async (agent, args, ctx) => {
  const storage = await load()
  const nestedSeparator = await getNestedSeparator()

  let scripts: PackageScript[] | undefined

  const promptSelectScript = async (raw: PackageScript[]) => {
    const terminalColumns = process.stdout?.columns || 80

    const last = storage.lastRunCommand
    const choices = raw.map<Choice>((script) => {
      const { key, description, display } = script
      return {
        title: display,
        value: key,
        description: limitText(
          display !== key
            ? `${description} (${key})`
            : description,
          terminalColumns - 15,
        ),
      }
    })

    if (last) {
      const index = choices.findIndex(choice => choice.value === last)
      if (index > 0) {
        const [lastChoice] = choices.splice(index, 1)
        choices.unshift(lastChoice)
      }
    }

    const fzf = new Fzf(raw, {
      selector: item => `${item.key} ${item.display} ${item.description}`,
      casing: 'case-insensitive',
      tiebreakers: [byLengthAsc],
    })

    try {
      const { fn } = await prompts({
        name: 'fn',
        message: 'script to run',
        type: 'autocomplete',
        choices,
        async suggest(input: string, choices: Choice[]) {
          if (!input)
            return choices
          const results = fzf.find(input)
          return results.map(r => choices.find(c => c.value === r.item.key))
        },
      })
      if (!fn)
        process.exit(1)
      args.push(fn)
    }
    catch {
      process.exit(1)
    }
  }

  // Use --completion to generate completion script and do completion logic
  // (No package manager would have an argument named --completion)
  if (args[0] === '--completion') {
    const compLine = process.env.COMP_LINE
    const rawCompCword = process.env.COMP_CWORD
    // In bash
    if (compLine !== undefined && rawCompCword !== undefined) {
      const compCword = Number.parseInt(rawCompCword, 10)
      const compWords = args.slice(1)
      // Only complete the second word (nr __here__ ...)
      if (compCword === 1) {
        const suggestions = await getCompletionSuggestions(compWords, ctx)

        // eslint-disable-next-line no-console
        console.log(suggestions.join('\n'))
      }
    }
    // In other shells, return suggestions directly
    else {
      const suggestions = await getCompletionSuggestions(args, ctx)

      // eslint-disable-next-line no-console
      console.log(suggestions.join('\n'))
    }
    return
  }

  // Print ZSH completion script
  if (args[0] === '--completion-zsh') {
    // eslint-disable-next-line no-console
    console.log(rawZshCompletionScript)
    return
  }

  // Print Bash completion script
  if (args[0] === '--completion-bash') {
    // eslint-disable-next-line no-console
    console.log(rawBashCompletionScript)
    return
  }

  // -p is a flag attempt to read scripts from monorepo
  if (args[0] === '-p') {
    scripts = await readWorkspaceScripts(ctx, args)
    const raw = scripts
    // Show prompt if there are multiple scripts
    if (raw.length > 1) {
      await promptSelectScript(raw)
    }
  }

  if (args[0] === '-') {
    if (!storage.lastRunCommand) {
      if (!ctx?.programmatic) {
        console.error('No last command found')
        process.exit(1)
      }

      throw new Error('No last command found')
    }
    args[0] = storage.lastRunCommand
  }

  if (args.length === 0 && !ctx?.programmatic) {
    scripts = readPackageScripts(ctx)
    await promptSelectScript(scripts)
  }

  scripts = scripts ?? readPackageScripts(ctx)

  const matchedScript = normalizeScriptArgs(args, scripts, nestedSeparator, ctx)

  if (matchedScript && storage.lastRunCommand !== matchedScript.key) {
    storage.lastRunCommand = matchedScript.key
    dump()
  }

  return parseNr(agent, args, ctx)
})

function normalizeScriptArgs(
  args: string[],
  scripts: PackageScript[],
  separator: NestedSeparator,
  ctx: RunnerContext | undefined,
): PackageScript | undefined {
  const match = prepareScriptMatch(args, scripts, separator)

  if (!match)
    return undefined

  if (match.script) {
    if (match.consumed > 1 || args[match.startIndex] !== match.script.key)
      args.splice(match.startIndex, match.consumed, match.script.key)

    const separatorIndex = match.startIndex + 1
    if (args[separatorIndex] === '--')
      args.splice(separatorIndex, 1)

    return match.script
  }

  if (match.reason === 'space-not-allowed') {
    const attempted = match.attempted ?? match.tokens.slice(0, match.consumed).join(' ')
    const suggestion = match.related?.[0]?.key
    const message = suggestion
      ? `Script "${attempted}" is nested. Use the colon form "${suggestion}" or set nestedSeparator=space.`
      : `Unable to resolve nested script "${attempted}" with the current nestedSeparator preference.`
    handleNormalizationError(message, ctx)
  }

  if (match.reason === 'nested-only') {
    const [base] = match.tokens
    const options = match.related?.map(s => s.key).sort()
    const message = options && options.length
      ? `Script "${base}" has no direct command. Available nested scripts: ${options.join(', ')}.`
      : `Script "${base}" has no direct command.`
    handleNormalizationError(message, ctx)
  }

  return undefined
}

function handleNormalizationError(message: string, ctx: RunnerContext | undefined): never {
  if (ctx?.programmatic)
    throw new Error(message)
  console.error(message)
  process.exit(1)
}
