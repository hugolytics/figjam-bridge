FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY bridge/ ./bridge/
EXPOSE 3100 3101
CMD ["node", "bridge/index.js"]
