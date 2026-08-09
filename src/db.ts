import { PrismaClient } from '@prisma/client';

// Singleton pattern: prevent multiple PrismaClient instances during
// hot-reload in development (ts-node-dev --respawn).
// Each instance opens its own connection pool, so leaking instances
// exhausts the database's connection limit.

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
