# TrimTrack

A full-stack URL shortener with click analytics and a public API, built as a portfolio project to practice production-style backend engineering: database design, caching, authentication, rate limiting, and deployment.

**Live demo:** https://trimtrack-27ym.onrender.com
*(Free-tier hosting — the app may take 10–60 seconds to respond on first load if it's been inactive, since Render spins down free instances after periods of no traffic.)*

## Features

- Shorten a long URL into a random or custom short code
- Instant redirects via short links
- Click analytics on every redirect: timestamp, referrer, rough geolocation (from IP), device type
- Dashboard with clicks-over-time chart, top referrers, and top locations per link
- Password-protected dashboard (session-based auth)
- Public REST API with API-key authentication, so developers can create short links programmatically
- Rate limiting on the API (100 requests/hour per key)
- Redis caching on the redirect path (cache-aside pattern) to reduce database load on popular links

## Tech stack

- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **Caching:** Redis (Valkey on Render's free tier)
- **Views:** EJS
- **Auth:** bcrypt + express-session (dashboard), SHA-256 hashed API keys (public API)
- **Charts:** Chart.js
- **Rate limiting:** express-rate-limit
- **Deployment:** Render (web service + managed PostgreSQL + managed Redis)

## Architecture

Three tables, no ORM — raw SQL via the `pg` driver, with parameterized queries throughout to prevent SQL injection.

- **`urls`** — short code, destination URL, creation timestamp
- **`clicks`** — one row per click, foreign-keyed to `urls` with `ON DELETE CASCADE`; stores referrer, IP, country/city, device type
- **`api_keys`** — SHA-256 hashes of generated API keys (the raw key is shown once and never stored), label, creation/last-used timestamps, revoked flag

Schema files live in `/db` and are applied in order: `schema.sql` → `clicks_schema.sql` → `api_keys_schema.sql` (the second two depend on `urls` existing first).

### Request flow

- `POST /shorten` (browser form) and `POST /api/shorten` (public API) share the same core validation/collision logic, but return an HTML page vs. JSON respectively.
- `GET /:shortCode` checks Redis first (cache-aside); on a miss, queries Postgres, then populates the cache with a 1-hour TTL. Either way, it fires a non-blocking analytics insert and redirects — click logging never delays or can break the redirect itself.
- `/dashboard/*` routes are protected by session-based `requireLogin` middleware; the redirect and public API routes are intentionally left open.

## Local setup

**Prerequisites:** Node.js, PostgreSQL, Docker (for local Redis)

```bash
git clone https://github.com/pandeyashutosh9205/trimtrack.git
cd trimtrack
npm install
```

Start Redis locally via Docker:
```bash
docker run --name trimtrack-redis -p 6379:6379 -d redis:7
```

Create a `.env` file in the project root:

DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/trimtrack
REDIS_URL=redis://localhost:6379
PORT=3000
SESSION_SECRET=generate_a_random_string_here
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=generate_with_bcrypt


Create the database and apply the schema:
```bash
psql -U postgres -c "CREATE DATABASE trimtrack;"
psql -U postgres -d trimtrack -f db/schema.sql
psql -U postgres -d trimtrack -f db/clicks_schema.sql
psql -U postgres -d trimtrack -f db/api_keys_schema.sql
```

Run it:
```bash
node index.js
```

## Public API

POST /api/shorten
Authorization: Bearer <your_api_key>
Content-Type: application/json

{
"longUrl": "https://example.com/some/long/path",
"customAlias": "optional-alias"
}


API keys are generated from the dashboard (`/dashboard/api-keys`) — shown once at creation, then never retrievable again.

## Real bugs hit during development (and what I learned)

- **Route ordering with Express wildcards:** `/dashboard/:shortCode` (a wildcard) was defined before `/dashboard/api-keys` (a specific path), so Express matched the wildcard first and tried to look up `"api-keys"` as a short code. Fixed by placing specific routes before wildcard routes. This turned out to be a two-layer trap — I'd already learned the lesson once for `/dashboard` vs `/:shortCode`, then hit a deeper version of the same issue one level in.
- **Missing JSON body parser:** the public API route worked fine for form submissions but crashed with `Cannot destructure property 'longUrl' of req.body` when called via Postman, because `express.json()` was never added — `express.urlencoded()` only parses form data, not JSON bodies. Two different content types need two different parsing middlewares.
- **Rate limiter defined but never wired in:** `express-rate-limit` was fully configured but the middleware was never actually added to the route's middleware chain, so it silently did nothing. Caught only by deliberately testing with an artificially low limit rather than trusting the code "looked right."
- **Corrupted Docker Desktop config mid-project:** `daemon.json` became corrupted (a null byte in the JSON) after a system-level issue, unrelated to the app itself, requiring a full Docker Desktop reinstall to recover local Redis. A good reminder that local dev environment issues are a normal, expected category of problem — not something signaling anything wrong with the actual codebase.

## Known limitations / things I'd improve next

- Sessions currently use `express-session`'s default in-memory store, which Express explicitly warns is not suitable for production (memory growth over time, doesn't scale past one process). Since the app runs as a single free-tier instance, this hasn't caused visible problems, but a Redis-backed session store (`connect-redis`) — using the Redis instance already provisioned for caching — would be the correct production fix.
- `geoip-lite`'s offline IP database is approximate and can be wrong for VPNs, mobile carriers, or corporate networks — treat location data as a rough signal, not ground truth.
- A known transitive dependency vulnerability (`ip-address`, via `geoip-lite`) is left unpatched after evaluation: the vulnerable code paths (rendering an IPv6 address as HTML, resolver-level octal IP parsing) aren't exercised by how this app uses the package, and the available fix would force a breaking downgrade of `geoip-lite`.
- No automated tests yet — all verification during development was manual (direct SQL cross-checks against dashboard output, deliberate low-limit testing of rate limiting, etc.). Adding a test suite would be the next major improvement.
- Free-tier hosting means the app spins down after inactivity and the database has connection/storage limits — fine for a demo, not for real traffic.