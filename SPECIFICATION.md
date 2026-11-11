# SaaS social FR/EN — Dossier de réalisation

> Copie de référence du dossier fourni par le propriétaire (version 1.1 — 28 octobre 2026), importée le 2026-11-11.
> Ce fichier est la source contractuelle du projet. Toute divergence d'implémentation doit être consignée dans un ADR (`docs/decisions/`).

## 1. Contrat de réalisation et décisions structurantes

Document de référence régénéré à partir du cahier des charges et de la feuille de route de cette conversation. Version 1.1 — 28 octobre 2026. Nom provisoire : [Brand Name]. La présente édition est une nouvelle mise en page du dossier de construction ; elle ne constitue pas une preuve que le logiciel ou ses intégrations ont été réalisés.

Mission : construire une application web SaaS multi-entreprises pour préparer, approuver, programmer et publier des contenus sociaux en français et en anglais. Modèle hybride : automatisation logicielle et IA, accompagnement humain optionnel et borné. Ne pas promettre d’amélioration garantie de l’engagement, des ventes ou de la portée.

Décisions : marché pilote canadien ; CAD ; locales fr-CA et en-CA ; une marque active par organisation au MVP ; site et application responsive ; contenus texte et images statiques ; Facebook Pages et Instagram professionnel d’abord, sous réserve d’accès ; LinkedIn Pages après approbation ; validation client obligatoire ; noir, blanc et or ; monolithe modulaire et workers asynchrones.

La sécurité, l’isolation des entreprises, les quotas transactionnels et l’approbation de versions priment en cas de conflit. Les identifiants techniques sont en anglais ; documentation principale en français ; toutes les interfaces et communications clients disponibles en français et en anglais.

Les prix, volumes, calendriers et objectifs sont des hypothèses de conception. Les permissions et capacités exactes des fournisseurs doivent être revérifiées avec l’application développeur réellement créée. L’entité juridique, les marchés desservis, la fiscalité et les contrats nécessitent une validation du propriétaire et de professionnels compétents.

Un code builder doit réaliser des lots vérifiables, pas générer tout le produit d’un seul coup. Ne jamais déclarer un test, une intégration ou une publication réussie sans preuve. Développement local avec simulateurs autorisé ; actions externes réelles, paiements, publications, déploiements et dépenses soumis à accord explicite.

## 2. Produit, cible et périmètre

Le client renseigne sa marque et ses informations vérifiées, ajoute ses médias, obtient des propositions, corrige les textes et visuels, approuve une version précise, puis programme sur ses comptes connectés. L’application affiche honnêtement les états de publication et les erreurs.

Clientèle pilote : commerces locaux, salons, restaurants, entreprises de services résidentiels, consultants B2B, studios et prestataires créatifs. Exclure les secteurs fortement réglementés du pilote standard ; prévoir un cadrage propre avant leur ouverture.

MVP inclus : site commercial bilingue, authentification, organisations et membres, profil de marque versionné, médias privés, génération textuelle IA, modèles visuels, édition, commentaires et versions, revue interne optionnelle, approbation client, calendrier, connexions sociales, publication asynchrone, abonnement, quotas, notifications, rapport des publications, console interne, administration, audit, export et suppression.

Hors MVP : application native, publicité, social listening, messages privés, réponses automatiques, Stories, Reels, vidéos et carrousels, marque blanche, publication sur profils Facebook personnels et autopilot sans revue. Statistiques d’engagement : P1, uniquement si disponibles par API. Statut de publication : P0.

Indicateurs : activation (marque complète + compte connecté + contenu approuvé), délai de première approbation, taux d’acceptation initiale, coût IA/média, minutes humaines par client, succès des publications éligibles, résultats inconnus, support, rétention et marge contributive.

Pilote : 20 à 30 entreprises, avec observation de deux cycles de facturation. Ne pas extrapoler la rentabilité ou la fiabilité sans ces mesures.

## 3. Plans, quotas et économie du service

Plans proposés, hors taxes et à valider commercialement : Essentiel 99 CAD/mois, une marque, deux utilisateurs, 15 contenus sources, 45 publications et trois comptes maximum ; Croissance 179 CAD/mois, cinq utilisateurs, 30 contenus et 90 publications ; Accompagné 399 CAD/mois, cinq utilisateurs, 15 contenus et 45 publications, revue interne et une ronde de corrections groupée dans une enveloppe opérationnelle cible de 120 minutes par cycle.

ContentItem = sujet source ; ContentVariant = adaptation à une langue et un réseau ; Revision = version immuable ; Publication = envoi d’une révision à un compte ; Regeneration = nouvelle proposition IA ; BillingCycle = intervalle acquis de droits.

Un sujet en français décliné sur trois réseaux = un contenu et trois publications. Deux langues publiées séparément sur les trois réseaux = un contenu et six publications. Appliquer les deux plafonds indépendamment. Ne pas annoncer trois réseaux avant leur disponibilité effective.

Réserver un crédit de contenu avant le job ; consommer quand une première proposition structurée et éditable est persistée ; libérer en cas d’échec technique sans résultat exploitable. Trois régénérations réussies par contenu ; erreurs techniques non décomptées ; modifications manuelles illimitées. Lots partiels : réservation et consommation par sujet, pas débit global injustifié.

Publication : réservation lors de programmation ; consommation au succès confirmé ; retry sans débit supplémentaire ; unknown conserve la réservation ; annulation certaine ou échec terminal réconcilié la libère. Aucun report ni dépassement payant automatique. Écritures de ledger append-only avec déduplication et verrous transactionnels.

MVP : programmation limitée à la période de droits courante connue ; préparation de brouillons futurs autorisée. Cycles [start,end) UTC. Une réservation inconnue demeure attachée au cycle initial, sans double consommation. Upgrade : droits supplémentaires seulement après paiement confirmé ; crédit du delta, pas réinitialisation complète. Downgrade au renouvellement.

Annulation à échéance, avec action séparée de suspension immédiate. Après expiration : pas de nouvelles générations ni publications, consultation/export 30 jours. Impayé : grâce de sept jours à partir de l’échéance initiale, sans nouvelle génération ; seuls les contenus déjà approuvés peuvent partir si les droits le permettent. Pas de prolongation répétée de la grâce à chaque tentative de paiement.

