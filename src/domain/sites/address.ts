// ¿Es una dirección IP pública? El monitor solo conecta a direcciones públicas: un dominio que
// resuelva a la red interna, a loopback o a la dirección de metadatos de la nube no se comprueba
// (ni siguiendo una redirección). Sin I/O: el servidor resuelve el DNS y pregunta aquí.

/** Los cuatro octetos de una IPv4, o null si no lo es. */
function parseV4(value: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!m) return null;
  const octets = m.slice(1).map(Number) as [number, number, number, number];
  return octets.every((o) => o <= 255) ? octets : null;
}

/** Los ocho grupos (0–65535) de una IPv6, o null si no lo es. Admite "::" y la forma con IPv4 al final. */
function parseV6(value: string): number[] | null {
  let text = value;
  // ::ffff:1.2.3.4 y similares: la IPv4 del final son los dos últimos grupos.
  const tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (tail) {
    const v4 = parseV4(tail[2]!);
    if (!v4) return null;
    text = `${tail[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":").map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
    return groups.some(Number.isNaN) ? null : groups;
  };
  const head = toGroups(halves[0]!);
  const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  if (head.length + rest.length > 7) return null;
  return [...head, ...new Array<number>(8 - head.length - rest.length).fill(0), ...rest];
}

function isPublicV4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return false; // "esta red", privada, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local y metadatos de la nube
  if (a === 172 && b >= 16 && b <= 31) return false; // privada
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // reservada IETF y documentación
  if (a === 192 && b === 168) return false; // privada
  if (a === 198 && (b === 18 || b === 19)) return false; // bancos de pruebas
  if (a === 198 && b === 51 && c === 100) return false; // documentación
  if (a === 203 && b === 0 && c === 113) return false; // documentación
  if (a >= 224) return false; // multicast, reservada y broadcast
  return true;
}

function isPublicV6(g: number[]): boolean {
  const first = g[0]!;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicV4(toV4(g[6]!, g[7]!)); // ::ffff:a.b.c.d
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return isPublicV4(toV4(g[6]!, g[7]!)); // ::ffff:0:a.b.c.d (SIIT)
  if (first === 0x64 && g[1] === 0xff9b) return false; // NAT64 (lleva una IPv4 dentro)
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 (ULA)
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 (link-local)
  if ((first & 0xffc0) === 0xfec0) return false; // fec0::/10 (site-local, obsoleto)
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && g[1] === 0x0db8) return false; // documentación
  if (first === 0x2001 && g[1] === 0) return false; // Teredo (túnel)
  if (first === 0x2002) return isPublicV4(toV4(g[1]!, g[2]!)); // 6to4: la IPv4 va dentro
  return true;
}

const toV4 = (hi: number, lo: number): [number, number, number, number] => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];

/** 127.0.0.0/8, ::1 o ::ffff:127.x.x.x: la propia máquina (lo único que un test puede permitir). */
export function isLoopbackAddress(ip: string): boolean {
  const value = ip.trim().replace(/%.*$/, "").replace(/^\[|\]$/g, "");
  const v4 = parseV4(value);
  if (v4) return v4[0] === 127;
  const v6 = parseV6(value);
  if (!v6) return false;
  if (v6.slice(0, 7).every((x) => x === 0) && v6[7] === 1) return true;
  return v6.slice(0, 5).every((x) => x === 0) && v6[5] === 0xffff && v6[6]! >> 8 === 127;
}

/**
 * true solo para direcciones a las que se puede salir por Internet. Falso para privadas, loopback,
 * link-local, CGNAT, documentación, multicast, reservadas y lo que no sea una IP.
 */
export function isPublicAddress(ip: string): boolean {
  const value = ip.trim().replace(/%.*$/, "").replace(/^\[|\]$/g, "");
  const v4 = parseV4(value);
  if (v4) return isPublicV4(v4);
  const v6 = parseV6(value);
  return v6 ? isPublicV6(v6) : false;
}
