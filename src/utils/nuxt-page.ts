// Credit https://github.com/nuxt/nuxt/blob/0ce359c8fd2d3784609ad1ea8e5814ac43751436/packages/nuxt/src/pages/utils.ts
import { readFile } from "node:fs/promises";
import * as vscode from "vscode";

import * as t from "@oxc-project/types";
import * as esquery from "esquery";
import { globby } from "globby";
import { extname, join } from "pathe";
import { encodePath, joinURL, withLeadingSlash } from "ufo";
import { parseAST } from "./ast";

function escapeRE(string: string) {
  // Escape characters with special meaning either inside or outside character sets.
  // Use a simple backslash escape when it's always valid, and a \unnnn escape when the simpler form would be disallowed by Unicode patterns' stricter grammar.
  return string.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}

function uniqueBy<T>(array: T[], key: keyof T) {
  return array.filter(
    (v, i, self) => self.findIndex((t) => t[key] === v[key]) === i,
  );
}

enum SegmentParserState {
  initial,
  static,
  dynamic,
  optional,
  catchall,
  group,
}

enum SegmentTokenType {
  static,
  dynamic,
  optional,
  catchall,
  group,
}

interface SegmentToken {
  type: SegmentTokenType;
  value: string;
}

interface ScannedFile {
  relativePath: string;
  absolutePath: string;
}

export type NuxtPage = {
  name?: string;
  path: string;
  file?: string;
  meta?: Record<string, any>;
  alias?: string[] | string;
  children?: NuxtPage[];
  mode?: "client" | "server" | "all";
};

export async function resolvePagesRoutes(
  pagesDir: string = join(process.cwd(), "pages"),
  token?: vscode.CancellationToken,
): Promise<NuxtPage[]> {
  const scannedFiles: ScannedFile[] = [];

  // 检查取消状态
  if (token?.isCancellationRequested) {
    return [];
  }

  const files = await globby("**/*.{vue,js,ts,jsx,tsx}", {
    cwd: pagesDir,
    absolute: false,
  });

  // 检查取消状态
  if (token?.isCancellationRequested) {
    return [];
  }

  for (const file of files) {
    scannedFiles.push({
      relativePath: file,
      absolutePath: join(pagesDir, file),
    });
  }

  // sort scanned files using en-US locale to make the result consistent across different system locales
  scannedFiles.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, "en-US"),
  );

  const allRoutes = generateRoutesFromFiles(
    uniqueBy(scannedFiles, "relativePath"),
  );

  // 检查取消状态
  if (token?.isCancellationRequested) {
    return [];
  }

  const pages = uniqueBy(allRoutes, "path");
  await augmentPages(pages, token);

  // 检查取消状态
  if (token?.isCancellationRequested) {
    return [];
  }

  const flattedRoutes: NuxtPage[] = [];
  const flatRoute = (route: NuxtPage, acc: NuxtPage[] = []): NuxtPage[] => {
    if (route.children) {
      for (const child of route.children) {
        acc.push(...flatRoute(child));
      }
    }
    acc.push(route);
    return acc;
  };
  for (const route of pages) {
    flattedRoutes.push(...flatRoute(route));
  }
  return flattedRoutes;
}

const INDEX_PAGE_RE = /\/index$/;
function generateRoutesFromFiles(files: ScannedFile[]): NuxtPage[] {
  const routes: NuxtPage[] = [];

  const sortedFiles = [...files].sort(
    (a, b) => a.relativePath.length - b.relativePath.length,
  );

  for (const file of sortedFiles) {
    const segments = file.relativePath
      .replace(new RegExp(`${escapeRE(extname(file.relativePath))}$`), "")
      .split("/");

    const route: NuxtPage = {
      name: "",
      path: "",
      file: file.absolutePath,
      children: [],
    };

    // Array where routes should be added, useful when adding child routes
    let parent = routes;

    const lastSegment = segments[segments.length - 1]!;
    if (lastSegment.endsWith(".server")) {
      segments[segments.length - 1] = lastSegment.replace(".server", "");
    } else if (lastSegment.endsWith(".client")) {
      segments[segments.length - 1] = lastSegment.replace(".client", "");
      route.mode = "client";
    }

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      const tokens = parseSegment(segment!, file.absolutePath);

      // Skip group segments
      if (tokens.every((token) => token.type === SegmentTokenType.group)) {
        continue;
      }

      const segmentName = tokens
        .map(({ value, type }) =>
          type === SegmentTokenType.group ? "" : value,
        )
        .join("");

      // ex: parent/[slug].vue -> parent-slug
      route.name += (route.name && "/") + segmentName;

      // ex: parent.vue + parent/child.vue
      const routePath = getRoutePath(
        tokens,
        segments[i + 1] !== undefined && segments[i + 1] !== "index",
      );
      const path = withLeadingSlash(
        joinURL(route.path, routePath.replace(INDEX_PAGE_RE, "/")),
      );
      const child = parent.find(
        (parentRoute) =>
          parentRoute.name === route.name && parentRoute.path === path,
      );

      if (child && child.children) {
        parent = child.children;
        route.path = "";
      } else if (segmentName === "index" && !route.path) {
        route.path += "/";
      } else if (segmentName !== "index") {
        route.path += routePath;
      }
    }

    parent.push(route);
  }

  return prepareRoutes(routes);
}

