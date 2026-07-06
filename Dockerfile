FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm install typescript --no-save && npx tsc

EXPOSE 3000

CMD ["node", "dist/index.js"]
