import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StorageService } from "./storage.service.js";

const dirs: string[] = [];
const serviceIn = async () => {
  const dir = await mkdtemp(join(tmpdir(), "uploads-"));
  dirs.push(dir);
  const values: Record<string, unknown> = { STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: dir, API_PORT: 3001 };
  return { dir, service: new StorageService({ get: (k: string) => values[k] } as never) };
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("StorageService (local driver)", () => {
  it("writes the file under the folder and returns the API's /uploads url", async () => {
    const { dir, service } = await serviceIn();
    const url = await service.upload("products/t1/abc.jpg", Buffer.from("img"), "image/jpeg");
    expect(url).toBe("http://localhost:3001/uploads/products/t1/abc.jpg");
    expect((await readFile(join(dir, "products/t1/abc.jpg"))).toString()).toBe("img");
  });

  it("refuses a key that climbs out of the folder", async () => {
    const { service } = await serviceIn();
    await expect(service.upload("../escape.jpg", Buffer.from("x"), "image/jpeg")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });
});
