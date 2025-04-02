import * as vscode from "vscode";
import { plugins } from "../plugins";
import { Config } from "./config";
import { PluginManager } from "./plugin-manager";

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private pluginManager: PluginManager;
  private config: Config;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = "nuxtCompanion.toggle";
    this.pluginManager = new PluginManager(context);
    this.config = Config.getInstance();

    // Register all plugins
    plugins.forEach((plugin) => this.pluginManager.registerPlugin(plugin));

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
        this.pluginManager.updateEnabledState(newState);

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
    this.pluginManager.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
