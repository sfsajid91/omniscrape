import type { PageContext } from "../../core/context";
import { isRecord } from "../../values";
import { type AstNode, isAstNode } from "./static-eval";

export type ScriptParseResult = { program: AstNode } | { error: unknown };
export type FlightOutput = { value: unknown; path: string; origins: WeakMap<object, string> };

function isWhitespaceChar(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11 || code === 0xa0;
}

function skipWsBackwards(script: string, idx: number): number {
  while (idx >= 0 && isWhitespaceChar(script.charCodeAt(idx))) idx--;
  return idx;
}

function skipWsForward(script: string, idx: number): number {
  while (idx < script.length && isWhitespaceChar(script.charCodeAt(idx))) idx++;
  return idx;
}

function matchWordBackwards(script: string, idx: number, word: string): number {
  const start = idx - word.length + 1;
  if (start < 0 || !script.startsWith(word, start)) return -2;
  return start - 1;
}

function hasValidFlightPrefix(script: string, position: number): boolean {
  let idx = skipWsBackwards(script, position - 1);
  if (idx < 0 || script[idx] !== ",") return false;
  idx = skipWsBackwards(script, idx - 1);
  if (idx < 0 || script[idx] !== "1") return false;
  idx = skipWsBackwards(script, idx - 1);
  if (idx < 0 || script[idx] !== "[") return false;
  idx = skipWsBackwards(script, idx - 1);
  if (idx < 0 || script[idx] !== "(") return false;
  idx = skipWsBackwards(script, idx - 1);
  idx = matchWordBackwards(script, idx, "push");
  if (idx === -2) return false;
  idx = skipWsBackwards(script, idx);
  if (idx < 0 || script[idx] !== ".") return false;
  idx = skipWsBackwards(script, idx - 1);
  let nextIdx: number;
  if (script[idx] === ")") {
    const start = script.lastIndexOf("(", idx);
    if (
      start < 0 ||
      !/^\(\s*(self|window|globalThis)\s*\.\s*__next_f\s*=\s*\1\s*\.\s*__next_f\s*\|\|\s*\[\s*\]\s*\)$/.test(
        script.slice(start, idx + 1),
      )
    )
      return false;
    nextIdx = start - 1;
  } else {
    idx = matchWordBackwards(script, idx, "__next_f");
    if (idx === -2) return false;
    idx = skipWsBackwards(script, idx);
    if (idx < 0 || script[idx] !== ".") return false;
    idx = skipWsBackwards(script, idx - 1);
    nextIdx = matchWordBackwards(script, idx, "globalThis");
    if (nextIdx === -2) nextIdx = matchWordBackwards(script, idx, "window");
    if (nextIdx === -2) nextIdx = matchWordBackwards(script, idx, "self");
    if (nextIdx === -2) return false;
  }
  let crossedNewline = false;
  while (nextIdx >= 0 && isWhitespaceChar(script.charCodeAt(nextIdx))) {
    const ch = script[nextIdx];
    if (ch === "\r" || ch === "\n") crossedNewline = true;
    nextIdx--;
  }
  if (nextIdx < 0 || crossedNewline) return true;
  const boundary = script[nextIdx];
  return boundary === ";" || boundary === "," || boundary === "{" || boundary === "}";
}

export function recoverFlightNewlineScript(script: string, error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.message.includes("Unterminated string constant") || !isRecord(error))
    return undefined;
  const position = error.pos;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0 || position >= script.length)
    return undefined;
  const quote = script[position];
  if (quote !== "'" && quote !== '"') return undefined;
  if (!hasValidFlightPrefix(script, position)) return undefined;
  const newlines: number[] = [];
  let closing = -1;
  for (let index = position + 1; index < script.length; index++) {
    const character = script[index];
    if (character === "\\") {
      index++;
      continue;
    }
    if (character === quote) {
      closing = index;
      break;
    }
    if (character === "\r" || character === "\n") newlines.push(index);
  }
  if (closing < 0 || !newlines.length) return undefined;
  // Check exact suffix: ^\s*\]\s*\)\s*(?:;|\s|$)
  let afterParen = skipWsForward(script, closing + 1);
  if (afterParen >= script.length || script[afterParen] !== "]") return undefined;
  afterParen = skipWsForward(script, afterParen + 1);
  if (afterParen >= script.length || script[afterParen] !== ")") return undefined;
  const postParenIdx = afterParen + 1;
  if (
    postParenIdx < script.length &&
    script[postParenIdx] !== ";" &&
    script[postParenIdx] !== "," &&
    !isWhitespaceChar(script.charCodeAt(postParenIdx))
  ) {
    return undefined;
  }
  const parts: string[] = [];
  let last = 0;
  for (const nlPos of newlines) {
    parts.push(script.slice(last, nlPos), script[nlPos] === "\r" ? "\\r" : "\\n");
    last = nlPos + 1;
  }
  parts.push(script.slice(last));
  return parts.join("");
}

