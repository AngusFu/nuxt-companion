import * as vscode from "vscode";
import { POWERED_BY_INFO, DECORATION_RENDER_OPTIONS } from "../utils/constants";

// Supported file types
const SUPPORTED_LANGUAGES = ["vue", "typescript", "typescriptreact", "html"];

// Regular expressions for matching rem/px in string literals
const REM_PATTERN = /(["'`])(-?\d+(?:\.\d+)?)\s*rem\1/g;
const PX_PATTERN = /(["'`])(-?\d+(?:\.\d+)?)\s*px\1/g;

export async function activate(
  context: vscode.ExtensionContext,
  disposeEffects: vscode.Disposable[],
  workspaceUri: vscode.Uri
): Promise<void> {
  // Check if already activated
  if (disposeEffects.some((d) => d instanceof RemPxLiteralConverter)) {
    return;
  }

  const converter = new RemPxLiteralConverter(context);
  disposeEffects.push(converter);
}

export class RemPxLiteralConverter implements vscode.Disposable {
  private decorationType: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];
  private precision: number;
  private showDecorations: boolean;
  private remToPxRatio: number;
  private conversionCache: Map<string, string> = new Map();
  private readonly MAX_CACHE_SIZE = 1000;

  constructor(context: vscode.ExtensionContext) {
    // Get configuration values
    const config = vscode.workspace.getConfiguration("nuxtCompanion");
    const tailwindConfig = vscode.workspace.getConfiguration("tailwindCSS");

    this.precision = config.get("remPxLiteralPrecision", 9);
    this.showDecorations = config.get("remPxLiteralShowDecorations", false);

    // Get root font size from Tailwind CSS extension config or default to 16
    this.remToPxRatio = tailwindConfig.get("rootFontSize", 16);

    // Create decoration type for showing conversions
    this.decorationType = vscode.window.createTextEditorDecorationType(
      DECORATION_RENDER_OPTIONS
    );
    this.disposables.push(this.decorationType);

    // Register hover provider for all supported languages
    SUPPORTED_LANGUAGES.forEach((language) => {
      this.disposables.push(
        vscode.languages.registerHoverProvider(language, {
          provideHover: this.provideHover.bind(this),
        })
      );
    });

    // Register conversion commands
    this.registerCommands();

    // Register toggle decoration command
    this.disposables.push(
      vscode.commands.registerCommand(
        "nuxtCompanion.toggleRemPxLiteralDecorations",
        async () => {
          this.showDecorations = !this.showDecorations;
          // Update configuration
          await vscode.workspace
            .getConfiguration("nuxtCompanion")
            .update(
              "remPxLiteralShowDecorations",
              this.showDecorations,
              vscode.ConfigurationTarget.Global
            );
          // Update decorations
          this.updateAllVisibleEditors();
        }
      )
    );

    // Register event listeners
    this.registerEventListeners();

    // Initial update of all visible editors
    this.updateAllVisibleEditors();
  }

  private registerCommands() {
    // Register literal px to rem command
    this.disposables.push(
      vscode.commands.registerCommand(
        "nuxtCompanion.literalPx2rem",
        async (hoverPosition?: vscode.Position) => {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            await this.convertLiterals(editor, "px2rem", hoverPosition);
          }
        }
      )
    );

    // Register literal rem to px command
    this.disposables.push(
      vscode.commands.registerCommand(
        "nuxtCompanion.literalRem2px",
        async (hoverPosition?: vscode.Position) => {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            await this.convertLiterals(editor, "rem2px", hoverPosition);
          }
        }
      )
    );
  }

  private async convertLiterals(
    editor: vscode.TextEditor,
    type: "px2rem" | "rem2px",
    hoverPosition?: vscode.Position
  ) {
    const document = editor.document;
    const pattern = type === "px2rem" ? PX_PATTERN : REM_PATTERN;
    let searchText: string;
    let searchRange: vscode.Range;

    // If hover position is provided, try to find the unit at that position
    if (hoverPosition) {
      const line = document.lineAt(hoverPosition.line);
      const lineText = line.text;
      const hoverMatch = this.findMatchAtPosition(
        lineText,
        hoverPosition.character,
        pattern
      );

      if (hoverMatch) {
        // Case 1: Hover - only convert the hovered unit
        searchText = hoverMatch.match[0];
        searchRange = new vscode.Range(
          hoverPosition.line,
          hoverMatch.start,
          hoverPosition.line,
          hoverMatch.end
        );
      } else {
        // Fallback to selection if hover position doesn't match a unit
        searchText = document.getText(editor.selection);
        searchRange = editor.selection;
      }
    } else if (!editor.selection.isEmpty) {
      // Case 2: Selection - only convert units within the selection
      searchText = document.getText(editor.selection);
      searchRange = editor.selection;
    } else {
      // Case 3: Full text - convert all units in the document
      searchText = document.getText();
      searchRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(searchText.length)
      );
    }

    // Get all matches within the search range
    const matches: { range: vscode.Range; newText: string }[] = [];
    let match;

    // Reset lastIndex to ensure we start from the beginning
    pattern.lastIndex = 0;

    while ((match = pattern.exec(searchText)) !== null) {
      const quoteChar = match[1]; // The quote character used (", ', or `)
      const valueStr = match[2]; // The numeric value as a string
      const value = parseFloat(valueStr);

      // Calculate new value
      const newValue = this.formatNumber(
        type === "px2rem" ? this.pxToRem(value) : this.remToPx(value)
      );

      // Create new text with same quotes but different unit
      const newUnit = type === "px2rem" ? "rem" : "px";
      const newText = `${quoteChar}${newValue}${newUnit}${quoteChar}`;

      // Calculate the actual position in the document
      const matchStartOffset = match.index;
      const matchStart = document.positionAt(
        document.offsetAt(searchRange.start) + matchStartOffset
      );
      const matchEnd = document.positionAt(
        document.offsetAt(searchRange.start) +
          matchStartOffset +
          match[0].length
      );
      const range = new vscode.Range(matchStart, matchEnd);

      matches.push({ range, newText });
    }

    // Apply edits in reverse order to avoid position shifts
    if (matches.length > 0) {
      matches.sort((a, b) => b.range.start.compareTo(a.range.start));

      await editor.edit((editBuilder) => {
        for (const { range, newText } of matches) {
          editBuilder.replace(range, newText);
        }
      });
    }
  }

  private findMatchAtPosition(
    text: string,
    position: number,
    pattern: RegExp
  ): { match: RegExpExecArray; start: number; end: number } | null {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (position >= start && position <= end) {
        return { match, start, end };
      }
    }
    return null;
  }

  private registerEventListeners() {
    // Register document change listener
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(this.onDocumentChange.bind(this))
    );

    // Register active editor change listener
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(
        this.onActiveEditorChange.bind(this)
      )
    );

    // Register visible editors change listener
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(
        this.onVisibleEditorsChange.bind(this)
      )
    );

    // Register configuration change listener
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(this.onConfigChange.bind(this))
    );
  }

  private onConfigChange(e: vscode.ConfigurationChangeEvent) {
    if (e.affectsConfiguration("tailwindCSS.rootFontSize")) {
      const newTailwindConfig =
        vscode.workspace.getConfiguration("tailwindCSS");
      this.remToPxRatio = newTailwindConfig.get("rootFontSize", 16);
      this.clearCache();
      this.updateAllVisibleEditors();
    }
    if (e.affectsConfiguration("nuxtCompanion.remPxLiteralPrecision")) {
      const config = vscode.workspace.getConfiguration("nuxtCompanion");
      this.precision = config.get("remPxLiteralPrecision", 9);
      this.clearCache();
      this.updateAllVisibleEditors();
    }
    if (e.affectsConfiguration("nuxtCompanion.remPxLiteralShowDecorations")) {
      const config = vscode.workspace.getConfiguration("nuxtCompanion");
      this.showDecorations = config.get("remPxLiteralShowDecorations", false);
      this.updateAllVisibleEditors();
    }
  }

  private formatNumber(value: number): string {
    const cacheKey = `${value}_${this.precision}`;
    const cached = this.conversionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = Number(value.toFixed(this.precision)).toString();

    if (this.conversionCache.size >= this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.conversionCache.entries());
      const halfSize = Math.floor(entries.length / 2);
      this.conversionCache = new Map(entries.slice(halfSize));
    }
    this.conversionCache.set(cacheKey, result);

    return result;
  }

  private clearCache() {
    this.conversionCache.clear();
  }

  // Convert rem to px
  private remToPx(remValue: number): number {
    return remValue * this.remToPxRatio;
  }

  // Convert px to rem
  private pxToRem(pxValue: number): number {
    return pxValue / this.remToPxRatio;
  }

  private async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const line = document.lineAt(position.line);
    const lineText = line.text;

    // Check for rem literals
    const remMatches = Array.from(lineText.matchAll(REM_PATTERN));
    for (const match of remMatches) {
      const startPos = match.index!;
      const endPos = startPos + match[0].length;

      if (position.character >= startPos && position.character <= endPos) {
        const remValue = parseFloat(match[2]);
        const pxValue = this.formatNumber(this.remToPx(remValue));

        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(
          `${remValue}rem = ${pxValue}px (with font-size: ${this.remToPxRatio}px)\n\n`
        );

        // Add command to convert to px with hover position
        markdown.appendMarkdown(
          `[Convert to px](command:nuxtCompanion.literalRem2px?${encodeURIComponent(
            JSON.stringify([position])
          )})`
        );
        markdown.isTrusted = true;

        const range = new vscode.Range(
          position.line,
          startPos,
          position.line,
          endPos
        );

        return new vscode.Hover([markdown, POWERED_BY_INFO], range);
      }
    }

    // Check for px literals
    const pxMatches = Array.from(lineText.matchAll(PX_PATTERN));
    for (const match of pxMatches) {
      const startPos = match.index!;
      const endPos = startPos + match[0].length;

      if (position.character >= startPos && position.character <= endPos) {
        const pxValue = parseFloat(match[2]);
        const remValue = this.formatNumber(this.pxToRem(pxValue));

        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(
          `${pxValue}px = ${remValue}rem (with font-size: ${this.remToPxRatio}px)\n\n`
        );

        // Add command to convert to rem with hover position
        markdown.appendMarkdown(
          `[Convert to rem](command:nuxtCompanion.literalPx2rem?${encodeURIComponent(
            JSON.stringify([position])
          )})`
        );
        markdown.isTrusted = true;

        const range = new vscode.Range(
          position.line,
          startPos,
          position.line,
          endPos
        );

        return new vscode.Hover([markdown, POWERED_BY_INFO], range);
      }
    }

    return undefined;
  }

  private updateDecorations(editor: vscode.TextEditor) {
    try {
      if (!SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
        return;
      }

      // If decorations are disabled, clear them and return
      if (!this.showDecorations) {
        editor.setDecorations(this.decorationType, []);
        return;
      }

      const text = editor.document.getText();
      const decorations: vscode.DecorationOptions[] = [];

      // Add decorations for rem values
      let match;
      while ((match = REM_PATTERN.exec(text)) !== null) {
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(
          match.index + match[0].length
        );
        const range = new vscode.Range(startPos, endPos);

        const remValue = parseFloat(match[2]);
        const pxValue = this.formatNumber(this.remToPx(remValue));

        decorations.push({
          range,
          renderOptions: {
            after: {
              contentText: `(${pxValue}px)`,
            },
          },
        });
      }

      // Reset regexp lastIndex
      REM_PATTERN.lastIndex = 0;

      // Add decorations for px values
      while ((match = PX_PATTERN.exec(text)) !== null) {
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(
          match.index + match[0].length
        );
        const range = new vscode.Range(startPos, endPos);

        const pxValue = parseFloat(match[2]);
        const remValue = this.formatNumber(this.pxToRem(pxValue));

        decorations.push({
          range,
          renderOptions: {
            after: {
              contentText: `(${remValue}rem)`,
            },
          },
        });
      }

      // Reset regexp lastIndex
      PX_PATTERN.lastIndex = 0;

      editor.setDecorations(this.decorationType, decorations);
    } catch (error: unknown) {
      console.error("Error in updateDecorations:", error);
      // Don't show error message for decoration updates as they are not critical
    }
  }

  private updateAllVisibleEditors() {
    vscode.window.visibleTextEditors.forEach((editor) => {
      if (SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
        this.updateDecorations(editor);
      }
    });
  }

  private onActiveEditorChange(editor: vscode.TextEditor | undefined) {
    if (editor && SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
      this.updateDecorations(editor);
    }
  }

  private onVisibleEditorsChange(editors: readonly vscode.TextEditor[]) {
    editors.forEach((editor) => {
      if (SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
        this.updateDecorations(editor);
      }
    });
  }

  private onDocumentChange(event: vscode.TextDocumentChangeEvent) {
    if (SUPPORTED_LANGUAGES.includes(event.document.languageId)) {
      // Update decorations for all visible editors that show this document
      vscode.window.visibleTextEditors.forEach((editor) => {
        if (editor.document === event.document) {
          this.updateDecorations(editor);
        }
      });
    }
  }

  public dispose() {
    this.clearCache();

    // Clear decorations from all editors
    vscode.window.visibleTextEditors.forEach((editor) => {
      if (editor) {
        try {
          editor.setDecorations(this.decorationType, []);
        } catch (e) {
          // Ignore errors if editor is already disposed
        }
      }
    });

    // Dispose all registered disposables
    this.disposables.forEach((d) => {
      try {
        d.dispose();
      } catch (e) {
        // Ignore errors if already disposed
      }
    });
    this.disposables = [];
  }
}
