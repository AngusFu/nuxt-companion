import * as vscode from "vscode";
import { NuxtPlugin } from "../utils/plugin-manager";
import { activate as apiToServer } from "./api-to-server";
import { activate as goToAliasActivate } from "./go-to-alias";
import { activate as layoutsNameIntelligence } from "./layouts-name";
import { activate as tailwindUnitConverter } from "./tailwind-unit-converter";
import { activate as typedRoutesIntelligence } from "./typed-routes";

export const plugins: NuxtPlugin[] = [
  {
    id: "ApiToServer",
    name: "API to Server",
    activate: apiToServer,
  },
  {
    id: "GoToAlias",
    name: "Go to Alias",
    activate: goToAliasActivate,
  },
  {
    id: "LayoutsNameIntelligence",
    name: "Layouts Name Intelligence",
    activate: layoutsNameIntelligence,
  },
  {
    id: "TypedRoutesIntelligence",
    name: "Typed Routes Intelligence",
    activate: typedRoutesIntelligence,
  },
  {
    id: "TailwindUnitConverter",
    name: "Tailwind Unit Converter",
    activate: tailwindUnitConverter,
  },
];
