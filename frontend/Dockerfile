# ── Build stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# VITE_* values are baked into the static bundle at build time, so they must
# be passed in as build args and re-exported as env vars before `vite build`.
ARG VITE_API_URL
ARG VITE_PAYPAL_CLIENT_ID
ARG VITE_PAYPAL_PLAN_ID
ARG VITE_SENTRY_DSN
ENV VITE_API_URL=$VITE_API_URL \
    VITE_PAYPAL_CLIENT_ID=$VITE_PAYPAL_CLIENT_ID \
    VITE_PAYPAL_PLAN_ID=$VITE_PAYPAL_PLAN_ID \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Serve stage ──────────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.frontend.conf /etc/nginx/conf.d/default.conf

EXPOSE 80