# Documentation Checklist

Etat de completion de la documentation du blueprint.

## Base projet

- [x] Vue d'ensemble du blueprint
- [x] Architecture generale
- [x] Liste des agents et roles
- [x] Commandes REPL principales
- [x] Build, test, lancement local

## Configuration

- [x] RuntimeOptions principaux
- [x] options de securite
- [x] options de logging
- [x] profils d'isolation
- [x] variables d'environnement LLM

## API et interfaces

- [x] endpoints remote HTTP
- [x] event stream SSE
- [x] UI web remote
- [x] profils MCP
- [x] persistance session / MCP

## Exploitation

- [x] runbook local
- [x] runbook preprod/prod controlee
- [x] fichiers de logs et audit
- [x] fichiers de persistance
- [x] limitation connue sur Docker daemon

## Securite

- [x] auth remote
- [x] redaction des secrets
- [x] politiques shell/filesystem
- [x] resilience LLM/MCP
- [x] isolation OS
- [x] limites du modele de menace

## Tests

- [x] liste des tests automatises
- [x] commande d'execution
- [x] zones couvertes
- [ ] tests de charge
- [ ] chaos testing
- [ ] tests multi-processus de concurrence sur la persistance

## Reste a faire pour une doc "niveau prod"

- [ ] guide de migration vers SQLite/Postgres
- [ ] guide RBAC/OIDC si auth forte ajoutee
- [ ] playbook incident response
- [ ] retention/rotation des logs
- [ ] benchmarks et enveloppes de performance
