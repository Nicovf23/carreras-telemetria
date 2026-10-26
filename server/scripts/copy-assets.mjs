// Copia los recursos no-TS (migraciones SQL, OpenAPI, datos demo) a dist/.
import { cpSync } from 'node:fs';
cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
cpSync('src/openapi.yaml', 'dist/openapi.yaml');
cpSync('src/demo/costa-este-route.json', 'dist/demo/costa-este-route.json');
