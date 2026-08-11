# Thunderbird AI Bridge

[English / liste complète des langues](../../README.md)

## Qu'est-ce que c'est ?

Thunderbird AI Bridge est un pont local entre Thunderbird et des agents IA, outils CLI, scripts ou applications personnalisées. L'extension exécute les opérations sur la boîte mail et un programme local communique avec elle via un petit protocole HTTP sur `127.0.0.1`.

**SuperCLI n'est pas requis.** Le premier hôte a été créé pour SuperCLI, mais n'importe quel programme peut utiliser l'extension s'il implémente le protocole décrit dans [docs/PROTOCOL.md](../PROTOCOL.md).

## Fonctions

- lister les comptes et dossiers,
- créer, renommer et supprimer des dossiers,
- rechercher par expéditeur, destinataire/adresse, sujet, texte et date,
- lire les messages sans modifier volontairement leur état lu/non lu,
- parcourir les longs messages par segments,
- lister et transférer les pièces jointes pour les modèles vision ou les analyseurs de documents,
- déplacer, mettre à la Corbeille et restaurer les messages,
- suppression définitive avec vérification IMAP,
- Empty Trash/EXPUNGE natif de Thunderbird,
- import de messages Outlook `.msg` convertis en `.eml`,
- opérations en masse par lots limités avec jetons de continuation.

## Sécurité

Les opérations sensibles disposent de protections supplémentaires. Les actions destructives exigent `confirm: true`, la suppression définitive est limitée à la Corbeille et les dossiers système/root sont protégés. L'hôte doit également demander une confirmation claire à l'utilisateur.

Le bridge est conçu pour fonctionner localement. N'exposez pas directement son hôte au réseau local ou à Internet.

## Construction

Thunderbird 128 ou plus récent est requis.

```bash
python scripts/build_xpi.py
npm test
```

Le fichier XPI est généré dans `dist/thunderbird-ai-bridge.xpi` et peut être installé manuellement depuis le gestionnaire de modules complémentaires de Thunderbird.

État : expérimental (`0.9.18`). Le protocole peut encore évoluer avant `1.0`.

Licence MIT. Projet indépendant, non affilié à Mozilla ou Thunderbird.
