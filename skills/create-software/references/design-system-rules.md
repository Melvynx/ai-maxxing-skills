# Design system rules

Mandatory for every product screen: app, settings and admin. Build from one shared kit (page header, toolbar, row list, form dialog, setting card, confirm), so a new page reuses it instead of inventing a layout.

Copy the structure of products that got this right: Dub for settings and lists, Linear for keyboard flow and density, Superhuman for speed, Front for inbox layout. A restrained default: black and white, Geist, hairline borders.

## Page header

- H1, one-line description, primary action on the right with a `kbd` hint.
- The header shares the max-width container of the content below it, so their edges align.
- Toolbar on one line: search, then filters, then the primary button when the header does not hold it.

## Lists

- One quiet row per item, at a fixed height: tinted icon or avatar, name as plain text, muted meta, status badge, right-aligned `tabular-nums` count badge, `⋯` menu at the far right.
- Rows sit in one bordered, rounded container with hairline separators.
- Sections have a title and a count.
- Footer: "Viewing 1-N of N", with Previous and Next when paginated.
- Never leave rows in edit mode. Inline inputs or selects on every row is the most common sign of a generated UI.

## Create and edit

- Simple objects use a small modal: title, one-line subtitle, fields, then the action.
- Colors are named pills (Red, Yellow, Green, Blue, Purple, Brown, Gray) with a ring on the selected one.
- The primary button is disabled until the form is valid. Enter submits, Esc closes.
- Validate duplicates before submitting, and show the error on the field.

## Detail pages

- Complex objects get a detail page built from one card per setting.
- Card: the title is the setting, then a one-line description, then the control stacked below at a sensible width, never full-bleed.
- Footer strip on each card: constraint text left ("Max 32 characters."), "Save changes" right, disabled until dirty and still readable when disabled.
- The red Danger zone card comes last.

## Destructive and protected

- Rare and destructive actions live in `⋯`. The confirm shows the impact: "Delete this tag from 14 conversations?".
- A protected item shows a lock next to its name, and a tooltip gives the reason. Its destructive action is disabled, not missing.

## Settings navigation

- Sidebar grouped by theme (Workspace, Developers, Account), with an icon on each item.
- No group label may equal one of its item labels.

## Color and contrast

- Light and dark always, with a System, Light, Dark choice.
- Text at least 4.5:1, UI elements at least 3:1, and that includes tinted badges, disabled buttons and placeholders.
- Colors within one group are distinct: two tags in a section never share one.

## Type and spacing

- One sans family. Monospace only for code, keys and DNS records. Counts use `tabular-nums`.
- One spacing scale. Same row heights, paddings and gaps on every page.
- Every action has an icon. Labels never wrap under a fixed width: use `shrink-0`.

## Keyboard

- `c` creates, `/` searches, `j` and `k` move, `⌘K` opens the palette, `?` lists shortcuts.
- Global shortcuts pause while a dialog is open or an input has focus.

## States

- Skeletons that match the layout, not spinners.
- Optimistic updates for anything that can be undone.
- Errors are never truncated and always say what to do: "No agent connected to this inbox. Connect one in Settings › Applications".
- Empty states say what to do next and offer the action.

## Performance budget

- List: first paint under 1 s. Detail: under 300 ms warm.
- Prefetch the first window on the server (about 60 rows), and share one query key builder between the loader and the page.
- `preconnect` to the backend. Measure on the deployed app, with real data volume. More in [fast-app.md](fast-app.md).

## Screenshot loop

Required before calling a screen done.

1. Capture the real screen in light and dark, at desktop and mobile widths.
2. Put it side by side with the reference: a product the user named, or one above.
3. Review it bluntly with vision, structure first: alignment, hierarchy, density, leftovers of edit mode, clipped text, then color and detail.
4. Fix, capture again, and repeat until the review finds no structural issue.

Screenshots of real user data stay private. Use test data for anything you publish.

## Check before saying done

The header and content edges line up. No row is in edit mode. Every create form has its validation and shortcuts. Every destructive action shows its impact. Axe reports 0 violations in both themes. The screenshot loop ended with no structural issue.
