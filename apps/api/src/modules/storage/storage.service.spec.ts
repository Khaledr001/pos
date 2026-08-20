import type { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn().mockResolvedValue({});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

const { StorageService } = await import("./storage.service.js");

const ENV: Record<string, unknown> = {
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "devsfleet",
  S3_SECRET_KEY: "devsfleet_dev_password",
  S3_BUCKET: "devsfleet",
  S3_FORCE_PATH_STYLE: true,
  S3_PUBLIC_URL: "http://localhost:9000/devsfleet",
};

const config = { get: (key: string) => ENV[key] } as unknown as ConfigService<never, true>;

describe("StorageService.upload", () => {
  beforeEach(() => send.mockClear());

  it("returns a public URL built from S3_PUBLIC_URL and the key", async () => {
    const service = new StorageService(config);
    const url = await service.upload("t1/quotations/QT-1.pdf", Buffer.from("x"), "application/pdf");
    expect(url).toBe("http://localhost:9000/devsfleet/t1/quotations/QT-1.pdf");
  });

  it("sends the bucket, key, body and content type through to S3", async () => {
    const service = new StorageService(config);
    await service.upload("t1/quotations/QT-2.pdf", Buffer.from("hello"), "application/pdf");

    expect(send).toHaveBeenCalledTimes(1);
    const [command] = send.mock.calls[0]!;
    expect(command.input).toMatchObject({
      Bucket: "devsfleet",
      Key: "t1/quotations/QT-2.pdf",
      ContentType: "application/pdf",
    });
    expect(Buffer.from(command.input.Body).toString()).toBe("hello");
  });

  it("strips a trailing slash from S3_PUBLIC_URL so the key is not double-slashed", async () => {
    const trailing = { ...ENV, S3_PUBLIC_URL: "http://localhost:9000/devsfleet/" };
    const service = new StorageService({ get: (key: string) => trailing[key] } as unknown as ConfigService<
      never,
      true
    >);
    const url = await service.upload("a.pdf", Buffer.from("x"), "application/pdf");
    expect(url).toBe("http://localhost:9000/devsfleet/a.pdf");
  });
});
