import { describe, expect, it } from "vitest";
import { isLoopbackAddress, isPublicAddress } from "./address";

describe("isPublicAddress", () => {
  it("acepta direcciones públicas", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4003:80e::200e", "[2606:4700::1]"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("rechaza loopback, privadas, link-local, CGNAT y metadatos", () => {
    for (const ip of [
      "127.0.0.1", "127.255.255.254", "0.0.0.0", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "192.0.0.1", "198.18.0.1", "198.19.255.255",
      "192.0.2.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("acepta las vecinas públicas de los rangos privados (los límites están bien)", () => {
    for (const ip of ["172.15.255.255", "172.32.0.0", "100.63.255.255", "100.128.0.0", "192.0.1.1", "192.0.3.1", "198.17.0.1", "198.20.0.1", "9.255.255.255", "11.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("rechaza IPv6 no públicas, también con una IPv4 privada dentro", () => {
    for (const ip of [
      "::", "::1", "fe80::1", "fe80::1%en0", "febf::1", "fc00::1", "fd12:3456::1", "fec0::1", "ff02::1", "2001:db8::1",
      "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:0:c0a8:101", "64:ff9b::a00:1", "2002:c0a8:101::1", "2001::1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicAddress("2002:808:808::1")).toBe(true);
  });

  it("lo que no es una IP no es público", () => {
    for (const value of ["", "localhost", "example.com", "1.2.3", "1.2.3.256", "::ffff:1.2.3", ":::1", "1:2:3:4:5:6:7:8:9", "gggg::1"]) {
      expect(isPublicAddress(value), value).toBe(false);
    }
  });
});

describe("isLoopbackAddress", () => {
  it("solo la propia máquina", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "::1", "[::1]", "::ffff:127.0.0.1"]) expect(isLoopbackAddress(ip), ip).toBe(true);
    for (const ip of ["10.0.0.1", "169.254.169.254", "8.8.8.8", "fe80::1", "::ffff:10.0.0.1", "localhost", ""]) expect(isLoopbackAddress(ip), ip).toBe(false);
  });
});
