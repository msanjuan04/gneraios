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
import leads from "./leads.json";
import funnel from "./funnel.json";
import settings_pipeline from "./settings-pipeline.json";
import billing from "./billing.json";
import contracts from "./contracts.json";
import invoices from "./invoices.json";
import seo from "./seo.json";
import quotes from "./quotes.json";
import finance from "./finance.json";
import council from "./council.json";
import dataio from "./dataio.json";
import calendar from "./calendar.json";
import portal from "./portal.json";
import collections from "./collections.json";
import projects from "./projects.json";
import catalog from "./catalog.json";
import banking from "./banking.json";
import reports from "./reports.json";
import sites from "./sites.json";
import profitability from "./profitability.json";
import errors from "./errors.json";
import infrastructure from "./infrastructure.json";
import invoiceImport from "./invoice-import.json";
import vendors from "./vendors.json";
import ads from "./ads.json";
import passwords from "./passwords.json";

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
  leads,
  funnel,
  settings_pipeline,
  billing,
  contracts,
  invoices,
  seo,
  quotes,
  finance,
  council,
  dataio,
  calendar,
  portal,
  collections,
  projects,
  catalog,
  banking,
  reports,
  sites,
  profitability,
  errors,
  infrastructure,
  invoiceImport,
  vendors,
  ads,
  passwords,
);

export default messages;
