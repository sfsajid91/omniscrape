import type { PageContext } from "../../core/context";
import { isRecord } from "../../values";
import { type AstNode, isAstNode } from "./static-eval";

export type ScriptParseResult = { program: AstNode } | { error: unknown };
export type FlightOutput = { value: unknown; path: string; origins: WeakMap<object, string> };

export function recoverFlightNewlineScript(script: string, error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.message.includes("Unterminated string constant") || !isRecord(error))
    return undefined;
  const position = error.pos;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0 || position >= script.length)
    return undefined;
  const quote = script[position];
  if (quote !== "'" && quote !== '"') return undefined;
  const prefix = /(?:^|[;{}\r\n])\s*(?:self|window|globalThis)\s*\.\s*__next_f\s*\.\s*push\s*\(\s*\[\s*1\s*,\s*$/.exec(
    script.slice(0, position),
  );
  if (!prefix) return undefined;
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
  if (closing < 0 || !newlines.length || !/^\s*\]\s*\)\s*(?:;|\s|$)/.test(script.slice(closing + 1))) return undefined;
  let repaired = script;
  for (let index = newlines.length - 1; index >= 0; index--) {
    const position = newlines[index]!;
    repaired = `${repaired.slice(0, position)}\\${script[position] === "\r" ? "r" : "n"}${repaired.slice(position + 1)}`;
  }
  return repaired;
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

  let currentId: string | undefined;
  let currentPayload = "";
  let currentSourcePath = "script";

  const pushRecord = (record: { id: string; value: unknown; path: string; isText?: boolean }, sourcePath: string) => {
    if (records.length >= context.limits.maxDecodeNodes) {
      context.issues.push({ sourcePath, message: "Flight record limit exceeded" });
      return;
    }
    records.push(record);
  };

  const flushRecord = () => {
    if (currentId && currentPayload) {
      if (records.length >= context.limits.maxDecodeNodes) {
        context.issues.push({ sourcePath: currentSourcePath, message: "Flight record limit exceeded" });
      } else {
        try {
          records.push({
            id: currentId,
            value: JSON.parse(currentPayload),
            path: `${currentSourcePath}#flight:${currentId}`,
          });
        } catch {
          /* text/model records are intentionally ignored */
        }
      }
    }
    currentId = undefined;
    currentPayload = "";
  };

  const isCurrentUnclosedJson = (): boolean => {
    if (!currentId || !currentPayload) return false;
    const trimmed = currentPayload.trimStart();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
    try {
      JSON.parse(currentPayload);
      return false;
    } catch {
      return true;
    }
  };

  const FLIGHT_ROW_TOKEN = /^(?:[{["]|(?:I\[|HL\[|T[0-9a-f]+,|E\{|D\{)|(?:null|true|false)$)/;
  let pos = 0;
  while (pos < stream.length) {
    const nl = stream.indexOf("\n", pos);
    const lineEnd = nl === -1 ? stream.length : nl;
    const lineRaw = stream.slice(pos, lineEnd);
    const sourcePath = sourcePathAt(pos);

    const textMatch = /^([0-9a-f]+):T([0-9a-f]+),/i.exec(lineRaw);
    if (textMatch) {
      flushRecord();
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
      const textValue = stream.slice(payloadStart, cursor);
      pushRecord({ id, value: textValue, path: `${sourcePath}#flight:${id}`, isText: true }, sourcePath);
      pos = cursor;
      if (pos < stream.length && stream[pos] === "\r" && stream[pos + 1] === "\n") {
        pos += 2;
      } else if (pos < stream.length && stream[pos] === "\n") {
        pos += 1;
      }
      continue;
    }

    const row = lineRaw.endsWith("\r") ? lineRaw.slice(0, -1) : lineRaw;
    const match = /^([0-9a-f]+):(.*)$/i.exec(row);
    const startsNewRecord = match !== null && (!isCurrentUnclosedJson() || FLIGHT_ROW_TOKEN.test(match[2]!));
    if (startsNewRecord && match) {
      flushRecord();
      currentId = match[1]!.toLowerCase();
      currentPayload = match[2]!;
      currentSourcePath = sourcePath;
    } else if (currentId !== undefined && (row.length > 0 || isCurrentUnclosedJson())) {
      currentPayload += `\\n${row}`;
    }
    pos = nl === -1 ? stream.length : nl + 1;
  }
  flushRecord();

  const recordsById = new Map(records.map((record) => [record.id, record]));
  const referenced = new Set<string>();
  let scanNodes = 0;
  let scanOverflow = false;
  const scan: unknown[] = records.filter((record) => !record.isText).map((record) => record.value);
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
      return refId && recordsById.has(refId) ? resolveRecord(refId, depth + 1) : value;
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
  const roots = records.filter((record) => record.id === "0" || !referenced.has(record.id));
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
