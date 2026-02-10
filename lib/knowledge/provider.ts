import { DomainKnowledge } from "./types";
import { readFileSync } from "fs";
import { join } from "path";

const cache = new Map<string, DomainKnowledge>();

export function getKnowledge(domain: string): DomainKnowledge {
  if (cache.has(domain)) return cache.get(domain)!;
  try {
    const filePath = join(process.cwd(), "lib", "knowledge", `${domain}.json`);
    const data: DomainKnowledge = JSON.parse(readFileSync(filePath, "utf-8"));
    cache.set(domain, data);
    return data;
  } catch {
    if (domain !== "_base") {
      const base = getKnowledge("_base");
      cache.set(domain, base);
      return base;
    }
    throw new Error("Base knowledge file not found");
  }
}

export function getKnowledgeForPrompt(domain: string): string {
  const knowledge = getKnowledge(domain);
  const sections = [
    `## Expert Persona\n${knowledge.expertPersona}`,
    `## Key Questions to Ask\n${knowledge.keyQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
    `## Safety Rules\n${knowledge.safetyRules.map(r => `- [${r.severity}] ${r.description}`).join("\n")}`,
    `## Plan Guidelines\n${knowledge.planGuidelines}`,
  ];
  if (knowledge.referenceData && Object.keys(knowledge.referenceData).length > 0) {
    sections.push(`## Reference Data\n${JSON.stringify(knowledge.referenceData, null, 2)}`);
  }
  if (knowledge.phaseTemplates && knowledge.phaseTemplates.length > 0) {
    sections.push(`## Phase Templates\n${knowledge.phaseTemplates.map(p => `- ${p.name} (${p.durationWeeks} weeks): ${p.focus}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

export function getAllDomains(): string[] {
  return ["fitness", "habit", "learning", "finance", "career", "creative", "mental", "social", "lifestyle", "quit"];
}
