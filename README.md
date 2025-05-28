# Restaurant WhatsApp Bot

Sistema integral para gestión de pedidos de restaurante vía WhatsApp, con IA (Gemini), panel admin en React y despliegue en Railway.

## Stack Tecnológico
- **Backend:** Node.js, Express.js, Prisma, PostgreSQL, Redis, whatsapp-web.js, Gemini AI
- **Frontend:** React 18, Vite, Tailwind CSS, Shadcn/ui, React Query, Socket.io
- **DevOps:** Railway, Docker, Railway PostgreSQL/Redis

## Estructura del Proyecto
```
restaurant-whatsapp-bot/
├── backend/
├── frontend/
├── docker-compose.yml
├── railway.json
└── README.md
```

## Setup Rápido
```bash
git clone <repo>
cd restaurant-whatsapp-bot
npm install
cp .env.example .env
# Editar .env con tus keys
docker-compose up -d  # PostgreSQL y Redis local
npm run dev           # Modo desarrollo
```

## Despliegue en Railway
- Railway autoprovisiona PostgreSQL y Redis
- Variables de entorno se configuran automáticamente
- Dominio y SSL incluidos

---

> Comentarios y lógica compleja estarán documentados en español en el código fuente. 