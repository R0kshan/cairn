# MATRICE DES FLUX TECHNIQUES — Plateforme de commandes — vue applicative

| N° | Source | Destination | Protocole | Nature du flux |
|---|---|---|---|---|
| 1 | Chargé de commandes | Saisie des commandes (Gestion des commandes) | API_REST |  |
| 2 | Saisie des commandes (Gestion des commandes) | Contrôle des commandes (Gestion des commandes) | API_REST |  |
| 3 | Contrôle des commandes (Gestion des commandes) | Référentiel des commandes (Plateforme de commandes) | JDBC |  |
| 4 | Contrôle des commandes (Gestion des commandes) | Bus d'événements commandes (Plateforme de commandes) | MQ |  |
| 5 | Suivi transporteur (tiers) | Bus d'événements commandes (Plateforme de commandes) | SFTP |  |
