// VS Code API
import * as vscode from "vscode";

// Third-party libraries
import { parseSync } from "@oxc-parser/wasm";
import * as t from "@oxc-project/types";
import * as esquery from "esquery";

// Local modules
import { POWERED_BY_INFO } from "../utils/constants";
import {
  BaseCollector,
  BaseDefinitionProvider,
  BaseHoverProvider,
  FileChangeEvent,
} from "./base";

const eQuery = (node: t.Span, selector: string) =>
  esquery.query(node as any, selector);
const SUPPORTED_LANGUAGES = ["typescript", "typescriptreact"];

interface APICallInfo {
  glob: string;
  method: string;
  filter: (uri: vscode.Uri) => boolean;
}

class APICollector extends BaseCollector<APICallInfo> {
  private astCache = new Map<string, t.CallExpression[]>();

  constructor(workspaceUri: vscode.Uri) {
    super(workspaceUri, "**/*.{ts,tsx}");
  }

  protected async buildDataMap(
    token?: vscode.CancellationToken,
    event?: FileChangeEvent
  ): Promise<void> {
    // 这个collector比较特殊，它不需要主动收集数据
    // 而是在provideDefinition和provideHover时动态收集
    if (event) {
      if (token?.isCancellationRequested) return;

      // 当文件变化时，更新AST缓存
      const document = await vscode.workspace.openTextDocument(event.uri);
      if (token?.isCancellationRequested) return;

      this.astCache.set(event.uri.path, this.buildASTCache(document));
    }
  }

  private buildASTCache(document: vscode.TextDocument) {
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
    const cloned = JSON.parse(parsed.programJson);
    parsed.free();
    const callExprs = [
      ...eQuery(cloned as unknown as any, 'CallExpression[callee.name="$api"]'),
      ...eQuery(
        cloned as unknown as any,
        'CallExpression[callee.property.name="$api"]'
      ),
    ];

    return callExprs as t.CallExpression[];
  }

  public getDocumentAPICalls(
    document: vscode.TextDocument,
    token?: vscode.CancellationToken
  ) {
    let callExpressions = this.astCache.get(document.uri.path);
    if (!callExpressions?.length) {
      if (token?.isCancellationRequested) return [];

      const ast = this.buildASTCache(document);
      if (token?.isCancellationRequested) return [];

      this.astCache.set(document.uri.path, ast);
      callExpressions = ast;
    }
    return callExpressions;
  }

