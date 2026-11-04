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

## Status

- **Phase 1** (done): users, roles, audit log, products and units, customers with rates and credit limits, suppliers, employees, Excel/CSV import.
- **Phase 2** (done): stock per location, transfers, adjustments and damaged stock, purchases, supplier ledger and payments, latest cost, opening-stock import.
- **Phase 3** (done, screens not yet clicked through in a browser): counter and delivery bills, part payment, previous balance, credit limit with owner override, returns, empties (counts only), receipts, customer khata, thermal (Urdu image) and A4/PDF printing.
- **Phase 5** (done, screens not yet clicked through in a browser): expenses (bottles / rice / shared), attendance, advances with carry-forward, payroll with commission and absence deduction, salary slips, and reports (profit by day or month, rice bought vs sold, salesmen and vehicles, empties, returns and damaged stock, collections).
- **Not yet**: offline mode on the PC (Phase 4; see `/prototype`), automated tests, supplier empties, go-live data cleanup.

New roles/permissions only reach existing databases through the seed for Owner. Other roles must be edited (`PATCH /roles/:id`).
