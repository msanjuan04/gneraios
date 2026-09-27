// ZIP mínimo (PKWARE APPNOTE 6.3): entradas guardadas o comprimidas con DEFLATE, nombres en UTF-8,
// sin ZIP64 (menos de 4 GB y de 65 535 entradas). Sirve para el XLSX (que es un ZIP de XML) y para
// el paquete de PDFs de la gestoría. El dominio no comprime: quien lo llama puede pasar un
// `deflateRaw` (en el servidor, el de node:zlib); si no, las entradas se guardan sin comprimir.

import { encodeUtf8 } from "./text";

export type ZipEntry = {
  /** Ruta dentro del ZIP, con "/" como separador. */
  name: string;
  data: Uint8Array;
  /** Comprimir esta entrada si hay compresor (los PDF ya van comprimidos: mejor guardarlos). */
  compress?: boolean;
};

export type ZipOptions = {
  /** DEFLATE sin cabecera (RFC 1951), p. ej. `zlib.deflateRawSync`. */
  deflateRaw?: (data: Uint8Array) => Uint8Array;
  /** Fecha y hora de modificación de las entradas (hora local de la org). Por defecto, 01/01/2000. */
  modified?: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number };
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (polinomio 0xEDB88320), el que usa ZIP. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(modified: ZipOptions["modified"]): { time: number; date: number } {
  const m = modified ?? { year: 2000, month: 1, day: 1 };
  const year = Math.min(Math.max(m.year, 1980), 2107);
  const time = ((m.hour ?? 0) << 11) | ((m.minute ?? 0) << 5) | Math.floor((m.second ?? 0) / 2);
  const date = ((year - 1980) << 9) | (m.month << 5) | m.day;
  return { time, date };
}

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;

  bytes(data: Uint8Array) {
    this.chunks.push(data);
    this.length += data.length;
  }

  u16(value: number) {
    this.bytes(Uint8Array.of(value & 0xff, (value >>> 8) & 0xff));
  }

  u32(value: number) {
    this.bytes(Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff));
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

const UTF8_FLAG = 0x0800;
const VERSION = 20;
const LIMIT = 0xffffffff;

/** Construye el ZIP con las entradas en el orden dado. Los nombres repetidos son un error. */
export function createZip(entries: readonly ZipEntry[], opts: ZipOptions = {}): Uint8Array {
  if (entries.length > 0xffff) throw new Error("Demasiadas entradas para un ZIP sin ZIP64");
  const seen = new Set<string>();
  const { time, date } = dosDateTime(opts.modified);
  const out = new Writer();
  const central = new Writer();

  for (const entry of entries) {
    if (seen.has(entry.name)) throw new Error(`Entrada repetida en el ZIP: ${entry.name}`);
    seen.add(entry.name);
    const name = encodeUtf8(entry.name);
    const crc = crc32(entry.data);
    const deflated = entry.compress !== false && opts.deflateRaw ? opts.deflateRaw(entry.data) : null;
    // Si comprimir no ahorra nada, se guarda tal cual.
    const useDeflate = deflated !== null && deflated.length < entry.data.length;
    const payload = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;
    if (payload.length >= LIMIT || entry.data.length >= LIMIT || out.length >= LIMIT) {
      throw new Error("El ZIP supera los 4 GB");
    }
    const offset = out.length;

    // Cabecera local.
    out.u32(0x04034b50);
    out.u16(VERSION);
    out.u16(UTF8_FLAG);
    out.u16(method);
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(payload.length);
    out.u32(entry.data.length);
    out.u16(name.length);
    out.u16(0);
    out.bytes(name);
    out.bytes(payload);

    // Directorio central.
    central.u32(0x02014b50);
    central.u16(VERSION);
    central.u16(VERSION);
    central.u16(UTF8_FLAG);
    central.u16(method);
    central.u16(time);
    central.u16(date);
    central.u32(crc);
    central.u32(payload.length);
    central.u32(entry.data.length);
    central.u16(name.length);
    central.u16(0); // extra
    central.u16(0); // comentario
    central.u16(0); // disco
    central.u16(0); // atributos internos
    central.u32(0); // atributos externos
    central.u32(offset);
    central.bytes(name);
  }

  const centralOffset = out.length;
  const centralBytes = central.concat();
  out.bytes(centralBytes);
  // Fin del directorio central.
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(entries.length);
  out.u16(entries.length);
  out.u32(centralBytes.length);
  out.u32(centralOffset);
  out.u16(0);
  return out.concat();
}

/** Nombre de fichero seguro dentro de un ZIP (sin separadores ni caracteres que Windows no admite). */
export function safeFileName(name: string): string {
  const printable = [...name.normalize("NFC")].map((c) => (c.charCodeAt(0) < 0x20 ? "_" : c)).join("");
  const cleaned = printable
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "_");
  return cleaned.slice(0, 120) || "fichero";
}
