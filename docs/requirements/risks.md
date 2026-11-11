# Registre des risques

Dernière revue : 2026-11-11 (E00). Probabilité / impact : F (faible), M (moyen), É (élevé).

| ID | Risque | P | I | Mitigation | Lot(s) | Responsable | État |
|---|---|---|---|---|---|---|---|
| R01 | Accès LinkedIn Community Management non approuvé | É | M | Lancement deux réseaux (Meta) + export manuel ; flag LinkedIn fermé tant que E03 n'est pas prouvé | E03, E19 | Propriétaire | Ouvert |
| R02 | API Meta modifiée ou parcours de login différent de l'hypothèse | M | É | Version d'API configurable, manifestes de capacités datés et sourcés, contrats re-vérifiés à chaque changement | E03, E17 | Lead technique | Ouvert |
| R03 | Hallucination IA (prix, horaires, témoignages inventés) | É | É | Faits approuvés uniquement, `usedFactIds` validés hors prompt, revue humaine obligatoire, corpus FR/EN | E13 | Lead technique | Ouvert |
| R04 | Double publication après timeout | M | É | Résultat `unknown`, réservation conservée, réconciliation, aucun renvoi aveugle ; simulateur non idempotent pour détecter les régressions | E12, E18 | Lead technique | Mitigation amorcée (simulateur E02) |
| R05 | Coût de support / accompagnement supérieur aux hypothèses | M | É | Temps mesuré par client, enveloppe de 120 min/cycle (plan Accompagné), revue au pilote | E20, E24 | Propriétaire | Ouvert |
| R06 | Qualité générique des contenus | M | M | Vrais médias clients, modèles sectoriels, revue | E13, E14 | Responsable éditorial | Ouvert |
| R07 | Fuite inter-tenant | F | É | RLS forcée + FK composites + contexte transactionnel + tests SQL réels et test de mutation | E04 | Lead technique | Mitigé localement (E04 VERIFIED_LOCAL) |
| R08 | Approbation tardive déclenchant un envoi obsolète | M | M | Revalidation au dispatch (date, faits, hash) | E15, E16, E18 | Lead technique | Ouvert |
| R09 | Coûts fixes cloud supérieurs au budget pilote | M | M | Budget approuvé avant E23, ECS Fargate dimensionné au minimum, alertes de coût | E23 | Propriétaire | Ouvert |
| R10 | Restauration de backup réactivant des données supprimées | F | É | Registre anti-réactivation (tombstones), exercice de restauration | E21, E23 | Lead technique | Ouvert |
| R11 | Outils : drizzle-kit introspecte mal les FK composites | Avéré | F | SQL versionné = source de vérité (ADR-0004), schéma Drizzle post-traité, contraintes testées en base | E04 | Lead technique | Mitigé |
| R12 | Image Docker ou service local non vérifié (pas de démon Docker dans l'environnement de construction) | M | F | `pnpm pg:local` sans Docker pour PostgreSQL ; Compose à valider au premier poste équipé | E02 | Lead technique | Ouvert |
| R13 | Cadre juridique (PIPEDA, Loi 25 Québec, fiscalité) non validé | É | É | Revue par professionnels avant GATE C ; aucune promesse de conformité | E24 | Propriétaire | Ouvert |
| R14 | Prototype statique existant (`index.html`, Cloudflare Workers) exposé avec le code source du dépôt | M | M | `.assetsignore` limite les fichiers servis à `index.html` ; à confirmer au prochain déploiement Cloudflare | E01 | Propriétaire | Mitigation à vérifier |
