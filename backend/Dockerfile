# Etapa de build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN npm run prisma:generate

# Etapa de producción
FROM node:18-alpine AS production
WORKDIR /app
COPY --from=builder /app .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start:prod"] 