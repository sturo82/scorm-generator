import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingsProvider, VectorMatch, VectorStore } from '@scorm/domain';
import type { SourceCitation } from '@scorm/contracts';
import { EMBEDDINGS_PROVIDER, VECTOR_STORE } from '../providers/provider.constants.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import type { AppConfig } from '../config/configuration.js';
import { estimateTokensFromText } from '../metering/token-estimate.js';

export interface RetrievalQuery {
  tenantId: string;
  /** Corso di riferimento: abilita il recupero della knowledge per-corso. */
  courseId?: string;
  /** Testo della query (es. obiettivo della lezione + contesto del brief). */
  text: string;
  /** Numero massimo di chunk da restituire dopo re-rank/dedup. */
  topK?: number;
  /** Soglia minima di similarità (0..1) per includere un chunk. */
  minScore?: number;
  /**
   * Whitelist di documenti da usare: se presente e non vuota, il RAG si limita
   * a questi documenti (selezione esplicita dell'utente). Se assente/vuota, usa
   * tutta la knowledge pertinente per similarità.
   */
  documentIds?: string[];
}

export interface RetrievedChunk {
  text: string;
  score: number;
  citation: SourceCitation;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  /** Citazioni deduplicate per documento/sezione, per il grounding (Req. 4.8). */
  citations: SourceCitation[];
}

const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SCORE = 0;

/**
 * Recupero RAG con citazioni (Requisito 3.5 / 3.6 / 4.8). Combina la knowledge
 * globale del tenant e quella specifica del corso, applica re-rank per score e
 * dedup, e restituisce il contesto con la provenienza delle fonti.
 */
