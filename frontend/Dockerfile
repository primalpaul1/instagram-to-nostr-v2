FROM node:20-slim

WORKDIR /app

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
