import * as vscode from "vscode";
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

  // Initialize and setup status bar
  const statusBarManager = new StatusBarManager(context);
  statusBarManager.updateStatus();
  statusBarManager.registerToggleCommand(context);
  context.subscriptions.push(statusBarManager);
}

export function deactivate() {
  // nothing to do
}