const COLON_RE = /:/g;
function getRoutePath(
  tokens: SegmentToken[],
  hasSucceedingSegment = false,
): string {
  return tokens.reduce((path, token) => {
    return (
      path +
      (token.type === SegmentTokenType.optional
        ? `:${token.value}?`
        : token.type === SegmentTokenType.dynamic
          ? `:${token.value}()`
          : token.type === SegmentTokenType.catchall
            ? hasSucceedingSegment
              ? `:${token.value}([^/]*)*`
              : `:${token.value}(.*)*`
            : token.type === SegmentTokenType.group
              ? ""
              : encodePath(token.value).replace(COLON_RE, "\\:"))
    );
  }, "/");
}

const PARAM_CHAR_RE = /[\w.]/;

function parseSegment(segment: string, absolutePath: string) {
  let state: SegmentParserState = SegmentParserState.initial;
  let i = 0;

  let buffer = "";
  const tokens: SegmentToken[] = [];

  function consumeBuffer() {
    if (!buffer) {
      return;
    }
    if (state === SegmentParserState.initial) {
      throw new Error("wrong state");
    }

    tokens.push({
      type:
        state === SegmentParserState.static
          ? SegmentTokenType.static
          : state === SegmentParserState.dynamic
            ? SegmentTokenType.dynamic
            : state === SegmentParserState.optional
              ? SegmentTokenType.optional
              : state === SegmentParserState.catchall
                ? SegmentTokenType.catchall
                : SegmentTokenType.group,
      value: buffer,
    });

    buffer = "";
  }

  while (i < segment.length) {
    const c = segment[i];

    switch (state) {
      case SegmentParserState.initial:
        buffer = "";
        if (c === "[") {
          state = SegmentParserState.dynamic;
        } else if (c === "(") {
          state = SegmentParserState.group;
        } else {
          i--;
          state = SegmentParserState.static;
        }
        break;

      case SegmentParserState.static:
        if (c === "[") {
          consumeBuffer();
          state = SegmentParserState.dynamic;
        } else if (c === "(") {
          consumeBuffer();
          state = SegmentParserState.group;
        } else {
          buffer += c;
        }
        break;

      case SegmentParserState.catchall:
      case SegmentParserState.dynamic:
      case SegmentParserState.optional:
      case SegmentParserState.group:
        if (buffer === "...") {
          buffer = "";
          state = SegmentParserState.catchall;
        }
        if (c === "[" && state === SegmentParserState.dynamic) {
          state = SegmentParserState.optional;
        }
        if (
          c === "]" &&
          (state !== SegmentParserState.optional || segment[i - 1] === "]")
        ) {
          if (!buffer) {
            throw new Error("Empty param");
          } else {
            consumeBuffer();
          }
          state = SegmentParserState.initial;
        } else if (c === ")" && state === SegmentParserState.group) {
          if (!buffer) {
            throw new Error("Empty group");
          } else {
            consumeBuffer();
          }
          state = SegmentParserState.initial;
        } else if (c && PARAM_CHAR_RE.test(c)) {
          buffer += c;
        } else if (
          state === SegmentParserState.dynamic ||
          state === SegmentParserState.optional
        ) {
          if (c !== "[" && c !== "]") {
            console.warn(
              `'\`${c}\`' is not allowed in a dynamic route parameter and has been ignored. Consider renaming \`${absolutePath}\`.`,
            );
          }
        }
        break;
    }
    i++;
  }

  if (state === SegmentParserState.dynamic) {
    throw new Error(`Unfinished param "${buffer}"`);
  }

  consumeBuffer();

  return tokens;
}

function findRouteByName(
  name: string,
  routes: NuxtPage[],
): NuxtPage | undefined {
  for (const route of routes) {
    if (route.name === name) {
      return route;
    }
  }
  return findRouteByName(name, routes);
}

