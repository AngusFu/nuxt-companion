# 检查是否有make,没有就用gmake
MAKE := $(shell which make 2>/dev/null || which gmake)
# 检查是否有zsh,没有就用bash
SHELL := $(shell which zsh 2>/dev/null || which bash)

.PHONY: build dev clean help install

build:
	rm -rf out
	npx ncc build src/extension.ts -o out --external=vscode --minify

dev:
	npx ncc build src/extension.ts -o out --external=vscode -s --watch

clean:
	rm -rf out

install:
	npm install

help:
	@echo "Available targets:"
	@echo "  make build    - Build production version"
	@echo "  make dev      - Start development environment with watch mode"
	@echo "  make clean    - Clean build output directory"
	@echo "  make install  - Install dependencies"
	@echo "  make help     - Show this help message"
