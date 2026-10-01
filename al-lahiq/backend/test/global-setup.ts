import { execSync } from 'node:child_process';

/** Applies migrations to the test database once per run. */
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://khaled@localhost/al_lahiq_test?host=/var/run/postgresql';
  execSync('pnpm prisma migrate deploy', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: url },
  });
}
