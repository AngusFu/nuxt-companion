// VS Code API
import * as vscode from "vscode";

// Third-party libraries
import { relative, resolve } from "path";
import { globby } from "globby";
import { basename, dirname, extname, normalize } from "pathe";
import { kebabCase, splitByCase } from "scule";
import { withTrailingSlash } from "ufo";

// Local modules
import { POWERED_BY_INFO } from "../utils/constants";
import { BaseCollector, BaseDefinitionProvider, BaseHoverProvider, FileChangeEvent } from "./base";

interface LayoutInfo {
  name: string;
  file: string;
}

const QUOTE_RE = /["']/g;
function getNameFromPath(path: string, relativeTo?: string) {
  const relativePath = relativeTo
    ? normalize(path).replace(withTrailingSlash(normalize(relativeTo)), "")
    : basename(path);
  const prefixParts = splitByCase(dirname(relativePath));
  const fileName = basename(relativePath, extname(relativePath));
  const segments = resolveComponentNameSegments(
    fileName.toLowerCase() === "index" ? "" : fileName,
    prefixParts
  ).filter(Boolean);
  return kebabCase(segments).replace(QUOTE_RE, "");
}

function resolveComponentNameSegments(fileName: string, prefixParts: string[]) {
  /**
   * Array of fileName parts split by case, / or -
   * @example third-component -> ['third', 'component']
   * @example AwesomeComponent -> ['Awesome', 'Component']
   */
  const fileNameParts = splitByCase(fileName);
  const fileNamePartsContent = fileNameParts.join("/").toLowerCase();
  const componentNameParts: string[] = prefixParts.flatMap((p) =>
    splitByCase(p)
  );
  let index = prefixParts.length - 1;
  const matchedSuffix: string[] = [];
  while (index >= 0) {
    const prefixPart = prefixParts[index]!;
    matchedSuffix.unshift(
      ...splitByCase(prefixPart).map((p) => p.toLowerCase())
    );
    const matchedSuffixContent = matchedSuffix.join("/");
    if (
      fileNamePartsContent === matchedSuffixContent ||
      fileNamePartsContent.startsWith(matchedSuffixContent + "/") ||
      // e.g Item/Item/Item.vue -> Item
      (prefixPart.toLowerCase() === fileNamePartsContent &&
        prefixParts[index + 1] &&
        prefixParts[index] === prefixParts[index + 1])
    ) {
      componentNameParts.length = index;
    }
    index--;
  }
  return [...componentNameParts, ...fileNameParts];
}

class LayoutsCollector extends BaseCollector<LayoutInfo> {
  constructor(workspaceUri: vscode.Uri) {
    super(workspaceUri, "layouts/**/*.vue");
  }

  protected async buildDataMap(
    token?: vscode.CancellationToken,
    event?: FileChangeEvent
  ): Promise<void> {
    const srcDir = this.workspaceUri.fsPath;
    if (!srcDir) return;

    if (token?.isCancellationRequested) return;

    const layoutDir = "layouts";
    const layoutFiles = await globby(`${layoutDir}/**/*.vue`, {
      cwd: srcDir,
      absolute: true,
    });

    if (token?.isCancellationRequested) return;

    this.dataMap.clear();
    for (const file of layoutFiles) {
      if (token?.isCancellationRequested) return;

      const name = this.getNameFromPath(file, resolve(srcDir, layoutDir));
      this.dataMap.set(name, { name, file });
    }
  }

  public getNameFromPath(filePath: string, baseDir: string): string {
    const relativePath = relative(baseDir, filePath);
    const name = relativePath
      .replace(/\.vue$/, "")
      .replace(/\//g, "-")
      .toLowerCase();
    return name;
  }

  public getLayoutInfo(
    document: vscode.TextDocument,
    position: vscode.Position,
    token?: vscode.CancellationToken
  ): { info: LayoutInfo; range: vscode.Range } | null {
    if (token?.isCancellationRequested) return null;

    const quotedRange = document.getWordRangeAtPosition(
      position,
      /((['"])(?:(?!\2).)*\2|`(?:[^`\\]|\\.)*`)/
    );
    if (!quotedRange) return null;

    const name = document.getText(quotedRange).slice(1, -1);
    const info = this.dataMap.get(name);
    if (!info) return null;

    return { info, range: quotedRange };
  }
}

class LayoutsHoverProvider extends BaseHoverProvider<LayoutInfo> {
  constructor(collector: LayoutsCollector) {
    super(collector);
  }

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (!folder) return null;

    const layoutInfo = (this.collector as LayoutsCollector).getLayoutInfo(
      document,
      position,
      token
    );
    if (!layoutInfo) return null;

    const files = await this.findLayoutFiles(
      folder,
      layoutInfo.info.name,
      token
    );

    if (files[0]) {
      return new vscode.Hover(
        new vscode.MarkdownString(
          `Probably refers to the **layout**: [${layoutInfo.info.name}](${
            files[0]
          })${POWERED_BY_INFO}`
        ),
        layoutInfo.range
      );
    }

    return new vscode.Hover(
      new vscode.MarkdownString(
        `Probably refers to the **layout**: \`${
          layoutInfo.info.name
        }\`${POWERED_BY_INFO}`
      ),
      layoutInfo.range
    );
  }

  private async findLayoutFiles(
    folder: vscode.Uri,
    name: string,
    token?: vscode.CancellationToken
  ): Promise<vscode.Uri[]> {
    const layoutDir = vscode.Uri.joinPath(folder, "layouts");
    const patterns = [
      `${name}.vue`,
      `${name.replace(/-/g, "/")}.vue`,
      `${name.replace(/-/g, "/")}/index.vue`,
    ];

    return new Promise(async (resolve) => {
      const files = (
        await Promise.all(
          patterns.map(async (pattern) => {
            if (token?.isCancellationRequested) {
              resolve([]);
              return [];
            }

            return vscode.workspace.findFiles(
              new vscode.RelativePattern(layoutDir, pattern),
              null,
              1,
              token
            );
          })
        )
      ).flat();

      resolve(files);
    });
  }

  protected createHoverContent(
    data: LayoutInfo,
    range: vscode.Range
  ): vscode.Hover {
    throw new Error("Method not implemented.");
  }
}

class LayoutsDefinitionProvider extends BaseDefinitionProvider<LayoutInfo> {
  constructor(collector: LayoutsCollector) {
    super(collector);
  }

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.DefinitionLink[] | null> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (!folder) return null;

    const layoutInfo = (this.collector as LayoutsCollector).getLayoutInfo(
      document,
      position,
      token
    );
    if (!layoutInfo) return null;

    if (token.isCancellationRequested) return null;
    const files = await this.findLayoutFiles(
      folder,
      layoutInfo.info.name,
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
          originSelectionRange: layoutInfo.range,
        },
      ];
    }

    return null;
  }

  private async findLayoutFiles(
    folder: vscode.Uri,
    name: string,
    token?: vscode.CancellationToken
  ): Promise<vscode.Uri[]> {
    const layoutDir = vscode.Uri.joinPath(folder, "layouts");
    const patterns = [
      `${name}.vue`,
      `${name.replace(/-/g, "/")}.vue`,
      `${name.replace(/-/g, "/")}/index.vue`,
    ];

    return new Promise(async (resolve) => {
      const files = (
        await Promise.all(
          patterns.map(async (pattern) => {
            if (token?.isCancellationRequested) {
              resolve([]);
              return [];
            }

            return vscode.workspace.findFiles(
              new vscode.RelativePattern(layoutDir, pattern),
              null,
              1,
              token
            );
          })
        )
      ).flat();

      resolve(files);
    });
  }

  protected createDefinitionLinks(
    data: LayoutInfo,
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

  const collector = new LayoutsCollector(workspaceUri);
  const hoverProvider = vscode.languages.registerHoverProvider(
    ["vue"],
    new LayoutsHoverProvider(collector)
  );
  const defProvider = vscode.languages.registerDefinitionProvider(
    ["vue"],
    new LayoutsDefinitionProvider(collector)
  );

  disposeEffects.push({
    dispose: () => {
      collector.dispose();
      hoverProvider.dispose();
      defProvider.dispose();
    },
  });
}
