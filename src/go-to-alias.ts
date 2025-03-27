/**
 * original code from https://github.com/antfu/vscode-goto-alias
 */
import { parseSync } from "@oxc-parser/wasm";
import * as vscode from "vscode";
import * as esquery from "esquery";
import * as t from "@oxc-project/types";

const eQuery = (node: t.Span, selector: string) =>
  esquery.query(node as any, selector);

function showSettingsUpdateDialog(ext: vscode.ExtensionContext) {
  if (
    vscode.workspace
      .getConfiguration()
      .get("editor.gotoLocation.multipleDefinitions") === "goto"
  )
    return;

  if (ext.globalState.get("showedSettingsUpdateDialog")) return;

  vscode.window
    .showInformationMessage(
      [
        "[Goto Alias]",
        "To get the best experience, we recommend you to set",
        '`"editor.gotoLocation.multipleDefinitions": "goto"` to the first definition automatically.',
        'Click "OK" to set it now.',
      ].join("\n"),
      "OK",
      "Not now"
    )
    .then((selection) => {
      if (selection === "OK") {
        // open user settings json
        vscode.commands.executeCommand("workbench.action.openSettingsJson");
        vscode.workspace
          .getConfiguration()
          .update("editor.gotoLocation.multipleDefinitions", "goto", true);
      }
      ext.globalState.update("showedSettingsUpdateDialog", true);
    });
}
function getRangeFromOffset(
  document: vscode.TextDocument,
  baseRange: vscode.Range,
  startOffset: number,
  endOffset: number
): vscode.Range {
  // 获取基础范围的起始偏移量
  const baseStartOffset = document.offsetAt(baseRange.start);

  // 计算实际的起始和结束偏移量
  const actualStartOffset = baseStartOffset + startOffset;
  const actualEndOffset = baseStartOffset + endOffset;

  // 将偏移量转换回位置
  const startPosition = document.positionAt(actualStartOffset);
  const endPosition = document.positionAt(actualEndOffset);

  return new vscode.Range(startPosition, endPosition);
}

async function provideDefinition(
  document: vscode.TextDocument,
  position: vscode.Position
) {
  const definitions = await vscode.commands.executeCommand(
    "vscode.executeDefinitionProvider",
    document.uri,
    position
  );
  if (!Array.isArray(definitions) || !definitions.length) {
    return definitions as vscode.DefinitionLink[];
  }

  const modifiedDefinitions = [] as vscode.DefinitionLink[];
  for (const definition of definitions) {
    if (!("targetUri" in definition)) {
      modifiedDefinitions.push(definition);
      continue;
    }

    const { originSelectionRange, targetUri, targetRange } =
      definition as vscode.DefinitionLink;

    if (targetUri.fsPath.endsWith(".d.ts")) {
      const doc = await vscode.workspace.openTextDocument(targetUri);
      const content = doc.getText(targetRange);
      const i = content.search(/\(?typeof\s/);
      if (i < 0) {
        modifiedDefinitions.push(definition);
        continue;
      }

      // avoid ts variable declarations
      const contentRange = getRangeFromOffset(
        doc,
        targetRange,
        i,
        content.length
      );
      const importContent = doc.getText(contentRange);

      const parsed = parseSync(importContent, {
        sourceFilename: targetUri.path,
      });
      const imports = eQuery(
        parsed.program as unknown as any,
        "ImportExpression"
      );
      const members = eQuery(
        parsed.program as unknown as any,
        "MemberExpression > Literal"
      );

      if (!imports.length || !members.length) {
        modifiedDefinitions.push(definition);
        continue;
      }
      const m = members[0] as t.StringLiteral;
      const range = getRangeFromOffset(doc, contentRange, m.start, m.end);
      const dtsDefinitions: vscode.DefinitionLink[] =
        await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",
          targetUri,
          range.start
        );

      if (dtsDefinitions.length) {
        // unshift to keep this definition as primary
        // when set `"editor.gotoLocation.multipleDefinitions": "goto"`, it will go to the right file
        const links = dtsDefinitions.map(
          (el) =>
            ({
              ...el,
              originSelectionRange,
            } as vscode.DefinitionLink)
        );
        modifiedDefinitions.unshift(...links);
      } else {
        modifiedDefinitions.push(definition);
      }
    }
  }

  return modifiedDefinitions;
}

export function activate(ext: vscode.ExtensionContext) {
  let lock = false;
  showSettingsUpdateDialog(ext);

  vscode.languages.registerDefinitionProvider(
    ["typescript", "typescriptreact", "vue"],
    {
      async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        cancelToken: vscode.CancellationToken
      ) {
        // prevent infinite loop and reduce unnecessary calls
        if (lock) return null;
        try {
          lock = true;
          const res = await provideDefinition(document, position);
          if (cancelToken.isCancellationRequested) return null;
          return res;
        } finally {
          lock = false;
        }
      },
    }
  );
}
