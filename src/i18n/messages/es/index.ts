import { deepMerge, type Messages } from "../merge";
import core from "./core.json";
import fiscal from "./fiscal.json";
import auth from "./auth.json";
import onboarding from "./onboarding.json";
import dashboard from "./dashboard.json";
import settings from "./settings.json";
import crm from "./crm.json";
import clients from "./clients.json";
import pipeline from "./pipeline.json";
import funnel from "./funnel.json";
import settings_pipeline from "./settings-pipeline.json";
import billing from "./billing.json";
import contracts from "./contracts.json";
import invoices from "./invoices.json";
import seo from "./seo.json";
import quotes from "./quotes.json";

const messages: Messages = deepMerge(
  core,
  fiscal,
  auth,
  onboarding,
  dashboard,
  settings,
  crm,
  clients,
  pipeline,
  funnel,
  settings_pipeline,
  billing,
  contracts,
  invoices,
  seo,
  quotes,
);

export default messages;
