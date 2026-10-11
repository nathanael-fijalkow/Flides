---
name: flides-review
description: Review and improve a Flides slide deck (HTML slides built on flides.js) through a local browser dashboard, where the user browses slides, compares old and new versions side by side, and leaves feedback as tickets that the agent handles asynchronously in the background. Use when the user wants to review, critique, give feedback on, or iterate on Flides slides, or to start, resume or stop a Flides review session.
---

# Flides review

The user reviews a deck in a local dashboard. They browse the slides, can point at an element, and either write feedback or ask for a slide to be removed. Each piece of feedback becomes a ticket. You listen for tickets in the background, handle each one on its own, and report back on the ticket. Every slide you change appears in the dashboard next to its previous version, and the user accepts the change, reopens the ticket with a comment, or asks for an undo. Neither side waits for the other.

Everything goes through one script, which needs Node.js 18 or later and nothing else. Below, `FR` stands for

```bash
node <skill-dir>/scripts/flides-review.mjs
```

where `<skill-dir>` is the base directory of this skill. Every command takes the deck as its last argument: the folder holding the deck's `index.html`, or the deck's HTML file. It defaults to the current folder.

## Starting a session

1. Find the deck: an HTML file that loads `flides.js` and contains elements with class `step`. If there are several decks and the user did not say which one, ask.
2. Start the dashboard with the Bash tool in the background (`run_in_background: true`), since the server runs until it is stopped: `FR serve <deck>`. It records the current deck as a version and prints the address, by default `http://localhost:4180/`. If a server is already running for this deck, it prints that address and exits. `FR url <deck>` prints the address again later.
3. Give the user the address and offer to open it in their browser (`open` on macOS, `xdg-open` on Linux).
4. Start the listening loop below.

Review data lives in `<deck>/.flides-review/`: tickets, and a snapshot of the deck for each version. The folder tells git to ignore it. Never edit these files by hand; always go through the commands.

## The listening loop

Repeat for the whole session:

1. Run `FR wait <deck>` with the Bash tool in the background. It exits as soon as a ticket is open, which wakes you up. While it runs, the dashboard shows "Agent listening".
2. When it exits, run `FR next <deck>`. This claims the oldest open ticket, or resumes one left in progress, and prints it: the feedback, the conversation so far, the element the user pointed at, the slide HTML as the user saw it, and where the slide is now in the deck file (line range).
3. Handle the ticket as described below, then close it with `FR done <id> <deck> --note "..."`, or ask a question with `FR block <id> <deck> --note "..."`.
4. Run `FR next <deck>` again until it reports no open tickets, then go back to step 1.

Never run two `wait` commands at once. After a context compaction or a restart, run `FR next` first, since it resumes any ticket left in progress. In the chat, one short line per ticket handled is enough: the user reads the results in the dashboard. If the user writes to you in the chat meanwhile, answer them and carry on with the loop.

## Handling one ticket

Treat each ticket independently: do what it asks, on the slides it concerns, and nothing more. Each ticket gets its own snapshot before and after your work, so that the user can review, accept or undo every change separately. Folding several tickets into one edit, or fixing unrelated things on the way, breaks that.

- Read the deck around the reported lines before editing. Read [reference/flides-format.md](reference/flides-format.md) the first time you edit a Flides deck in a session, and whenever a change involves layout, positions, reveals or animations.
- **Remove a slide**: delete the slide's element, then repair what depended on it: links to its id (`href="#id"`), and CSS rules keyed on the id (`#id ...` or `.flides-on-id ...`) in the deck's stylesheet. Do not move the remaining slides. If the removal leaves a visible hole, for instance in an overview, say so in the note instead of reflowing the deck.
- Tickets name the kind of slide: an ordinary slide (with the number the deck shows in its corner), a backup slide (`data-fixed="1"`, outside the main flow), the partial overview (`overview_intermediate`) or the final overview (`overview`). They also give the screen size the reviewer looked at, since what fits on a slide depends on it (see Geometry in the reference).
- **Text feedback**: act on it as a careful editor would. "Points at" names the element the user clicked. Its path comes from the rendered page, where MathJax inserts its own elements, so identify the element by the text and HTML shown rather than by the path. For a formula, the text shown is its LaTeX source.
- Follow the deck's conventions: its color tags (such as `<red>` or `<blue>`), its heading levels, and the way it sizes figures (often a rule per slide in `css/style.css`). Keep the existing indentation. Do not reformat unrelated code, rename ids, or touch `flides.js` unless the ticket requires it; in the Flides repository itself, the engine's source is `lib/flides.js`, followed by `npm run build`.
- A new slide needs a unique id and a position (`data-x`, `data-y`, `data-scale`) consistent with its neighbours; the reference explains how. Duplicate ids are sometimes intentional (overview slides that share a style), so never change them unless asked.
- After editing, `FR check <deck>` reports missing or duplicate ids, broken links and unclosed slides. `done` refuses to close a ticket whose change introduced one of these problems; fix it, or pass `--force` if it is intended.
- When a change concerns appearance (overflowing text, sizes, positions) and you have a browser tool, look at the slide at `<dashboard address>deck/<deck file>#/<slide id>` before closing the ticket.

Prefer acting over asking: the user can always reopen a ticket. Use `block` only when the ticket is ambiguous in a way that matters, or when doing it would mean inventing content (results, data, references) or using a file you do not have. Ask one precise question. Never put a question in a `done` note, since the user can accept a done ticket without the answer ever reaching you.

The `done` note is what the user reads beside the before and after views. Write one or two formal sentences saying what you changed and anything they should check.

Reopened tickets come back through `next` with the whole conversation; the last message from the user says what to change. "Please undo this change" means restoring what this ticket changed. `next` prints the path of the deck as it was before the ticket; compare it with the current file (for instance with `diff -u`) and revert this ticket's changes only, keeping those made by other tickets since.

## Ticket states

| State | Meaning | Next |
|---|---|---|
| `open` | Waiting for you | `next` makes it `in_progress` |
| `in_progress` | Claimed by you | `done` or `block`; `release` puts it back |
| `done` | Waiting for the user's review | The user accepts it (`closed`) or reopens it (`open`) |
| `blocked` | Waiting for the user's answer | The answer makes it `open` again |
| `closed`, `cancelled` | Finished | None |

## Commands

| Command | Purpose |
|---|---|
| `FR serve <deck> [--port N]` | Start the dashboard (run in the background) |
| `FR url <deck>` | Print the dashboard address |
| `FR wait <deck> [--timeout S]` | Block until a ticket is open, then list the open tickets |
| `FR next <deck>` | Claim the next ticket and print it |
| `FR show <id> <deck> [--json]` | Print a ticket |
| `FR done <id> <deck> --note "..." [--force]` | Close a ticket for review, with a note |
| `FR block <id> <deck> --note "..."` | Ask the user a question about a ticket |
| `FR release <id> <deck>` | Put a claimed ticket back in the queue |
| `FR list <deck> [--all]` | List tickets |
| `FR check <deck>` | Check ids and links |
| `FR snapshot <deck> [--label "..."]` | Record the current deck as a version |

## Stopping

When the user is done, stop the background `wait` and the server (stop the background tasks, or kill the server process, whose pid is in `.flides-review/server.json`). Tickets and versions stay on disk, and a later `serve` picks up where the session ended. Do not commit anything to git unless the user asks. When the review is over for good, the user may delete `.flides-review/`.