Exemple économique hypothétique : revenu 99 ; paiement 4 ; IA 4 ; médias 3 ; infrastructure allouée 5 ; support 8 ; contribution 75 CAD avant frais fixes. Ajouter 90 minutes à 40 CAD/h coûte 60 CAD et réduit cette contribution à 15. Ce n’est pas un devis fournisseur. Mesurer séparément les coûts fixes cloud et les coûts variables.

## 4. Rôles, accès et organisation du service

User peut appartenir à plusieurs Organizations via Membership ; Organization porte l’abonnement ; Brand porte les connexions et contenus. Une seule marque active par abonnement initial, mais modèle extensible.

Propriétaire : équipe, marque, édition, approbation, programmation, facturation, transfert, export et suppression. Administrateur client : équipe, marque, approbation et programmation, sans facturation ni suppression d’organisation par défaut. Éditeur : création/modification, pas d’approbation ni programmation. Relecteur : lecture, commentaires et approbation, pas de programmation.

Producteur interne : uniquement marques assignées, édition et revue interne. Gestionnaire de compte : suivi et échéances des affectations. Aucun de ces rôles ne remplace l’approbation client. Support : métadonnées minimales ; accès aux contenus exceptionnel, motivé, limité dans le temps et audité. Administrateur plateforme : exploitation et configuration, aucun droit client implicite. Super administrateur : procédure de secours avec MFA et audit renforcé.

Contrôles sur chaque requête serveur et chaque job. Dernier propriétaire protégé ; transfert avec réauthentification. Invitation liée à organisation, email et rôle, expiration sept jours, jeton haché. Révocation membre effective immédiatement pour nouvelles requêtes et caches invalidés.

Séparer les interfaces internes et clientes. Les accès privilégiés nécessitent MFA. L’affectation StaffAssignment et les SupportGrant expirants sont persistés et vérifiables ; aucun rôle global caché ne doit contourner la base ou les services.

## 5. Parcours et machines à états

Onboarding reprenable : langue → inscription → vérification email → organisation → paiement → marque → médias → compte social → premier contenu → approbation → programmation. Éditer/exporter reste possible sans réseau connecté. Un compte non vérifié ne connecte pas de réseau réel.

Marque requise : nom, secteur, description, cible, zone, services, ton, langue, fuseau et source de faits confirmée. Logo facultatif avec modèle adapté. Horaires, prix et promotions ont dates de validité. Photos accompagnées d’une déclaration de droits.

États éditoriaux : draft, generating, internal_review si plan accompagné, pending_customer_review, changes_requested, approved, archived. Un échec de job ne supprime pas une ancienne révision. État de sujet résumé seulement ; approbations indépendantes par variante.

États de publication : unscheduled, scheduled, blocked_approval, dispatching, processing, retry_wait, unknown, published, failed, cancelled, expired. Les transitions passent par un module métier pur, pas par modification libre d’un champ status.

Approval lie revision_id, revision_hash, connection_id, actor_id et date. Hash couvre texte, langue, média et destination. Toute modification de ces éléments invalide l’approbation et bloque l’envoi. Déplacement horaire seul conserve l’approbation, mais est audité et recontrôle les dates commerciales. Silence du client jamais assimilé à un accord.

Révisions immuables ; expectedVersion obligatoire pour édition concurrente ; réponse 409 si obsolète. Révision approuvée sur Facebook FR ne vaut pas approbation Instagram ou EN.

Annulation avant dispatch : annuler et libérer. Pendant l’appel : cancel_requested, vérification juste avant l’émission quand possible ; une requête déjà acceptée peut aboutir. Afficher résultat à vérifier, pas annulation garantie. Aucun effacement externe automatique.

Dates stockées UTC plus fuseau IANA. Saisie ambiguë/inexistante au changement d’heure résolue explicitement. Changer le fuseau de marque ne déplace pas les envois existants. Approbation tardive ne déclenche pas un envoi obsolète. Rappels à 72 h et 24 h lorsque pertinents.

## 6. Exigences et critères de validation

P0 = lancement ; P1 = après stabilisation ; P2 = ultérieur. Chaque exigence doit être liée à une story, une interface ou un job, et un test.

AUTH-01 P0 : inscription/vérification/récupération ; compte non vérifié bloqué pour OAuth ; récupération à usage unique. ORG-01 P0 : invitations/transfert ; dernier propriétaire protégé ; accès inter-tenant impossible. BRAND-01 P0 : version du profil et faits datés ; génération refusée si champs requis absents.

MEDIA-01 P0 : stockage privé, contrôle contenu réel et accès isolé. AI-01 P0 : FR/EN structuré, faits référencés, erreurs sans crédit indu. EDIT-01 P0 : historique immuable et conflits détectés. APPROVAL-01 P0 : accord sur version et destination exactes ; modification bloque l’envoi.

CAL-01 P0 : calendrier localisé et liste mobile, période hors droits refusée. SOC-01 P0 : OAuth et reconnexion, aucun mot de passe social. PUB-01 P0 : contrôles au dispatch et succès seulement confirmé. PUB-02 P0 : reprises, unknown et réconciliation sans renvoi aveugle.

BILL-01 P0 : webhook signé/dédupliqué et statut fournisseur ; redirection Checkout insuffisante. QUOTA-01 P0 : ledger et concurrence, dernier crédit réservé une seule fois. NOTIF-01 P0 : destinataires autorisés et langue correcte, rappels dédupliqués.

OPS-01 P0 : file interne limitée aux marques affectées. ADMIN-01 P0 : audit des accès et actions privilégiés. DATA-01 P0 : export/suppression avec blocage immédiat des nouveaux envois. REPORT-01 P0 : états et erreurs réels, aucun compteur inventé.

ANALYTICS-01 P1 : métriques disponibles selon capacités, null/unsupported plutôt que zéro. MULTIBRAND-01 P1 : plusieurs marques et plans adaptés. AUTOPILOT-01 P2 : approbation par règle hors MVP, désactivée par défaut.

## 7. Internationalisation et expérience utilisateur

