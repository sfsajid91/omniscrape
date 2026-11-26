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
  const maxNodes = context.limits.maxDecodeNodes;
  const maxDepth = context.limits.maxDecodeDepth;
  if (graph.length === 0) return false;

  const adj = new Map<number, number[]>();
  const visited = new Set<number>([0]);
  const queue: number[] = [0];
  let qHead = 0;
  let totalEdges = 0;

  while (qHead < queue.length) {
    const u = queue[qHead++]!;
    if (u < 0 || u >= graph.length) return false;
    const value = graph[u];
    const children: number[] = [];
    const seenChildren = new Set<number>();

    const pushChild = (item: unknown): boolean => {
      if (typeof item !== "number" || !Number.isInteger(item) || item < 0) return true;
      if (item >= graph.length) return false;
      totalEdges++;
      if (1 + totalEdges > maxNodes) return false;
      if (!seenChildren.has(item)) {
        seenChildren.add(item);
        children.push(item);
      }
      if (!visited.has(item)) {
        visited.add(item);
        if (visited.size > maxNodes) return false;
        queue.push(item);
      }
      return true;
    };

    if (Array.isArray(value)) {
      if (value.length > maxNodes) return false;
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
        if (!Number.isSafeInteger(value[1]) || Number(value[1]) < 0 || Number(value[1]) > maxNodes) return false;
        start = 3;
        step = 2;
      }
      if (tag !== "Date") {
        for (let index = start; index < end; index += step) {
          if (!pushChild(value[index])) return false;
        }
      }
    } else if (isRecord(value)) {
      let propCount = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (++propCount > maxNodes) return false;
        if (!pushChild(value[key])) return false;
      }
    }
    adj.set(u, children);
  }

  // Compute SCCs via iterative Tarjan's algorithm so DAG longest-path depth runs
  // in O(V + E) without shallow aliases masking deeper paths or exponential blowup.
  let nextIndex = 0;
  const indices = new Map<number, number>();
  const lowlink = new Map<number, number>();
  const onStack = new Set<number>();
  const tarjanStack: number[] = [];
  const sccs: number[][] = [];
  const dfsStack: Array<{ node: number; edgeIdx: number }> = [{ node: 0, edgeIdx: 0 }];

  while (dfsStack.length) {
    const frame = dfsStack[dfsStack.length - 1]!;
    const u = frame.node;
    if (!indices.has(u)) {
      indices.set(u, nextIndex);
      lowlink.set(u, nextIndex);
      nextIndex++;
      tarjanStack.push(u);
      onStack.add(u);
    }
    const neighbors = adj.get(u) ?? [];
    if (frame.edgeIdx < neighbors.length) {
      const v = neighbors[frame.edgeIdx++]!;
      if (!indices.has(v)) {
        dfsStack.push({ node: v, edgeIdx: 0 });
      } else if (onStack.has(v)) {
        lowlink.set(u, Math.min(lowlink.get(u)!, indices.get(v)!));
      }
    } else {
      dfsStack.pop();
      if (dfsStack.length > 0) {
        const parent = dfsStack[dfsStack.length - 1]!.node;
        lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(u)!));
      }
      if (lowlink.get(u) === indices.get(u)) {
        const comp: number[] = [];
        for (;;) {
          const w = tarjanStack.pop()!;
          onStack.delete(w);
          comp.push(w);
          if (w === u) break;
        }
        sccs.push(comp);
      }
    }
  }

  // Tarjan emits SCCs in reverse topological order; walk forward from root 0.
  const depth = new Map<number, number>([[0, 0]]);
  for (let s = sccs.length - 1; s >= 0; s--) {
    const comp = sccs[s]!;
    if (comp.length === 1) {
      const u = comp[0]!;
      const d = depth.get(u) ?? 0;
      if (d > maxDepth) return false;
      for (const v of adj.get(u) ?? []) {
        const nextDepth = d + 1;
        if (nextDepth > maxDepth) return false;
        if (v !== u && nextDepth > (depth.get(v) ?? -1)) {
          depth.set(v, nextDepth);
        }
      }
      continue;
    }

    const compSet = new Set(comp);
    let entryDepth = 0;
    for (const u of comp) entryDepth = Math.max(entryDepth, depth.get(u) ?? 0);
    // Conservatively bound every simple path through a cycle, including the
    // edge that closes it. Shortest paths cannot prove a depth limit here.
    const nextDepth = entryDepth + comp.length;
    if (nextDepth > maxDepth) return false;
    for (const u of comp) {
      for (const v of adj.get(u) ?? []) {
        if (!compSet.has(v) && nextDepth > (depth.get(v) ?? -1)) depth.set(v, nextDepth);
      }
    }
  }
  return true;
}
