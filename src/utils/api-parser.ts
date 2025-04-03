import * as t from "@oxc-project/types";
import * as esquery from "esquery";
import * as vscode from "vscode";
import { typeAssertions as ta } from "./type-assertions";

const eQuery = (node: t.Span, selector: string) =>
  esquery.query(node as any, selector);

export type APICallInfo = {
  glob: string;
  regex: RegExp;
  method: string;
  filter: (uri: vscode.Uri | string) => boolean;
};

function isHTTPMethod(name: string): boolean {
  return /^(get|post|put|delete|patch|head|options)$/i.test(name);
}

const findMethodNode = (expr: t.ObjectExpression | null) => {
  if (!expr) return null;

  const node = expr.properties.find(
    (el): el is t.ObjectProperty =>
      ta.isObjectProperty(el) &&
      ta.isIdentifierName(el.key) &&
      el.key.name === "method"
  );
  if (!node) return null;
  return ta.isStringLiteral(node.value) ? node.value : null;
};

const findPathNode = (
  expr: t.ObjectExpression | null
): t.StringLiteral | t.TemplateLiteral | null => {
  if (!expr) return null;

  for (const name of ["path", "url", "uri", "api", "endpoint"]) {
    for (const el of expr.properties) {
      if (
        ta.isObjectProperty(el) &&
        ta.isIdentifierName(el.key) &&
        el.key.name === name
      ) {
        if (ta.isStringLiteral(el.value)) {
          return el.value;
        }
        if (ta.isTemplateLiteral(el.value)) {
          return el.value;
        }
      }
    }
  }
  return null;
};

export function processCallExpression(
  el: t.CallExpression
): APICallInfo | null {
  let path = "";
  let method = "get";
  let pathNode: t.StringLiteral | t.TemplateLiteral | null = null;
  let maybeConfig: t.ObjectExpression | null = null;

  if (
    ta.isMemberExpression(el.callee) &&
    ta.isIdentifierName(el.callee.object) &&
    ta.isIdentifierName(el.callee.property) &&
    isHTTPMethod(el.callee.property.name)
  ) {
    method = el.callee.property.name;
  }

  const [firstArg, secondArg, thirdArg] = el.arguments;

  if (ta.isObjectExpression(firstArg)) {
    maybeConfig = firstArg;
  } else if (ta.isStringLiteral(firstArg) || ta.isTemplateLiteral(firstArg)) {
    pathNode = firstArg as t.StringLiteral | t.TemplateLiteral;
    if (ta.isObjectExpression(secondArg) && !ta.isObjectExpression(thirdArg)) {
      maybeConfig = secondArg;
    } else if (ta.isObjectExpression(thirdArg)) {
      maybeConfig = thirdArg;
    }
  }

  if (maybeConfig) {
    method = findMethodNode(maybeConfig)?.value || method;
    pathNode = findPathNode(maybeConfig) || pathNode;
  }
  if (!pathNode) return null;

  if (pathNode.type === "TemplateLiteral" && pathNode.quasis) {
    const quasis = pathNode.quasis;
    path = quasis.map((el) => el.value.raw).join("*");
  } else if (pathNode.type === "Literal") {
    path = pathNode.value || "";
  }
  if (path.indexOf("/") < 0) return null;

  let glob = path.replace(/^\//, "");
  const regex = RegExp(glob.replace(/\*/g, () => "\\[.+\\]"));
  const filter = (uri: vscode.Uri | string) =>
    regex.test(typeof uri === "string" ? uri : uri.path);

  return {
    glob,
    regex,
    filter,
    method: (method || "get").toLowerCase(),
  };
}
