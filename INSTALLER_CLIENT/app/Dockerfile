# ── Stage 1: Build ──
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# ── Stage 2: Production Runner ──
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install curl & wget untuk container healthcheck
RUN apk add --no-cache curl wget

COPY --from=builder /app ./

EXPOSE 3006
CMD ["node", "server.js"]

