import { debounce } from "lodash-es";
import * as vscode from "vscode";
import { POWERED_BY_INFO } from "../utils/constants";
import { NuxtPage, resolvePagesRoutes } from "../utils/nuxt-page";

export function activate(
  context: vscode.ExtensionContext,
  disposeEffects: vscode.Disposable[]
) {
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceUri) return;

  const pagesDir = vscode.Uri.joinPath(workspaceUri, "pages").fsPath;
  const pagesRoutesMap = new Map<string, NuxtPage>();
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceUri, "pages/**/*.vue")
  );

  let currentBuildToken: vscode.CancellationTokenSource | undefined;

  const buildPagesRoutesMap = debounce(
    async (token?: vscode.CancellationToken) => {
      // 取消之前的构建任务
      if (currentBuildToken) {
        currentBuildToken.cancel();
      }
      currentBuildToken = new vscode.CancellationTokenSource();

      try {
        const pagesRoutes = await resolvePagesRoutes(
          pagesDir,
          currentBuildToken.token
        );

        // 检查是否被取消
        if (
          token?.isCancellationRequested ||
          currentBuildToken.token.isCancellationRequested
        ) {
          return;
        }

        pagesRoutesMap.clear();
        pagesRoutes.forEach((route) => {
          if (route.name) {
            pagesRoutesMap.set(route.name, route);
          }
        });
      } catch (error) {
        if (
          !token?.isCancellationRequested &&
          !currentBuildToken.token.isCancellationRequested
        ) {
          console.error("Failed to build pages routes:", error);
          vscode.window.showErrorMessage(
            "Failed to build pages routes. Check the console for details."
          );
        }
      } finally {
        currentBuildToken.dispose();
        currentBuildToken = undefined;
      }
    },
    1000
  );

  // 使用防抖处理文件变化事件
  const debouncedBuild = debounce(buildPagesRoutesMap, 500);

  watcher.onDidChange(() => debouncedBuild());
  watcher.onDidDelete(() => debouncedBuild());
  watcher.onDidCreate(() => debouncedBuild());

  // 初始构建
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
        const ranges = [
          document.getWordRangeAtPosition(position, /(['"])(?:(?!\1).)*\1/),
          // :attr=""; @event=""
          document.getWordRangeAtPosition(
            position,
            /(?<![:@][\w-]+=)(['"])(?:(?!\1).)*\1/
          ),
          // v-bind=""
          document.getWordRangeAtPosition(
            position,
            /(?<!v-bind=)(['"])(?:(?!\1).)*\1/
          ),
        ].filter(Boolean);
        let quotedRange = ranges.reduce((smallest, current) => {
          if (!smallest) return current;
          if (!current) return smallest;
          return current.end.character - current.start.character < smallest.end.character - smallest.start.character
            ? current
            : smallest;
        });
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

  // 添加清理函数
  disposeEffects.push({
    dispose: () => {
      watcher.dispose();
      defProvider.dispose();
      hoverProvider.dispose();
      pagesRoutesMap.clear();

      if (currentBuildToken) {
        currentBuildToken.cancel();
        currentBuildToken.dispose();
      }
    },
  });
}
