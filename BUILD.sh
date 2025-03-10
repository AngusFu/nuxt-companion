rm -rf out
npx ncc build src/extension.ts -o out --external=vscode --minify
rm -rf out/*.map
