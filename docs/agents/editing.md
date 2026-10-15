# Editing safely

Use this procedure for changes containing regular expressions, backslashes, shell substitutions, template literals or multiline GitHub text.

- Prefer a literal patch with enough surrounding context to identify the intended location. For scripted replacements, use literal strings, assert the expected match count before writing, and stop on a mismatch. Avoid stacking shell, language-string and regular-expression escaping in one command.
- Pass multiline scripts through a quoted heredoc (for example `python3 - <<'PY'`) so the shell preserves backticks, dollar signs and backslashes. JSON encoding is not shell quoting. A quoted heredoc protects against shell expansion but the script's own string and regex rules still apply.
- After editing, read the changed region and inspect `git diff --check` and `git diff`. For code changes, run the syntax check and the targeted behaviour test: a successful replacement alone does not establish correct escaping. Match strings as literals unless the test actually needs a regular expression.
- Write multiline issue/PR bodies and comments to a temporary UTF-8 file outside the repository, inspect it, then pass `--body-file <file>` to `gh issue create`, `gh issue comment`, `gh pr create`, `gh pr edit` or `gh pr comment`. Preserve actual newlines and literal backticks; avoid inline double-quoted shell bodies containing Markdown or code. Read back the published body/comment to confirm formatting and content.

Reusable project lessons discovered during editing belong here or in the document owning the affected procedure, with a pointer from `AGENTS.md` when agents need to find them. Keep private credentials, production details and session transcripts out of repository documentation.
