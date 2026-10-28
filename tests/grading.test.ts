import { describe, expect, it } from "vitest";
import { convertUnit, gradeNumeric, gradeObjective, parseNumericResponse, verifyNumericAnswer } from "@/lib/study/grading";

describe("parseNumericResponse", () => {
  it("reads numbers with thousands separators and units", () => {
    expect(parseNumericResponse("14,693.28 PHP")).toEqual({ value: 14693.28, unit: "PHP" });
    expect(parseNumericResponse("₱ 12,000")).toEqual({ value: 12000, unit: "₱" });
    expect(parseNumericResponse("3.2 m")).toEqual({ value: 3.2, unit: "m" });
    expect(parseNumericResponse("1.2 x 10^3 N")).toEqual({ value: 1200, unit: "N" });
    expect(parseNumericResponse("3/4")).toEqual({ value: 0.75, unit: "" });
    expect(parseNumericResponse("8.24%")).toEqual({ value: 8.24, unit: "%" });
    expect(parseNumericResponse("−5")).toEqual({ value: -5, unit: "" });
    expect(parseNumericResponse("abc").value).toBeNull();
  });
});

describe("gradeNumeric", () => {
  const ans = { value: 14693.28, unit: "PHP", tolerance_pct: 1 };
  it("accepts answers within tolerance, including currency spellings", () => {
    expect(gradeNumeric(ans, "14693").isCorrect).toBe(true);
    expect(gradeNumeric(ans, "₱14,693.28").isCorrect).toBe(true);
    expect(gradeNumeric(ans, "14,700 pesos").isCorrect).toBe(true);
  });
  it("marks close-but-outside answers for review instead of wrong", () => {
    const r = gradeNumeric(ans, "14,950");
    expect(r.isCorrect).toBeNull();
    expect(r.needsReview).toBe(true);
  });
  it("marks clearly wrong answers wrong", () => {
    expect(gradeNumeric(ans, "13000").isCorrect).toBe(false);
  });
  it("converts compatible units", () => {
    const r = gradeNumeric({ value: 2.5, unit: "m", tolerance_pct: 1 }, "250 cm");
    expect(r.isCorrect).toBe(true);
    expect(r.score).toBe(1);
  });
  it("applies a small penalty when a physical unit is missing", () => {
    const r = gradeNumeric({ value: 2.5, unit: "m" }, "2.5");
    expect(r.isCorrect).toBe(true);
    expect(r.score).toBeCloseTo(0.8);
  });
  it("flags incompatible units for review", () => {
    const r = gradeNumeric({ value: 2.5, unit: "m" }, "2.5 kg");
    expect(r.needsReview).toBe(true);
    expect(r.isCorrect).toBe(false);
  });
  it("convertUnit handles compound units", () => {
    expect(convertUnit(1, "kN", "N")).toBe(1000);
    expect(convertUnit(1, "m^2", "cm^2")).toBeCloseTo(10000);
    expect(convertUnit(1, "m", "s")).toBeNull();
  });
});

describe("gradeObjective", () => {
  it("grades multiple choice and true/false", () => {
    expect(gradeObjective("multiple_choice", { choice: 2 }, "2")?.isCorrect).toBe(true);
    expect(gradeObjective("multiple_choice", { choice: 2 }, "1")?.isCorrect).toBe(false);
    expect(gradeObjective("multiple_choice", { choice: 2 }, "")?.feedback).toBe("Not answered.");
    expect(gradeObjective("true_false", { value: false }, "false")?.isCorrect).toBe(true);
    expect(gradeObjective("true_false", { value: false }, "true")?.isCorrect).toBe(false);
  });
  it("returns null for free-text answers (needs AI or self-marking)", () => {
    expect(gradeObjective("short_answer", { text: "x" }, "y")).toBeNull();
  });
});

describe("verifyNumericAnswer", () => {
  it("confirms an answer key that matches its formula", () => {
    const r = verifyNumericAnswer({ value: 14693.28, check: { expression: "P*(1+i)^n", variables: { P: 10000, i: 0.08, n: 5 } } });
    expect(r.status).toBe("verified");
  });
  it("catches a wrong answer key", () => {
    const r = verifyNumericAnswer({ value: 15000, check: { expression: "P*(1+i)^n", variables: { P: 10000, i: 0.08, n: 5 } } });
    expect(r.status).toBe("mismatch");
  });
  it("refuses unsafe expressions and handles missing formulas", () => {
    expect(verifyNumericAnswer({ value: 1, check: { expression: "import({}, {})" } }).status).toBe("unverified");
    expect(verifyNumericAnswer({ value: 1 }).status).toBe("unverified");
  });
});
