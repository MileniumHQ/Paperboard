import { describe, expect, it } from "bun:test";
import worker, { type Env } from "../src/index";

function createMockKV(initialData: Record<string, unknown> = {}): KVNamespace {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(initialData)) {
    store.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }

  return {
    async get(key: string, options?: any) {
      const val = store.get(key);
      if (val === undefined) return null;
      if (options?.type === "json") {
        return JSON.parse(val);
      }
      return val;
    },
    async list(options?: any) {
      const keys = Array.from(store.keys()).map((name) => ({ name }));
      return {
        keys,
        list_complete: true,
        cacheStatus: null,
      } as any;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async getWithMetadata() {
      throw new Error("Not implemented");
    },
  } as unknown as KVNamespace;
}

describe("Origami Worker", () => {
  it("returns health info on root /", async () => {
    const env: Env = { PACKAGES: createMockKV() };
    const req = new Request("http://localhost/");
    const res = await worker.fetch(req, env, {} as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe("Origami Package & Panel Registry");
  });

  it("returns individual package info for /package/java-26.json", async () => {
    const java26Data = {
      name: "java-26",
      version: "26.0.0",
      checksum: "sha256:abcdef1234567890",
      url: "https://example.com/java-26.tar.gz",
    };
    const env: Env = {
      PACKAGES: createMockKV({
        "java-26": java26Data,
      }),
    };

    const req = new Request("http://localhost/package/java-26.json");
    const res = await worker.fetch(req, env, {} as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(java26Data);
  });

  it("returns 404 for nonexistent package", async () => {
    const env: Env = { PACKAGES: createMockKV() };
    const req = new Request("http://localhost/package/nonexistent.json");
    const res = await worker.fetch(req, env, {} as any);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Package not found");
  });

  it("returns the entire KV stack on /package/index.json", async () => {
    const samplePackages = {
      "java-26": { name: "java-26", version: "26.0.0", checksum: "sha256:111" },
      "paper-server": { name: "paper-server", version: "1.21.4", checksum: "sha256:222" },
    };

    const env: Env = { PACKAGES: createMockKV(samplePackages) };
    const req = new Request("http://localhost/package/index.json");
    const res = await worker.fetch(req, env, {} as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(samplePackages);
  });
});
