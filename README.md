# Nuxt Companion 🚀

A powerful VSCode extension that enhances your Nuxt.js development experience with intelligent navigation, type support, and Tailwind CSS utilities.

## ✨ Features

### 🎨 Tailwind Unit Converter

Seamlessly convert between `rem` and `px` units in your Tailwind CSS classes:

- **Smart Detection**: Automatically detects and converts arbitrary values in Tailwind CSS classes
- **Interactive Hover**: Hover over any Tailwind arbitrary value to see its equivalent in the other unit
- **Quick Commands**:
  - `nuxtCompanion.px2rem`: Convert px to rem
  - `nuxtCompanion.rem2px`: Convert rem to px
- **Inline Preview**: Optional inline decorations showing equivalent values (configurable)
- **Wide Support**: Works with `.vue`, `.ts`, `.tsx`, and `.html` files
- **Batch Processing**: Convert multiple values at once in your selection

Examples:

```css
/* Before */
<div class="w-[16px] h-[32px] mt-[1.5rem] text-[14px]">

/* After hovering/converting */
<div class="w-[1rem] h-[2rem] mt-[24px] text-[0.875rem]">
```

### 🔌 API Navigation

Quickly navigate between your frontend API calls and backend handlers:

- **One-Click Navigation**: Jump directly from API calls to corresponding server endpoints
- **Smart Detection**: Automatically detects and links API calls in your code
- **Type Safety**: Works with TypeScript for better type inference and safety

> ⚠️ Note: Currently supported in `.ts` or `.tsx` files only.

### 📁 Layout Navigation

Effortlessly manage your Nuxt layouts:

- **Preview on Hover**: See layout definitions directly in tooltips
- **Quick Jump**: Click layout names to navigate to their definitions
- **Auto-completion**: Get smart suggestions for available layouts
- **Type Support**: Full TypeScript support for layout props and types

Example:

```vue
<!-- Click on "dashboard" to jump to its definition -->
<NuxtLayout name="dashboard">
  <YourComponent />
</NuxtLayout>
```

### 🛣️ Route Navigation

Smart route management and navigation:

- **Route Preview**: Hover over route names to see their full definitions
- **Direct Navigation**: Click to jump between route usage and definitions
- **Type Safety**: Full TypeScript support for route parameters and query types

Example:

```ts
// Click on "products.detail" to see its definition
const route = useRoute("products.detail");
<NuxtLink :to="{ name: 'products.detail', params: { id: 1 } }" />;
```

### 🔍 Type Definitions

Enhanced TypeScript support inspired by [vscode-goto-alias](https://github.com/antfu/vscode-goto-alias):

- **Smart Resolution**: Better type definition navigation for Nuxt.js
- **Auto-imports**: Support for Nuxt's auto-imported composables
- **Custom Types**: Works with your project's custom type definitions
- **Vue Integration**: Seamless support for Vue component types

## 🚀 Getting Started

### Prerequisites

- Nuxt.js project with TypeScript support
- Standard Nuxt.js project structure
- Tailwind CSS configuration (for unit converter feature)

### Installation

1. Open VSCode
2. Press `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (macOS)
3. Search for "Nuxt Companion"
4. Click Install

### Configuration

#### Tailwind Unit Converter Settings

Configure in VSCode settings:

```json
{
  "nuxtCompanion.tailwindUnitConverterPrecision": 9,
  "nuxtCompanion.tailwindUnitConverterShowDecorations": false
}
```

#### Available Commands

| Command                                       | Description                        | Default Keybinding |
| --------------------------------------------- | ---------------------------------- | ------------------ |
| `nuxtCompanion.px2rem`                        | Convert px to rem                  | -                  |
| `nuxtCompanion.rem2px`                        | Convert rem to px                  | -                  |
| `nuxtCompanion.toggleTailwindUnitDecorations` | Toggle unit conversion decorations | -                  |

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repository
2. Create your feature branch
3. Submit a pull request

## 📄 License

MIT License - see the [LICENSE](LICENSE) file for details.

## 🐛 Issues & Feedback

Found a bug or have a suggestion? Please open an issue on our GitHub repository.
