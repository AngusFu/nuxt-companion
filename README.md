# Nuxt Companion

A powerful VSCode extension that enhances your Nuxt.js development experience with intelligent navigation and type support.

## Installation

1. Open VSCode
2. Go to the Extensions view (Ctrl+Shift+X)
3. Search for "Nuxt Companion"
4. Click Install

## Features

### API Navigation

Simply click on any `$api()` call in your code to jump directly to the corresponding server endpoint.

### Type Definitions

Look at [vscode-goto-alias](https://github.com/antfu/vscode-goto-alias) for the original features.

This Extensions provides almost the same features as `vscode-goto-alias`, but uses a different approach to find the type definitions.

### Layout Navigation

Click on the layout name in `<NuxtLayout name="your-layout" />` to jump to the layout file.

### Route Navigation

- Click on route names in `useRoute("named.route")` to jump to the route definition
- Hover over route names to see the route definition in a tooltip

## Requirements

- Nuxt.js project
- Standard Nuxt.js project structure (pages, layouts, components, server, etc.)

## License

MIT License - see the [LICENSE](LICENSE) file for details.
