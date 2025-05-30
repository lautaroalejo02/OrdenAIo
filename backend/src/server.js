import './whatsapp/bot.js';
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

// Example Socket.io connection event
io.on('connection', (socket) => {
  console.log('Client connected to real-time dashboard');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 