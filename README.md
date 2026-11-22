# Opinionated

Opinionated is a mobile-friendly dating discovery app built with React, TypeScript and Vite. It matches people based on topics they disagree on that could lead to interesting (or heated) conversations. Supabase provides hosted authentication and Postgres profile storage.

## Hosted setup

Production needs no locally hosted API or database. Create a Supabase project and a static frontend deployment (for example, on Vercel or Netlify).

1. Configure the frontend hosting build with:

   ```text
   Build command: npm run build
   Output directory: dist
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
   VITE_FACE_FEATURE_SERVICE_URL=https://YOUR_PRIVATE_FACE_SERVICE_HOST
   ```

   All three `VITE_` values are public client configuration. Never put a Supabase secret key or legacy service-role key in the frontend or any `VITE_` variable. `.env.example` contains placeholders for optional local frontend development.

2. In Supabase **Authentication → URL Configuration**, set the production site URL and add the production URL to the redirect allow list. Add `http://127.0.0.1:4173/**` if using the local development server; signup confirmation returns to `/?confirmed=1` and then opens the sign-in tab.

3. Apply all SQL migrations, in timestamp order, to the hosted project's SQL Editor:

   - [`supabase/migrations/20261120130000_profiles_and_preferences.sql`](./supabase/migrations/20261120130000_profiles_and_preferences.sql)
   - [`supabase/migrations/20261120190500_runner_discovery.sql`](./supabase/migrations/20261120190500_runner_discovery.sql)
   - [`supabase/migrations/20261121080000_runner_interests.sql`](./supabase/migrations/20261121080000_runner_interests.sql)
   - [`supabase/migrations/20261121160000_interests_minimum_three.sql`](./supabase/migrations/20261121160000_interests_minimum_three.sql)
   - [`supabase/migrations/20261122110000_perspective_matching.sql`](./supabase/migrations/20261122110000_perspective_matching.sql)
   - [`supabase/migrations/20261122120000_dating_only.sql`](./supabase/migrations/20261122120000_dating_only.sql)
   - [`supabase/migrations/20261122130000_profile_photos_swipes_matches.sql`](./supabase/migrations/20261122130000_profile_photos_swipes_matches.sql)
   - [`supabase/migrations/20261122140000_demo_profiles.sql`](./supabase/migrations/20261122140000_demo_profiles.sql)
   - [`supabase/migrations/20261122150000_gender_preferences.sql`](./supabase/migrations/20261122150000_gender_preferences.sql)
   - [`supabase/migrations/20261122160000_realtime_messaging.sql`](./supabase/migrations/20261122160000_realtime_messaging.sql)
   - [`supabase/migrations/20261122170000_email_availability_checks.sql`](./supabase/migrations/20261122170000_email_availability_checks.sql)
   - [`supabase/migrations/20261122180000_face_recommendations.sql`](./supabase/migrations/20261122180000_face_recommendations.sql)
   - [`supabase/migrations/20261122190000_opinionated_branding.sql`](./supabase/migrations/20261122190000_opinionated_branding.sql)

   Apply all thirteen in order. The first four establish and migrate the existing profile schema; subsequent migrations add preference storage, dating filters, photos and matches, messaging, email availability, private face recommendation features, and the updated product name.

4. Deploy the account deletion and email availability functions:

   ```sh
   supabase functions deploy delete-account --project-ref YOUR_PROJECT_REF
   supabase functions deploy email-available --project-ref YOUR_PROJECT_REF
   ```

   The deletion function uses Supabase's server-provided `SUPABASE_SERVICE_ROLE_KEY`. The email availability function reads the `default` key from Supabase's built-in `SUPABASE_SECRET_KEYS` JSON dictionary; set `EMAIL_CHECK_HMAC_SECRET` to a random secret of at least 32 characters. If deploying from the Supabase Dashboard, set the `email-available` function slug exactly and disable Verify JWT because signup checks run before authentication. The email function responds to requests from any origin; its database RPC rate-limits checks to 20 per client IP per hour. Only a keyed hash of the IP is stored. The HMAC key must never be added to frontend `VITE_` variables.

5. To enable photo preference learning, deploy [`services/face-inference`](./services/face-inference) as a separate Python service. Follow its [deployment guide](./services/face-inference/README.md), set `VITE_FACE_FEATURE_SERVICE_URL` on the frontend to its HTTPS origin, and rebuild. The service validates each user's Supabase session and checks their explicit Profile opt-in before processing. It uses InsightFace `buffalo_l` with SCRFD detection and ArcFace-compatible embeddings. Embeddings, photo metadata, and learned vectors are private database data; browser clients only receive ranking scores. Turning off the opt-in deletes that user's stored face features and face preference model.

6. Deploy the frontend as a static site. Update the frontend host's `VITE_` values and rebuild whenever they change; Vite embeds them at build time.

Email confirmation may be required by the Supabase project's Auth settings. When enabled, new users must confirm their email before signing in. The signup trigger creates their profile as part of the Auth user insert, including while confirmation is pending.