Choix indépendants : user.ui_locale, organization.default_locale, brand.default_content_locale, content_variant.locale, brand.timezone, subscription.currency. Changer l’interface ne traduit pas un contenu. Versions FR et EN séparées par défaut ; légende bilingue seulement à demande explicite.

next-intl ; locales fr-CA/en-CA ; namespaces common, auth, onboarding, brand, content, calendar, integrations, billing, notifications, errors et admin. Aucune chaîne visible codée en dur ; pluriels et interpolations contrôlés ; parité des clés dans CI. Traduction absente : erreur déterministe et signalée, pas mélange silencieux.

Site /fr/ et /en/ avec métadonnées localisées et liens linguistiques réciproques ; dashboard non indexé. Emails selon langue du destinataire, version enregistrée. Dates, nombres, monnaie et fuseau ne sont pas déduits arbitrairement de la seule langue.

Exemples : « Approuver cette version » / « Approve this version » ; « Reconnecter le compte » / « Reconnect account » ; « Résultat de publication à vérifier » / « Publication outcome pending verification » ; « Annuler au prochain renouvellement » / « Cancel at next renewal ».

Navigation : accueil, calendrier, contenus, marque, médias, comptes, rapports, équipe, facturation, préférences. Console interne : affectations, production, incidents et administration. Tableau de bord : quotas, approbations, prochains envois et comptes à reconnecter.

Éditeur : texte et historique d’un côté, aperçu réseau de l’autre, onglets langue/réseau, version et destination visibles. Mobile : onglets texte/aperçu et calendrier en liste. Facturation : plan, monnaie, taxes, dates et droits. Rapports : résultat et lien externe si connu ; erreurs utiles expurgées.

Tous les écrans ont états loading, empty, error, forbidden, readonly et success pertinents. Labels, erreurs associées, gestion focus et clavier. Aucun contrôle masqué ne tient lieu d’autorisation serveur.

## 8. Design system noir, blanc et or

Tokens : noir #0B0B0D ; blanc #FFFFFF ; or principal #D4AF37 ; or sombre #806000 ; or doux #F7F0D8 ; fond #F7F7F8 ; texte #17171A ; secondaire #55555E ; bordure #D6D6DC. États fonctionnels limités : erreur #B42318, succès #17633B, info #175CD3.

Bouton or avec texte noir ; longs textes noir sur blanc. Pas de petit texte or clair sur blanc. Tester les contrastes effectifs des états normal/hover/focus/disabled ; un code HEX seul ne prouve pas la conformité. Ne pas communiquer un statut uniquement par couleur.

Inter auto-hébergée ; courant 16 px, interligne 1,5 ; espacements 4/8/12/16/24/32/48/64 ; rayons 8 et 12 ; breakpoints 640/768/1024/1280. Cibles tactiles internes visées 44×44 px ; reduced-motion respecté.

Composants Radix : boutons, formulaires, dialogues, onglets, menus, popovers et notifications ; compléter uploader, badges textuels, tableaux paginés, sélecteur date/fuseau, aperçu, calendrier avec alternative liste. Site commercial plus sombre ; éditeur et calendrier majoritairement clairs.

Cible WCAG 2.2 AA avec tests automatiques et revue manuelle clavier/lecteur d’écran. L’objectif n’est pas une certification ; conserver résultats et corrections.

## 9. Architecture et choix techniques

Stack retenue : TypeScript, Next.js/React, Tailwind/Radix, next-intl, Zod, PostgreSQL, Drizzle, Cognito, workers Node.js/SQS, S3 privé, SES, Stripe, adaptateur OpenAI configurable, rendu modèles isolé, ECS Fargate, Secrets Manager, KMS, CloudWatch, Sentry filtré, Terraform et GitHub Actions. Versions stables supportées figées au démarrage ; pas de preview critique.

Monolithe modulaire, web et workers déployables séparément. Pas de Kubernetes ni de microservices par fonctionnalité. Modules : identity, organizations, brands, assets, content, approvals, publishing, integrations, billing, entitlements, notifications, production, reporting, audit, privacy.

Flux : navigateur → services web → PostgreSQL et outbox ; outbox → SQS → workers → IA/rendu/réseaux/email. Stripe → signature et événement durable → worker de projection. Pas de publication dans une requête HTTP longue ni dans un timer navigateur.

Région cible AWS Canada Central, sous réserve de disponibilité des services. Fournisseurs externes peuvent traiter hors Canada ; aucune promesse de résidence intégrale sans vérification contractuelle.

Monorepo pnpm : apps/web, apps/worker, packages/domain, db, auth, ui, i18n, integrations, observability, test-utils ; infra/terraform ; docs/architecture, decisions, api, runbooks, privacy, qa, execution.

Local Docker Compose : PostgreSQL, S3 simulé, queue simulée, boîte email ; adaptateurs fake déterministes pour auth, Stripe, IA et réseaux. Sans compte cloud, installation et tests métier doivent fonctionner. Mode fake formellement refusé au démarrage en production.

Scripts à créer : pnpm lint, typecheck, test, test:db, test:contracts, test:e2e, i18n:check, build, dev:infra, db:migrate, db:seed, dev. README reproductible, lockfile et seed. Staging et production séparés ; pas de copie de données réelles non anonymisées.

## 10. Modèle de données et isolation

Conventions : UUID ; timestamptz ; organization_id sur données locataires ; montants entiers en unités mineures ; contraintes étrangères composites empêchant les liens inter-tenant ; version pour concurrence ; révisions immuables ; JSON validé par schéma.

User(id,auth_subject unique,email,ui_locale,status) ; Organization(id,name,default_locale,status) ; Membership(organization_id,user_id,role, couple unique) ; Invitation(email,organization_id,role,expires_at,token_hash) ; Brand(id,organization_id,name,timezone,profile_version,status).

BrandGuideline(brand_id,version,facts_json,tone_json) ; BrandAsset(brand_id,media_asset_id,usage_role) ; MediaAsset(id,organization_id,storage_key unique,mime,bytes,sha256,width,height,rights_status,status) ; SocialConnection(id,brand_id,provider,external_account_id,status,secret_ref,capabilities_snapshot,checked_at).

