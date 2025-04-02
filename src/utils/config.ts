import * as vscode from "vscode";

export class Config {
  private static instance: Config;
  get config() {
    return vscode.workspace.getConfiguration("nuxtCompanion");
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  public get<T>(key: string, defaultValue: T): T {
    return this.config.get<T>(key, defaultValue);
  }

  public async set<T>(key: string, value: T): Promise<void> {
    await this.config.update(key, value, true);
  }

  public isEnabled(): boolean {
    return this.get<boolean>("enabled", true);
  }

  public isPluginEnabled(pluginId: string): boolean {
    return this.get<boolean>(`enable${pluginId}`, true);
  }
}
