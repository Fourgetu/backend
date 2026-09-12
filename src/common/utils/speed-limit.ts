/**
 * Speed-limit values are stored and transported internally as bytes/second.
 * The UI may display decimal Mbps, but conversion must happen in one place.
 * A zero value always means unlimited.
 */
export const BYTES_PER_MEGABIT = 125_000;

export function mbpsToBytesPerSecond(mbps: number): bigint {
    if (!Number.isFinite(mbps) || mbps < 0) {
        throw new Error('Mbps must be a finite non-negative number');
    }

    return BigInt(Math.round(mbps * BYTES_PER_MEGABIT));
}

export function bytesPerSecondToMbps(bytesPerSecond: bigint | number): number {
    const value = typeof bytesPerSecond === 'bigint' ? Number(bytesPerSecond) : bytesPerSecond;

    if (!Number.isFinite(value) || value < 0) {
        throw new Error('bytesPerSecond must be a finite non-negative number');
    }

    return value / BYTES_PER_MEGABIT;
}

export function normalizeSpeedBytesPerSecond(value: bigint | number | string): bigint {
    const normalized = typeof value === 'bigint' ? value : BigInt(value);

    if (normalized < 0n) {
        throw new Error('Speed must be non-negative');
    }

    return normalized;
}
