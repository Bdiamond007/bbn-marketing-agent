import type { Locale, Namespace } from "./index";
import frCommon from "../messages/fr-CA/common.json" with { type: "json" };
import frAuth from "../messages/fr-CA/auth.json" with { type: "json" };
import frOnboarding from "../messages/fr-CA/onboarding.json" with { type: "json" };
import frBrand from "../messages/fr-CA/brand.json" with { type: "json" };
import frContent from "../messages/fr-CA/content.json" with { type: "json" };
import frCalendar from "../messages/fr-CA/calendar.json" with { type: "json" };
import frIntegrations from "../messages/fr-CA/integrations.json" with { type: "json" };
import frBilling from "../messages/fr-CA/billing.json" with { type: "json" };
import frNotifications from "../messages/fr-CA/notifications.json" with { type: "json" };
import frErrors from "../messages/fr-CA/errors.json" with { type: "json" };
import frAdmin from "../messages/fr-CA/admin.json" with { type: "json" };
import enCommon from "../messages/en-CA/common.json" with { type: "json" };
import enAuth from "../messages/en-CA/auth.json" with { type: "json" };
import enOnboarding from "../messages/en-CA/onboarding.json" with { type: "json" };
import enBrand from "../messages/en-CA/brand.json" with { type: "json" };
import enContent from "../messages/en-CA/content.json" with { type: "json" };
import enCalendar from "../messages/en-CA/calendar.json" with { type: "json" };
import enIntegrations from "../messages/en-CA/integrations.json" with { type: "json" };
import enBilling from "../messages/en-CA/billing.json" with { type: "json" };
import enNotifications from "../messages/en-CA/notifications.json" with { type: "json" };
import enErrors from "../messages/en-CA/errors.json" with { type: "json" };
import enAdmin from "../messages/en-CA/admin.json" with { type: "json" };

type Catalog = Record<Namespace, Record<string, unknown>>;

export const catalogs: Record<Locale, Catalog> = {
  "fr-CA": {
    common: frCommon, auth: frAuth, onboarding: frOnboarding, brand: frBrand, content: frContent, calendar: frCalendar,
    integrations: frIntegrations, billing: frBilling, notifications: frNotifications, errors: frErrors, admin: frAdmin,
  },
  "en-CA": {
    common: enCommon, auth: enAuth, onboarding: enOnboarding, brand: enBrand, content: enContent, calendar: enCalendar,
    integrations: enIntegrations, billing: enBilling, notifications: enNotifications, errors: enErrors, admin: enAdmin,
  },
};
