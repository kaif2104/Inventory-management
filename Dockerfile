FROM node:20-alpine

# Update system packages and npm to patch bundled CVEs
RUN apk update && apk upgrade --no-cache && \
    npm install -g npm@latest && \
    rm -rf /root/.npm

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Use non-root node user
USER node

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["node", "src/server.js"]