ContentPlan(id,brand_id,period_start/end,status) ; ContentItem(id,plan_id,topic,summary_status,source_fact_ids,version) ; ContentVariant(id,content_item_id,provider,locale,current_revision_id) ; Revision(id,variant_id,number,caption,media_manifest,hash,author_id) ; Approval(id,revision_id,connection_id,actor_id,approved_at,invalidated_at) ; Comment(id,content_item_id,revision_id,body,author_id).

Publication(id,revision_id,connection_id,scheduled_at,timezone,status,external_id,quota_reservation_id,lease_until,cancel_requested_at,next_attempt_at) ; PublishingAttempt(id,publication_id,attempt_number,request_key,started_at,finished_at,outcome,safe_error_code).

Plan(code,version,entitlements_json) ; Subscription(organization_id,external_id unique,plan_version,status,current_period_start/end,grace_until) ; BillingCycle(id,organization_id,starts_at,ends_at) ; Entitlement(key,limit,effective_from/to) ; UsageReservation(cycle_id,type,quantity,resource_id,status) ; UsageLedger(cycle_id,type,delta,dedupe_key unique,reservation_id) ; InvoiceReference(organization_id,external_invoice_id,status).

Notification(user_id,locale,type,payload,read_at,delivery_key unique) ; AuditEvent(actor_id,organization_id,action,target,safe_metadata,date) ; AIJob(brand_id,content_item_id,prompt_version,status,usage,cost_estimate,model) ; AnalyticsSnapshot(connection_id,publication_id,metric,value,captured_at,source_definition).

OutboxEvent(type,aggregate_id,payload,created_at,dispatched_at) ; WebhookEvent(provider,external_event_id unique par fournisseur,status,received_at,payload_ref) ; StaffAssignment(user_id,brand_id,role,valid_until) ; SupportGrant(actor_id,organization_id,reason,expires_at) ; PrivacyRequest(organization_id,type,status,requested_by,verified_at).

RLS obligatoire en plus des contrôles applicatifs. Rôle runtime non propriétaire des tables, sans BYPASSRLS ; SET LOCAL de contexte dans chaque transaction, jamais état durable d’une connexion poolée. Contexte absent = refus. Workers avec organisation explicite. Rôle migrations séparé et inaccessible au runtime. Tables globales User/Plan ont politiques adaptées.

Unicité variante sujet/réseau/locale et numéro de révision par variante ; indexes publication état/next_attempt et organisation/date ; audit organisation/date. Transactions critiques : quota+job+outbox ; révision+invalidation+blocage ; approbation+version ; réservation+droits ; webhook+outbox. Ledger append-only, allocations verrouillées avant calcul de capacité.

## 11. Contrats API et tâches asynchrones

API /api/v1, JSON, session serveur, CSRF/origin sur mutations navigateur, Zod, pagination curseur, ISO UTC, Idempotency-Key sur créations coûteuses, 409 version obsolète, 422 règle métier et 429 limite. Ne pas divulguer existence d’un objet d’un autre tenant ; politique 403/404 cohérente.

Erreur : error.code, messageKey, requestId, details expurgés. OpenAPI 3.1 et tests de contrat. organization_id fourni par navigateur n’est jamais preuve d’autorisation.

Routes : GET/POST /organizations ; POST /organizations/{id}/invitations ; GET/PATCH /brands/{id} ; POST /brands/{id}/assets/uploads ; POST /assets/{id}/complete ; POST /brands/{id}/content-plans ; POST /content-plans/{id}/generate ; GET/PATCH /content-items/{id} ; POST /variants/{id}/revisions ; POST /variants/{id}/approvals ; POST /variants/{id}/change-requests ; POST /content-items/{id}/comments ; GET /calendar.

POST /publications ; GET /publications/{id} ; POST /publications/{id}/cancel ; POST /publications/{id}/retry ; POST /social-connections/{provider}/authorize ; GET /social-connections/{provider}/callback ; DELETE /social-connections/{id} ; POST /billing/checkout ; POST /billing/portal ; POST /webhooks/stripe ; POST /privacy/export ; POST /privacy/deletion ; GET /notifications.

Programmation : revisionId, socialConnectionId, scheduledAt, displayTimezone, expectedRevisionHash. Réponse : id, scheduled, scheduledAt, quotaReservationId. Génération répond 202 avec jobId et suivi borné par polling. Même Idempotency-Key et même payload renvoient ressource existante ; payload différent = conflit.

Deux générations concurrentes par organisation ; images JPEG/PNG/WebP, 20 Mo maximum ; limites pixels et MIME réel ; pas de SVG client. Rate limits par utilisateur/organisation/IP. Webhooks signés gérés séparément.

Outbox transactionnelle, file livrée au moins une fois, consommateurs idempotents, dispatcher minute, sélection SKIP LOCKED, leases expirantes. Avant appel : recharger droits, approbation, compte, média et annulation. Ne pas maintenir transaction SQL longue pendant appel réseau.

Résultats : confirmed, processing, rejected, unknown. Timeout après émission possible = unknown, réservation conservée et réconciliation. Backoff exponentiel avec aléa, cinq tentatives éligibles, respect Retry-After. Permission invalide → reconnexion ; média invalide → correction ; incertain → pas de renvoi aveugle. DLQ avec procédure opérateur. Aucun « exactly once » universel promis.

## 12. Réseaux, IA et modèles visuels

Facebook Pages et Instagram professionnel : vérifier le parcours de login actuel, comptes éligibles, tâches/scopes, revue, formats, tailles, limites, tokens, identifiants, révocation et conditions de conservation. Ne pas mélanger prérequis des différents parcours Meta. LinkedIn Pages : Community Management soumis à accès/revue ; feature flag fermé avant preuve réelle.

SocialPublisher : getCapabilities, validateMedia, publish, reconcile, disconnect. OAuthConnector : authorize, callback, refreshIfSupported, revokeIfSupported. Manifestes de capacités versionnés avec source officielle/date. Endpoints fournisseurs à documenter depuis sources, pas à inventer à partir de nos routes.

