# Blacklink

Anonymous realtime terminal chat using Supabase Realtime. No Node chat server is required for production; `server.js` is only a local static preview server.

## Supabase setup

1. Create a free Supabase project.
2. In Supabase Dashboard, go to Project Settings > API.
3. Copy the Project URL and anon public key.
4. Copy `config.example.js` to `config.js`.
5. Put your Project URL and anon public key in `config.js`.
6. In Supabase Realtime settings, keep public realtime channels enabled.

The anon key is public by design. Do not paste the service role key into this app.

## Run locally

```powershell
npm run start
```

Open `http://localhost:3000/` in two tabs.

## Deploy free

Deploy the folder to Vercel as a static site. The frontend connects directly to Supabase Realtime.