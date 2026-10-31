# Public demo image for Chat v. Streamer.
#
# This runs the app in simulator mode with DRY_RUN on and no credentials, which is the same
# thing `npm run dev` gives you offline. It is deliberately NOT how you run a real court: the
# panel has no authentication, so a public instance must never hold Twitch tokens or an
# OpenAI key. See docs/SETUP.md for the real setup, which stays local.

FROM node:20-bookworm AS build
WORKDIR /app
# better-sqlite3 falls back to compiling when no prebuild matches the platform
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY server ./server
COPY web ./web
# `build` is `tsc --noEmit && vite build`, so this type-checks the image too
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    SIM_MODE=true \
    DRY_RUN=true
# tsx runs the TypeScript server directly, so the sources ship with the image
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/web/dist ./web/dist
COPY package.json tsconfig.json ./
COPY server ./server
COPY web/src ./web/src
COPY web/public ./web/public
RUN mkdir -p data/tts data/frames
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
