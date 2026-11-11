# ADR-0005 — Sessions et authentification

- Date : 2026-11-11
- Propriétaire : lead technique
- Statut : **Accepté (local)** — la partie Cognito reste à implémenter et prouver avec un compte AWS autorisé

## Contexte

§13 : cookies HttpOnly/Secure/SameSite, CSRF, MFA pour les accès privilégiés. §4 : révocation effective immédiatement, transfert avec réauthentification, invitation liée à l'organisation, au courriel et au rôle, valable 7 jours, jeton haché. Cognito est retenu (§9), mais aucun compte AWS n'est disponible.

## Options

1. Utiliser directement les jetons JWT de Cognito comme session navigateur.
2. Utiliser Cognito (ou le simulateur) uniquement pour vérifier l'identité, et gérer une **session serveur opaque** en base.

## Décision

Option 2.

- **Fournisseur d'identité** (`IdentityProvider`) : inscription, vérification du courriel, connexion, récupération, MFA. `AUTH_MODE=fake` → simulateur (interdit en staging/production) ; `AUTH_MODE=cognito` → `CognitoNotImplementedError` tant que l'adaptateur n'est pas implémenté et prouvé.
- **Session serveur** (`sessions`) : un jeton aléatoire de 256 bits est placé dans le cookie ; la base ne stocke que son empreinte SHA-256. Cookie `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` et le préfixe `__Host-` en HTTPS.
  - Session standard : 30 jours au maximum, 7 jours d'inactivité.
  - Session privilégiée (utilisateur avec un rôle interne) : 12 h au maximum, 2 h d'inactivité, et **toute action refusée tant que la MFA de la session n'est pas validée**.
- **Recherche par jeton** : se fait avant de connaître l'utilisateur, via la fonction `SECURITY DEFINER auth_session_lookup`, qui ne renvoie que les colonnes utiles. Même principe pour `auth_user_by_subject` et `auth_invitation_by_token`.
- **Révocation** :
  - déconnexion ⇒ la session est révoquée ;
  - récupération du mot de passe ⇒ toutes les sessions de l'utilisateur sont révoquées ;
  - retrait d'un membre ⇒ la requête suivante est refusée, car `withTenant` revérifie l'appartenance à chaque transaction. Il n'existe aucun cache des droits.
- **Réauthentification** : exigée dans les 10 minutes qui précèdent un transfert de propriété (puis, plus tard, une suppression).
- **CSRF** : toute mutation exige un en-tête `Origin` égal à `APP_BASE_URL` et un corps JSON. Combiné à `SameSite=Lax`, cela bloque les formulaires inter-sites.
- **Limites de débit** :
  - par adresse IP et par courriel sur la connexion ;
  - par adresse IP sur l'inscription et la récupération.

  Elles sont tenues en mémoire du processus, donc à remplacer par un magasin partagé avant de passer à plusieurs instances (E22/E23).
- **Rôles internes** (`users.platform_role`) : le runtime ne peut pas les modifier (privilèges UPDATE limités par colonne). Seule une procédure opérateur utilisant le rôle propriétaire peut les attribuer.
- **Erreurs** : un non-membre reçoit `not_found` (404), pour ne pas révéler l'existence de l'organisation. Un membre qui n'a pas le droit reçoit `forbidden` (403).

## Conséquences

- Cognito ne voit jamais les sessions applicatives ; la révocation est immédiate et ne dépend pas de l'expiration d'un JWT.
- Une écriture en base au plus par minute et par session active (prolongation de l'inactivité).
- Si l'inscription échoue en base après la création du compte chez le fournisseur d'identité, il reste un compte orphelin chez ce fournisseur : à réconcilier quand l'adaptateur Cognito sera écrit.
