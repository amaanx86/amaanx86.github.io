BLOG_DIR := src/content/blog
SHELL    := /bin/bash

.DEFAULT_GOAL := help
.PHONY: help install dev build preview clean post drafts list

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

install: ## install dependencies
	bun install

dev: ## start the dev server
	bun run dev

build: ## build the site
	bun run build

preview: ## preview the build
	bun run preview

clean: ## remove build files
	rm -rf dist .astro node_modules/.vite

post: ## make a new draft post
	@title="$(TITLE)"; [ -n "$$title" ] || read -rp "Title: " title; \
	title=$$(echo "$$title" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$$//'); \
	if [ -z "$$title" ]; then echo "Title is required."; exit 1; fi; \
	desc="$(DESC)"; [ -n "$$desc" ] || read -rp "Description (optional): " desc; \
	tags="$(TAGS)"; [ -n "$$tags" ] || read -rp "Tags, comma-separated (optional): " tags; \
	slug=$$(echo "$$title" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$$//'); \
	file="$(BLOG_DIR)/$$slug.md"; \
	if [ -e "$$file" ]; then echo "Refusing to overwrite existing $$file"; exit 1; fi; \
	if [ -n "$$tags" ]; then \
		tags="[\"$$(echo "$$tags" | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$$//; s/[[:space:]]*,[[:space:]]*/\", \"/g')\"]"; \
	else \
		tags="[]"; \
	fi; \
	{ \
		echo '---'; \
		echo "title: \"$$title\""; \
		echo "description: \"$$desc\""; \
		echo "date: $$(date +%F)"; \
		echo "tags: $$tags"; \
		echo 'draft: true'; \
		echo '---'; \
		echo ''; \
	} > "$$file"; \
	echo "Created $$file (draft: true, date: $$(date +%F))"

drafts: ## list draft posts
	@grep -lE '^draft:[[:space:]]*true' $(BLOG_DIR)/*.md 2>/dev/null | sed 's#^#  #' || echo "  (none)"

list: ## list all posts
	@for f in $(BLOG_DIR)/*.md; do \
		title=$$(grep -m1 '^title:' "$$f" | sed -E 's/^title:[[:space:]]*//; s/^"//; s/"$$//'); \
		date=$$(grep -m1 '^date:' "$$f" | sed -E 's/^date:[[:space:]]*//'); \
		flag=$$(grep -qE '^draft:[[:space:]]*true' "$$f" && echo '[draft]' || echo '       '); \
		printf "  %s  %s  %s\n" "$$date" "$$flag" "$$title"; \
	done