@Injectable()
export class RetrievalService {
  constructor(
    @Inject(EMBEDDINGS_PROVIDER) private readonly embeddings: EmbeddingsProvider,
    @Inject(VECTOR_STORE) private readonly vectors: VectorStore,
    private readonly meter: UsageMeterService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async retrieve(query: RetrievalQuery): Promise<RetrievalResult> {
    const topK = query.topK ?? DEFAULT_TOP_K;
    const minScore = query.minScore ?? DEFAULT_MIN_SCORE;
    const scope = { tenantId: query.tenantId };

    const [embedding] = await this.embeddings.embed([query.text]);
    // Metering del consumo embeddings della query RAG, attribuito al corso in
    // generazione. Best-effort: non blocca il retrieval.
    void this.meter.record({
      tenantId: query.tenantId,
      courseId: query.courseId ?? null,
      provider: 'BEDROCK_EMBEDDINGS',
      model: this.config.get('bedrock', { infer: true }).embeddingsModelId,
      unit: 'INPUT_TOKENS',
      quantity: estimateTokensFromText([query.text]),
      source: 'rag_query',
    });
    if (!embedding) return { chunks: [], citations: [] };

    // Whitelist di documenti selezionati (se presente): limita il RAG a questi.
    const documentIds =
      query.documentIds && query.documentIds.length > 0 ? query.documentIds : undefined;

    // Recupera abbondante da entrambi gli scope, poi unisce e riordina.
    const fetchK = Math.max(topK * 2, topK);
    const globalMatches = await this.vectors.query(scope, embedding, fetchK, {
      scope: 'global',
      documentIds,
    });
    const courseMatches = query.courseId
      ? await this.vectors.query(scope, embedding, fetchK, {
          scope: 'course',
          courseId: query.courseId,
          documentIds,
        })
      : [];

    const merged = this.dedupeAndRank([...globalMatches, ...courseMatches], minScore, topK);

    const chunks: RetrievedChunk[] = merged.map((m) => ({
      text: m.text,
      score: m.score,
      citation: {
        documentId: m.documentId,
        documentName: m.documentName,
        section: m.section,
      },
    }));

    return { chunks, citations: this.uniqueCitations(chunks) };
  }

  /**
   * Cerca semanticamente nella knowledge GLOBAL del tenant i DOCUMENTI più
   * pertinenti a un argomento, per includerli tra le fonti di un corso "da
   * argomento". Ritorna documenti DISTINTI (non chunk): per ciascuno il chunk
   * più pertinente (come sommario) e lo score massimo. Non tocca la knowledge
   * COURSE. Se `vector` è fornito, lo riusa (evita un secondo embedding e il
   * relativo costo); altrimenti embedda `text`.
   */
  async searchGlobalDocs(input: {
    tenantId: string;
    text: string;
    /** Embedding dell'argomento già calcolato a monte (riuso, zero costo extra). */
    vector?: number[];
    /** Numero massimo di documenti distinti da restituire. */
    maxDocs?: number;
    /** Soglia minima di similarità per considerare un chunk pertinente. */
    minScore?: number;
  }): Promise<Array<{ documentId: string; documentName: string; text: string; score: number }>> {
    const maxDocs = input.maxDocs ?? 4;
    const minScore = input.minScore ?? 0.35;
    const scope = { tenantId: input.tenantId };

    let embedding = input.vector;
    if (!embedding || embedding.length === 0) {
      [embedding] = await this.embeddings.embed([input.text]);
      void this.meter.record({
        tenantId: input.tenantId,
        courseId: null,
        provider: 'BEDROCK_EMBEDDINGS',
        model: this.config.get('bedrock', { infer: true }).embeddingsModelId,
        unit: 'INPUT_TOKENS',
        quantity: estimateTokensFromText([input.text]),
        source: 'rag_query',
      });
    }
    if (!embedding || embedding.length === 0) return [];

    // Prende abbondante dai soli chunk GLOBAL, poi collassa per documento
    // tenendo il chunk più pertinente di ciascuno.
    const matches = await this.vectors.query(scope, embedding, maxDocs * 6, { scope: 'global' });
    const byDoc = new Map<string, { documentId: string; documentName: string; text: string; score: number }>();
    for (const m of matches) {
      if (m.score < minScore) continue;
      const existing = byDoc.get(m.documentId);
      if (!existing || m.score > existing.score) {
        byDoc.set(m.documentId, {
          documentId: m.documentId,
          documentName: m.documentName,
          text: m.text,
          score: m.score,
        });
      }
    }
    return [...byDoc.values()].sort((a, b) => b.score - a.score).slice(0, maxDocs);
  }

  /**
   * Elenca i chunk della knowledge pertinenti al corso (global + course,
   * rispettando la whitelist knowledgeDocIds), SENZA vettori. Serve a
   * impacchettare l'indice RAG lessicale offline nel pacchetto SCORM e per
   * alimentare lo stesso widget in anteprima (fedeltà 100%).
   */
  async listCourseChunks(input: {
    tenantId: string;
    courseId: string;
    documentIds?: string[];
    limit?: number;
  }): Promise<Array<{ text: string; documentName: string; section?: string }>> {
    const scope = { tenantId: input.tenantId };
    const documentIds =
      input.documentIds && input.documentIds.length > 0 ? input.documentIds : undefined;
    const limit = input.limit ?? 1500;
    const [globalChunks, courseChunks] = await Promise.all([
      this.vectors.listChunks(scope, { scope: 'global', documentIds }, limit),
      this.vectors.listChunks(scope, { scope: 'course', courseId: input.courseId, documentIds }, limit),
    ]);
    // Dedup per (documento+sezione+testo). ORDINE DETERMINISTICO: il vector
    // store (pgvector) non garantisce un ordine stabile tra chiamate, il che
    // farebbe divergere l'anteprima dal pacchetto SCORM (set/ordine diversi →
    // dedup e selezione diversi). Ordiniamo in modo stabile così ogni chiamata
    // restituisce ESATTAMENTE lo stesso set, nello stesso ordine. È la chiave
    // della coerenza anteprima ↔ pacchetto esportato.
    const all = [...globalChunks, ...courseChunks].sort((a, b) => {
      const ka = `${a.documentId}\u0000${a.section ?? ''}\u0000${a.text}`;
      const kb = `${b.documentId}\u0000${b.section ?? ''}\u0000${b.text}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    const seen = new Set<string>();
    const out: Array<{ text: string; documentName: string; section?: string }> = [];
    for (const c of all) {
      const key = `${c.documentId}#${c.section ?? ''}#${c.text.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: c.text, documentName: c.documentName, section: c.section });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Unisce i match, rimuove i duplicati (per id) e ordina per score desc. */
  private dedupeAndRank(matches: VectorMatch[], minScore: number, topK: number): VectorMatch[] {
    const byId = new Map<string, VectorMatch>();
    for (const m of matches) {
      if (m.score < minScore) continue;
      const existing = byId.get(m.id);
      if (!existing || m.score > existing.score) byId.set(m.id, m);
    }
    return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /** Citazioni uniche per documento+sezione, nell'ordine di rilevanza. */
  private uniqueCitations(chunks: RetrievedChunk[]): SourceCitation[] {
    const seen = new Set<string>();
    const out: SourceCitation[] = [];
    for (const c of chunks) {
      const key = `${c.citation.documentId}#${c.citation.section ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c.citation);
    }
    return out;
  }
}
