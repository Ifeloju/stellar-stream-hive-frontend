import { describe, expect, it } from "vitest";
import {
  AVERAGE_LEDGER_SECONDS,
  computeProgress,
  computeStreamedAmount,
  computeWithdrawable,
  dateToEstimatedLedger,
  estimateCurrentLedger,
  ledgerToEstimatedDate,
} from "./streaming";

const base = { totalAmount: 1_000_000n, startLedger: 100, endLedger: 200 };

describe("computeStreamedAmount", () => {
  it("is zero at and before the start", () => {
    expect(computeStreamedAmount({ ...base, currentLedger: 0 })).toBe(0n);
    expect(computeStreamedAmount({ ...base, currentLedger: 100 })).toBe(0n);
  });

  it("is linear in between", () => {
    expect(computeStreamedAmount({ ...base, currentLedger: 125 })).toBe(250_000n);
    expect(computeStreamedAmount({ ...base, currentLedger: 150 })).toBe(500_000n);
  });

  it("is exactly the total at and after the end", () => {
    expect(computeStreamedAmount({ ...base, currentLedger: 200 })).toBe(1_000_000n);
    expect(computeStreamedAmount({ ...base, currentLedger: 9_999 })).toBe(1_000_000n);
  });

  it("floors instead of rounding up (never shows more than the contract allows)", () => {
    // 10 over 3 ledgers: 3, 6, 10 -- matches the contract's own test vector.
    const p = { totalAmount: 10n, startLedger: 0, endLedger: 3 };
    expect(computeStreamedAmount({ ...p, currentLedger: 1 })).toBe(3n);
    expect(computeStreamedAmount({ ...p, currentLedger: 2 })).toBe(6n);
    expect(computeStreamedAmount({ ...p, currentLedger: 3 })).toBe(10n);
  });

  it("multiplies before dividing, so large amounts keep full precision", () => {
    const huge = { totalAmount: 10n ** 30n + 7n, startLedger: 0, endLedger: 7 };
    // Far beyond Number.MAX_SAFE_INTEGER; must stay exact in BigInt.
    expect(computeStreamedAmount({ ...huge, currentLedger: 3 })).toBe(((10n ** 30n + 7n) * 3n) / 7n);
  });

  it("treats a zero-length stream as fully vested", () => {
    expect(computeStreamedAmount({ totalAmount: 5n, startLedger: 10, endLedger: 10, currentLedger: 0 })).toBe(5n);
  });

  it("is monotonic non-decreasing and bounded by the total", () => {
    let prev = 0n;
    for (let l = 0; l <= 300; l++) {
      const v = computeStreamedAmount({ totalAmount: 999_999_937n, startLedger: 7, endLedger: 219, currentLedger: l });
      expect(v >= prev).toBe(true);
      expect(v <= 999_999_937n).toBe(true);
      prev = v;
    }
    expect(prev).toBe(999_999_937n);
  });
});

describe("computeWithdrawable", () => {
  it("subtracts what has already been withdrawn", () => {
    expect(computeWithdrawable({ ...base, currentLedger: 150, withdrawnAmount: 200_000n })).toBe(300_000n);
  });

  it("never goes negative", () => {
    expect(computeWithdrawable({ ...base, currentLedger: 110, withdrawnAmount: 900_000n })).toBe(0n);
  });

  it("is zero before the cliff even though the stream is accruing", () => {
    const p = { ...base, withdrawnAmount: 0n, cliffLedger: 150 };
    expect(computeWithdrawable({ ...p, currentLedger: 149 })).toBe(0n);
    // at the cliff the full accrued amount unlocks at once
    expect(computeWithdrawable({ ...p, currentLedger: 150 })).toBe(500_000n);
  });
});

describe("computeProgress", () => {
  it("clamps to [0, 1]", () => {
    const p = { startLedger: 100, endLedger: 200 };
    expect(computeProgress({ ...p, currentLedger: 0 })).toBe(0);
    expect(computeProgress({ ...p, currentLedger: 150 })).toBe(0.5);
    expect(computeProgress({ ...p, currentLedger: 500 })).toBe(1);
  });

  it("treats an empty duration as complete", () => {
    expect(computeProgress({ startLedger: 5, endLedger: 5, currentLedger: 0 })).toBe(1);
  });
});

describe("ledger/time estimation", () => {
  it("advances one ledger per average close time", () => {
    const lastKnownLedgerTimestampMs = 1_000_000;
    const at = (seconds: number) =>
      estimateCurrentLedger({
        lastKnownLedger: 1_000,
        lastKnownLedgerTimestampMs,
        nowMs: lastKnownLedgerTimestampMs + seconds * 1000,
      });
    expect(at(0)).toBe(1_000);
    expect(at(AVERAGE_LEDGER_SECONDS - 0.1)).toBe(1_000);
    expect(at(AVERAGE_LEDGER_SECONDS)).toBe(1_001);
    expect(at(50)).toBe(1_010);
  });

  it("never estimates backwards if the clock skews", () => {
    expect(
      estimateCurrentLedger({ lastKnownLedger: 10, lastKnownLedgerTimestampMs: 5_000, nowMs: 1_000 })
    ).toBe(10);
  });

  it("round-trips dates and ledgers", () => {
    const reference = { ledger: 5_000, timestampMs: Date.UTC(2026, 0, 1) };
    const date = ledgerToEstimatedDate(5_120, reference);
    expect(date.getTime() - reference.timestampMs).toBe(120 * AVERAGE_LEDGER_SECONDS * 1000);
    expect(dateToEstimatedLedger(date, reference)).toBe(5_120);
  });
});

describe("dateToEstimatedLedger", () => {
  const reference = { ledger: 5_000, timestampMs: Date.UTC(2026, 0, 1) };
  const at = (seconds: number) => new Date(reference.timestampMs + seconds * 1000);

  it("rounds a date 12 seconds ahead to 2 ledgers", () => {
    // 12s / 5s per ledger = 2.4 ledgers, which rounds to 2.
    expect(dateToEstimatedLedger(at(12), reference)).toBe(5_002);
  });

  it("rounds a date 12.5 seconds ahead up to the next ledger", () => {
    // 12.5s / 5s per ledger = 2.5 ledgers; Math.round breaks the tie upwards.
    expect(dateToEstimatedLedger(at(12.5), reference)).toBe(5_003);
  });

  it("rounds a date 12 seconds behind to 2 ledgers earlier", () => {
    // -12s / 5s per ledger = -2.4 ledgers, which rounds to -2.
    expect(dateToEstimatedLedger(at(-12), reference)).toBe(4_998);
  });
});
