import * as t from "@oxc-project/types";

// 类型断言工具集，用于检查 AST 节点的类型
export const typeAssertions = {
  isStringLiteral: (node?: t.Node): node is t.StringLiteral =>
    node?.type === "Literal" && typeof node.value === "string",
  isTemplateLiteral: (node?: t.Node): node is t.TemplateLiteral =>
    node?.type === "TemplateLiteral",
  isObjectExpression: (node?: t.Node): node is t.ObjectExpression =>
    node?.type === "ObjectExpression",
  isIdentifierName: (node?: t.Node): node is t.IdentifierName =>
    node?.type === "Identifier" && typeof node.name === "string",
  isObjectProperty: (node?: t.Node): node is t.ObjectProperty =>
    node?.type === "Property",
  isMemberExpression: (node?: t.Node): node is t.MemberExpression =>
    node?.type === "MemberExpression",
  isCallExpression: (node?: t.Node): node is t.CallExpression =>
    node?.type === "CallExpression",
};
