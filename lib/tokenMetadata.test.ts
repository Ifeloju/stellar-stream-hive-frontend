import { describe, expect, it, vi } from "vitest";
import {
  createTokenMetadataCache,
  enrichStreamTokens,
  fallbackToken,
  sanitizeDecimals,
  sanitizeSymbol,
  toTokenInfo,
} from "./tokenMetadata";
import { formatTokenAmount } from "./format";
import type { Stream } from "@/types";

const USDC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const OTHER = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

describe("sanitizeSymbol", () => {
  it("accepts ordinary symbols", () => {
    expect(sanitizeSymbol("USDC")).toBe("USDC");
    expect(sanitizeSymbol("  yXLM ")).toBe("yXLM");
  });
  it("strips control, zero-width and bidi-override characters used for spoofing", () => {
    expect(sanitizeSymbol("US‮DC")).toBe("USDC");
    expect(sanitizeSymbol("U​S\u0000DC")).toBe("USDC");
    expect(sanitizeSymbol("⁦USDC⁩")).toBe("USDC");
  });
  it("strips U+202E right-to-left override and U+200B zero-width space", () => {
    expect(sanitizeSymbol(`US\u202EDC`)).toBe("USDC");
    expect(sanitizeSymbol(`U\u200BSDC`)).toBe("USDC");
  });
  it("caps the length", () => {
    expect(sanitizeSymbol("A".repeat(50))).toHaveLength(12);
  });
  it("rejects non-strings and empty results", () => {
    expect(sanitizeSymbol(undefined)).toBeNull();
    expect(sanitizeSymbol(42)).toBeNull();
    expect(sanitizeSymbol("   ")).toBeNull();
    expect(sanitizeSymbol("‮​")).toBeNull();
  });
});

describe("sanitizeDecimals", () => {
  it("accepts integers in range, including bigint and numeric strings", () => {
    expect(sanitizeDecimals(7)).toBe(7);
    expect(sanitizeDecimals(0)).toBe(0);
    expect(sanitizeDecimals(18)).toBe(18);
    expect(sanitizeDecimals(6n)).toBe(6);
    expect(sanitizeDecimals("6")).toBe(6);
  });
  it("rejects out-of-range, fractional and non-numeric values", () => {
    expect(sanitizeDecimals(19)).toBeNull();
    expect(sanitizeDecimals(-1)).toBeNull();
    expect(sanitizeDecimals(6.5)).toBeNull();
    expect(sanitizeDecimals(Number.NaN)).toBeNull();
    expect(sanitizeDecimals("six")).toBeNull();
    expect(sanitizeDecimals("-1")).toBeNull();
    expect(sanitizeDecimals(null)).toBeNull();
    expect(sanitizeDecimals(10n ** 30n)).toBeNull();
  });
});

describe("toTokenInfo", () => {
  it("is detected only when both fields are valid", () => {
    expect(toTokenInfo(USDC, { symbol: "USDC", decimals: 6 })).toEqual({
      token: { contractId: USDC, symbol: "USDC", decimals: 6 },
      detected: true,
    });
  });
  it("falls back entirely when either field is bad (never pairs a real symbol with guessed decimals)", () => {
    expect(toTokenInfo(USDC, { symbol: "USDC", decimals: 99 })).toEqual({ token: fallbackToken(USDC), detected: false });
    expect(toTokenInfo(USDC, { symbol: "", decimals: 6 })).toEqual({ token: fallbackToken(USDC), detected: false });
    expect(toTokenInfo(USDC, null)).toEqual({ token: fallbackToken(USDC), detected: false });
  });
});

describe("why decimals matter", () => {
  it("a 6-decimal amount shown with the 7-decimal guess reads 10x too small", () => {
    const base = 25_000_000n; // 25 USDC at 6 decimals
    expect(formatTokenAmount(base, "USDC", 6)).toBe("25.00 USDC");
    expect(formatTokenAmount(base, "TOKEN", fallbackToken(USDC).decimals)).toBe("2.50 TOKEN");
  });
});

describe("createTokenMetadataCache", () => {
  it("reads once per token and serves later calls from cache", async () => {
    const read = vi.fn().mockResolvedValue({ symbol: "USDC", decimals: 6 });
    const cache = createTokenMetadataCache(read);
    expect(await cache.get(USDC)).toEqual({ contractId: USDC, symbol: "USDC", decimals: 6 });
    await cache.get(USDC);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("shares a single in-flight read between concurrent callers", async () => {
    const read = vi.fn().mockResolvedValue({ symbol: "USDC", decimals: 6 });
    const cache = createTokenMetadataCache(read);
    await Promise.all([cache.get(USDC), cache.get(USDC), cache.get(USDC)]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures, so a transient error can recover", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValueOnce({ symbol: "USDC", decimals: 6 });
    const cache = createTokenMetadataCache(read);

    const first = await cache.lookup(USDC);
    expect(first).toEqual({ token: fallbackToken(USDC), detected: false });

    const second = await cache.lookup(USDC);
    expect(second.detected).toBe(true);
    expect(second.token.decimals).toBe(6);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("answers known tokens (native XLM) without reading chain", async () => {
    const read = vi.fn();
    const xlm = { contractId: "CNATIVE", symbol: "XLM", decimals: 7 };
    const cache = createTokenMetadataCache(read, { CNATIVE: xlm });
    expect(await cache.get("CNATIVE")).toEqual(xlm);
    expect(read).not.toHaveBeenCalled();
  });

  it("never rejects, even if the reader throws", async () => {
    const cache = createTokenMetadataCache(async () => {
      throw new Error("boom");
    });
    await expect(cache.get(USDC)).resolves.toEqual(fallbackToken(USDC));
  });
});

describe("enrichStreamTokens", () => {
  const base = (id: string, token: string): Stream => ({
    id,
    sender: "GSENDER",
    recipient: "GRECIPIENT",
    token: fallbackToken(token),
    totalAmount: "1",
    withdrawnAmount: "0",
    startLedger: 1,
    endLedger: 2,
    startTime: 0,
    endTime: 0,
    cancellable: true,
    status: "active",
  });

  it("looks each distinct token up once and updates every stream", async () => {
    const getToken = vi.fn(async (id: string) => ({
      contractId: id,
      symbol: id === USDC ? "USDC" : "OTH",
      decimals: id === USDC ? 6 : 8,
    }));
    const input = [base("1", USDC), base("2", OTHER), base("3", USDC)];

    const out = await enrichStreamTokens(input, getToken);

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(out.map((s) => s.token.symbol)).toEqual(["USDC", "OTH", "USDC"]);
    expect(out[0].token.decimals).toBe(6);
    expect(out[1].token.decimals).toBe(8);
  });

  it("does not mutate its input and handles an empty list", async () => {
    const input = [base("1", USDC)];
    const out = await enrichStreamTokens(input, async (id) => ({ contractId: id, symbol: "USDC", decimals: 6 }));
    expect(input[0].token.symbol).toBe("TOKEN");
    expect(out[0]).not.toBe(input[0]);
    expect(await enrichStreamTokens([], async (id) => fallbackToken(id))).toEqual([]);
  });
});
