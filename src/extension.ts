import * as vscode from "vscode";

import { activate as apiToServer } from "./api-to-server";
import { activate as goToAliasActivate } from "./go-to-alias";

export function activate(context: vscode.ExtensionContext) {
  apiToServer(context);
  goToAliasActivate(context);
}
