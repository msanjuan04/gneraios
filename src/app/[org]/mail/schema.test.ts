import { describe, expect, it } from "vitest";
import { connectMailSchema, splitAddresses } from "./schema";

const valid = { address: "info@gnerai.com", display_name: "GNERAI", imap_host: "imap.ionos.es", imap_port: 993, smtp_host: "smtp.ionos.es", smtp_port: 465, username: "info@gnerai.com", password: "secreto-largo" };

describe("conectar el buzón", () => {
  it("acepta los datos de IONOS", () => {
    expect(connectMailSchema.safeParse(valid).success).toBe(true);
  });

  it("no deja apuntar el servidor a la red interna ni a una IP", () => {
    for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "db.internal", "servidor.local", "169.254.169.254", "imap"]) {
      expect(connectMailSchema.safeParse({ ...valid, imap_host: host }).success, host).toBe(false);
    }
  });

  it("la contraseña no se recorta ni se toca", () => {
    const parsed = connectMailSchema.parse({ ...valid, password: "  con espacios  " });
    expect(parsed.password).toBe("  con espacios  ");
  });

  it("una dirección mal escrita se rechaza", () => {
    expect(connectMailSchema.safeParse({ ...valid, address: "no-es-correo" }).success).toBe(false);
  });
});

describe("las direcciones escritas a mano", () => {
  it("se separan por coma, punto y coma o espacios", () => {
    expect(splitAddresses("a@x.com, b@x.com;c@x.com  d@x.com")).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
  });
});
