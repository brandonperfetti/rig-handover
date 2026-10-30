---
name: plan-to-issues
description: Split this repo's plan.md into GitHub issues with gh, one per unit of work, after a human has reviewed the split. Use when a plan is ready and has no issues yet.
---

# plan-to-issues

Turns `plan.md` into GitHub issues that workers can pick up cold. Easiest with `gh`, authenticated,
in a shell this agent can run.

## Steps

1. Read `plan.md`, `AGENTS.md` and `docs/adr/`.
2. Draft the split as a table: title · plan section · scope · done when · blocked by.
   One issue per unit of work.
3. **Stop and show the table to the human.** Publish nothing until they approve it.
4. Every issue carries the shape under [What every issue carries](#what-every-issue-carries).
   Ask the human only about a field or label it doesn't cover.
5. Create each issue in dependency order, so blocked-by can cite real numbers:

   ```sh
   gh issue create --title "<title>" --label "plan:<plan>" --body-file <tmp.md>
   ```

   `<plan>` is the `plan:` key in `plan.md`'s frontmatter. Create the label once if it's missing
   (`gh label create "plan:<plan>"`).

6. Record every issue URL from gh's output (not from memory) and reply with the list.

## What every issue carries

Label `plan:<plan>`, and a body in this order:

```md
Source: plan.md § <n>

## Scope

What to build, with the ADRs it must keep. Enough for a worker who hasn't read the plan.

## Done when

One check anyone can run.

## Blocked by

Every blocker: #<n>, #<m>, with what to start against meanwhile if there is anything, plus any
non-issue blocker in plain words, such as a review. With none: `—`.

## Model tier

<kind>: <tier> model.
```

The first line is exactly `Source: plan.md § <n>`, nothing before it. Model tier follows AGENTS.md
step 3: `Logic: strongest model.` for logic; `View`, `Route`, `Tests` or `Mechanical` with
`cheaper model.` for the rest.

## Closing one

With the closing comment from AGENTS.md:

```sh
gh issue close <n> -c "<closing comment>"
```

## No `gh`

Steps 1–4 hold either way. GitHub reachable another way (a connector, the REST API, the web UI):
the same issues, made that way. GitHub issues out of reach altogether: write them as files in
`docs/issues/`, format in ADR 0004, then commit and push.

## Don'ts

- Don't paste the whole plan into one issue, and don't keep issues only in chat.
- Don't invent sections the plan doesn't have. If the plan is unclear, ask.
