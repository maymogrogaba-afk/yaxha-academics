// Deterministic grading for quiz answers. No AI is involved here, so the
// same answer always gets the same result.
import { create, all } from "mathjs";

const math = create(all, {});

export type QType = "multiple_choice" | "true_false" | "short_answer" | "numerical" | "formula" | "multi_step";

export type NumericAnswer = {
  value: number;
  unit?: string | null;
  tolerance_pct?: number | null; // relative tolerance, default 1%
  check?: { expression: string; variables?: Record<string, number> } | null;
};

export type Answer =
  | { choice: number }
  | { value: boolean }
  | NumericAnswer
  | { text: string };

export type GradeResult = {
  isCorrect: boolean | null; // null = cannot decide automatically
  score: number; // 0..1
  needsReview: boolean;
  feedback: string;
};

// Words that mean "Philippine peso" and similar money units mathjs does not know.
const CURRENCY = /^(₱|php|p|peso|pesos|\$|usd)$/i;

/** Pulls the numeric part and the unit part out of a typed answer like "1,250.5 kN·m" or "₱ 12,000". */
export function parseNumericResponse(raw: string): { value: number | null; unit: string } {
  let s = String(raw ?? "").trim();
  if (!s) return { value: null, unit: "" };
  // Leading currency symbol
  let unit = "";
  const cur = s.match(/^(₱|PHP|Php|php|\$)\s*/);
  if (cur) {
    unit = cur[1];
    s = s.slice(cur[0].length);
  }
  s = s.replace(/(\d),(?=\d{3}\b)/g, "$1"); // thousands separators
  s = s.replace(/\s*[×x]\s*10\^?\s*(-?\d+)/i, "e$1"); // 1.2 x 10^3
  s = s.replace(/−/g, "-");
  const m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)\s*(.*)$/i);
  if (!m) return { value: null, unit: unit || s };
  let value: number;
  if (m[1].includes("/")) {
    const [a, b] = m[1].split("/").map((x) => Number(x.trim()));
    value = b === 0 ? NaN : a / b;
  } else value = Number(m[1]);
  const rest = m[2].trim();
  if (rest === "%") return { value, unit: "%" };
  return { value: Number.isFinite(value) ? value : null, unit: (unit || rest).trim() };
}

