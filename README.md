# usage-limits

A Claude Code mod that keeps your usage in view at all times: a wide band above the prompt box shows

- **Session limit** (5-hour window), **Weekly · all models** and **Weekly · Fable**, each with a bar, the percent used and when it resets
- **This session**: cost, time spent waiting on the model (API), active time, lines added and removed, model mix and prompt-cache hit rate

It draws graphical bars in Claude Desktop and text bars in the terminal. Limit figures appear after the first reply on a Claude subscription. The Fable row shows "—" until Claude reports a separate Fable limit for your account.

## Install

At the prompt of a terminal session:

```
/plugin install usage-limits --marketplace kodkode/usage-limits
```

From a shell:

```
claude plugin install usage-limits --marketplace kodkode/usage-limits
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it load in every session, Claude Desktop's included).

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `kodkode/usage-limits`, then Add plugin.
