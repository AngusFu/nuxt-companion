import * as vscode from "vscode";

interface UnitMatch {
  range: vscode.Range;
  originalText: string;
  value: number;
  unit: "rem" | "px";
  prefix: string;
}

// Supported file types
const SUPPORTED_LANGUAGES = ["vue", "typescript", "typescriptreact", "html"];

// Regular expression patterns
const TAILWIND_CLASS_PATTERN =
  /(?:^|\s)[-a-zA-Z][-\w]*-\[-?[0-9]+(?:\.[0-9]+)?(?:rem|px)\]/;

interface ConversionConfig {
  sourceUnit: "px" | "rem";
  targetUnit: "rem" | "px";
  pattern: string;
  converter: (value: number) => number;
}

interface BaseConversionConfig {
  sourceUnit: "px" | "rem";
  targetUnit: "rem" | "px";
  pattern: string;
}

const CONVERSION_CONFIGS: Record<"px2rem" | "rem2px", BaseConversionConfig> = {
  px2rem: {
    sourceUnit: "px",
    targetUnit: "rem",
    pattern: "([-a-zA-Z][-\\w]*)-\\[(-?[0-9]+(?:\\.[0-9]+)?)px\\]",
  },
  rem2px: {
    sourceUnit: "rem",
    targetUnit: "px",
    pattern: "([-a-zA-Z][-\\w]*)-\\[(-?[0-9]+(?:\\.[0-9]+)?)rem\\]",
  },
};

// Common decoration styles
const decorationRenderOptions: vscode.DecorationRenderOptions = {
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

function formatConvertedValue(value: string | number, unit: string): string {
  return `${value}${unit}`;
}

export async function activate(
  context: vscode.ExtensionContext,
  disposeEffects: vscode.Disposable[]
): Promise<void> {
  // Check if already activated
  if (disposeEffects.some((d) => d instanceof TailwindUnitConverter)) {
    return;
  }

  // Check if Tailwind CSS is used in the project
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceUri) {
    return;
  }

  const hasTailwindConfig =
    (
      await vscode.workspace.findFiles(
        new vscode.RelativePattern(
          workspaceUri,
          "tailwind.config.{js,ts,cjs,mjs}"
        )
      )
    ).length > 0;

  if (!hasTailwindConfig) {
    return;
  }

  const converter = new TailwindUnitConverter(context);
  disposeEffects.push(converter);
}

export class TailwindUnitConverter implements vscode.Disposable {
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

    this.precision = config.get("tailwindUnitConverterPrecision", 9);
    this.showDecorations = config.get(
      "tailwindUnitConverterShowDecorations",
      false
    );

    // Get root font size from Tailwind CSS extension config
    this.remToPxRatio = tailwindConfig.get("rootFontSize", 16);

    // Create decoration type for showing conversions
    this.decorationType = vscode.window.createTextEditorDecorationType(
      decorationRenderOptions
    );
    this.disposables.push(this.decorationType);

    // Register commands
    this.registerCommands();

    // Register hover provider for all supported languages
    SUPPORTED_LANGUAGES.forEach((language) => {
      this.disposables.push(
        vscode.languages.registerHoverProvider(language, {
          provideHover: this.provideHover.bind(this),
        })
      );
    });

    // Register event listeners
    this.registerEventListeners();

    // Initial update of all visible editors
    this.updateAllVisibleEditors();