const NESTED_PAGE_RE = /\//g;
function prepareRoutes(
  routes: NuxtPage[],
  parent?: NuxtPage,
  names = new Set<string>(),
) {
  for (const route of routes) {
    // Remove -index
    if (route.name) {
      route.name = route.name
        .replace(INDEX_PAGE_RE, "")
        .replace(NESTED_PAGE_RE, "-");

      if (names.has(route.name)) {
        const existingRoute = findRouteByName(route.name, routes);
        const extra = existingRoute?.name
          ? `is the same as \`${existingRoute.file}\``
          : "is a duplicate";
        console.warn(
          `Route name generated for \`${route.file}\` ${extra}. You may wish to set a custom name using \`definePageMeta\` within the page file.`,
        );
      }
    }

    // Remove leading / if children route
    if (parent && route.path[0] === "/") {
      route.path = route.path.slice(1);
    }

    if (route.children?.length) {
      route.children = prepareRoutes(route.children, route, names);
    }

    if (route.children?.find((childRoute) => childRoute.path === "")) {
      delete route.name;
    }

    if (route.name) {
      names.add(route.name);
    }
  }

  return routes;
}

async function augmentPages(
  routes: NuxtPage[],
  token?: vscode.CancellationToken,
) {
  for (const route of routes) {
    // 检查取消状态
    if (token?.isCancellationRequested) {
      return;
    }

    if (route.file) {
      const routeMeta = await getRouteMeta(route.file, token);
      Object.assign(route, routeMeta);
    }

    if (route.children && route.children.length > 0) {
      await augmentPages(route.children, token);
    }
  }
}

const eQuery = (node: t.Span, selector: string) =>
  esquery.query(node as any, selector);
async function getRouteMeta(file: string, token?: vscode.CancellationToken) {
  try {
    // 检查取消状态
    if (token?.isCancellationRequested) {
      return null;
    }

    const fileContent = await readFile(file, "utf-8");
    let match: any = fileContent.indexOf("definePageMeta");
    if (match === -1) {
      return null;
    }

    // 检查取消状态
    if (token?.isCancellationRequested) {
      return null;
    }

    // get script tag content
    const scriptStart = fileContent.match(/<script[^>]*>/m);
    const scriptEnd = fileContent.match(/<\/script>/m);
    if (!scriptStart || !scriptEnd) return null;

    const scriptContent = fileContent.slice(
      scriptStart.index! + scriptStart[0].length,
      scriptEnd.index!,
    );

    try {
      // 检查取消状态
      if (token?.isCancellationRequested) {
        return null;
      }

      const entries = eQuery(
        parseAST(scriptContent, file.replace(/\.vue$/, ".vue.ts")),
        'CallExpression[callee.name="definePageMeta"]',
      )
        .map((el) => (el as t.CallExpression).arguments[0])
        .filter(
          (el): el is t.ObjectExpression => el?.type === "ObjectExpression",
        )
        .map((el: t.ObjectExpression) =>
          (el.properties as t.ObjectProperty[])
            .map((prop) => {
              if (
                prop.key.type === "Identifier" &&
                prop.value.type === "Literal"
              ) {
                return [prop.key.name, prop.value.value] as [string, any];
              }
              return null!;
            })
            .filter(Boolean),
        )
        .flat();
      return entries.length ? Object.fromEntries(entries) : null;
    } catch (parseError) {
      console.error(`Failed to parse definePageMeta in ${file}:`, parseError);
      return null;
    }
  } catch (readError) {
    console.error(`Failed to read file ${file}:`, readError);
    return null;
  }
}

/*
resolvePagesRoutes().then((routes) => {
  const expectedRaw = `about|account-notifications|account-profile|admin-dashboard-events|auth-login|auth-sign-up|auth-sign-up-success|contact|disclaimer|events-id|events-id-certificate|events-id-communication|events-id-event-overview|events-settings|events-id-event-settings-basic|events-id-event-settings-existing-events|events-id-event-settings|events-id-event-settings-personnel|events-id-event-settings-registration|events-id-event-settings-registration-addons|events-id-event-settings-registration-discounts|events-id-event-settings-registration-payments|events-id-event-settings-registration-reginfo|events-id-event-settings-registration-tickets|events-id-event-settings-review|events-id-event-settings-session|events-id-event-settings-submission-notification|events-id-event-settings-submission|events-id-event-submissions|events-id-registration-billing|events-id-statistics|events-id-user-management|events-id-website-overview|events-create|events-create-success|events|help|index|privacy|profile-dashboard-bookmarks|profile-dashboard-event-proposals|profile-dashboard-registrations|profile-dashboard-subscriptions|submissions-id-type|submissions-id-link-type|submissions-id-success|terms-of-use|test|user-dashboard-event-proposals|user-dashboard-event-series-edit-detail-id|user-dashboard-event-series-edit-seo-id|user-dashboard-event-series|user-dashboard|user-dashboard-user-management`
  const expected = expectedRaw.split("|").sort()
  const actual = routes.map((route) => route.name!).filter(Boolean).sort()
  const diffArray = (arr1: string[], arr2: string[]) => {
    return arr1.filter((item) => !arr2.includes(item));
  }
  const diff = diffArray(expected, actual);
  console.log(expected.length, actual.length);
  console.log(diffArray(expected, actual), diffArray(actual, expected));
});
*/