Programmer via nos workers. Médias privés ; si URL externe requise, accès limité compatible avec téléchargement différé. Repli : export légende+média et rappel manuel, confirmation identifiée comme manuelle ; pas de succès API inventé. Pas de mots de passe, scraping ou navigateur simulé pour contourner une revue.

IA : contexte de faits approuvés, ton, objectif, langue, réseau, interdits et historique ; prompt versionné ; sortie topic, locale, caption, callToAction, visualBrief, usedFactIds, warnings, requiresHumanReview. Validation indépendante du prompt. Pas d’invention de prix, horaires, témoignages, adresses ou résultats.

Données importées non fiables et distinctes des instructions. Au MVP pas de fetch libre de sites. Paramètres de rétention fournisseur et contrat à vérifier. Coûts, modèle, version prompt et durée suivis ; sorties invalides bornées, saisie manuelle possible en panne. Pas de bascule vers fournisseur non approuvé.

Visuels : 12 modèles initiaux carrés/portrait, photos autorisées, slots courts, marges, détection de débordement, rendu isolé sans réseau libre, ressources internes seulement. Images génératives en évolution et non dépendance critique.

## 13. Paiement, sécurité et protection des données

Stripe Checkout/Billing/portail ; aucune carte en base. Prix autorisés côté serveur. Signature webhook sur corps brut, stockage event_id unique et persistance durable avant acquittement, traitement asynchrone ; événements potentiellement dupliqués et désordonnés. Réconciliation périodique ; redirection de paiement jamais preuve suffisante.

TLS ; cookies HttpOnly/Secure/SameSite adaptés ; CSRF ; CSP ; validation serveur ; MFA privilégié ; secrets dans Secrets Manager ; tokens chiffrés KMS et jamais exposés au navigateur/logs/Sentry. Rôles cloud minimaux, URLs signées courtes, rotation documentée.

Upload : quarantaine, octets/MIME/pixels, scan, décodage/réencodage et suppression métadonnées inutiles ; aucun média non validé publiable. SSRF et réseau privé bloqués si imports ajoutés. Modèle de menace : tenant, sessions, rôles, faux webhooks, tokens, doublons, uploads, prompt injection, logs et abus de coûts.

Politique FR/EN, finalités, consentement marketing séparé, minimisation, sous-traitants, accès/correction/export/suppression, incidents. Examiner PIPEDA et lois provinciales dont Québec avec professionnel ; pas de certification juridique universelle. UE hors lancement jusqu’à cadrage RGPD. Localisation cloud ne garantit pas résidence de toutes données externes.

Conservation proposée : contenus pendant abonnement ; 30 jours d’accès après expiration ; suppression active sous 30 jours de demande vérifiée ; backups roulants 35 jours ; logs 30 jours ; audit sécurité 12 mois ; comptabilité durée légale ; données plateformes selon leurs conditions si plus restrictives.

Suppression : réauthentification, blocage immédiat des envois, révocation possible, annulation jobs, suppression active, expiration des backups. Registre minimal anti-réactivation lors d’une restauration. Export JSON/CSV et médias via archive privée expirante. Les publications externes ne sont pas supprimées automatiquement.

## 14. Qualité, exploitation et objectifs non fonctionnels

Objectifs internes : disponibilité 99,5 % mensuel ; API ordinaire p95 sous 800 ms hors fournisseurs ; dashboard sous 2,5 s dans conditions définies ; génération unitaire 95 % sous 120 s hors incident ; 99 % des dispatchs éligibles commencés sous deux minutes. Confirmation sociale mesurée séparément. Cible 500 organisations et 25 000 publications/mois. RPO 15 min et RTO 4 h à démontrer, pas SLA acquis.

Suivre âge queue, retard, erreurs par fournisseur, unknown, tokens expirés, coût IA, webhooks, pool SQL, suppressions en retard et accès refusés. Alertes avec responsables et runbooks. Kill switch global et par réseau. P1 fuite ou publications massivement incorrectes → suspension ; P2 réseau indisponible → isolation ; obligations de notification revues juridiquement.

Backups chiffrés ; exercice de restauration avant lancement puis trimestriel. Migrations expand/migrate/contract ; rollback application sans restauration destructive ordinaire. Deux dernières versions stables de navigateurs et tests Safari iOS/Chrome Android. Support initial Essentiel sous deux jours ouvrables.

Vitest, intégrations SQL réelles/RLS, Playwright E2E, contrats fournisseurs, traductions, accessibilité automatique et manuelle, sécurité, charge, restauration et évaluations IA FR/EN. Seeds : organisations A/B, rôles différents, marque FR/EN, connexion valide/expirée, approbation obsolète, impayé et unknown.

Tests critiques : cross-tenant refusé ; dernier crédit concurrent unique ; ancien hash non publiable ; webhook dupliqué sans crédit ; timeout après envoi sans renvoi aveugle ; annulation en vol honnête ; heure DST invalide clarifiée ; suppression empêchant nouveau dispatch ; support expiré refusé.

Definition of Ready : story, exigences, dépendances, contrats et critères connus. Done : code, migrations, permissions, FR/EN, tests exécutés, erreurs, télémétrie et docs ; aucun défaut critique connu non traité. Test ignoré ou non exécuté n’est pas succès.

## 15. Feuille de route — 25 lots exécutables

Pour chaque lot, lire les prérequis, écrire les tests, implémenter, exécuter les commandes et consigner les résultats. Statuts : NOT_STARTED, IN_PROGRESS, BLOCKED_EXTERNAL, READY_FOR_REVIEW, VERIFIED_LOCAL, VERIFIED_LIVE. Le succès fake ne prouve pas une intégration réelle.

Chaque story contient exigence liée, rôle, valeur, périmètre, contrats, migrations, critères Given/When/Then, tests, télémétrie et rollback. Découper les lots en stories verticales. Ne pas paralléliser des migrations ou contrats partagés sans responsable d’intégration.

### E00 — Contrat, backlog et décisions
Prérequis : Aucune.
Exécution : Créer matrice exigences/stories, registre risques, hypothèses et ADR stack/quotas. Choisir et figer versions stables compatibles.
Livrables et validation : Backlog P0 complet, ADR, journal statut. Chaque exigence P0 reliée à une story ; aucun accès fournisseur présumé.

