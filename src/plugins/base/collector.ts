// VS Code API
import * as vscode from 'vscode';

// Third-party libraries
import { debounce } from 'lodash-es';

export interface FileChangeEvent {
  type: 'create' | 'change' | 'delete';
  uri: vscode.Uri;
}

export abstract class BaseCollector<T> {
  protected dataMap: Map<string, T> = new Map();
  protected watcher: vscode.FileSystemWatcher;
  protected currentBuildToken: vscode.CancellationTokenSource | undefined;

  constructor(
    protected workspaceUri: vscode.Uri,
    protected pattern: string,
    protected debounceTime: number = 1000
  ) {
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceUri, pattern)
    );

    // 使用防抖处理文件变化事件
    const debouncedBuild = debounce((event: FileChangeEvent) => {
      this.buildDataMap(undefined, event);
    }, this.debounceTime);

    this.watcher.onDidChange((uri) => debouncedBuild({ type: 'change', uri }));
    this.watcher.onDidDelete((uri) => debouncedBuild({ type: 'delete', uri }));
    this.watcher.onDidCreate((uri) => debouncedBuild({ type: 'create', uri }));

    // 初始构建
    this.buildDataMap();
  }

  protected abstract buildDataMap(
    token?: vscode.CancellationToken,
    event?: FileChangeEvent
  ): Promise<void>;

  public getData(key: string): T | undefined {
    return this.dataMap.get(key);
  }

  public getAllData(): Map<string, T> {
    return this.dataMap;
  }

  public dispose() {
    this.watcher.dispose();
    this.dataMap.clear();
    if (this.currentBuildToken) {
      this.currentBuildToken.cancel();
      this.currentBuildToken.dispose();
    }
  }
}
