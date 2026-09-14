# In-app public provider directory

## Behavior and data source

Support → Treatment Finder → **Browse all providers** loads current approved listings from the same public `provider_submissions_public` view used by SoberHelpline.com. Provider details remain on `/finder/[id]` inside the app; browsing never opens the website. Existing category-guided paths remain available.

- No duplicated database, sync schedule, account migration or website/backend change.
- Explicit public-field projection excludes submitter identity, private contact fields and addresses.
- Directory client does not persist/refresh auth sessions or consume the app's signed-in token.
- Paginated reads with exact counts replace the old 50-row cap. Each listing ID is retained: equal names can represent different locations or services. Category and location distinguish these entries.
- Name/city/state/service search (including translated service labels), state and insurance filters, refresh, recoverable error and not-found states.
- Insurance option values match the website (`Self Pay`, `Blue Cross`, `Blue Shield`, `Anthem/Blue Cross Blue Shield`).
- Existing unverified-availability label is retained. Listed pricing is explicitly subject to confirmation, not a quote or guaranteed bed availability.
- Offset pages are not a database snapshot. A concurrent equal-size replacement can evade count consistency detection; refresh reads the current directory. Visible conflicts/incomplete responses fail rather than silently truncating.

## Verification

- `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`.
- `tests/provider-directory.test.ts`: more than 50 rows, smaller server-page cap, identical names, safe projection, category/state/insurance parameters, detail status/UUID guard, errors, missing counts, unapproved rows, later-page failure, duplicate/incomplete responses.
- Existing lifecycle test updated to valid UUID fixtures and chainable `.eq()` mocks; its previous failure/not-found/no-unsupported-service assertions retained.
- Live read-only comparison: all 63 approved website listing IDs matched the app adapter and all 63 detail reads resolved. No private contact values were returned by the adapter.
- Expo export completed for web, iOS and Android. These are JS/Hermes exports, **not signed device builds**.
- Full exported web app browser gate: mocked auth/account only, real public-directory GETs; all other external requests blocked. Covers browse-all, category path, search/empty search, state filter, Edit/Back, detail without external navigation, unknown ID, failed-load retry, Spanish service search and widths 320/390/768. No inquiry submitted.

Browser reproduction requires Playwright and an isolated local preview of an export built with:

```
EXPO_PUBLIC_SUPABASE_URL=https://app-auth.fixture.invalid
EXPO_PUBLIC_SUPABASE_ANON_KEY=test-only-public-key
```

Those are **test-only build values**, never production release configuration. The directory retains its existing public website endpoint/key. Serve the SPA at `http://127.0.0.1:4398`; set `EVIDENCE_DIR` to the independent public listing baseline directory, and optionally `PLAYWRIGHT_MODULE` to the installed Playwright path. `scripts/verify-live-provider-directory.ts` compares against `public-directory-baseline.json` and writes `live-app-directory.json`; `scripts/test-provider-directory-browser.cjs` consumes the latter. No auth bypass or fixture module is imported by production app code.

## Release boundary

Keep the existing **[hold deployment]** convention. This code-only change does not authorize deployment of other held app/backend work. No EAS update, signed build, store submission, backend deployment or web publication was performed. The installed app needs an approved release before this new browse-all behavior appears. Keep existing bundle IDs, runtime/app version, store identity, signing and payment configuration unchanged.

Physical iOS/Android keyboard, screen-reader and very-large-list performance checks remain release QA; browser geometry and successful Hermes exports do not prove them.
