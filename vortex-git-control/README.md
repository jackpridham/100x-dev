# Vortex Git Control

A focused Chrome extension for navigating GitHub issues without reaching for the mouse or guessing issue numbers.

## Default sequences

Press the second key within 1.2 seconds of the first:

| Sequence | Action |
| --- | --- |
| `v` then `[` | Nearest older open issue by creation time |
| `v` then `]` | Nearest newer open issue by creation time |
| `v` then `i` | Chronologically sorted open issues |
| `v` then `p` | Open pull requests |
| `v` then `n` | New-issue template chooser |
| `v` then `r` | Force-refresh the repository's open-issue cache |
| `v` then `g` | Open an issue or pull request by number |
| `v` then `;` | Mark the current pull-request file viewed, then focus the next unviewed file |
| `v` then `'` | Focus the next unviewed pull-request file |

Previous/next navigation works only on an individual `/issues/<number>` page. The other actions work anywhere GitHub exposes repository context. All navigation stays in the current tab.

On a pull request Files changed page (`/pull/<number>/files` or `/pull/<number>/changes`), `v` then `;` marks the current file viewed, briefly waits for GitHub's UI to settle, and then focuses the first later unviewed file. In GitHub's current review UI, the extension follows the filename header pinned at the top of the viewport. Keyboard focus, viewport center, and most-visible area are conservative fallbacks for other layouts. If the current file is already viewed, it is left unchanged and the extension still waits and advances. Existing bindings for the former test-file action migrate automatically; the original `v` then `t` default moves to `v` then `;` because GitHub reserves `t` for its changed-file filter and file finder.

On the same Files changed pages, `v` then `'` scrolls to the first unviewed file strictly after the current file in DOM order. When GitHub has virtualized a large diff, the extension advances the page automatically until later files mount, then continues scanning. Viewed files are skipped, the target's filename header is preferred as the scroll target, no Viewed control is toggled, and navigation stops at the end without wrapping.

## Why navigation skips gaps correctly

The extension never adds or subtracts one from the URL. It reads the current issue's exact creation time from GitHub's page data, performs a signed-in `is:issue state:open` repository search on `github.com`, and chooses the adjacent result by creation time and issue number. Closed issues can be chronological anchors but are not navigation targets, and pull requests are excluded.

No GitHub token is collected. The search uses the browser's existing GitHub session, including access to private repositories the signed-in user can view.

The open-issue list is cached automatically when a repository is opened. Complete cache hits navigate immediately without another GitHub search. Closing or reopening the issue currently being viewed updates the shared cache and triggers a background refresh; `v r` forces the same refresh manually.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this `vortex-git-control` directory.

Click the persistent bottom-right gear button on GitHub, the extension toolbar icon, or open its Details page and select **Extension options**, to configure sequences.

On a repository's Issues or Pull requests pages (including individual items and PR review tabs), `v g` opens a dialog with the number field already focused. Enter a number and press Enter to open that issue or PR in the current tab; Escape or Cancel dismisses the dialog. No existence check is made: GitHub handles missing numbers. This sequence is configurable in settings like the others.

## Configure sequences

Number jumps use GitHub's React/Turbo link navigation when available, avoiding a forced full page reload. The dialog closes as soon as you submit. Normal same-tab navigation is the fallback; GitHub's network and rendering time still affect how quickly the destination appears.

Each action accepts exactly two printable, non-space keys. In the options page you can record a replacement, disable an action, reset one action, or restore every default. Duplicate sequences cannot be saved. Changes propagate to already-open GitHub tabs.

Sequences are deliberately ignored in inputs, textareas, selectors, buttons, contenteditable regions, and textbox widgets. Composition, held-key repeats, and Ctrl/Alt/Command-modified keys are also ignored.

## Scope and failure behavior

- Version 1 supports `github.com` only, including private repositories viewed there.
- Navigation stops at the oldest/newest open issue and does not wrap.
- GitHub handles repositories with Issues disabled, archived repositories, missing write access, and template availability after a direct action navigates.
- A small status toast reports unavailable context, chronological boundaries, network failures, or a GitHub page shape the adapter cannot safely interpret.
- Every page navigation briefly confirms what is opening in a bottom-center status toast.

After updating the extension files, use the reload button for Vortex Git Control on `chrome://extensions`, then refresh existing GitHub tabs.

## Development

The extension uses dependency-free JavaScript and Manifest V3.

```bash
npm test
```

Tests cover sequence handling, settings recovery, GitHub URL/context parsing, open and closed anchors, chronological selection, search-page validation, and direct repository routes.
