# Backlog — matrice exigences / stories

> GÉNÉRÉ depuis `tools/stories.json` (`python3 docs/requirements/tools/generate.py`). Ne pas éditer à la main.
> Chaque story sera détaillée (périmètre, contrats, migrations, télémétrie, rollback) au démarrage de son lot (Definition of Ready, §14).

Exigences P0 : 18 — toutes reliées à au moins une story : **oui**.

| Exigence | Prio | Story | Lot | Rôle | Titre | Critère Given/When/Then (principal) | Statut |
|---|---|---|---|---|---|---|---|
| AUTH-01 | P0 | ST-AUTH-01a | E05 | Visiteur | Inscription, vérification courriel et connexion | Given un courriel non vérifié When l'utilisateur tente une connexion OAuth réelle Then refus avec message localisé | VERIFIED_LOCAL |
| AUTH-01 | P0 | ST-AUTH-01b | E05 | Utilisateur | Récupération d'accès à usage unique | Given un code de récupération utilisé When il est réutilisé Then refus invalid_code | VERIFIED_LOCAL |
| ORG-01 | P0 | ST-ORG-01a | E04 | Système | Isolation multi-tenant en base (RLS, FK composites, contexte transactionnel) | Given le contexte de A When A lit ou référence un objet de B Then 0 ligne ou violation de contrainte | VERIFIED_LOCAL |
| ORG-01 | P0 | ST-ORG-01b | E05 | Propriétaire | Invitations expirantes, révocation et transfert de propriété | Given un seul propriétaire When il se rétrograde Then refus last_owner_protected | VERIFIED_LOCAL |
| ORG-01 | P0 | ST-ORG-01c | E05 | Système | Moteur de droits serveur (rôles client et internes, MFA privilégiée) | Given un producteur sans affectation valide When il modifie un contenu Then refus assignment_missing | VERIFIED_LOCAL |
| BRAND-01 | P0 | ST-BRAND-01a | E09 | Propriétaire | Profil de marque versionné et faits datés | Given un champ requis manquant When une génération est demandée Then 422 brand_incomplete | NOT_STARTED |
| MEDIA-01 | P0 | ST-MEDIA-01a | E10 | Éditeur | Téléversement privé, quarantaine et validation du contenu réel | Given un fichier au faux MIME When il est complété Then rejeté et non publiable | NOT_STARTED |
| AI-01 | P0 | ST-AI-01a | E13 | Éditeur | Génération FR/EN structurée, faits référencés, sans débit indu | Given une panne IA When le job échoue sans résultat exploitable Then la réservation de contenu est libérée | NOT_STARTED |
| EDIT-01 | P0 | ST-EDIT-01a | E11 | Éditeur | Révisions immuables et concurrence optimiste | Given expectedVersion obsolète When une révision est enregistrée Then 409 | IN_PROGRESS |
| APPROVAL-01 | P0 | ST-APPROVAL-01a | E15 | Relecteur | Approbation liée à la version et à la destination exactes | Given une révision modifiée après approbation When le dispatch démarre Then blocage blocked_approval | IN_PROGRESS |
| CAL-01 | P0 | ST-CAL-01a | E16 | Propriétaire | Calendrier localisé, liste mobile, refus hors période de droits | Given une heure inexistante (DST) When elle est saisie Then résolution explicite demandée | NOT_STARTED |
| SOC-01 | P0 | ST-SOC-01a | E03 | Équipe produit | Spike Meta/LinkedIn avec identifiants autorisés | Given aucun accès développeur autorisé When le spike est demandé Then statut BLOCKED_EXTERNAL | BLOCKED_EXTERNAL |
| SOC-01 | P0 | ST-SOC-01b | E17 | Propriétaire | Connexion OAuth et reconnexion, sans mot de passe social | Given un state OAuth différent When le callback arrive Then refus oauth_state_mismatch | NOT_STARTED |
| PUB-01 | P0 | ST-PUB-01a | E18 | Système | Contrôles au dispatch, succès seulement confirmé | Given un abonnement expiré When le dispatch démarre Then aucun appel réseau | NOT_STARTED |
| PUB-02 | P0 | ST-PUB-02a | E18 | Système | Reprises, unknown et réconciliation sans renvoi aveugle | Given un timeout après émission When la tentative se termine Then unknown, réservation conservée, réconciliation | NOT_STARTED |
| BILL-01 | P0 | ST-BILL-01a | E07 | Propriétaire | Abonnement par webhook signé et dédupliqué | Given une page de succès Checkout sans webhook When le tableau de bord se charge Then aucun droit accordé | VERIFIED_LOCAL |
| QUOTA-01 | P0 | ST-QUOTA-01a | E08 | Système | Ledger append-only, réservation concurrente du dernier crédit | Given 50 demandes concurrentes sur le dernier crédit When elles s'exécutent Then une seule réussit | VERIFIED_LOCAL |
| NOTIF-01 | P0 | ST-NOTIF-01a | E15 | Relecteur | Notifications et rappels 72 h/24 h dédupliqués, dans la langue du destinataire | Given un destinataire non membre When une notification est créée Then refus | NOT_STARTED |
| OPS-01 | P0 | ST-OPS-01a | E20 | Producteur interne | File interne limitée aux marques affectées | Given une affectation expirée When le producteur ouvre la marque Then refus | NOT_STARTED |
| ADMIN-01 | P0 | ST-ADMIN-01a | E20 | Support | Accès support temporaire, motivé et audité | Given un SupportGrant expiré When le support consulte un contenu Then refus et audit | NOT_STARTED |
| DATA-01 | P0 | ST-DATA-01a | E21 | Propriétaire | Export et suppression avec blocage immédiat des envois | Given une suppression vérifiée When un ancien job de publication s'exécute Then aucun appel réseau | NOT_STARTED |
| REPORT-01 | P0 | ST-REPORT-01a | E20 | Propriétaire | Rapport des publications : états et erreurs réels | Given une métrique non supportée When le rapport s'affiche Then « non disponible », jamais zéro | NOT_STARTED |
| ANALYTICS-01 | P1 | ST-ANALYTICS-01a | post-pilote | Propriétaire | Métriques selon capacités, null/unsupported plutôt que zéro | Given une capacité absente When la collecte s'exécute Then availability=unsupported | NOT_STARTED |
| MULTIBRAND-01 | P1 | ST-MULTIBRAND-01a | post-pilote | Propriétaire | Plusieurs marques et plans adaptés | Given un plan à une marque When une 2e marque est activée Then refus 422 | NOT_STARTED |
| AUTOPILOT-01 | P2 | ST-AUTOPILOT-01a | hors MVP | Propriétaire | Approbation par règle, désactivée par défaut | Given le MVP When aucune règle n'est activée Then aucune publication sans approbation explicite | NOT_STARTED |

Statuts : NOT_STARTED, IN_PROGRESS, BLOCKED_EXTERNAL, READY_FOR_REVIEW, VERIFIED_LOCAL, VERIFIED_LIVE. « IN_PROGRESS » signifie qu'une partie (invariant SQL, simulateur) existe et est testée, pas que la story est livrée.
