import { defineConfig } from 'prisma/config';
import './src/load-env.js';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Runtime never consumes this credential. The reviewed migrate wrapper validates it first.
  datasource: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://tomasini_generate_app:unused@127.0.0.1:55440/tomasini_generate?schema=tomasini' },
});
