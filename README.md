# Nuxt Companion 🚀

A powerful VSCode extension that enhances your Nuxt.js development experience with intelligent navigation and type support.

## ✨ Features

### 🎨 Tailwind Unit Converter

- Automatically converts between `rem` and `px` units in Tailwind CSS arbitrary values
- Hover over any Tailwind arbitrary value to see the equivalent in the other unit
- Quick conversion commands: Convert to rem (`nuxtCompanion.px2rem`) or px (`nuxtCompanion.rem2px`)
- Optional inline decorations showing equivalent values
- Supports `.vue`, `.js`, `.ts`, `.jsx`, `.tsx`, and `.html` files
- Configurable precision for converted values
- Works with both single values and batch conversions

Example:

- Hover over `w-[16px]` to see `w-[1rem]`
- Convert `mt-[1.5rem]` to `mt-[24px]` with a single click
- Toggle inline decorations to see equivalent values while coding

### 🔌 API Navigation

- Click on any api call to jump directly to the corresponding server endpoint
- Quick access to your server-side API handlers

> ⚠️ Note: This feature is currently only supported in `.ts` or `.tsx` files.

### 📁 Layout Navigation

- Hover over the layout name to see the layout definition in a tooltip
- Click on the layout name in `<NuxtLayout name="your-layout" />` to jump to the layout file
- Seamlessly navigate between layouts and their usage

### 🛣️ Route Navigation

- Hover over route names to see the route definition in a tooltip
- Click on route names in `useRoute("named.route")` to jump to the route definition
- Easy navigation between route definitions and their usage

### 🔍 Type Definitions

- Inspired by [vscode-goto-alias](https://github.com/antfu/vscode-goto-alias)
- Enhanced type definition navigation with a unique approach
- Support for Nuxt.js built-in types and auto-imported composables
- Works seamlessly with TypeScript and JavaScript files

## 🚀 Installation

1. Open VSCode
2. Go to the Extensions view (Ctrl+Shift+X)
3. Search for "Nuxt Companion"
4. Click Install

## 📋 Requirements

- Nuxt.js project
- Standard Nuxt.js project structure (pages, layouts, components, server, etc.)
- Tailwind CSS configuration file (`tailwind.config.js/ts/cjs/mjs`) for unit converter feature

## 📄 License

MIT License - see the [LICENSE](LICENSE) file for details.

## ⚙️ Configuration

### Tailwind Unit Converter Settings

The following settings can be configured in your VSCode settings:

- `nuxtCompanion.tailwindUnitConverterPrecision`: Number of decimal places for converted values (default: 9)
- `nuxtCompanion.tailwindUnitConverterShowDecorations`: Enable/disable inline decorations showing equivalent values (default: false)

### Commands

- `nuxtCompanion.px2rem`: Convert selected or cursor-position px values to rem
- `nuxtCompanion.rem2px`: Convert selected or cursor-position rem values to px
- `nuxtCompanion.toggleTailwindUnitDecorations`: Toggle the visibility of unit conversion decorations
