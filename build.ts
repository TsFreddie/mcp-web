import fs from "fs";

fs.mkdirSync("dist", { recursive: true });

Bun.build({
  entrypoints: ["index.ts"],
  outdir: "dist",
  target: "node",
  minify: true,
});

fs.cpSync("assets", "dist/assets", { recursive: true });
