# Reading annotations

Enabled in all 16 topic guides via a shared local stylesheet and ordinary deferred script. Each script tag provides a stable guide ID matching its filename stem. The library index is navigation only. Local annotations work without an account or network. Optional cloud synchronization uses the project configured in `cloud-config.js`, with no third-party JavaScript dependency.

## Use

1. Select prose or table text; choose **Annotate**.
2. Write a comment and press **Save note**.
3. Click its yellow highlight, or open **Notes** at the bottom right.
4. Search, edit, jump to the passage, or delete with confirmation.
5. **Export JSON** downloads a backup; **Import JSON** merges a backup for this guide. Conflicting comment revisions are preserved separately.

Rendered equations are excluded from highlighting to preserve their MathML/KaTeX structure. Selections across equations highlight the eligible prose only. Notes in collapsed exercise answers remain attached; Go to text expands their containing details elements.

## Persistence

Local storage key: `learning-annotations:v1:<guide ID>`. The existing KV Cache key remains `learning-annotations:v1:KV_Cache_Management_Guide`. Notes and backups are isolated by guide.
The storage indicator reports whether a write succeeded. Storage for `file:` pages varies by browser, and browser data clearing or moving a file can affect access. Export backups before those operations. No annotations are written into the source HTML. If storage is unavailable, the tab keeps notes in memory and displays a backup reminder. Unreadable stored data is not overwritten.

Anchors store the exact quote, offsets in the eligible text stream, and surrounding context. After edits, a unique quote/context match can relocate it. Ambiguous/unmatched annotations stay in the sidebar without a guessed highlight. Overlapping notes share highlight segments. Imports are size/schema/guide checked, and comments are inserted with textContent, never HTML.

Keep the `assets` directory beside the HTML. Local saves merge changes from other tabs. Concurrent conflicting comment revisions are preserved as separate notes.

## Private cloud synchronization

1. Open a guide on [the hosted library](https://thuwjt.github.io/ai-learning-library/), then open **Notes**.
2. Enter your email and choose **Email me a sign-in link**.
3. Open the email link in the same browser where you requested it. Sign in separately on your MacBook and phone. The default Supabase email contains a link; **Verify code** is only for email templates that also supply a code.
4. Notes synchronize automatically after changes and when you return to the tab or regain connectivity. The panel reports synchronization failures; local notes remain available.

Magic-link requests supply the current guide as the `redirect_to` query parameter to `/auth/v1/otp`. The redirect must be in the Supabase allowed URL list. If Auth falls back to the site root, the library forwards the authentication hash to the KV Cache guide. The callback immediately removes the credential hash from browser history, verifies the access token through `/auth/v1/user`, and checks its email against the email requested by this browser before storing the session. Links from a different browser must be requested again there. Ordinary section-anchor hashes are unchanged.

For this trial, use the Supabase project owner’s email. The default email provider restricts delivery to project-authorized addresses and limits email frequency. Such errors appear in the panel. A project administrator can configure SMTP for broader delivery; the client does not assume custom email templates are available.

Browser notes saved from a local `file:` guide are on a different origin from the website. **Export JSON once from the existing local guide and import it into the matching hosted guide** to migrate them. Magic-link login is offered on the hosted website, not local files. Subsequent device synchronization needs no export.

Cloud rows are private per authenticated user via row-level security. Edits use revision-checked writes. Deletions use explicit, durable per-note intents and server tombstones; a stale tab cannot infer deletion from a missing note. Conflicting edits are retained, and a concurrent edit takes precedence over a deletion. Signing out leaves the local device copy intact. Use a separate browser profile for a different account; existing account-owned notes are never automatically uploaded to another account.

Only the public project URL and publishable key belong in `cloud-config.js`; never place a service-role key in website assets. Authentication sessions reside in this site’s browser storage. Administrative retrieval of annotations is separate from the public website and requires authorized credentials.

Auth references: [Supabase passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [implicit flow](https://supabase.com/docs/guides/auth/sessions/implicit-flow).

## Verification

`tools/test_learning_annotations.cjs` exercises creation, cross-element selection, overlapping marks, text/math preservation, persisted reload, editing, import conflict preservation and deduplication, wrong-guide rejection, deletion, blocked storage, corrupt-data protection, and initialization against the actual guide. Requires jsdom only for tests, not the guide. For a temporary install:

```sh
npm install --prefix /tmp/learning-annotations-test jsdom --ignore-scripts --no-audit --no-fund
NODE_PATH=/tmp/learning-annotations-test/node_modules node tools/test_learning_annotations.cjs
```

Safari visual/interaction acceptance is the user trial; the behavior tests use a simulated DOM and do not claim browser rendering verification.

Cloud regression suites (mock network/storage; no user browser data is accessed):

```sh
node tools/test_annotation_cloud.cjs
node tools/test_cloud_sync_stale_tab.cjs
node tools/test_annotation_auth.cjs
```
