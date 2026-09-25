## Commands

- `npm run data`: rebuild `public/data/` from `data/raw/` (local, free)
- `npm run dev`: local server
- `npm run build`: static site in `dist/` (no deploy step yet)
- Raw data downloads (BTS, ~550 MB) are listed in README.md; free, but ask before re-downloading.

## Permission

- **Nothing that costs money or deploys unless asked for in the current request.** Asking for a
  diff, an audit or a plan is not asking for it to be executed. Permission for one run does not
  carry to the next.
- **Commit locally; never push until User has tested and says to push.** Passing checks are not
  permission.
- **Anything a model reads** (prompts, config it is given): paste the exact diff in chat, wait for
  a yes, then deploy. Three separate steps.
- Stop any dev or preview server you started before replying; User runs his own on that port.
- Local artifacts (design exports, scratch runs) stay out of the repo.

## Parallel sessions

- One Claude session per working tree. Before the first edit, run `git worktree list` and
  `git status`: changes you did not make mean another session is in this checkout — stop and
  move to your own.
- New work gets its own worktree and branch: `git worktree add ../<repo>-<task> -b <branch>
  main`.
- Commit only the files you changed (`git add <path>`, never `git add .` or `-A`). Never rebase,
  reset or switch branches in a checkout another session is using.
- The stash is shared across worktrees: no bare `git stash` / `pop`. Set work aside with a WIP
  commit.
- Worktrees isolate files, not external services: a deploy from any of them is still a deploy.

## Evidence

- Read the offending lines before reporting any automated failure count. Regex checks have been
  exactly backwards before.
- Never mask, scrub or edit the data under analysis. Transform the reference side; exempt by
  identity, not deletion.
- A check or rubric changed? Re-score saved outputs instead of paying for a new run.
- Measure the noise floor (repeat passes) before calling a model or prompt difference real.
- Test a prompt change with one variable moved at a time — ideally by degree, where the flip
  point is the finding.

## Prompts and copy

- No quotable lines in prompts. Keep "never say X"; replace "say X" with the shape of the line —
  quoted lines get recited, not improvised.
- Stop a rule or UI line where the instruction ends. Cut the explanatory tail.
- Keep model-facing strings (prompts, scoring data) apart from UI copy; presentation copy lives
  beside its component.

## UI options: a design workshop

When User asks to see options or workshop a screen, make a **Design canvas** on claude.ai, not
code: `Artifact` quickstart with intent `design`, then publish with its `type_url` and a title.
He iterates on it with Claude there.

- One artboard per option, side by side; a variant goes under the option it varies. Letter them
  (A, B, B2…) so they can be named in chat.
- Build them from the app's real tokens and real data, so the options differ only in layout.
- A sticky brief beside them: the problem, the constraints, the open questions.
- Generate the artboards from a script in the scratchpad. Re-read `project/canvas.json` before
  every republish and send only the files that changed; User edits the canvas live.
- The canvas changes no code. Implement the chosen option afterward and check it at desktop and
  phone widths, light and dark.

## Models

- Before changing a role's model, check its default `effort` and whether it accepts `effort` at
  all — defaults differ by model, and some reject the parameter.
- Reasoning tokens come out of `max_tokens`. Too small a budget returns an empty or fragmentary
  reply. Size the budget for thinking, and don't assume the off switch works.
- Fallbacks must be on a different vendor.
- **A field of cheap, narrow calls often beats one big frontier call** — faster, cheaper, and each
  answer easier to check. Before reaching for the frontier model on a broad question, ask whether
  small models on tightly scoped ones, with code deciding what is decidable, would do. That holds
  for what we build and for the subagents you spin up to do the work.