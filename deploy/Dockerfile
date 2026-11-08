# One Dockerfile for both programs. The build context is the repository root:
#   docker build -f deploy/Dockerfile --target api .
#   docker build -f deploy/Dockerfile --target web --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
# (docker-compose.prod.yml does this for you.)
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV CI=true
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@11.1.2
WORKDIR /app

# Dependencies only change when a package.json or the lockfile changes, so this layer is cached.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# The website learns where the API lives while it is built, so this must be the public address of the API.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm --filter api exec prisma generate \
 && pnpm --filter api build \
 && pnpm --filter web build

# ---------------------------------------------------------------- the API
FROM build AS api
# pg_dump 17 (the same major version as the database) so the app can take its own backups.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl gnupg \
 && install -d /usr/share/keyrings \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=3010
ENV BACKUP_MODE=local
WORKDIR /app/apps/api
EXPOSE 3010
# Database changes are applied every time it starts; they only add what is missing.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

# ---------------------------------------------------------------- the website
FROM build AS web
ENV NODE_ENV=production
WORKDIR /app/apps/web
EXPOSE 3100
CMD ["node_modules/.bin/next", "start", "-p", "3100"]
