Config files exactly as Geyser and Floodgate wrote them on their first start
on a Paper 1.21.11 server (2026-10-29, default settings, nothing edited, the
metrics uuid zeroed). The Crossplay tab's schema is tested against these:
every setting must find its key with the default the schema shows before the
files exist, and an edit must change only that key's line. Regenerate by
starting a server with the named builds once.

- Geyser-Spigot 2.12.1 build 1276
- floodgate-spigot 2.2.5 build 141
