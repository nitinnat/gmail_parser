# Email Reader Modal — Design

**Goal:** Clicking any email row opens a modal overlay displaying the full email content.

**Approach:** App-level state in `App.jsx`. No routing changes, no new context. Two state vars (`openEmailId`, `openEmailData`) control the modal. `onOpenEmail(id)` is threaded as a prop to Browse, Triage, and Search, which pass it to `EmailRow`.

---

## Architecture

- `App.jsx` holds `openEmailId` (string | null) and `openEmailData` (object | null).
- `EmailModal` is rendered at the App root (below the router outlet), conditioned on `openEmailId`.
- `onOpenEmail(id)` sets `openEmailId`; the modal fetches the email itself.
- Closing the modal resets both state vars to null.

## Components

### `EmailModal` (new — `frontend/src/components/EmailModal.jsx`)
- Fixed full-screen scrim (`rgba(0,0,0,0.7)`), centered panel (max-w 700px, max-h 85vh).
- Header: subject, sender, date, To/CC (if present), label pills, starred indicator.
- Body: scrollable plain-text, `whitespace-pre-wrap`, monospace font.
- Close: `×` button, Escape key, backdrop click.
- Loading state while fetch is in-flight; error state on failure.
- Calls `api.actions.markRead([id])` silently on open; calling view updates its local state.

### `EmailRow` changes
- Adds optional `onOpen` prop.
- When provided: outer div becomes `cursor-pointer`, calls `onOpen(email.id)` on click.
- Checkbox `onClick` still stops propagation (checking ≠ opening).

### Browse / Triage / Search
- Each receives `onOpenEmail` prop from App and passes it to `EmailRow`.
- On successful open, update local email list to mark the email as read.

## Data Flow

1. Click `EmailRow` → `onOpen(id)` → App sets `openEmailId = id`, `openEmailData = null`.
2. `EmailModal` mounts, calls `api.emails.get(id)`.
3. Response: `{ id, document, metadata }` → renders header + body.
4. `api.actions.markRead([id])` called silently.
5. Close → `openEmailId = null`.

## Data Available

- `document`: plain-text email body (stored at ingest time from `body_text`).
- `metadata`: subject, sender, recipients_to, recipients_cc, date_iso, labels, is_starred, has_attachments, category, snippet.
- No HTML body stored — plain text only.

## What Changes

| File | Change |
|------|--------|
| `frontend/src/App.jsx` | Add `openEmailId`/`openEmailData` state, `handleOpenEmail`, thread prop to Browse/Triage/Search, render `EmailModal` |
| `frontend/src/components/EmailModal.jsx` | New component |
| `frontend/src/components/EmailRow.jsx` | Add optional `onOpen` prop, cursor-pointer when provided |
| `frontend/src/views/Browse.jsx` | Accept + thread `onOpenEmail`, update local read state on open |
| `frontend/src/views/Triage.jsx` | Accept + thread `onOpenEmail` |
| `frontend/src/views/Search.jsx` | Accept + thread `onOpenEmail` |

No backend changes required — `GET /emails/{id}` already exists.
