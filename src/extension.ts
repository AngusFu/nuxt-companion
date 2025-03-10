// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { parseSync } from "@oxc-parser/wasm";
import * as t from "@oxc-project/types";
import * as esquery from "esquery";
import { debounce } from "lodash-es";

const eQuery = (node: t.Span, selector: string) =>
  esquery.query(node as any, selector);
const SUPPORTED_LANGUAGES = ["typescript", "typescriptreact"];

const astCache = new Map<string, t.CallExpression[]>();
const buildASTCache = (document: vscode.TextDocument) => {
  const documentContent = document.getText(
    new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(
        document.lineCount,
        document.lineAt(document.lineCount - 1).text.length
      )
    )
  );
  const parsed = parseSync(documentContent, {
    sourceFilename: document.uri.path,
  });
  const callExprs = [
    ...eQuery(
      parsed.program as unknown as any,
      'CallExpression[callee.name="$api"]'
    ),
    ...eQuery(
      parsed.program as unknown as any,
      'CallExpression[callee.property.name="$api"]'
    ),
  ];

  return callExprs as t.CallExpression[];
};

function getDocumentAPICalls(document: vscode.TextDocument) {
  let callExpressions = astCache.get(document.uri.path);
  if (!callExpressions?.length) {
    const ast = buildASTCache(document);
    astCache.set(document.uri.path, ast);
    callExpressions = ast;
  }
  return callExpressions;
}

export function activate(context: vscode.ExtensionContext) {
  const onDocumentChange = debounce(
    (document: vscode.TextDocument) => {
      astCache.delete(document.uri.path);
      astCache.set(document.uri.path, buildASTCache(document));
    },
    1000,
    {
      leading: true,
      trailing: true,
    }
  );

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      SUPPORTED_LANGUAGES,
      new LocaleDefinitionProvider()
    ),

    // 文档关闭
    vscode.workspace.onDidCloseTextDocument((document) => {
      astCache.delete(document.uri.path);
    }),
    // 监听文档内容变化
    vscode.workspace.onDidChangeTextDocument(async ({ document }) => {
      if (
        SUPPORTED_LANGUAGES.includes(document.languageId) ||
        /\.tsx?$/.test(document.uri.path)
      ) {
        onDocumentChange(document);
      }
    })
  );
}

class LocaleDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    cancelToken: vscode.CancellationToken
  ) {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (!folder) return null;

    const serverFolder = vscode.Uri.joinPath(folder, "server");
    if (document.uri.fsPath.startsWith(serverFolder.fsPath)) return null;

    // 插值情况忽略
    if (document.getWordRangeAtPosition(position, /\$\{\s*\w+\s*\}/)) {
      return null;
    }

    const quotedRange = document.getWordRangeAtPosition(
      position,
      /((['"])(?:(?!\2).)*\2|`(?:[^`\\]|\\.)*`)/
    );
    if (!quotedRange) return null;

    const callExpressions = getDocumentAPICalls(document);
    const expr = (callExpressions || []).find((el) => {
      const range = new vscode.Range(
        document.positionAt(el.start),
        document.positionAt(el.end)
      );
      return range.contains(quotedRange);
    });
    if (!expr?.arguments.length) return null;

    const path = expr.arguments[0];
    const config = expr.arguments[1];

    let method = "get";
    if (config && config.type === "ObjectExpression") {
      const res = eQuery(
        config,
        'Property[key.name="method"]>Literal'
      )?.[0] as t.StringLiteral;
      method = res?.value.toLowerCase() || "get";
    }

    let glob = "";
    let filter = (uri: vscode.Uri) => !!uri;
    if (path.type === "Literal" && typeof path.value === "string") {
      glob = path.value.replace(/^\//, "");
    } else if (path.type === "TemplateLiteral") {
      glob = path.quasis
        .map((el) => el.value.raw)
        .join("*")
        .replace(/^\//, "");
      const regex = RegExp(glob.replace(/\*/g, () => "\\[.+\\]"));
      filter = (uri: vscode.Uri) => regex.test(uri.path);
    }
    if (!glob) return null;

    if (cancelToken.isCancellationRequested) return null;
    const files = (
      await Promise.all(
        [`${glob}.${method}.ts`, `${glob}/index.${method}.ts`].map((pattern) =>
          vscode.workspace.findFiles(
            new vscode.RelativePattern(serverFolder, pattern)
          )
        )
      )
    )
      .flat()
      .filter(filter);

    if (files[0]) {
      const targetRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(0, 0)
      );
      const targetLoc = new vscode.Location(files[0], targetRange);
      const locationLinks: vscode.LocationLink[] = [
        {
          targetUri: targetLoc.uri,
          targetRange: targetRange,
          originSelectionRange: quotedRange,
        },
      ];

      return locationLinks;
    }

    return null;
  }
}
