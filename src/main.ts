require('dotenv').config();
import Redis from 'ioredis';
import Fastify from 'fastify';
import FastifyCors from '@fastify/cors';
import fs from 'fs';

import books from './routes/books';
import anime from './routes/anime';
import manga from './routes/manga';
import comics from './routes/comics';
import lightnovels from './routes/light-novels';
import movies from './routes/movies';
import meta from './routes/meta';
import news from './routes/news';
import chalk from 'chalk';
import Utils from './utils';

export const redis =
  process.env.REDIS_HOST &&
  new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
  });

const fastify = Fastify({
  maxParamLength: 1000,
  logger: true,
});
export const tmdbApi = process.env.TMDB_KEY && process.env.TMDB_KEY;

(async () => {
  const PORT = Number(process.env.PORT) || 3000;

  await fastify.register(FastifyCors, {
    origin: '*',
    methods: ['GET'], // leave as GET since your routes are GET only
  });

  // 🔐 1) HEALTH + ROBOTS (place BEFORE any provider routes)
  fastify.get('/status', (_req, reply) => {
    reply.code(200).send({ ok: true, uptime: process.uptime() });
  });
  // discourage crawlers hammering spotlight-ish routes
  fastify.get('/robots.txt', (_req, reply) => {
    // disallow everything by default; change if you want indexing
    reply
      .type('text/plain')
      .send('User-agent: *\nDisallow: /\n');
  });

  if (process.env.NODE_ENV === 'DEMO') {
    console.log(chalk.yellowBright('DEMO MODE ENABLED'));
    const map = new Map<string, { expiresIn: Date }>();
    const sessionDuration = 1000 * 60 * 60 * 5;

    fastify.addHook('onRequest', async (request, reply) => {
      const ip = request.ip;
      const session = map.get(ip);

      if (session) {
        const { expiresIn } = session;
        const currentTime = new Date();
        const sessionTime = new Date(expiresIn);
        if (currentTime.getTime() > sessionTime.getTime()) {
          map.delete(ip);
          return reply.redirect('/apidemo');
        }
        if (request.url === '/apidemo') return reply.redirect('/');
        return;
      }

      if (request.url === '/apidemo') return;
      reply.redirect('/apidemo');
    });

    fastify.post('/apidemo', async (request, reply) => {
      const { ip } = request;
      const session = map.get(ip);
      if (session) return reply.redirect('/');
      const expiresIn = new Date(Date.now() + sessionDuration);
      map.set(ip, { expiresIn });
      reply.redirect('/');
    });

    fastify.get('/apidemo', async (_, reply) => {
      try {
        const stream = fs.readFileSync(__dirname + '/../demo/apidemo.html');
        return reply.type('text/html').send(stream);
      } catch (err) {
        console.error(err);
        return reply.status(500).send({
          message: 'Could not load the demo page. Please try again later.',
        });
      }
    });

    setInterval(() => {
      const currentTime = new Date();
      for (const [ip, session] of map.entries()) {
        const { expiresIn } = session;
        if (currentTime.getTime() > new Date(expiresIn).getTime()) {
          map.delete(ip);
        }
      }
    }, 1000 * 60 * 60);
  }

  console.log(chalk.green(`Starting server on port ${PORT}... 🚀`));
  if (!process.env.REDIS_HOST) console.warn(chalk.yellowBright('Redis not found. Cache disabled.'));
  if (!process.env.TMDB_KEY) console.warn(chalk.yellowBright('TMDB api key not found. the TMDB meta route may not work.'));

  // 2) Register routes (unchanged)
  await fastify.register(books, { prefix: '/books' });
  await fastify.register(anime, { prefix: '/anime' });
  await fastify.register(manga, { prefix: '/manga' });
  // await fastify.register(comics, { prefix: '/comics' });
  await fastify.register(lightnovels, { prefix: '/light-novels' });
  await fastify.register(movies, { prefix: '/movies' });
  await fastify.register(meta, { prefix: '/meta' });
  await fastify.register(news, { prefix: '/news' });
  await fastify.register(Utils, { prefix: '/utils' });

  // Optional: env flag to disable “heavy/spotlight” routes inside your subrouters
  // check this env inside those route files if needed:
  // const DISABLE_SPOTLIGHT = process.env.DISABLE_SPOTLIGHT === '1';

  try {
    fastify.get('/', (_, rp) => {
      rp.status(200).send(
        `Welcome to consumet api! 🎉 \n${
          process.env.NODE_ENV === 'DEMO'
            ? 'This is a demo of the api. You should only use this for testing purposes.'
            : ''
        }`,
      );
    });

    fastify.get('*', (_request, reply) => {
      reply.status(404).send({ message: '', error: 'page not found' });
    });

    fastify.listen({ port: PORT, host: '0.0.0.0' }, (e, address) => {
      if (e) throw e;
      console.log(`server listening on ${address}`);
    });
  } catch (err: any) {
    fastify.log.error(err);
    process.exit(1);
  }
})();

// 🔧 3) Last-resort guards so provider crashes don't kill the process
process.on('unhandledRejection', (err) => {
  console.error('UnhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err);
});

export default async function handler(req: any, res: any) {
  await fastify.ready();
  fastify.server.emit('request', req, res);
}
