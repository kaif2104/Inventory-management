FROM node:20-alpine

# Set non-root working environment
WORKDIR /app

# Install curl for container health check
RUN apk add --no-cache curl

# Install dependencies first (leverages Docker layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Use built-in unprivileged node user
USER node

# Default port
ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["node", "src/server.js"]
