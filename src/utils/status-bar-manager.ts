import * as vscode from "vscode";
import { Config } from "./config";

export class StatusBarManager extends vscode.EventEmitter<boolean> implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private config: Config;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    super();
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = "nuxtCompanion.toggle";
    this.config = Config.getInstance();

    // 初始化状态栏
    this.updateStatus();

    // 监听配置变更
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("nuxtCompanion.enabled")) {
          this.updateStatus();
        }
      })
    );
  }

  public get isEnabled() {
    return this.config.isEnabled();
  }

  public async updateStatus() {
    const isEnabled = this.config.isEnabled();
    this.statusBarItem.text = `$(heart) Nuxt Companion ${
      isEnabled ? "$(check)" : "$(close)"
    }`;
    this.statusBarItem.tooltip = `Nuxt Companion is ${
      isEnabled ? "enabled" : "disabled"
    }`;
    this.statusBarItem.show();
  }

  public registerToggleCommand(context: vscode.ExtensionContext) {
    const toggleCommand = vscode.commands.registerCommand(
      "nuxtCompanion.toggle",
      async () => {
        const currentState = this.config.isEnabled();
        const newState = !currentState;
        await this.config.set("enabled", newState);
        this.fire(newState);

        // Show notification
        // vscode.window.showInformationMessage(
        //   `Nuxt Companion is now ${newState ? "enabled" : "disabled"}`
        // );
      }
    );
    this.disposables.push(toggleCommand);
  }

  public dispose() {
    this.statusBarItem.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
