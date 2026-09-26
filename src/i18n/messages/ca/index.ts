import { deepMerge, type Messages } from "../merge";
import core from "./core.json";
import auth from "./auth.json";
import settings from "./settings.json";

const messages: Messages = deepMerge(core, auth, settings);

export default messages;
