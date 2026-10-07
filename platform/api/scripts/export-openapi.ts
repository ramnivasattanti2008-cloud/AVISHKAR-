import { writeFileSync } from "node:fs";
import { buildOpenApi, stringifyStable } from "../src/openapi.js";

writeFileSync("openapi.json", stringifyStable(await buildOpenApi()));
console.log("wrote openapi.json"); // eslint-disable-line no-console
