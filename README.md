<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/5e5cc25c-8a18-4bbe-a8eb-c3f625af70ac

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a strong `SESSION_SECRET`. Apply the migrations in `supabase/migrations/` and configure Supabase Storage buckets first. Supabase is required; the server will not start using a local database.
3. Run the app:
   `npm run dev`
