# Playwright's official image: Chromium and its system libraries, matching
# the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
ENV NODE_ENV=production \
    PORT=10000

COPY package.json package-lock.json ./
# Dev dependencies are needed at runtime: tsx runs the server, esbuild bundles
# the dashboard and tsc type-checks the investigator's patches.
RUN npm ci --include=dev

COPY . .

EXPOSE 10000
CMD ["npx", "tsx", "src/server/server.ts"]
