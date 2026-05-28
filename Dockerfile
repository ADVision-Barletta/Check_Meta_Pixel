FROM node:20-slim

RUN apt-get update && apt-get install -y chromium --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=3000
ENV ADMIN_USER=admin
ENV ADMIN_PASS=admin

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
