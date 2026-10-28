import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "public/**", "next-env.d.ts", "screenshots/**"] },
  ...nextVitals,
  ...nextTs,
];

export default config;
