import { describe, expect, it } from "vitest";
import { validateEnv } from "./env.js";

const base = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://app:app@localhost:5432/devsfleet",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5",
  JWT_REFRESH_SECRET: "zY8xW6vU4tS2rQ0pO8nM6lK4jI2hG0fE8dC6",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "minio",
  S3_SECRET_KEY: "minio-secret",
  S3_BUCKET: "devsfleet",
  S3_PUBLIC_URL: "http://localhost:9000/devsfleet",
};

describe("storefront environment", () => {
  it("reads a blank secret copied from .env.example as not set", () => {
    const env = validateEnv({
      ...base,
      STOREFRONT_JWT_SECRET: "",
      STOREFRONT_REVALIDATE_SECRET: "",
      STOREFRONT_PROXY_SECRET: "",
      STOREFRONT_COOKIE_SECURE: "",
    });
    expect(env.STOREFRONT_JWT_SECRET).toBeUndefined();
    expect(env.STOREFRONT_PROXY_SECRET).toBeUndefined();
    expect(env.STOREFRONT_COOKIE_SECURE).toBeUndefined();
  });

  it("refuses a secret too short to be one", () => {
    expect(() => validateEnv({ ...base, STOREFRONT_PROXY_SECRET: "short" })).toThrow(/STOREFRONT_PROXY_SECRET/);
  });

  it("refuses the dev payment gateway in production", () => {
    expect(() => validateEnv({ ...base, NODE_ENV: "production", STOREFRONT_DEV_PAYMENTS: "true" })).toThrow(/STOREFRONT_DEV_PAYMENTS/);
  });
});
