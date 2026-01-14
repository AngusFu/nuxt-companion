import { parseSync } from "@oxc-parser/wasm";

export function parseAST(scriptContent: string, sourceFilename: string) {
  try {
    const parsed = parseSync(scriptContent, {
      sourceFilename,
    });
    const cloned = JSON.parse(parsed.programJson);
    parsed.free();
    return cloned;
  } catch (error) {
    console.error(error);
    return null;
  }
}
