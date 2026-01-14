import * as vscode from "vscode";
import { Config } from "./config";

export interface NuxtPlugin {
  id: string;
  name: string;
  activate: (
    context: vscode.ExtensionContext,
    disposeEffects: vscode.Disposable[],
    workspaceUri: vscode.Uri
  ) => void | Promise<void>;
}

export class PluginManager implements vscode.Disposable {
  private context: vscode.ExtensionContext;
  private plugins: Map<string, NuxtPlugin> = new Map();
  private disposeEffects: vscode.Disposable[] = [];
  private config: Config;
  private workspaceUri: vscode.Uri;

  constructor(context: vscode.ExtensionContext, plugins: NuxtPlugin[], workspaceUri: vscode.Uri) {
    this.context = context;
    this.workspaceUri = workspaceUri;
    this.config = Config.getInstance();
    plugins.forEach((plugin) => this.registerPlugin(plugin));
    this.initializePlugins();
  }

  public registerPlugin(plugin: NuxtPlugin) {
    this.plugins.set(plugin.id, plugin);
    if (this.config.isEnabled() && this.config.isPluginEnabled(plugin.id)) {
      plugin.activate(this.context, this.disposeEffects, this.workspaceUri);
    }
  }

  public updateEnabledState(enabled: boolean) {
    this.config.set("enabled", enabled);
    this.dispose();
    this.initializePlugins();
  }

  private initializePlugins() {
    if (!this.config.isEnabled()) {
      return;
    }

    for (const plugin of this.plugins.values()) {
      if (this.config.isPluginEnabled(plugin.id)) {
        plugin.activate(this.context, this.disposeEffects, this.workspaceUri);
      }
    }
  }

  public dispose() {
    this.disposeEffects.forEach((effect) => effect.dispose());
    this.disposeEffects = [];
  }
}
