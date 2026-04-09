# Persistence And State

Reference des fichiers persistants et de leur role.

## Repertoire par defaut

```text
agent_blueprint/.agent-blueprint-state/
```

## Fichiers principaux

### `session.json`

Contient:

- `agentTasks`
- `taskRecords`
- `teams`
- `events`

Usage:

- reprise de session
- restauration de l'historique runtime
- reconstruction partielle de l'etat UI/remote

### `mcp-connections.json`

Contient:

- la liste des connexions MCP a restaurer

Usage:

- reconnexion automatique au redemarrage

### `mcp-profiles.json`

Contient:

- `activeProfile`
- `profiles`

Usage:

- profils nommes `local`, `dev`, `prod`, etc.

### `logs/runtime.log`

JSONL runtime/ops.

### `logs/audit.log`

JSONL audit des actions sensibles.

## Proprietes de persistance

- ecriture atomique
- lock simple par fichier
- format JSON lisible

## Ce que la persistance couvre bien

- taches et equipes
- evenements recents
- profils MCP
- connexions MCP
- logs et audit

## Ce que la persistance ne couvre pas encore idealement

- transactions multi-fichiers fortes
- verrous distribues
- reprise cross-processus complexe
- migrations de schema versionnees
- stockage haute concurrence

## Sauvegarde / chargement manuel

REPL:

```text
save
save <dir>
load
load <dir>
```

Depuis le workbench:

- `saveSession(dir?)`
- `loadSession(dir?)`

## Recommandation prod

Pour un niveau prod:

- migrer vers SQLite ou Postgres
- versionner le schema
- ajouter checksum/metadata de snapshot
- gerer les migrations de compatibilite
