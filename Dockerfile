# WellSim — zero-dependency Node server (no npm install step needed)
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY docs ./docs
ENV NODE_ENV=production
ENV PORT=3355
# case database lives here — mount a persistent volume at /app/data
VOLUME ["/app/data"]
EXPOSE 3355
USER node
CMD ["node", "src/server/server.js"]
