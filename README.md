# Distribution App

Rice and bottle distribution management. See [distribution-app-plan.md](distribution-app-plan.md) for requirements.

- `apps/api`: NestJS + Prisma + PostgreSQL
- `apps/web`: Next.js (client-rendered admin UI)

## Run locally (Windows/macOS/Linux, needs Node 22+, pnpm, Docker)

```bash
docker compose up -d                 # PostgreSQL on localhost:5440
pnpm install
cd apps/api
cp .env.example .env                 # then set JWT_SECRET
npx prisma migrate deploy
SEED_OWNER_PASSWORD=choose-one pnpm db:seed   # creates user "owner", roles, godown/shop, rice categories
PORT=3010 pnpm start:dev             # API on :3010
# in another terminal
cd apps/web && pnpm dev              # web on :3100
```

Ports 3000/3001/5433 were already taken on the development machine, hence 3010, 3100 and 5440.

## Offline billing

The shop PC keeps billing when the server can't be reached (plan §3.10, §9).

- **Set-up:** open the app once while online. The PC gets a device number (`D1`, `D2`…) from
  `POST /sync/device`, and a snapshot of products, rates, customers, balances and stock is saved in
  the browser (IndexedDB). The snapshot refreshes every few minutes and after each sync.
- **Offline:** the top bar shows *Offline*. **New bill** works from the snapshot with the same rules
  as the server; bills get device numbers like `BTL-D1-000001` and print on thermal or A4 as usual.
  Payments can be taken on **Offline outbox**.
- **Sync:** when the connection is back, the outbox is sent to `POST /sync/push` in order. Every
  document carries a client id, so a resend never creates a second bill. A credit limit crossed
  because the offline balance was stale is accepted and flagged in the audit log
  (`OFFLINE_CREDIT_BREACH`); a bill the server can't accept (for example not enough stock) stays in
  the outbox under *Needs attention* with the reason, to fix and retry or discard.
- The service worker that keeps the pages available offline is only registered in a production
  build (`pnpm build && pnpm start` in `apps/web`), not in `pnpm dev`.

## Tests

```
cd apps/api
pnpm test
```

Builds the API, then runs the end-to-end tests (selling and khata, credit limit, returns and cancellation, stock races, supplier empties, payroll, offline sync, sign-in and permissions) against a throwaway database called `distribution_test`. The database is dropped and rebuilt on every run, so your dev data is never touched. The Docker database must be running.
