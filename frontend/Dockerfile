# Build stage
FROM node:20-alpine as build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Generate nginx HTTPS config from environment at container startup
COPY docker-entrypoint.d/40-https-config.sh /docker-entrypoint.d/40-https-config.sh
RUN chmod +x /docker-entrypoint.d/40-https-config.sh

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
