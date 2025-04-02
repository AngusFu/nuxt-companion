import * as vscode from "vscode";
import { basename, dirname, extname, normalize, resolve } from "pathe";
import { kebabCase, splitByCase } from "scule";
import { withTrailingSlash } from "ufo";
import { globby } from "globby";
import { POWERED_BY_INFO } from "./utils/constants";

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

// https://github.com/nuxt/nuxt/blob/2a1e192bced0e85faa2dff93df5f4910799e80b6/packages/nuxt/src/core/app.ts#L158
async function getLayoutsInfo() {
  const layouts: Record<string, { name: string; file: string }> = {};

  const srcDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!srcDir) {
    return layouts;
  }

  const layoutDir = "layouts";
  const layoutFiles = await globby(`${layoutDir}/**/*.vue`, {
    cwd: srcDir,
    absolute: true,
  });

  for (const file of layoutFiles) {
    const name = getNameFromPath(file, resolve(srcDir, layoutDir));

    layouts[name] ||= { name, file };
  }

  return layouts;
}

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) return;

  // watch layouts dir and update layouts info
  // create fs watcher
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, "layouts/**/*.vue")
  );
  let layoutsInfo: Record<string, { name: string; file: string }> = {};
  watcher.onDidCreate(async (e) => {
    layoutsInfo = await getLayoutsInfo();
  });
  watcher.onDidChange(async (e) => {
    layoutsInfo = await getLayoutsInfo();
  });
  watcher.onDidDelete(async (e) => {
    layoutsInfo = await getLayoutsInfo();
  });
  getLayoutsInfo().then((layouts) => {
    layoutsInfo = layouts;
  });
  context.subscriptions.push(watcher);

  const processLayoutAttr = async (
    document: vscode.TextDocument,
    pos: vscode.Position
  ) => {
    const quotedRange = document.getWordRangeAtPosition(pos, /['"][\w-]+['"]/);
    if (!quotedRange) return null;

    const attrRange = document.getWordRangeAtPosition(
      pos,
      /name=['"][\w-]+['"]/
    );
    if (!attrRange) return null;

    // check closets `<NuxtLayout`
    const text = document
      .getText()
      .slice(0, document.offsetAt(attrRange.start));
    let nearestNuxtLayout = text.lastIndexOf("<NuxtLayout");
    if (nearestNuxtLayout < 0) {
      nearestNuxtLayout = text.lastIndexOf("<nuxt-layout");
      if (nearestNuxtLayout < 0) {
        return null;
      }
    }

    const nearestOpenTag = text.lastIndexOf("<");
    const nearestCloseTag = text.lastIndexOf(">");
    if (
      nearestCloseTag < nearestNuxtLayout &&
      nearestOpenTag === nearestNuxtLayout
    ) {
      const name = document.getText(quotedRange).slice(1, -1);
      const layout = layoutsInfo[name];
      if (layout) {
        const targetLoc = new vscode.Location(
          vscode.Uri.file(layout.file),
          new vscode.Position(0, 0)
        );

        return {
          name,
          file: layout.file,
          targetLoc,
          quotedRange,
        };
      }
    }
    return null;
  };

  const defProvider = vscode.languages.registerDefinitionProvider(["vue"], {
    provideDefinition: async (document, pos) => {
      const res = await processLayoutAttr(document, pos);
      if (!res) return null;

      const locationLinks: vscode.LocationLink[] = [
        {
          targetUri: res.targetLoc.uri,
          targetRange: new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, 0)
          ),
          originSelectionRange: res.quotedRange,
        },
      ];

      return locationLinks;
    },
  });
  context.subscriptions.push(defProvider);

  const hoverProvider = vscode.languages.registerHoverProvider(["vue"], {
    provideHover: async (document, position) => {
      const res = await processLayoutAttr(document, position);
      if (!res) return null;

      return new vscode.Hover(
        new vscode.MarkdownString(
          `Probably refers to the **layout**: [${res.name}](${res.file})${POWERED_BY_INFO}`
        ),
        res.quotedRange
      );
    },
  });
  context.subscriptions.push(hoverProvider);
}
