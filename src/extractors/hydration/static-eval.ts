import { isRecord } from "../../values";

export type AstNode = { type: string; [key: string]: unknown };

export function isAstNode(value: unknown): value is AstNode {
  return isRecord(value) && typeof value.type === "string";
}

export function assignmentName(node: AstNode): string | undefined {
  if (node.type === "Identifier" && typeof node.name === "string") return String(node.name);
  if (node.type !== "MemberExpression" || node.computed) return undefined;
  const property = node.property as AstNode;
  const propertyName = property.type === "Identifier" ? String(property.name) : undefined;
  const object = node.object as AstNode;
  if (object.type === "Identifier" && object.name === "window" && propertyName) {
    return ["qtLoadedData", "qtData", "qt"].includes(propertyName) ? `window.${propertyName}` : propertyName;
  }
  if (object.type === "Identifier" && object.name === "Fusion" && propertyName === "globalContent") return "Fusion.globalContent";
  return undefined;
}

export function evaluateStatic(node: AstNode, env: Map<string, unknown>, depth = 0): unknown {
  if (depth > 128) throw new Error("Static initializer depth exceeded");
  switch (node.type) {
    case "Literal": return node.value;
    case "Identifier":
      if (node.name === "undefined") return undefined;
      if (env.has(String(node.name))) return env.get(String(node.name));
      throw new Error("Unsupported identifier");
    case "ArrayExpression":
      return (node.elements as Array<AstNode | null>).map((item) => item ? evaluateStatic(item, env, depth + 1) : null);
    case "ObjectExpression": {
      const result: Record<string, unknown> = {};
      for (const property of node.properties as AstNode[]) {
        if (property.type !== "Property" || property.kind !== "init" || property.computed) throw new Error("Unsupported property");
        const keyNode = property.key as AstNode;
        const key = keyNode.type === "Identifier" ? String(keyNode.name) : String(keyNode.value);
        if (key !== "__proto__") result[key] = evaluateStatic(property.value as AstNode, env, depth + 1);
      }
      return result;
    }
    case "UnaryExpression": {
      const value = evaluateStatic(node.argument as AstNode, env, depth + 1);
      if (node.operator === "void") return undefined;
      if (node.operator === "-") return -Number(value);
      if (node.operator === "+") return Number(value);
      if (node.operator === "!") return !value;
      throw new Error("Unsupported unary expression");
    }
    case "CallExpression": {
      const callee = node.callee as AstNode;
      if (callee.type === "MemberExpression" && (callee.object as AstNode).type === "Identifier" &&
        (callee.object as AstNode).name === "JSON" && (callee.property as AstNode).name === "parse") {
        const args = node.arguments as AstNode[];
        if (args.length !== 1) throw new Error("Unsupported JSON.parse arguments");
        const serialized = evaluateStatic(args[0], env, depth + 1);
        if (typeof serialized !== "string") throw new Error("Unsupported JSON.parse value");
        return JSON.parse(serialized);
      }
      if (callee.type !== "FunctionExpression" && callee.type !== "ArrowFunctionExpression") throw new Error("Unsupported call");
      const args = (node.arguments as AstNode[]).map((arg) => evaluateStatic(arg, env, depth + 1));
      const local = new Map(env);
      (callee.params as AstNode[]).forEach((param, index) => {
        if (param.type !== "Identifier") throw new Error("Unsupported parameter");
        local.set(String(param.name), args[index]);
      });
      const body = callee.body as AstNode;
      if (body.type === "ObjectExpression" || body.type === "ArrayExpression") return evaluateStatic(body, local, depth + 1);
      if (body.type !== "BlockStatement") throw new Error("Unsupported function body");
      const statements = body.body as AstNode[];
      if (statements.length !== 1 || statements[0].type !== "ReturnStatement" || !statements[0].argument) throw new Error("Unsupported function body");
      return evaluateStatic(statements[0].argument as AstNode, local, depth + 1);
    }
    default: throw new Error("Unsupported static expression");
  }
}
