// Este TypeScript (6.0.3, ver README) não inclui @types/* automaticamente
// só por estarem em node_modules/@types — mesmo achado feito com @types/jest
// (ver apps/api/tsconfig.spec.json). @types/multer só existe como
// augmentação global (`declare global { namespace Express { namespace
// Multer {...} } }`, sem export nomeado direto) — sem esta referência
// explícita, `Express.Multer.File` (usado em arquivos.controller.ts e
// arquivos.service.ts, Card A4) não resolve: "Namespace 'global.Express'
// has no exported member 'Multer'".
/// <reference types="multer" />
