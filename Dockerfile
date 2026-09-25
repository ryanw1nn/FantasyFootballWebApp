# Two stages. The build stage owns vite and the dev dependencies; the runtime
# stage gets the built client and nothing that made it.
#
# node:24-alpine is the real pin — package.json's "engines" is the declaration
# that agrees with it, and the two have to move together.
FROM node:24-alpine AS build
WORKDIR /app

# package*.json first, so a source edit does not reinstall the dependency tree.
COPY package*.json ./
RUN npm ci

COPY . .

# .dockerignore keeps the environment file out of the context, so
# import.meta.env.VITE_API_URL is undefined here and client.js falls through to
# the relative base URL. Do not pass VITE_API_URL as a build arg: it would bake
# an absolute origin back into the bundle.
RUN npm run build

FROM node:24-alpine
WORKDIR /app

# Set before npm ci so npm honours it too, and read at runtime by
# server/session.mjs (the secure cookie, the session secret's minimum length)
# and server/index.js (trust proxy, and CORS staying off).
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server
# Not optional, and the obvious omission: server/index.js and server/session.mjs
# both import ../db/pool.mjs, so an image without db/ dies at import before it
# can print anything useful.
COPY db ./db
COPY server.js ./

# The base image ships this unprivileged user. Nothing here writes to disk.
USER node

EXPOSE 5001
CMD ["node", "server.js"]
