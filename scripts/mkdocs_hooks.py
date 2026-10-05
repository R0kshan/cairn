"""MkDocs hooks.

- GitHub-style heading anchors, so DSL_SPEC.md's in-page links resolve
  identically on GitHub and on the site. `pymdownx.slugs` drops the `<n>` in
  headings like "`order: <n>` — reading order"; GitHub keeps it.
- Publishes examples/*.svg at examples/ on the site: they live outside
  docs_dir, and copying them in would leave two sources to drift.
"""

import re
from pathlib import Path

from mkdocs.structure.files import File


def gh_slug(value, separator):
    return re.sub(r"[^\w\- ]", "", value.lower()).replace(" ", separator)


def on_config(config):
    config.mdx_configs.setdefault("toc", {})["slugify"] = gh_slug


def on_files(files, config):
    examples = Path(config.config_file_path).parent / "examples"
    for svg in sorted(examples.glob("*.svg")):
        files.append(File.generated(config, f"examples/{svg.name}", abs_src_path=str(svg)))
    return files
