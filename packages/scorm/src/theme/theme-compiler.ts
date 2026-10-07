/**
 * La compilazione del tema del brand è stata spostata in @scorm/contracts, così
 * da essere condivisa identica tra il builder SCORM e l'anteprima web (che
 * importa solo @scorm/contracts). Questo file resta come re-export per non
 * rompere gli import esistenti.
 */
export { compileTheme, type CompiledTheme } from '@scorm/contracts';
