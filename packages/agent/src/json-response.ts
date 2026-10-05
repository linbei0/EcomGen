/** 解析模型可能附带自然语言前缀或 Markdown 围栏的 JSON 响应。 */
export function parseJsonResponse(value: string): unknown {
  const text = value.trim().replace(/^\uFEFF/, "");
  const direct = stripJsonFence(text);
  let firstError: unknown;
  try {
    return JSON.parse(direct);
  } catch (error) {
    firstError = error;
  }

  for (const start of candidateStarts(text)) {
    const end = balancedJsonEnd(text, start);
    if (end === null) continue;
    try {
      return JSON.parse(text.slice(start, end));
    } catch {
      // 继续查找后续候选，避免把前缀中的半截对象当成响应。
    }
  }
  throw firstError;
}

function candidateStarts(value: string): number[] {
  const starts: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{" || value[index] === "[") starts.push(index);
  }
  return starts;
}

function balancedJsonEnd(value: string, start: number): number | null {
  const opening = value[start];
  const stack = [opening];
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== "]") continue;
    const expected = character === "}" ? "{" : "[";
    if (stack.at(-1) !== expected) return null;
    stack.pop();
    if (stack.length === 0) return index + 1;
  }
  return null;
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}