    // Listen for configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(this.onConfigChange.bind(this))
    );
  }

  private registerCommands() {
    // Register the px2rem and rem2px commands
    Object.entries(CONVERSION_CONFIGS).forEach(([commandName, _]) => {
      this.disposables.push(
        vscode.commands.registerCommand(
          `nuxtCompanion.${commandName}`,
          async (uriString?: string, line?: number, character?: number) => {
            let editor: vscode.TextEditor | undefined;

            if (
              uriString &&
              typeof line === "number" &&
              typeof character === "number"
            ) {
              // Called from hover with position info
              const uri = vscode.Uri.parse(uriString);
              editor = await vscode.window.showTextDocument(uri);
              const position = new vscode.Position(line, character);
              editor.selection = new vscode.Selection(position, position);
              await this.convertUnits(
                editor,
                this.getConversionConfig(commandName as "px2rem" | "rem2px"),
                true
              );
            } else {
              // Called from command palette
              editor = vscode.window.activeTextEditor;
              if (editor) {
                // Check if there's a selection
                const hasSelection = !editor.selection.isEmpty;
                await this.convertUnits(
                  editor,
                  this.getConversionConfig(commandName as "px2rem" | "rem2px"),
                  hasSelection
                );
              }
            }
          }
        )
      );
    });

    // Register the toggle decorations command
    this.disposables.push(
      vscode.commands.registerCommand(
        "nuxtCompanion.toggleTailwindUnitDecorations",
        async () => {
          this.showDecorations = !this.showDecorations;
          // Update configuration
          await vscode.workspace
            .getConfiguration("nuxtCompanion")
            .update(
              "tailwindUnitConverterShowDecorations",
              this.showDecorations,
              vscode.ConfigurationTarget.Global
            );
          // Update decorations
          this.updateAllVisibleEditors();
        }
      )
    );
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

  private onConfigChange(e: vscode.ConfigurationChangeEvent) {
    if (e.affectsConfiguration("tailwindCSS.rootFontSize")) {
      const newTailwindConfig =
        vscode.workspace.getConfiguration("tailwindCSS");
      this.remToPxRatio = newTailwindConfig.get("rootFontSize", 16);
      this.clearCache();
      this.updateAllVisibleEditors();
    }
    if (
      e.affectsConfiguration("nuxtCompanion.tailwindUnitConverterPrecision")
    ) {
      const config = vscode.workspace.getConfiguration("nuxtCompanion");
      this.precision = config.get("tailwindUnitConverterPrecision", 9);
      this.clearCache();
      this.updateAllVisibleEditors();
    }
    if (
      e.affectsConfiguration(
        "nuxtCompanion.tailwindUnitConverterShowDecorations"
      )
    ) {
      const config = vscode.workspace.getConfiguration("nuxtCompanion");
      this.showDecorations = config.get(
        "tailwindUnitConverterShowDecorations",
        false
      );
      this.updateAllVisibleEditors();
    }
  }

  private getConversionConfig(type: "px2rem" | "rem2px"): ConversionConfig {
    const config = CONVERSION_CONFIGS[type];
    return {
      ...config,
      converter:
        type === "px2rem"
          ? (value: number) => value / this.remToPxRatio
          : (value: number) => value * this.remToPxRatio,
    };
  }

  private async convertUnits(
    editor: vscode.TextEditor,
    config: ConversionConfig,
    singleValue: boolean = true
  ) {
    try {
      const document = editor.document;
      const pattern = new RegExp(config.pattern, "g");

      if (singleValue) {
        if (editor.selection.isEmpty) {
          // Convert only at cursor position
          const position = editor.selection.active;
          const range = document.getWordRangeAtPosition(
            position,
            TAILWIND_CLASS_PATTERN
          );

          if (!range) {
            return;
          }

          const text = document.getText(range);
          const match = new RegExp(config.pattern).exec(text);
          if (match) {
            const value = parseFloat(match[2]);
            // Skip 1px values
            if (config.sourceUnit === "px" && Math.abs(value) === 1) {
              return;
            }
            const convertedValue = this.formatNumber(config.converter(value));
            const newText = `${match[1]}-[${convertedValue}${config.targetUnit}]`;
            await editor.edit((editBuilder) => {
              editBuilder.replace(range, newText);
            });
          }
        } else {
          // Convert all matches within selection
          await this.convertSelectedText(editor, pattern, config);
        }
      } else {
        // Convert all matches in the document
        await this.convertAllText(editor, pattern, config);
      }
    } catch (error: unknown) {
      console.error("Error in convertUnits:", error);
      if (error instanceof Error) {
        vscode.window.showErrorMessage(
          `Error converting units: ${error.message}`
        );
      } else {
        vscode.window.showErrorMessage(
          "An unknown error occurred while converting units"
        );
      }
    }
  }

  private async convertSelectedText(
    editor: vscode.TextEditor,
    pattern: RegExp,
    config: ConversionConfig
  ) {
    const document = editor.document;
    const selectedText = document.getText(editor.selection);
    const matches = this.findMatches(
      selectedText,
      document,
      pattern,
      config,
      editor.selection.start
    );

    if (matches.length === 0) {
      return;
    }

    // Sort matches in reverse order to avoid position shifts
    matches.sort((a, b) => b.range.start.compareTo(a.range.start));

    await editor.edit((editBuilder) => {
      for (const match of matches) {
        if (match.unit === "px" && Math.abs(match.value) === 1) {
          continue;
        }
        const convertedValue = this.formatNumber(config.converter(match.value));
        const newText = `${match.prefix}-[${convertedValue}${config.targetUnit}]`;
        editBuilder.replace(match.range, newText);
      }
    });
  }

  private async convertAllText(
    editor: vscode.TextEditor,
    pattern: RegExp,
    config: ConversionConfig
  ) {
    const document = editor.document;
    const text = document.getText();
    const matches = this.findMatches(text, document, pattern, config);

    if (matches.length === 0) {
      return;
    }

    // Sort matches in reverse order to avoid position shifts
    matches.sort((a, b) => b.range.start.compareTo(a.range.start));

    await editor.edit((editBuilder) => {
      for (const match of matches) {
        if (match.unit === "px" && Math.abs(match.value) === 1) {
          continue;
        }
        const convertedValue = this.formatNumber(config.converter(match.value));
        const newText = `${match.prefix}-[${convertedValue}${config.targetUnit}]`;
        editBuilder.replace(match.range, newText);
      }
    });
  }

  private findMatches(
    text: string,
    document: vscode.TextDocument,
    pattern: RegExp,
    config: ConversionConfig,
    startOffset: vscode.Position = new vscode.Position(0, 0)
  ): UnitMatch[] {
    const matches: UnitMatch[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const value = parseFloat(match[2]);
      const prefix = match[1];

      // Skip values equals 1px when converting from px to rem
      if (config.sourceUnit === "px" && Math.abs(value) === 1) {
        continue;
      }

      const startPos = match.index;
      const endPos = startPos + match[0].length;
      const range = new vscode.Range(
        document.positionAt(document.offsetAt(startOffset) + startPos),
        document.positionAt(document.offsetAt(startOffset) + endPos)
      );

      // 类名前缀如果有负号，需要再次取反
      const isNegativePrefix = prefix.startsWith("-");
      const finalValue = isNegativePrefix ? -value : value;

      matches.push({
        range,
        originalText: match[0],
        value: finalValue,
        unit: config.sourceUnit,
        prefix: prefix,
      });
    }

    return matches;
  }

  private async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const range = document.getWordRangeAtPosition(
      position,
      TAILWIND_CLASS_PATTERN
    );
    if (!range) {
      return undefined;
    }

    const text = document.getText(range);
    for (const [commandName, config] of Object.entries(CONVERSION_CONFIGS)) {
      const match = new RegExp(config.pattern).exec(text);
      if (match) {
        const value = parseFloat(match[2]);
        const prefix = match[1];

        // Skip hover for values equals 1px when converting from px to rem
        if (config.sourceUnit === "px" && Math.abs(value) === 1) {
          return undefined;
        }

        const conversionConfig = this.getConversionConfig(
          commandName as "px2rem" | "rem2px"
        );

        // 类名前缀如果有负号，需要再次取反
        const isNegativePrefix = prefix.startsWith("-");
        const finalValue = isNegativePrefix ? -value : value;

        const convertedValue = this.formatNumber(
          conversionConfig.converter(finalValue)
        );

        const markdown = new vscode.MarkdownString();
        markdown.appendText(
          `Equivalent in ${config.targetUnit}: ${formatConvertedValue(
            convertedValue,
            config.targetUnit
          )}\n\n`
        );
        // Add arguments to the command URI to pass the position
        const args = [
          document.uri.toString(),
          range.start.line,
          range.start.character,
        ];
        markdown.appendMarkdown(
          `[Convert to ${
            config.targetUnit
          }](command:nuxtCompanion.${commandName}?${encodeURIComponent(
            JSON.stringify(args)
          )})`
        );
        markdown.isTrusted = true;
        return new vscode.Hover(markdown);
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

      // Add decorations for both rem and px values
      Object.entries(CONVERSION_CONFIGS).forEach(([type, config]) => {
        const pattern = new RegExp(config.pattern, "g");
        const conversionConfig = this.getConversionConfig(
          type as "px2rem" | "rem2px"
        );
        const matches = this.findMatches(
          text,
          editor.document,
          pattern,
          conversionConfig
        );

        for (const match of matches) {
          // Skip decoration for values equals 1px when converting from px to rem
          if (match.unit === "px" && Math.abs(match.value) === 1) {
            continue;
          }

          const convertedValue = this.formatNumber(
            conversionConfig.converter(match.value)
          );

          decorations.push({
            range: match.range,
            renderOptions: {
              after: {
                contentText: `(${formatConvertedValue(
                  convertedValue,
                  config.targetUnit
                )})`,
              },
            },
          });
        }
      });

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
