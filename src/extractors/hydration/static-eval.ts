import { isRecord } from "../../values";

export type AstNode = { type: string; [key: string]: unknown };
export type StaticEvalBudget = { nodes: number; maxNodes: number; maxDepth: number };

export class StaticEvalLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaticEvalLimitError";
  }
}

const GLOBAL_RECEIVERS = new Set(["window", "globalThis", "self"]);
const QUINTYPE_GLOBALS = new Set(["qtLoadedData", "qtData", "qt"]);

export function isAstNode(value: unknown): value is AstNode {
  return isRecord(value) && typeof value.type === "string";
}

export function assignmentName(node: AstNode): string | undefined {
  if (node.type === "Identifier" && typeof node.name === "string") return String(node.name);
  if (node.type !== "MemberExpression" || node.computed) return undefined;
  const property = node.property as AstNode;
  const propertyName = property.type === "Identifier" ? String(property.name) : undefined;
  if (!propertyName) return undefined;
  const object = node.object as AstNode;
  if (object.type === "Identifier" && typeof object.name === "string") {
    if (GLOBAL_RECEIVERS.has(object.name)) {
      return QUINTYPE_GLOBALS.has(propertyName) ? `${object.name}.${propertyName}` : propertyName;
    }
    if (object.name === "Fusion" && propertyName === "globalContent") return "Fusion.globalContent";
  }
  if (
    object.type === "MemberExpression" &&
    !object.computed &&
    propertyName === "globalContent" &&
    (object.object as AstNode).type === "Identifier" &&
    GLOBAL_RECEIVERS.has(String((object.object as AstNode).name)) &&
    (object.property as AstNode).type === "Identifier" &&
    (object.property as AstNode).name === "Fusion"
  ) {
    return "Fusion.globalContent";
  }
  return undefined;
}

export function evaluateStatic(
  node: AstNode,
  env: Map<string, unknown>,
  depth = 0,
  budget?: StaticEvalBudget,
): unknown {
  const maxDepth = budget?.maxDepth ?? 128;
  if (depth > maxDepth) throw new StaticEvalLimitError("Hydration depth limit exceeded");
  if (budget && ++budget.nodes > budget.maxNodes) {
    throw new StaticEvalLimitError("Hydration traversal limit exceeded");
  }
  switch (node.type) {
    case "Literal":
      return node.value;
    case "TemplateLiteral": {
      const expressions = node.expressions as AstNode[];
      if (expressions.length !== 0) throw new Error("Unsupported template literal");
      const cooked = ((node.quasis as AstNode[])[0]?.value as { cooked?: unknown } | undefined)?.cooked;
      if (typeof cooked !== "string") throw new Error("Unsupported template literal");
      return cooked;
    }
    case "Identifier":
      if (env.has(String(node.name))) return env.get(String(node.name));
      if (node.name === "undefined") return undefined;
      if (node.name === "NaN") return Number.NaN;
      if (node.name === "Infinity") return Number.POSITIVE_INFINITY;
      throw new Error("Unsupported identifier");
    case "ArrayExpression":
      return (node.elements as Array<AstNode | null>).map((item) =>
        item ? evaluateStatic(item, env, depth + 1, budget) : null,
      );
    case "ObjectExpression": {
      const result: Record<string, unknown> = {};
      for (const property of node.properties as AstNode[]) {
        if (property.type !== "Property" || property.kind !== "init" || property.computed)
          throw new Error("Unsupported property");
        const keyNode = property.key as AstNode;
        const key = keyNode.type === "Identifier" ? String(keyNode.name) : String(keyNode.value);
        if (key !== "__proto__") result[key] = evaluateStatic(property.value as AstNode, env, depth + 1, budget);
      }
      return result;
    }
    case "UnaryExpression": {
      const value = evaluateStatic(node.argument as AstNode, env, depth + 1, budget);
      if (node.operator === "void") return undefined;
      if (node.operator === "-") return -Number(value);
      if (node.operator === "+") return Number(value);
      if (node.operator === "!") return !value;
      throw new Error("Unsupported unary expression");
    }
    case "NewExpression": {
      const callee = node.callee as AstNode;
      if (callee.type !== "Identifier" || callee.name !== "Date" || env.has("Date")) {
        throw new Error("Unsupported new expression");
      }
      const args = (node.arguments as AstNode[]).map((arg) => evaluateStatic(arg, env, depth + 1, budget));
      let date: Date | undefined;
      if (args.length === 1 && (typeof args[0] === "string" || typeof args[0] === "number")) {
        date = new Date(args[0]);
      } else if (args.length >= 2 && args.length <= 7 && args.every((arg): arg is number => typeof arg === "number")) {
        const [year, month, day = 1, hours = 0, minutes = 0, seconds = 0, ms = 0] = args;
        date = new Date(year, month, day, hours, minutes, seconds, ms);
      }
      return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
    }
    case "CallExpression": {
      const callee = node.callee as AstNode;
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        (callee.object as AstNode).type === "Identifier" &&
        (callee.object as AstNode).name === "JSON" &&
        !env.has("JSON") &&
        (callee.property as AstNode).type === "Identifier" &&
        (callee.property as AstNode).name === "parse"
      ) {
        const args = node.arguments as AstNode[];
        if (args.length !== 1) throw new Error("Unsupported JSON.parse arguments");
        const serialized = evaluateStatic(args[0], env, depth + 1, budget);
        if (typeof serialized !== "string") throw new Error("Unsupported JSON.parse value");
        return JSON.parse(serialized);
      }
      if (callee.type !== "FunctionExpression" && callee.type !== "ArrowFunctionExpression")
        throw new Error("Unsupported call");
      const args = (node.arguments as AstNode[]).map((arg) => evaluateStatic(arg, env, depth + 1, budget));
      const local = new Map(env);
      (callee.params as AstNode[]).forEach((param, index) => {
        if (param.type !== "Identifier") throw new Error("Unsupported parameter");
        local.set(String(param.name), args[index]);
      });
      const body = callee.body as AstNode;
      if (body.type === "ObjectExpression" || body.type === "ArrayExpression")
        return evaluateStatic(body, local, depth + 1, budget);
      if (body.type !== "BlockStatement") throw new Error("Unsupported function body");
      const statements = body.body as AstNode[];
      if (statements.length !== 1 || statements[0].type !== "ReturnStatement" || !statements[0].argument)
        throw new Error("Unsupported function body");
      return evaluateStatic(statements[0].argument as AstNode, local, depth + 1, budget);
    }
    default:
      throw new Error("Unsupported static expression");
  }
}
