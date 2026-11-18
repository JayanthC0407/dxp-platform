# DXP backend - multi-stage, minimal, non-root image
# Build:  docker build -t dxp-backend:dev .
# Run:    docker run -p 8080:8080 -e DXP_TOKEN_SECRET=$(openssl rand -hex 32) dxp-backend:dev
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DXP_DATA_DIR=/data
COPY --from=deps --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --chown=nonroot:nonroot package.json ./
COPY --chown=nonroot:nonroot src ./src
COPY --chown=nonroot:nonroot public ./public
USER nonroot
EXPOSE 8080
# distroless has no shell: probes are HTTP (see deploy/k8s)
CMD ["src/server.js"]
