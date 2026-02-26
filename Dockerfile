FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the rest of the source code
COPY . .

# Cloud Run injects PORT env var — default to 3001 locally
ENV PORT=3001
EXPOSE 3001

# Start the server
CMD ["node", "server.js"]
