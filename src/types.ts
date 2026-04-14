// Core typed shape for numeric sentence-length style signals.
export interface SentenceLengthProfile {
  averageWords: number;
  p50Words: number;
  p90Words: number;
}

// Vocabulary metrics and qualitative notes from the model.
export interface VocabularyProfile {
  lexicalDiversity: number;
  complexityNotes: string[];
}

// Full style profile persisted locally and reused for rewrites.
// Most fields are intentionally explicit to make prompt composition predictable.
export interface StyleProfile {
  sentenceLength: SentenceLengthProfile;
  vocabulary: VocabularyProfile;
  hedgingLanguage: string[];
  punctuationTendencies: string[];
  paragraphRhythm: string;
  argumentStructure: string;
  openingPatterns: string[];
  closingPatterns: string[];
  recurringPhrases: string[];
}

// Wrapper persisted in local config store, including metadata.
export interface StoredProfile {
  profile: StyleProfile;
  model: string;
  createdAt: string;
  updatedAt: string;
}

// Runtime type guard:
// Validates unknown JSON at runtime before using it as StyleProfile.
// This is important because model output is untrusted text until parsed and checked.
export function isStyleProfile(value: unknown): value is StyleProfile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StyleProfile>;
  const sentenceLength = candidate.sentenceLength;
  const vocabulary = candidate.vocabulary;

  // Shared helper for array-of-string checks across many fields.
  const isStringArray = (array: unknown): array is string[] =>
    Array.isArray(array) && array.every((item) => typeof item === "string");

  return (
    !!sentenceLength &&
    typeof sentenceLength.averageWords === "number" &&
    typeof sentenceLength.p50Words === "number" &&
    typeof sentenceLength.p90Words === "number" &&
    !!vocabulary &&
    typeof vocabulary.lexicalDiversity === "number" &&
    isStringArray(vocabulary.complexityNotes) &&
    isStringArray(candidate.hedgingLanguage) &&
    isStringArray(candidate.punctuationTendencies) &&
    typeof candidate.paragraphRhythm === "string" &&
    typeof candidate.argumentStructure === "string" &&
    isStringArray(candidate.openingPatterns) &&
    isStringArray(candidate.closingPatterns) &&
    isStringArray(candidate.recurringPhrases)
  );
}
