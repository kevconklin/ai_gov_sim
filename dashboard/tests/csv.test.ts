import { describe, expect, it } from "vitest";
import { csvCell, safeFilename, toCsv } from "@/lib/csv";

describe("csv", () => {
  it("serializes rows with a header and CRLF line endings", () => {
    expect(toCsv([{ month: "2027-01", value: 1.5 }, { month: "2027-02", value: null }])).toBe(
      "month,value\r\n2027-01,1.5\r\n2027-02,\r\n",
    );
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("uses explicit column order and the union of keys", () => {
    expect(toCsv([{ a: 1 }, { b: 2 }])).toBe("a,b\r\n1,\r\n,2\r\n");
    expect(toCsv([{ a: 1, b: 2 }], ["b", "a"])).toBe("b,a\r\n2,1\r\n");
  });

  it("neutralizes formula injection but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(true)).toBe("true");
  });

  it("builds safe filenames", () => {
    expect(safeFilename("AI Revenue / monthly")).toBe("ai-revenue-monthly.csv");
    expect(safeFilename("***")).toBe("data.csv");
  });
});
