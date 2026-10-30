import { Server } from 'socket.io';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { env } from '../../../packages/shared/src/config.js';
import { authenticate } from './auth.js';
export async function setupRealtime(app: FastifyInstance) {
  const io = new Server(app.server, {
    cors: { origin: env.CORS_ORIGINS.split(',') },
    maxHttpBufferSize: 32768,
  });
  const subscriber = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  subscriber.on('error', () => app.log.warn('Redis indisponível para notificações.'));
  io.use(async (socket, next) => {
    try {
      socket.data.actor = await authenticate(String(socket.handshake.auth.token ?? ''));
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });
  io.on('connection', (socket) => {
    const actor = socket.data.actor;
    if (actor.kind === 'STAFF') {
      void socket.join(`tenant:${actor.tenantId}:unit:${actor.establishmentId}:staff`);
      void socket.join(`staff:${actor.id}`);
    } else if (actor.kind === 'VISITOR') {
      void socket.join(`customer:${actor.customerId}`);
      if (actor.sessionId) void socket.join(`table:${actor.sessionId}`);
    } else socket.disconnect();
    const timer = setInterval(() => {
      void authenticate(String(socket.handshake.auth.token))
        .then((fresh) => {
          if (fresh.establishmentId !== actor.establishmentId || fresh.kind !== actor.kind)
            socket.disconnect(true);
          else if (fresh.kind === 'VISITOR' && fresh.sessionId !== actor.sessionId) {
            if (actor.sessionId) void socket.leave(`table:${actor.sessionId}`);
            if (fresh.sessionId) void socket.join(`table:${fresh.sessionId}`);
            actor.sessionId = fresh.sessionId;
          }
        })
        .catch(() => socket.disconnect(true));
    }, 30_000);
    socket.on('disconnect', () => clearInterval(timer));
    // There is deliberately no client-controlled join-room event.
  });
  subscriber.on('message', (_channel, raw) => {
    try {
      const event = JSON.parse(raw);
      io.to(`tenant:${event.tenant_id}:unit:${event.establishment_id}:staff`).emit(
        'domain.event',
        event,
      );
      const rooms = [];
      if (event.session_id) rooms.push(`table:${event.session_id}`);
      if (event.customer_id) rooms.push(`customer:${event.customer_id}`);
      if (rooms.length) io.to(rooms).emit('domain.event', event);
    } catch {
      app.log.warn('Evento inválido no canal de notificações.');
    }
  });
  app.addHook('onReady', async () => {
    await subscriber.connect();
    await subscriber.subscribe('bar:events');
  });
  app.addHook('preClose', async () => {
    io.disconnectSockets(true);
    io.engine.close();
  });
  app.addHook('onClose', async () => {
    io.disconnectSockets();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    subscriber.disconnect();
  });
  return () => subscriber.status === 'ready';
}
