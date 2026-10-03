import { describe, expect, it } from "vitest";
import { readOrgModules } from "./modules";

describe("módulos de una org", () => {
  it("un módulo solo está activo si lo guardado dice exactamente true", () => {
    expect(readOrgModules({ modules: { council: true } })).toEqual({ council: true });
    expect(readOrgModules({ modules: { council: false } })).toEqual({ council: false });
    // Lo que falta, lo que viene con otra forma y lo que no es un objeto: apagado.
    expect(readOrgModules({ modules: {} })).toEqual({ council: false });
    expect(readOrgModules({ modules: { council: "sí" } })).toEqual({ council: false });
    expect(readOrgModules({})).toEqual({ council: false });
    expect(readOrgModules(null)).toEqual({ council: false });
    expect(readOrgModules("nada")).toEqual({ council: false });
  });
});
