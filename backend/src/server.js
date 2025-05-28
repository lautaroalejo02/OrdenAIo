import app from './app.js';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Ejemplo de evento de conexión Socket.io
io.on('connection', (socket) => {
  console.log('Cliente conectado al dashboard en tiempo real');
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
}); 