import { zodToJsonSchema } from 'zod-to-json-schema';
import { Assessment, Question } from './assessment.js';
import { Block } from './blocks.js';
import { Brief } from './brief.js';
import { CourseOutline } from './course.js';

/**
 * JSON Schema derivati dagli schema Zod, da usare per la generazione strutturata
 * AI (tool/function calling del provider) così da ottenere output direttamente
 * validabili (Requisito 4.1 / 4.2).
 */

export const outlineJsonSchema = zodToJsonSchema(CourseOutline, 'CourseOutline');
export const blockJsonSchema = zodToJsonSchema(Block, 'Block');
export const questionJsonSchema = zodToJsonSchema(Question, 'Question');
export const assessmentJsonSchema = zodToJsonSchema(Assessment, 'Assessment');
export const briefJsonSchema = zodToJsonSchema(Brief, 'Brief');

/** Mappa nome -> JSON Schema, comoda per registrare i tool dei provider. */
export const jsonSchemas = {
  CourseOutline: outlineJsonSchema,
  Block: blockJsonSchema,
  Question: questionJsonSchema,
  Assessment: assessmentJsonSchema,
  Brief: briefJsonSchema,
} as const;
