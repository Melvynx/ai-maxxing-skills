# Review output format

Use this format for an explicit review-only request or a detailed review requested alongside implementation. The `better` entrypoint defaults to implementing fixes and returning a concise change-and-verification summary; this format must not delay implementation or create an approval gate. A domain skill reporting on its own carries its own smaller format in its `## Reporting` section.

## Scope and coverage

State the exact scope, stack and styling conventions, the project convention documents found in recon and any review boundary. Then show coverage:

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Files, components, states, or checks | Findings count or `Clear` |

Include all six domain guides listed in `better/SKILL.md`. `Clear` means inspected with no actionable finding; `Not reviewed` must explain why.

## Findings

One table, ordered by severity, then by reach:

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | `src/Dialog.tsx:42` | `<button><XIcon /></button>` | Add `aria-label="Close"` and hide the icon from the accessibility tree | The icon-only control has no accessible name |

- **Severity** comes from the HIGH, MEDIUM, and LOW definitions in `better/SKILL.md`.
- **Location** cites `path/to/file:line`. Cite the exact screen and component when the artifact has no source files.
- **Before / After** show the current implementation and an actionable replacement. Never split them into separate "Before:" and "After:" lines.
- **Why** names the violated principle and its user impact.
- **Domain** is the owning skill without the `better-` prefix.

Each row is one root cause. Consolidate a repeated systemic issue into one row and list every affected location. Respect the finding cap. With no findings, omit the table and state "No actionable interface findings."

## Verification

List each check or interaction, the exact command or steps and the observed result. Separate checks that passed from checks marked **Not verified**.

## Verdict

End with one of two:

- `Block`: one or more `HIGH` findings remain. Do not ship until they are fixed.
- `Approve`: no `HIGH` findings remain. Any `MEDIUM` and `LOW` findings stay in the table as work to do.

`Approve` claims the coverage you reported, so never issue it for a domain you did not inspect.
