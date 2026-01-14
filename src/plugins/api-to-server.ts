// VS Code API
import * as vscode from "vscode";
import * as path from "path";

// Third-party libraries
import { parseSync } from "@oxc-parser/wasm";
import * as t from "@oxc-project/types";
import * as esquery from "esquery";

// Local modules
import { POWERED_BY_INFO } from "../utils/constants";
import { processCallExpression, APICallInfo } from "../utils/api-parser";
import {
  BaseCollector,
  BaseDefinitionProvider,
  BaseHoverProvider,
  FileChangeEvent,
} from "./base";
import { globbyStream } from "globby";

const eQuery = (node: t.Span, selector: string) =>
  esquery.query(node as any, selector);
const SUPPORTED_LANGUAGES = ["typescript", "typescriptreact"];

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
      ...eQuery(
        cloned as unknown as any,
        "CallExpression[arguments.length > 0]"
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
    if (!expr) return null;

    // 使用 api-parser 处理 AST
    const apiInfo = processCallExpression(expr);
    if (!apiInfo) return null;

    // 将 filter 函数适配为接受 vscode.Uri 参数
    const filter = (uri: vscode.Uri | string) => apiInfo.filter(uri);

    return {
      info: {
        glob: apiInfo.glob,
        method: apiInfo.method,
        filter,
        regex: apiInfo.regex,
      },
      range: quotedRange,
    };
  }

  public dispose() {
    super.dispose();
    this.astCache.clear();
  }

  public async findAPIFiles(
    folder: vscode.Uri,
    apiInfo: APICallInfo,
    token?: vscode.CancellationToken
  ): Promise<vscode.Uri[]> {
    if (token?.isCancellationRequested) return [];

    const { glob, method, filter } = apiInfo;
    const serverFolder = vscode.Uri.file(path.join(folder.fsPath, "server"));
    const patterns = [`${glob}.${method}.ts`, `${glob}/index.${method}.ts`];

    const stream = globbyStream(patterns, {
      cwd: serverFolder.fsPath,
      absolute: true,
    });

    for await (const path of stream) {
      if (token?.isCancellationRequested) {
        return [];
      }

      const file = path.toString();
      if (filter(vscode.Uri.file(file))) {
        return [vscode.Uri.file(file)];
      }
    }

    return [];
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

    const serverFolder = vscode.Uri.file(path.join(folder.fsPath, "server"));
    if (document.uri.fsPath.startsWith(serverFolder.fsPath)) return null;

    const apiInfo = (this.collector as APICollector).getAPICallInfo(
      document,
      position,
      token
    );
    if (!apiInfo) return null;

    const files = await (this.collector as APICollector).findAPIFiles(
      folder,
      apiInfo.info,
      token
    );

    if (files[0]) {
      const filePath =
        apiInfo.info.regex.exec(files[0].path)?.[0] || apiInfo.info.glob;

      const link = `[${filePath}](${files[0].fsPath})`;
      const method = apiInfo.info.method.toUpperCase();
      return new vscode.Hover(
        new vscode.MarkdownString(
          `Probably refers to the **API endpoint**: ${method} ${link}` +
            POWERED_BY_INFO
        ),
        apiInfo.range
      );
    }

    return null;
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

    const serverFolder = vscode.Uri.file(path.join(folder.fsPath, "server"));
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
      apiInfo.info,
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
  disposeEffects: vscode.Disposable[],
  workspaceUri: vscode.Uri
) {
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
