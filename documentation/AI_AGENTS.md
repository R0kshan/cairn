# Use with AI agents

cairn ships an [Agent Skill](https://agentskills.io) in
[`skills/cairn/`](https://github.com/R0kshan/cairn/tree/main/skills/cairn) for
Claude Code and other agents that support Agent Skills. Ask the agent for a
view in plain words, such as *"draw the infrastructure view of our portal,
with its flow matrix"*, and the skill tells it to:

1. find cairn: an installed binary, or `npx -y @r0kshan/cairn@unstable`;
2. read the [DSL reference](DSL_SPEC.md) for the cairn version it has
   installed;
3. write the `.cairn` file and run `cairn validate --strict` until there are
   no errors or warnings left;
4. build the SVG, aiming for `label overlaps: 0`, and run `cairn matrix` if a
   flow matrix was asked for.

The skill doesn't copy any part of the DSL reference, so it stays correct as
cairn changes. The agent needs network access to fetch the reference.

## Claude Code

Install the skill as a plugin, from a terminal. `--sparse` fetches only the
plugin files (about 0.5 MB) instead of cloning the whole repository:

```sh
claude plugin marketplace add R0kshan/cairn --sparse .claude-plugin skills
claude plugin install cairn@cairn
```

Inside a Claude Code session, these two commands also work:

```text
/plugin marketplace add R0kshan/cairn
/plugin install cairn@cairn
```

The in-session `/plugin` command can't take `--sparse`, so it clones the whole
repository (about 43 MB).

### Updates

The plugin follows this repository: every commit is a new version. Auto-update
is off by default for marketplaces outside Anthropic's. Turn it on for the
`cairn` marketplace in `/plugin`, or update by hand:

```sh
claude plugin marketplace update cairn
```

## Other agents

The skill is a single file. Download it to wherever your agent loads skills
from. For example, for Claude Code without the plugin:

```sh
mkdir -p ~/.claude/skills/cairn
curl -fsSL https://raw.githubusercontent.com/R0kshan/cairn/main/skills/cairn/SKILL.md -o ~/.claude/skills/cairn/SKILL.md
```
