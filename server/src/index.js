require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const connectDatabase = require('./config/db');
const authMiddleware = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const usersRoutes = require('./routes/users');

const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

async function bootstrap() {
  await connectDatabase(process.env.MONGO_URI);

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: CLIENT_ORIGIN,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      credentials: true,
    },
  });

  app.set('io', io);

  app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
  app.use(express.json());

  app.get('/', (req, res) => {
    res.json({
      name: 'chatflow-api',
      status: 'ok',
      health: '/health',
    });
  });

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/conversations', authMiddleware, conversationRoutes);
  app.use('/api/users', authMiddleware, usersRoutes);
  app.use('/api/messages', authMiddleware, messageRoutes);

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('Unauthorized'));
      }

      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join:conversation', (conversationId) => {
      if (conversationId) {
        socket.join(conversationId.toString());
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`Chatflow server running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
