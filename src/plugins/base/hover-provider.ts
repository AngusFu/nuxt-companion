// VS Code API
import * as vscode from 'vscode';

// Local modules
import { BaseCollector } from './collector';

export abstract class BaseHoverProvider<T> implements vscode.HoverProvider {
  constructor(protected collector: BaseCollector<T>) {}

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const quotedRange = this.findQuotedRange(document, position);
    if (!quotedRange) return null;

    const name = document.getText(quotedRange).slice(1, -1);
    const data = this.collector.getData(name);
    if (!data) return null;

    return this.createHoverContent(data, quotedRange);
  }

  protected findQuotedRange(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Range | null {
    const ranges = [
      document.getWordRangeAtPosition(position, /(['"])(?:(?!\1).)*\1/),
      // :attr=""; @event=""
      document.getWordRangeAtPosition(
        position,
        /(?<![:@][\w-]+=)(['"])(?:(?!\1).)*\1/
      ),
      // v-bind=""
      document.getWordRangeAtPosition(
        position,
        /(?<!v-bind=)(['"])(?:(?!\1).)*\1/
      ),
    ].filter((range): range is vscode.Range => range !== undefined);

    return ranges.reduce<vscode.Range | null>((smallest, current) => {
      if (!smallest) return current;
      if (!current) return smallest;
      return current.end.character - current.start.character <
        smallest.end.character - smallest.start.character
        ? current
        : smallest;
    }, null);
  }

  protected abstract createHoverContent(
    data: T,
    range: vscode.Range
  ): vscode.Hover;
}
