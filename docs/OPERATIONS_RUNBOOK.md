# Operations Runbook

Runbook minimal pour exploiter le blueprint.

## Demarrage local

```bash
cd agent_blueprint
npm install
npm run build
npm run dev:mock
```

Ou avec Hugging Face:

```bash
set HF_TOKEN=...
npm run dev:hf
```

## Verification de base

Dans la REPL:

```text
help
dashboard
agents
isolation
remote start 8787
```

Si un token est auto-genere, la REPL affiche l'URL complete.

## Remote UI

Ouvre l'URL affichee par la REPL.

Verifications utiles:

- `/health`
- `/config`
- `/state`
- `/events`

## MCP demo

Dans la REPL:

```text
mcp demo
mcp servers
mcp tools demo
mcp call demo uppercase :: {"value":"bonjour"}
```

## Logs

Fichiers:

- `.agent-blueprint-state/logs/runtime.log`
- `.agent-blueprint-state/logs/audit.log`

Verifier:

- erreurs LLM/MCP/remote
- tentatives remote refusees
- actions MCP
- sauvegardes/chargements de session

## Isolation

Commande REPL:

```text
isolation
```

Interpretation:

- `docker: true` signifie que Docker est vraiment utilisable
- `docker: false` peut vouloir dire:
  - Docker non installe
  - daemon non demarre
  - CLI presente mais backend indisponible

## Incident courant: Docker CLI presente, daemon indisponible

Symptome:

- l'isolation Docker ne s'active pas automatiquement

Verification:

```bash
docker info
```

Resolution:

- lancer Docker Desktop / le daemon Docker
- relancer la CLI du blueprint

## Sauvegarde et restauration

REPL:

```text
save
load
```

Ou vers un dossier explicite:

```text
save .snapshot-a
load .snapshot-a
```

## Preprod / prod controlee

Minimum recommande:

- lancer derriere un reverse proxy
- restreindre l'exposition reseau
- exiger token remote
- definir `trustedOrigins`
- activer un provider d'isolation reel
- centraliser les logs
- superviser le process

## Ce qui manque encore pour une vraie prod

- OIDC/SSO ou cles API rotatives
- RBAC
- DB transactionnelle
- rotation/retention des logs
- alerting
- tests de charge
- backup/restore operables a chaud
