import * as vscode from "vscode";

import { activate as apiToServer } from "./api-to-server";
import { activate as goToAliasActivate } from "./go-to-alias";
import { activate as layoutsNameIntelligence } from "./layouts-name";
import { activate as typedRoutesIntelligence } from "./typed-routes";
export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("nuxtCompanion");

  if (config.get<boolean>("enableApiToServer")) {
    apiToServer(context);
  }

  if (config.get<boolean>("enableGoToAlias")) {
    goToAliasActivate(context);
  }

  if (config.get<boolean>("enableLayoutsNameIntelligence")) {
    layoutsNameIntelligence(context);
  }

  if (config.get<boolean>("enableTypedRoutesIntelligence")) {
    typedRoutesIntelligence(context);
  }
}

export function deactivate() {
  // nothing to do
}
