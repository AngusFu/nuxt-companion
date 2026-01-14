import * as vscode from "vscode";

export const POWERED_BY_INFO =
  "\n\n---\n\n⚡ Powered by [Nuxt Companion](https://marketplace.visualstudio.com/items?itemName=wemlion.wemlion-nuxt-helper)";

export const DECORATION_RENDER_OPTIONS: vscode.DecorationRenderOptions = {
  after: {
    color: new vscode.ThemeColor("editorCodeLens.foreground"),
    margin: "0 0 0 0.5rem",
    fontStyle: "italic",
    fontWeight: "normal",
    textDecoration: "none",
    border: "1px dashed green",
  },
  overviewRulerLane: vscode.OverviewRulerLane.Right,
};
