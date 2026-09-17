const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

export function fmtUsd(v: number | null | undefined, cents = false): string {
  if (v === null || v === undefined) return "-";
  return cents ? usd2.format(v) : usd0.format(v);
}

export function fmtInt(v: number | null | undefined): string {
  return v === null || v === undefined ? "-" : int.format(v);
}

export function fmtNum(v: number | null | undefined): string {
  return v === null || v === undefined ? "-" : dec.format(v);
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "-" : `${(v * 100).toFixed(digits)}%`;
}

/** Real timestamps: only for Log explorer, Control and Health pages. */
export function fmtRealTs(iso: string | null | undefined): string {
  if (!iso) return "-";
  return iso.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

export function prettyJson(text: string | null | undefined): string {
  if (text === null || text === undefined) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
