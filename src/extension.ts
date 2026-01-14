import * as vscode from "vscode";
import { plugins } from "./plugins";
import { PluginManager } from "./utils/plugin-manager";
import { StatusBarManager } from "./utils/status-bar-manager";

export async function activate(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const statusBarManager = new StatusBarManager(context);
  statusBarManager.updateStatus();
  statusBarManager.registerToggleCommand(context);

  // Initialize plugins for each workspace folder that has nuxt.config
  const pluginManagers: PluginManager[] = [];

  for (const workspaceFolder of workspaceFolders) {
    const workspaceUri = workspaceFolder.uri;
    
    // Check if nuxt.config exists in this workspace
    const nuxtConfig = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceUri.fsPath, "nuxt.config.{ts,js,mjs}")
    );

    if (nuxtConfig.length > 0) {
      const pluginManager = new PluginManager(context, plugins, workspaceUri);
      pluginManagers.push(pluginManager);
      statusBarManager.event((enabled) =>
        pluginManager.updateEnabledState(enabled)
      );
      pluginManager.updateEnabledState(statusBarManager.isEnabled);
    }
  }

  // Push all managers and status bar to subscriptions
  context.subscriptions.push(statusBarManager, ...pluginManagers);
}

export function deactivate() {
  // nothing to do
}
