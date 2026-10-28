// Human-readable correct answers for result pages.
export function describeAnswer(qtype: string, answer: Record<string, unknown>, choices: string[] | null): string {
  if (qtype === "multiple_choice" && typeof answer.choice === "number") return `${String.fromCharCode(65 + answer.choice)}. ${choices?.[answer.choice] ?? ""}`;
  if (typeof answer.value === "boolean") return answer.value ? "True" : "False";
  if (typeof answer.value === "number") return `${answer.value}${answer.unit ? " " + answer.unit : ""}`;
  return String(answer.text ?? "");
}

export function describeResponse(qtype: string, response: unknown, choices: string[] | null): string {
  if (response === null || response === undefined || response === "") return "No answer";
  if (qtype === "multiple_choice") {
    const i = Number(response);
    return Number.isInteger(i) ? `${String.fromCharCode(65 + i)}. ${choices?.[i] ?? ""}` : String(response);
  }
  if (qtype === "true_false") return response === "true" || response === true ? "True" : "False";
  return String(response);
}
