import type { RunnerContext } from '.'
import { byLengthAsc, Fzf } from 'fzf'
import { getNestedSeparator } from './config'
import { readPackageScripts } from './package'

// Print completion script
export const rawBashCompletionScript = `
###-begin-nr-completion-###

if type complete &>/dev/null; then
  _nr_completion() {
    local words
    local cur
    local cword
    _get_comp_words_by_ref -n =: cur words cword
    IFS=$'\\n'
    COMPREPLY=($(COMP_CWORD=$cword COMP_LINE=$cur nr --completion \${words[@]}))
  }
  complete -F _nr_completion nr
fi

###-end-nr-completion-###
`.trim()

export const rawZshCompletionScript = `
#compdef nr

_nr_completion() {
  local -a completions
  completions=("\${(f)$(nr --completion $words[2,-1])}")
  
  compadd -a completions
}

_nr_completion
`.trim()

export async function getCompletionSuggestions(args: string[], ctx: RunnerContext | undefined) {
  const raw = readPackageScripts(ctx)
  const separator = await getNestedSeparator()
  const allowSpace = separator !== 'colon'

  const fzf = new Fzf(raw, {
    selector: (item) => {
      const tokens = [item.key, item.display, item.description]
      if (allowSpace && item.spaceKey)
        tokens.push(item.spaceKey)
      return tokens.join(' ')
    },
    casing: 'case-insensitive',
    tiebreakers: [
      (a, b) => a.item.segments.length - b.item.segments.length,
      byLengthAsc,
    ],
  })

  const input = args[1] || ''
  const results = fzf.find(input)

  return results.map((r) => {
    if (separator === 'space' && r.item.spaceKey)
      return r.item.spaceKey
    return r.item.key
  })
}
