import * as vscode from "vscode";
import { activate as sidebar } from "./sidebar";
import { plugins } from "./plugins";
import { PluginManager } from "./utils/plugin-manager";
import { StatusBarManager } from "./utils/status-bar-manager";

export async function activate(context: vscode.ExtensionContext) {
  // check if nuxt.config.{js,ts} exists
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceUri) {
    return;
  }
  const nuxtConfig = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceUri, "nuxt.config.{ts,js,mjs}")
  );

  if (nuxtConfig.length === 0) {
    return;
  }

  const pluginManager = new PluginManager(context, plugins);
  const statusBarManager = new StatusBarManager(context);
  statusBarManager.updateStatus();
  statusBarManager.registerToggleCommand(context);
  statusBarManager.event((enabled) =>
    pluginManager.updateEnabledState(enabled)
  );
  pluginManager.updateEnabledState(statusBarManager.isEnabled);

  context.subscriptions.push(statusBarManager, pluginManager);
}

export function deactivate() {
  // nothing to do
}