function normalizeUnit(u: string) {
  return u
    .replace(/·|\*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .trim();
}

/** Converts `value unitFrom` into `unitTo`. Returns null when the units are not comparable. */
export function convertUnit(value: number, unitFrom: string, unitTo: string): number | null {
  const a = normalizeUnit(unitFrom);
  const b = normalizeUnit(unitTo);
  if (a.toLowerCase() === b.toLowerCase()) return value;
  if (CURRENCY.test(a) && CURRENCY.test(b)) return value;
  try {
    return math.unit(value, a).toNumber(b);
  } catch {
    return null;
  }
}

export function gradeNumeric(answer: NumericAnswer, response: string): GradeResult {
  const parsed = parseNumericResponse(response);
  if (parsed.value === null) {
    return { isCorrect: false, score: 0, needsReview: false, feedback: "No number could be read from this answer." };
  }
  const expected = answer.value;
  const tol = Math.max(answer.tolerance_pct ?? 1, 0.01) / 100;
  const expectedUnit = (answer.unit ?? "").trim();
  let given = parsed.value;
  let unitNote = "";
  let unitPenalty = 0;

  if (expectedUnit && parsed.unit) {
    const converted = convertUnit(parsed.value, parsed.unit, expectedUnit);
    if (converted === null) {
      return {
        isCorrect: false,
        score: 0,
        needsReview: true,
        feedback: `The unit "${parsed.unit}" could not be matched to the expected unit "${expectedUnit}". Check your unit, or mark this yourself if it is equivalent.`,
      };
    }
    if (converted !== parsed.value) unitNote = ` (converted ${parsed.value} ${parsed.unit} to ${round(converted)} ${expectedUnit})`;
    given = converted;
  } else if (expectedUnit && !parsed.unit && !CURRENCY.test(expectedUnit) && expectedUnit !== "%") {
    unitPenalty = 0.2;
    unitNote = ` Remember to include the unit (${expectedUnit}).`;
  }

  const relErr = expected === 0 ? Math.abs(given) : Math.abs(given - expected) / Math.abs(expected);
  if (relErr <= tol || Math.abs(given - expected) < 1e-9) {
    return {
      isCorrect: true,
      score: 1 - unitPenalty,
      needsReview: false,
      feedback: `Correct${unitNote ? "." + unitNote : "."}`.replace("..", "."),
    };
  }
  if (relErr <= tol * 5) {
    return {
      isCorrect: null,
      score: 0.5,
      needsReview: true,
      feedback: `Very close to the expected ${round(expected)}${expectedUnit ? " " + expectedUnit : ""}. This may be a rounding difference; review the solution and mark it yourself.${unitNote}`,
    };
  }
  return {
    isCorrect: false,
    score: 0,
    needsReview: false,
    feedback: `Expected about ${round(expected)}${expectedUnit ? " " + expectedUnit : ""}.${unitNote}`,
  };
}

export function gradeObjective(qtype: QType, answer: Answer, response: unknown): GradeResult | null {
  if (qtype === "multiple_choice" && "choice" in answer) {
    const picked = response === null || response === undefined || response === "" ? null : Number(response);
    if (picked === null || Number.isNaN(picked)) return { isCorrect: false, score: 0, needsReview: false, feedback: "Not answered." };
    const ok = picked === answer.choice;
    return { isCorrect: ok, score: ok ? 1 : 0, needsReview: false, feedback: ok ? "Correct." : "Not quite." };
  }
  if (qtype === "true_false" && "value" in answer && typeof answer.value === "boolean") {
    if (response === null || response === undefined || response === "") return { isCorrect: false, score: 0, needsReview: false, feedback: "Not answered." };
    const picked = response === true || response === "true";
    const ok = picked === answer.value;
    return { isCorrect: ok, score: ok ? 1 : 0, needsReview: false, feedback: ok ? "Correct." : "Not quite." };
  }
  if ("value" in answer && typeof answer.value === "number") {
    if (response === null || response === undefined || String(response).trim() === "")
      return { isCorrect: false, score: 0, needsReview: false, feedback: "Not answered." };
    return gradeNumeric(answer as NumericAnswer, String(response));
  }
  return null; // free text: needs AI or self-grading
}

/**
 * Re-computes a numerical answer from its formula (when the question supplies one)
 * so wrong answer keys can be caught before the student sees them.
 */
export function verifyNumericAnswer(answer: NumericAnswer): { status: "verified" | "mismatch" | "unverified"; note: string } {
  if (!answer.check?.expression) return { status: "unverified", note: "No formula was provided to re-check this answer." };
  const expr = answer.check.expression;
  if (expr.length > 500 || /import|createUnit|evaluate|parse|simplify|derivative/i.test(expr)) {
    return { status: "unverified", note: "The check formula was not safe to evaluate." };
  }
  try {
    const scope: Record<string, number> = {};
    for (const [k, v] of Object.entries(answer.check.variables ?? {})) {
      if (typeof v === "number" && Number.isFinite(v)) scope[k] = v;
    }
    const raw = math.evaluate(expr, scope);
    const computed = typeof raw === "number" ? raw : Number(raw?.toNumber ? raw.toNumber() : raw);
    if (!Number.isFinite(computed)) return { status: "unverified", note: "The check formula did not produce a number." };
    const tol = Math.max(answer.tolerance_pct ?? 1, 0.01) / 100;
    const relErr = answer.value === 0 ? Math.abs(computed) : Math.abs(computed - answer.value) / Math.abs(answer.value);
    if (relErr <= tol) return { status: "verified", note: `Re-computed: ${round(computed)}.` };
    return { status: "mismatch", note: `The answer key says ${round(answer.value)} but re-computing the formula gives ${round(computed)}.` };
  } catch (e) {
    return { status: "unverified", note: `Could not evaluate the check formula (${(e as Error).message.slice(0, 80)}).` };
  }
}

export function round(n: number, sig = 6) {
  if (!Number.isFinite(n)) return String(n);
  return Number(n.toPrecision(sig)).toString();
}
