export interface DomainKnowledge {
  domain: string;
  displayName: string;
  expertPersona: string;
  profileQuestions: ProfileQuestion[];
  keyQuestions: string[];
  safetyRules: SafetyRule[];
  referenceData: Record<string, any>;
  phaseTemplates?: PhaseTemplate[];
  planGuidelines: string;
}

export interface ProfileQuestion {
  field: string;
  question: string;
  type: "text" | "select" | "number";
  options?: string[];
  required: boolean;
}

export interface SafetyRule {
  id: string;
  description: string;
  check: string;
  severity: "error" | "warning";
}

export interface PhaseTemplate {
  name: string;
  durationWeeks: number;
  focus: string;
  intensityLevel: number;
}
