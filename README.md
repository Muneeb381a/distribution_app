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

## Tests

```
cd apps/api
pnpm test
```

Builds the API, then runs the end-to-end tests (selling and khata, credit limit, returns and cancellation, stock races, supplier empties, payroll, sign-in and permissions) against a throwaway database called `distribution_test`. The database is dropped and rebuilt on every run, so your dev data is never touched. The Docker database must be running.
