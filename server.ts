import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Socket.io logic
  const players: Record<string, { x: number, y: number, z: number, ry: number }> = {};

  io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Send existing players to the new player
    socket.emit('currentPlayers', players);

    // Update player position
    socket.on('playerUpdate', (data) => {
      players[socket.id] = data;
      socket.broadcast.emit('playerMoved', { id: socket.id, ...data });
    });

    socket.on('disconnect', () => {
      console.log('Player disconnected:', socket.id);
      delete players[socket.id];
      io.emit('playerDisconnected', socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
