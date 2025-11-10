# nr Enhancements Plan

## TODO

- vscode terminal intellisense support PLS (no local fig support????)
- package.json schema to fix 'Incorrect type. Expected "string"'

## Objectives

- Support nested scripts in `package.json`, allowing invocations like `nr test ui` and `nr test:ui`.
- Improve completion UX by understanding the nested script tree for fuzzy prompts and shell completion.
- Ship a Fig (withfig/autocomplete) spec for the ni toolchain, capable of surfacing project-specific scripts dynamically and compatible with VS Code terminal Intellisense preview (<https://code.visualstudio.com/docs/terminal/shell-integration#_intellisense-preview>).
- Maintain backward compatibility for existing flat scripts while keeping flattening performant for large `package.json` files.

## Current Behaviour Snapshot

- Script discovery (`src/package.ts`) expects `Record<string, string>` and flattens nothing; autocomplete and interactive prompts only see top-level keys.
- `nr` command flow (`src/commands/nr.ts`) gathers scripts via `readPackageScripts`, prompts via `@posva/prompts`, then delegates to `parseNr` with unchanged argv.
- `parseNr` converts arguments into `<agent> run <script> ...` without consulting package metadata.
- Shell completion (`src/completion.ts`) offers fuzzy suggestions from the same flat script list.

## Nested Script Support

1. **Script Tree Parsing**
   - Define a recursive `ScriptNode` type to capture `string | { "."?: string; [child: string]: ScriptNode }`.
   - Implement a `flattenScripts(tree)` helper that produces metadata entries with:
     - `key`: colon-delimited path (`test:ui`).
     - `segments`: array form (`['test','ui']`).
     - `cmd`: command string resolved from `"."` or leaf value.
     - `description`: resolved from `scripts-info` (needs colon lookup) or fallback.
   - Mirror the same flattening logic for `scripts-info`, accepting both colon keys and nested structures to locate descriptions.
   - Update `readPackageScripts` to leverage this helper while guaranteeing no breaking changes for flat script definitions.
   - Decide how to surface the root `test` command when both `test` string and `test`.`.` exist; prefer `node` > `string` precedence.
   - Benchmark/guard the flattening pass so large script trees do not introduce noticeable startup latency (skip recursion when no nested objects are present).

2. **Argument Normalisation**
   - In `src/commands/nr.ts`, inject a step before `parseNr` to rewrite `args` when they map to a nested path:
     - Build a lookup map (keyed by first segment and by colon form).
     - Recognise patterns:
       1. `nr test ui ...` ➜ greedily join the longest matching prefix into `test:ui` and preserve trailing args, inserting `--` when needed.
       2. `nr test:ui ...` (already colonised) ➜ ensure it matches a flattened key.
        - Treat `--` as an escape hatch (`nr test -- ui`) so everything after becomes literal args with no nested resolution.
        - Respect existing semantics for `--if-present`, `-p`, and script arguments after `--`.
        - Ensure monorepo `-p` flows keep using the resolved `ctx.cwd` before normalising.
        - Read `nestedSeparator` from config (`~/.nirc`/env) supporting `colon | space | both`; default to `both` and adapt parsing rules accordingly.
        - When only nested variants exist, fall back to running the `.` command if present; otherwise prompt the user or surface a helpful error.

3. **Prompt Experience**
   - Adjust `promptSelectScript` to display nested scripts clearly (e.g. `test › ui` or visually indented label) while keeping last-run prioritisation.
   - Ensure selection returns the colon key so storage + history keep working.
   - Normalise persisted history (`storage.lastRunCommand`) to colon form regardless of user input style so `nr -` remains unambiguous.

4. **Testing**
   - Add fixtures under `test/fixtures` with nested scripts.
   - Extend Vitest suites (`test/nr/*.spec.ts`) to cover:
     - Colon invocation.
     - Space-separated nested invocation.
     - Interaction with script arguments (`nr test ui -- --watch`).
     - Monorepo `-p` scenario where only nested script exists.
       - Defaulting to the `.` variant when `nr test` has no direct command.
       - Escape hatch semantics (`nr test -- ui`) treating `ui` as a literal arg.
   - Unit-test the helper that flattens script trees using direct imports.

5. **Documentation**
   - Update `README.md` and potentially `--help` copy to describe nested script syntax.
   - Provide guidance on authoring nested script blocks and `scripts-info` support.
   - Document `nestedSeparator` configuration, greedy matching behavior, and escape-hatch usage.

## Enhanced Completion + Intellisense

1. **Internal Fuzzy Suggestions**
   - Update `getCompletionSuggestions` to consume the flattened script metadata, returning colon keys and considering alias matches (`segments.join(' ')`).
   - Consider weighting matches so base command surfaces before deep variants unless typed.
   - Respect `nestedSeparator` preference when generating suggestions (e.g. hide space forms when set to `colon`).

2. **Fig Spec Generation**
   - Evaluate Fig schema structure (command, subcommands, options, generators).
   - Create a generator module (e.g. `src/intellisense/fig.ts`) that exports:
     - Static command definitions for `ni`, `nr`, `nlx`, etc.
     - A dynamic `scriptsGenerator(cwd)` that reflects the flattened script list.
   - Provide an executable entry (CLI flag or separate script under `bin/`) to output the spec JSON/TypeScript for installation via Fig or VS Code shell integration.
   - Ensure spec integrates `-p`, `--if-present`, and nested script paths as subcommands or suggestions.

3. **Packaging Strategy**
   - Decide whether to ship compiled specs under `dist/completions/fig` or as runtime generator invoked by Fig plugin, ensuring the artifact path works for VS Code shell Intellisense.
   - Update build (`unbuild`) config to include new source if distributed.
   - Add documentation describing installation for Fig and linking to withfig/autocomplete.

4. **Testing & Validation**
   - Provide unit coverage for the generator (snapshot test for deterministic output given mock package.json).
   - Manual verification checklist for Fig + VS Code terminal integration (documented in PLAN follow-up).
   - Rely on Fig generator re-execution for package updates (no dedicated watch process) and document manual refresh steps.

## Open Questions

- Confirm config naming for `nestedSeparator` (INI key casing, corresponding env var) and document precedence.
- Determine exact messaging when neither a direct script nor `.` fallback exists for a nested command request.
- Decide whether to expose a CLI switch for exporting the Fig spec or rely solely on runtime generation.

## Implementation Order Proposal

1. Build and test the script tree parsing helper in isolation.
2. Integrate helper into `readPackageScripts`, update callers, and add nested-script tests.
3. Implement CLI argument normalisation + prompt display tweaks; expand Vitest coverage.
4. Refresh completion module to use new metadata.
5. Design and prototype the Fig spec generator, including dynamic script integration.
6. Finalise docs and release notes once behaviour is validated.