export function parseFlightRecords(
  scripts: Array<{ text: string; path: string; type?: string }>,
  context: PageContext,
  parsedScripts: Map<string, ScriptParseResult>,
  recoveredPrograms: Map<string, AstNode>,
): FlightOutput[] {
  const chunks: Array<{ text: string; path: string }> = [];
  for (const script of scripts) {
    const parsed = parsedScripts.get(script.path);
    const program = recoveredPrograms.get(script.path) ?? (parsed && !("error" in parsed) ? parsed.program : undefined);
    if (!program) continue;
    try {
      const pending: AstNode[] = [program];
      const found: Array<{ start: number; text: string; path: string }> = [];
      let visitedNodes = 0;
      while (pending.length && ++visitedNodes <= context.limits.maxDecodeNodes) {
        const node = pending.pop()!;
        if (node.type === "CallExpression" && isFlightPush(node.callee as AstNode)) {
          const tuple = (node.arguments as AstNode[])[0];
          if (tuple?.type === "ArrayExpression") {
            const elements = tuple.elements as AstNode[];
            const payload = elements[1] as AstNode | undefined;
            const value =
              payload?.type === "Literal" && typeof payload.value === "string"
                ? payload.value
                : payload?.type === "TemplateLiteral" && (payload.expressions as AstNode[]).length === 0
                  ? ((payload.quasis as AstNode[])[0]?.value as { cooked?: unknown } | undefined)?.cooked
                  : undefined;
            if (elements[0]?.type === "Literal" && elements[0].value === 1 && typeof value === "string") {
              found.push({ start: typeof node.start === "number" ? node.start : 0, text: value, path: script.path });
            }
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const child of value) if (isAstNode(child)) pending.push(child);
          } else if (isAstNode(value)) pending.push(value);
        }
      }
      if (pending.length) context.issues.push({ sourcePath: script.path, message: "Flight script AST limit exceeded" });
      found.sort((left, right) => left.start - right.start);
      chunks.push(...found.map(({ text, path }) => ({ text, path })));
    } catch {
      context.issues.push({ sourcePath: script.path, message: "Malformed Flight script" });
    }
  }
  const records: Array<{ id: string; value: unknown; path: string; isText?: boolean }> = [];
  let chunkOffset = 0;
  const ranges = chunks.map((chunk) => {
    const range = { start: chunkOffset, end: chunkOffset + chunk.text.length, path: chunk.path };
    chunkOffset = range.end;
    return range;
  });
  const stream = chunks.map((chunk) => chunk.text).join("");
  let rangeIndex = 0;
  const sourcePathAt = (offset: number): string => {
    while (rangeIndex < ranges.length && offset >= ranges[rangeIndex]!.end) {
      rangeIndex++;
    }
    const range = ranges[rangeIndex];
    return range && offset >= range.start && offset < range.end ? range.path : "script";
  };

  const truncatedIds = new Set<string>();
  let currentId: string | undefined;
  let currentPayload = "";
  let currentSourcePath = "script";
  let currentNextLinePos = -1;
  let currentLineCount = 0;
  let jsonMode: "none" | "container" | "string" = "none";
  let jsonDepth = 0;
  let inJsonString = false;
  let jsonEscaped = false;
  let jsonComplete = false;
  let recoveryRewinds = 0;
  let recoveryLimitReported = false;
  const MAX_RECOVERY_REWINDS = 32;

  const resetJsonState = () => {
    jsonMode = "none";
    jsonDepth = 0;
    inJsonString = false;
    jsonEscaped = false;
    jsonComplete = false;
  };

  const advanceJsonState = (chunk: string) => {
    if (jsonMode === "none" || jsonComplete) return;
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (inJsonString) {
        if (jsonEscaped) {
          jsonEscaped = false;
        } else if (ch === "\\") {
          jsonEscaped = true;
        } else if (ch === '"') {
          inJsonString = false;
          if (jsonMode === "string" && jsonDepth === 0) {
            jsonComplete = true;
            return;
          }
        }
        continue;
      }
      if (ch === '"') {
        inJsonString = true;
        continue;
      }
      if (jsonMode === "container") {
        if (ch === "{" || ch === "[") {
          jsonDepth++;
        } else if (ch === "}" || ch === "]") {
          if (jsonDepth > 0) jsonDepth--;
          if (jsonDepth === 0) {
            jsonComplete = true;
            return;
          }
        }
      }
    }
  };

  const startJsonTracking = (payload: string) => {
    resetJsonState();
    const trimmed = payload.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      jsonMode = "container";
      advanceJsonState(trimmed);
    } else if (trimmed.startsWith('"')) {
      jsonMode = "string";
      advanceJsonState(trimmed);
    }
  };

  const FLIGHT_ROW_TOKEN = /^(?:[{["]|(?:I\[|HL\[|T[0-9a-f]+,|E\{|D\{)|(?:null|true|false)$)/;
  const T_HEADER_RE = /([0-9a-f]+):T([0-9a-f]+),/iy;

  const findRecoveryLinePos = (startPos: number, endPos: number): number => {
    let cursor = startPos;
    while (cursor < endPos) {
      const lineNl = stream.indexOf("\n", cursor);
      const lineEnd = lineNl === -1 || lineNl > endPos ? endPos : lineNl;
      T_HEADER_RE.lastIndex = cursor;
      if (T_HEADER_RE.test(stream)) return cursor;
      const lineRaw = stream.slice(cursor, lineEnd);
      const line = lineRaw.endsWith("\r") ? lineRaw.slice(0, -1) : lineRaw;
      const rowMatch = /^([0-9a-f]+):(.*)$/i.exec(line);
      if (rowMatch && FLIGHT_ROW_TOKEN.test(rowMatch[2]!)) return cursor;
      if (lineNl === -1 || lineNl >= endPos) break;
      cursor = lineNl + 1;
    }
    return -1;
  };

  const pushRecord = (record: { id: string; value: unknown; path: string; isText?: boolean }, sourcePath: string) => {
    if (records.length >= context.limits.maxDecodeNodes) {
      context.issues.push({ sourcePath, message: "Flight record limit exceeded" });
      return;
    }
    truncatedIds.delete(record.id);
    records.push(record);
  };

  const flushRecord = (recordEndPos: number): number | undefined => {
    let rewindPos: number | undefined;
    if (currentId && currentPayload) {
      if (records.length >= context.limits.maxDecodeNodes) {
        context.issues.push({ sourcePath: currentSourcePath, message: "Flight record limit exceeded" });
      } else {
        try {
          const parsedValue = JSON.parse(currentPayload);
          truncatedIds.delete(currentId);
          records.push({
            id: currentId,
            value: parsedValue,
            path: `${currentSourcePath}#flight:${currentId}`,
          });
        } catch {
          if (jsonMode !== "none" && (!jsonComplete || currentLineCount > 1)) {
            context.issues.push({ sourcePath: currentSourcePath, message: "Malformed Flight record" });
            if (currentNextLinePos >= 0 && currentNextLinePos < recordEndPos) {
              const nextRowPos = findRecoveryLinePos(currentNextLinePos, recordEndPos);
              if (nextRowPos >= 0) {
                if (recoveryRewinds < MAX_RECOVERY_REWINDS) {
                  recoveryRewinds++;
                  rewindPos = nextRowPos;
                } else if (!recoveryLimitReported) {
                  recoveryLimitReported = true;
                  context.issues.push({ sourcePath: currentSourcePath, message: "Flight recovery limit exceeded" });
                }
              }
            }
          }
        }
      }
    }
    currentId = undefined;
    currentPayload = "";
    currentNextLinePos = -1;
    currentLineCount = 0;
    resetJsonState();
    return rewindPos;
  };

  let pos = 0;
  while (pos < stream.length) {
    const sourcePath = sourcePathAt(pos);
    if (!inJsonString) {
      T_HEADER_RE.lastIndex = pos;
      const textMatch = T_HEADER_RE.exec(stream);
      if (textMatch) {
        const rewindPos = flushRecord(pos);
        if (rewindPos !== undefined) {
          pos = rewindPos;
          continue;
        }
        const id = textMatch[1]!.toLowerCase();
        const byteLen = Number.parseInt(textMatch[2]!, 16);
        const payloadStart = pos + textMatch[0].length;
        let cursor = payloadStart;
        let bytes = 0;
        while (cursor < stream.length && bytes < byteLen) {
          const cp = stream.codePointAt(cursor)!;
          const charBytes = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
          const codeUnits = cp > 0xffff ? 2 : 1;
          if (bytes + charBytes > byteLen) break;
          bytes += charBytes;
          cursor += codeUnits;
        }
        if (bytes < byteLen) {
          truncatedIds.add(id);
          context.issues.push({ sourcePath, message: "Truncated Flight text chunk" });
        } else {
          const textValue = stream.slice(payloadStart, cursor);
          pushRecord({ id, value: textValue, path: `${sourcePath}#flight:${id}`, isText: true }, sourcePath);
        }
        pos = cursor;
        if (pos < stream.length && stream[pos] === "\r" && stream[pos + 1] === "\n") {
          pos += 2;
        } else if (pos < stream.length && stream[pos] === "\n") {
          pos += 1;
        }
        if (pos >= stream.length && currentId !== undefined) {
          const endRewind = flushRecord(stream.length);
          if (endRewind !== undefined) pos = endRewind;
        }
        continue;
      }
    }

    const nl = stream.indexOf("\n", pos);
    const lineEnd = nl === -1 ? stream.length : nl;
    const lineRaw = stream.slice(pos, lineEnd);
    const row = lineRaw.endsWith("\r") ? lineRaw.slice(0, -1) : lineRaw;
    const match = /^([0-9a-f]+):(.*)$/i.exec(row);
    const isUnclosedJson = jsonMode !== "none" && !jsonComplete;
    const startsNewRecord = match !== null && (!isUnclosedJson || (!inJsonString && FLIGHT_ROW_TOKEN.test(match[2]!)));
    if (startsNewRecord && match) {
      const rewindPos = flushRecord(pos);
      if (rewindPos !== undefined) {
        pos = rewindPos;
        continue;
      }
      currentId = match[1]!.toLowerCase();
      currentPayload = match[2]!;
      currentSourcePath = sourcePath;
      currentNextLinePos = nl === -1 ? stream.length : nl + 1;
      currentLineCount = 1;
      startJsonTracking(currentPayload);
    } else if (currentId !== undefined && (row.length > 0 || isUnclosedJson)) {
      currentLineCount++;
      const sep = inJsonString ? "\\n" : "\n";
      currentPayload += `${sep}${row}`;
      advanceJsonState(sep);
      advanceJsonState(row);
    }
    pos = nl === -1 ? stream.length : nl + 1;
    if (pos >= stream.length && currentId !== undefined) {
      const rewindPos = flushRecord(stream.length);
      if (rewindPos !== undefined) pos = rewindPos;
    }
  }

  const recordsById = new Map(records.map((record) => [record.id, record]));
  const uniqueRecords = Array.from(recordsById.values());
  const referenced = new Set<string>();
  let scanNodes = 0;
  let scanOverflow = false;
  const scan: unknown[] = uniqueRecords.filter((record) => !record.isText).map((record) => record.value);
  const enqueue = (value: unknown) => {
    if (scanNodes + scan.length < context.limits.maxDecodeNodes) scan.push(value);
    else scanOverflow = true;
  };
  while (scan.length && scanNodes < context.limits.maxDecodeNodes) {
    scanNodes++;
    const value = scan.pop();
    if (typeof value === "string") {
      const ref = /^\$[L@]?([0-9a-f]+)$/i.exec(value);
      if (ref) referenced.add(ref[1]!.toLowerCase());
    } else if (Array.isArray(value)) {
      for (const child of value) enqueue(child);
    } else if (isRecord(value)) {
      for (const child of Object.values(value)) enqueue(child);
    }
  }
  if (scan.length || scanOverflow) {
    context.issues.push({ sourcePath: scripts[0]?.path ?? "script", message: "Flight reference scan limit exceeded" });
  }

  const origins = new WeakMap<object, string>();
  const memo = new Map<string, unknown>();
  let nodes = 0;
  let limited = false;
  function resolveRecord(id: string, depth: number): unknown {
    const normalizedId = id.toLowerCase();
    if (memo.has(normalizedId)) return memo.get(normalizedId);
    const record = recordsById.get(normalizedId);
    if (!record) return undefined;
    if (++nodes > context.limits.maxDecodeNodes || depth > context.limits.maxDecodeDepth) {
      limited = true;
      return undefined;
    }
    if (record.isText) {
      memo.set(normalizedId, record.value);
      return record.value;
    }
    if (Array.isArray(record.value)) {
      const output: unknown[] = [];
      memo.set(normalizedId, output);
      origins.set(output, record.path);
      for (let i = 0; i < record.value.length; i++) {
        output.push(resolveValue(record.value[i], `${record.path}[${i}]`, depth + 1));
      }
      return output;
    }
    if (isRecord(record.value)) {
      const output: Record<string, unknown> = {};
      memo.set(normalizedId, output);
      origins.set(output, record.path);
      for (const [key, child] of Object.entries(record.value)) {
        output[key] = resolveValue(child, `${record.path}.${key}`, depth + 1);
      }
      return output;
    }
    const value = resolveValue(record.value, record.path, depth + 1);
    memo.set(normalizedId, value);
    return value;
  }
  function resolveValue(value: unknown, path: string, depth: number): unknown {
    if (++nodes > context.limits.maxDecodeNodes || depth > context.limits.maxDecodeDepth) {
      limited = true;
      return undefined;
    }
    if (typeof value === "string") {
      const dateMatch = /^\$D(\d{4}-\d{2}-\d{2}T.+)$/.exec(value);
      if (dateMatch) return dateMatch[1];
      const ref = /^\$[L@]?([0-9a-f]+)$/i.exec(value);
      const refId = ref?.[1]?.toLowerCase();
      if (refId) {
        if (recordsById.has(refId)) return resolveRecord(refId, depth + 1);
        if (truncatedIds.has(refId)) return undefined;
      }
      return value;
    }
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      origins.set(output, path);
      for (let i = 0; i < value.length; i++) {
        output.push(resolveValue(value[i], `${path}[${i}]`, depth + 1));
      }
      return output;
    }
    if (isRecord(value)) {
      const output: Record<string, unknown> = {};
      origins.set(output, path);
      for (const [key, child] of Object.entries(value)) {
        output[key] = resolveValue(child, `${path}.${key}`, depth + 1);
      }
      return output;
    }
    return value;
  }
  const roots = uniqueRecords.filter((record) => record.id === "0" || !referenced.has(record.id));
  const output = roots.flatMap((record) => {
    const value = resolveRecord(record.id, 0);
    return value === undefined ? [] : [{ value, path: record.path, origins }];
  });
  if (limited)
    context.issues.push({ sourcePath: scripts[0]?.path ?? "script", message: "Flight decode limit exceeded" });
  return output;
}

function isFlightPush(node: AstNode): boolean {
  if (
    node.type !== "MemberExpression" ||
    node.computed ||
    (node.property as AstNode).type !== "Identifier" ||
    (node.property as AstNode).name !== "push"
  )
    return false;
  return isNextFObject(node.object as AstNode);
}

function isNextFObject(node: AstNode): boolean {
  if (node.type === "AssignmentExpression" || node.type === "LogicalExpression")
    return isNextFObject(node.left as AstNode);
  if (node.type === "SequenceExpression") return (node.expressions as AstNode[]).some(isNextFObject);
  if (
    node.type !== "MemberExpression" ||
    node.computed ||
    (node.property as AstNode).type !== "Identifier" ||
    (node.property as AstNode).name !== "__next_f"
  )
    return false;
  const target = node.object as AstNode;
  return (
    target.type === "Identifier" && (target.name === "self" || target.name === "window" || target.name === "globalThis")
  );
}
