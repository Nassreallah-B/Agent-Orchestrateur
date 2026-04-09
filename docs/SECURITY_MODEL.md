# Security Model

Resume du modele de securite actuel.

## Ce que le systeme essaie de proteger

- le filesystem local hors workspace
- l'execution shell trop libre
- l'exposition remote non authentifiee
- les secrets MCP dans les surfaces d'admin
- les surcharges LLM/MCP par retries infinis ou absence de limites

## Controles implementes

### Remote

- token requis par defaut
- cookie `HttpOnly` apres bootstrap
- rate limiting
- limite de taille des bodies
- validation stricte des payloads
- headers HTTP de securite

### Tools locaux

- `allowedRoots`
- deny patterns
- limites de taille
- blocage de patterns shell dangereux
- environnement shell nettoye

### LLM/MCP

- timeouts
- retries bornes
- backoff
- limites de debit
- limites de concurrence

### Secrets

- redaction des headers MCP sensibles dans l'API remote
- redaction dans les logs structures

### Isolation

- profils d'isolation pour `Shell`
- profils d'isolation pour `MCP stdio`
- support `docker`, `firejail`, `bubblewrap`, `none`

## Ce que le systeme ne garantit pas encore

- isolation forte si aucun provider d'isolation n'est disponible
- securite multi-tenant forte
- separation de privileges entre utilisateurs
- secret management de niveau KMS/Vault
- audit non repudiable
- securite process/kernel type sandbox natif uniforme sur tous OS

## Menaces encore ouvertes

- utilisateur local malveillant avec acces au host
- plugin/tool malveillant si on lui donne trop de droits
- fuite de secrets via environnement si mal configure
- exposition remote directe sur un reseau non fiable
- concurrence forte ou crash au mauvais moment avec persistance JSON multi-fichiers

## Positionnement honnete

Le blueprint est:

- nettement plus durci qu'un prototype brut
- convenable pour usage interne controle
- pas encore equivalent a un produit SaaS durci

## Prochaines priorites securite

1. OIDC / RBAC / cles API rotatives
2. DB transactionnelle pour l'etat
3. secret management dedie
4. isolation OS active et verifiee sur la machine cible
5. observabilite et alerting
