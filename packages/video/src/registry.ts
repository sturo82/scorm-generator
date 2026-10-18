import type React from 'react';
import type { ComponentName } from '@scorm/contracts';
import type { ComponentProps } from './types.js';
import { TextReveal } from './components/TextReveal.js';
import { Caption } from './components/Caption.js';
import { BulletList } from './components/BulletList.js';
import { ChainDiagram } from './components/ChainDiagram.js';
import { IconStat } from './components/IconStat.js';
import { ArrowFlow } from './components/ArrowFlow.js';

/**
 * Registry: mappa i nomi della whitelist `ComponentName` (contracts) ai
 * componenti React/Remotion. UNICA fonte dei componenti componibili dall'LLM.
 * Deve restare allineato all'enum ComponentName (type-check lo garantisce).
 */
export const REGISTRY: Record<ComponentName, React.FC<ComponentProps>> = {
  TextReveal,
  Caption,
  BulletList,
  ChainDiagram,
  IconStat,
  ArrowFlow,
};
