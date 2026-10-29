import { Money } from "@devsfleet/shared-utils";

/** An amount at 2 places: what every document total, line net and tax figure is sent as. */
export const amount2 = (value: Money.Minor4): string => Money.toDecimalString(value, 2);

/** A price or quantity: up to 4 places, trailing zeros dropped ("2.2", "50", "0.125"). */
export function trimmed(value: Money.Minor4): string {
  const text = Money.toDecimalString(value, 4);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

export interface LocalParts {
  /** YYYY-MM-DD in the given timezone. */
  date: string;
  /** HH:mm:ss */
  time: string;
  /** "+04:00" */
  offset: string;
}

/** The wall-clock date, time and UTC offset of an instant in a timezone. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "Asia/Dubai";
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const zoneName = get("timeZoneName");
  const match = /GMT([+-]\d{2}:\d{2})/.exec(zoneName);
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
    offset: match?.[1] ?? "+00:00",
  };
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const result = new Date(Date.UTC(y, m - 1, d + days));
  return result.toISOString().slice(0, 10);
}

/** The decimal places a plain decimal string carries. */
export function decimalPlaces(value: string): number {
  const dot = value.indexOf(".");
  return dot === -1 ? 0 : value.length - dot - 1;
}