## Optional local frontend development

No local API, database or Docker service is used. To run only the Vite frontend, create `.env` from `.env.example`, enter your Supabase project URL and publishable key, install Node dependencies, and run:

```sh
npm install
npm run dev
```

The local Vite server is only a development convenience; the production app is the static build deployed to your frontend host. Checks:

```sh
npm test
npm run lint
npm run build
```

## Component choices and alternatives

| Component | Chosen approach | Why this over the alternative |
|---|---|---|
| Authentication | Supabase Auth | Hosted signup, password handling, email confirmation and sessions avoid maintaining custom credential storage and auth endpoints. A bespoke auth service would add operational and security work without a product requirement that needs it. |
| Profile data | Supabase Postgres with Row Level Security | Dating profiles and perspective answers are relational and benefit from constraints, transactions, and per-user policies enforced by the database. A custom Express API and separately hosted Postgres would duplicate that infrastructure and require maintaining authorization code. |
| Profile updates | Transactional Postgres RPC under the signed-in user's RLS context | One database transaction updates the profile and preferences while column grants and RLS limit access. A broad service-role API endpoint would have more privilege than this operation needs. |
| Account deletion | Supabase Edge Function with a server-only service-role key | Admin deletion requires privileged credentials. Keeping that key in a hosted function protects it from browsers; doing it in client code would expose it, while adding a separate server would be unnecessary. |
| Browser session | Supabase PKCE flow with `sessionStorage` | Session data is scoped to the current tab and is not retained in `localStorage` after the tab is closed. It is still accessible to JavaScript, unlike an `HttpOnly` cookie; an `HttpOnly` design would require a server-side BFF and is a valid choice if that stronger token isolation becomes a requirement. |
| Perspective profile | Optional slider answers from -1 to +1 | Shared answers reveal where people agree and differ; skipped questions are not treated as disagreement. New questions can be answered gradually after signup. |
| Frontend deployment | Static Vite build on a static hosting provider | The app needs no production Node server, so a static deployment is simpler and cheaper than running a custom web/API server. Supabase does not replace the static frontend host. |

## Current scope and limitations

- Account signup, sign-in, profile updates and account deletion use Supabase. Email confirmation behavior depends on the project's Auth settings.
- Signup checks email availability when the user confirms the email step. The check runs through a Supabase Edge Function backed by a server-only secret key, an exact-origin allow list, and a database rate limit.
- The public landing page is available without signing in. Signup asks five optional perspective questions; the user can skip them and continue.
- Dating is the only relationship goal. Gender preference and children preference are discovery filters; perspective scores are soft matching signals compared only when both people have answered.
- The question catalog lives in [`src/perspective.ts`](./src/perspective.ts). It contains eight dimensions and the full question set; the first five span different dimensions.
- Discover and Swipe now use profile records from Supabase; they no longer append hardcoded demo users. Users can upload their own JPG, PNG, or WebP profile photo (up to 5 MB) from Profile; the image is stored in the `profile-photos` Supabase Storage bucket.
- The Kaggle India Famous Personalities dataset is listed as MIT-licensed. Its seeder creates one clearly labeled demo account per person, uses the first available JPG, and generates synthetic perspective answers. Source: [Kaggle dataset](https://www.kaggle.com/datasets/pranavchaniyara/india-famous-personalities-image-dataset).
- To seed local Supabase, run `npx supabase start` and `npx supabase db reset`, then use `npx supabase status` to get local API keys. For a hosted pre-launch Supabase project, use that project's URL and a server-side secret key. Set `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `DEMO_PASSWORD` in PowerShell, then run `npm run seed:demo`. Hosted seeding additionally requires `DEMO_SEED_ALLOW_HOSTED=true` and `DEMO_SEED_TARGET_URL` set to the exact same project URL; the script prints a warning before writing accounts. Never use a frontend `VITE_` publishable key as the secret key. Keep the site private while shared-password accounts exist, change/remove their passwords and delete the test accounts before launch. Login emails are lowercased names without spaces or punctuation (for example `aliabhatt@test.com`); all accounts use the value supplied in `DEMO_PASSWORD`.
- Swipe decisions are persisted. Mutual likes create a match, an in-app notification for both users, and a conversation. Messages are sent through an authenticated database RPC that verifies match membership; Row Level Security limits reads to conversation participants and Supabase Realtime delivers new messages to the open chat. Notifications refresh on focus and every 30 seconds. Moderation is not implemented.
- The seeder marks profiles as demos in the UI. Shared-password demo accounts are only for private pre-launch testing; remove the shared credentials and demo accounts before making the site public.
- Signup collects gender and the preferred profiles to discover (men, women, or everyone). Demo accounts are seeded with the opposite gender preference to their dataset gender.
- Session tokens are JavaScript-accessible while the tab is open; this is not equivalent to an `HttpOnly` cookie. Configure your static host's security headers as appropriate for your deployment.
