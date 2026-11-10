# Keeping businesses apart

Every business has its own database schema (`t_<code>`); the original business is `public`. A request works inside the
business named in its sign-in token, and nothing else. These are the rules that keep that true. Break one and one
business can see another's data.

## How it works

1. `TenantMiddleware` (`src/tenancy/tenancy.module.ts`) reads the token, finds the business, checks it is allowed in,
   and runs the rest of the request inside `tenantStore` (an `AsyncLocalStorage`).
2. `PrismaService` is a proxy. Inside a request it points at that business's schema. Prisma writes the schema name into
   every query (`"t_x"."Customer"`), so a shared or pooled connection cannot mix businesses up.
3. `AuthGuard` refuses a token whose business is not the one the request runs in.
4. Platform tables (businesses, platform admins, sign-in log, payments) live in the main schema and are reached with
   `prisma.control` only. Platform routes have their own sign-in, signed with a different secret.

## Rules for new code

- **Never keep business data in memory between requests** (module-level `Map`, cache, singleton field). One server
  handles every business. A cache is only safe if its key includes the business.
- **Never grab a model before the request starts** (`private customers = this.prisma.customer` in a constructor).
  Always write `this.prisma.customer` inside the method.
- **Code that runs outside a request** (timers, startup) works on the main schema. Do not read business data there.
- **Raw SQL**: no table names without a schema unless Prisma wrote them; never build SQL from user input.
- **Anything sent to a browser** must not be cacheable: the API sets `Cache-Control: private, no-store` on every answer.
- **Browser storage** (IndexedDB, localStorage) for business data must use `scoped(...)` from `apps/web/src/lib/tenantScope.ts`,
  so computers shared by two businesses keep their offline data and unsent bills apart.
- Whole-database tools (backups) belong to the platform owner only.

## What proves it

`test/tenant-isolation.e2e-spec.mjs`: where data lands (counted inside each schema), every list endpoint from another
business, access by id, bills made at the same time by two businesses, tokens used with another business's code,
cache headers, and the SQL itself. Run it after any change to `tenancy/`, `prisma.service.ts` or the guard.
