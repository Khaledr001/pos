// Environment for e2e tests. Loaded before any app module is imported.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://khaled@localhost/al_lahiq_test?host=/var/run/postgresql';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/6';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-1234567890';
process.env.REVALIDATE_SECRET = 'test-revalidate-secret';
process.env.POS_WEBHOOK_SECRET = 'test-pos-webhook-secret';
process.env.POS_OUTBOUND_SECRET = 'test-pos-outbound-secret';
process.env.FRONTEND_URL = 'http://localhost:3999';
process.env.DEV_PAYMENTS = 'true';
process.env.QUEUES_ENABLED = 'false'; // jobs run inline, deterministically
process.env.SCHEDULER_ENABLED = 'false';
