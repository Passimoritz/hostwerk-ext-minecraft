import { fmtNumber } from '@hostwerk/api';

// Dezimalzahl in der Sprache der Oberfläche: „1,5“ auf Deutsch, „1.5“ auf Englisch (statt fest durch ein Komma ersetzt)
export const dec = (v, digits = 1) => { const f = 10 ** digits; return fmtNumber(Math.round(Number(v) * f) / f); };
