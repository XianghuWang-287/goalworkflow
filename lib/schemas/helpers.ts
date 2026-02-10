import { z } from "zod";

/** Coerce string to array if needed (LLM sometimes returns string instead of array) */
export const stringOrArrayToArray = z.preprocess((val) => {
  if (typeof val === "string") {
    if (val.trim()) {
      return val.includes(",") ? val.split(",").map((s) => s.trim()) : [val.trim()];
    }
    return [];
  }
  if (Array.isArray(val)) {
    return val;
  }
  return [];
}, z.array(z.string()));

/** Coerce string number to number (LLM sometimes returns "30" instead of 30) */
export const stringOrNumberToNumber = z.preprocess((val) => {
  if (typeof val === "string") {
    const num = parseInt(val, 10);
    return isNaN(num) ? val : num;
  }
  return val;
}, z.number().int().positive());
