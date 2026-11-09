# One image per app, each a target: docker build --target monitor .
# Node runs the TypeScript sources as they are, so nothing is compiled.

# Debian rather than Alpine: a vendor checksum binary is most likely built against glibc.
FROM node:26.13.0-trixie-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install --global pnpm@12.16.1
WORKDIR /repo

# The production dependencies of one app and the workspace packages it uses, from the lockfile.
FROM base AS monitor-build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/monitor/package.json apps/monitor/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter @device-monitor/monitor...
COPY packages/contracts packages/contracts
COPY apps/monitor apps/monitor

FROM node:26.13.0-trixie-slim AS monitor
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=monitor-build /repo /repo
WORKDIR /repo/apps/monitor
USER node
EXPOSE 3000
CMD ["node", "src/main.ts"]
