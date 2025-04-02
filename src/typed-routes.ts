import * as vscode from "vscode";
import { POWERED_BY_INFO } from "./utils/constants";
import { NuxtPage, resolvePagesRoutes } from "./utils/nuxt-page";

export async function activate(context: vscode.ExtensionContext) {
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceUri) return;

  const pagesDir = vscode.Uri.joinPath(workspaceUri, "pages").fsPath;
  const pagesRoutesMap = new Map<string, NuxtPage>();
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceUri, "pages/**/*.vue")
  );
  const buildPagesRoutesMap = async () => {
    const pagesRoutes = await resolvePagesRoutes(pagesDir);
    pagesRoutesMap.clear();
    pagesRoutes.forEach((route) => {
      if (route.name) {
        pagesRoutesMap.set(route.name, route);
      }
    });
  };
  watcher.onDidChange(() => buildPagesRoutesMap());
  watcher.onDidDelete(() => buildPagesRoutesMap());
  watcher.onDidCreate(() => buildPagesRoutesMap());
  buildPagesRoutesMap();

  const defProvider = vscode.languages.registerDefinitionProvider(
    ["typescript", "typescriptreact", "vue"],
    {
      provideDefinition(document, position, token) {
        const quotedRange = document.getWordRangeAtPosition(
          position,
          /((['"])(?:(?!\2).)*\2)/
        );
        if (!quotedRange) return null;

        const call = document.getText(
          document.getWordRangeAtPosition(
            position,
            /useRoute\(((['"])(?:(?!\2).)*\2)\)/
          )
        );
        if (!call) return null;
        const name = document.getText(quotedRange).slice(1, -1);

        const route = pagesRoutesMap.get(name);
        if (!route) return null;

        const loc: vscode.LocationLink = {
          targetUri: vscode.Uri.file(route.file!),
          targetRange: new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, 0)
          ),
          originSelectionRange: quotedRange,
        };

        return [loc];
      },
    }
  );

  const hoverProvider = vscode.languages.registerHoverProvider(
    ["typescript", "typescriptreact", "vue"],
    {
      provideHover(document, position, token) {
        const quotedRange = document.getWordRangeAtPosition(
          position,
          /((['"])(?:(?!\2).)*\2)/
        );
        if (!quotedRange) return null;

        const name = document.getText(quotedRange).slice(1, -1);
        const route = pagesRoutesMap.get(name);
        if (!route) return null;

        const { children } = route;

        return new vscode.Hover(
          [
            new vscode.MarkdownString(
              `Probably refers to the **route**: [${name}](${route.file}).`
            ),
            // show child names
            children?.length
              ? new vscode.MarkdownString(
                  `Child names:\n${children
                    ?.map((child) => `- [${child.name}](${child.file})`)
                    .join("\n")}`
                )
              : "",
            new vscode.MarkdownString(
              `\`\`\`json\n${JSON.stringify(route, null, 2)}\n\`\`\``
            ),
            new vscode.MarkdownString(POWERED_BY_INFO),
          ],
          quotedRange
        );
      },
    }
  );

  context.subscriptions.push(watcher);
  context.subscriptions.push(defProvider);
  context.subscriptions.push(hoverProvider);

  // 添加清理函数
  context.subscriptions.push({
    dispose: () => {
      pagesRoutesMap.clear();
    },
  });
}
