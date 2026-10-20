import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPlatformStats, fetchStreamById, fetchStreamsBySender } from "./api";

describe("api client when NEXT_PUBLIC_API_BASE_URL is unset", () => {
  const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "";
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
    }
  });

  it("fetchPlatformStats resolves to null", async () => {
    await expect(fetchPlatformStats()).resolves.toBeNull();
  });

  it("fetchStreamsBySender resolves to an empty list", async () => {
    await expect(fetchStreamsBySender("GABC")).resolves.toEqual([]);
  });

  it("fetchStreamById resolves to null", async () => {
    await expect(fetchStreamById("1")).resolves.toBeNull();
  });

  it("never calls fetch", async () => {
    await fetchPlatformStats();
    await fetchStreamsBySender("GABC");
    await fetchStreamById("1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
