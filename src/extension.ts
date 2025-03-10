// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { parseAsync } from "oxc-parser";
import * as t from "@oxc-project/types";
import * as esquery from "esquery";
import { debounce } from "lodash";

const SUPPORTED_LANGUAGES = ["typescript", "typescriptreact"];

const astCache = new Map<string, Promise<t.CallExpression[]>>();
const buildASTCache = async (document: vscode.TextDocument) => {
  const documentContent = document.getText(
    new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(
        document.lineCount,
        document.lineAt(document.lineCount - 1).text.length
      )
    )
  );
  const parsed = await parseAsync(document.fileName, documentContent);
  const callExprs = [
    ...esquery.query(
      parsed.program as unknown as any,
      'CallExpression[callee.name="$api"]'
    ),
    ...esquery.query(
      parsed.program as unknown as any,
      'CallExpression[callee.property.name="$api"]'
    ),
  ];

  return callExprs as t.CallExpression[];
};
async function getDocumentAPICalls(document: vscode.TextDocument) {
  let callExpressions = await astCache.get(document.uri.path);
  if (!callExpressions?.length) {
    const promise = buildASTCache(document);
    astCache.set(document.uri.path, promise);
    callExpressions = await promise;
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

export function deactivate(context: vscode.ExtensionContext): undefined {
  console.log("Deactivated Extension");
  return undefined;
}

class LocaleDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
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

    const callExpressions = await getDocumentAPICalls(document);
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
      const prop = config.properties
        .map((el) =>
          el.type === "Property" &&
          el.key.type === "Identifier" &&
          el.key.name === "method" &&
          el.value.type === "Literal" &&
          typeof el.value.value === "string"
            ? el.value.value
            : null
        )
        .filter(Boolean)[0];

      method = prop?.toLowerCase() || method;
    }

    let glob: string = "";
    let filter = (uri: vscode.Uri) => true;
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
