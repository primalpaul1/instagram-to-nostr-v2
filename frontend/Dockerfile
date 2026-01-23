FROM node:20-slim

WORKDIR /app

# Install build tools for native module compilation (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy application code (includes schema.sql)
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Run the server
CMD ["node", "build"]
