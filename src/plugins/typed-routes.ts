import * as vscode from "vscode";
import * as path from "path";
import { POWERED_BY_INFO } from "../utils/constants";
import { NuxtPage, resolvePagesRoutes } from "../utils/nuxt-page";
import { BaseCollector } from "./base/collector";
import { BaseHoverProvider } from "./base/hover-provider";

class RoutesCollector extends BaseCollector<NuxtPage> {
  constructor(workspaceUri: vscode.Uri) {
    super(workspaceUri, "pages/**/*.vue");
  }

  protected async buildDataMap(token?: vscode.CancellationToken): Promise<void> {
    // 取消之前的构建任务
    if (this.currentBuildToken) {
      this.currentBuildToken.cancel();
    }
    this.currentBuildToken = new vscode.CancellationTokenSource();

    try {
      const pagesDir = path.join(this.workspaceUri.fsPath, "pages");
      const pagesRoutes = await resolvePagesRoutes(
        pagesDir,
        this.currentBuildToken.token
      );

      // 检查是否被取消
      if (
        token?.isCancellationRequested ||
        this.currentBuildToken.token.isCancellationRequested
      ) {
        return;
      }

      this.dataMap.clear();
      pagesRoutes.forEach((route) => {
        if (route.name) {
          this.dataMap.set(route.name, route);
        }
      });
    } catch (error) {
      if (
        !token?.isCancellationRequested &&
        !this.currentBuildToken.token.isCancellationRequested
      ) {
        console.error("Failed to build pages routes:", error);
        vscode.window.showErrorMessage(
          "Failed to build pages routes. Check the console for details."
        );
      }
    } finally {
      this.currentBuildToken.dispose();
      this.currentBuildToken = undefined;
    }
  }
}

class RoutesHoverProvider extends BaseHoverProvider<NuxtPage> {
  protected createHoverContent(
    route: NuxtPage,
    range: vscode.Range
  ): vscode.Hover {
    const { children } = route;

    return new vscode.Hover(
      [
        new vscode.MarkdownString(
          `Probably refers to the **route**: [${route.name}](${route.file}).`
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
      range
    );
  }
}

export function activate(
  context: vscode.ExtensionContext,
  disposeEffects: vscode.Disposable[],
  workspaceUri: vscode.Uri
) {
  const collector = new RoutesCollector(workspaceUri);
  const hoverProvider = vscode.languages.registerHoverProvider(
    ["typescript", "typescriptreact", "vue"],
    new RoutesHoverProvider(collector)
  );

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

        const route = collector.getData(name);
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

  // 添加清理函数
  disposeEffects.push({
    dispose: () => {
      collector.dispose();
      hoverProvider.dispose();
      defProvider.dispose();
    },
  });
}
