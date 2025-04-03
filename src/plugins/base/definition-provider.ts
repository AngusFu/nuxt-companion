// VS Code API
import * as vscode from 'vscode';

// Local modules
import { BaseCollector } from './collector';

export abstract class BaseDefinitionProvider<T> implements vscode.DefinitionProvider {
  constructor(protected collector: BaseCollector<T>) {}

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.DefinitionLink[] | null> {
    const quotedRange = this.findQuotedRange(document, position);
    if (!quotedRange) return null;

    const name = document.getText(quotedRange).slice(1, -1);
    const data = this.collector.getData(name);
    if (!data) return null;

    return this.createDefinitionLinks(data, quotedRange);
  }

  protected findQuotedRange(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Range | null {
    const range = document.getWordRangeAtPosition(position, /((['"])(?:(?!\2).)*\2)/);
    return range || null;
  }

  protected abstract createDefinitionLinks(
    data: T,
    range: vscode.Range
  ): vscode.DefinitionLink[];
}