### E01 — Monorepo et qualité de base
Prérequis : E00.
Exécution : Créer pnpm workspaces, apps/web et worker, packages, TypeScript strict, lint, Vitest, Playwright, scripts, lockfile et CI.
Livrables et validation : Installation propre, lint/typecheck/tests/build exécutés depuis checkout neuf ; README reproductible.

### E02 — Local et simulateurs
Prérequis : E01.
Exécution : Docker Compose PostgreSQL, stockage et queue simulés, boîte email ; interfaces fournisseurs et fakes déterministes, succès/échec/timeout.
Livrables et validation : Application testable sans secret ; production refuse fake ; contrats de simulateurs verts.

### E03 — Spikes sociaux et approbations
Prérequis : E00/E02, identifiants autorisés pour essais réels.
Exécution : Prouver compte éligible, OAuth, image test, identifiant, token, révocation et réconciliation. Relever scopes/limites/version depuis sources officielles.
Livrables et validation : Manifestes par réseau et preuve expurgée ; sinon BLOCKED_EXTERNAL. Ne jamais publier sur compte client sans accord.

### E04 — Base, migrations et isolation
Prérequis : E01/E02.
Exécution : Créer schéma, contraintes composites, indexes, rôles SQL, RLS et contexte transactionnel ; seed A/B.
Livrables et validation : Tests SQL réels : contexte absent, pooling, FK cross-tenant et lecture B par A refusés. Pas de routes métier avant gate isolation.

### E05 — Auth, équipe et RBAC
Prérequis : E04.
Exécution : Auth fake local puis Cognito, sessions, récupération, vérification, invitations, transfert et MFA privilégié.
Livrables et validation : Tests compte non vérifié, invitation expirée, dernier propriétaire, révocation et fake interdit en prod ; moteur droits serveur.

### E06 — UI, traduction et navigation
Prérequis : E01/E05.
Exécution : Tokens noir/blanc/or, composants accessibles, layout, locales, pages /fr /en, sélecteurs et états UI.
Livrables et validation : Parité des traductions, clavier, contrastes, mobile 375 px et desktop ; aucune chaîne client non localisée.

### E07 — Abonnement et droits
Prérequis : E04/E05/E06.
Exécution : Plans versionnés, Checkout/portail, webhook signé, déduplication, projection, grâce, upgrade/downgrade et réconciliation.
Livrables et validation : Doublons/désordre, page succès sans paiement, impayé et delta de droits testés ; aucun paiement live sans accord.

### E08 — Quotas et ledger
Prérequis : E04/E07.
Exécution : Réservations, consommation/libération, verrous, idempotence et cycles ; jobs partiels et unknown conservés.
Livrables et validation : 50 demandes concurrentes sur dernier crédit : une seule autorisée ; pas de double débit ; période future refusée au MVP.

### E09 — Onboarding et profil
Prérequis : E05/E06/E08.
Exécution : Formulaire reprenable, faits validés/datés, ton, langue, fuseau et versions de profil.
Livrables et validation : Reprise, champs requis, promotions expirées et indépendance UI/contenu testées.

### E10 — Médias privés
Prérequis : E04/E06/E09.
Exécution : Quarantaine upload, validation, scan/réencodage, droits d’usage, URLs expirantes et nettoyage orphelins.
Livrables et validation : Vrais JPEG/PNG/WebP, faux MIME, gros pixels, cross-tenant et expiration ; média non validé non publiable.

### E11 — Contenus et révisions
Prérequis : E04/E06/E09/E10.
Exécution : Plans, sujets, variantes, versions immuables, commentaires et machines à états ; concurrence optimiste.
Livrables et validation : 409 version obsolète, séparation FR/EN, historique conservé et accès commentaires isolé.

### E12 — Outbox et workers
Prérequis : E02/E04/E08.
Exécution : Outbox transactionnelle, dispatcher, queues, consommateurs idempotents, leases, DLQ et IDs de corrélation.
Livrables et validation : Crash avant/après enqueue, livraison multiple et lease expirée testés sans perte ni double charge.

### E13 — IA et évaluations
Prérequis : E08/E09/E11/E12.
Exécution : Contexte de marque, prompts versionnés, JSON validé, faits/langue, lots partiels, régénérations, coûts et fallback manuel.
Livrables et validation : Corpus FR/EN : info absente, prix inventé, injection, promo expirée, panne et quota ; erreurs techniques sans débit indu.

### E14 — Templates et rendu
Prérequis : E10/E11/E12.
Exécution : Douze modèles carré/portrait, photo/logo, slots courts, débordements, rendu isolé sans URL libre.
Livrables et validation : Snapshots texte FR long, logo absent, photo verticale et réseau interdit ; rendu déterministe.

### E15 — Approbation et production
Prérequis : E05/E11/E13/E14.
Exécution : Approval hash/version/destination, corrections, revue interne affectée, rappels et emails FR/EN.
Livrables et validation : Modification suspend l’envoi, producteur sans approbation client, notifications autorisées/dédupliquées ; silence non accepté.

### E16 — Calendrier et programmation
Prérequis : E08/E11/E15.
Exécution : Calendrier/liste mobile, UTC/IANA, DST, réservation dans période acquise, reprogrammation et annulation.
Livrables et validation : Heures ambiguës/inexistantes, quota, fait expiré, approbation et période hors droits testés ; scheduled distinct de published.

### E17 — Meta et reconnexion
Prérequis : E03 Meta prouvé, E10/E12/E16.
Exécution : Implémenter parcours OAuth vérifié, tokens chiffrés, capacités, image, processing, réconciliation et révocation.
Livrables et validation : Contrats et essais réels autorisés : succès, droits refusés, token expiré, média invalide et timeout. Sans preuve, flag fermé.

### E18 — Publication fiable
Prérequis : E12/E15/E16/E17.
Exécution : Dispatcher minute, leases, contrôles au dispatch, tentatives, backoff, unknown, annulation concurrente, réconciliation et kill switch.
Livrables et validation : Crash après acceptation, doublon queue, impayé en attente et unknown sans renvoi ; consommation quota unique ; gate critique avant pilote.

