import { readFileSync } from "node:fs";

// Inspect the real PE import table on any build OS. Running an exe on a CI
// image with Visual Studio installed cannot detect a missing CRT dependency.
export function verifyWindowsHost(path) {
  const bytes = readFileSync(path);
  if (bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Invalid Windows host");
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.readUInt32LE(pe) !== 0x4550) throw new Error("Invalid PE signature");
  const count = bytes.readUInt16LE(pe + 6);
  const optional = pe + 24;
  const optionalSize = bytes.readUInt16LE(pe + 20);
  const directories = optional + (bytes.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const importRva = bytes.readUInt32LE(directories + 8);
  const sections = Array.from({ length: count }, (_, i) => {
    const at = optional + optionalSize + i * 40;
    return { va: bytes.readUInt32LE(at + 12), size: Math.max(bytes.readUInt32LE(at + 8), bytes.readUInt32LE(at + 16)), offset: bytes.readUInt32LE(at + 20) };
  });
  const offset = (rva) => {
    const section = sections.find((s) => rva >= s.va && rva < s.va + s.size);
    if (!section) throw new Error("Invalid PE import address");
    return section.offset + rva - section.va;
  };
  const imports = [];
  if (importRva) {
    let at = offset(importRva);
    while (bytes.subarray(at, at + 20).some(Boolean)) {
      const name = offset(bytes.readUInt32LE(at + 12));
      const end = bytes.indexOf(0, name);
      if (end < 0) throw new Error("Invalid PE import name");
      imports.push(bytes.toString("ascii", name, end));
      at += 20;
    }
  }
  const externalCrt = imports.filter((name) => /^(vcruntime|msvcp|concrt)\d.*\.dll$/i.test(name));
  if (externalCrt.length) throw new Error(`Windows host requires an external Visual C++ runtime (${externalCrt.join(", ")}); rebuild with npm run host:build`);
  console.log(`Windows host DLL imports verified: ${imports.join(", ")}`);
  return imports;
}
