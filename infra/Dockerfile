FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG VITE_ADMIN_URL
ARG VITE_CUSTOMER_URL
ARG VITE_WAITER_URL
ARG VITE_KITCHEN_URL
ENV VITE_ADMIN_URL=${VITE_ADMIN_URL} \
    VITE_CUSTOMER_URL=${VITE_CUSTOMER_URL} \
    VITE_WAITER_URL=${VITE_WAITER_URL} \
    VITE_KITCHEN_URL=${VITE_KITCHEN_URL} \
    VITE_API_URL=""
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tests ./tests
COPY tsconfig*.json *.config.ts ./
RUN pnpm install --frozen-lockfile && pnpm build
FROM nginx:stable-alpine AS web
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/admin-web/dist /srv/mesa/admin
COPY --from=build /app/apps/customer-pwa/dist /srv/mesa/customer
COPY --from=build /app/apps/waiter-pwa/dist /srv/mesa/waiter
COPY --from=build /app/apps/kitchen-display/dist /srv/mesa/kitchen
EXPOSE 80

# O target padrão é o backend, usado também pelo worker e pelas CLIs.
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production API_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/apps/api/src/index.js"]