### E19 — LinkedIn et export manuel
Prérequis : E18 ; E03 LinkedIn si accès approuvé.
Exécution : Export média/légende et rappels ; confirmation manuelle distincte ; LinkedIn uniquement après accès vérifié et feature flag.
Livrables et validation : Export privé expirant et contrats fake ; publication réelle autorisée seulement après accès. Lancement deux réseaux possible sans LinkedIn.

### E20 — Rapports, support et administration
Prérequis : E05/E15/E18.
Exécution : Rapports statuts/erreurs/liens, console incidents, coûts, affectations, accès support temporaire et audit.
Livrables et validation : Grant expiré refusé ; erreurs sans secrets ; métrique indisponible non transformée en zéro ; admin sans bypass approbation.

### E21 — Export, suppression et rétention
Prérequis : E10/E12/E18/E20.
Exécution : Demande sensible vérifiée, archive JSON/CSV+médias, blocage immédiat, révocation, effacement et registre anti-réactivation.
Livrables et validation : Ancien job après suppression sans appel ; archive sans autre tenant ; expiration liens ; restauration respectant suppressions.

### E22 — Durcissement et recette
Prérequis : E06–E21.
Exécution : Suite complète, isolation, auth, uploads, secrets, dépendances, clavier/lecteur écran, charge et corpus IA.
Livrables et validation : Rapports preuves/exigences ; tests déterministes verts ; aucun défaut critique ; distinguer fake, sandbox, live et NOT_RUN.

### E23 — Staging, CI/CD et restauration
Prérequis : E22, budget/comptes autorisés.
Exécution : Terraform, secrets, HTTPS, logs, backup/alertes, déploiement staging, migrations compatibles et rollback.
Livrables et validation : Plan Terraform approuvé avant apply ; rotation et restauration chronométrées ; production refuse fake ; runbooks et coûts fixes.

### E24 — Pilote et livraison
Prérequis : E23, contrats et accès validés.
Exécution : 20–30 pilotes autorisés, deux cycles observés, mesure coûts/support/qualité, corrections et décision go/no-go.
Livrables et validation : Transfert code/comptes/docs au propriétaire, validation FR/EN, paiement/publication réels autorisés, promesses alignées ; pas de public si risque critique.

## 16. Calendrier, dépendances et organisation

Budget de planification : 16 à 22 semaines pour une petite équipe expérimentée avec chevauchements, hors approbations externes et observation complète des deux cycles pilotes. L’IA ne supprime ni les revues, ni les accès, ni les preuves.

Semaines 1–3 : E00–E04 et spikes E03 ; 3–6 : auth/UI/billing/quotas/marque/médias ; 6–10 : contenus/jobs/IA/templates/approbation ; 10–14 : calendrier/connecteurs/publication/rapports ; 14–18 : privacy, sécurité, staging ; 18–22 : stabilisation pilote initiale. Deux cycles d’observation peuvent dépasser cette fenêtre.

Équipe : responsable produit partiel, designer bilingue, deux full-stack dont un lead, QA renforcé avant lancement, DevOps/sécurité ponctuel et responsable éditorial. Refaire estimation après spikes et schéma.

Chemin critique : isolation → droits/quotas → marque/contenu → révision/approbation → calendrier → connecteur prouvé → publication résiliente → suppression/recette → staging/pilote. E03 commence tôt ; design system peut avancer parallèlement ; LinkedIn reste conditionnel. Après fusion de branches, exécuter suite intégrée entière.

CI : lint/types → unités → SQL/RLS → contrats → traductions → sécurité → build → staging → migrations compatibles → E2E → validation humaine → production autorisée → smoke tests/surveillance. Pas de migration destructive sans plan et accord.

## 17. Instructions au AI code builder

PROMPT INITIAL : Tu es l’agent de réalisation de [Brand Name]. Lis l’ensemble du dossier et inspecte le dépôt avant de coder. Construis une application fonctionnelle, pas une maquette. Respecte les décisions, lots E00–E24, critères et gates. Commence par E00 puis E01/E02 ; utilise les fakes pour avancer sans secrets. Ne modifie pas quotas, prix, isolation ou approbation sans ADR approuvé. Avant chaque lot, annonce dépendances, fichiers et tests ; ensuite implémente, exécute et corrige. Ne revendique aucun résultat non exécuté. Aucune dépense, publication, paiement, création externe ou déploiement réel sans autorisation explicite.

PROMPT REPRISE : Lis SPECIFICATION.md, docs/execution/status.md et les ADR. Exécute le lot {E_CODE} et ses stories approuvées. Vérifie prérequis et écarts, maintiens FR/EN, autorisations et tests. Termine par un rapport factuel. Un accès externe absent est BLOCKED_EXTERNAL, pas une fonctionnalité réussie ; poursuivre uniquement les modules indépendants.

RAPPORT : lot/stories, commit, environnement, dépendances, fichiers, migrations, commandes avec codes de sortie, tests réussis/échoués/ignorés, build, preuves manuelles, limites, risques, ADR, autorisations attendues et prochain lot éligible. Sans exécution possible : NOT_RUN et raison. Stocker docs/execution/reports/E##_YYYY-MM-DD.md, sans secret.

PROGRESSION : docs/execution/status.md contient E00–E24, statut, responsable, dernier commit, preuve, dépendances et blocages. docs/requirements/traceability.csv contient requirement_id, story_id, screen, entity, endpoint_or_job, test_path, release, status. Test ignoré ≠ succès.

GARDE-FOUS : pas de localStorage comme base métier ; pas de secrets NEXT_PUBLIC_* ; pas d’approved booléen sans version ; pas de timer navigateur pour publication ; pas de retry aveugle après timeout ; pas de tenant client accepté comme permission ; pas de faux témoignages/compteurs ; pas de données clients réelles dans seeds. Mode démo explicitement étiqueté.

## 18. Configuration, contrats et preuves

