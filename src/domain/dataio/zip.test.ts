import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeUtf8 } from "./text";
import { crc32, createZip, safeFileName } from "./zip";

type ReadEntry = { name: string; method: number; data: Uint8Array; crc: number; flags: number };

/** Lector mínimo del directorio central, para comprobar lo que se escribe. */
function readZip(zip: Uint8Array): ReadEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("Sin fin de directorio central");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(zip.subarray(offset + 46, offset + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(local + 26, true);
    const extra = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLength + extra;
    const raw = zip.subarray(start, start + compressed);
    const data = method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;
    entries.push({ name, method, data, crc, flags });
    offset += 46 + nameLength;
  }
  return entries;
}

describe("crc32", () => {
  it("valores de referencia", () => {
    expect(crc32(encodeUtf8(""))).toBe(0);
    expect(crc32(encodeUtf8("123456789"))).toBe(0xcbf43926);
    expect(crc32(encodeUtf8("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("createZip", () => {
  const deflateRaw = (data: Uint8Array) => new Uint8Array(deflateRawSync(data));

  it("guarda las entradas sin comprimir si no hay compresor, con nombres UTF-8", () => {
    const zip = createZip([
      { name: "facturas/2026-0001.pdf", data: encodeUtf8("%PDF-1.7 hola") },
      { name: "léame.txt", data: encodeUtf8("Façana") },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => [e.name, e.method, new TextDecoder().decode(e.data)])).toEqual([
      ["facturas/2026-0001.pdf", 0, "%PDF-1.7 hola"],
      ["léame.txt", 0, "Façana"],
    ]);
    for (const e of entries) {
      expect(e.crc).toBe(crc32(e.data));
      expect(e.flags & 0x0800).toBe(0x0800);
    }
  });

  it("comprime con DEFLATE cuando ahorra y respeta las entradas que no se deben comprimir", () => {
    const text = encodeUtf8("<row>".repeat(500));
    const zip = createZip(
      [
        { name: "a.xml", data: text },
        { name: "b.pdf", data: text, compress: false },
        { name: "c.txt", data: encodeUtf8("x") },
      ],
      { deflateRaw },
    );
    const entries = readZip(zip);
    expect(entries.map((e) => e.method)).toEqual([8, 0, 0]);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe("<row>".repeat(500));
    expect(zip.length).toBeLessThan(text.length * 2);
  });

  it("no admite nombres repetidos", () => {
    expect(() => createZip([{ name: "a", data: new Uint8Array() }, { name: "a", data: new Uint8Array() }])).toThrow();
  });

  it("safeFileName", () => {
    expect(safeFileName("2026/0001: Port\u0000Mataró?.pdf")).toBe("2026_0001_ Port_Mataró_.pdf");
    expect(safeFileName("..\\secreto")).toBe("__secreto");
    expect(safeFileName("")).toBe("fichero");
  });
});
