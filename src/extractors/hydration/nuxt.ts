import { parse as parseDevalue } from "devalue";
import type { PageContext } from "../../core/context";
import { isRecord } from "../../values";

export function decodeNuxt3(serialized: string, context: PageContext, path: string): unknown {
  try {
    const graph: unknown = JSON.parse(serialized);
    if (
      !Array.isArray(graph) ||
      graph.length > context.limits.maxDecodeNodes ||
      !nuxtGraphWithinLimits(graph, context)
    ) {
      throw new Error("Nuxt graph limit");
    }
    const unwrapEmptyRef = (value: unknown): unknown => {
      if (value === "_") return undefined;
      if (value === "0n") return 0n;
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };
    const revivers = {
      Reactive: (value: unknown) => value,
      ShallowReactive: (value: unknown) => value,
      Ref: (value: unknown) => value,
      ShallowRef: (value: unknown) => value,
      NuxtError: (value: unknown) => value,
      EmptyRef: unwrapEmptyRef,
      EmptyShallowRef: unwrapEmptyRef,
    };
    const decoded = parseDevalue(serialized, revivers);
    if (decoded !== null && typeof decoded === "object") return decoded;
    return graph[0] === "Reactive" || graph[0] === "Ref" ? graph[1] : decoded;
  } catch (e) {
    context.issues.push({ sourcePath: path, message: `Nuxt devalue decode failed: ${String(e).slice(0, 120)}` });
    return undefined;
  }
}

export function nuxtGraphWithinLimits(graph: unknown[], context: PageContext): boolean {
  const pending: Array<{ index: number; depth: number }> = [{ index: 0, depth: 0 }];
  const visited = new Set<number>();
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (current.index < 0 || current.index >= graph.length || current.depth > context.limits.maxDecodeDepth)
      return false;
    if (++count > context.limits.maxDecodeNodes) return false;
    if (visited.has(current.index)) continue;
    visited.add(current.index);
    const value = graph[current.index];
    if (Array.isArray(value)) {
      if (value.length > context.limits.maxDecodeNodes) return false;
      const tag = typeof value[0] === "string" ? value[0] : undefined;
      let start = 0;
      let step = 1;
      let end = value.length;
      if (tag === "Set" || tag === "Map") start = 1;
      else if (tag === "null") {
        start = 2;
        step = 2;
      } else if (tag) {
        start = 1;
        end = Math.min(2, value.length);
      } else if (value[0] === -7) {
        // devalue sparse array: [-7, length, index, reference, ...].
        if (!Number.isSafeInteger(value[1]) || Number(value[1]) > context.limits.maxDecodeNodes) return false;
        start = 3;
        step = 2;
      }
      for (let index = start; index < end; index += step) {
        const item = value[index];
        if (typeof item === "number" && Number.isInteger(item) && item >= 0 && tag !== "Date") {
          pending.push({ index: item, depth: current.depth + 1 });
        }
      }
    } else if (isRecord(value)) {
      for (const item of Object.values(value)) {
        if (typeof item === "number" && Number.isInteger(item) && item >= 0)
          pending.push({ index: item, depth: current.depth + 1 });
      }
    }
  }
  return true;
}