Configuration sans valeurs secrètes : APP_BASE_URL, APP_ENV, DATABASE_URL, AWS_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, S3_BUCKET_PRIVATE, SQS_GENERATION_QUEUE_URL, SQS_PUBLISHING_QUEUE_URL, KMS_TOKEN_KEY_ID, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, META_APP_ID, META_APP_SECRET, META_API_VERSION, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_API_VERSION, AI_PROVIDER, AI_MODEL_TEXT, AI_API_KEY, SES_FROM_EMAIL, SENTRY_DSN, ADAPTER_MODE, AUTH_MODE.

Valider au démarrage selon capacités actives. Mode live incomplet échoue explicitement ; connecteur désactivé ne bloque pas la compilation. Secrets dans gestionnaire dédié et .env.example sans valeurs réelles.

Algorithme programmation : transaction tenant → verrou allocation → rôle et abonnement → révision+hash approuvé → validité faits/média/date → réservation → Publication scheduled → audit/outbox → commit. Idempotence liée à empreinte de requête.

Algorithme dispatch : lease → rechargement état/droits → annulation et hash → tentative persistée → appel hors transaction longue → résultat en nouvelle transaction → consommation au confirmed, conservation au unknown, correction/reprise au rejected selon classe. Ne pas prétendre une atomicité entre base et réseau.

Seeds : entreprises fictives A/B, langues FR/EN, rôles, média autorisé, connexion valide/expirée, impayé, approval obsolète et unknown. La première démonstration locale couvre compte → organisation → marque → génération simulée → révision → approbation → calendrier → publication simulée → quota → rapport, explicitement marquée comme simulation.

## 19. Risques, ADR et traçabilité

ADR requis : stack/versions, unités et cycles, RLS, sessions/auth, outbox/leases, hash d’approbation, période acquise, parcours Meta prouvé, LinkedIn, régions/sous-traitants, rétention, prix/économie, kill switch et migrations. Format : contexte, options, décision, conséquences, date, propriétaire, statut.

Risques : LinkedIn non approuvé → deux réseaux et export ; API Meta changée → version et suivi ; hallucination → faits+revue ; double publication → unknown/réconciliation ; support cher → temps mesuré et plans ; qualité générique → vrais médias et modèles sectoriels ; fuite tenant → RLS/tests ; approbation tardive → pas d’envoi obsolète ; coûts fixes → budget cloud ; backups → rétention/tombstones.

Traçabilité : BRAND-01/AI-01 → E09/E13 → Guidelines/AIJob/ContentItem et corpus FR/EN. APPROVAL-01/PUB-01 → E15/E18 → Revision/Approval/Publication et hash obsolète. ORG-01 → E04/E05 → Membership/RLS et tests cross-tenant. BILL-01/QUOTA-01 → E07/E08 → Subscription/Ledger et concurrence. PUB-02 → E18 → Attempts et timeout. DATA-01 → E21 → privacy jobs et suppression/restauration.

Remise : dépôt/historique, comptes société, droits administrateurs, inventaire secrets sans valeurs en clair, README, schéma/migrations, OpenAPI, maquettes/composants, traductions, tests/preuves, Terraform, runbooks, coûts, sous-traitants et rapport pilote. Aucun compte critique au seul nom d’un prestataire.

## 20. Gates d’ouverture et checklist

GATE A LOCAL : installation propre et build/test verts sans secrets ; isolation, quotas et approbation prouvés ; fake interdit en production ; parcours FR/EN complet et export manuel. Aucun succès live revendiqué.

GATE B STAGING : OAuth et publication test réelle de chaque réseau activé ; Stripe sandbox ; signatures ; reconnexion ; média privé compatible ; unknown et reprise ; logs/alertes ; restauration chronométrée ; audit sécurité/accessibilité ; version/limites documentées.

GATE C PILOTE : entité, contrats, confidentialité, fiscalité et sous-traitants revus ; accès sociaux pour population cible ; budget approuvé ; responsabilités incident ; kill switch ; aucune vulnérabilité critique connue non traitée ; essais réels autorisés.

GATE D PUBLIC : deux cycles analysés, coûts/support mesurés, promesses alignées, P0 résolus, transfert fait et décision go/no-go écrite. Absence de preuve marquée manquante, jamais extrapolée.

Checklist propriétaire : nom/marque disponibles ; plans et devise validés ; comptes fournisseurs société ; langues testées ; paiement/annulation/impayés ; quotas concurrentiels ; approbation non contournable ; révocation ; doublons/timeouts ; cross-tenant ; secrets ; export/suppression ; restauration ; alertes ; pilote ; marge réelle.

Ce dossier permet de commencer la construction ; il ne remplace ni accord légal, ni approbation de plateforme, ni test réussi sur infrastructure réelle.

## 21. Sources externes et vérifications à renouveler

Références du cadrage du 28 octobre 2026. Les capacités courantes doivent être rouvertes, vérifiées et consignées lors d’E03, notamment scopes, comptes éligibles, formats, limites, rétention et versions. Ce dossier ne fige pas de valeurs non prouvées.

Meta Instagram Content Publishing : https://developers.facebook.com/documentation/instagram-platform/content-publishing/ . Parcours de plateforme : https://developers.facebook.com/documentation/instagram-platform.md/ . Le parcours exact reste à confirmer par spike ; ne pas mélanger prérequis de logins différents.

Meta Pages API Posts : https://developers.facebook.com/docs/pages-api/posts/ . Vérifier tâches et permissions effectivement accessibles.

LinkedIn Community Management : https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview ; revue : https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review . Accès soumis à validation externe.

Stripe : https://docs.stripe.com/webhooks et https://docs.stripe.com/billing/subscriptions/webhooks . Signature corps brut, doublons et ordre non garanti guident le traitement robuste.

W3C : https://www.w3.org/WAI/perspective-videos/contrast/ et https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/ . La cible du projet demeure WCAG 2.2 AA à tester sur le produit.

Commissariat canadien, consentement : https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/collecting-personal-information-and-consent/consent/gl_omc_201805/ . Applicabilité juridique à examiner professionnellement.

Référence métier : annonce fournie dans la conversation, 15 posts et trois plateformes à 75 $/mois. Ne pas reprendre marque, témoignages, compteur de clients ou garantie d’engagement. La devise CAD est un choix du projet, pas une information démontrée par le signe $ de l’annonce.