  public getAPICallInfo(
    document: vscode.TextDocument,
    position: vscode.Position,
    token?: vscode.CancellationToken
  ): { info: APICallInfo; range: vscode.Range } | null {
    if (token?.isCancellationRequested) return null;

    const quotedRange = document.getWordRangeAtPosition(
      position,
      /((['"])(?:(?!\2).)*\2|`(?:[^`\\]|\\.)*`)/
    );
    if (!quotedRange) return null;

    const callExpressions = this.getDocumentAPICalls(document, token);
    if (token?.isCancellationRequested) return null;

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

    return {
      info: { glob, method, filter },
      range: quotedRange,
    };
  }

  public dispose() {
    super.dispose();
    this.astCache.clear();
  }

  public async findAPIFiles(
    folder: vscode.Uri,
    glob: string,
    method: string,
    filter: (uri: vscode.Uri) => boolean,
    token?: vscode.CancellationToken
  ): Promise<vscode.Uri[]> {
    const serverFolder = vscode.Uri.joinPath(folder, "server");
    const patterns = [`${glob}.${method}.ts`, `${glob}/index.${method}.ts`];

    return new Promise(async (resolve) => {
      const files = (
        await Promise.all(
          patterns.map(async (pattern) => {
            if (token?.isCancellationRequested) {
              resolve([]);
              return [];
            }

            return vscode.workspace.findFiles(
              new vscode.RelativePattern(serverFolder, pattern),
              null,
              1,
              token
            );
          })
        )
      )
        .flat()
        .filter(filter);

      resolve(files);
    });
  }
}

class APIHoverProvider extends BaseHoverProvider<APICallInfo> {
  constructor(collector: APICollector) {
    super(collector);
  }

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (!folder) return null;

    const serverFolder = vscode.Uri.joinPath(folder, "server");
    if (document.uri.fsPath.startsWith(serverFolder.fsPath)) return null;

    const apiInfo = (this.collector as APICollector).getAPICallInfo(
      document,
      position,
      token
    );
    if (!apiInfo) return null;

    const files = await (this.collector as APICollector).findAPIFiles(
      folder,
      apiInfo.info.glob,
      apiInfo.info.method,
      apiInfo.info.filter,
      token
    );

    if (files[0]) {
      return new vscode.Hover(
        new vscode.MarkdownString(
          `Probably refers to the **API endpoint**: [${apiInfo.info.glob}](${
            files[0]
          }) (${apiInfo.info.method.toUpperCase()})${POWERED_BY_INFO}`
        ),
        apiInfo.range
      );
    }

    return new vscode.Hover(
      new vscode.MarkdownString(
        `Probably refers to the **API endpoint**: \`${
          apiInfo.info.glob
        }\` (${apiInfo.info.method.toUpperCase()})${POWERED_BY_INFO}`
      ),
      apiInfo.range
    );
  }

  protected createHoverContent(
    data: APICallInfo,
    range: vscode.Range
  ): vscode.Hover {
    throw new Error("Method not implemented.");
  }
}

class APIDefinitionProvider extends BaseDefinitionProvider<APICallInfo> {
  constructor(collector: APICollector) {
    super(collector);
  }

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.DefinitionLink[] | null> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (!folder) return null;

    const serverFolder = vscode.Uri.joinPath(folder, "server");
    if (document.uri.fsPath.startsWith(serverFolder.fsPath)) return null;

    // 插值情况忽略
    if (document.getWordRangeAtPosition(position, /\$\{\s*\w+\s*\}/)) {
      return null;
    }

    const apiInfo = (this.collector as APICollector).getAPICallInfo(
      document,
      position,
      token
    );
    if (!apiInfo) return null;

    if (token.isCancellationRequested) return null;
    const files = await (this.collector as APICollector).findAPIFiles(
      folder,
      apiInfo.info.glob,
      apiInfo.info.method,
      apiInfo.info.filter,
      token
    );
    if (token.isCancellationRequested) return null;

    if (files[0]) {
      return [
        {
          targetUri: files[0],
          targetRange: new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, 0)
          ),
          originSelectionRange: apiInfo.range,
        },
      ];
    }

    return null;
  }

  protected createDefinitionLinks(
    data: APICallInfo,
    range: vscode.Range
  ): vscode.DefinitionLink[] {
    throw new Error("Method not implemented.");
  }
}

export function activate(
  context: vscode.ExtensionContext,
  disposeEffects: vscode.Disposable[]
) {
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceUri) return;

  const collector = new APICollector(workspaceUri);
  const hoverProvider = vscode.languages.registerHoverProvider(
    SUPPORTED_LANGUAGES,
    new APIHoverProvider(collector)
  );
  const defProvider = vscode.languages.registerDefinitionProvider(
    SUPPORTED_LANGUAGES,
    new APIDefinitionProvider(collector)
  );

  // 监听文档内容变化
  const onDocumentChange = vscode.workspace.onDidChangeTextDocument(
    ({ document }) => {
      if (
        SUPPORTED_LANGUAGES.includes(document.languageId) ||
        /\.tsx?$/.test(document.uri.path)
      ) {
        collector.getDocumentAPICalls(document);
      }
    }
  );

  disposeEffects.push(hoverProvider, defProvider, onDocumentChange, {
    dispose: () => {
      collector.dispose();
    },
  });
}
